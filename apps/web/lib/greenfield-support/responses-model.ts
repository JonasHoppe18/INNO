import type { GreenfieldModel, ModelRequest, ModelResponse, ToolCall } from "./types";
import type { StrictToolDefinition } from "./tool-contracts";

export interface ResponsesApiModelOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function toResponsesTool(tool: StrictToolDefinition) {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    strict: true,
    parameters: tool.parameters,
  };
}

function parseResponse(payload: any): ModelResponse {
  const functionCall = Array.isArray(payload?.output)
    ? payload.output.find((item: any) => item?.type === "function_call")
    : null;
  if (functionCall) {
    const toolCall: ToolCall = {
      callId: String(functionCall.call_id || functionCall.id || ""),
      name: String(functionCall.name || ""),
      arguments: String(functionCall.arguments || "{}"),
    };
    if (!toolCall.callId || !toolCall.name) throw new Error("Responses API returned an incomplete function call.");
    return { type: "tool_call", toolCall, usage: payload?.usage ?? null, raw: payload };
  }
  const text = typeof payload?.output_text === "string"
    ? payload.output_text
    : (Array.isArray(payload?.output)
      ? payload.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : []).filter((part: any) => part?.type === "output_text").map((part: any) => part.text).join("")
      : "");
  return { type: "text", text: String(text || ""), usage: payload?.usage ?? null, raw: payload };
}

/** Optional real model adapter. No key means the route fails safely; tests use a scripted model. */
export function createResponsesApiModel(options: ResponsesApiModelOptions = {}): GreenfieldModel {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.2";
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      if (!apiKey) throw new Error("OPENAI_API_KEY is missing.");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/responses`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            instructions: request.instructions,
            input: request.input,
            tools: request.tools.map(toResponsesTool),
            parallel_tool_calls: false,
            store: false,
          }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error?.message || `Responses API failed (${response.status}).`);
        return parseResponse(payload);
      } catch (error: any) {
        if (error?.name === "AbortError") throw new Error("Responses API timed out.");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
