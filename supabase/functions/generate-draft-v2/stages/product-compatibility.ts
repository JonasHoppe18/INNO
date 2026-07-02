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
  opts?: { productMentioned?: boolean },
): boolean {
  const { targets, connections } = detectCompatibilityQuery(text);
  if (targets.length === 0) return false;
  // A platform target plus either an explicit connection or a compatibility
  // keyword. Keeps this conservative so unrelated mentions don't trigger.
  if (connections.length > 0 || COMPAT_KEYWORD.test(String(text ?? ""))) return true;
  // Slice M: a broad "<known product> + <platform>" question (e.g. "Can I use
  // A-Spire with PlayStation?") carries no connection or keyword, but naming a
  // specific product alongside a platform target IS a compatibility question.
  // The caller passes productMentioned when product detection resolved exactly
  // one product, so this never fires on unrelated platform mentions.
  return opts?.productMentioned === true;
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

// Hard safety meaning, kept verbatim across confirmed and not-confirmed paths
// (Slice K). These are INTERNAL instructions to the writer — never customer text.
const COMPAT_SAFETY_RULES: string[] = [
  "- You MUST NOT state or imply compatibility for any method that is not confirmed above — never say it \"works with\", \"can be used with\", \"supports\", or is compatible unless it is listed as confirmed compatible above.",
  "- IGNORE product descriptions, retrieved knowledge, product pages, stock/inventory, and OTHER products' information — none of it can establish compatibility here.",
  "- This compatibility guardrail overrides all other context, including any conflicting retrieved or product content, whether it appears above or below.",
  "- Equally, you MUST NOT state or imply that something is NOT compatible / does not fit / does not work together unless that negative result is confirmed above (a deterministic guard checks this separately — do not rely on this instruction alone). If you are not sure, say so instead of guessing either way — for example: \"Jeg kan ikke bekræfte kompatibiliteten ud fra informationen her, så den skal lige tjekkes manuelt.\"",
];

// Send-ready style (Slice L, strengthened in Slice N). Turns the directive from
// a script the writer parrots into facts it expresses naturally — and strips
// internal/system wording, robotic disclaimers and filler from the reply.
const COMPAT_SEND_READY_RULES: string[] = [
  "- Write like a support colleague: warm, direct and natural. Express the facts in your own words — never copy these bullet lines verbatim.",
  "- Lead with what IS confirmed. Mention any unconfirmed method once, framed as a recommendation to use a confirmed option instead — never as a system disclaimer.",
  "- Do NOT expose internal mechanics or data-source wording, do NOT frame a gap as a personal or system inability, and never tell the customer to check specs/manuals or to test the setup themselves to find out.",
  "- When a method or product is not confirmed, give a clear recommendation instead of a disclaimer: steer to a confirmed connection, or recommend choosing a model with confirmed compatibility for that platform.",
  "- No generic filler and no padded sign-off; every sentence should carry information.",
];

// Slice N: deterministic send-ready tone enforcement. The directive forbids
// these by meaning, but the model still emits them, so we detect (and, where it
// is grammatically safe, strip/rewrite) them post-generation. Mirrors the
// deterministic detectUnsupportedStockClaims precedent in verifier.ts.
const COMPAT_TONE_BANNED: Array<[string, RegExp]> = [
  ["cannot_confirm", /\bi\s+(?:cannot|can['’]?t|am\s+unable\s+to|am\s+not\s+able\s+to)\s+confirm\b/i],
  ["internal_data_wording", /\bin\s+our\s+(?:data|system|records)\b|\bstructured\s+compatibility\s+data\b/i],
  ["check_specs", /\bcheck(?:ing)?\s+(?:the\s+)?(?:exact\s+)?(?:product\s+)?specs?(?:ifications?)?\b/i],
  ["try_it_directly", /\btry(?:ing)?\s+it\s+(?:directly|out)\b|\btest\s+it\s+(?:directly|yourself)\b/i],
  ["generic_filler", /\bif\s+you\s+have\s+any\s+(?:other|further|more)\s+questions\b|\bfeel\s+free\s+to\s+(?:ask|reach\s+out)\b|\bdon['’]?t\s+hesitate\s+to\s+(?:ask|reach\s+out)\b/i],
];

/**
 * Detect robotic / internal-sounding phrases in a compatibility draft. Pure and
 * deterministic; returns the distinct violation labels (empty when send-ready).
 */
export function detectCompatibilityToneViolations(
  text: string | null | undefined,
): string[] {
  const t = String(text ?? "");
  const out: string[] = [];
  for (const [label, re] of COMPAT_TONE_BANNED) {
    if (re.test(t)) out.push(label);
  }
  return [...new Set(out)];
}

// Whole-sentence generic-filler matcher (bounded by sentence punctuation/newline
// so it never crosses into real content).
const FILLER_SENTENCE_RE =
  /[^.!?\n]*\b(?:if you have any (?:other|further|more) questions|feel free to (?:ask|reach out)|don['’]?t hesitate to (?:ask|reach out))\b[^.!?\n]*[.!?]?/gi;

/**
 * Deterministically clean a compatibility draft of the safe-to-fix offenders:
 * drop the "in our data/system/records" qualifier (keeping the fact), rewrite a
 * robotic "I cannot confirm" into "I haven't confirmed", and remove generic
 * sign-off filler sentences. Conservative and idempotent — it never rewrites the
 * substance of a sentence, so it cannot fabricate or drop a compatibility fact.
 */
export function sanitizeCompatibilityDraft(
  text: string | null | undefined,
): string {
  let out = String(text ?? "");
  out = out.replace(/\s+in\s+our\s+(?:data|system|records)\b/gi, "");
  out = out.replace(
    /\bi\s+(?:cannot|can['’]?t|am\s+unable\s+to|am\s+not\s+able\s+to)\s+confirm\b/gi,
    "I haven't confirmed",
  );
  out = out.replace(FILLER_SENTENCE_RE, "");
  // Collapse the whitespace/blank lines the removals leave behind.
  out = out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.!?,])/g, "$1")
    .trim();
  return out;
}

/**
 * Render a deterministic writer directive from resolved compatibility. Only
 * confirmed facts are stated; for anything unknown the writer is told not to
 * guess. When the customer asked for a specific connection/method, that exact
 * method must be confirmed before Sona may answer yes for it — other confirmed
 * methods may be offered as alternatives but never as proof the asked method
 * works (Slice L). Returns "" when the message was not a compatibility question.
 */
export function buildCompatibilityDirective(
  resolved: ResolvedCompatibility[],
  opts: { wasAsked: boolean; requestedConnections?: string[] },
): string {
  if (!opts.wasAsked) return "";
  const requested = (opts.requestedConnections ?? []).filter(Boolean);

  const factLines: string[] = [];
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
      factLines.push(line);
    }
  }

  if (!hasAnyFact) {
    // No confirmed row at all (Slice K hard guardrail + Slice L send-ready
    // wording): a positive claim is forbidden outright, and the customer-facing
    // reply must read like a colleague — not an internal data disclaimer.
    return [
      "# PRODUCT COMPATIBILITY — NOT CONFIRMED (internal directive — express in your own words)",
      ...COMPAT_SAFETY_RULES,
      "- Nothing about the asked product + platform/method is confirmed compatible, so you have no compatible setup to offer for it.",
      "- Either recommend an option or product that DOES have confirmed compatibility for the asked platform, or ask ONE precise question (exact product, platform and connection) — whichever is more helpful. Example neutral phrasing when asking: \"Hvis du sender modellen/produktnavnet, kan vi tjekke det.\"",
      "- Never guess or state a NOT-compatible verdict here either — you have no confirmed row for or against.",
      ...COMPAT_SEND_READY_RULES,
    ].join("\n");
  }

  const lines: string[] = [
    "# PRODUCT COMPATIBILITY — CONFIRMED FACTS (internal directive — express in your own words)",
    ...factLines,
  ];

  // Slice L: exact requested-method status. A specifically asked connection must
  // be confirmed for THAT method before Sona answers yes; otherwise it is offered
  // an alternative, never claimed.
  if (requested.length > 0) {
    for (const r of resolved) {
      if (!r.known) continue;
      const byConn = new Map(r.results.map((x) => [x.connection, x]));
      for (const conn of requested) {
        const connLabel = CONNECTION_LABEL[conn] ?? conn;
        const hit = byConn.get(conn);
        if (hit && hit.compatible === "yes") {
          lines.push(`- Requested method (${connLabel}): CONFIRMED — you may confirm it works.`);
        } else if (hit && hit.compatible === "no") {
          lines.push(`- Requested method (${connLabel}): confirmed it does NOT work — do not claim it works; steer to a confirmed option above.`);
        } else {
          lines.push(`- Requested method (${connLabel}): NOT confirmed — you MUST NOT claim it works; recommend a confirmed option above instead.`);
        }
      }
    }
  }

  lines.push(...COMPAT_SAFETY_RULES, ...COMPAT_SEND_READY_RULES);
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
  requestedConnections?: string[],
): CompatibilityOutcome {
  const list = Array.isArray(resolved) ? resolved : [];
  const directive = buildCompatibilityDirective(list, {
    wasAsked: true,
    requestedConnections,
  });
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
