// supabase/functions/generate-draft-v2/stages/unsupported-negative-claim-check.ts
//
// Pure, deterministic post-writer safety check. NO DB / NO API / NO LLM.
//
// READINESS-5: the writer can produce a confident NEGATIVE compatibility /
// accessory-fit / availability / purchasability claim ("not compatible",
// "does not fit", "not available", "cannot buy", "passer ikke", "kan ikke
// købes") that is not backed by any grounding source. Sona already has
// structured/live grounding for POSITIVE claims in this area (see
// product-compatibility.ts, buildStockAvailabilityDirective in writer.ts),
// but those are prompt-only instructions for the negative case — and prompt-
// only guardrails do not reliably prevent violations (same rationale as
// unsupported-assumption-check.ts and live-fact-action-claim-check.ts).
//
// A negative claim is allowed through ONLY when grounded by at least one of:
//   A. structured compatibility provenance (a confirmed "NOT compatible" row
//      already fed the draft) — grounds compatibility-family claims.
//   B. a live stock/availability fact with state out_of_stock / unavailable /
//      discontinued — grounds availability- and purchasability-family claims.
//   C. an actual retrieved knowledge chunk (the set really passed to the
//      writer, not the whole KB) containing matching negative wording, AND
//      sharing at least one content word with the draft sentence — this
//      avoids an unrelated chunk over-grounding an unrelated claim. This is a
//      word-overlap heuristic, not true entity resolution; see file-level
//      limitation note below.
//
// This module NEVER rewrites the draft, NEVER executes actions, and is
// shop-agnostic — no shop ids, no per-shop branching.
//
// Known limitation (documented, not fixed in this slice): the chunk grounding
// token-overlap check is a generic word-overlap heuristic (stopword-filtered),
// not a canonical product/platform entity match. A chunk that happens to share
// an incidental non-stopword word with the draft sentence could still ground a
// claim it doesn't actually support. Kept conservative by requiring the chunk
// to also contain one of the explicit negation phrases below.

import type { ResolvedFact } from "./fact-resolver.ts";
import type { StructuredFactProvenance } from "./provenance.ts";
import type { RetrievedChunk } from "./retriever.ts";

export type UnsupportedNegativeClaimViolationType =
  | "unsupported_negative_compatibility_claim"
  | "unsupported_negative_availability_claim"
  | "unsupported_negative_purchasability_claim"
  | "unsupported_negative_fit_claim";

export type UnsupportedNegativeClaimCheckInput = {
  draft_text: string;
  // Structured facts that actually fed the writer directive this turn
  // (pipeline's structuredFactsProvenance). Optional — treated as empty.
  structured_facts?: StructuredFactProvenance[];
  // Verified facts resolved this turn (pipeline's facts.facts), used for the
  // "Live stock availability" label. Optional — treated as empty.
  facts?: ResolvedFact[];
  // The knowledge chunks actually retrieved/passed to the writer this turn
  // (pipeline's retrieved.chunks). Optional — treated as empty.
  retrieved_chunks?: RetrievedChunk[];
};

export type UnsupportedNegativeClaimCheckResult = {
  compliant: boolean;
  violations: Array<{
    type: UnsupportedNegativeClaimViolationType;
    excerpt: string;
  }>;
  requires_review: boolean;
};

interface ClaimFamily {
  violationType: UnsupportedNegativeClaimViolationType;
  patterns: RegExp[];
}

// Confident negative claims in the DRAFT. Conservative and sentence-scoped —
// each pattern targets a specific negation construction, not a bare "ikke" /
// "not", so ordinary uncertainty phrasing ("jeg kan ikke bekræfte...", "jeg
// kan ikke se lagerstatus...") never matches (different verb entirely).
const FAMILIES: ClaimFamily[] = [
  {
    violationType: "unsupported_negative_compatibility_claim",
    patterns: [
      // EN
      /\b(?:is|are|was|were)\s+not\s+compatible\b/i,
      /\bnot\s+compatible\s+with\b/i,
      /\bisn['’]t\s+compatible\b/i,
      /\baren['’]t\s+compatible\b/i,
      /\bincompatible\b/i,
      // DA
      /\bikke\s+kompatibel(?:t|e)?\b/i,
    ],
  },
  {
    violationType: "unsupported_negative_fit_claim",
    patterns: [
      // EN
      /\bdo(?:es)?\s+not\s+fit\b/i,
      /\bdon['’]t\s+fit\b/i,
      /\bdoesn['’]t\s+fit\b/i,
      // DA
      /\bpasser\s+ikke\b/i,
    ],
  },
  {
    violationType: "unsupported_negative_availability_claim",
    patterns: [
      // EN
      /\bnot\s+available\b/i,
      /\bisn['’]t\s+available\b/i,
      /\baren['’]t\s+available\b/i,
      /\bdoes\s+not\s+come\s+in\b/i,
      /\bdoesn['’]t\s+come\s+in\b/i,
      // DA
      /\bikke\s+tilgængelig\b/i,
      /\bfindes\s+ikke\s+i\b/i,
    ],
  },
  {
    violationType: "unsupported_negative_purchasability_claim",
    patterns: [
      // EN
      /\bcannot\s+buy\b/i,
      /\bcan['’]t\s+buy\b/i,
      /\bcan(?:not|['’]t)\s+(?:be\s+)?purchased?\b/i,
      // DA
      /\bkan\s+ikke\s+købes\b/i,
      /\bsælger\s+ikke\b/i,
    ],
  },
];

// Explicit negation wording that, if present in a RETRIEVED chunk, can ground
// a negative claim (grounding source C). EN + DA, matching the audit's list.
const CHUNK_NEGATION_PATTERNS: RegExp[] = [
  /\bnot\s+compatible\b/i,
  /\bincompatible\b/i,
  /\bnot\s+supported\b/i,
  /\bonly\s+compatible\s+with\b/i,
  /\bshould\s+not\s+be\s+removed\b/i,
  /\bnot\s+available\b/i,
  /\bdiscontinued\b/i,
  /\bnot\s+sold\s+separately\b/i,
  /\bcannot\s+be\s+purchased\b/i,
  // DA
  /\bpasser\s+ikke\b/i,
  /\bikke\s+kompatibel\b/i,
  /\bunderstøttes\s+ikke\b/i,
  /\bkun\s+kompatibel\s+med\b/i,
  /\bbør\s+ikke\s+fjernes\b/i,
  /\bsælges\s+ikke\s+separat\b/i,
  /\bkan\s+ikke\s+købes\b/i,
];

const NEGATIVE_STOCK_STATES = new Set(["out_of_stock", "unavailable", "discontinued"]);

// Generic words excluded from the chunk/draft token-overlap check — negation
// vocabulary and stopwords, so overlap must come from an actual product/topic
// word, never from the negation phrasing itself.
const OVERLAP_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "not",
  "no",
  "does",
  "do",
  "don",
  "doesn",
  "isn",
  "aren",
  "cannot",
  "can",
  "buy",
  "purchased",
  "purchase",
  "compatible",
  "incompatible",
  "supported",
  "available",
  "unavailable",
  "discontinued",
  "sold",
  "separately",
  "removed",
  "should",
  "only",
  "with",
  "that",
  "this",
  "you",
  "fit",
  "det",
  "den",
  "er",
  "ikke",
  "kan",
  "købes",
  "kompatibel",
  "kompatibelt",
  "tilgængelig",
  "passer",
  "findes",
  "sælger",
  "sælges",
  "separat",
  "fjernes",
  "bør",
  "kun",
  "med",
  "understøttes",
]);

function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (
    const word of String(text ?? "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
  ) {
    if (word.length >= 3 && !OVERLAP_STOPWORDS.has(word)) out.add(word);
  }
  return out;
}

function sharesContentToken(a: string, b: string): boolean {
  const tokensA = contentTokens(a);
  if (tokensA.size === 0) return false;
  const tokensB = contentTokens(b);
  for (const token of tokensA) {
    if (tokensB.has(token)) return true;
  }
  return false;
}

function chunkGroundsSentence(
  sentence: string,
  chunks: RetrievedChunk[],
): boolean {
  for (const chunk of chunks) {
    const content = String(chunk?.content ?? "");
    if (!content.trim()) continue;
    if (!CHUNK_NEGATION_PATTERNS.some((re) => re.test(content))) continue;
    if (sharesContentToken(sentence, content)) return true;
  }
  return false;
}

function hasGroundedCompatibilityNegative(
  structuredFacts: StructuredFactProvenance[],
): boolean {
  return structuredFacts.some(
    (f) => f.type === "compatibility" && /not\s+compatible/i.test(f.value ?? ""),
  );
}

function hasGroundedStockNegative(facts: ResolvedFact[]): boolean {
  return facts.some((fact) => {
    if (fact.label !== "Live stock availability") return false;
    const match = /(?:^|;\s*)state=([^;]+)/.exec(fact.value ?? "");
    const state = match?.[1]?.trim();
    return state ? NEGATIVE_STOCK_STATES.has(state) : false;
  });
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildExcerpt(sentence: string): string {
  const MAX_LEN = 140;
  if (sentence.length <= MAX_LEN) return sentence;
  return `${sentence.slice(0, MAX_LEN).trim()}…`;
}

export function checkUnsupportedNegativeClaims(
  input: UnsupportedNegativeClaimCheckInput,
): UnsupportedNegativeClaimCheckResult {
  const draftText = input.draft_text ?? "";
  if (!draftText.trim()) {
    return { compliant: true, violations: [], requires_review: false };
  }

  const structuredFacts = input.structured_facts ?? [];
  const facts = input.facts ?? [];
  const chunks = input.retrieved_chunks ?? [];

  const compatibilityGrounded = hasGroundedCompatibilityNegative(structuredFacts);
  const stockGrounded = hasGroundedStockNegative(facts);

  const violations: UnsupportedNegativeClaimCheckResult["violations"] = [];

  for (const sentence of splitSentences(draftText)) {
    for (const family of FAMILIES) {
      const matches = family.patterns.some((re) => re.test(sentence));
      if (!matches) continue;

      let grounded = false;
      if (
        family.violationType === "unsupported_negative_compatibility_claim" &&
        compatibilityGrounded
      ) {
        grounded = true;
      }
      if (
        (family.violationType === "unsupported_negative_availability_claim" ||
          family.violationType === "unsupported_negative_purchasability_claim") &&
        stockGrounded
      ) {
        grounded = true;
      }
      if (!grounded && chunkGroundsSentence(sentence, chunks)) {
        grounded = true;
      }
      if (grounded) continue;

      violations.push({
        type: family.violationType,
        excerpt: buildExcerpt(sentence),
      });
    }
  }

  return {
    compliant: violations.length === 0,
    violations,
    requires_review: violations.length > 0,
  };
}
