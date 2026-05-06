const OPENAI_CHAT_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";

export type JsonSchema = Record<string, unknown>;

export function shouldUseResponsesApi(model: string): boolean {
  return /^gpt-5(?:\.|$|-)/.test(model);
}

function extractResponsesText(data: Record<string, unknown>): string {
  const direct = (data as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) return direct;

  const output = (data as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";

  const parts: string[] = [];
  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = (part as { text?: unknown })?.text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("").trim();
}

export async function callOpenAIJson<T>({
  model,
  systemPrompt,
  userPrompt,
  maxTokens,
  schema,
  schemaName,
  temperature = 0,
}: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  schema: JsonSchema;
  schemaName: string;
  temperature?: number;
}): Promise<T> {
  const useResponsesApi = shouldUseResponsesApi(model);
  const resp = await fetch(
    useResponsesApi ? OPENAI_RESPONSES_API_URL : OPENAI_CHAT_API_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify(
        useResponsesApi
          ? {
            model,
            instructions: systemPrompt,
            input: userPrompt,
            reasoning: { effort: "minimal" },
            max_output_tokens: maxTokens,
            store: false,
            text: {
              format: {
                type: "json_schema",
                name: schemaName,
                strict: true,
                schema,
              },
            },
          }
          : {
            model,
            temperature,
            max_tokens: maxTokens,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          },
      ),
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `OpenAI JSON API error: ${resp.status} ${text.slice(0, 500)}`,
    );
  }

  const data = await resp.json();
  const content = useResponsesApi
    ? extractResponsesText(data)
    : data.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error(`OpenAI JSON API returned empty content for ${model}`);
  }
  return JSON.parse(content) as T;
}
