// apps/web/lib/server/commerce/product-text-spec-extraction.ts
//
// Stage 4B-3-2e — extract candidate product specs from Sona's already-synced
// Shopify product text (body_html / description). PURE module: no DB, no
// network, no Shopify calls.
//
// CRITICAL: everything produced here is confidence='suggested',
// source='product_page_extraction', with the supporting excerpt in
// evidence_text. The runtime serves only confidence='confirmed' specs, so these
// are never customer-facing until a human promotes them. The extractor never
// infers a missing fact (a missing field yields NO spec — never `false`), and
// it never derives comparative/relative rankings (e.g. "better DAC than"); it
// records only what the product text literally states.

const SOURCE = "product_page_extraction";

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<\/(p|li|div|h\d|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// Split into candidate "segments" (lines / sentences) so a match can carry the
// exact surrounding excerpt as evidence.
function toSegments(text) {
  return text
    .split(/\n|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findSegment(segments, re) {
  return segments.find((s) => re.test(s)) || null;
}

const CONNECTION_TOKENS: Array<[RegExp, string]> = [
  [/usb[\s‑-]?c/i, "USB-C"],
  [/\bdongle\b|2\.4\s*ghz/i, "wireless dongle"],
  [/3\.5\s*mm|\bjack\b/i, "3.5mm AUX"],
  [/\bbluetooth\b/i, "Bluetooth"],
  [/\bxlr\b/i, "XLR"],
];

function parseConnectionTypes(line) {
  const found = [];
  for (const [re, label] of CONNECTION_TOKENS) {
    if (re.test(line) && !found.includes(label)) found.push(label);
  }
  return found;
}

/**
 * Extract suggested specs from a product's text. Returns [] when nothing
 * concrete is found.
 */
export function extractSuggestedSpecs(input) {
  const text = stripHtml(input?.bodyHtml || input?.description || "");
  if (!text) return [];
  const segments = toSegments(text);
  const sourceUrl = input?.productUrl ?? null;
  const extractedAt = input?.now ?? new Date().toISOString();

  const out = [];
  const push = (spec) =>
    out.push({
      value_bool: null,
      value_num: null,
      unit: null,
      comparable: true,
      needs_review: false,
      ...spec,
      confidence: "suggested",
      source: SOURCE,
      source_url: sourceUrl,
      extracted_at: extractedAt,
    });

  // connection_types — from a "Connectivity:" line.
  const connSeg = findSegment(segments, /connectivity\s*:/i);
  if (connSeg) {
    const tokens = parseConnectionTypes(connSeg.replace(/.*connectivity\s*:/i, ""));
    if (tokens.length) {
      push({
        spec_key: "connection_types",
        spec_group: "connectivity",
        spec_value: tokens.join(", "),
        evidence_text: connSeg,
      });
    }
  }

  // dac_quality — only the literal "DAC: X" value (never a comparative claim).
  const dacSeg = findSegment(segments, /\bdac\s*:/i);
  if (dacSeg) {
    const m = dacSeg.match(/\bdac\s*:\s*([^\n]+)/i);
    const value = (m?.[1] || "").trim();
    if (value) {
      push({
        spec_key: "dac_quality",
        spec_group: "audio",
        spec_value: value,
        evidence_text: dacSeg,
        // DAC ranking is subjective across products (3927 vs page conflict);
        // always require human review before it could be promoted.
        needs_review: true,
      });
    }
  }

  // eq_app_bands — "8-band EQ" (app), excluding the "... for mic" variant.
  for (const seg of segments) {
    const re = /(\d+)\s*[-‑]?\s*band\s+eq/gi;
    let m;
    while ((m = re.exec(seg)) !== null) {
      const tail = seg.slice(m.index).toLowerCase();
      if (/for\s+mic/.test(tail.slice(0, 40))) continue; // mic EQ, out of scope
      const n = Number(m[1]);
      if (!Number.isFinite(n)) continue;
      if (!out.some((r) => r.spec_key === "eq_app_bands")) {
        push({
          spec_key: "eq_app_bands",
          spec_group: "audio",
          spec_value: String(n),
          value_num: n,
          unit: "bands",
          evidence_text: seg,
        });
      }
    }
  }

  // Boolean "presence" specs — only when explicitly mentioned.
  const booleanSpecs = [
    { key: "anc_app_control", group: "audio", re: /anc[^.]*\btransparency control\b|\banc\b[^.]*\bcontrol\b.*\bapp\b|\banc\b\s*&\s*transparency control/i },
    { key: "transparency_mode", group: "audio", re: /\btransparency\s+(control|mode)\b/i },
    { key: "glasses_mode", group: "comfort", re: /\bglasses\s*mode\b/i },
    { key: "outdoor_mode", group: "audio", re: /\boutdoor\s*mode\b/i },
  ];
  for (const b of booleanSpecs) {
    const seg = findSegment(segments, b.re);
    if (seg) {
      push({
        spec_key: b.key,
        spec_group: b.group,
        spec_value: "Yes",
        value_bool: true,
        evidence_text: seg,
      });
    }
  }

  return out;
}
