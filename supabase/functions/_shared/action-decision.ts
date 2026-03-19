import { ACTION_DECISION_JSON_SCHEMA } from "./openai-schema.ts";
import type { AutomationAction } from "./automation-actions.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

export type ActionDecision = {
  version: 1;
  summary: string;
  actions: AutomationAction[];
};

export type DecideActionsInput = {
  customerMessage: string;
  workflow: string;
  workflowCategory: string;
  automationGuidance: string;
  orderSummary: string;
  factSummary: string;
  policyRules?: string | null;
  policySummary?: string | null;
  policyExcerpt?: string | null;
  productSummary?: string | null;
  matchedSubjectNumber?: string | null;
  customerFirstName?: string | null;
};

export async function decideActions(input: DecideActionsInput): Promise<ActionDecision> {
  if (!OPENAI_API_KEY) {
    return { version: 1, summary: "openai_unavailable", actions: [] };
  }

  const system = [
    "You are an action decision engine for customer support.",
    "Return JSON only.",
    "Decide whether structured support actions should be proposed.",
    "Do not write a customer reply.",
    "Use facts and policy context only.",
    "Do not use style or historical examples to justify actions.",
    `Workflow: ${input.workflow}. Category: ${input.workflowCategory}.`,
    "If the safest outcome is reply-only, return an empty actions array.",
    "Never invent missing fields in action payloads.",
    "If order identity is ambiguous or payload is incomplete, prefer no action.",
    "Allowed actions: update_shipping_address, cancel_order, refund_order, create_exchange_request, change_shipping_method, hold_or_release_fulfillment, edit_line_items, update_customer_contact, add_note, add_tag, add_internal_note_or_tag, resend_confirmation_or_invoice, lookup_order_status, fetch_tracking.",
    "Prefer read-only actions for status and tracking cases.",
    "Respect automation guidance when deciding whether a mutation should be proposed.",
  ].join("\n");

  const prompt = [
    "CUSTOMER MESSAGE:",
    input.customerMessage || "(empty)",
    "",
    "FACT CONTEXT:",
    input.factSummary || "No fact context available.",
    "",
    "ORDER SUMMARY:",
    input.orderSummary || "No order summary available.",
    "",
    input.policyRules ? `POLICY RULES:\n${input.policyRules}` : "",
    input.policySummary ? `POLICY SUMMARY:\n${input.policySummary}` : "",
    input.policyExcerpt ? `POLICY EXCERPT:\n${input.policyExcerpt}` : "",
    input.productSummary ? `PRODUCT FACTS:\n${input.productSummary}` : "",
    input.matchedSubjectNumber
      ? `MATCHED ORDER NUMBER IN SUBJECT: #${input.matchedSubjectNumber}`
      : "",
    `AUTOMATION GUIDANCE:\n${input.automationGuidance}`,
    "",
    "Return JSON with a short summary and an actions array.",
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    model: OPENAI_MODEL,
    temperature: 0.1,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: ACTION_DECISION_JSON_SCHEMA,
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
  if (!content || typeof content !== "string") {
    return { version: 1, summary: "missing_response_content", actions: [] };
  }
  try {
    const parsed = JSON.parse(content);
    return {
      version: 1,
      summary: typeof parsed?.summary === "string" ? parsed.summary : "",
      actions: Array.isArray(parsed?.actions)
        ? parsed.actions.filter((action: any) => typeof action?.type === "string")
        : [],
    };
  } catch {
    return { version: 1, summary: "invalid_json_response", actions: [] };
  }
}
