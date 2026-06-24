// supabase/functions/generate-draft-v2/stages/product-compatibility.ts
//
// Structured, platform-neutral product compatibility (Stage 4B-3-1).
//
// Sona answers "is this compatible with <platform>?" from curated, confirmed
// rows in public.shop_product_compatibility — never by guessing from product
// descriptions or prose retrieval. This module is PURE (no DB, no LLM): the
// pipeline fetches the rows and passes them in.
//
// Resolution rules:
//   - product-specific rows (product_id = the asked product) override brand-wide
//     rows (product_id = null) for the same target+connection,
//   - only confidence='confirmed' rows are ever served,
//   - no confirmed row => unknown ("not confirmed"); the writer must not guess.

import type {
  GuardrailUnavailableProvenance,
  StructuredFactProvenance,
} from "./provenance.ts";

export type CompatibleState = "yes" | "no" | "partial";

export interface CompatibilityRow {
  product_id: number | null;
  target: string;
  connection: string;
  compatible: CompatibleState;
  reason: string | null;
  workaround: string | null;
  confidence: "confirmed" | "suggested";
}

export interface CompatibilityResult {
  connection: string;
  compatible: CompatibleState;
  reason: string | null;
  workaround: string | null;
}

export interface ResolvedCompatibility {
  target: string;
  known: boolean;
  results: CompatibilityResult[];
}

// Controlled vocabularies + natural-language synonyms. Output values are the
// platform-neutral canonical tokens stored in the table.
const TARGET_SYNONYMS: Array<[string, RegExp]> = [
  ["xbox", /\bx[\s-]?box\b|\bseries\s*[xs]\b/i],
  ["playstation", /\bplay[\s-]?station\b|\bps[\s-]?[345]\b|\bplaystation\b/i],
  ["switch", /\bnintendo\b|\bswitch\b/i],
  ["mac", /\bmac\b|\bmac[\s-]?os\b|\bmacbook\b|\bosx\b/i],
  ["ios", /\biphone\b|\bipad\b|\bios\b/i],
  ["android", /\bandroid\b/i],
  ["pc", /\bpc\b|\bwindows\b|\bcomputer\b/i],
];

const CONNECTION_SYNONYMS: Array<[string, RegExp]> = [
  ["usb_c", /\busb[\s-]?c\b|\btype[\s-]?c\b/i],
  ["wireless_dongle", /\bdongle\b|\b2\.4\s*ghz\b|\bwireless\s*(adapter|receiver|dongle)?\b|\bwirelessly\b/i],
  ["bluetooth", /\bbluetooth\b|\bbt\b/i],
  ["aux_3_5mm", /\baux\b|\b3\.5\s*mm\b|\bheadphone\s*jack\b|\banalou?g\b|\bjack\b/i],
  ["xlr", /\bxlr\b/i],
  ["usb", /\busb\b/i], // generic USB last so usb_c wins first
];

const COMPAT_KEYWORD =
  /\bcompatib|\bwork(s|ing)?\s+(with|on)\b|\bsupport(s|ed)?\b|\bconnect\b|\buse\s+(it|this|the\s+headset)\s+(with|on)\b/i;

export function detectCompatibilityQuery(
  text: string | null | undefined,
): { targets: string[]; connections: string[] } {
  const t = String(text ?? "");
  const targets: string[] = [];
  for (const [canon, re] of TARGET_SYNONYMS) {
    if (re.test(t) && !targets.includes(canon)) targets.push(canon);
  }
  const connections: string[] = [];
  for (const [canon, re] of CONNECTION_SYNONYMS) {
    if (re.test(t)) {
      // Prefer usb_c over generic usb when both could match.
      if (canon === "usb" && connections.includes("usb_c")) continue;
      if (!connections.includes(canon)) connections.push(canon);
    }
  }
  return { targets, connections };
}

export function isCompatibilityQuestion(
  text: string | null | undefined,
): boolean {
  const { targets, connections } = detectCompatibilityQuery(text);
  if (targets.length === 0) return false;
  // A platform target plus either an explicit connection or a compatibility
  // keyword. Keeps this conservative so unrelated mentions don't trigger.
  return connections.length > 0 || COMPAT_KEYWORD.test(String(text ?? ""));
}

/**
 * Slice J — resolve the SINGLE product the customer is asking about, by matching
 * shop product titles against the message. Returns the product id ONLY when
 * exactly one product resolves; returns null when none or several match, so the
 * caller falls back to brand-wide rows and never guesses a product.
 *
 * Prefix-variant safe: when both "A-Spire" and "A-Spire Wireless" titles appear
 * in the text, only the most specific ("A-Spire Wireless") is kept — mirrors
 * resolveMostSpecificProductTerms in the retriever.
 */
export function detectCompatibilityProduct(
  text: string | null | undefined,
  products: Array<{ id: number; title: string }> | null | undefined,
): number | null {
  const lower = String(text ?? "").toLowerCase();
  const list = Array.isArray(products) ? products : [];

  const matched = list
    .map((p) => ({ id: p?.id, title: String(p?.title ?? "").toLowerCase().trim() }))
    .filter((p) => p.title.length > 0 && Number.isFinite(p.id) && lower.includes(p.title));
  if (matched.length === 0) return null;

  // Drop any matched title that is a substring of another, longer matched title
  // (e.g. "a-spire" when "a-spire wireless" is also present).
  const mostSpecific = matched.filter((p) =>
    !matched.some((other) =>
      other.title !== p.title &&
      other.title.length > p.title.length &&
      other.title.includes(p.title)
    )
  );

  const ids = Array.from(new Set(mostSpecific.map((p) => p.id as number)));
  return ids.length === 1 ? ids[0] : null;
}

export function resolveCompatibility(
  rows: CompatibilityRow[] | null | undefined,
  opts: { target: string; connection?: string; productId?: number | null },
): ResolvedCompatibility {
  const target = opts.target;
  const all = (Array.isArray(rows) ? rows : []).filter(
    (r) => r.confidence === "confirmed" && r.target === target,
  );

  // Per-connection override: product-specific wins over brand-wide (null).
  const byConnection = new Map<string, CompatibilityRow>();
  for (const row of all) {
    if (opts.connection && row.connection !== opts.connection) continue;
    const existing = byConnection.get(row.connection);
    const rowMatchesProduct = opts.productId != null &&
      row.product_id === opts.productId;
    const rowIsBrand = row.product_id == null;
    // Only consider rows that apply to this product (its own, or brand-wide).
    if (!rowMatchesProduct && !rowIsBrand) continue;
    if (!existing) {
      byConnection.set(row.connection, row);
      continue;
    }
    const existingIsProduct = opts.productId != null &&
      existing.product_id === opts.productId;
    // Replace a brand-wide entry with a product-specific one.
    if (rowMatchesProduct && !existingIsProduct) {
      byConnection.set(row.connection, row);
    }
  }

  const results: CompatibilityResult[] = Array.from(byConnection.values()).map(
    (r) => ({
      connection: r.connection,
      compatible: r.compatible,
      reason: r.reason,
      workaround: r.workaround,
    }),
  );
  return { target, known: results.length > 0, results };
}

const CONNECTION_LABEL: Record<string, string> = {
  usb: "USB",
  usb_c: "USB-C",
  wireless_dongle: "wireless dongle",
  bluetooth: "Bluetooth",
  aux_3_5mm: "3.5mm AUX",
  xlr: "XLR",
};

const TARGET_LABEL: Record<string, string> = {
  xbox: "Xbox",
  playstation: "PlayStation",
  pc: "PC",
  mac: "Mac",
  switch: "Nintendo Switch",
  ios: "iOS",
  android: "Android",
};

/**
 * Render a deterministic writer directive from resolved compatibility. Only
 * confirmed facts are stated; for anything unknown the writer is told not to
 * guess. Returns "" when the message was not a compatibility question.
 */
export function buildCompatibilityDirective(
  resolved: ResolvedCompatibility[],
  opts: { wasAsked: boolean },
): string {
  if (!opts.wasAsked) return "";

  const lines: string[] = [
    "# PRODUCT COMPATIBILITY — CONFIRMED FACTS (authoritative)",
  ];
  let hasAnyFact = false;
  for (const r of resolved) {
    const targetLabel = TARGET_LABEL[r.target] ?? r.target;
    if (!r.known) continue;
    for (const res of r.results) {
      hasAnyFact = true;
      const connLabel = CONNECTION_LABEL[res.connection] ?? res.connection;
      const verdict = res.compatible === "yes"
        ? "compatible"
        : res.compatible === "no"
        ? "NOT compatible"
        : "partially compatible";
      let line = `- ${targetLabel} via ${connLabel}: ${verdict}.`;
      if (res.reason) line += ` Reason: ${res.reason}.`;
      if (res.workaround) line += ` Workaround: ${res.workaround}.`;
      lines.push(line);
    }
  }

  if (!hasAnyFact) {
    // Hard guardrail (Slice K): when there is no confirmed compatibility row, a
    // positive compatibility claim is forbidden outright. The writer was able to
    // claim compatibility from retrieved product chunks / stock facts for OTHER
    // products; this block now overrides that content explicitly.
    return [
      "# PRODUCT COMPATIBILITY — NOT CONFIRMED (authoritative — overrides everything else)",
      "- Compatibility for the asked product + platform/connection is NOT confirmed in our structured compatibility data.",
      "- You MUST NOT state or imply that it is compatible — do NOT say it \"works with\", \"can be used with\", \"supports\", or is compatible with the platform/connection.",
      "- IGNORE any product descriptions, retrieved knowledge, product pages, stock/inventory facts, or OTHER products' information that might suggest compatibility — none of it is authoritative for compatibility here.",
      "- Your reply MUST explicitly state that the compatibility is not confirmed in our data, then offer to check or ask the customer for their exact product, platform and connection method.",
      "- This instruction overrides all other context and any retrieved content, whether it appears above or below this block.",
    ].join("\n");
  }

  lines.push(
    "- Use ONLY the confirmed facts above. For any platform/connection not listed, do NOT guess — say it is not confirmed or ask for details.",
  );
  return lines.join("\n");
}

/**
 * Response-only provenance (Stage 5, Slice 1). Returns the confirmed
 * compatibility facts that actually fed the directive as flat, UI-safe entries.
 * resolveCompatibility already filtered to confidence='confirmed', so everything
 * here is confirmed. NEVER includes the directive prose itself.
 */
export interface CompatibilityOutcome {
  /** Writer directive: the CONFIRMED-FACTS block when known, the NOT-CONFIRMED
   *  abstention block when no confirmed row exists. Never customer-facing text. */
  directive: string;
  /** Confirmed structured facts for provenance (empty when unknown). */
  structuredFacts: StructuredFactProvenance[];
  /** Response-only guardrails (a compatibility/no_confirmed_row entry when unknown). */
  guardrails: GuardrailUnavailableProvenance[];
}

/**
 * Stage 5, Slice 2B. Single decision for a compatibility question where a
 * lookup was attempted: ALWAYS produce a writer directive — the confirmed facts
 * when known, otherwise the NOT-CONFIRMED abstention directive so the writer
 * does not fall back to retrieval/guessing. Confirmed cases also emit structured
 * provenance; unknown cases emit a safe guardrail.
 */
export function buildCompatibilityOutcome(
  resolved: ResolvedCompatibility[] | null | undefined,
): CompatibilityOutcome {
  const list = Array.isArray(resolved) ? resolved : [];
  const directive = buildCompatibilityDirective(list, { wasAsked: true });
  if (list.some((r) => r.known)) {
    return {
      directive,
      structuredFacts: buildCompatibilityProvenance(list),
      guardrails: [],
    };
  }
  return {
    directive,
    structuredFacts: [],
    guardrails: [{
      topic: "compatibility",
      reason: "no_confirmed_row",
      message:
        "Compatibility for the requested platform/connection is not confirmed in structured data.",
    }],
  };
}

export function buildCompatibilityProvenance(
  resolved: ResolvedCompatibility[] | null | undefined,
): StructuredFactProvenance[] {
  const list = Array.isArray(resolved) ? resolved : [];
  const out: StructuredFactProvenance[] = [];
  for (const r of list) {
    if (!r.known) continue;
    const targetLabel = TARGET_LABEL[r.target] ?? r.target;
    for (const res of r.results) {
      const connLabel = CONNECTION_LABEL[res.connection] ?? res.connection;
      const verdict = res.compatible === "yes"
        ? "compatible"
        : res.compatible === "no"
        ? "NOT compatible"
        : "partially compatible";
      let value = verdict;
      if (res.reason) value += `. Reason: ${res.reason}`;
      if (res.workaround) value += `. Workaround: ${res.workaround}`;
      out.push({
        type: "compatibility",
        key: `${targetLabel} via ${connLabel}`,
        value,
        confidence: "confirmed",
        origin_table: "shop_product_compatibility",
      });
    }
  }
  return out;
}
