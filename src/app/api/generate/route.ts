import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import mammoth from "mammoth";
import { NextResponse } from "next/server";
import { buildUserPrompt, SYSTEM_PROMPT } from "@/lib/prompt";
import { GenerationSchema, type OutputLanguage } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const client = new Anthropic();

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

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

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Cerere invalidă.", 400);
  }

  let jobDescription = String(form.get("jobDescription") ?? "");
  const extraInfo = String(form.get("extraInfo") ?? "");
  let cvText = String(form.get("cvText") ?? "");
  const languageRaw = String(form.get("language") ?? "auto");
  const language: OutputLanguage =
    languageRaw === "ro" || languageRaw === "en" ? languageRaw : "auto";

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];

  const jd = await readUpload(form.get("jdFile"), "Job description");
  if ("error" in jd) return errorResponse(jd.error, 400);
  if (jd.document) content.push(jd.document);
  if (jd.text) jobDescription = [jd.text, jobDescription].filter((s) => s.trim()).join("\n\n");
  const hasJdDocument = Boolean(jd.document);

  if (!hasJdDocument && !jobDescription.trim()) {
    return errorResponse("Adaugă job description-ul (fișier sau text).", 400);
  }

  const cv = await readUpload(form.get("cvFile"), "Candidate CV");
  if ("error" in cv) return errorResponse(cv.error, 400);
  if (cv.document) content.push(cv.document);
  if (cv.text) cvText = [cv.text, cvText].filter((s) => s.trim()).join("\n\n");
  const hasCvDocument = Boolean(cv.document);

  if (!hasCvDocument && !cvText.trim() && !extraInfo.trim()) {
    return errorResponse(
      "Adaugă CV-ul (fișier sau text) și/sau informații despre experiența ta.",
      400,
    );
  }

  content.push({
    type: "text",
    text: buildUserPrompt({
      jobDescription,
      cvText,
      extraInfo,
      hasJdDocument,
      hasCvDocument,
      language,
    }),
  });

  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "high",
        format: betaZodOutputFormat(GenerationSchema),
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return errorResponse("Modelul a refuzat cererea. Încearcă să reformulezi inputul.", 422);
    }
    if (response.stop_reason === "max_tokens") {
      return errorResponse(
        "Răspunsul a fost trunchiat (prea lung). Încearcă un input mai scurt.",
        502,
      );
    }
    if (!response.parsed_output) {
      return errorResponse("Răspunsul modelului nu a putut fi interpretat.", 502);
    }

    return NextResponse.json(response.parsed_output);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return errorResponse("Cheie API invalidă. Verifică ANTHROPIC_API_KEY în .env.local.", 500);
    }
    if (error instanceof Anthropic.RateLimitError) {
      return errorResponse("Limită de rate atinsă. Încearcă din nou peste puțin timp.", 429);
    }
    if (error instanceof Anthropic.BadRequestError) {
      return errorResponse(`Cerere respinsă de API: ${error.message}`, 400);
    }
    if (error instanceof Anthropic.APIError) {
      return errorResponse(`Eroare API (${error.status ?? "rețea"}): ${error.message}`, 502);
    }
    console.error(error);
    const detail = error instanceof Error ? error.message : String(error);
    return errorResponse(
      `Eroare la generare: ${detail}. Verifică dacă ANTHROPIC_API_KEY este setată în .env.local.`,
      500,
    );
  }
}
