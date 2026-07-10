// Deterministic backstop for the exact_order_number writer directive.
//
// When the order is VERIFIED in the shop's own system, proof of purchase and
// place of purchase are established facts — a human colleague would never
// re-ask for them. The directive says so, but the writer model still slips
// (observed live on T-051002: "confirm if the headset is still under warranty
// by providing the purchase details or receipt"). This check detects such
// asks so the pipeline can run a correction rewrite.
//
// Pure module: no I/O, no LLM.

// Ask-verbs followed (within the same sentence) by a proof-of-purchase noun.
const EN_ASK_RE =
  /\b(?:provide|providing|send|share|confirm|attach|forward|upload)\b[^.?!\n]{0,80}\b(?:purchase details|receipt|proof of purchase|order (?:number|confirmation)|invoice)\b/i;
const DA_ASK_RE =
  /\b(?:oplys|oplyse|send|sende|del|dele|bekræft|bekræfte|vedhæft|vedhæfte)\b[^.?!\n]{0,80}\b(?:kvittering|købsbevis|ordrenummer|ordrebekræftelse|faktura)\b/i;

// "Where did you buy it" in any phrasing.
const EN_WHERE_RE = /\bwhere\b[^.?!\n]{0,50}\b(?:purchased|bought|buy)\b/i;
const DA_WHERE_RE = /\bhvor\b[^.?!\n]{0,50}\bkøbt\b/i;

// Direct nouns that are only ever used when asking for them.
const PLACE_RE = /\bplace of purchase\b|\bkøbssted\w*/i;

const PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: "proof_of_purchase_ask", re: EN_ASK_RE },
  { type: "proof_of_purchase_ask", re: DA_ASK_RE },
  { type: "purchase_place_ask", re: EN_WHERE_RE },
  { type: "purchase_place_ask", re: DA_WHERE_RE },
  { type: "purchase_place_ask", re: PLACE_RE },
];

export function detectVerifiedOrderProofAsks(
  draftText: string | null | undefined,
  orderMatchState: string | null | undefined,
): string[] {
  if (orderMatchState !== "exact_order_number") return [];
  const text = String(draftText || "");
  if (!text.trim()) return [];

  const violations: string[] = [];
  for (const { type, re } of PATTERNS) {
    const match = re.exec(text);
    if (match) {
      violations.push(`${type}: "${match[0].slice(0, 120)}"`);
    }
  }
  return [...new Set(violations)];
}
