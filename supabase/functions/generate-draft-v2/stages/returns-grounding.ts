// supabase/functions/generate-draft-v2/stages/returns-grounding.ts
//
// Deterministic Returns & Refunds grounding for return/refund tickets.
//
// Problem (T-050835): the writer hallucinated a fake return address
// ("AceZone Returns / 1234 Return St. / City, Postal Code") that exists in NO
// knowledge source. The canonical Returns & Refunds doc DOES exist
// (source_provider=knowledge_document, category=returns, usable_as=policy) with
// the real default (Denmark) and US addresses — but it is left to vector recall
// and the writer is free to invent an address.
//
// This module is pure and product/shop-agnostic. It extracts the canonical
// return addresses + policy FROM the retrieved returns doc (never hardcoded),
// chooses the right address by customer/order country, and builds a strong
// writer directive. A companion verifier guard blocks any return address that
// is not one of the grounded addresses (incl. placeholders). No DB/Shopify/IO.

export interface ReturnsChunkLike {
  source_provider?: string | null;
  content?: string | null;
  // RetrievedChunk exposes document_category; raw rows expose metadata.category.
  document_category?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Only genuine return/refund intents auto-ground the canonical Returns &
// Refunds doc. "complaint" and "exchange" were previously included but are too
// broad: the classifier labels product-troubleshooting tickets as "complaint"
// (e.g. "my mic isn't working") and purchase/replacement questions as
// "exchange" (e.g. "can I buy replacement ear pads"), which injected the returns
// doc into unrelated queries as retrieval noise. Real return/refund context
// inside such tickets is still caught by RETURN_KEYWORDS_RE below
// (return/refund/retur/refusion/send back/reklam/withdraw/fortryd…).
const RETURN_INTENTS = new Set(["return", "refund"]);
const RETURN_KEYWORDS_RE =
  /\b(return\w*|refund\w*|retur\w*|refusion\w*|money\s+back|pengene\s+tilbage|send\s+(?:it|the\s+headset)\s+back|reklam\w*|withdraw\w*|fortryd\w*)\b/i;

export function isReturnRefundIntent(
  primaryIntent: string | null | undefined,
  message: string | null | undefined,
): boolean {
  if (primaryIntent && RETURN_INTENTS.has(String(primaryIntent))) return true;
  return RETURN_KEYWORDS_RE.test(String(message ?? ""));
}

// The canonical returns-policy chunk contents (knowledge_document, category
// "returns", usable_as "policy"). Pure filter over already-retrieved chunks.
export function selectReturnsPolicyContents(
  chunks: ReturnsChunkLike[] | null | undefined,
): string[] {
  return (Array.isArray(chunks) ? chunks : [])
    .filter((c) => String(c.source_provider || "").toLowerCase() === "knowledge_document")
    .filter((c) => {
      const m = (c.metadata ?? {}) as Record<string, unknown>;
      const category = c.document_category ?? m.category;
      return String(category || "").toLowerCase() === "returns";
    })
    .map((c) => String(c.content || "").trim())
    .filter(Boolean);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

// Parse "## Default return address" / "## US return address" sections out of the
// returns doc contents. Returns trimmed multi-line address blocks (or null).
export function extractReturnAddresses(
  returnsContents: string[],
): { default: string | null; us: string | null } {
  let def: string | null = null;
  let us: string | null = null;
  for (const content of returnsContents) {
    const text = String(content || "").replace(/\r/g, "");
    // Split into "## heading\n body" sections.
    const sectionRe = /##\s*(.+?)\n([\s\S]*?)(?=\n##\s|\n#\s|$)/g;
    let match: RegExpExecArray | null;
    while ((match = sectionRe.exec(text)) !== null) {
      const heading = match[1].trim().toLowerCase();
      const body = match[2].trim();
      if (!body) continue;
      if (!def && /default\s+return\s+address|return\s+address\b(?!.*\bus\b)/i.test(heading) &&
        !/\bus\b|united\s+states/i.test(heading)) {
        def = body;
      } else if (!us && /(us|u\.s\.|united\s+states)\s+return\s+address/i.test(heading)) {
        us = body;
      }
    }
  }
  return { default: def, us };
}

const US_COUNTRY_RE = /^(us|usa|u\.s\.a?\.?|united\s+states(?:\s+of\s+america)?)$/i;

// Choose which grounded address applies. US only when country clearly says US;
// everything else (incl. unknown) → default (Denmark).
export function resolveReturnCountryPreference(input: {
  orderCountry?: string | null;
  customerCountry?: string | null;
}): "us" | "default" {
  for (const c of [input.orderCountry, input.customerCountry]) {
    const v = String(c ?? "").trim();
    if (v && US_COUNTRY_RE.test(v)) return "us";
  }
  return "default";
}

// All grounded return addresses (for the verifier guard).
export function groundedReturnAddresses(
  returnsContents: string[],
): string[] {
  const { default: def, us } = extractReturnAddresses(returnsContents);
  return [def, us].filter((a): a is string => Boolean(a));
}

// Writer directive: ground the return address + ordinary-return policy.
export function buildReturnsGroundingDirective(opts: {
  isReturnRefundIntent: boolean;
  addresses: { default: string | null; us: string | null };
  countryPreference: "us" | "default";
  orderNumber?: string | null;
}): string {
  if (!opts.isReturnRefundIntent) return "";
  const chosen = opts.countryPreference === "us"
    ? (opts.addresses.us ?? opts.addresses.default)
    : (opts.addresses.default ?? opts.addresses.us);

  const lines = ["# Returns & Refunds grounding (canonical — use VERBATIM)"];
  if (chosen) {
    lines.push(
      `- Use ONLY this grounded return address (do NOT invent, paraphrase, or take an address from example emails):\n${chosen}`,
    );
    if (opts.countryPreference === "us") {
      lines.push("- This is a US customer → use the US return address above.");
    } else {
      lines.push(
        "- This is a non-US / EU / unknown-country customer → use the default (Denmark) return address above. Do NOT use the US address.",
      );
    }
  } else {
    lines.push(
      "- No grounded return address is available. Do NOT state any return address — never invent one or use a placeholder. Say that we will send the correct return details, or ask for the order so we can follow up.",
    );
  }
  if (opts.orderNumber) {
    lines.push(
      `- Ask the customer to include their order number ${opts.orderNumber} in the parcel so we can identify the return.`,
    );
  }
  lines.push(
    "- Ordinary returns: the CUSTOMER arranges and pays for return shipping. Recommend a tracked shipping method and keeping the tracking until we receive the parcel.",
  );
  lines.push(
    "- Do NOT promise a prepaid return label, a free return, an exact refund date, or that the customer will be notified automatically.",
  );
  lines.push(
    "- Do NOT promise a full refund before inspection: if the product has been opened, used or worn, say the refund amount is assessed based on the returned item's condition.",
  );
  lines.push(
    "- Return address, return-shipping rules, label policy and refund timing must come ONLY from this canonical grounding — never from previous/example emails.",
  );
  return lines.join("\n");
}

// --- Verifier-side deterministic guard --------------------------------------

const RETURN_ADDRESS_PLACEHOLDER_RE =
  /\b1234\s+return\s+st|city,\s*postal\s*code|\[\s*return\s*address\s*\]|\[\s*returadresse\s*\]|\breturn\s+st\.?(?:\s|$)/i;

const STREET_SUFFIX = "st|street|dr|drive|ave|avenue|rd|road|ln|lane|blvd|boulevard|way|allé|allee|vej|gade|gaden|plads|strasse|straße";
// A real street line: either "<number> <words> <street-suffix>" (US/UK style,
// e.g. "1234 Return St.", "49 Innovation Drive") OR "<street-suffix> <number>"
// (DK/EU style, e.g. "Allé 56"). Requires an actual street-type token so it does
// NOT match e.g. "order number #4542 in the parcel".
const STREET_LINE_RE = new RegExp(
  `\\b\\d{1,5}\\s+[A-Za-zÆØÅÄÖ][\\wÆØÅÄÖ.'-]*(?:\\s+[A-Za-zÆØÅÄÖ][\\wÆØÅÄÖ.'-]*)*\\s+(?:${STREET_SUFFIX})\\.?\\b` +
    `|\\b(?:${STREET_SUFFIX})\\s+\\d{1,4}\\b`,
  "i",
);

function compact(value: string): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// Block when a return/refund draft contains a placeholder return address, OR a
// street-address line that is not part of any grounded address. Pure.
export function detectFabricatedReturnAddress(
  draftText: string | null | undefined,
  opts: { isReturnRefundIntent: boolean; groundedAddresses: string[] },
): boolean {
  if (!opts.isReturnRefundIntent) return false;
  const draft = String(draftText ?? "");
  if (!draft.trim()) return false;
  if (RETURN_ADDRESS_PLACEHOLDER_RE.test(draft)) return true;

  // If we have grounded addresses, any street-address line in the draft must be
  // part of one of them; otherwise it is an ungrounded/invented address.
  if (opts.groundedAddresses.length > 0) {
    const groundedCompact = opts.groundedAddresses.map(compact);
    for (const rawLine of draft.split(/\n/)) {
      const line = rawLine.trim();
      if (!STREET_LINE_RE.test(line)) continue;
      const lineCompact = compact(line);
      if (!lineCompact) continue;
      const grounded = groundedCompact.some((addr) => addr.includes(lineCompact));
      if (!grounded) return true;
    }
  }
  return false;
}

// --- Previous-email example sanitization ------------------------------------

// Strip address-like lines (street + number, postal+city, country) from an
// example reply so past emails cannot supply an authoritative return address
// for a return/refund ticket. Tone/structure is preserved.
const POSTAL_CITY_RE = /\b\d{3,5}\s+[A-Za-zÆØÅÄÖ]/; // "2100 København"
const COUNTRY_LINE_RE = /^\s*(denmark|danmark|usa|u\.s\.a\.?|united\s+states|sweden|sverige|germany|deutschland|norway|norge)\s*$/i;
// Company / org lines that form part of an address block.
const COMPANY_LINE_RE = /\b(ApS|A\/S|Inc\.?|LLC|Ltd\.?|GmbH|Prep\s+Partners)\b/i;

export function stripAddressLinesFromExample(text: string | null | undefined): string {
  const out: string[] = [];
  for (const rawLine of String(text ?? "").split(/\n/)) {
    const line = rawLine.trim();
    if (
      STREET_LINE_RE.test(line) || POSTAL_CITY_RE.test(line) ||
      COUNTRY_LINE_RE.test(line) || COMPANY_LINE_RE.test(line)
    ) {
      continue; // drop address-like line
    }
    out.push(rawLine);
  }
  return out.join("\n");
}
