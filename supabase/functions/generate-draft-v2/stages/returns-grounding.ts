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

// A parsed return-address section. `kind` is "default" for a general/default
// address (no country qualifier), "country" for a country-specific one. The
// model is shop-agnostic: nothing here knows about AceZone, DK, EU, UK or US —
// classification and matching are driven entirely by the section headings.
export interface ReturnAddressEntry {
  kind: "default" | "country";
  countries: string[]; // normalized country aliases for "country"; [] for default
  address: string;
  heading: string;
}

export interface ReturnAddressSelection {
  // The address to ground, or null when we must not guess.
  address: string | null;
  // "country_match": exact country-specific address; "default": general/default
  // address; "ask_or_route": ambiguous/unknown → ask for country/order or route.
  basis: "country_match" | "default" | "ask_or_route";
  matchedCountry?: string | null;
}

// Country identity aliases (NOT region routing): purely normalises that e.g.
// "US"/"USA"/"United States" name the same country. Generic — any shop whose
// headings use these forms benefits; shops using other forms still match via
// raw heading tokens below.
const COUNTRY_ALIAS_GROUPS: string[][] = [
  ["us", "usa", "u s a", "u s", "united states", "united states of america", "america"],
  ["uk", "gb", "united kingdom", "great britain", "britain"],
  ["dk", "denmark", "danmark"],
  ["de", "germany", "deutschland"],
  ["se", "sweden", "sverige"],
  ["no", "norway", "norge"],
  ["nl", "netherlands", "holland"],
  ["fr", "france"],
  ["es", "spain", "españa", "espana"],
  ["it", "italy", "italia"],
  ["pt", "portugal"],
  ["ca", "canada"],
];

function normCountry(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Expand a normalised country phrase into the set of equivalent aliases, so that
// "us" and "united states" compare equal.
function expandCountry(value: string): Set<string> {
  const norm = normCountry(value);
  const out = new Set<string>(norm ? [norm] : []);
  if (!norm) return out;
  for (const group of COUNTRY_ALIAS_GROUPS) {
    if (group.some((g) => g === norm || new RegExp(`\\b${g}\\b`).test(norm))) {
      for (const g of group) out.add(g);
    }
  }
  return out;
}

const RETURN_ADDRESS_HEADING_RE = /return\s+address|returadresse/i;
const DEFAULT_HEADING_RE = /\b(default|general)\b/i;

// Parse every "## ... return address" section out of the returns doc contents
// and classify each as default/general or country-specific. Pure; no IO.
export function parseReturnAddresses(
  returnsContents: string[],
): ReturnAddressEntry[] {
  const entries: ReturnAddressEntry[] = [];
  for (const content of returnsContents) {
    const text = String(content || "").replace(/\r/g, "");
    const sectionRe = /##\s*(.+?)\n([\s\S]*?)(?=\n##\s|\n#\s|$)/g;
    let match: RegExpExecArray | null;
    while ((match = sectionRe.exec(text)) !== null) {
      const heading = match[1].trim();
      const body = match[2].trim();
      if (!body || !RETURN_ADDRESS_HEADING_RE.test(heading)) continue;
      const label = heading.replace(RETURN_ADDRESS_HEADING_RE, " ");
      const isDefault = DEFAULT_HEADING_RE.test(label) ||
        normCountry(label).replace(/\b(amazon|orders?|and|the|for)\b/g, "").trim() === "";
      if (isDefault) {
        entries.push({ kind: "default", countries: [], address: body, heading });
        continue;
      }
      // Country-specific: collect alias-group members present anywhere in the
      // heading, plus the raw label token(s) so unknown countries still match.
      const blob = normCountry(heading);
      const countries = new Set<string>();
      for (const group of COUNTRY_ALIAS_GROUPS) {
        if (group.some((g) => new RegExp(`\\b${g}\\b`).test(blob))) {
          for (const g of group) countries.add(g);
        }
      }
      for (const tok of normCountry(label).split(" ")) {
        if (tok && !["amazon", "orders", "order", "and", "the", "for"].includes(tok)) {
          countries.add(tok);
        }
      }
      entries.push({ kind: "country", countries: [...countries], address: body, heading });
    }
  }
  return entries;
}

// Deterministic fallback country signal: standard Shopify contact-form fields
// ("Your Country", "Shipping Country", "Country", then "Country Code"). Generic
// across shops (same form fields parsed in customer-context.ts / language.ts);
// used only when the LLM-extracted customer_country is empty, so the address
// selector does not silently fall back to the default for a clearly-stated
// foreign country (g-034). Pure; returns the raw value or null.
const COUNTRY_FIELD_RES = [
  /(?:^|\n)\s*(?:Your\s+Country|Shipping\s+Country|Country)\s*:\s*([^\n]+?)\s*(?=\n|$)/i,
  /(?:^|\n)\s*Country\s+Code\s*:\s*([^\n]+?)\s*(?=\n|$)/i,
];
export function extractCustomerCountryFromText(
  text: string | null | undefined,
): string | null {
  const body = String(text ?? "");
  for (const re of COUNTRY_FIELD_RES) {
    const m = body.match(re);
    const v = m?.[1]?.trim();
    if (v) return v;
  }
  return null;
}

function countryMatches(entry: ReturnAddressEntry, country: string): boolean {
  const wanted = expandCountry(country);
  if (wanted.size === 0) return false;
  return entry.countries.some((c) => wanted.has(c));
}

// Select the return address for a customer. Country-specific exact match wins;
// otherwise a single clear default; otherwise we refuse to guess (ask/route).
export function selectReturnAddress(input: {
  entries: ReturnAddressEntry[];
  orderCountry?: string | null;
  customerCountry?: string | null;
}): ReturnAddressSelection {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const defaults = entries.filter((e) => e.kind === "default");
  const countrySpecific = entries.filter((e) => e.kind === "country");
  const country = [input.orderCountry, input.customerCountry]
    .map((c) => String(c ?? "").trim())
    .find((c) => c.length > 0) ?? "";

  if (country) {
    const match = countrySpecific.find((e) => countryMatches(e, country));
    if (match) {
      return { address: match.address, basis: "country_match", matchedCountry: country };
    }
  }
  // Unknown country, or known but no country-specific match: fall back to a
  // SINGLE clearly-marked default. Multiple defaults (or none) → never guess.
  if (defaults.length === 1) {
    return { address: defaults[0].address, basis: "default", matchedCountry: null };
  }
  return { address: null, basis: "ask_or_route", matchedCountry: null };
}

// All grounded return addresses (for the verifier guard). Pure.
export function groundedReturnAddresses(
  returnsContents: string[],
): string[] {
  return parseReturnAddresses(returnsContents).map((e) => e.address);
}

// True when at least one parseable return-address section is present among the
// retrieved chunks. Used by the pipeline to decide whether the deterministic
// returns-doc fetch must run (vector recall often misses the tiny address chunk
// even when other returns sections — return window, refund processing — are
// retrieved). Pure.
export function hasGroundedReturnAddressChunk(
  chunks: ReturnsChunkLike[] | null | undefined,
): boolean {
  return parseReturnAddresses(selectReturnsPolicyContents(chunks)).length > 0;
}

// Writer directive: ground the selected return address + ordinary-return policy.
export function buildReturnsGroundingDirective(opts: {
  isReturnRefundIntent: boolean;
  selection: ReturnAddressSelection;
  orderNumber?: string | null;
}): string {
  if (!opts.isReturnRefundIntent) return "";
  const chosen = opts.selection.address;

  const lines = ["# Returns & Refunds grounding (canonical — use VERBATIM)"];
  if (chosen) {
    lines.push(
      `- Use ONLY this grounded return address (do NOT invent, paraphrase, substitute another country's address, or take an address from example emails):\n${chosen}`,
    );
    lines.push(
      "- This is the correct return address for this customer. Do NOT use any other return address that may appear elsewhere in context.",
    );
  } else {
    lines.push(
      "- No return address can be safely selected for this customer (unknown or ambiguous country). Do NOT state any return address — never invent, guess, or use a placeholder. Ask for the customer's country / order details, or route to review.",
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
