// Pure, I/O-free helpers for retrieval coherence. Imported by retriever.ts.
// Each rule is gated by a flag in RetrievalCoherenceFlags (see retriever.ts).

export interface RetrievalCoherenceFlags {
  // Absolute cosine floor; if the best chunk's vector_similarity is below this,
  // the whole knowledge block is dropped. null = rule off.
  absFloor: number | null;
  // Override knowledgeBudget for product_question. null = default (4).
  pqBudget: number | null;
  // Enable the issue-type tiebreak that collapses to a single dominant chunk.
  issueTiebreak: boolean;
  // Enable dominant multi-chunk-source consolidation.
  sourceConsolidate: boolean;
}

export function resolveKnowledgeBudget(
  intent: string,
  pqBudget: number | null,
): number {
  if (intent === "complaint" || intent === "technical_support") return 2;
  if (
    intent === "product_question" &&
    typeof pqBudget === "number" &&
    Number.isFinite(pqBudget) &&
    pqBudget >= 1
  ) {
    return Math.floor(pqBudget);
  }
  return 4;
}

// Minimal shape this helper needs — the real RetrievedChunk satisfies it.
interface FloorChunk {
  vector_similarity?: number | null;
}

export function applyAbsoluteFloor<T extends FloorChunk>(
  chunks: T[],
  threshold: number | null,
): T[] {
  if (threshold === null) return chunks;
  if (chunks.length === 0) return chunks;
  const best = chunks[0].vector_similarity;
  if (typeof best !== "number" || best < threshold) return [];
  return chunks;
}

interface IssueChunk {
  chunk_issue_types: string[];
}

export function applyIssueTiebreak<T extends IssueChunk>(
  chunks: T[],
  issueTerms: string[],
): T[] {
  if (chunks.length < 2 || issueTerms.length === 0) return chunks;
  const wanted = new Set(issueTerms.map((t) => t.toLowerCase()));
  const matches = chunks.filter((c) =>
    (c.chunk_issue_types ?? []).some((t) => wanted.has(String(t).toLowerCase()))
  );
  return matches.length === 1 ? [matches[0]] : chunks;
}

interface SourceChunk {
  source_id?: string | null;
  similarity: number;
}

export function consolidateDominantSource<T extends SourceChunk>(chunks: T[]): T[] {
  if (chunks.length < 2) return chunks;
  const groups = new Map<string, { sum: number; count: number }>();
  for (const c of chunks) {
    const id = c.source_id ? String(c.source_id) : null;
    if (!id) continue;
    const g = groups.get(id) ?? { sum: 0, count: 0 };
    g.sum += typeof c.similarity === "number" ? c.similarity : 0;
    g.count += 1;
    groups.set(id, g);
  }
  let winner: string | null = null;
  let winnerSum = -Infinity;
  let tied = false;
  for (const [id, g] of groups) {
    if (g.count < 2) continue;
    if (g.sum > winnerSum) {
      winner = id;
      winnerSum = g.sum;
      tied = false;
    } else if (g.sum === winnerSum) {
      tied = true;
    }
  }
  if (!winner || tied) return chunks;
  return chunks.filter((c) => c.source_id && String(c.source_id) === winner);
}
