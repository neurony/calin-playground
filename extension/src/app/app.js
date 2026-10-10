// CV Tailor app, running as an extension page. Port of artifact/cv-tailor.template.html:
// window.claude.use("sample") -> Anthropic API with the user's key, use("downloads") -> a normal
// download, localStorage -> chrome.storage.local (shared with the service worker).
import { callMain, callMainJson, testKey, toClaudeError, ERROR_TEXT } from "../shared/claude.js";
import {
  STORE_KEY, SETTINGS_KEY, JOBS_KEY, OPEN_KEY, DEFAULT_SETTINGS,
  getSettings, getJobs, cvMaterial, sha256, composeJd, VERDICT_TEXT as QUICK_VERDICT_TEXT,
} from "../shared/store.js";

(async () => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // ---------- Example data (clearly marked as an example in the UI) ----------
  const EXAMPLE = {
    jd: `Senior Backend Engineer – Payments (Bucharest, hybrid)

We build the payments platform for merchants across Central and Eastern Europe.

Responsibilities:
- Build and run backend services in Java / Spring Boot
- Design REST APIs used by our mobile apps and partners
- Work with our AWS infrastructure (ECS, RDS) and CI/CD pipelines
- Mentor less experienced engineers through code review and pairing

Requirements:
- 5+ years with Java and Spring
- Experience with relational databases (PostgreSQL)
- Experience with AWS
- Kubernetes is a plus
- Professional English`,
    cv: `John Example
john@example.com · +40 700 000 000 · Bucharest · linkedin.com/in/john-example

EXPERIENCE
Senior Software Engineer – Example Fintech, Bucharest (03/2021 – present)
- Built payment processing APIs in Spring Boot
- Moved three services from the data centre to AWS (ECS, RDS), pipelines in GitHub Actions
- Code review and onboarding for two junior colleagues
- Took part in sprint planning

Software Engineer – Example Retail, Cluj-Napoca (2017 – 2021)
- Maintained the stock management system (Java 8, PostgreSQL)
- Internal Excel reports for the sales team
- Optimised slow SQL queries

EDUCATION
BSc Computer Science – Babeș-Bolyai University, Cluj-Napoca (2013 – 2017)

CERTIFICATIONS
AWS Certified Developer – Associate (2022)

LANGUAGES
Romanian – native; English – C1`,
    extra: `At Example Fintech I was on call one week a month for the payment services.
I wrote the internal documentation for the refund API.`,
  };

  // ---------- State ----------
  const freshState = () => ({
    jd: EXAMPLE.jd, cvText: EXAMPLE.cv, extra: EXAMPLE.extra, lang: "en", isExample: true,
    cvFile: null,            // {name, text}: text extracted from the uploaded CV
    questions: null,         // [{requirement, kind, why, question, previousId, reuse, answer, none}]
    questionsSkipped: false,
    match: null,             // {score, verdict, summary} for the original CV
    memory: [],              // answers kept across roles: [{id, requirement, question, answer, none, updatedAt}]
    result: null,            // the tailored CV being edited (also stored in history)
    currentId: null,         // history id of `result`
    history: [],             // [{id, role, company, createdAt, updatedAt, result}]
    template: "classic",
    showSources: false,
    linkedin: null,          // {jobId, url, title, company, jdText}: the LinkedIn ad the job description came from
  });
  let state = freshState();

  async function load() {
    try {
      const got = await chrome.storage.local.get(STORE_KEY);
      if (got[STORE_KEY]) state = { ...state, ...got[STORE_KEY] };
    } catch { /* storage unavailable */ }
  }
  let saveTimer;
  function flush() {
    clearTimeout(saveTimer);
    syncHistoryEntry();
    chrome.storage.local.set({ [STORE_KEY]: JSON.parse(JSON.stringify(state)) }).catch(() => {
      setStatus("reset-status", "The extension could not save your data. Delete some saved CVs and try again.", true);
    });
  }
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); }
  window.addEventListener("pagehide", flush);

  // ---------- Views ----------
  const VIEWS = ["input", "questions", "result", "history", "settings"];
  function showView(which) {
    if (which === "result" && !state.result) which = state.questions ? "questions" : "input";
    if (which === "questions" && !state.questions) which = "input";
    for (const v of VIEWS) {
      $("view-" + v).hidden = v !== which;
      $("tab-" + v).setAttribute("aria-selected", String(v === which));
    }
    $("tab-questions").disabled = !state.questions;
    $("tab-result").disabled = !state.result;
    $("history-count").textContent = state.history.length ? `(${state.history.length})` : "";
    if (which === "history") renderHistory();
    if (which === "settings") renderSettings();
    renderKeyBanner();
    if (which === "input") renderLinkedin();
    if (which === "result") schedulePreview(0);
  }
  for (const v of VIEWS) $("tab-" + v).onclick = () => showView(v);
  $("btn-q-back").onclick = () => showView("input");

  function setStatus(id, html, isErr) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = html;
    el.classList.toggle("err", !!isErr);
  }

  // ---------- Input form ----------
  function syncInputs() {
    $("jd").value = state.jd;
    $("cv-text").value = state.cvText;
    $("extra").value = state.extra;
    $("lang").value = state.lang;
    $("template").value = state.template;
    $("show-sources").checked = state.showSources;
    $("legend").hidden = !state.showSources;
    $("example-note").hidden = !state.isExample;
    if (state.cvFile) {
      setFileStatus("file-status", `✓ ${state.cvFile.name}: ${state.cvFile.text.length.toLocaleString("en")} characters read`, "ok");
      $("btn-remove-file").hidden = false;
    } else {
      setFileStatus("file-status", "No file uploaded. You can drop the file here.");
      $("btn-remove-file").hidden = true;
    }
  }
  for (const [id, key] of [["jd", "jd"], ["cv-text", "cvText"], ["extra", "extra"]]) {
    $(id).addEventListener("input", (e) => {
      state[key] = e.target.value;
      // Once the CV is no longer the example's, it is the candidate's (the toolbar score uses it).
      if (key === "cvText" && state.isExample && state.cvText !== EXAMPLE.cv) { state.isExample = false; $("example-note").hidden = true; }
      save();
      if (key === "cvText") renderLinkedin();
    });
  }
  $("lang").addEventListener("change", (e) => { state.lang = e.target.value; save(); });

  // ---------- File reading ----------
  const ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
  function setFileStatus(id, text, cls) {
    const el = $(id);
    el.textContent = text;
    el.className = "file-status " + (cls || "muted");
  }
  async function loadPdf(buffer) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error("pdf.js unavailable");
    lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.js");
    return lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  }
  async function pdfText(doc) {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      let out = "", lastY = null;
      for (const item of content.items) {
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) out += "\n";
        else if (out && !out.endsWith(" ") && !out.endsWith("\n")) out += " ";
        out += item.str;
        if (item.hasEOL) out += "\n";
        lastY = y;
      }
      pages.push(out);
    }
    return pages.join("\n\n");
  }
  // Scanned PDFs have no text layer: render the pages to images and let Claude transcribe them.
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  async function transcribeScannedPdf(doc, onStatus) {
    if (!settings.apiKey) throw new Error("Reading scanned PDFs needs Claude: add your API key in Settings.");
    const maxPages = Math.min(doc.numPages, 8);
    const images = [];
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.2, 1600 / base.width) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push(await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85)));
    }
    onStatus(`This looks like a scanned PDF. Claude is reading ${maxPages} page${maxPages > 1 ? "s" : ""}…`);
    const content = [];
    for (const blob of images) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobToBase64(blob) } });
    content.push({ type: "text", text: "These images are the pages of a document (a CV or a job description). Transcribe all of its text exactly as written, in reading order, keeping headings, line breaks and bullet points. Do not summarise, translate, correct or add anything. Reply with the transcription only." });
    return callMain({ apiKey: settings.apiKey, content, effort: "low" });
  }
  // Returns the file's text, or throws an error whose message is shown to the viewer.
  async function extractText(file, onStatus) {
    if (file.size > 15 * 1024 * 1024) throw new Error("The file is larger than 15 MB.");
    const name = file.name.toLowerCase();
    let text = "";
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      let doc;
      try { doc = await loadPdf(await file.arrayBuffer()); } catch { throw new Error("Could not read this PDF."); }
      text = await pdfText(doc);
      if (text.replace(/\s/g, "").length < 150) text = await transcribeScannedPdf(doc, onStatus);
    } else if (name.endsWith(".docx")) {
      try { text = (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value; }
      catch { throw new Error("Could not read this DOCX file."); }
    } else if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
      text = await file.text();
    } else {
      throw new Error("Unsupported format. Use PDF, DOCX or TXT.");
    }
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw new Error("No text found in the file.");
    return text;
  }
  function errorText(e) {
    if (e && e.code) return ERRORS[e.code] || e.message || "Something went wrong.";
    return (e && e.message) || "Something went wrong.";
  }
  function wireDrop(dropId, inputId, onFile) {
    const drop = $(dropId);
    $(inputId).accept = ACCEPT;
    $(inputId).addEventListener("change", (e) => e.target.files[0] && onFile(e.target.files[0]));
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault(); drop.classList.remove("over");
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    });
  }

  // CV file: its text is kept (and saved) separately from the pasted CV text; both are used.
  async function readCvFile(file) {
    setFileStatus("file-status", "Reading " + file.name + "…");
    try {
      const text = await extractText(file, (msg) => setFileStatus("file-status", msg));
      state.cvFile = { name: file.name, text };
      state.isExample = false;
      flush();
      syncInputs();
      renderLinkedin();
    } catch (e) {
      setFileStatus("file-status", errorText(e) + " You can paste your CV as text.", "err");
    } finally {
      $("cv-file").value = "";
    }
  }
  wireDrop("drop", "cv-file", readCvFile);
  $("btn-remove-file").onclick = () => { state.cvFile = null; flush(); syncInputs(); };

  // JD file: its text goes into the job description box, where it can be checked and edited.
  async function readJdFile(file) {
    setFileStatus("jd-file-status", "Reading " + file.name + "…");
    try {
      const text = await extractText(file, (msg) => setFileStatus("jd-file-status", msg));
      state.jd = text;
      state.isExample = false;
      $("jd").value = text;
      $("example-note").hidden = true;
      flush();
      setFileStatus("jd-file-status", `✓ The text from ${file.name} is in the box below. Check it and fix anything that looks off.`, "ok");
    } catch (e) {
      setFileStatus("jd-file-status", errorText(e) + " You can paste the job description as text.", "err");
    } finally {
      $("jd-file").value = "";
    }
  }
  wireDrop("jd-drop", "jd-file", readJdFile);

  // ---------- Prompts ----------
  const RULES = `You tailor CVs to a specific job description. You work for the candidate, and the CV you produce will be sent to a real recruiter under the candidate's name, so it has to be both truthful and pleasant to read.

## Truthfulness comes first
Everything in the CV must be traceable to the candidate's source material (their CV, their answers to clarifying questions and the extra information they typed). The job description tells you what to emphasise; it is never a source of facts about the candidate.
- Do not invent employers, job titles, dates, degrees, certifications, tools, technologies, responsibilities, numbers, team sizes or achievements.
- Do not upgrade claims: "used" stays "used", "contributed to" does not become "led", and a technology mentioned once in passing does not become an area of expertise.
- Do not add a skill because the job asks for it. If a requirement is not supported by the source material, list it under analysis.gaps and leave it out of the CV.
- Metrics may only appear if they appear in the source material.
- You may rephrase, reorder and regroup. You may use the job description's terminology for something the candidate genuinely did when it describes the same thing.
- Keep names, companies, dates and education exactly as given. If a detail is missing, leave the field as an empty string rather than guessing.
- When unsure whether a stronger phrasing is supported, stay close to the source's wording.

## Keep everything from the original CV
The tailored CV is the candidate's complete CV, re-focused on this job. It is not a shortlist of the relevant parts.
- Keep every role, project, degree, certification, language, link and contact detail from the source material.
- Keep every responsibility and achievement. Each item in the original must still be in the tailored CV: reworded, moved or merged with an item that says the same thing, but never dropped, even when it is irrelevant to this job.
- Keep every skill and technology the candidate listed. Regroup and reorder them freely; do not remove any.
- Put information from the candidate's answers and extra notes into the matching role or section, next to the original content.
- Merge only true duplicates (the same fact stated twice).
- Before you answer, go through the source material item by item and check that each one appears in the tailored CV.

## How to emphasise
Emphasis comes from order, wording and detail, never from removing content.
- Work out what the employer cares about most.
- Keep the work history in the original (reverse chronological) order.
- Within each role, put the items most relevant to this job first and phrase them so the relevance is easy to see. Where the source material gives more detail about relevant work, use that detail. Less relevant items stay, after the relevant ones.
- Order skill groups, and skills within each group, so the ones the job asks for come first.
- Write a short summary (2-4 sentences) that connects who the candidate really is to what this role needs.
- The headline may point toward the target role only as far as the candidate's real titles and experience support it.
- Include all projects, certifications and languages from the source material; return an empty array only when the source has none.

## Voice: make it sound like a person wrote it
- Plain, specific, confident language. Concrete over abstract: what was built, for whom, with what, and what changed.
- Avoid CV clichés and filler: "results-driven", "passionate", "dynamic", "proven track record", "synergy", "detail-oriented professional", "leveraged", "spearheaded", "utilised", and their equivalents in other languages.
- Vary sentence openings and verbs. Avoid overusing em dashes.
- Bullets are one or two lines each.
- No third-person "he/she" in the summary, and do not overuse "I".
- Use correct diacritics for languages that have them.`;

  const SOURCES_RULE = `For every bullet, say where it comes from in "source":
- "original": the candidate's CV, essentially unchanged;
- "rephrased": the candidate's CV, reworded or merged;
- "answers": the candidate's answers to the clarifying questions;
- "extra": the candidate's extra information.`;

  const TIPS_RULE = `Also write "tips": one short, specific piece of advice per section on how the candidate could make that section stronger for this job, based on what is actually in their CV (e.g. "Your AWS migration bullet has no outcome. If you know how much downtime or cost changed, add it."). A tip may only suggest adding things the candidate may really have; it must never suggest claiming anything untrue. Use an empty string when you have nothing useful to say for a section. One tip per role in "experience", in the same order as cv.experience.`;

  function languageLine(lang) {
    if (lang === "ro") return "Write the CV, the analysis, the tips and the labels in Romanian.";
    if (lang === "auto") return "Write the CV, the analysis, the tips and the labels in the same language as the job description.";
    return "Write the CV, the analysis, the tips and the labels in English.";
  }
  function questionLanguageLine(lang) {
    if (lang === "ro") return "Write the summary and the questions in Romanian.";
    if (lang === "auto") return "Write the summary and the questions in the same language as the job description.";
    return "Write the summary and the questions in English.";
  }

  // Everything the candidate provided (without the job description).
  function candidateBlocks() {
    const parts = [];
    if (state.cvFile) parts.push("", `<candidate_cv source="${state.cvFile.name.replace(/"/g, "")}">`, state.cvFile.text, "</candidate_cv>");
    if (state.cvText.trim()) parts.push("", "<candidate_cv_text>", state.cvText.trim(), "</candidate_cv_text>");
    if (state.extra.trim()) parts.push("", "<candidate_extra_information>", "Additional information the candidate wrote about their experience. Equally valid source material.", state.extra.trim(), "</candidate_extra_information>");
    return parts;
  }
  function sourceBlocks() {
    return ["<job_description>", state.jd.trim(), "</job_description>", ...candidateBlocks()];
  }

  function answeredQuestions() {
    return (state.questions || []).filter((q) => q.none || q.answer.trim());
  }
  function answersBlock() {
    const qs = answeredQuestions();
    if (!qs.length) return [];
    const parts = ["", "<candidate_answers>",
      "The candidate's answers to clarifying questions about the job's requirements. They are source material written by the candidate, as valid as the CV: put what they say into the matching role or section. Where the candidate says they have no such experience, the requirement stays a gap and nothing about it goes into the CV."];
    for (const q of qs) {
      parts.push("", `Requirement: ${q.requirement}`, `Question: ${q.question}`,
        `Answer: ${q.none ? "I don't have experience with this." : q.answer.trim()}`);
    }
    parts.push("</candidate_answers>");
    return parts;
  }

  const QUESTION_RULES = `You help a candidate prepare a CV tailored to a job description. Before the CV is written, you (1) tell the candidate honestly how well their real experience fits the job, and (2) ask about requirements their material does not show, so the CV can include real experience they forgot to mention.

## Fit
Score from 0 to 100 how well the candidate's real experience, as shown in their material, matches the job's requirements. Weigh must-have requirements much more than nice-to-haves. Be honest; do not inflate.
- "strong" (about 75+): good fit; tailoring will mainly sharpen the emphasis.
- "partial" (about 45-74): worth tailoring; answering the questions may close some gaps.
- "weak" (below about 45): important must-haves are missing; tailoring cannot add experience the candidate does not have, so they should think about whether to apply.
Write a 1-2 sentence summary that says plainly whether tailoring is worth it and why, naming the main strengths and the main missing must-haves.

## Questions
Compare the job description (must-have requirements first, then responsibilities, then nice-to-haves) with the candidate's material, and find:
- missing: requirements with no evidence at all in the candidate's material;
- weak: requirements with thin evidence, e.g. a technology listed without context, or unclear depth, duration, scale, ownership or results.
Then write the questions:
- 3 to 8 questions, most important requirement first. One topic per question. Skip anything the material already shows clearly.
- Make each question specific and answerable in one to three sentences. Refer to the candidate's real roles where it helps.
- Ask for concrete facts: what, where, when, which tools, at what scale, with what result.
- Never assume the candidate has the experience, and make it easy to say no. No leading questions.
- Do not ask about personal data (age, family, health), salary or availability.
- Plain, friendly wording, addressing the candidate directly.`;

  function previousAnswersBlock() {
    if (!state.memory.length) return [];
    const parts = ["", "<previous_answers>",
      "Answers the candidate gave to questions for other jobs. If one of your questions is about the same thing as a previous answer, still ask it, and set \"previous\" to that answer's number so the candidate can simply confirm it is still accurate. Otherwise set \"previous\" to null. Do not treat these answers as confirmed facts when scoring."];
    state.memory.forEach((m, i) => {
      parts.push("", `[${i + 1}] Requirement: ${m.requirement}`, `Question: ${m.question}`,
        `Answer: ${m.none ? "I don't have experience with this." : m.answer}`);
    });
    parts.push("</previous_answers>");
    return parts;
  }

  function buildQuestionsPrompt() {
    return [QUESTION_RULES, "", ...sourceBlocks(), ...previousAnswersBlock(), "", questionLanguageLine(state.lang), "",
      `Reply with ONLY one JSON object, no prose, with exactly this shape:
{"match": {"score": 0, "verdict": "strong" | "partial" | "weak", "summary": "1-2 sentences"},
 "questions": [{"requirement": "short name of the job requirement", "kind": "missing" | "weak", "why": "one sentence: what is missing or unclear in the candidate's material", "question": "the question for the candidate", "previous": null}]}
If the material already covers every requirement well, return an empty "questions" array.`].join("\n");
  }

  const CV_SHAPE = `"cv": {
    "name": "", "headline": "",
    "contact": { "email": "", "phone": "", "location": "", "links": [""] },
    "summary": "",
    "experience": [{ "title": "", "company": "", "location": "", "startDate": "", "endDate": "", "description": "", "bullets": [{ "text": "", "source": "original" }] }],
    "projects": [{ "name": "", "description": "", "bullets": [{ "text": "", "source": "original" }] }],
    "education": [{ "degree": "", "institution": "", "location": "", "startDate": "", "endDate": "", "details": "" }],
    "skills": [{ "category": "", "items": [""] }],
    "certifications": [""],
    "languages": [{ "language": "", "level": "" }]
  }`;
  const TIPS_SHAPE = `"tips": { "header": "", "summary": "", "experience": [""], "projects": "", "skills": "", "education": "", "certifications": "", "languages": "" }`;

  function buildPrompt() {
    const parts = [RULES, "", SOURCES_RULE, "", TIPS_RULE, "", ...sourceBlocks(), ...answersBlock()];
    parts.push("", languageLine(state.lang), "Tailor the candidate's CV to this job description, following the rules above. Keep all of the candidate's content and only use facts from the candidate's material.", "",
      `Reply with ONLY one JSON object, no prose, with exactly this shape (all fields required; use "" or [] when empty):
{
  ${CV_SHAPE},
  "target": { "role": "the job title from the job description", "company": "the hiring company, or an empty string if not named" },
  "analysis": {
    "matched": [{ "requirement": "JD requirement", "evidence": "where in the candidate's material it is supported" }],
    "gaps": ["JD requirement with no support in the candidate's material"],
    "notes": "1-3 sentences: what you emphasised and how",
    "matchAfter": 0
  },
  ${TIPS_SHAPE},
  "labels": { "summary": "", "experience": "", "projects": "", "education": "", "skills": "", "certifications": "", "languages": "" }
}
"matchAfter" is a 0-100 fit score (weighing must-haves most) judged on the tailored CV: how clearly it now shows the candidate's real fit. It can only rise because real evidence became visible (from answers, extra information or clearer wording), never because of invented content.
"labels" are the section headings in the CV's language (e.g. English: Profile, Experience, Projects, Education, Skills, Certifications, Languages).`);
    return parts.join("\n");
  }

  // Plain-text rendering of a CV, for the completeness check.
  function cvToText(cv) {
    const out = [cv.name, cv.headline, [cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links].filter(Boolean).join(" | "), "", cv.summary, ""];
    for (const j of cv.experience) {
      out.push(`${j.title} – ${j.company}, ${j.location} (${j.startDate} – ${j.endDate})`);
      if (j.description) out.push(j.description);
      j.bullets.forEach((b) => out.push("- " + b));
      out.push("");
    }
    for (const p of cv.projects) { out.push(`Project: ${p.name}`, p.description); p.bullets.forEach((b) => out.push("- " + b)); out.push(""); }
    for (const e of cv.education) out.push(`${e.degree} – ${e.institution}, ${e.location} (${e.startDate} – ${e.endDate}) ${e.details}`);
    for (const s of cv.skills) out.push(`${s.category}: ${s.items.join(", ")}`);
    if (cv.certifications.length) out.push("Certifications: " + cv.certifications.join("; "));
    if (cv.languages.length) out.push("Languages: " + cv.languages.map((l) => `${l.language} (${l.level})`).join(", "));
    return out.join("\n");
  }

  function buildCheckPrompt() {
    return [`You check a tailored CV for lost information. The tailored CV was rewritten from the candidate's original material (their CV and extra information) and must still contain every role, responsibility, achievement, project, degree, certification, skill, language, link and contact detail from it. Items may be reworded, merged with an item that says the same thing, moved or translated; those count as present. Only report items whose information is genuinely missing from the tailored CV.`,
      ...candidateBlocks(),
      "", "<tailored_cv>", cvToText(state.result.cv), "</tailored_cv>", "",
      `Reply with ONLY one JSON object: {"missing": [{"item": "the missing information, quoted or closely paraphrased from the original", "section": "the section it belongs to"}]}. Use an empty array when nothing is missing. Write in the same language as the tailored CV.`].join("\n");
  }

  function buildRepairPrompt(missing) {
    return [RULES, "", SOURCES_RULE, "", ...sourceBlocks(), ...answersBlock(), "",
      "<current_tailored_cv>", JSON.stringify(exportCv(state.result.cv)), "</current_tailored_cv>", "",
      "<missing_items>", ...missing.map((m) => `- ${m.item} (${m.section})`), "</missing_items>", "",
      `The current tailored CV lost the items listed above. Return the same CV with those items put back in the right place, phrased to fit the job where that is truthful. Change nothing else.`,
      languageLine(state.lang), "",
      `Reply with ONLY one JSON object: { ${CV_SHAPE} }`].join("\n");
  }

  const SECTION_SHAPES = {
    summary: `{"summary": "", "tip": ""}`,
    role: `{"role": { "title": "", "company": "", "location": "", "startDate": "", "endDate": "", "description": "", "bullets": [{ "text": "", "source": "original" }] }, "tip": ""}`,
    skills: `{"skills": [{ "category": "", "items": [""] }], "tip": ""}`,
    projects: `{"projects": [{ "name": "", "description": "", "bullets": [{ "text": "", "source": "original" }] }], "tip": ""}`,
    education: `{"education": [{ "degree": "", "institution": "", "location": "", "startDate": "", "endDate": "", "details": "" }], "tip": ""}`,
  };
  function buildSectionPrompt(kind, current, instruction) {
    return [RULES, "", SOURCES_RULE, "", ...sourceBlocks(), ...answersBlock(), "",
      "<full_tailored_cv_for_context>", JSON.stringify(exportCv(state.result.cv)), "</full_tailored_cv_for_context>", "",
      `<section_to_rewrite kind="${kind}">`, JSON.stringify(current), "</section_to_rewrite>", "",
      instruction.trim() ? `The candidate's instruction for this rewrite: "${instruction.trim()}". Follow it only as far as the rules above allow.` : "Rewrite this section so it shows the candidate's fit for this job more clearly.",
      "Rewrite only this section. Keep all of its content (every item stays). Also write a short tip for this section: specific, based on the CV, never suggesting anything untrue; an empty string if you have none.",
      languageLine(state.lang), "",
      `Reply with ONLY one JSON object with exactly this shape: ${SECTION_SHAPES[kind]}`].join("\n");
  }

  // ---------- Normalisation (the model's JSON is checked, not trusted) ----------
  const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const strs = (v) => arr(v).map(str);
  const SOURCES = ["original", "rephrased", "answers", "extra", "edited"];
  function normBullets(list) {
    const bullets = [], bulletSources = [];
    for (const b of arr(list)) {
      const text = typeof b === "string" ? b : str(b?.text);
      if (!text.trim()) continue;
      bullets.push(text);
      bulletSources.push(SOURCES.includes(b?.source) ? b.source : "rephrased");
    }
    return { bullets, bulletSources };
  }
  const normRole = (e) => ({ title: str(e?.title), company: str(e?.company), location: str(e?.location), startDate: str(e?.startDate), endDate: str(e?.endDate), description: str(e?.description), ...normBullets(e?.bullets) });
  const normProject = (p) => ({ name: str(p?.name), description: str(p?.description), ...normBullets(p?.bullets) });
  const normEducation = (e) => ({ degree: str(e?.degree), institution: str(e?.institution), location: str(e?.location), startDate: str(e?.startDate), endDate: str(e?.endDate), details: str(e?.details) });
  const normSkills = (list) => arr(list).map((s) => ({ category: str(s?.category), items: strs(s?.items).filter((x) => x.trim()) })).filter((s) => s.items.length);
  function normCv(cv) {
    cv = cv && typeof cv === "object" ? cv : {};
    const c = cv.contact && typeof cv.contact === "object" ? cv.contact : {};
    return {
      name: str(cv.name), headline: str(cv.headline),
      contact: { email: str(c.email), phone: str(c.phone), location: str(c.location), links: strs(c.links).filter((x) => x.trim()) },
      summary: str(cv.summary),
      experience: arr(cv.experience).map(normRole),
      projects: arr(cv.projects).map(normProject).filter((p) => p.name.trim() || p.description.trim()),
      education: arr(cv.education).map(normEducation),
      skills: normSkills(cv.skills),
      certifications: strs(cv.certifications).filter((x) => x.trim()),
      languages: arr(cv.languages).map((x) => ({ language: str(x?.language), level: str(x?.level) })).filter((x) => x.language.trim()),
    };
  }
  // The CV in the model's shape (bullets with sources), for prompts.
  function exportCv(cv) {
    const bul = (o) => o.bullets.map((text, i) => ({ text, source: o.bulletSources?.[i] || "rephrased" }));
    const strip = (o) => { const { bulletSources, ...rest } = o; return { ...rest, bullets: bul(o) }; };
    return { ...cv, experience: cv.experience.map(strip), projects: cv.projects.map(strip) };
  }
  function normTips(t, roles) {
    t = t && typeof t === "object" ? t : {};
    const exp = strs(t.experience);
    return {
      header: str(t.header), summary: str(t.summary), projects: str(t.projects), skills: str(t.skills),
      education: str(t.education), certifications: str(t.certifications), languages: str(t.languages),
      experience: Array.from({ length: roles }, (_, i) => exp[i] || ""),
    };
  }
  function defaultLabels() {
    return state.lang === "ro"
      ? { summary: "Profil", experience: "Experiență profesională", projects: "Proiecte", education: "Educație", skills: "Competențe", certifications: "Certificări", languages: "Limbi" }
      : { summary: "Profile", experience: "Experience", projects: "Projects", education: "Education", skills: "Skills", certifications: "Certifications", languages: "Languages" };
  }
  const clampScore = (v) => (v != null && v !== "" && Number.isFinite(+v) ? Math.max(0, Math.min(100, Math.round(+v))) : null);
  function normalize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const a = r.analysis && typeof r.analysis === "object" ? r.analysis : {};
    const l = r.labels && typeof r.labels === "object" ? r.labels : {};
    const def = defaultLabels();
    const labels = {};
    for (const k of Object.keys(def)) labels[k] = str(l[k]).trim() || def[k];
    const cv = normCv(r.cv);
    return {
      cv,
      target: { role: str(r.target?.role).trim(), company: str(r.target?.company).trim() },
      analysis: {
        matched: arr(a.matched).map((m) => ({ requirement: str(m?.requirement), evidence: str(m?.evidence) })).filter((m) => m.requirement.trim()),
        gaps: strs(a.gaps).filter((x) => x.trim()),
        notes: str(a.notes),
        matchAfter: clampScore(a.matchAfter),
      },
      matchBefore: state.match ? state.match.score : null,
      tips: normTips(r.tips, cv.experience.length),
      labels,
      check: null,
    };
  }
  function normalizeQuestions(raw) {
    const list = Array.isArray(raw?.questions) ? raw.questions : null;
    if (!list) return null;
    const m = raw.match && typeof raw.match === "object" ? raw.match : null;
    const score = clampScore(m?.score);
    return {
      match: score == null ? null : { score, verdict: ["strong", "partial", "weak"].includes(m.verdict) ? m.verdict : score >= 75 ? "strong" : score >= 45 ? "partial" : "weak", summary: str(m.summary) },
      questions: list.map((q) => {
        const prevIndex = Number.isFinite(+q?.previous) && q?.previous !== null ? Math.round(+q.previous) - 1 : -1;
        const prev = state.memory[prevIndex];
        return {
          requirement: str(q?.requirement).trim(),
          kind: q?.kind === "weak" ? "weak" : "missing",
          why: str(q?.why).trim(),
          question: str(q?.question).trim(),
          previousId: prev ? prev.id : null,
          reuse: null,      // null: not decided; "same": previous answer confirmed; "update": editing it
          answer: "", none: false,
        };
      }).filter((q) => q.question).slice(0, 10),
    };
  }

  // ---------- Claude calls (Anthropic API, the user's key) ----------
  const ERRORS = ERROR_TEXT;
  let controller = null;
  let busy = false;
  const ACTION_BUTTONS = ["btn-analyze", "btn-skip", "btn-generate", "btn-regenerate", "btn-new-role"];
  function setBusy(on) {
    busy = on;
    ACTION_BUTTONS.forEach((id) => ($(id).disabled = on));
    document.querySelectorAll("[data-rewrite]").forEach((b) => (b.disabled = on));
  }
  // Runs one Claude call with progress text, an optional Stop button and errors in the given status line.
  async function runSample({ prompt, statusId, stopId, label, typical, effort }) {
    if (!settings.apiKey) { setStatus(statusId, `${ERRORS.no_key} <button class="btn small" data-go-settings="1">Open Settings</button>`, true); return null; }
    setBusy(true);
    controller = new AbortController();
    if (stopId) $(stopId).hidden = false;
    const started = Date.now();
    const show = () => setStatus(statusId, `<span class="spinner"></span> ${label} ${Math.round((Date.now() - started) / 1000)}s (usually ${typical})`);
    show();
    const tick = setInterval(show, 1000);
    try {
      const raw = await callMainJson({ apiKey: settings.apiKey, content: prompt, effort, signal: controller.signal });
      setStatus(statusId, "");
      return raw;
    } catch (e) {
      setStatus(statusId, errorText(e), e?.code !== "cancelled");
      return null;
    } finally {
      clearInterval(tick);
      setBusy(false);
      if (stopId) $(stopId).hidden = true;
    }
  }

  function hasInputs(statusId, needsCv) {
    if (!state.jd.trim()) { setStatus(statusId, "Add the job description.", true); return false; }
    const hasCv = state.cvFile || state.cvText.trim();
    if (needsCv && !hasCv) { setStatus(statusId, "Add your CV (file or text).", true); return false; }
    if (!hasCv && !state.extra.trim()) { setStatus(statusId, "Add your CV (file or text) or extra information about your experience.", true); return false; }
    return true;
  }

  async function analyze() {
    if (busy || !hasInputs("status", true)) return;
    const raw = await runSample({
      prompt: buildQuestionsPrompt(), statusId: "status", stopId: "btn-stop",
      label: "Claude is comparing your CV with the job…", typical: "20-60 seconds", effort: EFFORT.questions,
    });
    if (raw == null) return;
    const parsed = normalizeQuestions(raw);
    if (!parsed) { setStatus("status", ERRORS.invalid_json, true); return; }
    state.questions = parsed.questions;
    state.match = parsed.match;
    state.questionsSkipped = false;
    flush();
    reportScoreToToolbar();
    renderQuestions();
    showView("questions");
    window.scrollTo({ top: 0 });
  }

  // Answers given this time are remembered for later roles.
  function rememberAnswers() {
    const now = Date.now();
    for (const q of answeredQuestions()) {
      const entry = { requirement: q.requirement, question: q.question, answer: q.none ? "" : q.answer.trim(), none: q.none, updatedAt: now };
      const existing = q.previousId && state.memory.find((m) => m.id === q.previousId);
      if (existing) Object.assign(existing, entry);
      else {
        const id = "m" + now.toString(36) + Math.random().toString(36).slice(2, 6);
        state.memory.push({ id, ...entry });
        q.previousId = id;
        q.reuse = "same";
      }
    }
    state.memory = state.memory.slice(-60);
  }

  async function generate(statusId, stopId) {
    if (busy || !hasInputs(statusId)) return;
    const raw = await runSample({
      prompt: buildPrompt(), statusId, stopId,
      label: "Claude is writing your CV…", typical: "30-90 seconds", effort: EFFORT.write,
    });
    if (raw == null) return;
    const result = normalize(raw);
    if (!result.cv.name && !result.cv.experience.length) { setStatus(statusId, ERRORS.invalid_json, true); return; }
    rememberAnswers();
    state.result = result;
    // Regenerating for the same role replaces that saved CV; otherwise a new one is saved.
    if (!state.currentId || !state.history.some((x) => x.id === state.currentId)) state.currentId = "cv" + Date.now().toString(36);
    flush();
    renderResult();
    showView("result");
    window.scrollTo({ top: 0 });
    runCheck();
  }

  $("btn-analyze").onclick = analyze;
  $("btn-skip").onclick = () => {
    if (busy) return;
    if (!state.jd.trim()) { setStatus("status", "Add the job description.", true); return; }
    setStatus("status", "");
    state.questions = [];
    state.match = null;
    state.questionsSkipped = true;
    flush();
    renderQuestions();
    showView("questions");
    window.scrollTo({ top: 0 });
  };
  $("btn-generate").onclick = () => generate("q-status", "btn-q-stop");
  $("btn-regenerate").onclick = () => generate("pdf-status", null);
  $("btn-stop").onclick = () => controller && controller.abort();
  $("btn-q-stop").onclick = () => controller && controller.abort();

  // ---------- Completeness check (runs after every generation) ----------
  let checkToken = 0;
  async function runCheck() {
    if (!state.result) return;
    const token = ++checkToken;
    const result = state.result;
    result.check = { status: "running", missing: [] };
    renderCheck();
    if (!settings.apiKey) { result.check = null; renderCheck(); return; }
    try {
      const raw = await callMainJson({ apiKey: settings.apiKey, content: buildCheckPrompt(), effort: EFFORT.check });
      if (token !== checkToken) return;
      const missing = arr(raw?.missing).map((m) => ({ item: str(m?.item).trim(), section: str(m?.section).trim() })).filter((m) => m.item);
      result.check = { status: "done", missing };
    } catch (e) {
      if (token !== checkToken) return;
      result.check = { status: "error", missing: [], message: errorText(e) };
    }
    flush();
    if (state.result === result) renderCheck();
  }
  async function repairMissing() {
    const missing = state.result?.check?.missing || [];
    if (!missing.length || busy) return;
    const raw = await runSample({
      prompt: buildRepairPrompt(missing), statusId: "check-status", stopId: null,
      label: "Claude is putting the missing items back…", typical: "30-60 seconds", effort: EFFORT.write,
    });
    if (raw == null) return;
    const cv = normCv(raw.cv ?? raw);
    if (!cv.experience.length && !cv.name) { setStatus("check-status", ERRORS.invalid_json, true); return; }
    state.result.cv = cv;
    state.result.tips.experience = Array.from({ length: cv.experience.length }, (_, i) => state.result.tips.experience[i] || "");
    flush();
    renderEditor();
    schedulePreview(0);
    runCheck();
  }

  // ---------- Small DOM helpers ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const kids = (list) => list.flat(Infinity).filter((c) => c != null && c !== false);
  const fill = (el, ...list) => el.replaceChildren(...kids(list));
  let uid = 0;
  const nextId = () => "f" + (++uid);
  const scoreColor = (s) => (s >= 75 ? "var(--ok)" : s >= 45 ? "var(--ink)" : "var(--warn)");
  // A "Tip" badge whose advice shows on hover or keyboard focus. Nothing is shown when there is no tip.
  function tipBadge(text) {
    if (!text || !text.trim()) return null;
    return h("span", { class: "tip", tabindex: "0", "aria-label": "Tip: " + text }, "Tip", h("span", { class: "tip-pop", role: "tooltip" }, text));
  }

  // ---------- Match score ----------
  const VERDICT_TEXT = { strong: "Strong fit", partial: "Partial fit", weak: "Weak fit" };
  function renderMatch() {
    const panel = $("match-panel");
    const m = state.match;
    panel.hidden = !m;
    if (!m) return;
    const ring = h("div", { class: "score", style: `--score:${m.score};--score-color:${scoreColor(m.score)}`, role: "img", "aria-label": `Fit score ${m.score} out of 100` }, h("span", {}, String(m.score)));
    fill(panel, h("div", { class: "match" }, ring,
      h("div", { class: "stack", style: "gap:6px" },
        h("p", { class: "muted small" }, "How well your current CV fits this job"),
        h("p", { class: "verdict " + m.verdict }, VERDICT_TEXT[m.verdict]),
        m.summary ? h("p", {}, m.summary) : null)));
  }

  // ---------- Questions ----------
  function updateQuestionProgress() {
    const qs = state.questions || [];
    $("q-progress").textContent = qs.length ? `${answeredQuestions().length} of ${qs.length} answered` : "";
  }
  function renderQuestions() {
    renderMatch();
    const qs = state.questions || [];
    const list = $("questions");
    $("q-intro").hidden = !qs.length;
    if (!qs.length) {
      fill(list, h("div", { class: "q-card" },
        h("p", {}, state.questionsSkipped
          ? "You skipped the questions. If you like, add extra information below, then write your CV."
          : "Your CV already covers the requirements in the job ad. If you like, add extra information below, then write your CV.")));
      updateQuestionProgress();
      return;
    }
    fill(list, qs.map((q, i) => questionCard(q, i)));
    updateQuestionProgress();
  }
  function questionCard(q, i) {
    const id = "q-answer-" + i;
    const prev = q.previousId && state.memory.find((m) => m.id === q.previousId);
    const card = h("div", { class: "q-card" });
    const mark = () => card.classList.toggle("done", q.none || !!q.answer.trim());
    const rerender = () => { card.replaceWith(questionCard(q, i)); updateQuestionProgress(); save(); };

    let body;
    if (prev && q.reuse !== "update") {
      // Answered for an earlier role: only ask whether it is still accurate.
      body = h("div", { class: "q-prev" },
        h("p", { class: "small muted" }, "You answered this for an earlier role:"),
        h("blockquote", {}, prev.none ? "You said you don't have this experience." : prev.answer),
        q.reuse === "same"
          ? h("div", { class: "row" }, h("span", { class: "small", style: "color:var(--ok)" }, "✓ Confirmed as still accurate"),
              h("button", { class: "btn small", onclick: () => { q.reuse = "update"; rerender(); } }, "Change it"))
          : h("div", { class: "row" },
              h("button", { class: "btn small primary", onclick: () => { q.reuse = "same"; q.answer = prev.answer; q.none = prev.none; rerender(); } }, "Still accurate"),
              h("button", { class: "btn small", onclick: () => { q.reuse = "update"; q.answer = prev.answer; q.none = prev.none; rerender(); } }, "Update it")));
    } else {
      const area = h("textarea", { id, rows: 3, placeholder: "Your answer (optional)…" });
      area.value = q.answer;
      area.disabled = q.none;
      const box = h("input", { type: "checkbox", id: "q-none-" + i });
      box.checked = q.none;
      area.addEventListener("input", () => { q.answer = area.value; mark(); save(); updateQuestionProgress(); });
      box.addEventListener("change", () => { q.none = box.checked; area.disabled = q.none; mark(); save(); updateQuestionProgress(); });
      body = [area, h("label", { class: "q-none", for: "q-none-" + i }, box, "I don't have this experience")];
    }
    fill(card,
      h("div", { class: "q-head" },
        h("span", { class: "q-kind " + q.kind }, q.kind === "weak" ? "Unclear in CV" : "Missing from CV"),
        q.requirement ? h("span", { class: "q-req" }, q.requirement) : null),
      q.why ? h("p", { class: "muted small" }, q.why) : null,
      h("label", { class: "q-text", for: id }, q.question),
      body);
    mark();
    return card;
  }

  // ---------- Result: analysis and completeness ----------
  function renderAnalysis() {
    const { analysis, matchBefore } = state.result;
    const after = analysis.matchAfter;
    fill($("analysis"),
      h("div", { class: "analysis-head" },
        h("h2", {}, "What was emphasised and why"),
        matchBefore != null || after != null
          ? h("span", { class: "pill ink", title: "Fit score before and after tailoring" },
              matchBefore != null && after != null ? `Fit: ${matchBefore} → ${after}` : `Fit: ${after ?? matchBefore}`)
          : null,
        h("span", { class: "pill ok" }, `${analysis.matched.length} requirement${analysis.matched.length === 1 ? "" : "s"} covered`),
        h("span", { class: "pill gap" }, `${analysis.gaps.length} not covered`)),
      analysis.notes ? h("p", {}, analysis.notes) : null,
      analysis.matched.length ? h("details", {}, h("summary", {}, "Requirements your experience covers"),
        h("ul", { class: "matched" }, analysis.matched.map((m) => h("li", {}, h("b", {}, m.requirement), h("span", { class: "muted" }, " ← " + m.evidence))))) : null,
      analysis.gaps.length ? h("details", { open: true }, h("summary", {}, "Requirements your material does not cover"),
        h("p", { class: "muted small" }, "These were not added to the CV. If you do have this experience, add it in step 2 (answers or extra information) and regenerate."),
        h("ul", { class: "gaps" }, analysis.gaps.map((g) => h("li", {}, g)))) : null);
  }
  function renderCheck() {
    const panel = $("check");
    const c = state.result?.check;
    panel.hidden = !c;
    panel.classList.remove("ok", "warn");
    if (!c) return;
    if (c.status === "running") {
      fill(panel, h("p", { class: "small" }, h("span", { class: "spinner" }), " Checking that nothing from your original CV was lost…"));
    } else if (c.status === "error") {
      fill(panel, h("div", { class: "row spread" }, h("p", { class: "small" }, "The completeness check did not run: " + (c.message || "")),
        h("button", { class: "btn small", onclick: runCheck }, "Run it again")));
    } else if (!c.missing.length) {
      panel.classList.add("ok");
      fill(panel, h("p", { class: "small" }, "✓ Completeness check: everything from your original CV is in the tailored version."));
    } else {
      panel.classList.add("warn");
      fill(panel,
        h("h3", {}, `Completeness check: ${c.missing.length} item${c.missing.length > 1 ? "s" : ""} from your original CV ${c.missing.length > 1 ? "are" : "is"} missing`),
        h("ul", {}, c.missing.map((m) => h("li", {}, m.item, m.section ? h("span", { class: "muted" }, ` (${m.section})`) : null))),
        h("div", { class: "row" },
          h("button", { class: "btn primary small", "data-rewrite": "1", disabled: busy, onclick: repairMissing }, "Put them back"),
          h("button", { class: "btn small", onclick: runCheck }, "Check again")),
        h("p", { class: "status small", id: "check-status" }));
    }
  }

  // ---------- Editor ----------
  function changed() { save(); schedulePreview(); }

  function field(label, get, set, opts = {}) {
    const id = nextId();
    const input = opts.multiline ? h("textarea", { id, rows: opts.rows || 3 }) : h("input", { id, type: "text" });
    input.value = get();
    input.addEventListener("input", () => { set(input.value); changed(); });
    return h("label", { class: "field", for: id }, label ? h("span", {}, label) : null, input);
  }
  function lines(label, get, set, rows) {
    return field(label + " (one per line)", () => get().join("\n"), (v) => set(v.split("\n")), { multiline: true, rows: rows || Math.max(3, get().length + 1) });
  }
  // Bullets keep their source while their text is unchanged; edited or new lines become "edited".
  function bulletLines(label, obj) {
    return field(label + " (one per line)", () => obj.bullets.join("\n"), (v) => {
      const known = new Map(obj.bullets.map((b, i) => [b, obj.bulletSources?.[i] || "rephrased"]));
      obj.bullets = v.split("\n");
      obj.bulletSources = obj.bullets.map((b) => known.get(b) || "edited");
    }, { multiline: true, rows: Math.max(3, obj.bullets.length + 1) });
  }
  function moveTools(list, i, rerender, extraList) {
    const swap = (a, b) => {
      [list[a], list[b]] = [list[b], list[a]];
      if (extraList) [extraList[a], extraList[b]] = [extraList[b], extraList[a]];
      changed(); rerender();
    };
    return [
      h("button", { class: "btn small", title: "Move up", "aria-label": "Move up", disabled: i === 0, onclick: () => swap(i - 1, i) }, "↑"),
      h("button", { class: "btn small", title: "Move down", "aria-label": "Move down", disabled: i === list.length - 1, onclick: () => swap(i + 1, i) }, "↓"),
      h("button", { class: "btn small danger", title: "Delete", "aria-label": "Delete", onclick: () => { list.splice(i, 1); if (extraList) extraList.splice(i, 1); changed(); rerender(); } }, "✕"),
    ];
  }

  // "Rewrite" button that opens an optional instruction box, then rewrites one section with Claude.
  function rewriteControl(kind, getCurrent, apply) {
    const panel = h("div", { class: "rewrite-row", hidden: true });
    const inputId = nextId();
    const statusId = nextId();
    const input = h("input", { type: "text", id: inputId, placeholder: "Optional: what to change, e.g. \"shorter\" or \"more about AWS\"" });
    const go = h("button", { class: "btn small primary", "data-rewrite": "1", onclick: async () => {
      if (busy) return;
      const raw = await runSample({ prompt: buildSectionPrompt(kind, getCurrent(), input.value), statusId, stopId: null, label: "Rewriting…", typical: "15-45 seconds", effort: EFFORT.rewrite });
      if (raw == null) return;
      if (!apply(raw)) { setStatus(statusId, ERRORS.invalid_json, true); return; }
      flush();
      renderEditor();
      schedulePreview(0);
    } }, "Rewrite");
    fill(panel, h("label", { class: "field", for: inputId }, h("span", {}, "Rewrite this section with Claude"), input),
      h("div", { class: "row" }, go, h("button", { class: "btn small", onclick: () => (panel.hidden = true) }, "Cancel")),
      h("p", { class: "status small", id: statusId }));
    const button = h("button", { class: "btn small", "data-rewrite": "1", onclick: () => { panel.hidden = !panel.hidden; if (!panel.hidden) input.focus(); } }, "Rewrite");
    return { button, panel };
  }

  function sectionFieldset(legendText, tip, rewrite, ...body) {
    return h("fieldset", {},
      h("legend", {}, legendText, tipBadge(tip), rewrite ? rewrite.button : null),
      h("div", { class: "fs-body" }, rewrite ? rewrite.panel : null, ...body));
  }

  function renderEditor() {
    const r = state.result;
    if (!r) return;
    const { cv, labels, tips } = r;

    const summaryRw = rewriteControl("summary", () => ({ summary: cv.summary }), (raw) => {
      if (typeof raw?.summary !== "string" || !raw.summary.trim()) return false;
      cv.summary = raw.summary; tips.summary = str(raw.tip); return true;
    });
    const skillsRw = rewriteControl("skills", () => ({ skills: cv.skills }), (raw) => {
      const s = normSkills(raw?.skills); if (!s.length) return false;
      cv.skills = s; tips.skills = str(raw.tip); return true;
    });
    const projectsRw = cv.projects.length ? rewriteControl("projects", () => ({ projects: exportCv(cv).projects }), (raw) => {
      if (!Array.isArray(raw?.projects)) return false;
      cv.projects = raw.projects.map(normProject); tips.projects = str(raw.tip); return true;
    }) : null;
    const educationRw = cv.education.length ? rewriteControl("education", () => ({ education: cv.education }), (raw) => {
      if (!Array.isArray(raw?.education)) return false;
      cv.education = raw.education.map(normEducation); tips.education = str(raw.tip); return true;
    }) : null;

    const experienceBody = h("div", { class: "fs-body" });
    const renderRoles = () => {
      fill(experienceBody,
        cv.experience.map((job, i) => {
          const rw = rewriteControl("role", () => ({ role: exportCv(cv).experience[i] }), (raw) => {
            if (!raw?.role || typeof raw.role !== "object") return false;
            cv.experience[i] = normRole(raw.role); tips.experience[i] = str(raw.tip); return true;
          });
          return h("div", { class: "entry" },
            h("div", { class: "entry-tools" }, tipBadge(tips.experience[i]), rw.button, moveTools(cv.experience, i, renderRoles, tips.experience)),
            rw.panel,
            h("div", { class: "grid2" },
              field("Role", () => job.title, (v) => (job.title = v)),
              field("Company", () => job.company, (v) => (job.company = v)),
              field("Start", () => job.startDate, (v) => (job.startDate = v)),
              field("End", () => job.endDate, (v) => (job.endDate = v)),
              field("Location", () => job.location, (v) => (job.location = v))),
            field("Short description", () => job.description, (v) => (job.description = v), { multiline: true, rows: 2 }),
            bulletLines("Achievements / responsibilities", job));
        }),
        h("div", {}, h("button", { class: "btn small", onclick: () => {
          cv.experience.push({ title: "", company: "", location: "", startDate: "", endDate: "", description: "", bullets: [], bulletSources: [] });
          tips.experience.push(""); changed(); renderRoles();
        } }, "+ Add a role")));
      setBusy(busy);
    };
    renderRoles();

    const listBody = (list, renderItem, makeEmpty, addLabel) => {
      const body = h("div", { class: "fs-body" });
      const rerender = () => fill(body,
        list.map((item, i) => h("div", { class: "entry" }, h("div", { class: "entry-tools" }, moveTools(list, i, rerender)), renderItem(item))),
        h("div", {}, h("button", { class: "btn small", onclick: () => { list.push(makeEmpty()); changed(); rerender(); } }, "+ " + addLabel)));
      rerender();
      return body;
    };

    fill($("editor"),
      sectionFieldset("Header", tips.header, null,
        h("div", { class: "grid2" },
          field("Name", () => cv.name, (v) => (cv.name = v)),
          field("Headline", () => cv.headline, (v) => (cv.headline = v)),
          field("Email", () => cv.contact.email, (v) => (cv.contact.email = v)),
          field("Phone", () => cv.contact.phone, (v) => (cv.contact.phone = v)),
          field("Location", () => cv.contact.location, (v) => (cv.contact.location = v))),
        lines("Links", () => cv.contact.links, (v) => (cv.contact.links = v), 2)),
      sectionFieldset(labels.summary, tips.summary, summaryRw,
        field("", () => cv.summary, (v) => (cv.summary = v), { multiline: true, rows: 5 })),
      sectionFieldset(labels.experience, "", null, experienceBody),
      sectionFieldset(labels.projects, tips.projects, projectsRw,
        listBody(cv.projects, (p) => h("div", { class: "fs-body" },
          field("Project name", () => p.name, (v) => (p.name = v)),
          field("Description", () => p.description, (v) => (p.description = v), { multiline: true, rows: 2 }),
          bulletLines("Details", p)),
          () => ({ name: "", description: "", bullets: [], bulletSources: [] }), "Add a project")),
      sectionFieldset(labels.skills, tips.skills, skillsRw,
        listBody(cv.skills, (s) => h("div", { class: "fs-body" },
          field("Category", () => s.category, (v) => (s.category = v)),
          field("Skills (comma-separated)", () => s.items.join(", "), (v) => (s.items = v.split(",").map((x) => x.trim())))),
          () => ({ category: "", items: [] }), "Add a category")),
      sectionFieldset(labels.education, tips.education, educationRw,
        listBody(cv.education, (e) => h("div", { class: "fs-body" },
          h("div", { class: "grid2" },
            field("Degree / subject", () => e.degree, (v) => (e.degree = v)),
            field("Institution", () => e.institution, (v) => (e.institution = v)),
            field("Start", () => e.startDate, (v) => (e.startDate = v)),
            field("End", () => e.endDate, (v) => (e.endDate = v)),
            field("Location", () => e.location, (v) => (e.location = v))),
          field("Details", () => e.details, (v) => (e.details = v), { multiline: true, rows: 2 })),
          () => ({ degree: "", institution: "", location: "", startDate: "", endDate: "", details: "" }), "Add education")),
      sectionFieldset(labels.certifications, tips.certifications, null,
        lines(labels.certifications, () => cv.certifications, (v) => (cv.certifications = v))),
      sectionFieldset(labels.languages, tips.languages, null,
        listBody(cv.languages, (l) => h("div", { class: "grid2" },
          field("Language", () => l.language, (v) => (l.language = v)),
          field("Level", () => l.level, (v) => (l.level = v))),
          () => ({ language: "", level: "" }), "Add a language")),
    );
    setBusy(busy);
  }

  function renderResult() {
    renderAnalysis();
    renderCheck();
    renderEditor();
    schedulePreview(0);
  }

  // ---------- CV view model (shared by all PDF templates) ----------
  const clean = (list) => list.map((x) => x.trim()).filter(Boolean);
  const join = (list, sep) => clean(list).join(sep);
  const range = (a, b) => join([a, b], " – ");
  function bulletsWithSources(o) {
    const out = [];
    o.bullets.forEach((b, i) => { if (b.trim()) out.push({ text: b.trim(), source: o.bulletSources?.[i] || "rephrased" }); });
    return out;
  }
  function viewModel() {
    const { cv, labels } = state.result;
    return {
      labels,
      name: cv.name.trim(),
      headline: cv.headline.trim(),
      contactItems: clean([cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links]),
      summary: cv.summary.trim(),
      experience: cv.experience.map((j) => ({ title: j.title.trim(), company: j.company.trim(), date: range(j.startDate, j.endDate), sub: j.location.trim(), desc: j.description.trim(), bullets: bulletsWithSources(j) })).filter((j) => j.title || j.company || j.bullets.length),
      projects: cv.projects.map((p) => ({ title: p.name.trim(), company: "", date: "", sub: "", desc: p.description.trim(), bullets: bulletsWithSources(p) })).filter((p) => p.title || p.desc),
      skills: cv.skills.map((s) => ({ category: s.category.trim(), items: join(s.items, ", ") })).filter((s) => s.items),
      education: cv.education.map((e) => ({ title: join([e.degree, e.institution], " · "), company: "", date: range(e.startDate, e.endDate), sub: e.location.trim(), desc: e.details.trim(), bullets: [] })).filter((e) => e.title),
      certifications: clean(cv.certifications),
      languages: cv.languages.filter((l) => l.language.trim()).map((l) => (l.level.trim() ? `${l.language.trim()} (${l.level.trim()})` : l.language.trim())),
    };
  }

  // ---------- PDF templates (pdfmake: real, selectable text) ----------
  // Source Sans 3 (SIL OFL) ships with the extension, so the PDF has full Latin Extended glyphs (incl. Romanian diacritics).
  let fontsPromise = null;
  async function fontBase64(file) {
    const blob = await (await fetch(chrome.runtime.getURL("fonts/" + file))).blob();
    return blobToBase64(blob);
  }
  function setupFonts() {
    if (!fontsPromise) fontsPromise = (async () => {
      const [regular, bold, italic] = await Promise.all(["SourceSans3-Regular.ttf", "SourceSans3-Bold.ttf", "SourceSans3-Italic.ttf"].map(fontBase64));
      window.pdfMake.vfs = { "SS-Regular.ttf": regular, "SS-Bold.ttf": bold, "SS-Italic.ttf": italic };
      window.pdfMake.fonts = { SourceSans: { normal: "SS-Regular.ttf", bold: "SS-Bold.ttf", italics: "SS-Italic.ttf", bolditalics: "SS-Bold.ttf" } };
    })().catch((e) => { fontsPromise = null; throw e; });
    return fontsPromise;
  }
  const SOURCE_HIGHLIGHT = { rephrased: "#dbe7ff", answers: "#d7f0de", extra: "#ece0fa", edited: "#ffeccc" };
  const A4_WIDTH = 595.28, A4_HEIGHT = 841.89;

  function docDefinition(template, showSources) {
    const v = viewModel();
    const hl = (b) => (showSources && SOURCE_HIGHLIGHT[b.source] ? { text: b.text, background: SOURCE_HIGHLIGHT[b.source] } : { text: b.text });
    const ink = template === "modern" ? "#0f4c5c" : "#1f3a5f";
    const compact = template === "compact";
    // A section title in the last ~70pt of a page moves to the next page with its content.
    const pageBreakBefore = (node) => node.headlineLevel === 1 && node.startPosition.top > A4_HEIGHT - 36 - 70;
    const sectionTitle = (title, width) => [
      { text: title.toUpperCase(), style: "sectionTitle", headlineLevel: 1 },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.75, lineColor: ink }], margin: [0, 1, 0, compact ? 3 : 5] },
    ];
    const bulletList = (list) => (list.length ? { ul: list.map(hl), margin: [compact ? 2 : 4, compact ? 1 : 2, 0, 0], markerColor: "#333" } : null);
    const entry = (e) => ({
      stack: [
        { columns: [
          { text: [{ text: e.title, bold: true }, e.company ? { text: (e.title ? " · " : "") + e.company, bold: !compact } : "", compact && e.sub ? { text: " — " + e.sub, italics: true, color: "#444" } : ""], width: "*" },
          e.date ? { text: e.date, width: "auto", style: "meta" } : { text: "", width: 0 }], columnGap: 8 },
        !compact && e.sub ? { text: e.sub, italics: true, color: "#444" } : null,
        e.desc ? { text: e.desc, margin: [0, compact ? 1 : 2, 0, 0] } : null,
        e.bullets && e.bullets.length ? bulletList(e.bullets) : null,
      ].filter(Boolean),
      margin: [0, 0, 0, compact ? 5 : 8],
    });
    const styles = {
      name: { fontSize: compact ? 18 : 22, bold: true, color: ink },
      headline: { fontSize: compact ? 10.5 : 12, color: "#333", margin: [0, 2, 0, 0] },
      contact: { fontSize: compact ? 8.5 : 9.5, color: "#555", margin: [0, compact ? 2 : 4, 0, 0] },
      sectionTitle: { fontSize: compact ? 9.5 : 11, bold: true, color: ink, characterSpacing: 0.8, margin: [0, compact ? 8 : 12, 0, 0] },
      meta: { fontSize: compact ? 8.5 : 9.5, color: "#555" },
      sideTitle: { fontSize: 9.5, bold: true, color: ink, characterSpacing: 0.8, margin: [0, 14, 0, 4] },
    };
    const info = { title: v.name ? `CV - ${v.name}` : "CV", author: v.name };

    if (template === "modern") {
      // Sidebar (contact, skills, languages, certifications) beside the main column.
      const side = [];
      const sideTitle = (t) => side.push({ text: t.toUpperCase(), style: "sideTitle" });
      if (v.contactItems.length) { sideTitle("Contact"); v.contactItems.forEach((c) => side.push({ text: c, fontSize: 9, margin: [0, 0, 0, 3] })); }
      if (v.skills.length) { sideTitle(v.labels.skills); v.skills.forEach((s) => side.push({ stack: [s.category ? { text: s.category, bold: true, fontSize: 9 } : null, { text: s.items, fontSize: 9 }].filter(Boolean), margin: [0, 0, 0, 5] })); }
      if (v.languages.length) { sideTitle(v.labels.languages); v.languages.forEach((l) => side.push({ text: l, fontSize: 9, margin: [0, 0, 0, 2] })); }
      if (v.certifications.length) { sideTitle(v.labels.certifications); v.certifications.forEach((c) => side.push({ text: c, fontSize: 9, margin: [0, 0, 0, 3] })); }
      const main = [{ text: v.name, style: "name" }];
      if (v.headline) main.push({ text: v.headline, style: "headline" });
      const mainWidth = A4_WIDTH - 24 - 128 - 36 - 36;
      const mainSection = (t) => main.push(...sectionTitle(t, mainWidth));
      if (v.summary) { mainSection(v.labels.summary); main.push({ text: v.summary }); }
      if (v.experience.length) { mainSection(v.labels.experience); v.experience.forEach((e) => main.push(entry(e))); }
      if (v.projects.length) { mainSection(v.labels.projects); v.projects.forEach((e) => main.push(entry(e))); }
      if (v.education.length) { mainSection(v.labels.education); v.education.forEach((e) => main.push(entry(e))); }
      return {
        pageSize: "A4", pageMargins: [24, 36, 36, 36], info,
        background: (page, pageSize) => ({ canvas: [{ type: "rect", x: 0, y: 0, w: 170, h: pageSize.height, color: "#eaf1f3" }] }),
        defaultStyle: { font: "SourceSans", fontSize: 10, lineHeight: 1.15, color: "#1a1a1a" },
        styles, pageBreakBefore,
        content: [{ columns: [{ width: 128, stack: side }, { width: "*", stack: main }], columnGap: 36 }],
      };
    }

    const margins = compact ? [36, 28, 36, 28] : [44, 36, 44, 36];
    const width = A4_WIDTH - margins[0] - margins[2];
    const content = [{ text: v.name, style: "name" }];
    if (v.headline) content.push({ text: v.headline, style: "headline" });
    if (v.contactItems.length) content.push({ text: v.contactItems.join("  |  "), style: "contact" });
    const section = (t) => content.push(...sectionTitle(t, width));
    if (v.summary) { section(v.labels.summary); content.push({ text: v.summary }); }
    if (v.experience.length) { section(v.labels.experience); v.experience.forEach((e) => content.push(entry(e))); }
    if (v.projects.length) { section(v.labels.projects); v.projects.forEach((e) => content.push(entry(e))); }
    if (v.skills.length) { section(v.labels.skills); v.skills.forEach((s) => content.push({ text: [s.category ? { text: s.category + ": ", bold: true } : "", s.items], margin: [0, 0, 0, compact ? 1 : 2] })); }
    if (v.education.length) { section(v.labels.education); v.education.forEach((e) => content.push(entry(e))); }
    if (v.certifications.length) {
      section(v.labels.certifications);
      content.push(compact ? { text: v.certifications.join("; ") } : bulletList(v.certifications.map((c) => ({ text: c, source: "original" }))));
    }
    if (v.languages.length) { section(v.labels.languages); content.push({ text: v.languages.join(", ") }); }
    return {
      pageSize: "A4", pageMargins: margins, info,
      defaultStyle: { font: "SourceSans", fontSize: compact ? 9.5 : 10.5, lineHeight: compact ? 1.1 : 1.15, color: "#1a1a1a" },
      styles, pageBreakBefore, content,
    };
  }
  async function pdfBuffer(showSources) {
    await setupFonts();
    return new Promise((resolve, reject) => {
      try { window.pdfMake.createPdf(docDefinition(state.template, showSources)).getBuffer((b) => resolve(b)); } catch (e) { reject(e); }
    });
  }

  // ---------- Preview: the real PDF, rendered page by page ----------
  let previewTimer, previewToken = 0;
  function schedulePreview(delay = 600) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, delay);
  }
  async function renderPreview() {
    const pages = $("pages");
    if (!state.result || $("view-result").hidden) return;
    if (!window.pdfMake || !window.pdfjsLib) { fill(pages, h("div", { class: "empty" }, "The preview could not load. Reload the page.")); return; }
    const token = ++previewToken;
    try {
      const buffer = await pdfBuffer(state.showSources);
      if (token !== previewToken) return;
      const doc = await loadPdf(buffer);
      const width = Math.max(300, pages.clientWidth - 4);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvases = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `CV preview, page ${i} of ${doc.numPages}`);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        if (token !== previewToken) return;
        canvases.push(canvas);
      }
      fill(pages, canvases);
      $("page-count").textContent = `${doc.numPages} page${doc.numPages > 1 ? "s" : ""}`;
    } catch (e) {
      console.error(e);
      fill(pages, h("div", { class: "empty" }, "The preview failed: " + (e?.message || e)));
    }
  }
  window.addEventListener("resize", () => schedulePreview(300));
  $("template").addEventListener("change", (e) => { state.template = e.target.value; save(); schedulePreview(0); });
  $("show-sources").addEventListener("change", (e) => { state.showSources = e.target.checked; $("legend").hidden = !state.showSources; save(); schedulePreview(0); });

  function fileNameFor(result) {
    const parts = ["CV", result.cv.name.trim(), result.target?.company || result.target?.role].filter(Boolean);
    return parts.join("_").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_") + ".pdf";
  }
  async function downloadPdf(statusId) {
    if (!window.pdfMake) { setStatus(statusId, "The PDF generator did not load. Reload the page.", true); return; }
    setStatus(statusId, `<span class="spinner"></span> Preparing the PDF…`);
    try {
      const buffer = await pdfBuffer(false);
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
      const a = h("a", { href: url, download: fileNameFor(state.result), hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus(statusId, "PDF downloaded.");
    } catch (e) {
      setStatus(statusId, "Could not save the PDF: " + errorText(e), true);
    }
  }
  $("btn-pdf").onclick = () => state.result && downloadPdf("pdf-status");

  // ---------- Saved CVs ----------
  function syncHistoryEntry() {
    if (!state.result || !state.currentId) return;
    const now = Date.now();
    let entry = state.history.find((x) => x.id === state.currentId);
    if (!entry) {
      entry = { id: state.currentId, createdAt: now };
      state.history.unshift(entry);
    }
    const firstLine = state.jd.trim().split("\n")[0].slice(0, 80);
    Object.assign(entry, {
      role: state.result.target?.role || entry.role || firstLine || "Untitled role",
      company: state.result.target?.company || entry.company || "",
      updatedAt: now,
      result: state.result,
    });
    $("history-count").textContent = `(${state.history.length})`;
  }
  function openSaved(id) {
    const entry = state.history.find((x) => x.id === id);
    if (!entry) return;
    flush();
    checkToken++;
    state.result = entry.result;
    state.currentId = entry.id;
    if (state.result.check?.status === "running") state.result.check = null;
    flush();
    renderResult();
    showView("result");
    window.scrollTo({ top: 0 });
  }
  function deleteSaved(id) {
    state.history = state.history.filter((x) => x.id !== id);
    if (state.currentId === id) { state.currentId = null; state.result = null; }
    flush();
    showView("history");
  }
  // Destructive buttons ask for a second click within four seconds.
  function confirmClick(btn, label, confirmLabel, action) {
    let armed = null;
    btn.addEventListener("click", () => {
      if (!armed) {
        btn.textContent = confirmLabel;
        armed = setTimeout(() => { armed = null; btn.textContent = label; }, 4000);
        return;
      }
      clearTimeout(armed); armed = null; btn.textContent = label;
      action();
    });
    return btn;
  }
  function renderHistory() {
    const list = $("history");
    $("btn-clear-history").hidden = !state.history.length;
    if (!state.history.length) {
      fill(list, h("div", { class: "panel muted" }, "No saved CVs yet. Every CV you write is saved here automatically."));
      return;
    }
    const fmt = (t) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const sorted = [...state.history].sort((a, b) => b.updatedAt - a.updatedAt);
    fill(list, sorted.map((entry) => {
      const fit = entry.result?.analysis?.matchAfter;
      return h("div", { class: "panel h-item" + (entry.id === state.currentId ? " current" : "") },
        h("div", {},
          h("p", { class: "h-title" }, entry.role + (entry.company ? " · " + entry.company : "")),
          h("p", { class: "muted small" }, `Last edited ${fmt(entry.updatedAt)}` + (fit != null ? ` · fit ${fit}` : "") + (entry.id === state.currentId ? " · open now" : ""))),
        h("div", { class: "row" },
          h("button", { class: "btn small primary", onclick: () => openSaved(entry.id) }, "Open"),
          confirmClick(h("button", { class: "btn small danger" }, "Delete"), "Delete", "Click again to delete", () => deleteSaved(entry.id))));
    }));
  }
  confirmClick($("btn-clear-history"), "Delete all", "Click again to delete all saved CVs", () => {
    state.history = [];
    state.currentId = null;
    state.result = null;
    flush();
    showView("history");
  });

  // ---------- New role / reset ----------
  function clearRoleState() {
    if (controller) controller.abort();
    flush();
    checkToken++;
    state.jd = "";
    state.isExample = false;
    state.questions = null;
    state.questionsSkipped = false;
    state.match = null;
    state.result = null;
    state.currentId = null;
    state.linkedin = null;
    $("jd-file").value = "";
    setFileStatus("jd-file-status", "You can drop the file here. Its text appears in the box below.");
    for (const id of ["status", "q-status", "pdf-status", "reset-status"]) setStatus(id, "");
    fill($("questions")); fill($("analysis")); fill($("editor")); fill($("check"));
    $("check").hidden = true;
    fill($("pages"), h("div", { class: "empty" }, "Your CV appears here after it is written."));
    $("page-count").textContent = "";
    $("match-panel").hidden = true;
  }
  function afterClear(message) {
    syncInputs();
    flush();
    showView("input");
    window.scrollTo({ top: 0 });
    setStatus("reset-status", message);
    $("jd").focus();
  }
  // New role: keeps the CV, extra information, saved answers and saved CVs.
  confirmClick($("btn-new-role"), "New role", "Click again to start a new role", () => {
    clearRoleState();
    afterClear("Ready for a new role. Your CV, extra information and earlier answers are kept.");
  });
  // Reset everything: also clears the CV, extra information and saved answers. Saved CVs stay.
  function resetAll() {
    clearRoleState();
    state.cvText = ""; state.cvFile = null; state.extra = ""; state.memory = [];
    $("cv-file").value = "";
    afterClear("Everything is cleared. Your saved CVs are still in the Saved CVs tab.");
  }
  confirmClick($("btn-reset"), "Reset everything", "Click again to clear everything", resetAll);
  $("btn-clear").onclick = () => { resetAll(); setStatus("reset-status", ""); };

  // ---------- Settings (API key, auto-score) ----------
  // Effort per call. Writing the CV gets the most thinking; transcribing scanned pages the least.
  const EFFORT = { questions: "medium", write: "high", check: "medium", rewrite: "medium" };
  let settings = { ...DEFAULT_SETTINGS };
  async function saveSettings(patch) {
    settings = { ...settings, ...patch };
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    renderKeyBanner();
  }
  function renderKeyBanner() {
    $("key-banner").hidden = !!settings.apiKey || !$("view-settings").hidden;
  }
  function renderSettings() {
    $("api-key").value = settings.apiKey;
    $("auto-score").checked = !!settings.autoScore;
    $("btn-remove-key").hidden = !settings.apiKey;
    renderKeyBanner();
  }
  $("btn-go-settings").onclick = () => showView("settings");
  document.addEventListener("click", (e) => { if (e.target.closest?.("[data-go-settings]")) showView("settings"); });
  $("btn-show-key").onclick = () => {
    const input = $("api-key");
    input.type = input.type === "password" ? "text" : "password";
    $("btn-show-key").textContent = input.type === "password" ? "Show" : "Hide";
  };
  $("btn-save-key").onclick = async () => {
    const key = $("api-key").value.trim();
    await saveSettings({ apiKey: key });
    renderSettings();
    setStatus("key-status", key ? "Key saved in this browser." : "Key removed.");
  };
  $("btn-test-key").onclick = async () => {
    const key = $("api-key").value.trim();
    if (!key) { setStatus("key-status", "Paste your API key first.", true); return; }
    $("btn-test-key").disabled = true;
    setStatus("key-status", `<span class="spinner"></span> Testing the key with Anthropic…`);
    try {
      await testKey(key);
      if (key !== settings.apiKey) await saveSettings({ apiKey: key });
      renderSettings();
      setStatus("key-status", "✓ The key works. It is saved in this browser.");
    } catch (e) {
      setStatus("key-status", errorText(toClaudeError(e)), true);
    } finally {
      $("btn-test-key").disabled = false;
    }
  };
  confirmClick($("btn-remove-key"), "Remove key", "Click again to remove the key", async () => {
    await saveSettings({ apiKey: "" });
    renderSettings();
    setStatus("key-status", "Key removed.");
  });
  $("auto-score").addEventListener("change", async (e) => {
    await saveSettings({ autoScore: e.target.checked });
    setStatus("auto-status", e.target.checked ? "Auto-score is on." : "Auto-score is off. Nothing is sent when you open LinkedIn jobs.");
  });

  // ---------- The LinkedIn job this role came from ----------
  let jobsCache = {};
  async function currentCvHash() {
    const text = cvMaterial(state);
    return text ? sha256(text) : null;
  }
  async function renderLinkedin() {
    const panel = $("linkedin-job");
    const li = state.linkedin;
    if (!li) { panel.hidden = true; return; }
    const job = jobsCache[li.jobId];
    const hash = await currentCvHash();
    const s = job?.score && job.score.cvHash === hash ? job.score : null;
    panel.hidden = false;
    fill(panel,
      h("div", { class: "row spread" },
        h("p", { class: "small" }, h("span", { class: "badge", style: "color:var(--ink)" }, "LinkedIn"),
          "The job description below comes from ", h("b", {}, [li.title, li.company].filter(Boolean).join(" · ") || "a LinkedIn job ad"), ". Check it and fix anything that looks off."),
        li.url ? h("a", { class: "small", href: li.url, target: "_blank", rel: "noopener" }, "Open the ad") : null),
      s ? h("div", { class: "quick-fit" },
        h("span", { class: "pill", style: `color:${scoreColor(s.score)}` }, `Fit ${s.score}/100`),
        h("span", { class: "verdict " + (s.verdict || "") }, QUICK_VERDICT_TEXT[s.verdict] || ""),
        h("span", { class: "muted small" }, s.model === "full"
          ? "From the full check of this ad (step 2)."
          : "Quick estimate shown on the toolbar icon. The next step checks the fit in depth and asks about gaps.")) : null);
  }

  // Unsaved work that loading another job would clear: answers typed for questions, or a job description typed by hand.
  function hasUnsavedWork() {
    if (state.result) return false; // the tailored CV is already in Saved CVs
    const answered = (state.questions || []).some((q) => q.none || q.answer.trim());
    const typedJd = state.jd.trim() && !state.isExample && !state.linkedin;
    return answered || !!typedJd;
  }
  function loadJob(job) {
    const wasExample = state.isExample;
    clearRoleState();
    if (wasExample) { state.cvText = ""; state.extra = ""; state.cvFile = null; }
    state.jd = composeJd(job);
    state.linkedin = { jobId: job.jobId, url: job.url, title: job.title, company: job.company, jdText: state.jd };
    $("pending-job").hidden = true;
    afterClear(wasExample
      ? "The job ad from LinkedIn is in step 1. Now add your CV in step 2."
      : "The job ad from LinkedIn is in step 1. Your CV, extra information and earlier answers are kept.");
  }
  async function handleOpenRequest(req) {
    if (!req) return;
    await chrome.storage.local.remove(OPEN_KEY);
    if (!req.jobId) return;
    jobsCache = await getJobs();
    const job = jobsCache[req.jobId];
    if (!job) return;
    if (state.linkedin?.jobId === job.jobId) { renderLinkedin(); return; } // the same ad: keep the work in progress
    if (!hasUnsavedWork()) { loadJob(job); return; }
    const panel = $("pending-job");
    panel.hidden = false;
    fill(panel,
      h("p", {}, "Load the job ad from LinkedIn: ", h("b", {}, [job.title, job.company].filter(Boolean).join(" · ") || "job " + job.jobId), "?"),
      h("p", { class: "muted small" }, "This replaces the job description and clears the unsaved answers of the current role. Your CV, extra information, saved answers and saved CVs are kept."),
      h("div", { class: "row" },
        h("button", { class: "btn primary small", onclick: () => loadJob(job) }, "Load the LinkedIn job"),
        h("button", { class: "btn small", onclick: () => { panel.hidden = true; } }, "Keep the current role")));
    showView("input");
  }

  // The full analysis replaces the toolbar's quick score for this ad, so both show the same number.
  async function reportScoreToToolbar() {
    const li = state.linkedin;
    if (!li || !state.match || state.jd.trim() !== li.jdText.trim()) return;
    const cvHash = await currentCvHash();
    if (!cvHash) return;
    chrome.runtime.sendMessage({ type: "app-score", jobId: li.jobId, score: state.match.score, verdict: state.match.verdict, cvHash }).catch(() => {});
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[OPEN_KEY]?.newValue) handleOpenRequest(changes[OPEN_KEY].newValue);
    if (changes[JOBS_KEY]) { jobsCache = changes[JOBS_KEY].newValue || {}; if (!$("view-input").hidden) renderLinkedin(); }
    if (changes[SETTINGS_KEY]) { settings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue || {}) }; renderKeyBanner(); }
  });

  // ---------- Boot ----------
  await load();
  settings = await getSettings();
  // A check that was running when the page closed did not finish.
  if (state.result?.check?.status === "running") state.result.check = null;
  syncInputs();
  if (state.questions) renderQuestions();
  if (state.result) { renderAnalysis(); renderCheck(); renderEditor(); }
  jobsCache = await getJobs();
  showView(state.result ? "result" : state.questions ? "questions" : "input");
  renderKeyBanner();
  await handleOpenRequest((await chrome.storage.local.get(OPEN_KEY))[OPEN_KEY]);
  if (!settings.apiKey && !state.result && !state.questions && state.isExample) showView("settings");
})();
