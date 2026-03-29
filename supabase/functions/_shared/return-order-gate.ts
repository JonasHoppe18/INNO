export function guardReturnReplyWithoutOrderContext(options: {
  text: string;
  languageHint?: string | null;
  knownOrderNumber: boolean;
  customerFirstName?: string | null;
}): {
  text: string;
  changed: boolean;
  instructionsSuppressed: boolean;
  orderNumberRequestAdded: boolean;
  reason: string;
} {
  const original = String(options.text || "").trim();
  if (!original) {
    return {
      text: original,
      changed: false,
      instructionsSuppressed: false,
      orderNumberRequestAdded: false,
      reason: "empty_text",
    };
  }
  if (options.knownOrderNumber) {
    return {
      text: original,
      changed: false,
      instructionsSuppressed: false,
      orderNumberRequestAdded: false,
      reason: "known_order_number",
    };
  }

  const isDanish = String(options.languageHint || "").toLowerCase().startsWith("da");
  const firstName = String(options.customerFirstName || "").trim();
  const preferredGreeting = isDanish
    ? (firstName ? `Hej ${firstName},` : "Hej,")
    : (firstName ? `Hi ${firstName},` : "Hi,");

  const hasOrderRequest = /\b(?:order number|ordrenummer)\b/i.test(original);
  const hasPrematureReturnInstructions = [
    /\bwithin\s+\d+\s+days\b/i,
    /\boriginal condition\b/i,
    /\boriginal packaging\b/i,
    /\breturn shipping costs?\b/i,
    /\byou will need to cover\b/i,
    /\bsend it to\b/i,
    /\bnordre fasanvej\b/i,
    /\bfrederiksberg\b/i,
    /\bdenmark\b/i,
    /\bdanmark\b/i,
  ].some((pattern) => pattern.test(original));

  if (!hasPrematureReturnInstructions && hasOrderRequest) {
    const greetingNormalized = normalizeGreetingLine(original, preferredGreeting, firstName);
    return {
      text: greetingNormalized.text,
      changed: greetingNormalized.changed,
      instructionsSuppressed: false,
      orderNumberRequestAdded: false,
      reason: greetingNormalized.changed ? "already_safe_greeting_normalized" : "already_safe",
    };
  }

  const body = isDanish
    ? "Vi kan godt hjælpe med en RMA. Svar venligst her i tråden med dit ordrenummer, så starter vi sagen med det samme."
    : "We can help you start an RMA. Please reply in this thread with your order number, and we will start the case right away.";

  const rebuilt = `${preferredGreeting}\n\n${body}`;
  return {
    text: rebuilt,
    changed: rebuilt !== original,
    instructionsSuppressed: hasPrematureReturnInstructions,
    orderNumberRequestAdded: !hasOrderRequest,
    reason: hasPrematureReturnInstructions
      ? "suppressed_premature_return_instructions"
      : "missing_order_request",
  };
}

function normalizeGreetingLine(
  text: string,
  preferredGreeting: string,
  firstName: string,
): { text: string; changed: boolean } {
  const body = String(text || "").trim();
  if (!body) return { text: body, changed: false };
  if (!firstName) return { text: body, changed: false };
  const lines = body.split("\n");
  const firstLine = String(lines[0] || "").trim();
  const hasGreeting = /^(?:hi|hello|hej|hola)\b/i.test(firstLine);
  if (!hasGreeting) return { text: body, changed: false };
  if (firstLine.toLowerCase().includes(firstName.toLowerCase())) {
    return { text: body, changed: false };
  }
  lines[0] = preferredGreeting;
  const rebuilt = lines.join("\n").trim();
  return {
    text: rebuilt,
    changed: rebuilt !== body,
  };
}
