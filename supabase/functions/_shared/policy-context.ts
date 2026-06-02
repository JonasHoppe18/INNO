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
    /(?:within|up to|under|in)\s+(\d{1,3})[\s-]*(?:day|days)\b/i,
    /(\d{1,3})[\s-]*(?:day|days)\s*(?:return|refund|window|period)/i,
    /return(?:s)?\s*(?:accepted|allowed)?\s*(?:for|within)?\s*(\d{1,3})[\s-]*(?:day|days)/i,
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
  // Try to find a multi-line address block after "address it to:" / "send to:" / "please address it to:"
  const normalised = String(text || "").replace(/\s+/g, " ");
  const blockMatch = normalised.match(
    /(?:address(?:ed)?\s+it\s+to|please\s+send\s+to|ship\s+to|return\s+to|send\s+(?:the\s+)?(?:goods|package|product|parcel|item)\s+to)\s*:?\s*([A-ZÆØÅ][^.]{10,200}?\b(?:denmark|germany|uk|sweden|norway|netherlands|france|spain|usa|canada)\b)/i,
  );
  if (blockMatch) return blockMatch[1].replace(/\s+/g, " ").trim().slice(0, 400);

  // Fallback: first line that looks like a physical address (street number, postal code, country)
  const candidate = lines.find((line) =>
    /\b(street|st\.?|road|rd\.?|ave\.?|avenue|boulevard|blvd|drive|dr\.?|vej|gade|allé|alle|fasanvej|stræde|plads|city|zip|postal|dk-|\bdk\b|usa|denmark|suite|unit|building|address|\d{4,5}\s+[A-ZÆØÅ])\b/i.test(
      line,
    ),
  );
  return candidate || "";
}

// Extract a multi-line return address block from raw policy text (up to 4 lines after a trigger phrase).
function extractReturnAddressBlock(text: string): string {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const triggerRe = /(?:address(?:ed)?\s+it\s+to|please\s+(?:send|address|ship)\s+(?:it\s+)?to|send\s+(?:the\s+)?(?:package|goods|item|product|parcel)\s+to|send\s+to|return\s+address)\s*:?\s*$/i;
  // Also handle inline trigger like "address it to: Acme Corp\nStreet 1\n..."
  const inlineRe = /(?:address(?:ed)?\s+it\s+to|please\s+(?:send|address|ship)\s+(?:it\s+)?to|return\s+address)\s*:?\s*(.+)/i;

  for (let i = 0; i < lines.length; i++) {
    // Inline match on same line
    const inlineMatch = lines[i].match(inlineRe);
    if (inlineMatch) {
      const firstLine = inlineMatch[1].trim();
      const addressLines = [firstLine];
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const next = lines[j].trim();
        // Stop if we hit something that looks like a new sentence or instruction
        if (/^[A-Z].*[.!?]$/.test(next) && next.length > 60) break;
        if (/^\d+\.|^step\s+\d/i.test(next)) break;
        addressLines.push(next);
      }
      const result = addressLines.join(", ").replace(/,\s*,/g, ",").trim();
      if (result.length > 10) return result.slice(0, 400);
    }
    // Trigger on its own line, address starts on next line
    if (triggerRe.test(lines[i])) {
      const addressLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const next = lines[j].trim();
        if (/^[A-Z].*[.!?]$/.test(next) && next.length > 60) break;
        if (/^\d+\.|^step\s+\d/i.test(next)) break;
        addressLines.push(next);
      }
      const result = addressLines.join(", ").trim();
      if (result.length > 10) return result.slice(0, 400);
    }
  }
  return "";
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
    "- For returns/refunds/warranty/shipping, follow the retrieved POLICY knowledge (sources tagged usable_as: policy) strictly. Use ONLY what it states — never improvise terms, amounts, or deadlines.",
    "- Never invent URLs, return portals, labels, or processes that are not present in the retrieved knowledge.",
    "- If the relevant policy is unclear or not present in the retrieved knowledge, ask exactly ONE clarifying question instead of guessing.",
    "- The customer is already in the correct support thread. Never tell them to email or contact a support address — handle the request here.",
    "- For return flows that require order number, full name, and return reason, ask briefly for the specific missing detail(s) if they are not already known.",
    "- If this is an ongoing replacement, defect, or exchange follow-up and the order is already known, do not restart the case as a fresh return intake.",
    "- Give the customer only the part of the policy they need right now — do not recite the entire policy.",
  ];

  if (intent === "OTHER" || intent === "WARRANTY" || intent === "SHIPPING") {
    lines.push(
      "- RETURN DETAILS SUPPRESSED: This ticket is NOT a return or refund request. Even if return logistics appear in the retrieved knowledge, do NOT mention or reference any of it (return address, return shipping costs, packaging requirements, courier instructions). Answer the customer's actual question only. If the customer mentions returning only as a conditional threat ('I will return unless...'), treat it as a question to answer — not as a return request to process.",
    );
  }

  if (intent === "WARRANTY") {
    lines.push(
      "- WARRANTY CLAIM RULE: A standard return window does NOT apply to warranty or defect claims. Do NOT cite a return window as a reason to reject or limit a warranty claim. Assess warranty eligibility from the warranty terms in the retrieved knowledge instead.",
    );
  }

  if (intent === "RETURN" || intent === "REFUND") {
    lines.push(
      "- RETURNS - CHANNEL RULE: If the policy shows an email address for returns, do NOT tell the customer to email it — they are already in the right thread. Instead: (1) if the retrieved policy gives a physical return address or a step-by-step return procedure, provide those directly, including the full return address and any packaging/courier instructions from the policy; (2) if the required return details (order number, name at purchase, reason) are NOT yet known from the verified facts or customer message, ask for the specific missing detail(s) first; (3) if all details ARE already known and the policy contains a return address, give the complete return instructions now — do not ask for information already provided.",
      "- RETURNS - ADDRESS RULE: When the retrieved policy knowledge contains a return address, include it verbatim so the customer knows where to ship the item.",
      "- RETURNS - CONTINUATION RULE: If the customer says they already received the replacement/new item and asks how to send the old item back, answer with practical return logistics directly. Do not ask again for order number or name when the order is already known. Do not state who pays return shipping unless the customer asks about shipping cost or the policy clearly specifies it.",
    );
  }

  return lines.join("\n");
}

export function buildPinnedPolicyContext(options: {
  subject: string;
  body: string;
  policies: PoliciesForPrompt;
  reservedTokens?: number;
  /** Override auto-detection — pass planner intent when available */
  intentOverride?: PolicyIntent;
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
  // Knowledge-only policy: we no longer pin a structured policy_summary_json
  // blob or dump raw policy excerpts into the prompt. Policy CONTENT now comes
  // from retrieved agent_knowledge chunks (usable_as: "policy"), which already
  // reach the writer. We keep ONLY the behavioral guardrails (anti-hallucination,
  // channel rule, intent-based suppression) — these are not policy data and
  // prevent regressions. `policies`/`reservedTokens` are accepted for backwards
  // compatibility with callers but are no longer read.
  const intent = options.intentOverride ?? detectPolicyIntent(options.subject, options.body);
  const rules = policyRulesBlock(intent);

  return {
    intent,
    summary: { ...DEFAULT_POLICY_SUMMARY },
    policySummaryText: "",
    policyRulesText: rules,
    policyExcerptText: "",
    policySummaryTokens: 0,
    policyExcerptTokens: 0,
    policySummaryIncluded: false,
    policyExcerptIncluded: false,
  };
}
