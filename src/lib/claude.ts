import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { NextResponse } from "next/server";
import type { z } from "zod";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const client = new Anthropic();

export function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// One structured-output request to Claude, answered as a JSON response
// (the parsed object, or {error} with a message for the user).
export async function respondWithStructuredOutput<T extends z.ZodType>(options: {
  schema: T;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  maxTokens: number;
}) {
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: options.maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "high",
        format: betaZodOutputFormat(options.schema),
      },
      system: options.system,
      messages: [{ role: "user", content: options.content }],
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
