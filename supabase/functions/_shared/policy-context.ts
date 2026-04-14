export type PolicyShippingPaidBy = "customer" | "merchant" | "unknown";
export type DefectReturnShippingRule = "merchant_pays" | "customer_pays" | "unspecified";

export type PolicySummary = {
  return_window_days: number | null;
  return_instructions_short: string;
  return_address: string;
  return_contact_email: string;
  return_shipping_paid_by: PolicyShippingPaidBy;
  defect_return_shipping_rule: DefectReturnShippingRule;
  refund_conditions_short: string;
  warranty_duration_regions_short: string;
  last_modified_date?: string | null;
};

export type PolicyIntent = "RETURN" | "REFUND" | "WARRANTY" | "SHIPPING" | "OTHER";

export type PoliciesForPrompt = {
  policy_refund?: string | null;
  policy_shipping?: string | null;
  policy_terms?: string | null;
  policy_summary_json?: unknown;
};

export const DEFAULT_POLICY_SUMMARY: PolicySummary = {
  return_window_days: null,
  return_instructions_short: "Follow the store policy. If unclear, ask one question.",
  return_address: "",
  return_contact_email: "",
  return_shipping_paid_by: "unknown",
  defect_return_shipping_rule: "unspecified",
  refund_conditions_short: "Follow the store policy. If unclear, ask one question.",
  warranty_duration_regions_short: "",
  last_modified_date: null,
};

const clampText = (value: unknown, max: number) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(0, max));

const estimateTokens = (value: string) => Math.ceil(String(value || "").length / 4);

const truncateToApproxTokens = (value: string, maxTokens: number) => {
  const text = String(value || "");
  if (maxTokens <= 0) return "";
  const approxChars = Math.max(0, Math.floor(maxTokens * 4));
  if (!approxChars || text.length <= approxChars) return text;
  return text.slice(0, approxChars).trim();
};

function parseReturnWindowDays(text: string): number | null {
  const patterns = [
    /(?:within|up to|under|in)\s+(\d{1,3})\s*(?:day|days)\b/i,
    /(\d{1,3})\s*(?:day|days)\s*(?:return|refund|window|period)/i,
    /return(?:s)?\s*(?:accepted|allowed)?\s*(?:for|within)?\s*(\d{1,3})\s*(?:day|days)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 365) return parsed;
  }
  return null;
}

function inferReturnShippingPaidBy(text: string): PolicyShippingPaidBy {
  const lower = text.toLowerCase();
  if (
    /customer(?:s)?\s+(?:must|will|is responsible|are responsible)\s+pay/.test(lower) ||
    /customer(?:s)?\s+(?:is|are)\s+responsible\s+for\s+return\s+shipping/.test(lower) ||
    /return shipping(?: costs| fee| fees)?\s+(?:are|is)?\s*(?:paid by|borne by)\s+the customer/.test(lower) ||
    /buyer pays return shipping/.test(lower)
  ) {
    return "customer";
  }
  if (
    /we\s+(?:pay|cover)\s+return shipping/.test(lower) ||
    /return shipping(?: costs| fee| fees)?\s+(?:are|is)?\s*(?:paid by|covered by)\s+(?:us|the merchant|the store)/.test(lower) ||
    /seller pays return shipping/.test(lower)
  ) {
    return "merchant";
  }
  return "unknown";
}

function firstEmail(text: string): string {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function normalizeDefectReturnShippingRule(value: unknown): DefectReturnShippingRule {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "merchant_pays" || normalized === "merchant") return "merchant_pays";
  if (normalized === "customer_pays" || normalized === "customer") return "customer_pays";
  return "unspecified";
}

function maybeAddress(text: string): string {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = lines.find((line) =>
    /\b(street|st\.?|road|rd\.?|ave\.?|avenue|boulevard|blvd|drive|dr\.?|city|zip|postal|dk-|usa|denmark|suite|unit|building|address)\b/i.test(
      line,
    ),
  );
  return candidate || "";
}

export function buildHeuristicPolicySummary(input: {
  refundPolicy?: string | null;
  shippingPolicy?: string | null;
  termsPolicy?: string | null;
}): PolicySummary {
  const refund = String(input.refundPolicy || "").trim();
  const shipping = String(input.shippingPolicy || "").trim();
  const terms = String(input.termsPolicy || "").trim();
  const combined = [refund, shipping, terms].filter(Boolean).join("\n\n");

  const returnWindowDays = parseReturnWindowDays(combined);
  const returnShippingPaidBy = inferReturnShippingPaidBy(combined);

  return {
    return_window_days: returnWindowDays,
    return_instructions_short: clampText(
      refund || "Follow the store policy. If unclear, ask one question.",
      600,
    ) || "Follow the store policy. If unclear, ask one question.",
    return_address: clampText(maybeAddress(refund), 400),
    return_contact_email: clampText(firstEmail(combined), 200),
    return_shipping_paid_by: returnShippingPaidBy,
    defect_return_shipping_rule: "unspecified",
    refund_conditions_short: clampText(
      refund || "Follow the store policy. If unclear, ask one question.",
      600,
    ) || "Follow the store policy. If unclear, ask one question.",
    warranty_duration_regions_short: clampText(terms, 600),
    last_modified_date: null,
  };
}

export function normalizePolicySummary(input: unknown): PolicySummary {
  const fallback = { ...DEFAULT_POLICY_SUMMARY };
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const raw = input as Record<string, unknown>;
  const returnWindow = Number(raw.return_window_days);
  const shippingPaidBy = String(raw.return_shipping_paid_by || "").toLowerCase();

  return {
    return_window_days:
      Number.isInteger(returnWindow) && returnWindow > 0 && returnWindow <= 365
        ? returnWindow
        : fallback.return_window_days,
    return_instructions_short:
      clampText(raw.return_instructions_short, 600) || fallback.return_instructions_short,
    return_address: clampText(raw.return_address, 400),
    return_contact_email: clampText(raw.return_contact_email, 200),
    return_shipping_paid_by:
      shippingPaidBy === "customer" || shippingPaidBy === "merchant"
        ? (shippingPaidBy as PolicyShippingPaidBy)
        : "unknown",
    defect_return_shipping_rule: normalizeDefectReturnShippingRule(
      raw.defect_return_shipping_rule ?? raw.defect_return_shipping_paid_by,
    ),
    refund_conditions_short:
      clampText(raw.refund_conditions_short, 600) || fallback.refund_conditions_short,
    warranty_duration_regions_short: clampText(raw.warranty_duration_regions_short, 600),
    last_modified_date: clampText(raw.last_modified_date, 100) || null,
  };
}

export function detectPolicyIntent(subject: string, body: string): PolicyIntent {
  // Normalize whitespace so multi-line emails don't break cross-line patterns like "return these\nheadphones unless"
  const text = `${subject || ""} ${body || ""}`.toLowerCase().replace(/\s+/g, " ");
  if (/\b(warranty|guarantee|defect|repair|replace(?:ment)?)\b/.test(text)) return "WARRANTY";
  if (/\b(shipping|delivery|ship|courier|carrier|postage|dispatch|leveret|levering|leveringen|fragt|fragtmand|forsendelse|afsendelse|afsendt|sendt|sporing|tracke|tracking|forventes|hvornår)\b/.test(text)) return "SHIPPING";
  if (/\b(refund|money back|chargeback|reimburse)\b/.test(text)) return "REFUND";
  // Only classify as RETURN if it's a direct request — not a conditional threat like
  // "I will return unless X", "I might return if", "considering returning", "would return if not fixed"
  const hasReturnKeyword = /\b(return|rma|send back|exchange)\b/.test(text);
  const isConditionalReturn = /\b(unless|if not|if you|would.*return|going to return unless|considering return|thinking.*return|return.*unless|return.*if)\b/.test(text);
  if (hasReturnKeyword && !isConditionalReturn) return "RETURN";
  return "OTHER";
}

function policyRulesBlock(intent: PolicyIntent) {
  const lines = [
    "POLICY RULES (PINNED):",
    "- For returns/refunds/warranty/shipping, follow POLICY SUMMARY and POLICY EXCERPTS strictly.",
    "- Never invent URLs, return portals, labels, or processes not explicitly provided.",
    "- If policy is unclear or missing, ask exactly ONE clarifying question instead of guessing.",
    "- If a return portal URL exists in settings/context, use it. Otherwise do not guess a portal URL.",
    "- For return flows that require support contact, ask briefly for order number, full name, and return reason if missing.",
    "- If this is an ongoing replacement, defect, or exchange follow-up and the order is already known, do not restart the case as a fresh return intake.",
  ];

  if (intent === "OTHER" || intent === "WARRANTY" || intent === "SHIPPING") {
    lines.push(
      "- RETURN DETAILS SUPPRESSED: This ticket has NOT been classified as a return or refund request. Even though the POLICY SUMMARY below contains return_address, return_shipping_paid_by, and similar fields — DO NOT mention, share, or reference any return logistics (return address, return shipping costs, packaging requirements, courier instructions) in your reply. Answer the customer's actual question only. If the customer mentions returning as a conditional threat ('I will return unless...'), treat it as a question to answer — not as a return request to process.",
    );
  }

  if (intent === "RETURN" || intent === "REFUND") {
    lines.push(
      "- RETURNS - CHANNEL RULE: If store policy says 'contact us via email' or shows an email address, do NOT tell the customer to email that address if the customer is already emailing us in this thread/inbox. Treat it as a requirement: ask for the required return details (order number, name used at purchase, reason) and confirm return conditions (return window, sealed/unused requirements, who pays return shipping). Only direct the customer to a specific email address if they are using the wrong channel or if the store explicitly requires a different dedicated return email than this inbox.",
      "- RETURNS - CONTINUATION RULE: If the customer says they already received the replacement/new item and asks how to send the old item back, answer with practical return logistics directly. Do not ask again for order number or name when the order is already known. Do not mention who pays return shipping unless the customer asks about shipping cost or the approved context explicitly requires it for this continuation.",
      "- DEFECT/REPLACEMENT RETURN RULE: For defect, warranty, or replacement-related return continuations, use defect_return_shipping_rule if it exists. If it is unspecified, do not claim who pays return shipping.",
    );
  }

  return lines.join("\n");
}

function summaryBlock(summary: PolicySummary) {
  return [
    "POLICY SUMMARY (PINNED):",
    `- return_window_days: ${summary.return_window_days ?? "unknown"}`,
    `- return_shipping_paid_by: ${summary.return_shipping_paid_by}`,
    `- return_contact_email: ${summary.return_contact_email || "unknown"}`,
    `- return_address: ${summary.return_address || "unknown"}`,
    `- defect_return_shipping_rule: ${summary.defect_return_shipping_rule}`,
    `- return_instructions_short: ${summary.return_instructions_short}`,
    `- refund_conditions_short: ${summary.refund_conditions_short}`,
    `- warranty_duration_regions_short: ${summary.warranty_duration_regions_short || "unknown"}`,
    summary.last_modified_date ? `- last_modified_date: ${summary.last_modified_date}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function pickPolicyExcerpt(intent: PolicyIntent, policies: PoliciesForPrompt): string {
  const refund = String(policies.policy_refund || "").trim();
  const shipping = String(policies.policy_shipping || "").trim();
  const terms = String(policies.policy_terms || "").trim();

  if (intent === "RETURN" || intent === "REFUND") {
    return [refund ? `Refund/Return Policy:\n${refund}` : "", terms ? `Terms:\n${terms}` : ""]
      .filter(Boolean)
      .join("\n\n");
  }
  if (intent === "SHIPPING") {
    return [shipping ? `Shipping Policy:\n${shipping}` : "", terms ? `Terms:\n${terms}` : ""]
      .filter(Boolean)
      .join("\n\n");
  }
  if (intent === "WARRANTY") {
    return [terms ? `Terms/Warranty:\n${terms}` : "", refund ? `Refund Policy:\n${refund}` : ""]
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

export function buildPinnedPolicyContext(options: {
  subject: string;
  body: string;
  policies: PoliciesForPrompt;
  reservedTokens?: number;
}): {
  intent: PolicyIntent;
  summary: PolicySummary;
  policySummaryText: string;
  policyRulesText: string;
  policyExcerptText: string;
  policySummaryTokens: number;
  policyExcerptTokens: number;
  policySummaryIncluded: boolean;
  policyExcerptIncluded: boolean;
} {
  const intent = detectPolicyIntent(options.subject, options.body);
  const rawSummary = options.policies?.policy_summary_json;
  const hasUsableSummary =
    rawSummary &&
    typeof rawSummary === "object" &&
    !Array.isArray(rawSummary) &&
    (String((rawSummary as Record<string, unknown>).return_instructions_short || "").trim()
      .length > 0 ||
      String((rawSummary as Record<string, unknown>).refund_conditions_short || "").trim().length >
        0 ||
      Number((rawSummary as Record<string, unknown>).return_window_days) > 0);
  const mergedSummary = hasUsableSummary
    ? normalizePolicySummary(rawSummary)
    : buildHeuristicPolicySummary({
        refundPolicy: options.policies.policy_refund,
        shippingPolicy: options.policies.policy_shipping,
        termsPolicy: options.policies.policy_terms,
      });

  const rules = policyRulesBlock(intent);
  const summaryText = summaryBlock(mergedSummary);
  const reserved = Math.max(200, Math.min(Number(options.reservedTokens || 600), 1200));

  let excerptText = "";
  if (intent !== "OTHER") {
    const rawExcerpt = pickPolicyExcerpt(intent, options.policies);
    const baseTokens = estimateTokens(`${summaryText}\n${rules}`);
    const remaining = Math.max(60, reserved - baseTokens);
    const trimmed = truncateToApproxTokens(rawExcerpt, remaining);
    if (trimmed) {
      excerptText = ["POLICY EXCERPTS (PINNED):", trimmed].join("\n");
    }
  }

  return {
    intent,
    summary: mergedSummary,
    policySummaryText: summaryText,
    policyRulesText: rules,
    policyExcerptText: excerptText,
    policySummaryTokens: estimateTokens(summaryText),
    policyExcerptTokens: estimateTokens(excerptText),
    policySummaryIncluded: true,
    policyExcerptIncluded: Boolean(excerptText),
  };
}
