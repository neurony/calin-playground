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

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Cerere invalidă.", 400);
  }

  const jobDescription = String(form.get("jobDescription") ?? "");
  const extraInfo = String(form.get("extraInfo") ?? "");
  let cvText = String(form.get("cvText") ?? "");
  const languageRaw = String(form.get("language") ?? "auto");
  const language: OutputLanguage =
    languageRaw === "ro" || languageRaw === "en" ? languageRaw : "auto";
  const file = form.get("cvFile");

  if (!jobDescription.trim()) {
    return errorResponse("Adaugă job description-ul.", 400);
  }

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  let hasCvDocument = false;

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) {
      return errorResponse("Fișierul CV depășește 10 MB.", 400);
    }
    const name = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      // Claude reads the PDF directly (text and layout), no local parsing needed.
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: buffer.toString("base64"),
        },
        title: "Candidate CV",
      });
      hasCvDocument = true;
    } else if (name.endsWith(".docx")) {
      try {
        const { value } = await mammoth.extractRawText({ buffer });
        cvText = [value, cvText].filter((s) => s.trim()).join("\n\n");
      } catch {
        return errorResponse("Nu am putut citi fișierul DOCX.", 400);
      }
    } else if (name.endsWith(".txt") || name.endsWith(".md")) {
      cvText = [buffer.toString("utf8"), cvText].filter((s) => s.trim()).join("\n\n");
    } else {
      return errorResponse("Format nesuportat. Folosește PDF, DOCX, TXT sau MD.", 400);
    }
  }

  if (!hasCvDocument && !cvText.trim() && !extraInfo.trim()) {
    return errorResponse(
      "Adaugă CV-ul (fișier sau text) și/sau informații despre experiența ta.",
      400,
    );
  }

  content.push({
    type: "text",
    text: buildUserPrompt({ jobDescription, cvText, extraInfo, hasCvDocument, language }),
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
