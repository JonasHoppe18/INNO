// Semantic chunker for knowledge-document ingestion.
//
// Extracted from app/api/knowledge/snippets/route.ts so it can be unit-tested in
// isolation. Pure string functions only — no Next.js / Node runtime deps, so the
// same source is importable by the route (webpack/turbo) and by `deno test`.

export function normalizeWhitespace(value: string): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(new RegExp(String.fromCharCode(0), "g"), "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SECTION_SPLIT = /\n(?=#{1,3}\s|\d+\.\s)|\n\n+/;

export function splitIntoSemanticChunks(
  text: string,
  maxChars = 2400,
  minChars = 150,
): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  // Split on section headers (##, numbered sections) or double newlines.
  // IMPORTANT: do NOT drop sub-minChars sections here. Dropping silently lost
  // content (return addresses, policy windows). Short sections are coalesced with
  // a neighbour below so 100% of the text is preserved exactly once.
  const rawSections = normalized
    .split(SECTION_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawSections.length <= 1) {
    // No clear section boundaries — fall back to character overlap chunking.
    const chunks: string[] = [];
    let start = 0;
    while (start < normalized.length) {
      const end = Math.min(normalized.length, start + maxChars);
      const chunk = normalized.slice(start, end).trim();
      if (chunk) chunks.push(chunk);
      if (end >= normalized.length) break;
      start = Math.max(0, end - 200);
    }
    return chunks.filter(Boolean);
  }

  // Phase 1 — coalesce so no unit is below minChars. A short section merges
  // FORWARD into following sections (preserving every ## header) until it clears
  // minChars or runs out of sections. A trailing short unit with no next section
  // merges BACK into the previous unit. Pure concatenation with "\n\n": never
  // drops, never duplicates.
  const coalesced: string[] = [];
  let i = 0;
  while (i < rawSections.length) {
    let unit = rawSections[i];
    while (unit.length < minChars && i + 1 < rawSections.length) {
      i += 1;
      unit = `${unit}\n\n${rawSections[i]}`;
    }
    coalesced.push(unit);
    i += 1;
  }
  if (
    coalesced.length >= 2 &&
    coalesced[coalesced.length - 1].length < minChars
  ) {
    const tail = coalesced.pop() as string;
    coalesced[coalesced.length - 1] =
      `${coalesced[coalesced.length - 1]}\n\n${tail}`;
  }

  // Phase 2 — pack coalesced units up to maxChars. No min-floor drop: each unit
  // already cleared minChars in phase 1 (or is the entire document).
  const chunks: string[] = [];
  let buffer = "";
  for (const unit of coalesced) {
    if (buffer && buffer.length + unit.length + 2 > maxChars) {
      chunks.push(buffer.trim());
      buffer = unit;
    } else {
      buffer = buffer ? `${buffer}\n\n${unit}` : unit;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks.filter(Boolean);
}
