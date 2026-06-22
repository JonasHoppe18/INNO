// supabase/functions/generate-draft-v2/stages/product-compatibility-extraction.ts
//
// Slice F — extract candidate product COMPATIBILITY facts from a webshop's
// already-ingested content (primarily product `body_html`/description
// `Compatibility:` lines; OCR comparison-chart text as a secondary
// corroboration/conflict signal).
//
// PURE module: no DB, no network, no env, no LLM. The pipeline never imports
// this — it is admin-suggestion tooling only.
//
// CRITICAL safety contract (mirrors product-text-spec-extraction.ts):
//   - Everything emitted is confidence='suggested',
//     source='website_compatibility_extraction'. The runtime serves only
//     confidence='confirmed' compatibility rows, so these are NEVER
//     customer-facing until a human promotes them.
//   - The extractor never invents a fact: a platform/connection not present in
//     the evidence yields NO candidate.
//   - Ambiguity is surfaced, never resolved: under-specified, multi-meaning, or
//     cross-source-conflicting cells are emitted with needs_review=true and a
//     review_note — never as clean, ready-to-confirm rows.
//   - Single-product evidence -> product-specific candidates (never brand-wide).

export type CompatibleState = "yes" | "no" | "partial";

export interface CompatibilityCandidate {
  product_id: number | null;
  /** Canonical platform token (playstation|xbox|pc|mac|switch|ios|android), or
   *  null when the platform text was not recognized (then needs_review). */
  target: string | null;
  /** Canonical connection token (usb_c|wireless_dongle|bluetooth|aux_3_5mm|xlr|usb),
   *  or null when the evidence stated a platform but no connection. */
  connection: string | null;
  compatible: CompatibleState;
  condition: string | null;
  reason: string | null;
  workaround: string | null;
  evidence_text: string;
  source_url: string | null;
  source_type: string;
  confidence: "suggested";
  source: "website_compatibility_extraction";
  extracted_at: string;
  needs_review: boolean;
  review_note: string | null;
}

export interface ExtractCompatibilityInput {
  productId: number | null;
  productTitle?: string | null;
  productUrl?: string | null;
  /** Product body HTML or plain description text (primary source). */
  bodyHtml?: string | null;
  /** Optional OCR/chart text (secondary corroboration/conflict source). */
  ocrText?: string | null;
  /** Echoed onto each candidate; defaults to "body_html". */
  sourceType?: string;
  /** Injectable clock for deterministic tests. */
  now?: string;
}

const SOURCE = "website_compatibility_extraction" as const;

function stripHtml(value: string): string {
  return String(value ?? "")
    .replace(/<\/(p|li|div|h\d|tr|td|th)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Platform synonyms -> canonical token. Order matters only for readability;
// each is matched independently against a platform phrase.
const PLATFORM_TOKENS: Array<[string, RegExp]> = [
  ["xbox", /\bx[\s-]?box\b|\bseries\s*[xs]\b/i],
  ["playstation", /\bplay[\s-]?station\b|\bps\s?[345]\b/i],
  ["switch", /\bnintendo\b|\bswitch\b/i],
  ["mac", /\bmac\b|\bmac\s?os\b|\bmacbook\b|\bosx\b/i],
  ["pc", /\bpc\b|\bwindows\b/i],
  ["ios", /\biphone\b|\bipad(\s?os)?\b|\bios\b/i],
  ["android", /\bandroid\b/i],
];

// Connection synonyms -> canonical token. A single connection sub-token that
// mentions a wireless/dongle adapter is ALWAYS wireless_dongle, even when it
// also contains "USB-C" (e.g. "wireless USB-C dongle") — rule 1 / rule 2.
function classifyConnectionToken(token: string): string | null {
  const t = token.toLowerCase();
  if (/\bdongle\b|\bwireless\b|\b2\.4\s*ghz\b|\breceiver\b|\badapter\b/.test(t)) {
    return "wireless_dongle";
  }
  if (/\busb[\s-]?c\b|\btype[\s-]?c\b|\busb\b/.test(t)) return "usb_c";
  if (/\banalou?g\b|\baux\b|\b3\.5\s*mm\b|\bjack\b/.test(t)) return "aux_3_5mm";
  if (/\bbluetooth\b|\bbt\b/.test(t)) return "bluetooth";
  if (/\bxlr\b/.test(t)) return "xlr";
  return null;
}

function parseConnections(connPart: string | null): string[] {
  if (!connPart) return [];
  const out: string[] = [];
  for (const raw of connPart.split(/[\/,&]|\band\b/i)) {
    const tok = raw.trim();
    if (!tok) continue;
    const canon = classifyConnectionToken(tok);
    if (canon && !out.includes(canon)) out.push(canon);
  }
  return out;
}

function detectPlatforms(platPart: string): string[] {
  const out: string[] = [];
  for (const [canon, re] of PLATFORM_TOKENS) {
    if (re.test(platPart) && !out.includes(canon)) out.push(canon);
  }
  return out;
}

const NEGATION = /\bnot\s+compatible\b|\bincompatible\b|\bnot\s+support|\bno\s+support\b|✗|✘|❌/i;
const MOBILE = /\bmobile\b/i;
const SWITCH2 = /\bswitch\s*2\b/i;
const ONLY = /\bonly\b/i;

/** Pull the text after a "Compatibility:" label up to the next line break. */
function findCompatibilityLine(text: string): string | null {
  const m = text.match(/compatibilit(?:y|ies)\s*:\s*([^\n\r]+)/i);
  return m ? m[1].trim().replace(/[.;]\s*$/, "") : null;
}

interface ParsedEntry {
  platforms: string[];
  unrecognized: boolean;
  connections: string[];
  compatible: CompatibleState;
  condition: string | null;
  mobile: boolean;
  rawPlatform: string;
}

function parseEntry(entry: string): ParsedEntry {
  const m = entry.match(/^\s*([^(]*?)\s*(?:\(([^)]*)\))?\s*$/);
  const platPart = (m?.[1] ?? entry).trim();
  const connPart = (m?.[2] ?? "").trim() || null;

  const platforms = detectPlatforms(platPart);
  const mobile = MOBILE.test(platPart);
  const connections = parseConnections(connPart);

  // Conditions / scope qualifiers live in the platform OR connection text.
  const scopeText = `${platPart} ${connPart ?? ""}`;
  let condition: string | null = null;
  if (SWITCH2.test(scopeText)) {
    condition = "only Switch 2";
  } else if (ONLY.test(scopeText)) {
    condition = platPart.replace(/\s{2,}/g, " ").trim();
  }

  const negated = NEGATION.test(scopeText);
  const compatible: CompatibleState = negated ? "no" : "yes";

  return {
    platforms,
    unrecognized: platforms.length === 0 && !mobile,
    connections,
    compatible,
    condition,
    mobile,
    rawPlatform: platPart,
  };
}

export function extractCompatibilityCandidates(
  input: ExtractCompatibilityInput,
): CompatibilityCandidate[] {
  const text = stripHtml(input.bodyHtml ?? "");
  const compatLine = text ? findCompatibilityLine(text) : null;
  const sourceUrl = input.productUrl ?? null;
  const sourceType = input.sourceType ?? "body_html";
  const extractedAt = input.now ?? new Date().toISOString();
  const evidence = compatLine ? `Compatibility: ${compatLine}` : "";

  const candidates: CompatibilityCandidate[] = [];
  const seen = new Set<string>();

  const make = (
    target: string | null,
    connection: string | null,
    compatible: CompatibleState,
    opts: {
      condition?: string | null;
      needsReview?: boolean;
      reviewNote?: string | null;
      evidenceText?: string;
      sourceType?: string;
    } = {},
  ) => {
    const key = `${target}|${connection}|${compatible}|${opts.condition ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      product_id: input.productId,
      target,
      connection,
      compatible,
      condition: opts.condition ?? null,
      reason: null,
      workaround: null,
      evidence_text: opts.evidenceText ?? evidence,
      source_url: sourceUrl,
      source_type: opts.sourceType ?? sourceType,
      confidence: "suggested",
      source: SOURCE,
      extracted_at: extractedAt,
      needs_review: opts.needsReview ?? false,
      review_note: opts.reviewNote ?? null,
    });
  };

  // Track which platforms the PRIMARY (body_html) evidence covered, and the
  // per-platform connection sets, for PS4/PS5 divergence + OCR conflict checks.
  const bodyTargets = new Set<string>();
  const psConnectionSets: string[][] = [];

  if (compatLine) {
    for (const rawEntry of compatLine.split(",")) {
      const entry = rawEntry.trim();
      if (!entry) continue;
      const parsed = parseEntry(entry);

      // Unrecognized platform text — surface for review, never drop silently.
      if (parsed.unrecognized) {
        make(null, parsed.connections[0] ?? null, parsed.compatible, {
          needsReview: true,
          reviewNote: `Unrecognized platform "${parsed.rawPlatform}" — manual review required.`,
        });
        continue;
      }

      // "Mobile" is ambiguous: emit suggested ios + android, always needs_review.
      if (parsed.mobile) {
        for (const target of ["ios", "android"]) {
          const conns = parsed.connections.length ? parsed.connections : [null];
          for (const connection of conns) {
            make(target, connection, parsed.compatible, {
              condition: parsed.condition,
              needsReview: true,
              reviewNote:
                'Platform "Mobile" is ambiguous (iOS/Android) — confirm platform(s) before promotion.',
            });
          }
        }
        continue;
      }

      for (const target of parsed.platforms) {
        if (target === "playstation") psConnectionSets.push(parsed.connections);
        bodyTargets.add(target);

        const conns = parsed.connections.length ? parsed.connections : [null];
        for (const connection of conns) {
          const noConnection = connection === null && parsed.compatible !== "no";
          const needsReview = Boolean(parsed.condition) || noConnection;
          const notes: string[] = [];
          if (parsed.condition) notes.push(`Conditional: ${parsed.condition}.`);
          if (noConnection) {
            notes.push("Connection method not stated in evidence — confirm before promotion.");
          }
          make(target, connection, parsed.compatible, {
            condition: parsed.condition,
            needsReview,
            reviewNote: notes.length ? notes.join(" ") : null,
          });
        }
      }
    }

    // Rule 4: PS4 vs PS5 stated with DIFFERENT connection sets -> needs_review
    // on every playstation candidate (we collapse to one target but flag it).
    if (psConnectionSets.length > 1) {
      const sig = psConnectionSets.map((s) => [...s].sort().join("+"));
      const diverges = new Set(sig).size > 1;
      if (diverges) {
        for (const c of candidates) {
          if (c.target === "playstation") {
            c.needs_review = true;
            c.review_note = [
              c.review_note,
              "PS4 and PS5 list different connections — confirm per-version compatibility.",
            ].filter(Boolean).join(" ");
          }
        }
      }
    }
  }

  // Secondary source: OCR comparison-chart text. Used ONLY to surface
  // cross-source CONFLICTS — a platform present in the chart but absent from the
  // product body_html. Such candidates are always needs_review and never clean.
  // (Deeper column-aligned chart reconciliation is deliberately out of scope:
  //  multi-column OCR alignment is too error-prone to auto-trust.)
  if (input.ocrText) {
    const ocr = String(input.ocrText);
    for (const [target, re] of PLATFORM_TOKENS) {
      if (bodyTargets.has(target)) continue;
      if (!re.test(ocr)) continue;
      // Best-effort: capture a "(...)" connection group adjacent to the
      // platform. Wrap the platform pattern in a non-capturing group so its
      // internal `|` alternations don't detach the trailing connection match.
      const near = ocr.match(new RegExp(`(?:${re.source})[^\\n(]*\\(([^)]*)\\)`, "i"));
      const conns = parseConnections(near?.[1] ?? null);
      const list = conns.length ? conns : [null];
      for (const connection of list) {
        make(target, connection, "partial", {
          needsReview: true,
          sourceType: "ocr_chart",
          evidenceText: near?.[0]?.trim() || `${target} (from OCR comparison chart)`,
          reviewNote:
            "Cross-source conflict: present in OCR comparison chart but absent from product body_html — manual review required.",
        });
      }
    }
  }

  return candidates;
}
