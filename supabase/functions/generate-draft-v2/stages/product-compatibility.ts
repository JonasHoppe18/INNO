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

import type { StructuredFactProvenance } from "./provenance.ts";

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
    return [
      "# PRODUCT COMPATIBILITY — NOT CONFIRMED",
      "- Compatibility for the asked platform/connection is NOT confirmed in our data.",
      "- Do NOT guess or infer compatibility from product descriptions. State that you need to check, or ask the customer for their exact platform and connection method.",
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
