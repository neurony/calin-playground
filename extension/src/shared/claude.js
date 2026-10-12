// Calls to the Anthropic API with the user's own key, straight from the extension.
import Anthropic from "@anthropic-ai/sdk";

export const MODELS = {
  score: "claude-haiku-5-5", // the toolbar badge (quick fit score)
  main: "claude-opus-5-5",   // questions, writing, completeness check, rewrites, scanned PDFs
};

export function makeClient(apiKey) {
  // The key belongs to the user and is kept in this browser profile only.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

export class ClaudeError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export const ERROR_TEXT = {
  no_key: "Add your Anthropic API key in Settings first.",
  auth: "Anthropic rejected the API key. Check it in Settings.",
  permission: "This API key is not allowed to use this model.",
  rate_limited: "Too many requests in a short time. Try again in a minute.",
  overloaded: "Claude is overloaded right now. Try again in a minute.",
  network: "Could not reach Anthropic. Check your internet connection.",
  invalid_json: "The answer did not come back in the expected format. Try again.",
  prompt_too_large: "The text is too long. Shorten the job description or the CV.",
  refused: "Claude declined this request.",
  truncated: "The answer was cut off before it finished. Try again.",
  cancelled: "Stopped.",
};

// Maps SDK errors to the codes above, so the UI can show a plain message.
export function toClaudeError(e) {
  if (e instanceof ClaudeError) return e;
  if (e instanceof Anthropic.APIUserAbortError || e?.name === "AbortError") return new ClaudeError("cancelled", ERROR_TEXT.cancelled);
  if (e instanceof Anthropic.AuthenticationError) return new ClaudeError("auth", ERROR_TEXT.auth);
  if (e instanceof Anthropic.PermissionDeniedError) return new ClaudeError("permission", ERROR_TEXT.permission);
  if (e instanceof Anthropic.RateLimitError) return new ClaudeError("rate_limited", ERROR_TEXT.rate_limited);
  if (e instanceof Anthropic.BadRequestError) {
    if (/prompt is too long|too many tokens/i.test(e.message || "")) return new ClaudeError("prompt_too_large", ERROR_TEXT.prompt_too_large);
    return new ClaudeError("bad_request", "Anthropic did not accept the request: " + (e.error?.error?.message || e.message));
  }
  if (e instanceof Anthropic.APIConnectionError) return new ClaudeError("network", ERROR_TEXT.network);
  if (e instanceof Anthropic.APIError && (e.status === 529 || e.status >= 500)) return new ClaudeError("overloaded", ERROR_TEXT.overloaded);
  if (e instanceof Anthropic.APIError) return new ClaudeError("api", `Anthropic error ${e.status ?? ""}: ${e.message}`);
  return new ClaudeError("unknown", e?.message || "Something went wrong.");
}

// The prompts ask for one JSON object and nothing else; still tolerate code fences or stray prose around it.
export function parseJsonText(text) {
  const t = (text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new ClaudeError("invalid_json", ERROR_TEXT.invalid_json);
}

const textOf = (message) => message.content.filter((b) => b.type === "text").map((b) => b.text).join("");

function checkStop(message) {
  if (message.stop_reason === "refusal") throw new ClaudeError("refused", ERROR_TEXT.refused);
  if (message.stop_reason === "max_tokens") throw new ClaudeError("truncated", ERROR_TEXT.truncated);
}

// One Opus call. `content` is a prompt string or an array of content blocks (text and images).
// Streams (long outputs), uses adaptive thinking, and lets the API retry a declined request on its
// recommended fallback model (server-side fallback, beta).
export async function callMain({ apiKey, content, effort = "medium", signal }) {
  if (!apiKey) throw new ClaudeError("no_key", ERROR_TEXT.no_key);
  try {
    const stream = makeClient(apiKey).beta.messages.stream({
      model: MODELS.main,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }],
    }, { signal });
    const message = await stream.finalMessage();
    checkStop(message);
    return textOf(message);
  } catch (e) {
    throw toClaudeError(e);
  }
}

export async function callMainJson(opts) {
  return parseJsonText(await callMain(opts));
}

// Checks a key without spending tokens: listing models needs a valid key.
export async function testKey(apiKey) {
  if (!apiKey) throw new ClaudeError("no_key", ERROR_TEXT.no_key);
  try {
    await makeClient(apiKey).models.list({ limit: 1 });
  } catch (e) {
    throw toClaudeError(e);
  }
}

// ---------- Quick fit score (toolbar badge) ----------
const SCORE_RULES = `Score from 0 to 100 how well the candidate's real experience, as shown in their CV, matches the job's requirements. Weigh must-have requirements much more than nice-to-haves. Be honest; do not inflate.
- "strong" (about 75+): good fit.
- "partial" (about 45-74): some important requirements are thin or missing.
- "weak" (below about 45): important must-haves are missing.`;

export function buildScorePrompt(jd, cv) {
  return [SCORE_RULES, "", "<job_description>", jd.trim(), "</job_description>", "", "<candidate_cv>", cv.trim(), "</candidate_cv>", "",
    `Reply with ONLY one JSON object: {"score": 0, "verdict": "strong" | "partial" | "weak"}`].join("\n");
}

const SCORE_SCHEMA = {
  type: "object",
  properties: { score: { type: "integer" }, verdict: { type: "string", enum: ["strong", "partial", "weak"] } },
  required: ["score", "verdict"],
  additionalProperties: false,
};

export async function quickScore({ apiKey, jd, cv }) {
  if (!apiKey) throw new ClaudeError("no_key", ERROR_TEXT.no_key);
  try {
    const message = await makeClient(apiKey).messages.create({
      model: MODELS.score,
      max_tokens: 2048,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCORE_SCHEMA } },
      messages: [{ role: "user", content: buildScorePrompt(jd, cv) }],
    });
    checkStop(message);
    const raw = parseJsonText(textOf(message));
    const score = Math.max(0, Math.min(100, Math.round(Number(raw.score))));
    if (!Number.isFinite(score)) throw new ClaudeError("invalid_json", ERROR_TEXT.invalid_json);
    const verdict = ["strong", "partial", "weak"].includes(raw.verdict) ? raw.verdict : null;
    return { score, verdict };
  } catch (e) {
    throw toClaudeError(e);
  }
}

// ---------- Finding the job ad in the text of any page or document (Haiku) ----------
const EXTRACT_RULES = `You get the text of a web page or document. Decide whether it is the advertisement of one specific job opening, and if it is, extract the ad.
- "isJobAd" is true only for the ad of one specific position. It is false for lists or search results with several jobs, company or careers pages without one specific ad, articles, CVs, profiles and anything else.
- "description": the full text of the ad exactly as written (about the role, responsibilities, requirements, benefits, about the company, how to apply), with its headings and bullet points. Leave out menus, navigation, cookie notices, footers, other job listings and anything else that is not part of the ad. Do not summarise, translate, correct or reword anything.
- "title", "company" and "location" as the ad gives them; an empty string when the ad does not say.
- When "isJobAd" is false, all the other fields are empty strings.`;

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    isJobAd: { type: "boolean" },
    title: { type: "string" },
    company: { type: "string" },
    location: { type: "string" },
    description: { type: "string" },
  },
  required: ["isJobAd", "title", "company", "location", "description"],
  additionalProperties: false,
};

export const MAX_PAGE_TEXT = 60000;

export function buildExtractPrompt({ url, title, text }) {
  return [EXTRACT_RULES, "", `<page url="${String(url || "").replace(/"/g, "")}" title="${String(title || "").replace(/"/g, "")}">`,
    String(text || "").slice(0, MAX_PAGE_TEXT), "</page>"].join("\n");
}

export async function extractJobAd({ apiKey, url, title, text }) {
  if (!apiKey) throw new ClaudeError("no_key", ERROR_TEXT.no_key);
  try {
    const message = await makeClient(apiKey).messages.create({
      model: MODELS.score,
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
      messages: [{ role: "user", content: buildExtractPrompt({ url, title, text }) }],
    });
    checkStop(message);
    const raw = parseJsonText(textOf(message));
    const str = (v) => (typeof v === "string" ? v.trim() : "");
    const description = str(raw.description);
    return { isJobAd: raw.isJobAd === true && description.length >= 100, title: str(raw.title), company: str(raw.company), location: str(raw.location), text: description };
  } catch (e) {
    throw toClaudeError(e);
  }
}
