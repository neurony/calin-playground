// Service worker: the toolbar badge (quick fit score for the LinkedIn job open in a tab) and the app window.
import { quickScore } from "./shared/claude.js";
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

const pending = new Map(); // tabId -> jobId, newest last
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
  pending.set(tabId, jobId);
  pump();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (pending.size) {
      const [tabId, jobId] = [...pending.entries()].pop(); // the most recent request first
      pending.delete(tabId);
      if ((await loadTabJobs())[tabId] !== jobId) continue; // the tab moved on
      const settings = await getSettings();
      const cv = await currentCv();
      const job = (await getJobs())[jobId];
      if (!settings.autoScore || !settings.apiKey || !cv || !job) { await evaluate(tabId); continue; }
      if (job.score && job.score.cvHash === cv.hash) { await showScore(tabId, job.score); continue; } // scored meanwhile
      try {
        const { score, verdict } = await quickScore({ apiKey: settings.apiKey, jd: composeJd(job), cv: cv.text });
        const entry = { score, verdict: verdict || verdictFor(score), cvHash: cv.hash, model: "quick", at: Date.now() };
        await updateJobs((jobs) => { if (jobs[jobId]) jobs[jobId].score = entry; });
        await refreshTabsShowing(jobId);
      } catch (e) {
        if ((await loadTabJobs())[tabId] === jobId) await setBadge(tabId, "!", "#b42318", "CV Tailor: " + (e.message || "the score failed") + " Click to open.");
      }
    }
  } finally {
    running = false;
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

// ---------- Messages from the LinkedIn content script and the app ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id;
    if (msg?.type === "job-page" && tabId != null && msg.job?.jobId) {
      const j = msg.job;
      await updateJobs((jobs) => {
        const prev = jobs[j.jobId] || {};
        const text = String(j.text || "").slice(0, 30000);
        // A changed ad text invalidates its score.
        const score = prev.text && prev.text !== text ? null : prev.score || null;
        jobs[j.jobId] = { jobId: j.jobId, url: String(j.url || ""), title: String(j.title || ""), company: String(j.company || ""), location: String(j.location || ""), text, capturedAt: Date.now(), score };
      });
      await setTabJob(tabId, j.jobId);
      await evaluate(tabId);
    } else if (msg?.type === "not-job" && tabId != null) {
      await setTabJob(tabId, null);
      pending.delete(tabId);
      await clearBadge(tabId);
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
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => { pending.delete(tabId); await setTabJob(tabId, null); });
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

// ---------- The app window ----------
async function findAppWindow() {
  const { appWindowId } = await chrome.storage.session.get("appWindowId");
  if (appWindowId == null) return null;
  try { return await chrome.windows.get(appWindowId); } catch { return null; }
}

async function openAppForTab(tab) {
  const jobId = tab?.id != null ? (await loadTabJobs())[tab.id] || null : null;
  await chrome.storage.local.set({ [OPEN_KEY]: { jobId, at: Date.now() } });
  const existing = await findAppWindow();
  if (existing) {
    await chrome.windows.update(existing.id, { focused: true, state: existing.state === "minimized" ? "normal" : undefined });
    return existing.id;
  }
  // As large as the browser window it is opened from (Chrome refuses windows mostly off-screen).
  const url = chrome.runtime.getURL("app.html");
  let win;
  try {
    const w = tab?.windowId != null ? await chrome.windows.get(tab.windowId) : await chrome.windows.getLastFocused();
    const width = Math.min(1500, Math.max((w.width || 1400) - 80, Math.min(w.width || 1400, 900)));
    const height = Math.max(Math.min(700, w.height || 700), (w.height || 900) - 60);
    const left = Math.max(0, Math.round((w.left || 0) + ((w.width || width) - width) / 2));
    const top = Math.max(0, (w.top || 0) + Math.round(((w.height || height) - height) / 2));
    win = await chrome.windows.create({ url, type: "popup", focused: true, width, height, left, top });
  } catch {
    win = await chrome.windows.create({ url, type: "popup", focused: true });
  }
  await chrome.storage.session.set({ appWindowId: win.id });
  return win.id;
}
chrome.windows.onRemoved.addListener(async (id) => {
  const { appWindowId } = await chrome.storage.session.get("appWindowId");
  if (appWindowId === id) await chrome.storage.session.remove("appWindowId");
});
chrome.action.onClicked.addListener((tab) => { openAppForTab(tab); });

// Exposed for the automated tests (they cannot click the toolbar button).
globalThis.cvTailor = { openAppForTab, evaluate };
