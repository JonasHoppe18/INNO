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

const SAME_CHANNEL_ESCALATION_LINE_PATTERNS = [
  /support@\S+/i,
  /\bcontact us at\s+\S+@\S+/i,
  /\bwrite to us at\s+\S+@\S+/i,
  /\bsend (?:us|an) (?:an )?e-?mail\b/i,
  /\bemail us\b/i,
  /\breply by e-?mail\b/i,
  /\breach out to us via e-?mail\b/i,
  /\bnotify us by e-?mail\b/i,
  /\bwrite to us by e-?mail\b/i,
  /\bcontact us via e-?mail\b/i,
  /\bcontact us by e-?mail\b/i,
  /\bskriv til\s+\S+@\S+/i,
  /\bkontakt os på\s+\S+@\S+/i,
  /\bsend os en e-?mail\b/i,
  /\bskriv til os på e-?mail\b/i,
  /\bskriv til os via e-?mail\b/i,
  /\bkontakt os via e-?mail\b/i,
];

const REDUNDANT_IN_THREAD_NOTIFICATION_LINE_PATTERNS = [
  /\b(?:the return|your return|returneringen|returen)\b.*\b(?:must|skal)\b.*\b(?:be )?(?:notified|reported|meddeles|oplyses)\b/i,
  /\bplease\s+(?:notify|inform)\s+us\b.*\b(?:here|about|of)\b/i,
  /\bcontact\s+us\s+here\b.*\b(?:inform|notify|let us know)\b/i,
  /\blet us know here about (?:the return|your return|this return)\b/i,
  /\b(?:giv|lad)\s+os\b.*\b(?:besked|vide)\b.*\b(?:om returen|om din retur|om returneringen)\b/i,
  /\bkontakt os her\b.*\b(?:for at informere|for at give besked)\b/i,
  /\bskriv(?: gerne)? her\b.*\b(?:om returen|om din retur|om returneringen)\b/i,
];

const DETAIL_FOLLOWUP_ALLOWLIST_PATTERNS = [
  /\b(?:order number|ordrenummer|serial number|serienummer|rma|preferred date|dato|day|dag|time|tidspunkt|timing|hvornår)\b/i,
  /\b(?:reply here|let us know here|svar her|skriv her)\b.*\b(?:which|what|when|hvilken|hvilket|hvornår)\b/i,
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

export function guardSameChannelEscalation(options: {
  text: string;
  languageHint: string;
}) {
  const original = String(options.text || "").trim();
  if (!original) {
    return {
      text: original,
      changed: false,
      removedSameChannelEscalation: false,
    };
  }

  const lines = original.split("\n");
  let removed = false;
  const filtered = lines.filter((line) => {
    const body = String(line || "").trim();
    if (!body) return true;
    const allowDetailFollowup = DETAIL_FOLLOWUP_ALLOWLIST_PATTERNS.some((pattern) => pattern.test(body));
    const match =
      !allowDetailFollowup &&
      (
        SAME_CHANNEL_ESCALATION_LINE_PATTERNS.some((pattern) => pattern.test(body)) ||
        REDUNDANT_IN_THREAD_NOTIFICATION_LINE_PATTERNS.some((pattern) => pattern.test(body))
      );
    if (match) removed = true;
    return !match;
  });

  let next = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (removed) {
    const hasInThreadPhrase =
      /\breply here\b/i.test(next) ||
      /\blet us know here\b/i.test(next) ||
      /\bjust reply here\b/i.test(next) ||
      /\bsvar her\b/i.test(next) ||
      /\bskriv her\b/i.test(next) ||
      /\bgiv os gerne besked her\b/i.test(next);
    if (!hasInThreadPhrase) {
      const isDanish = String(options.languageHint || "").toLowerCase() === "da" ||
        String(options.languageHint || "").toLowerCase() === "same_as_customer";
      const addition = isDanish
        ? "Hvis du har flere spoergsmaal, er du velkommen til bare at svare her."
        : "If you have any questions, just reply here.";
      next = next ? `${next}\n\n${addition}` : addition;
    }
  }

  return {
    text: next,
    changed: next !== original,
    removedSameChannelEscalation: removed,
  };
}
