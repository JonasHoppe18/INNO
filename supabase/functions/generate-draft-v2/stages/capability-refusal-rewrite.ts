// Deterministic, LLM-free hedge rewrite: replaces a draft sentence that made an
// UNGROUNDED capability/offer refusal with an owns-the-case hedge. Only acts on
// "unsupported_capability_claim" violations — other negative-claim families stay
// flag-only. Pure; never throws; no-op when nothing matches.

const HEDGES: Record<string, string> = {
  da: "Det undersøger jeg og vender tilbage til dig om.",
};
const HEDGE_DEFAULT = "Let me look into that and get back to you.";

function hedgeFor(language: string): string {
  const lang = String(language ?? "").trim().toLowerCase().slice(0, 2);
  return HEDGES[lang] ?? HEDGE_DEFAULT;
}

// Split into sentences while keeping their trailing delimiter+space so the
// draft can be reassembled with structure preserved. ø/å-safe (unicode-agnostic
// split on sentence-final punctuation followed by whitespace).
function splitSentences(text: string): string[] {
  const parts: string[] = [];
  const re = /[^.!?]*[.!?]+[\s]*|[^.!?]+$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    parts.push(m[0]);
  }
  return parts.length ? parts : [text];
}

export function rewriteCapabilityRefusals(input: {
  draft: string;
  violations: Array<{ type: string; excerpt: string }>;
  language: string;
}): { draft: string; rewritten: boolean } {
  const draft = String(input?.draft ?? "");
  const excerpts = (input?.violations ?? [])
    .filter((v) => v?.type === "unsupported_capability_claim")
    .map((v) => String(v?.excerpt ?? "").trim())
    .filter((e) => e.length > 0);
  if (!draft || excerpts.length === 0) return { draft, rewritten: false };

  const hedge = hedgeFor(input.language);
  const sentences = splitSentences(draft);
  let rewritten = false;

  const out = sentences.map((sentence) => {
    const hit = excerpts.some((e) => sentence.includes(e));
    if (!hit) return sentence;
    rewritten = true;
    // Preserve the sentence's trailing whitespace so paragraph structure holds.
    const trailingWs = sentence.match(/\s*$/)?.[0] ?? "";
    const leadingWs = sentence.match(/^\s*/)?.[0] ?? "";
    return `${leadingWs}${hedge}${trailingWs}`;
  });

  if (!rewritten) return { draft, rewritten: false };
  return { draft: out.join(""), rewritten: true };
}
