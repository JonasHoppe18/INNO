import { REPLY_ONLY_JSON_SCHEMA } from "./openai-schema.ts";
import type { ReplyStrategy } from "./reply-strategy.ts";
import type { ExecutionState } from "./reply-safety.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

export type GenerateReplyFromStrategyInput = {
  customerMessage: string;
  customerFirstName?: string | null;
  replyStrategy: ReplyStrategy;
  executionState: ExecutionState;
  factSummary: string;
  technicalKnowledgeSummary?: string | null;
  technicalDiagnosticFacts?: string[];
  policySummary?: string | null;
  policyExcerpt?: string | null;
  productSummary?: string | null;
  generalKnowledgeSummary?: string | null;
  learnedStyle?: string | null;
  personaInstructions?: string | null;
};

export async function generateReplyFromStrategy(
  input: GenerateReplyFromStrategyInput,
): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;
  const forbidReturnOrRefundSuggestions = (input.replyStrategy.forbidden_claims || []).includes(
    "suggest_return_or_refund",
  );
  const hasTechnicalDiagnosticFacts = Array.isArray(input.technicalDiagnosticFacts) &&
    input.technicalDiagnosticFacts.length > 0;

  const system = [
    "You are a customer support reply generator.",
    "Return JSON only.",
    "Write the customer-facing draft text only.",
    "Do not propose, invent, or choose actions.",
    "Use only the approved context supplied in the prompt.",
    "If a fact is not in APPROVED FACTS, TECHNICAL SUPPORT FACTS, POLICY, PRODUCT FACTS, or GENERAL KNOWLEDGE, do not claim it.",
    input.executionState !== "executed"
      ? "Do not claim that any action has already been completed."
      : "You may confirm completion only if it is explicitly supported by the approved facts.",
    forbidReturnOrRefundSuggestions
      ? "Do not suggest returns, refunds, exchanges, replacements, or warranty claims unless they are explicitly supported by the approved facts or requested by the reply strategy."
      : "",
    hasTechnicalDiagnosticFacts
      ? "When APPROVED TROUBLESHOOTING FACTS are present, prioritize them over broader technical knowledge and use them to make the reply more concrete."
      : "",
    "Do not add a signature.",
  ].join("\n");

  const approvedFactsText = (input.replyStrategy.approved_facts || [])
    .map((item) => `- ${item.key}: ${item.value}`)
    .join("\n");
  const technicalDiagnosticFactsText = (input.technicalDiagnosticFacts || [])
    .map((item) => `- ${item}`)
    .join("\n");

  const prompt = [
    "CUSTOMER MESSAGE:",
    input.customerMessage || "(empty)",
    "",
    "REPLY STRATEGY:",
    `Mode: ${input.replyStrategy.mode}`,
    `Execution state: ${input.executionState}`,
    `Goal: ${input.replyStrategy.goal}`,
    input.replyStrategy.must_include.length
      ? `Must include:\n${input.replyStrategy.must_include.map((item) => `- ${item}`).join("\n")}`
      : "",
    input.replyStrategy.must_not_include.length
      ? `Must not include:\n${input.replyStrategy.must_not_include.map((item) => `- ${item}`).join("\n")}`
      : "",
    input.replyStrategy.allowed_claims.length
      ? `Allowed claims:\n${input.replyStrategy.allowed_claims.map((item) => `- ${item}`).join("\n")}`
      : "",
    input.replyStrategy.forbidden_claims.length
      ? `Forbidden claims:\n${input.replyStrategy.forbidden_claims.map((item) => `- ${item}`).join("\n")}`
      : "",
    input.replyStrategy.open_questions.length
      ? `Open questions:\n${input.replyStrategy.open_questions.map((item) => `- ${item}`).join("\n")}`
      : "",
    "",
    "APPROVED FACTS:",
    approvedFactsText || "- none",
    input.factSummary ? `FACT SUMMARY:\n${input.factSummary}` : "",
    technicalDiagnosticFactsText ? `APPROVED TROUBLESHOOTING FACTS:\n${technicalDiagnosticFactsText}` : "",
    input.technicalKnowledgeSummary ? `TECHNICAL SUPPORT FACTS:\n${input.technicalKnowledgeSummary}` : "",
    input.policySummary ? `POLICY SUMMARY:\n${input.policySummary}` : "",
    input.policyExcerpt ? `POLICY EXCERPT:\n${input.policyExcerpt}` : "",
    input.productSummary ? `PRODUCT FACTS:\n${input.productSummary}` : "",
    input.generalKnowledgeSummary ? `GENERAL KNOWLEDGE:\n${input.generalKnowledgeSummary}` : "",
    input.learnedStyle ? `STYLE HINTS:\n${input.learnedStyle}` : "",
    input.personaInstructions ? `PERSONA NOTES:\n${input.personaInstructions}` : "",
    input.customerFirstName ? `Use the first name if natural: ${input.customerFirstName}` : "",
    "",
    "Return JSON with the reply field only.",
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    model: OPENAI_MODEL,
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: REPLY_ONLY_JSON_SCHEMA,
    },
    max_tokens: 700,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content);
    return typeof parsed?.reply === "string" ? parsed.reply.trim() : null;
  } catch {
    return null;
  }
}
