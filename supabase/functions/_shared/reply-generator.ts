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
  const knownOrderReference = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "order_reference" && String(fact?.value || "").trim()
  );
  const ongoingReturnFlow = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "ongoing_return_or_replacement_flow" && String(fact?.value || "") === "true"
  );
  const addressClarificationIssue = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "address_clarification_issue" && String(fact?.value || "") === "true"
  );
  const addressResolutionPreferred = (input.replyStrategy.approved_facts || []).some((fact) =>
    String(fact?.key || "") === "address_resolution_preferred" && String(fact?.value || "") === "true"
  );
  const directReturnContinuationQuestion = knownOrderReference &&
    (
      /\b(?:how do i send .* back|how do i return .*|send the old .* back|return the old .*|how do i send it back now that i (?:got|received) the new one)\b/i
        .test(input.customerMessage || "") ||
      /\b(?:hvordan får jeg sendt det gamle retur|hvordan sender jeg det tilbage|hvordan sender jeg det gamle headset tilbage|hvordan returnerer jeg det gamle|sende den gamle tilbage)\b/i
        .test(input.customerMessage || "")
    );

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
    "The customer is already writing in the active support thread.",
    "Do not tell the customer to email support again, contact the same support email address, write to us by email, or reach out via email.",
    "If continued contact is needed in this same thread, say things like 'reply here' or 'let us know here' instead.",
    "Do not ask the customer to notify, inform, or contact us again about the same return, request, or support issue they are already raising in this thread.",
    "You may ask for a missing detail such as order number, serial number, preferred date, or timing, but do not ask them to simply notify us again.",
    knownOrderReference
      ? "An order is already matched in approved context. Do not ask again for order number, purchase name, or other basic identity details unless a narrower missing detail is explicitly required."
      : "",
    ongoingReturnFlow
      ? "This is an ongoing return or replacement thread. Answer the practical logistics question directly instead of treating it like a fresh return-policy request."
      : "",
    ongoingReturnFlow
      ? "Prefer short practical return instructions early in the reply. Do not default to generic return-policy wording."
      : "",
    directReturnContinuationQuestion
      ? "The customer is asking a direct practical send-back question in an ongoing order-linked thread. Answer with practical return instructions directly and do not ask again for order number, purchase name, or generic return intake details."
      : "",
    directReturnContinuationQuestion || ongoingReturnFlow
      ? "Do not mention who pays return shipping unless the customer asks about shipping cost or the approved context explicitly requires that detail for this reply."
      : "",
    addressClarificationIssue
      ? "This is an address or shipping-address clarification case, not a tracking-status request. Do not use tracking-update fallback wording like 'there is no new tracking update'."
      : "",
    addressClarificationIssue
      ? "Do not invent the exact address field that is wrong unless it is explicitly grounded in APPROVED FACTS, FACT SUMMARY, or CUSTOMER MESSAGE."
      : "",
    addressResolutionPreferred
      ? "Do not reply with vague wording like 'I will check' or 'we will check'. If the current address is already known to be unusable from the thread context, move directly to the practical next step by asking for an alternative usable shipping address."
      : "",
    addressResolutionPreferred
      ? "Use grounded operational wording for address-resolution cases. Prefer phrasing like 'our shipping broker is unable to accept the address as entered' or 'we're unable to proceed with the shipment using the address in its current form'. Do not say 'this address cannot be used for shipping' unless that stronger claim is explicitly grounded."
      : "",
    hasTechnicalDiagnosticFacts
      ? "When APPROVED TROUBLESHOOTING FACTS are present, prioritize them over broader technical knowledge and use them to make the reply more concrete."
      : "",
    hasTechnicalDiagnosticFacts && input.replyStrategy.mode === "ask_for_missing_info"
      ? "For technical support replies, if APPROVED TROUBLESHOOTING FACTS contain relevant next steps, use 1-2 of those concrete troubleshooting steps before asking broader follow-up questions."
      : "",
    hasTechnicalDiagnosticFacts
      ? "Do not ignore a relevant troubleshooting step in APPROVED TROUBLESHOOTING FACTS and fall back to generic advice."
      : "",
    hasTechnicalDiagnosticFacts
      ? "Place the first concrete troubleshooting step early in the reply, immediately after briefly acknowledging the issue."
      : "",
    "Do not ask the customer to repeat or reconfirm facts they already clearly stated in CUSTOMER MESSAGE or APPROVED FACTS.",
    "If the customer already said things are updated, already retried steps, or already described the current setup or symptom pattern, do not ask those same questions again unless you need a narrower missing detail.",
    "If CUSTOMER MESSAGE or APPROVED FACTS already indicate updated/opdateret firmware or software, do not ask whether firmware or software is updated again.",
    "If CUSTOMER MESSAGE or APPROVED FACTS already indicate same frequency/samme frekvens or equivalent pairing/setup status, do not ask about frequency or basic setup confirmation again.",
    "If CUSTOMER MESSAGE or APPROVED FACTS already indicate the customer tried many things or already retried steps, do not ask whether they tried basic troubleshooting again.",
    "When follow-up questions are still needed, ask only for genuinely missing diagnostic details.",
    hasTechnicalDiagnosticFacts
      ? "If APPROVED TROUBLESHOOTING FACTS already provide a useful next step, do not lead with generic diagnostic questions."
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
    ongoingReturnFlow
      ? "Reply structure: 1) answer the practical send-back/return question directly, 2) use the known order context if helpful, 3) only ask for a detail if something is genuinely still missing."
      : "",
    directReturnContinuationQuestion && !ongoingReturnFlow
      ? "Reply structure: 1) answer the practical send-back question directly, 2) use the known order context if helpful, 3) do not ask again for order number or purchase name."
      : "",
    addressClarificationIssue
      ? "Reply structure: 1) acknowledge the clarification, 2) restate the address details already provided, 3) explain in grounded operational terms that we cannot proceed with the shipment using the address as currently entered, 4) ask directly for an alternative usable shipping address, 5) do not say 'I will check'."
      : "",
    hasTechnicalDiagnosticFacts && input.replyStrategy.mode === "ask_for_missing_info"
      ? "Reply structure: 1) acknowledge the reported issue briefly, 2) give one concrete troubleshooting step from APPROVED TROUBLESHOOTING FACTS, 3) ask only 1-2 genuinely missing diagnostic questions if needed."
      : "",
    "Known customer facts from CUSTOMER MESSAGE and APPROVED FACTS are already established. Do not ask the customer to reconfirm them.",
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
    technicalDiagnosticFactsText ? `APPROVED TROUBLESHOOTING FACTS:\n${technicalDiagnosticFactsText}` : "",
    input.factSummary ? `FACT SUMMARY:\n${input.factSummary}` : "",
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
