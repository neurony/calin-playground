import type Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import type { OutputLanguage } from "./schema";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type Upload =
  | { document?: Anthropic.Beta.BetaContentBlockParam; text?: string }
  | { error: string };

// PDFs go to Claude as documents (it reads text and layout directly);
// DOCX/TXT/MD are converted to plain text.
async function readUpload(entry: FormDataEntryValue | null, title: string): Promise<Upload> {
  if (!(entry instanceof File) || entry.size === 0) return {};
  if (entry.size > MAX_FILE_BYTES) return { error: `Fișierul ${entry.name} depășește 10 MB.` };

  const name = entry.name.toLowerCase();
  const buffer = Buffer.from(await entry.arrayBuffer());

  if (name.endsWith(".pdf") || entry.type === "application/pdf") {
    return {
      document: {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
        title,
      },
    };
  }
  if (name.endsWith(".docx")) {
    try {
      const { value } = await mammoth.extractRawText({ buffer });
      return { text: value };
    } catch {
      return { error: `Nu am putut citi fișierul ${entry.name}.` };
    }
  }
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return { text: buffer.toString("utf8") };
  }
  return { error: `Format nesuportat (${entry.name}). Folosește PDF, DOCX, TXT sau MD.` };
}

export type SourceInput = {
  jobDescription: string;
  cvText: string;
  extraInfo: string;
  hasJdDocument: boolean;
  hasCvDocument: boolean;
  language: OutputLanguage;
};

export type ParsedInputs =
  | { documents: Anthropic.Beta.BetaContentBlockParam[]; source: SourceInput }
  | { error: string };

// Reads the job description and candidate material from the form, shared by
// the questions and generation endpoints.
export async function parseInputs(form: FormData): Promise<ParsedInputs> {
  let jobDescription = String(form.get("jobDescription") ?? "");
  const extraInfo = String(form.get("extraInfo") ?? "");
  let cvText = String(form.get("cvText") ?? "");
  const languageRaw = String(form.get("language") ?? "auto");
  const language: OutputLanguage =
    languageRaw === "ro" || languageRaw === "en" ? languageRaw : "auto";

  const documents: Anthropic.Beta.BetaContentBlockParam[] = [];

  const jd = await readUpload(form.get("jdFile"), "Job description");
  if ("error" in jd) return jd;
  if (jd.document) documents.push(jd.document);
  if (jd.text) jobDescription = [jd.text, jobDescription].filter((s) => s.trim()).join("\n\n");
  const hasJdDocument = Boolean(jd.document);

  if (!hasJdDocument && !jobDescription.trim()) {
    return { error: "Adaugă job description-ul (fișier sau text)." };
  }

  const cv = await readUpload(form.get("cvFile"), "Candidate CV");
  if ("error" in cv) return cv;
  if (cv.document) documents.push(cv.document);
  if (cv.text) cvText = [cv.text, cvText].filter((s) => s.trim()).join("\n\n");
  const hasCvDocument = Boolean(cv.document);

  if (!hasCvDocument && !cvText.trim() && !extraInfo.trim()) {
    return { error: "Adaugă CV-ul (fișier sau text) și/sau informații despre experiența ta." };
  }

  return {
    documents,
    source: { jobDescription, cvText, extraInfo, hasJdDocument, hasCvDocument, language },
  };
}
