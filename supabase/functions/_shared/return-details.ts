export type ReturnDetails = {
  order_number: string | null;
  customer_name: string | null;
  return_reason: string | null;
};

const SIGNOFF_HINTS = [
  "best",
  "best regards",
  "kind regards",
  "regards",
  "thanks",
  "mvh",
  "venlig hilsen",
  "med venlig hilsen",
  "hilsen",
];

const normalize = (value: string) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const toNull = (value: string) => {
  const cleaned = normalize(value);
  return cleaned ? cleaned : null;
};

function extractOrderNumber(text: string): string | null {
  const patterns = [
    /#\s*([A-Z0-9-]{3,})/i,
    /\border\s*(?:number|nr|no\.?|#)?\s*[:\-]?\s*([A-Z0-9-]{3,})/i,
    /\bordrenummer\s*[:\-]?\s*([A-Z0-9-]{3,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    return `#${String(match[1]).trim()}`;
  }
  return null;
}

function extractNameFromBody(body: string): string | null {
  const lines = String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const explicit = line.match(/^name\s*:\s*(.+)$/i);
    if (explicit?.[1]) return toNull(explicit[1]);
  }

  for (let i = 0; i < lines.length - 1; i += 1) {
    const lower = lines[i].toLowerCase().replace(/[.,:;!]+$/g, "").trim();
    if (!SIGNOFF_HINTS.includes(lower)) continue;
    const candidate = normalize(lines[i + 1]);
    if (!candidate) continue;
    if (candidate.length > 40) continue;
    if (!/^[A-Za-zÆØÅæøåÀ-ÿ' -]+$/.test(candidate)) continue;
    return candidate;
  }

  return null;
}

function extractReason(text: string): string | null {
  const reasonLabel = text.match(/\breason\s*:\s*([^\n.]{4,180})/i);
  if (reasonLabel?.[1]) return toNull(reasonLabel[1]);

  const returnBecause = text.match(/\b(?:i\s+want\s+to\s+return|return(?:ing)?)[^\n.]{0,60}\bbecause\s+([^\n.]{4,180})/i);
  if (returnBecause?.[1]) return toNull(returnBecause[1]);

  const because = text.match(/\bbecause\s+([^\n.]{4,180})/i);
  if (because?.[1]) return toNull(because[1]);

  return null;
}

export function extractReturnDetails(subject: string, body: string): ReturnDetails {
  const input = `${subject || ""}\n${body || ""}`;

  return {
    order_number: extractOrderNumber(input),
    customer_name: extractNameFromBody(body || ""),
    return_reason: extractReason(input),
  };
}

export function buildReturnDetailsFoundBlock(details: ReturnDetails): string {
  return [
    "RETURN DETAILS FOUND (PINNED):",
    `- order_number: ${details.order_number || "(unknown)"}`,
    `- name_used_at_purchase: ${details.customer_name || "(unknown)"}`,
    `- reason: ${details.return_reason || "(unknown)"}`,
  ].join("\n");
}

export function isReturnReasonRequiredByPolicy(policyText: string): boolean {
  const text = String(policyText || "").toLowerCase();
  if (!text) return false;
  return (
    /(?:return|refund)[^.\n]{0,80}(?:reason|årsag)[^.\n]{0,80}(?:required|must|shall|skal|include|oplyse)/.test(
      text,
    ) ||
    /(?:you must include|please include)[^.\n]{0,60}(?:reason|årsag)/.test(text)
  );
}

export function missingReturnDetails(
  details: ReturnDetails,
  options?: { requireReason?: boolean },
): Array<"order_number" | "customer_name" | "return_reason"> {
  const missing: Array<"order_number" | "customer_name" | "return_reason"> = [];
  if (!details.order_number) missing.push("order_number");
  if (!details.customer_name) missing.push("customer_name");
  if (options?.requireReason && !details.return_reason) missing.push("return_reason");
  return missing;
}

export function applyMatchedSubjectOrderNumber(
  details: ReturnDetails,
  matchedSubjectNumber?: string | null,
): ReturnDetails {
  const normalized = String(matchedSubjectNumber || "").trim().replace(/^#/, "");
  if (!normalized) return details;
  if (details.order_number) return details;
  return {
    ...details,
    order_number: `#${normalized}`,
  };
}
