// Service worker: the toolbar badge (quick fit score for the job ad open in a tab), reading job ads from
// any page or file, and the side panel.
import { quickScore, extractJobAd } from "./shared/claude.js";
import { collectPage, looksLikeJobAd, normalizeUrl } from "./shared/collect.js";
import {
  STORE_KEY, SETTINGS_KEY, JOBS_KEY, OPEN_KEY, MAX_JOBS,
  getSettings, getAppState, getJobs, cvMaterial, sha256, composeJd, verdictFor, VERDICT_TEXT, badgeColor,
} from "./shared/store.js";

const MIN_JOB_TEXT = 200; // shorter than this, the description did not load: nothing is scored
const GREY = "#6b7280";

// ---------- Which job each tab shows (kept in session storage so it survives the worker sleeping) ----------
let tabJobs = null; // { [tabId]: jobId }
async function loadTabJobs() {
  if (!tabJobs) tabJobs = (await chrome.storage.session.get("tabJobs")).tabJobs || {};
  return tabJobs;
}
async function setTabJob(tabId, jobId) {
  const t = await loadTabJobs();
  if (jobId) t[tabId] = jobId; else delete t[tabId];
  await chrome.storage.session.set({ tabJobs: t });
}

// ---------- Jobs and their cached scores ----------
// A single writer (this worker) for the jobs map, so concurrent updates are queued here.
let jobsWrite = Promise.resolve();
function updateJobs(fn) {
  jobsWrite = jobsWrite.then(async () => {
    const jobs = await getJobs();
    fn(jobs);
    const ids = Object.keys(jobs);
    if (ids.length > MAX_JOBS) {
      ids.sort((a, b) => (jobs[a].capturedAt || 0) - (jobs[b].capturedAt || 0));
      for (const id of ids.slice(0, ids.length - MAX_JOBS)) delete jobs[id];
    }
    await chrome.storage.local.set({ [JOBS_KEY]: jobs });
  }).catch((e) => console.error("jobs update failed", e));
  return jobsWrite;
}

// ---------- Badge ----------
async function setBadge(tabId, text, color, title) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (color) await chrome.action.setBadgeBackgroundColor({ tabId, color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: "#ffffff" });
    await chrome.action.setTitle({ tabId, title: title || "CV Tailor" });
  } catch { /* the tab is gone */ }
}
const clearBadge = (tabId, title) => setBadge(tabId, "", null, title || "CV Tailor");
function showScore(tabId, s) {
  const verdict = VERDICT_TEXT[s.verdict || verdictFor(s.score)];
  return setBadge(tabId, String(s.score), badgeColor(s.score), `CV Tailor: your CV fits this job ${s.score}/100 (${verdict}). Click to tailor your CV.`);
}

// ---------- Scoring: cached per job id, one call at a time, only the latest job per tab ----------
let lastCv = null; // { text, hash }
async function currentCv() {
  const text = cvMaterial(await getAppState());
  if (!text) return null;
  if (lastCv?.text !== text) lastCv = { text, hash: await sha256(text) };
  return lastCv;
}

const pending = new Map(); // tabId -> { type: "score", jobId } | { type: "extract", page }, newest last
let running = false;

// Decides what the badge of one tab shows, and queues a score when one is needed.
async function evaluate(tabId) {
  const jobId = (await loadTabJobs())[tabId];
  if (!jobId) { pending.delete(tabId); return clearBadge(tabId); }
  const settings = await getSettings();
  if (!settings.autoScore) { pending.delete(tabId); return clearBadge(tabId, "CV Tailor (auto-score is off)"); }
  const cv = await currentCv();
  if (!cv) { pending.delete(tabId); return setBadge(tabId, "CV?", GREY, "CV Tailor: add your CV to see how well it fits this job. Click to open."); }
  if (!settings.apiKey) { pending.delete(tabId); return setBadge(tabId, "KEY", GREY, "CV Tailor: add your Anthropic API key in Settings. Click to open."); }
  const job = (await getJobs())[jobId];
  if (!job || (job.text || "").length < MIN_JOB_TEXT) { pending.delete(tabId); return clearBadge(tabId, "CV Tailor (could not read this job ad)"); }
  if (job.score && job.score.cvHash === cv.hash) { pending.delete(tabId); return showScore(tabId, job.score); }
  await setBadge(tabId, "…", GREY, "CV Tailor: scoring your CV against this job…");
  pending.delete(tabId);
  pending.set(tabId, { type: "score", jobId });
  pump();
}

// One Claude call at a time (finding the ad in a page, or scoring it), newest request first.
async function pump() {
  if (running) return;
  running = true;
  try {
    while (pending.size) {
      const [tabId, task] = [...pending.entries()].pop();
      pending.delete(tabId);
      if (task.type === "extract") await runExtract(tabId, task.page);
      else await runScore(tabId, task.jobId);
    }
  } finally {
    running = false;
  }
}

async function runScore(tabId, jobId) {
  if ((await loadTabJobs())[tabId] !== jobId) return; // the tab moved on
  const settings = await getSettings();
  const cv = await currentCv();
  const job = (await getJobs())[jobId];
  if (!settings.autoScore || !settings.apiKey || !cv || !job) { await evaluate(tabId); return; }
  if (job.score && job.score.cvHash === cv.hash) { await showScore(tabId, job.score); return; } // scored meanwhile
  try {
    const { score, verdict } = await quickScore({ apiKey: settings.apiKey, jd: composeJd(job), cv: cv.text });
    const entry = { score, verdict: verdict || verdictFor(score), cvHash: cv.hash, model: "quick", at: Date.now() };
    await updateJobs((jobs) => { if (jobs[jobId]) jobs[jobId].score = entry; });
    await refreshTabsShowing(jobId);
  } catch (e) {
    if ((await loadTabJobs())[tabId] === jobId) await setBadge(tabId, "!", "#b42318", "CV Tailor: " + (e.message || "the score failed") + " Click to open.");
  }
}

async function refreshTabsShowing(jobId) {
  const t = await loadTabJobs();
  await Promise.all(Object.entries(t).filter(([, id]) => id === jobId).map(([tabId]) => evaluate(Number(tabId))));
}

// Re-evaluates the tabs in front; tabs in the background are evaluated when they are activated.
async function refreshVisibleTabs() {
  const t = await loadTabJobs();
  const active = new Set((await chrome.tabs.query({ active: true })).map((x) => x.id));
  for (const tabId of Object.keys(t).map(Number)) {
    if (active.has(tabId)) evaluate(tabId);
    else { pending.delete(tabId); clearBadge(tabId); }
  }
}

// ---------- Job ads on any other site ----------
const PAGES_KEY = "pages"; // { [pageKey]: { isJobAd, jobId, at } }: what Claude decided about a page's text
const MAX_PAGES = 300;
const tabPages = new Map(); // tabId -> pageKey waiting for Claude's answer

async function storeJob(j) {
  await updateJobs((jobs) => {
    const prev = jobs[j.jobId] || {};
    const text = String(j.text || "").slice(0, 30000);
    // A changed ad text invalidates its score.
    const score = prev.text && prev.text !== text ? null : prev.score || null;
    jobs[j.jobId] = { jobId: j.jobId, url: String(j.url || ""), title: String(j.title || ""), company: String(j.company || ""), location: String(j.location || ""), text, capturedAt: Date.now(), score };
  });
}

async function pageJobId(c) {
  if (c.gdocId) return "gdoc:" + c.gdocId;
  if (c.driveFileId) return "drive:" + c.driveFileId;
  return "web:" + (await sha256(normalizeUrl(c.url))).slice(0, 16);
}

// Reading files (PDF, DOCX) needs a DOM, which the worker does not have: an offscreen document does it.
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length) return;
  try {
    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["DOM_PARSER"], justification: "Read the text of PDF and DOCX job ads." });
  } catch (e) {
    if (!/single offscreen/i.test(String(e?.message))) throw e;
  }
}
function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const MAX_FILE = 15 * 1024 * 1024;

// Downloads a file (with the browser's cookies, so private documents work) and returns its text.
// { text } for a readable PDF, DOCX or text file; { scanned: true } for a PDF without text; null otherwise.
async function readUrl(url) {
  if (!/^(https?|file):/i.test(url || "")) return null;
  let res;
  try { res = await fetch(url, { credentials: "include" }); } catch { return null; }
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") || "").toLowerCase();
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_FILE) return null;
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  let kind = null;
  if (head === "%PDF-") kind = "pdf";
  else if (head.startsWith("PK") && (type.includes("wordprocessingml") || /\.docx(\?|$)/i.test(url) || type.includes("octet-stream"))) kind = "docx";
  else if (type.startsWith("text/plain")) return { text: new TextDecoder().decode(bytes).trim() };
  if (!kind) return null;
  await ensureOffscreen();
  const out = await chrome.runtime.sendMessage({ target: "offscreen", type: "read-file", kind, data: toBase64(bytes) });
  if (!out?.ok) return null;
  if (kind === "pdf" && out.text.replace(/\s/g, "").length < 150) return { scanned: true, url };
  return { text: out.text };
}

// The text of a collected page, fetching what the page itself could not give (Google Docs, Drive, PDFs).
async function resolveText(c) {
  let text = c.text || "", scannedPdfUrl = null;
  const useFile = async (url) => {
    const f = await readUrl(url);
    if (f?.text) text = f.text;
    else if (f?.scanned) scannedPdfUrl = f.url;
    return !!f;
  };
  if (c.gdocId && !c.gdocText) {
    const f = await readUrl(`https://docs.google.com/document/d/${c.gdocId}/export?format=txt`);
    if (f?.text) text = f.text;
  }
  if (c.driveFileId) await useFile(`https://drive.google.com/uc?export=download&id=${c.driveFileId}`);
  if (text.length < 400 && !scannedPdfUrl) for (const u of c.pdfUrls || []) if (await useFile(u)) break;
  return { text, scannedPdfUrl };
}

async function prunePages(pages) {
  const keys = Object.keys(pages);
  if (keys.length <= MAX_PAGES) return pages;
  keys.sort((a, b) => pages[a].at - pages[b].at);
  for (const k of keys.slice(0, keys.length - MAX_PAGES)) delete pages[k];
  return pages;
}

// A page seen by the content script (or a PDF tab): is it a job ad, and if so, what does it score?
async function handleWebPage(tabId, c) {
  const unset = async () => { tabPages.delete(tabId); pending.delete(tabId); await setTabJob(tabId, null); await clearBadge(tabId); };
  const settings = await getSettings();
  if (!settings.autoScore) return unset();
  const jobId = await pageJobId(c);
  if (c.jsonld) { // a job ad published in the standard format: no need to ask Claude what it is
    tabPages.delete(tabId);
    await storeJob({ jobId, url: c.url, ...c.jsonld });
    await setTabJob(tabId, jobId);
    return evaluate(tabId);
  }
  const { text } = await resolveText(c);
  if (!looksLikeJobAd({ url: c.url, text })) return unset();
  const key = "p:" + (await sha256(normalizeUrl(c.url) + "\n" + text)).slice(0, 24);
  const known = ((await chrome.storage.local.get(PAGES_KEY))[PAGES_KEY] || {})[key];
  if (known) {
    if (known.isJobAd && (await getJobs())[known.jobId]) { tabPages.delete(tabId); await setTabJob(tabId, known.jobId); return evaluate(tabId); }
    return unset();
  }
  // Claude is asked only when the answer can be used: auto-score on, a key and a CV.
  if (!settings.apiKey || !(await currentCv())) return unset();
  await setTabJob(tabId, null);
  tabPages.set(tabId, key);
  await setBadge(tabId, "…", GREY, "CV Tailor: reading this page…");
  pending.delete(tabId);
  pending.set(tabId, { type: "extract", page: { key, jobId, url: c.url, title: c.title, text } });
  pump();
}

async function runExtract(tabId, page) {
  if (tabPages.get(tabId) !== page.key) return; // the tab moved on
  const settings = await getSettings();
  if (!settings.autoScore || !settings.apiKey) { tabPages.delete(tabId); return clearBadge(tabId); }
  let found;
  try {
    found = await extractJobAd({ apiKey: settings.apiKey, url: page.url, title: page.title, text: page.text });
  } catch (e) {
    if (tabPages.get(tabId) === page.key) await setBadge(tabId, "!", "#b42318", "CV Tailor: " + (e.message || "reading the page failed") + " Click to open.");
    return;
  }
  const pages = (await chrome.storage.local.get(PAGES_KEY))[PAGES_KEY] || {};
  pages[page.key] = { isJobAd: found.isJobAd, jobId: page.jobId, at: Date.now() };
  await chrome.storage.local.set({ [PAGES_KEY]: await prunePages(pages) });
  if (found.isJobAd) await storeJob({ jobId: page.jobId, url: page.url, title: found.title, company: found.company, location: found.location, text: found.text });
  if (tabPages.get(tabId) !== page.key) return;
  tabPages.delete(tabId);
  if (!found.isJobAd) return clearBadge(tabId);
  await setTabJob(tabId, page.jobId);
  await evaluate(tabId);
}

// The toolbar button on a page that is not a known job ad: read whatever the tab shows.
async function readTab(tabId) {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return { error: "The tab is closed." }; }
  const url = tab.url || "";
  if (!/^(https?|file):/i.test(url)) return { error: "This page can't be read: browsers don't let extensions read their own pages or the extension store." };
  let c = null;
  try { c = (await chrome.scripting.executeScript({ target: { tabId }, func: collectPage }))[0]?.result || null; } catch { /* e.g. Chrome's PDF viewer */ }
  if (!c) c = { url, title: tab.title || "", text: "", jsonld: null, gdocId: null, gdocText: false, driveFileId: null, pdfUrls: [url] };
  const jobId = await pageJobId(c);
  if (c.jsonld) return { jobId, url: c.url, structured: { ...c.jsonld } };
  const { text, scannedPdfUrl } = await resolveText(c);
  if (!text.trim() && !scannedPdfUrl) return { error: "No text could be read from this page." };
  return { jobId, url: c.url, title: c.title, text, scannedPdfUrl };
}

// PDF tabs: Chrome's PDF viewer runs no content scripts, so the worker reads the file itself.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url) return;
  let path = "";
  try { path = new URL(tab.url).pathname; } catch { return; }
  if (!/\.pdf$/i.test(path)) return;
  handleWebPage(tabId, { url: tab.url, title: tab.title || "", text: "", jsonld: null, gdocId: null, gdocText: false, driveFileId: null, pdfUrls: [tab.url] }).catch((e) => console.error(e));
});

// ---------- Messages from the content scripts and the app ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id;
    if (msg?.target === "offscreen") return; // for the offscreen document
    if (msg?.type === "job-page" && tabId != null && msg.job?.jobId) {
      await storeJob(msg.job);
      await setTabJob(tabId, msg.job.jobId);
      await evaluate(tabId);
    } else if (msg?.type === "web-page" && tabId != null && msg.page) {
      await handleWebPage(tabId, msg.page);
    } else if (msg?.type === "not-job" && tabId != null) {
      tabPages.delete(tabId);
      await setTabJob(tabId, null);
      pending.delete(tabId);
      await clearBadge(tabId);
    } else if (msg?.type === "read-tab" && msg.tabId != null) {
      sendResponse(await readTab(msg.tabId));
      return;
    } else if (msg?.type === "store-job" && msg.job?.jobId) {
      // A job ad the user took from a page with the toolbar button.
      await storeJob(msg.job);
      if (msg.tabId != null) { await setTabJob(msg.tabId, msg.job.jobId); await evaluate(msg.tabId); }
    } else if (msg?.type === "app-score" && msg.jobId) {
      // The app's full analysis (Opus) of the same ad and CV replaces the quick score.
      const score = Math.max(0, Math.min(100, Math.round(Number(msg.score))));
      if (Number.isFinite(score) && msg.cvHash) {
        await updateJobs((jobs) => {
          if (jobs[msg.jobId]) jobs[msg.jobId].score = { score, verdict: msg.verdict || verdictFor(score), cvHash: msg.cvHash, model: "full", at: Date.now() };
        });
        await refreshTabsShowing(msg.jobId);
      }
    }
    sendResponse({ ok: true });
  })().catch((e) => { console.error(e); sendResponse({ ok: false }); });
  return msg?.target !== "offscreen";
});

chrome.tabs.onRemoved.addListener(async (tabId) => { pending.delete(tabId); tabPages.delete(tabId); await setTabJob(tabId, null); });
chrome.tabs.onActivated.addListener(async ({ tabId }) => { if ((await loadTabJobs())[tabId]) evaluate(tabId); });

// A new CV or changed settings change every badge.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes[SETTINGS_KEY]) { await refreshVisibleTabs(); return; }
  if (changes[STORE_KEY]) {
    const before = lastCv?.hash ?? null;
    const now = (await currentCv())?.hash ?? null;
    if (before !== now) await refreshVisibleTabs();
  }
});

// ---------- The app, in the browser's side panel ----------
// The panel has to be opened while Chrome still counts the toolbar click as a user gesture, so it is
// opened first, before anything is awaited. The app then picks up the job from OPEN_KEY (on load, or
// through storage.onChanged when the panel is already open).
function openAppForTab(tab) {
  const opened = tab?.windowId != null
    ? chrome.sidePanel.open({ windowId: tab.windowId }).catch((e) => console.error("side panel", e))
    : Promise.resolve();
  const requested = (async () => {
    const jobId = tab?.id != null ? (await loadTabJobs())[tab.id] || null : null;
    await chrome.storage.local.set({ [OPEN_KEY]: { jobId, tabId: tab?.id ?? null, at: Date.now() } });
  })();
  return Promise.all([opened, requested]);
}
chrome.action.onClicked.addListener((tab) => { openAppForTab(tab); });

// Exposed for the automated tests (they cannot click the toolbar button).
globalThis.cvTailor = { openAppForTab, evaluate, readUrl, readTab };
