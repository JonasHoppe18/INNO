// supabase/functions/generate-draft-v2/stages/image-evidence-claim-check.ts
//
// Pure, deterministic post-writer safety check. NO DB / NO API / NO LLM.
//
// AZ-1b. AZ-1's prompt-only image-honesty guidance is overridden by the
// customer's textual claim of attaching images: with ZERO real images reaching
// the model, the writer still produced (prod v296 smoke-D)
//   "Jeg har set de vedhæftede billeder, og det ser ud til at være en fysisk skade."
// This guard is the deterministic backstop (P1-style): when the count of real,
// vision-capable images actually passed to the writer is 0, the draft must not
// claim to have seen or assessed an image. It NEVER rewrites the draft and
// NEVER executes actions — callers escalate routing_hint to "review".
//
// The evidence signal is `image_evidence_count` — the length of the
// loadImageAttachments result (already AZ-1-filtered: inline signature/logo
// images excluded). It is NOT the customer's textual claim and NOT non-image
// attachments (PDF/video are not vision input).
//
// Precision over recall: every pattern is anchored on an image noun
// (billede/foto/image/photo/picture) combined with a perception/assessment.
// Bare "det ser ud til" and bare "jeg kan se" / "I can see" (no image noun)
// deliberately do NOT match. Requests/offers ("send gerne billeder", "hvis du
// har billeder") do NOT match. Quoted customer lines are stripped.

export type ImageEvidenceViolationType = "image_claim/no_image_evidence";

export type ImageEvidenceClaimCheckInput = {
  draft_text: string;
  // Count of real, vision-capable images passed to the writer
  // (loadImageAttachments result length — signature/logo images already removed).
  image_evidence_count: number;
  language?: string | null;
};

export type ImageEvidenceClaimCheckResult = {
  compliant: boolean;
  requires_review: boolean;
  violations: Array<{ type: ImageEvidenceViolationType; excerpt: string }>;
};

// Image-anchored "I have seen / the image shows / from the image" assertions.
const CLAIM_PATTERNS: RegExp[] = [
  // DA — "jeg har set (de/dine/det) (vedhæftede) billede(t|rne|r)"
  /\bjeg\s+har\s+set\s+(?:de\s+|dine\s+|det\s+)?(?:vedhæftede\s+)?billede(?:rne|r|t)?\b/i,
  // DA — "ud fra billedet/billederne"
  /\bud\s+fra\s+billede(?:rne|t|r)?\b/i,
  // DA — "på billedet/billederne kan jeg se"
  /\bpå\s+billede(?:rne|t|r)?\s+kan\s+jeg\s+se\b/i,
  // DA — "billedet/billederne/fotoet viser"
  /\b(?:billede(?:rne|t|r)?|foto(?:et|s)?)\s+viser\b/i,
  // EN — "I can see the/your/that image/photo/picture"
  /\bI\s+can\s+see\s+(?:the|your|that)\s+(?:image|photo|picture|attachment)s?\b/i,
  // EN — "I've / I have seen the/your (attached) image(s)/photo(s)/picture(s)"
  /\bI(?:'ve| have)\s+seen\s+(?:the|your)\s+(?:attached\s+)?(?:image|photo|picture)s?\b/i,
  // EN — "from the image/photo/picture"
  /\bfrom\s+the\s+(?:image|photo|picture)\b/i,
  // EN — "the image/photo/picture shows"
  /\b(?:the\s+)?(?:image|photo|picture)\s+shows\b/i,
  // EN — "it looks like from the image/photo"
  /\b(?:it\s+)?looks\s+like\s+from\s+the\s+(?:image|photo|picture)\b/i,
];

// Requests / offers to RECEIVE images are never claims of having seen one.
const REQUEST_RE =
  /\b(?:send\s+gerne|gerne\s+sende|må\s+du\s+gerne\s+sende|hvis\s+du\s+har|kan\s+du\s+sende|please\s+send|could\s+you\s+send|feel\s+free\s+to\s+send|attach\s+a)\b/i;

function stripQuotedLines(text: string): string {
  return text
    .split(/\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
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

export function checkImageEvidenceClaims(
  input: ImageEvidenceClaimCheckInput,
): ImageEvidenceClaimCheckResult {
  const draftText = input.draft_text ?? "";
  const evidenceCount = Number.isFinite(input.image_evidence_count)
    ? Number(input.image_evidence_count)
    : 0;

  // Real image evidence reached the model → image claims are grounded.
  if (evidenceCount > 0 || !draftText.trim()) {
    return { compliant: true, requires_review: false, violations: [] };
  }

  const sentences = splitSentences(stripQuotedLines(draftText));
  const violations: ImageEvidenceClaimCheckResult["violations"] = [];

  for (const sentence of sentences) {
    if (REQUEST_RE.test(sentence)) continue;
    if (CLAIM_PATTERNS.some((re) => re.test(sentence))) {
      violations.push({
        type: "image_claim/no_image_evidence",
        excerpt: buildExcerpt(sentence),
      });
    }
  }

  return {
    compliant: violations.length === 0,
    requires_review: violations.length > 0,
    violations,
  };
}
