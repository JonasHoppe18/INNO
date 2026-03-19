export type ExecutionState =
  | "no_action"
  | "pending_approval"
  | "validated_not_executed"
  | "executed"
  | "blocked";

const ACTION_SENSITIVE_TYPES = new Set([
  "update_shipping_address",
  "cancel_order",
  "refund_order",
  "change_shipping_method",
  "edit_line_items",
  "update_customer_contact",
  "create_exchange_request",
  "create_return_case",
  "send_return_instructions",
]);

const COMPLETION_LANGUAGE_PATTERNS = [
  /\bi updated\b/i,
  /\bi canceled\b/i,
  /\bi cancelled\b/i,
  /\bi refunded\b/i,
  /\bthis has been completed\b/i,
  /\byour order has been changed\b/i,
  /\bi have updated\b/i,
  /\bi have canceled\b/i,
  /\bi have cancelled\b/i,
  /\bi have refunded\b/i,
  /\bjeg har opdateret\b/i,
  /\bjeg har annulleret\b/i,
  /\bjeg har refunderet\b/i,
  /\bdet er rettet\b/i,
  /\bdet er opdateret\b/i,
  /\bordren er ændret\b/i,
];

export function isActionSensitiveReplyCase(options: {
  actionTypes?: string[];
  isReturnIntent?: boolean;
}) {
  if (options.isReturnIntent) return true;
  return (options.actionTypes || []).some((type) =>
    ACTION_SENSITIVE_TYPES.has(String(type || "").trim().toLowerCase())
  );
}

export function containsCompletionLanguage(text: string): boolean {
  const body = String(text || "").trim();
  if (!body) return false;
  return COMPLETION_LANGUAGE_PATTERNS.some((pattern) => pattern.test(body));
}

export function buildSafeExecutionStateReply(options: {
  executionState: ExecutionState;
  languageHint: string;
}): string {
  const language = String(options.languageHint || "").toLowerCase();
  const isDanish = language === "da" || language === "same_as_customer";
  if (options.executionState === "blocked") {
    return isDanish
      ? "Vi kan desvaerre ikke gennemfoere den aendring ud fra de nuvaerende oplysninger. Vi vender tilbage med naeste skridt."
      : "We cannot complete that change based on the current information. We will follow up with the next steps.";
  }
  if (options.executionState === "pending_approval") {
    return isDanish
      ? "Jeg har sendt din anmodning videre til gennemgang. Vi bekraefter igen, saa snart den er behandlet."
      : "I have forwarded your request for review. We will confirm again as soon as it has been handled.";
  }
  if (options.executionState === "validated_not_executed") {
    return isDanish
      ? "Jeg har gennemgaaet din anmodning. Vi bekraefter igen, saa snart den er gennemfoert."
      : "I have reviewed your request. We will confirm again as soon as it has been completed.";
  }
  return isDanish
    ? "Jeg har gennemgaaet din besked og vender tilbage med en opdatering snarest."
    : "I have reviewed your message and will follow up with an update shortly.";
}

export function guardReplyForExecutionState(options: {
  text: string;
  executionState: ExecutionState;
  languageHint: string;
}) {
  const containsConfirmationLanguage = containsCompletionLanguage(options.text);
  if (options.executionState === "executed" || !containsConfirmationLanguage) {
    return {
      text: options.text,
      downgraded: false,
      containsConfirmationLanguage,
    };
  }
  return {
    text: buildSafeExecutionStateReply({
      executionState: options.executionState,
      languageHint: options.languageHint,
    }),
    downgraded: true,
    containsConfirmationLanguage,
  };
}
