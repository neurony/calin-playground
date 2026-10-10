// Storage keys and helpers shared by the app page and the service worker.
// Everything lives in chrome.storage.local (the manifest asks for unlimitedStorage).

export const STORE_KEY = "cv-tailor-artifact-v2"; // the app's state (same shape as the artifact's)
export const SETTINGS_KEY = "settings";           // { apiKey, autoScore }
export const JOBS_KEY = "jobs";                   // { [jobId]: { jobId, url, title, company, text, capturedAt, score } }
export const OPEN_KEY = "openRequest";            // { jobId, at }: set by the toolbar button, read by the app
export const MAX_JOBS = 150;

export const DEFAULT_SETTINGS = { apiKey: "", autoScore: true };

export async function getSettings() {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(got[SETTINGS_KEY] || {}) };
}

export async function getAppState() {
  const got = await chrome.storage.local.get(STORE_KEY);
  return got[STORE_KEY] || null;
}

export async function getJobs() {
  const got = await chrome.storage.local.get(JOBS_KEY);
  return got[JOBS_KEY] || {};
}

// The candidate's CV as used by the quick score: the uploaded file's text and the pasted text.
// The app's built-in example data does not count as a CV.
export function cvMaterial(state) {
  if (!state || state.isExample) return "";
  const parts = [];
  if (state.cvFile?.text?.trim()) parts.push(state.cvFile.text.trim());
  if (state.cvText?.trim()) parts.push(state.cvText.trim());
  return parts.join("\n\n");
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The job ad as one text: what the quick score sees and what the app puts in the job description box.
export function composeJd(job) {
  const head = [job.title, job.company, job.location].map((x) => (x || "").trim()).filter(Boolean);
  return [...head, head.length ? "" : null, (job.text || "").trim()].filter((x) => x != null).join("\n").trim();
}

export const verdictFor = (score) => (score >= 75 ? "strong" : score >= 45 ? "partial" : "weak");
export const VERDICT_TEXT = { strong: "Strong fit", partial: "Partial fit", weak: "Weak fit" };
export const badgeColor = (score) => (score >= 75 ? "#1d7a46" : score >= 45 ? "#2563eb" : "#d9631e");
