// supabase/functions/generate-draft-v2/stages/provenance.ts
//
// Safe, response-only provenance for generate-draft-v2 (Stage 5, Slice 1).
//
// Surfaces WHERE a draft's facts came from so support agents can see that a
// correct answer is actually supported. PURE module (no DB, no LLM, no network):
// the pipeline passes in already-resolved data and gets back a flat, UI-ready
// `Provenance` object.
//
// Hard safety rules (enforced by tests):
//   - NEVER expose hidden writer-directive text (internalRulesBlock, the Danish
//     instruction prose embedded in some fact VALUES). Live facts whose value is
//     directive-laden (refund) are reduced to a safe summary; guardrail messages
//     are generated here, never copied from the raw fact value.
//   - structured_facts are confirmed-only (the specs/compat resolvers already
//     dropped suggested rows before reaching the builders).
//   - PII-ish facts (customer name, email, full address) are not surfaced.

export interface RetrievedSourceProvenance {
  id?: string;
  source_label?: string;
  kind?: string;
  usable_as?: string;
  risk_flags?: string[];
  similarity?: number;
  snippet?: string;
}

export interface StructuredFactProvenance {
  type: "spec" | "comparison" | "compatibility";
  product_titles?: string[];
  key: string;
  value: string;
  confidence: "confirmed";
  origin_table: "shop_product_specs" | "shop_product_compatibility";
}

export interface LiveFactProvenance {
  label: string;
  value: string;
  source:
    | "shopify_order"
    | "carrier_tracking"
    | "refund_derivation"
    | "shopify_inventory";
  verified: true;
}

export interface GuardrailUnavailableProvenance {
  topic: "compatibility" | "stock" | "order" | "tracking" | "refund";
  reason:
    | "no_confirmed_row"
    | "integration_error"
    | "no_live_stock"
    | "order_not_found";
  message: string;
}

export interface Provenance {
  retrieved_sources: RetrievedSourceProvenance[];
  structured_facts: StructuredFactProvenance[];
  live_facts: LiveFactProvenance[];
  guardrails_unavailable: GuardrailUnavailableProvenance[];
}

// Minimal structural shapes — defined locally so this module stays dependency-
// free (no runtime coupling to the heavy fact-resolver / retriever modules).
export interface ProvenanceLiveFactInput {
  label: string;
  value: string;
}

export interface ProvenanceChunkInput {
  id?: string;
  source_label?: string;
  kind?: string;
  usable_as?: string;
  risk_flags?: string[];
  similarity?: number;
  content?: string;
}

const SNIPPET_LEN = 200;
const RETRIEVED_LIMIT = 5;

const STOCK_FACT_LABEL = "Live stock availability";
const REFUND_LABEL_PREFIX = "Refunderingsstatus";

// Stock states that represent a confirmed live answer (vs. unknown).
const KNOWN_STOCK_STATES = new Set([
  "in_stock",
  "out_of_stock",
  "low_stock",
  "preorder",
  "discontinued",
  "unavailable",
]);

/** Parse the `key=value; key=value` stock fact value into a flat map. */
function parseStockFields(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(value ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

export function mapRetrievedSources(
  chunks: ProvenanceChunkInput[] | null | undefined,
  limit: number = RETRIEVED_LIMIT,
): RetrievedSourceProvenance[] {
  const list = Array.isArray(chunks) ? chunks : [];
  return list.slice(0, Math.max(0, limit)).map((c) => {
    const entry: RetrievedSourceProvenance = {};
    if (c.id != null) entry.id = String(c.id);
    if (c.source_label != null) entry.source_label = c.source_label;
    if (c.kind != null) entry.kind = c.kind;
    if (c.usable_as != null) entry.usable_as = c.usable_as;
    if (Array.isArray(c.risk_flags)) entry.risk_flags = c.risk_flags;
    if (typeof c.similarity === "number") entry.similarity = c.similarity;
    if (c.content != null) entry.snippet = String(c.content).slice(0, SNIPPET_LEN);
    return entry;
  });
}

/**
 * Maps resolved facts into safe, verified live facts. Only a whitelist of
 * status-style facts surface; PII (name/email/address) is dropped. For the
 * refund fact — whose VALUE carries hidden writer directives — only the status
 * summary embedded in the LABEL is exposed, never the directive prose.
 */
export function mapLiveFacts(
  facts: ProvenanceLiveFactInput[] | null | undefined,
): LiveFactProvenance[] {
  const out: LiveFactProvenance[] = [];
  for (const f of Array.isArray(facts) ? facts : []) {
    const label = String(f?.label ?? "");
    const value = String(f?.value ?? "");

    if (label === "Ordre fundet" || label === "Tracking") {
      // "Ordre fundet" + "Ordren er endnu ikke afsendt" — order/fulfillment state.
      out.push({ label, value, source: "shopify_order", verified: true });
    } else if (
      label === "Tracking (fragtmand)" ||
      label === "Forventet levering" ||
      label === "Leveret tidspunkt"
    ) {
      out.push({ label, value, source: "carrier_tracking", verified: true });
    } else if (label.startsWith(REFUND_LABEL_PREFIX)) {
      // The value contains writer instructions — expose ONLY the label summary.
      const summary = label.replace(/^Refunderingsstatus:\s*/, "").trim();
      out.push({
        label: "Refund status",
        value: summary || "se ordre",
        source: "refund_derivation",
        verified: true,
      });
    } else if (label === STOCK_FACT_LABEL) {
      const fields = parseStockFields(value);
      const state = (fields.state ?? "").toLowerCase();
      if (KNOWN_STOCK_STATES.has(state)) {
        const product = fields.product ?? fields.product_query ?? "";
        out.push({
          label: "Stock availability",
          value: product ? `${product}: ${state}` : state,
          source: "shopify_inventory",
          verified: true,
        });
      }
      // unknown / variant_clarification_required → handled by mapFactGuardrails.
    }
    // Everything else (Kundenavn, Kunde-email, Leveringsadresse, instruction
    // facts, customer-provided tracking, etc.) is intentionally not surfaced.
  }
  return out;
}

/**
 * Derives "unavailable fact" guardrails from order/stock facts. Messages are
 * generated here — the raw fact value (which carries hidden directive prose) is
 * never copied into the response.
 */
export function mapFactGuardrails(
  facts: ProvenanceLiveFactInput[] | null | undefined,
): GuardrailUnavailableProvenance[] {
  const out: GuardrailUnavailableProvenance[] = [];
  for (const f of Array.isArray(facts) ? facts : []) {
    const label = String(f?.label ?? "");

    if (label === "Ordre IKKE fundet" || label === "Ingen ordre fundet") {
      out.push({
        topic: "order",
        reason: "order_not_found",
        message: "No matching order could be found for the customer's details.",
      });
    } else if (label === "Ingen identifikatorer") {
      out.push({
        topic: "order",
        reason: "order_not_found",
        message: "No order number or email was available to look up an order.",
      });
    } else if (label === "Ordreopslag midlertidigt utilgængeligt") {
      out.push({
        topic: "order",
        reason: "integration_error",
        message:
          "The order lookup is temporarily unavailable; order facts could not be verified.",
      });
    } else if (label === STOCK_FACT_LABEL) {
      const state = (parseStockFields(String(f?.value ?? "")).state ?? "")
        .toLowerCase();
      if (!KNOWN_STOCK_STATES.has(state)) {
        out.push({
          topic: "stock",
          reason: "no_live_stock",
          message:
            "Live stock availability could not be confirmed for the requested product.",
        });
      }
    }
  }
  return out;
}

export function assembleProvenance(input: {
  retrievedChunks?: ProvenanceChunkInput[] | null;
  structuredFacts?: StructuredFactProvenance[] | null;
  facts?: ProvenanceLiveFactInput[] | null;
  extraGuardrails?: GuardrailUnavailableProvenance[] | null;
}): Provenance {
  const facts = input.facts ?? [];
  return {
    retrieved_sources: mapRetrievedSources(input.retrievedChunks),
    structured_facts: input.structuredFacts ?? [],
    live_facts: mapLiveFacts(facts),
    guardrails_unavailable: [
      ...mapFactGuardrails(facts),
      ...(input.extraGuardrails ?? []),
    ],
  };
}
