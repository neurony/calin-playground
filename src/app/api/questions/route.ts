import { errorResponse, respondWithStructuredOutput } from "@/lib/claude";
import { parseInputs } from "@/lib/inputs";
import { buildQuestionsPrompt, QUESTIONS_SYSTEM_PROMPT } from "@/lib/prompt";
import { QuestionsSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Cerere invalidă.", 400);
  }

  const inputs = await parseInputs(form);
  if ("error" in inputs) return errorResponse(inputs.error, 400);

  return respondWithStructuredOutput({
    schema: QuestionsSchema,
    system: QUESTIONS_SYSTEM_PROMPT,
    content: [...inputs.documents, { type: "text", text: buildQuestionsPrompt(inputs.source) }],
    maxTokens: 8000,
  });
}
