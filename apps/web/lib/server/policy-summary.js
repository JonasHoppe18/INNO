const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const POLICY_SUMMARY_VERSION = 1;

const DEFAULT_POLICY_SUMMARY = {
  return_window_days: null,
  return_instructions_short: "Follow the store policy. If unclear, ask one question.",
  return_address: "",
  return_contact_email: "",
  return_shipping_paid_by: "unknown",
  refund_conditions_short: "Follow the store policy. If unclear, ask one question.",
  warranty_duration_regions_short: "",
  last_modified_date: null,
};

function clamp(value, max) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(0, max));
}

function normalizeSummary(input) {
  const base = { ...DEFAULT_POLICY_SUMMARY };
  if (!input || typeof input !== "object" || Array.isArray(input)) return base;
  const returnWindow = Number(input.return_window_days);
  const paidBy = String(input.return_shipping_paid_by || "").toLowerCase();
  return {
    return_window_days:
      Number.isInteger(returnWindow) && returnWindow > 0 && returnWindow <= 365 ? returnWindow : null,
    return_instructions_short:
      clamp(input.return_instructions_short, 600) || DEFAULT_POLICY_SUMMARY.return_instructions_short,
    return_address: clamp(input.return_address, 400),
    return_contact_email: clamp(input.return_contact_email, 200),
    return_shipping_paid_by: paidBy === "customer" || paidBy === "merchant" ? paidBy : "unknown",
    refund_conditions_short:
      clamp(input.refund_conditions_short, 600) || DEFAULT_POLICY_SUMMARY.refund_conditions_short,
    warranty_duration_regions_short: clamp(input.warranty_duration_regions_short, 600),
    last_modified_date: clamp(input.last_modified_date, 100) || null,
  };
}

function parseReturnWindowDays(text = "") {
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

function inferReturnShippingPaidBy(text = "") {
  const lower = String(text || "").toLowerCase();
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

function firstEmail(text = "") {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function maybeAddress(text = "") {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const found = lines.find((line) =>
    /\b(street|st\.?|road|rd\.?|ave\.?|avenue|boulevard|blvd|drive|dr\.?|city|zip|postal|dk-|usa|denmark|suite|unit|building|address)\b/i.test(
      line,
    ),
  );
  return found || "";
}

function heuristicSummary({ refundPolicy = "", shippingPolicy = "", termsPolicy = "" }) {
  const combined = [refundPolicy, shippingPolicy, termsPolicy].filter(Boolean).join("\n\n");
  return normalizeSummary({
    return_window_days: parseReturnWindowDays(combined),
    return_instructions_short: refundPolicy || DEFAULT_POLICY_SUMMARY.return_instructions_short,
    return_address: maybeAddress(refundPolicy),
    return_contact_email: firstEmail(combined),
    return_shipping_paid_by: inferReturnShippingPaidBy(combined),
    refund_conditions_short: refundPolicy || DEFAULT_POLICY_SUMMARY.refund_conditions_short,
    warranty_duration_regions_short: termsPolicy,
    last_modified_date: null,
  });
}

async function llmSummary({ refundPolicy = "", shippingPolicy = "", termsPolicy = "", privacyPolicy = "" }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const schema = {
    name: "policy_summary",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        return_window_days: { type: ["integer", "null"] },
        return_instructions_short: { type: "string" },
        return_address: { type: "string" },
        return_contact_email: { type: "string" },
        return_shipping_paid_by: { type: "string", enum: ["customer", "merchant", "unknown"] },
        refund_conditions_short: { type: "string" },
        warranty_duration_regions_short: { type: "string" },
        last_modified_date: { type: ["string", "null"] },
      },
      required: [
        "return_window_days",
        "return_instructions_short",
        "return_address",
        "return_contact_email",
        "return_shipping_paid_by",
        "refund_conditions_short",
        "warranty_duration_regions_short",
        "last_modified_date",
      ],
    },
  };

  const system = [
    "You extract e-commerce policy facts.",
    "Return only valid JSON matching the schema.",
    "Keep each short field concise and factual.",
    "If data is missing, use empty strings, null, or 'unknown'.",
  ].join("\n");

  const prompt = [
    "Refund/Return Policy:",
    String(refundPolicy || "").slice(0, 4000) || "(missing)",
    "",
    "Shipping Policy:",
    String(shippingPolicy || "").slice(0, 3000) || "(missing)",
    "",
    "Terms Policy:",
    String(termsPolicy || "").slice(0, 3000) || "(missing)",
    "",
    "Privacy Policy:",
    String(privacyPolicy || "").slice(0, 2000) || "(missing)",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      max_tokens: 280,
      response_format: {
        type: "json_schema",
        json_schema: schema,
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI failed with ${response.status}`);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Missing summary JSON response");
  }
  return normalizeSummary(JSON.parse(content));
}

export function mapPoliciesFromShopify(rawPolicies = []) {
  const mapped = {
    refund: "",
    shipping: "",
    terms: "",
    privacy: "",
    found: [],
  };

  for (const policy of Array.isArray(rawPolicies) ? rawPolicies : []) {
    const key = String(
      policy?.policy_type || policy?.handle || policy?.title || "",
    ).toLowerCase();
    const body = String(policy?.body || policy?.body_html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!body) continue;

    if (key.includes("refund") || key.includes("return")) {
      mapped.refund = body;
      mapped.found.push("refund");
    } else if (key.includes("shipping")) {
      mapped.shipping = body;
      mapped.found.push("shipping");
    } else if (key.includes("term")) {
      mapped.terms = body;
      mapped.found.push("terms");
    } else if (key.includes("privacy")) {
      mapped.privacy = body;
      mapped.found.push("privacy");
    }
  }

  return mapped;
}

export async function summarizePolicies(input) {
  const base = {
    refundPolicy: String(input?.refundPolicy || ""),
    shippingPolicy: String(input?.shippingPolicy || ""),
    termsPolicy: String(input?.termsPolicy || ""),
    privacyPolicy: String(input?.privacyPolicy || ""),
  };

  try {
    const llm = await llmSummary(base);
    return {
      summary: llm,
      version: POLICY_SUMMARY_VERSION,
      used_fallback: false,
      updated_at: new Date().toISOString(),
    };
  } catch (_error) {
    const fallback = heuristicSummary(base);
    return {
      summary: fallback,
      version: POLICY_SUMMARY_VERSION,
      used_fallback: true,
      updated_at: new Date().toISOString(),
    };
  }
}

export { DEFAULT_POLICY_SUMMARY, POLICY_SUMMARY_VERSION, normalizeSummary, heuristicSummary };
