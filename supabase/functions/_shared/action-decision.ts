import { ACTION_DECISION_JSON_SCHEMA } from "./openai-schema.ts";
import type { AutomationAction } from "./automation-actions.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

export type ActionDecision = {
  version: 1;
  summary: string;
  actions: AutomationAction[];
  address_update_candidate?: boolean;
  address_update_action_selected?: boolean;
  technical_escalation_candidate?: boolean;
  technical_escalation_selected?: boolean;
};

type ShippingAddressCandidate = {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  zip?: string;
  country?: string;
  phone?: string;
} | null;

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
  selectedOrderId?: number | null;
  addressCandidate?: ShippingAddressCandidate;
  selectedOrderShippingAddress?: Record<string, unknown> | null;
  addressIssueContext?: boolean;
  troubleshootingExhausted?: boolean;
  technicalIssueStrong?: boolean;
  technicalExchangeCandidate?: AutomationAction | null;
};

const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function buildDeterministicAddressUpdateDecision(input: DecideActionsInput): ActionDecision | null {
  const selectedOrderId = Number(input.selectedOrderId ?? 0);
  if (!Number.isFinite(selectedOrderId) || selectedOrderId <= 0) return null;
  if (!input.addressIssueContext) return null;

  const candidate = (input.addressCandidate || {}) as Record<string, unknown>;
  const existingShipping = (input.selectedOrderShippingAddress || {}) as Record<string, unknown>;
  const name = asText(candidate.name) || asText(existingShipping.name) || asText(input.customerFirstName);
  const address1 = asText(candidate.address1);
  const address2 = asText(candidate.address2);
  const city = asText(candidate.city);
  const zip = asText(candidate.zip);
  const country =
    asText(candidate.country) ||
    asText(existingShipping.country) ||
    asText(existingShipping.country_code);
  const phone = asText(candidate.phone) || asText(existingShipping.phone);

  if (!address1 || !city || !zip || !country) return null;

  return {
    version: 1,
    summary: "Detected a replacement shipping address for a known address-issue thread and selected an address update action.",
    actions: [
      {
        type: "update_shipping_address",
        orderId: selectedOrderId,
        payload: {
          shipping_address: {
            name: name || null,
            address1,
            address2: address2 || null,
            zip,
            city,
            country,
            phone: phone || null,
          },
          note: null,
          tag: null,
          amount: null,
          currency: null,
          reason: "customer_provided_replacement_shipping_address",
          return_reason: null,
          refund: null,
          restock: null,
          email: null,
          phone: null,
          to_email: null,
          message: null,
          title: null,
          price: null,
          code: null,
          source: "latest_customer_message",
          mode: null,
          fulfillment_order_id: null,
          reason_notes: "Customer provided a replacement shipping address after prior address issue.",
          return_line_item_id: null,
          returnLineItemId: null,
          return_quantity: null,
          exchange_variant_id: null,
          exchangeVariantId: null,
          exchange_quantity: null,
          edit_summary: null,
          requested_changes: null,
          operations: null,
          line_item_id: null,
          lineItemId: null,
          variant_id: null,
          variantId: null,
          quantity: null,
        },
      },
    ],
    address_update_candidate: true,
    address_update_action_selected: true,
  };
}

function buildDeterministicTechnicalEscalationDecision(input: DecideActionsInput): ActionDecision | null {
  const selectedOrderId = Number(input.selectedOrderId ?? 0);
  if (!Number.isFinite(selectedOrderId) || selectedOrderId <= 0) return null;
  if (!input.technicalIssueStrong || !input.troubleshootingExhausted) return null;
  const candidate = input.technicalExchangeCandidate;
  if (!candidate || String(candidate.type || "").trim().toLowerCase() !== "create_exchange_request") {
    return null;
  }
  return {
    version: 1,
    summary:
      "Detected a strong unresolved technical fault after troubleshooting was already attempted and selected an exchange/replacement escalation action.",
    actions: [
      {
        ...candidate,
        orderId: Number(candidate.orderId ?? selectedOrderId),
      },
    ],
    technical_escalation_candidate: true,
    technical_escalation_selected: true,
  };
}

export async function decideActions(input: DecideActionsInput): Promise<ActionDecision> {
  const deterministicAddressUpdate = buildDeterministicAddressUpdateDecision(input);
  if (deterministicAddressUpdate) {
    return deterministicAddressUpdate;
  }
  const deterministicTechnicalEscalation = buildDeterministicTechnicalEscalationDecision(input);
  if (deterministicTechnicalEscalation) {
    return deterministicTechnicalEscalation;
  }
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
    "If ORDER SUMMARY or FACT CONTEXT already identifies the order, do not say the customer needs to provide order number, full name, or basic identity again unless identity is still genuinely ambiguous.",
    "If the customer asks how to send back an old or faulty item after a replacement or exchange flow, treat it as a practical continuation question, not a fresh return-request intake.",
    "For ongoing replacement or defect threads with a known order, do not say 'contact support for return instructions' as if the customer is starting over in a new channel.",
    "If the thread context indicates an address issue and the latest customer message provides a usable replacement shipping address for a known order, prefer update_shipping_address over reply-only or add_note.",
    "If the latest message and approved context show a strong unresolved technical fault, troubleshooting has already been attempted, and the issue persists for a known order, prefer create_exchange_request over reply-only or add_note.",
    "If the customer reports placing the same order twice by mistake and asks to delete or cancel one, propose cancel_order. If multiple order numbers are mentioned, prefer cancelling the higher-numbered order (most recent duplicate) unless the customer specifies otherwise. Use the orderId from ORDER SUMMARY.",
    "For duplicate order cases: do not refuse to act just because two order numbers are present. Use the selected order from context and note in the summary that the other duplicate should also be reviewed.",
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
      address_update_candidate: false,
      address_update_action_selected: Array.isArray(parsed?.actions)
        ? parsed.actions.some((action: any) => String(action?.type || "").trim().toLowerCase() === "update_shipping_address")
        : false,
      technical_escalation_candidate: false,
      technical_escalation_selected: Array.isArray(parsed?.actions)
        ? parsed.actions.some((action: any) => String(action?.type || "").trim().toLowerCase() === "create_exchange_request")
        : false,
    };
  } catch {
    return { version: 1, summary: "invalid_json_response", actions: [] };
  }
}
