// End-to-end tests: Chromium with the built extension (dist/), LinkedIn replaced by a local fixture
// page and the Anthropic API replaced by a mock (both through Playwright request interception).
import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installAnthropicMock, GOOD_KEY, CV_NAME } from "./mock-anthropic.mjs";
import { zip } from "../zip.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, "../dist");
const FIXTURE = fs.readFileSync(path.join(here, "fixtures/linkedin.html"), "utf8");
const JOB_A = "https://www.linkedin.com/jobs/view/4000000001/";
const SEARCH = (id) => `https://www.linkedin.com/jobs/search/?keywords=java&currentJobId=${id}`;
const GREEN = [29, 122, 70, 255], BLUE = [37, 99, 235, 255], ORANGE = [217, 99, 30, 255];

const CV = `${CV_NAME}
maria@example.com · +40 700 111 222 · Bucharest · linkedin.com/in/maria-example

EXPERIENCE
Senior Software Engineer – Example Fintech, Bucharest (03/2021 – present)
- Built payment processing APIs in Spring Boot
- Moved three services from the data centre to AWS (ECS, RDS), pipelines in GitHub Actions
- Code review and onboarding for two junior colleagues
- Took part in sprint planning

Software Engineer – Example Retail, Cluj-Napoca (2017 – 2021)
- Maintained the stock management system (Java 8, PostgreSQL)
- Optimised slow SQL queries

EDUCATION
BSc Computer Science – Babeș-Bolyai University (2013 – 2017)

CERTIFICATIONS
AWS Certified Developer – Associate (2022)

LANGUAGES
Romanian – native; English – C1`;

let context, sw, mock, extId, jobPage, app, userDataDir, downloadedPdf;
const pageErrors = [];
const shots = process.env.SCREENSHOTS ? path.resolve(process.env.SCREENSHOTS) : null;
const shot = async (page, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + ".png"), fullPage: true }); } };
function watchErrors(page) {
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
}

// The extension has no "tabs" permission, so it cannot see tab URLs. The LinkedIn tab's id is taken
// when it is the only tab (first test) and used from then on.
let jobTabId = null;
async function badge() {
  return sw.evaluate(async (tabId) => ({
    text: await chrome.action.getBadgeText({ tabId }),
    color: await chrome.action.getBadgeBackgroundColor({ tabId }),
    title: await chrome.action.getTitle({ tabId }),
  }), jobTabId);
}
const badgeText = async () => (await badge()).text;

async function clickToolbar() {
  await sw.evaluate(async (tabId) => globalThis.cvTailor.openAppForTab(await chrome.tabs.get(tabId)), jobTabId);
}

// Playwright cannot show Chrome's side panel, so the test opens the panel's page (app.html) in a tab
// with a panel-like width after the toolbar click; the app picks up the job the same way.
async function openAppFromToolbar() {
  await clickToolbar();
  const page = await context.newPage();
  watchErrors(page);
  await page.setViewportSize({ width: 520, height: 900 });
  await page.goto(`chrome-extension://${extId}/app.html`);
  return page;
}
const panelOpens = () => sw.evaluate(() => globalThis.__panelOpens || []);

const scoreCalls = () => mock.of("score");
// The editor's text lives in form fields.
const editorText = (page) => page.$$eval("#editor input, #editor textarea", (els) => els.map((e) => e.value).join("\n"));

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-tailor-test-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: !process.env.HEADED,
    acceptDownloads: true,
    viewport: { width: 1300, height: 900 },
    args: ["--screen-info={1600x1000}", "--window-size=1500,960", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await context.route("https://*.linkedin.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE }));
  mock = await installAnthropicMock(context);
  sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  extId = new URL(sw.url()).host;
  // chrome.sidePanel.open() needs a real click on the toolbar button; record the calls instead.
  await sw.evaluate(() => { chrome.sidePanel.open = async (options) => { (globalThis.__panelOpens ||= []).push(options); }; });
});

test.afterAll(async () => {
  await context?.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

test("without a CV the badge says CV? and nothing is sent", async () => {
  jobPage = context.pages()[0] || (await context.newPage());
  const tabs = await sw.evaluate(() => chrome.tabs.query({}));
  expect(tabs).toHaveLength(1);
  jobTabId = tabs[0].id;
  await jobPage.goto(JOB_A);
  await expect.poll(() => badgeText(), { timeout: 10_000 }).toBe("CV?");
  expect(mock.calls).toHaveLength(0);
});

test("Settings: a wrong key is rejected, the right key works and is saved", async () => {
  app = await context.newPage();
  watchErrors(app);
  await app.goto(`chrome-extension://${extId}/app.html`);
  // First run without a key opens Settings.
  await expect(app.locator("#view-settings")).toBeVisible();
  await expect(app.locator(".privacy")).toContainText("api.anthropic.com");
  await app.fill("#api-key", "sk-ant-wrong");
  await app.click("#btn-test-key");
  await expect(app.locator("#key-status")).toContainText("rejected the API key");
  await app.fill("#api-key", GOOD_KEY);
  await app.click("#btn-test-key");
  await expect(app.locator("#key-status")).toContainText("The key works");
  await shot(app, "0-settings");
  const stored = await sw.evaluate(() => chrome.storage.local.get("settings"));
  expect(stored.settings.apiKey).toBe(GOOD_KEY);
  expect(mock.of("models").length).toBeGreaterThan(0);
  expect(scoreCalls()).toHaveLength(0);
});

test("adding a CV scores the open job once with Haiku, with the right colour", async () => {
  await app.click("#tab-input");
  await expect(app.locator("#example-note")).toBeVisible();
  await app.click("#btn-clear");
  await app.fill("#cv-text", CV);
  await app.waitForTimeout(600); // the app saves 300 ms after typing
  await jobPage.bringToFront();
  await expect.poll(() => badgeText(), { timeout: 15_000 }).toBe("82");
  expect((await badge()).color).toEqual(GREEN);
  expect((await badge()).title).toContain("82/100");
  expect(scoreCalls()).toHaveLength(1);
  const call = scoreCalls()[0];
  expect(call.model).toBe("claude-haiku-5-5");
  expect(call.body.output_config.effort).toBe("low");
  expect(call.body.output_config.format.type).toBe("json_schema");
  expect(call.text).toContain("Senior Backend Engineer – Payments");
  expect(call.text).toContain("Kubernetes is a plus");
  expect(call.text).toContain(CV_NAME);
  expect(call.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
});

test("revisiting a job reuses the cached score", async () => {
  await jobPage.reload();
  await expect.poll(() => badgeText(), { timeout: 10_000 }).toBe("82");
  await jobPage.waitForTimeout(2500);
  expect(await badgeText()).toBe("82");
  expect(scoreCalls()).toHaveLength(1);
});

test("search view: follows currentJobId, waits for the new description and debounces fast clicks", async () => {
  await jobPage.goto(SEARCH("4000000002"));
  await expect.poll(() => badgeText(), { timeout: 15_000 }).toBe("58");
  expect((await badge()).color).toEqual(BLUE);

  // Clicking another job changes the URL at once; the description follows 700 ms later.
  await jobPage.click('[data-job-id="4000000003"]');
  await expect.poll(() => badgeText(), { timeout: 15_000 }).toBe("31");
  expect((await badge()).color).toEqual(ORANGE);
  const last = scoreCalls().at(-1);
  expect(last.text).toContain("CLOUD-JOB-THREE");
  expect(last.text).not.toContain("RETAIL-JOB-TWO");

  // Two quick clicks: only the job that stays open is scored.
  await jobPage.click('[data-job-id="4000000004"]');
  await jobPage.waitForTimeout(300);
  await jobPage.click('[data-job-id="4000000005"]');
  await expect.poll(() => badgeText(), { timeout: 15_000 }).toBe("52");
  expect(scoreCalls().filter((c) => c.text.includes("DATA-JOB-FOUR"))).toHaveLength(0);
  expect(scoreCalls()).toHaveLength(4);

  // Back to a job seen before: cached.
  await jobPage.click('[data-job-id="4000000002"]');
  await expect.poll(() => badgeText(), { timeout: 15_000 }).toBe("58");
  expect(scoreCalls()).toHaveLength(4);
});

test("a job page in an unknown layout is read by its heading and page title", async () => {
  await jobPage.goto("https://www.linkedin.com/jobs/view/4000000007/");
  await expect.poll(() => badgeText(), { timeout: 15_000 }).toBe("50");
  const last = scoreCalls().at(-1);
  expect(last.text).toContain("NEW-LAYOUT-SEVEN");
  expect(last.text).toContain("Backend Engineer (new layout)");
  expect(last.text).toContain("Example Logistics");
  expect(scoreCalls()).toHaveLength(5);
});

test("pages that are not job ads have no badge", async () => {
  await jobPage.goto("https://www.linkedin.com/feed/");
  await expect.poll(() => badgeText(), { timeout: 10_000 }).toBe("");
  expect(scoreCalls()).toHaveLength(5);
});

test("with auto-score off nothing is sent; turning it on scores the open job", async () => {
  await app.bringToFront();
  await app.click("#tab-settings");
  await app.uncheck("#auto-score");
  await expect(app.locator("#auto-status")).toContainText("off");
  await jobPage.bringToFront();
  await jobPage.goto(SEARCH("4000000006"));
  await jobPage.waitForTimeout(3500);
  expect(await badgeText()).toBe("");
  expect(scoreCalls()).toHaveLength(5);

  await app.bringToFront();
  await app.check("#auto-score");
  await jobPage.bringToFront();
  await expect.poll(() => badgeText(), { timeout: 15_000 }).toBe("44");
  expect(scoreCalls()).toHaveLength(6);
});

test("the toolbar button opens the app in the side panel with the job filled in", async () => {
  await jobPage.goto(JOB_A);
  await expect.poll(() => badgeText(), { timeout: 10_000 }).toBe("82");
  await app.close(); // the app tab opened by the test; from here on the app is the side panel's page
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.side_panel.default_path).toBe("app.html");
  app = await openAppFromToolbar();
  const jobWindowId = await sw.evaluate(async (tabId) => (await chrome.tabs.get(tabId)).windowId, jobTabId);
  expect(await panelOpens()).toEqual([{ windowId: jobWindowId }]);
  await expect(app.locator("#view-input")).toBeVisible();
  await expect(app.locator("#jd")).toHaveValue(/Senior Backend Engineer – Payments/);
  await expect(app.locator("#jd")).toHaveValue(/Kubernetes is a plus/);
  await expect(app.locator("#jd")).toHaveValue(/Example Payments SRL/);
  await expect(app.locator("#cv-text")).toHaveValue(new RegExp(CV_NAME));
  await expect(app.locator("#linkedin-job")).toContainText("Fit 82/100");
  await expect(app.locator("#linkedin-job")).toContainText("Strong fit");
  expect(scoreCalls()).toHaveLength(6);
  await shot(app, "1-details-from-linkedin");
});

test("full flow: questions, writing, completeness check, rewrite, preview, PDF, saved CVs", async () => {
  await app.click("#btn-analyze");
  await expect(app.locator("#view-questions")).toBeVisible();
  await expect(app.locator("#questions .q-card")).toHaveCount(3);
  await expect(app.locator("#match-panel")).toContainText("78");
  await expect(app.locator("#match-panel")).toContainText("Strong fit");
  // The full analysis replaces the quick score on the toolbar.
  await expect.poll(() => badgeText(), { timeout: 10_000 }).toBe("78");

  await shot(app, "2-questions");
  await app.fill("#q-answer-1", "Yes, one week a month for the payment services at Example Fintech.");
  await app.check("#q-none-0");
  await expect(app.locator("#q-progress")).toHaveText("2 of 3 answered");
  await app.fill("#extra", "I wrote the internal documentation for the refund API.");
  await app.click("#btn-generate");
  await expect(app.locator("#view-result")).toBeVisible({ timeout: 20_000 });
  await expect(app.locator("#analysis")).toContainText("Fit: 78 → 84");

  // The real PDF preview (pdfmake + pdf.js, bundled) renders.
  await expect(app.locator("#pages canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect(app.locator("#page-count")).toContainText("page");

  // Completeness check: one item was lost; "Put them back" restores it.
  await expect(app.locator("#check")).toContainText("1 item from your original CV is missing", { timeout: 20_000 });
  await expect(app.locator("#check")).toContainText("Took part in sprint planning");
  await app.click("#check >> text=Put them back");
  await expect(app.locator("#check")).toContainText("everything from your original CV is in the tailored version", { timeout: 20_000 });
  await expect.poll(() => editorText(app)).toContain("Took part in sprint planning");

  // In the narrow side panel the editor and the preview take turns.
  await expect(app.locator("#editor")).toBeHidden();
  await app.click('#narrow-switch [data-pane="editor"]');
  await expect(app.locator("#editor")).toBeVisible();
  await expect(app.locator("#pages")).toBeHidden();

  // Tips on hover and a section rewrite.
  await expect(app.locator("#editor .tip").first()).toBeAttached();
  const summary = app.locator("fieldset", { has: app.locator("legend", { hasText: "Profile" }) });
  await summary.locator("legend >> text=Rewrite").click();
  await summary.locator(".rewrite-row input").fill("shorter");
  await summary.locator(".rewrite-row >> button.primary").click();
  await expect.poll(() => editorText(app), { timeout: 20_000 }).toContain("(rewritten)");
  const rewriteCall = mock.of("rewrite").at(-1);
  expect(rewriteCall.text).toContain('"shorter"');

  await app.click('#narrow-switch [data-pane="preview"]');

  // Sources and templates.
  await app.check("#show-sources");
  await expect(app.locator("#legend")).toBeVisible();
  await app.selectOption("#template", "modern");
  await expect(app.locator("#pages canvas").first()).toBeVisible();

  await app.waitForTimeout(1500);
  await shot(app, "3-tailored-cv");

  // Download.
  const downloadPromise = app.waitForEvent("download");
  await app.click("#btn-pdf");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^CV_Maria_Popescu_.*\.pdf$/);
  downloadedPdf = path.join(userDataDir, "downloaded.pdf");
  await download.saveAs(downloadedPdf);
  const pdf = fs.readFileSync(downloadedPdf);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(5000);
  await expect(app.locator("#pdf-status")).toContainText("PDF downloaded");

  // Saved CVs.
  await app.click("#tab-history");
  await expect(app.locator("#history .h-item")).toHaveCount(1);
  await expect(app.locator("#history")).toContainText("Senior Backend Engineer – Payments · Example Payments SRL");

  // Every app call went to Opus 5.5, streamed, with adaptive thinking and the server-side fallback.
  const opus = mock.calls.filter((c) => c.kind !== "score" && c.path === "/v1/messages");
  expect(opus.map((c) => c.kind)).toEqual(expect.arrayContaining(["questions", "generate", "check", "repair", "rewrite"]));
  for (const c of opus) {
    expect(c.model).toBe("claude-opus-5-5");
    expect(c.body.stream).toBe(true);
    expect(c.body.thinking).toEqual({ type: "adaptive" });
    expect(c.body.fallbacks).toBe("default");
    expect(c.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
  }
  expect(mock.of("generate")[0].body.output_config.effort).toBe("high");
  expect(mock.of("questions")[0].body.output_config.effort).toBe("medium");
  // The validated prompts are the artifact's.
  expect(mock.of("generate")[0].text).toContain("## Truthfulness comes first");
  expect(mock.of("generate")[0].text).toContain("## Voice: match the job description's professional register");
  expect(mock.of("rewrite")[0].text).toContain("## Voice: match the job description's professional register");
  expect(mock.of("generate")[0].text).toContain("<candidate_answers>");
  expect(mock.of("generate")[0].text).toContain("I don't have experience with this.");
  expect(mock.of("questions")[0].text).toContain("## Questions");
});

test("clicking the toolbar button again while the app is open keeps the work", async () => {
  let opened = false;
  const onPage = () => { opened = true; };
  context.on("page", onPage);
  await clickToolbar();
  await app.waitForTimeout(1500);
  context.off("page", onPage);
  expect(opened).toBe(false);
  expect((await panelOpens()).length).toBe(2);
  await app.click("#tab-result");
  await expect(app.locator("#view-result")).toBeVisible();
  await expect.poll(() => editorText(app)).toContain("Took part in sprint planning");
});

test("a changed CV invalidates the cached score", async () => {
  await app.click("#tab-input");
  await app.fill("#cv-text", CV + "\nKubernetes (CKA, 2024)");
  // In the browser the side panel sits next to the LinkedIn tab, which stays the active tab.
  await app.waitForTimeout(600);
  await jobPage.bringToFront();
  await expect.poll(() => badgeText(), { timeout: 15_000 }).toBe("87");
  expect(scoreCalls().at(-1).text).toContain("Kubernetes (CKA, 2024)");
});

test("opening another job starts a new role; the previous CV stays saved", async () => {
  await jobPage.goto(SEARCH("4000000003"));
  await expect.poll(() => badgeText(), { timeout: 15_000 }).toBe("36");
  await clickToolbar();
  await expect(app.locator("#jd")).toHaveValue(/Kubernetes Platform Engineer/);
  await expect(app.locator("#tab-result")).toBeDisabled();
  await expect(app.locator("#history-count")).toHaveText("(1)");
  await expect(app.locator("#linkedin-job")).toContainText("Fit 36/100");
});

test("unsaved answers: the app asks before loading another job", async () => {
  await app.click("#btn-analyze");
  await expect(app.locator("#view-questions")).toBeVisible();
  await app.fill("#q-answer-0", "I ran a small k3s cluster at home.");
  await app.waitForTimeout(500);
  await jobPage.goto(JOB_A);
  await expect.poll(() => badgeText(), { timeout: 15_000 }).not.toBe("");
  await clickToolbar();
  await expect(app.locator("#pending-job")).toBeVisible();
  await app.click("#pending-job >> text=Keep the current role");
  await expect(app.locator("#jd")).toHaveValue(/Kubernetes Platform Engineer/);
  await clickToolbar();
  await app.click("#pending-job >> text=Load the LinkedIn job");
  await expect(app.locator("#jd")).toHaveValue(/Senior Backend Engineer – Payments/);
  await expect(app.locator("#tab-questions")).toBeDisabled();
});

test("file upload: a text PDF, a DOCX and a scanned PDF (read by Claude)", async () => {
  // Text PDF as the job description (the PDF downloaded above).
  await app.setInputFiles("#jd-file", downloadedPdf);
  await expect(app.locator("#jd-file-status")).toContainText("is in the box below");
  await expect(app.locator("#jd")).toHaveValue(/Maria\s+Popescu/);

  // DOCX as the CV.
  const docx = zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Elena Docx</w:t></w:r></w:p><w:p><w:r><w:t>Backend engineer, Java and Spring Boot since 2018. Ștefan cel Mare University.</w:t></w:r></w:p></w:body></w:document>` },
  ]);
  await app.setInputFiles("#cv-file", { name: "cv.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx });
  await expect(app.locator("#file-status")).toContainText("cv.docx:");
  await expect(app.locator("#file-status")).toContainText("characters read");

  // Scanned PDF: one page with shapes and no text layer.
  const stream = "0.2 0.2 0.2 rg 60 760 260 18 re f 60 720 420 8 re f 60 700 400 8 re f";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdfText = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => { const at = pdfText.length; pdfText += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = pdfText.length;
  pdfText += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await app.setInputFiles("#cv-file", { name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfText) });
  await expect(app.locator("#file-status")).toContainText("scan.pdf:", { timeout: 20_000 });
  const t = mock.of("transcribe").at(-1);
  expect(t.model).toBe("claude-opus-5-5");
  expect(t.body.output_config.effort).toBe("low");
  const images = t.body.messages[0].content.filter((b) => b.type === "image");
  expect(images).toHaveLength(1);
  expect(images[0].source.media_type).toBe("image/jpeg");
});

test("New role keeps the CV; Reset everything clears it and the badge asks for a CV again", async () => {
  await app.click("#btn-new-role");
  await app.click("#btn-new-role");
  await expect(app.locator("#jd")).toHaveValue("");
  await expect(app.locator("#cv-text")).not.toHaveValue("");
  await app.click("#btn-reset");
  await app.click("#btn-reset");
  await expect(app.locator("#cv-text")).toHaveValue("");
  await expect(app.locator("#file-status")).toContainText("No file uploaded");
  await app.click("#tab-history");
  await expect(app.locator("#history .h-item")).toHaveCount(1);
  await expect.poll(() => badgeText(), { timeout: 15_000 }).toBe("CV?");
});

test("Stop cancels a running Claude call", async () => {
  await app.click("#tab-input");
  await app.fill("#jd", "Backend engineer, Java.");
  await app.fill("#cv-text", CV);
  mock.setDelay(5000);
  await app.click("#btn-analyze");
  await expect(app.locator("#btn-stop")).toBeVisible();
  await app.click("#btn-stop");
  await expect(app.locator("#status")).toHaveText("Stopped.");
  await expect(app.locator("#btn-analyze")).toBeEnabled();
  mock.setDelay(150);
});

test("no errors in the app page (Content Security Policy included)", async () => {
  // The only expected one: the 401 from testing a wrong key.
  expect(pageErrors.filter((e) => !e.includes("status of 401"))).toEqual([]);
});
