import type { Plan } from "./planner.ts";

export type ReturnTrackingAttribution = {
  kind: "customer_provided_return_tracking";
  tracking_numbers: string[];
  blockText: string;
};

const TRACKING_NUMBER_RE =
  /\b(?:tracking|sporing|sporingsnummer|track(?:ing)?\s*(?:number|no\.?|#)?|awb|shipment)\s*(?:number|no\.?|#)?\s*(?::|=|\bis\b|\ber\b)?\s*([A-Z0-9][A-Z0-9 -]{8,38}[A-Z0-9])\b/gi;

const BARE_LONG_NUMBER_RE = /\b\d{10,34}\b/g;

const RETURN_CONTEXT_RE =
  /\b(return|returns|returned|returning|refund|refunded|reimbursement|money back|right of withdrawal|fortryd|retur|returnere|returneret|refusion|refundering|pengene tilbage)\b/i;

const CUSTOMER_SHIPPED_RE =
  /\b(shipped|sent|mailed|posted|dropped off|handed in|sendt|afsendt|indleveret|return shipment|returpakke|returforsendelse)\b/i;

function normalizeTrackingNumber(value: string) {
  return String(value || "").replace(/[\s-]+/g, "").trim();
}

export function extractCustomerProvidedTrackingNumbers(message: string): string[] {
  const numbers = new Set<string>();
  const text = String(message || "");

  for (const match of text.matchAll(TRACKING_NUMBER_RE)) {
    const normalized = normalizeTrackingNumber(match[1] || "");
    if (normalized.length >= 10) numbers.add(normalized);
  }

  if (/\b(?:tracking|sporing|sporingsnummer|awb|shipment|usps|ups|dhl|gls|postnord|dao|bring)\b/i.test(text)) {
    for (const match of text.matchAll(BARE_LONG_NUMBER_RE)) {
      const normalized = normalizeTrackingNumber(match[0] || "");
      if (normalized.length >= 10) numbers.add(normalized);
    }
  }

  return [...numbers];
}

export function detectCustomerProvidedReturnTracking(input: {
  latestCustomerMessage: string;
  conversationHistory?: Array<{ role: "customer" | "agent"; text: string }>;
  plan?: Pick<Plan, "primary_intent" | "required_facts"> | null;
}): ReturnTrackingAttribution | null {
  const trackingNumbers = extractCustomerProvidedTrackingNumbers(input.latestCustomerMessage);
  if (!trackingNumbers.length) return null;

  const historyText = (input.conversationHistory ?? [])
    .slice(-8)
    .map((turn) => turn.text)
    .join("\n");
  const combinedContext = `${input.latestCustomerMessage}\n${historyText}`;
  const planReturnLike =
    input.plan?.primary_intent === "return" ||
    input.plan?.primary_intent === "refund" ||
    input.plan?.required_facts?.includes("return_eligibility") === true;
  const returnLike = planReturnLike || RETURN_CONTEXT_RE.test(combinedContext);
  const customerShippedLike = CUSTOMER_SHIPPED_RE.test(combinedContext) ||
    /\btracking\s+number\s+(?:is|er|:)?\s*[A-Z0-9]/i.test(input.latestCustomerMessage);

  if (!returnLike || !customerShippedLike) return null;

  const label = trackingNumbers.length === 1
    ? trackingNumbers[0]
    : trackingNumbers.join(", ");
  return {
    kind: "customer_provided_return_tracking",
    tracking_numbers: trackingNumbers,
    blockText: [
      "# Customer-provided return tracking (deterministic)",
      `The customer provided return-shipment tracking number(s): ${label}.`,
      "Treat these as return-shipment tracking from the customer to the shop, not outbound order tracking from the shop to the customer.",
      "This is a CUSTOMER-PROVIDED return tracking number. Do not present carrier status, delivery, receipt, internal processing, or refund state as verified unless verified facts explicitly support it. You MUST follow this exact safe structure:",
      "1. Thank the customer for providing the return tracking number (acknowledge we have received the number).",
      "2. If the verified refund facts show no refund has been issued, state clearly that a refund has NOT been issued yet.",
      "3. State that the return still needs manual review before receipt, internal processing, or refund can be confirmed.",
      "4. Say the team can use the tracking number to review/investigate the return status further.",
      "FORBIDDEN — never write these or anything equivalent, in any language: 'once we receive', 'once processed', 'once the return is processed', 'the refund will be issued', 'the refund will be initiated', any statement that a refund will follow after the package is received/processed, any automatic refund workflow, any refund timing promise, 'you will be notified', 'keep an eye on the tracking', 'monitor the shipment', asking the customer to watch the tracking themselves, or implying that carrier-delivered means the return is internally processed.",
      "Do not ask whether the customer still wants the refund when prior thread context already confirms it.",
      "Do not call this the tracking number for the order.",
      "Do not use or combine outbound order tracking URLs with the customer's return tracking number. Only include a tracking URL if it contains exactly the customer-provided tracking number; omit the URL when uncertain.",
    ].join("\n"),
  };
}
