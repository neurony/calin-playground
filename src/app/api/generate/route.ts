import { errorResponse, respondWithStructuredOutput } from "@/lib/claude";
import { parseInputs } from "@/lib/inputs";
import { buildUserPrompt, SYSTEM_PROMPT } from "@/lib/prompt";
import { AnswerSchema, GenerationSchema, type Answer } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseAnswers(raw: FormDataEntryValue | null): Answer[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = AnswerSchema.array().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Cerere invalidă.", 400);
  }

  const inputs = await parseInputs(form);
  if ("error" in inputs) return errorResponse(inputs.error, 400);

  const answers = parseAnswers(form.get("answers"));

  return respondWithStructuredOutput({
    schema: GenerationSchema,
    system: SYSTEM_PROMPT,
    content: [
      ...inputs.documents,
      { type: "text", text: buildUserPrompt(inputs.source, answers) },
    ],
    maxTokens: 16000,
  });
}
