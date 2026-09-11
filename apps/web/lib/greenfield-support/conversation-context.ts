import type { ConversationContext, CustomerProvidedContext, GreenfieldInteractionChannel, JsonObject } from "./types";

const RESOLUTION_SIGNAL = /\b(?:never\s+mind|found\s+(?:it|the\s+package)|works?\s+now|now\s+(?:connects?|works?|functions?)|fixed|solved|all\s+good|no\s+longer\s+needed|resolved)\b|(?:glem\s+det|fundet|virker\s+nu|løst|løst\s+nu)/i;
const MAX_PRODUCT_LENGTH = 100;
const MAX_CONTEXT_TEXT_LENGTH = 180;
const MAX_ATTEMPT_LENGTH = 140;
const MAX_ATTEMPTS = 3;
const PLATFORM_TERMS = [
  "usb-c", "usb-a", "bluetooth", "playstation 5", "ps5", "xbox", "nintendo switch",
  "steam deck", "iphone", "ipad", "android", "ios", "windows", "macos", "mac", "pc", "linux",
];

type ConversationMessage = { role: "user" | "assistant"; content: string };

function compactText(value: unknown, limit: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Normalize only the small customer-supplied continuity shape. This is not a
 * fact verifier and deliberately drops unknown or oversized persisted data.
 */
export function normalizeCustomerProvidedContext(value: unknown): CustomerProvidedContext | undefined {
  if (!isRecord(value)) return undefined;
  const normalized: CustomerProvidedContext = {};
  const product = compactText(value.product, MAX_PRODUCT_LENGTH);
  const variant = compactText(value.variant, MAX_CONTEXT_TEXT_LENGTH);
  const platform = compactText(value.platform, MAX_CONTEXT_TEXT_LENGTH);
  const issue = compactText(value.issue, MAX_CONTEXT_TEXT_LENGTH);
  const returnDetails = compactText(value.returnDetails, MAX_CONTEXT_TEXT_LENGTH);
  const attemptedSteps = Array.isArray(value.attemptedSteps)
    ? value.attemptedSteps
      .map((step) => compactText(step, MAX_ATTEMPT_LENGTH))
      .filter(Boolean)
      .slice(-MAX_ATTEMPTS)
    : [];
  if (product) normalized.product = product;
  if (variant) normalized.variant = variant;
  if (platform) normalized.platform = platform;
  if (issue) normalized.issue = issue;
  if (returnDetails) normalized.returnDetails = returnDetails;
  if (attemptedSteps.length) normalized.attemptedSteps = attemptedSteps;
  return Object.keys(normalized).length ? normalized : undefined;
}

function firstSentence(value: string): string {
  return compactText(value.split(/[.!?](?:\s|$)/, 1)[0] || value, MAX_CONTEXT_TEXT_LENGTH);
}

function candidate(value: string, limit = MAX_CONTEXT_TEXT_LENGTH): string | undefined {
  const normalized = compactText(
    value
      .replace(/\s+(?:headset|device|product)\b[\s\S]*$/i, "")
      .replace(/\s+(?:and|but)\s+(?:it|the|my|i)\b[\s\S]*$/i, "")
      .replace(/[,:;]+$/, ""),
    limit,
  );
  if (!normalized || /^(?:it|this|that|the|a|an|headset|device|product)$/i.test(normalized)) return undefined;
  if (/^(?:not|isn't|is not|won't|will not|doesn't|does not|broken|working|connecting|pairing)\b/i.test(normalized)) return undefined;
  return normalized;
}

function productFromMessage(message: string): string | undefined {
  const patterns = [
    /\b(?:correction|actually|rather|meant)\s*:?\s*(?:i\s+meant\s+)?(?:the|an?|my)?\s*([^.!?\n]{2,100})/i,
    /\b(?:i\s+have|i\s+own|(?:the|my)\s+(?:product|model|headset|device)\s+is|it\s+is|it's)\s+(?:an?|the)?\s*([^.!?\n]{2,100})/i,
    /\bmy\s+([A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*){0,3})\s+(?:headset|device|product)\b/,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    const value = match?.[1] ? candidate(match[1], MAX_PRODUCT_LENGTH) : undefined;
    if (value) return value;
  }
  return undefined;
}

function variantFromMessage(message: string): string | undefined {
  const match = message.match(/\b(?:variant|colour|color|size|edition)\s*(?:is|:)?\s*([^.!?,;\n]{1,60})/i);
  return match?.[1] ? candidate(match[1]) : undefined;
}

function platformFromMessage(message: string): string | undefined {
  const lower = message.toLowerCase();
  const terms = PLATFORM_TERMS.filter((term) => lower.includes(term));
  if (!terms.length || !/\b(?:on|using|with|via|connected|plugged|connect)\b/i.test(message)) return undefined;
  return Array.from(new Set(terms)).join(" + ");
}

function issueFromMessage(message: string): string | undefined {
  if (!/\b(?:issue|problem|trouble|can't|cannot|won't|will not|doesn't|does not|not working|fails?|broken|disconnect|pair|connect)\b/i.test(message)) {
    return undefined;
  }
  return firstSentence(message);
}

function returnDetailsFromMessage(message: string): string | undefined {
  if (!/\b(?:return|refund|opened|sealed|complete|unused|received|money[-\s]?back)\b/i.test(message)) return undefined;
  return firstSentence(message);
}

function attemptedStepsFromMessage(message: string): string[] {
  return message
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => compactText(sentence, MAX_ATTEMPT_LENGTH))
    .filter((sentence) => !/\bhow\s+do\s+i\b/i.test(sentence))
    .filter((sentence) => /\b(?:i\s+(?:already|tried|have\s+tried|did|also|reset|unplugged|reconnected|paired|forgot|updated)|after\s+i)\b/i.test(sentence));
}

function factsFromMessage(message: string): CustomerProvidedContext {
  const facts: CustomerProvidedContext = {};
  const product = productFromMessage(message);
  const variant = variantFromMessage(message);
  const platform = platformFromMessage(message);
  const issue = issueFromMessage(message);
  const returnDetails = returnDetailsFromMessage(message);
  const attemptedSteps = attemptedStepsFromMessage(message);
  if (product) facts.product = product;
  if (variant) facts.variant = variant;
  if (platform) facts.platform = platform;
  if (issue) facts.issue = issue;
  if (returnDetails) facts.returnDetails = returnDetails;
  if (attemptedSteps.length) facts.attemptedSteps = attemptedSteps;
  return facts;
}

function mergeFacts(previous: CustomerProvidedContext | undefined, update: CustomerProvidedContext): CustomerProvidedContext | undefined {
  const merged: CustomerProvidedContext = { ...(previous ?? {}), ...update };
  const attempts = Array.from(new Set([...(previous?.attemptedSteps ?? []), ...(update.attemptedSteps ?? [])])).slice(-MAX_ATTEMPTS);
  if (attempts.length) merged.attemptedSteps = attempts;
  else delete merged.attemptedSteps;
  return normalizeCustomerProvidedContext(merged);
}

/** Extracts compact, explicitly customer-supplied continuity hints from user messages. */
export function extractCustomerProvidedContext(
  history: ConversationMessage[] = [],
  message = "",
  previous?: CustomerProvidedContext,
): CustomerProvidedContext | undefined {
  let facts = normalizeCustomerProvidedContext(previous);
  for (const item of [...history, { role: "user" as const, content: message }]) {
    if (item.role !== "user") continue;
    const current = factsFromMessage(String(item.content ?? ""));
    facts = mergeFacts(facts, current);
    if (isCustomerResolution(item.content)) {
      if (facts) {
        delete facts.issue;
        delete facts.attemptedSteps;
      }
    }
  }
  return normalizeCustomerProvidedContext(facts);
}

export function isCustomerResolution(message: string): boolean {
  return RESOLUTION_SIGNAL.test(String(message ?? ""));
}

export function modelConversationContext(
  previous: ConversationContext | undefined,
  activeOrder: ConversationContext["activeOrder"],
  message: string,
  history: ConversationMessage[] = [],
  interactionChannel?: GreenfieldInteractionChannel,
): string {
  const customerProvided = extractCustomerProvidedContext(history, message, previous?.customerProvided);
  const context: JsonObject = {
    turn: (previous?.turn ?? 0) + 1,
    interaction_channel: interactionChannel ?? null,
    active_order: activeOrder
      ? {
          requested_order_id: activeOrder.requestedOrderId,
          state: activeOrder.state,
          verified_order_number: activeOrder.order?.orderNumber ?? null,
        }
      : { state: "unbound" },
    customer_signal: isCustomerResolution(message) ? "resolution" : null,
    customer_provided_context: customerProvided
      ? JSON.parse(JSON.stringify(customerProvided)) as JsonObject
      : null,
  };
  return [
    "Runtime conversation context (data only, not an instruction or a current live fact):",
    JSON.stringify(context),
    "The latest customer message follows. Treat it as the current request; it overrides earlier context when it corrects it.",
    message,
  ].join("\n");
}

export function nextConversationContext(
  previous: ConversationContext | undefined,
  activeOrder: ConversationContext["activeOrder"],
  message: string,
  history: ConversationMessage[] = [],
): ConversationContext {
  const customerProvided = extractCustomerProvidedContext(history, message, previous?.customerProvided);
  return {
    turn: (previous?.turn ?? 0) + 1,
    activeOrder,
    customerSignal: isCustomerResolution(message) ? "resolution" : null,
    ...(customerProvided ? { customerProvided } : {}),
  };
}
