import { extractReturnDetails } from "./return-details.ts";

export type ReturnMissingDetailKey = "order_number" | "customer_name" | "return_reason";

type ThreadHistoryItem = { role: "customer" | "support"; text: string };

export type ResolveReturnMissingDetailsInput = {
  missingDetails: ReturnMissingDetailKey[];
  selectedOrder?: unknown;
  returnDetailsCustomerName?: string | null;
  customerFirstName?: string | null;
  threadHistory?: ThreadHistoryItem[] | null;
};

export type ResolveReturnMissingDetailsResult = {
  effectiveMissingDetails: ReturnMissingDetailKey[];
  knownOrderNumber: boolean;
  knownCustomerName: boolean;
  historyProvidedOrderNumber: boolean;
  historyProvidedCustomerName: boolean;
};

export function resolveReturnMissingDetails(
  input: ResolveReturnMissingDetailsInput,
): ResolveReturnMissingDetailsResult {
  const historyHints = extractReturnHintsFromCustomerHistory(input.threadHistory || []);
  // Source of truth: only a resolved Shopify order context counts as known order.
  const knownOrderNumber = Boolean(input.selectedOrder);
  const knownCustomerName = Boolean(
    cleanValue(input.returnDetailsCustomerName) ||
      cleanValue(input.customerFirstName) ||
      cleanValue(historyHints.customerName),
  );

  const effectiveMissingDetails = (Array.isArray(input.missingDetails) ? input.missingDetails : []).filter((key) => {
    if (key === "order_number") return !knownOrderNumber;
    if (key === "customer_name") return !knownCustomerName;
    return true;
  });
  if (!knownOrderNumber && !effectiveMissingDetails.includes("order_number")) {
    effectiveMissingDetails.push("order_number");
  }

  return {
    effectiveMissingDetails,
    knownOrderNumber,
    knownCustomerName,
    // Keep as debug signal only; never used as source of truth.
    historyProvidedOrderNumber: Boolean(cleanValue(historyHints.orderNumber)),
    historyProvidedCustomerName: Boolean(cleanValue(historyHints.customerName)),
  };
}

function extractReturnHintsFromCustomerHistory(history: ThreadHistoryItem[]): {
  orderNumber: string | null;
  customerName: string | null;
} {
  const customerOnlyText = history
    .filter((item) => item?.role === "customer")
    .map((item) => String(item?.text || "").trim())
    .filter(Boolean)
    .join("\n\n");

  if (!customerOnlyText) {
    return { orderNumber: null, customerName: null };
  }

  const parsed = extractReturnDetails("", customerOnlyText);
  const strictOrderNumber = extractStrictOrderNumber(customerOnlyText);
  return {
    orderNumber: strictOrderNumber,
    customerName: cleanValue(parsed.customer_name),
  };
}

function cleanValue(value: string | null | undefined): string | null {
  const cleaned = String(value || "").trim();
  return cleaned.length ? cleaned : null;
}

function extractStrictOrderNumber(text: string): string | null {
  const input = String(text || "");
  if (!input.trim()) return null;

  // Prefer explicit hash format, e.g. #12345 or #AB-1234
  const hashMatch = input.match(/#([A-Z0-9-]{3,})/i);
  if (hashMatch?.[1]) {
    const token = hashMatch[1].trim();
    if (/[0-9]/.test(token) && !isKnownNonOrderToken(token)) {
      return `#${token}`;
    }
  }

  // Accept labeled forms only when token has at least one digit.
  const labelMatch = input.match(
    /\b(?:order\s*(?:number|nr|no\.?|#)|ordrenummer)\s*[:\-]?\s*([A-Z0-9-]{3,})\b/i,
  );
  if (labelMatch?.[1]) {
    const token = labelMatch[1].trim();
    if (/[0-9]/.test(token) && !isKnownNonOrderToken(token)) {
      return `#${token}`;
    }
  }

  return null;
}

function isKnownNonOrderToken(token: string): boolean {
  const normalized = String(token || "").trim().toUpperCase();
  if (!normalized) return true;
  const blocked = new Set([
    "WHAT",
    "NAME",
    "EMAIL",
    "BODY",
    "OTHER",
    "TEAM",
    "COUNTRY",
    "COMPANY",
    "REQUEST",
    "REGARDING",
    "PURCHASE",
  ]);
  return blocked.has(normalized);
}
