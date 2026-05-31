# Retrieval Coherence Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `grab_bag_rate` on retrieval-relevant intents without dropping `overall_10`, via four independently flag-gated retriever rules that default to off until eval proves each one.

**Architecture:** New pure helpers live in `supabase/functions/generate-draft-v2/stages/retriever-coherence.ts` (unit-tested with `deno test`). `retriever.ts` imports them and applies them inside `runRetriever` behind flags read from `eval_options`, which `pipeline.ts` passes through. The golden-eval runner gains CLI flags to set each `eval_options` field so every mechanism can be A/B-tested against the deployed function without code changes.

**Tech Stack:** Deno/TypeScript (Supabase Edge Functions), `jsr:@std/assert@1` for tests, Node ESM for the eval harness.

---

## Spec reference

Design: `docs/superpowers/specs/2026-05-30-retrieval-coherence-fix-design.md`. Four mechanisms:
1. Absolute relevance floor (block-level gate) — fixes junk fallback (g-025).
2a. Configurable `product_question` budget; 2b. issue-type tiebreak — fix topical scatter (g-021/g-020).
3. Dominant-source consolidation — future-proofing for multi-chunk guides.

## Commit policy

The project's standing instruction in this work stream is **do not auto-commit**. Each task below ends with a `git add` + commit step (standard plan format), but the executor MUST stage and then **wait for explicit human go-ahead before committing** unless the human has said otherwise for this run.

## File Structure

- **Create** `supabase/functions/generate-draft-v2/stages/retriever-coherence.ts` — pure functions: `resolveKnowledgeBudget`, `applyAbsoluteFloor`, `applyIssueTiebreak`, `consolidateDominantSource`, and the `RetrievalCoherenceFlags` type. No I/O, no imports from retriever.ts (one-way dependency: retriever.ts → retriever-coherence.ts).
- **Create** `supabase/functions/generate-draft-v2/stages/retriever-coherence.test.ts` — `deno test` unit tests for each pure function.
- **Modify** `supabase/functions/generate-draft-v2/stages/retriever.ts` — carry cosine similarity through fusion; add `vector_similarity` to `RetrievedChunk`; read flags from `RetrieverInput`; call the helpers at defined points.
- **Modify** `supabase/functions/generate-draft-v2/pipeline.ts` — extend `eval_options` interface; pass the four flags into `runRetriever`.
- **Modify** `apps/web/lib/server/eval-runner.js` — forward new `options.*` into `eval_options`.
- **Modify** `supabase/scripts/run-golden-eval.mjs` + `supabase/scripts/lib/golden-eval-core.mjs` — parse CLI flags and thread them to `generateDraftV2`.

---

### Task 1: Carry cosine similarity through RRF fusion

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever.ts` (rrfFusion ~438-458; RetrievedChunk interface ~6-39; base object ~739-751)

The vector RPC `match_agent_knowledge` returns `similarity` (cosine = `1 - (embedding <=> query)`) on each row. Today `rrfFusion` keeps only the fusion score and the raw chunk; the cosine is then discarded when `base.similarity` is set to the fusion score. We carry the **max** cosine per id as a new field so later rules can gate on absolute relevance.

- [ ] **Step 1: Add `vector_similarity` to the `RetrievedChunk` interface**

In `retriever.ts`, inside `export interface RetrievedChunk`, after the `products?: string[];` line (~38), add:

```ts
  // Max cosine similarity (1 - distance) seen for this chunk across the vector
  // queries that surfaced it. null for BM25-only chunks (no vector score).
  // Used by the absolute relevance floor to drop the whole knowledge block when
  // nothing is genuinely relevant. Distinct from `similarity`, which after
  // fusion holds the RRF rank score, not cosine.
  vector_similarity?: number | null;
```

- [ ] **Step 2: Carry max cosine in `rrfFusion`**

Replace the body of `rrfFusion` (the `scores` map value type and the loop) so each entry tracks `vectorSimilarity`:

```ts
function rrfFusion(
  lists: Array<Array<Record<string, unknown>>>,
  k = 60,
): Array<
  { id: string; score: number; vectorSimilarity: number | null; chunk: Record<string, unknown> }
> {
  const scores = new Map<
    string,
    { id: string; score: number; vectorSimilarity: number | null; chunk: Record<string, unknown> }
  >();

  for (const list of lists) {
    list.forEach((item, rank) => {
      const id = item.id as string;
      const existing = scores.get(id) ??
        { id, score: 0, vectorSimilarity: null, chunk: item };
      existing.score += 1 / (k + rank + 1);
      const sim = typeof item.similarity === "number" ? item.similarity : null;
      if (sim !== null) {
        existing.vectorSimilarity = existing.vectorSimilarity === null
          ? sim
          : Math.max(existing.vectorSimilarity, sim);
      }
      existing.chunk = item;
      scores.set(id, existing);
    });
  }

  return [...scores.values()].sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 3: Populate `vector_similarity` on the mapped chunk**

In the `.map((r) => { ... })` that builds `base` (~739), add to the `base` object literal (after `products: ...`):

```ts
        vector_similarity: r.vectorSimilarity,
```

- [ ] **Step 4: Type-check**

Run: `cd supabase/functions && deno check generate-draft-v2/stages/retriever.ts`
Expected: no NEW errors in retriever.ts. (Pre-existing unrelated errors in `_shared/shopify-credentials.ts`, `_shared/tracking/providers/gls/tracking.ts`, `writer.ts` may remain — ignore those.)

- [ ] **Step 5: Stage + commit (await human go-ahead)**

```bash
git add supabase/functions/generate-draft-v2/stages/retriever.ts
git commit -m "feat(retriever): carry cosine similarity through RRF fusion"
```

---

### Task 2: Create the coherence flags type + budget resolver (pure + tested)

**Files:**
- Create: `supabase/functions/generate-draft-v2/stages/retriever-coherence.ts`
- Create: `supabase/functions/generate-draft-v2/stages/retriever-coherence.test.ts`

Start the helper module with the flags type and the simplest pure function (budget resolver) to establish the test harness.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/generate-draft-v2/stages/retriever-coherence.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { resolveKnowledgeBudget } from "./retriever-coherence.ts";

Deno.test("complaint keeps budget 2", () => {
  assertEquals(resolveKnowledgeBudget("complaint", null), 2);
});

Deno.test("technical_support keeps budget 2", () => {
  assertEquals(resolveKnowledgeBudget("technical_support", null), 2);
});

Deno.test("product_question defaults to 4 when no override", () => {
  assertEquals(resolveKnowledgeBudget("product_question", null), 4);
});

Deno.test("product_question override applies only to that intent", () => {
  assertEquals(resolveKnowledgeBudget("product_question", 2), 2);
  assertEquals(resolveKnowledgeBudget("product_question", 3), 3);
});

Deno.test("override does not affect non-product_question intents", () => {
  assertEquals(resolveKnowledgeBudget("complaint", 3), 2);
  assertEquals(resolveKnowledgeBudget("refund", 3), 4);
});

Deno.test("invalid override is ignored", () => {
  assertEquals(resolveKnowledgeBudget("product_question", 0), 4);
  assertEquals(resolveKnowledgeBudget("product_question", -1), 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions && deno test generate-draft-v2/stages/retriever-coherence.test.ts`
Expected: FAIL — module `./retriever-coherence.ts` not found.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/functions/generate-draft-v2/stages/retriever-coherence.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd supabase/functions && deno test generate-draft-v2/stages/retriever-coherence.test.ts`
Expected: PASS — 6 tests ok.

- [ ] **Step 5: Stage + commit (await human go-ahead)**

```bash
git add supabase/functions/generate-draft-v2/stages/retriever-coherence.ts supabase/functions/generate-draft-v2/stages/retriever-coherence.test.ts
git commit -m "feat(retriever): coherence flags type + budget resolver"
```

---

### Task 3: Absolute relevance floor (Mechanism 1, pure + tested)

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever-coherence.ts`
- Modify: `supabase/functions/generate-draft-v2/stages/retriever-coherence.test.ts`

`applyAbsoluteFloor` is block-level: given the final chunk list (already sorted best-first by the caller) and a threshold, return `[]` if the best chunk's `vector_similarity` is null or below threshold, otherwise return the list unchanged. A `null` threshold means the rule is off (return list unchanged).

- [ ] **Step 1: Write the failing test**

Append to `retriever-coherence.test.ts`:

```ts
import { applyAbsoluteFloor } from "./retriever-coherence.ts";

const chunk = (vs: number | null) =>
  ({ id: "x", vector_similarity: vs } as unknown as Parameters<typeof applyAbsoluteFloor>[0][number]);

Deno.test("null threshold leaves list unchanged", () => {
  const list = [chunk(0.1), chunk(0.05)];
  assertEquals(applyAbsoluteFloor(list, null).length, 2);
});

Deno.test("best below threshold drops whole block", () => {
  const list = [chunk(0.12), chunk(0.05)];
  assertEquals(applyAbsoluteFloor(list, 0.30), []);
});

Deno.test("best at/above threshold keeps list", () => {
  const list = [chunk(0.45), chunk(0.10)];
  assertEquals(applyAbsoluteFloor(list, 0.30).length, 2);
});

Deno.test("best with null vector_similarity drops block", () => {
  const list = [chunk(null), chunk(0.9)];
  assertEquals(applyAbsoluteFloor(list, 0.30), []);
});

Deno.test("empty list stays empty", () => {
  assertEquals(applyAbsoluteFloor([], 0.30), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions && deno test generate-draft-v2/stages/retriever-coherence.test.ts`
Expected: FAIL — `applyAbsoluteFloor` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `retriever-coherence.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd supabase/functions && deno test generate-draft-v2/stages/retriever-coherence.test.ts`
Expected: PASS — all tests ok.

- [ ] **Step 5: Stage + commit (await human go-ahead)**

```bash
git add supabase/functions/generate-draft-v2/stages/retriever-coherence.ts supabase/functions/generate-draft-v2/stages/retriever-coherence.test.ts
git commit -m "feat(retriever): absolute relevance floor helper"
```

---

### Task 4: Issue-type tiebreak (Mechanism 2b, pure + tested)

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever-coherence.ts`
- Modify: `supabase/functions/generate-draft-v2/stages/retriever-coherence.test.ts`

`applyIssueTiebreak`: given the post-budget chunk list and the customer's detected issue terms, if **exactly one** chunk has a `chunk_issue_types` tag overlapping the issue terms, collapse the list to just that chunk. Otherwise (zero or ≥2 matches) return unchanged. Only acts when list length ≥ 2.

- [ ] **Step 1: Write the failing test**

Append to `retriever-coherence.test.ts`:

```ts
import { applyIssueTiebreak } from "./retriever-coherence.ts";

const ic = (id: string, issues: string[]) =>
  ({ id, chunk_issue_types: issues } as unknown as Parameters<typeof applyIssueTiebreak>[0][number]);

Deno.test("exactly one issue-match collapses to that chunk", () => {
  const list = [ic("a", ["audio"]), ic("b", ["firmware"]), ic("c", ["pairing"])];
  const out = applyIssueTiebreak(list, ["firmware"]);
  assertEquals(out.length, 1);
  assertEquals(out[0].id, "b");
});

Deno.test("two issue-matches leave list unchanged", () => {
  const list = [ic("a", ["firmware"]), ic("b", ["firmware"]), ic("c", ["pairing"])];
  assertEquals(applyIssueTiebreak(list, ["firmware"]).length, 3);
});

Deno.test("zero issue-matches leave list unchanged", () => {
  const list = [ic("a", ["audio"]), ic("b", ["battery"])];
  assertEquals(applyIssueTiebreak(list, ["firmware"]).length, 2);
});

Deno.test("single-element list is never collapsed further", () => {
  const list = [ic("a", ["firmware"])];
  assertEquals(applyIssueTiebreak(list, ["firmware"]).length, 1);
});

Deno.test("empty issue terms leave list unchanged", () => {
  const list = [ic("a", ["audio"]), ic("b", ["firmware"])];
  assertEquals(applyIssueTiebreak(list, []).length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions && deno test generate-draft-v2/stages/retriever-coherence.test.ts`
Expected: FAIL — `applyIssueTiebreak` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `retriever-coherence.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd supabase/functions && deno test generate-draft-v2/stages/retriever-coherence.test.ts`
Expected: PASS — all tests ok.

- [ ] **Step 5: Stage + commit (await human go-ahead)**

```bash
git add supabase/functions/generate-draft-v2/stages/retriever-coherence.ts supabase/functions/generate-draft-v2/stages/retriever-coherence.test.ts
git commit -m "feat(retriever): issue-type tiebreak helper"
```

---

### Task 5: Dominant-source consolidation (Mechanism 3, pure + tested)

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever-coherence.ts`
- Modify: `supabase/functions/generate-draft-v2/stages/retriever-coherence.test.ts`

`consolidateDominantSource`: given the scored, sorted chunk list (each with `source_id` and a numeric `similarity` = fusion score), group by non-null `source_id`. If one group's summed score is strictly greater than every other group's AND the group has ≥2 chunks, return only that group's chunks (preserving order). Chunks with null `source_id` form no group and are dropped only when a dominant multi-chunk group wins. If no group has ≥2 chunks, return the list unchanged (this is the AceZone case — all `source_id` null).

- [ ] **Step 1: Write the failing test**

Append to `retriever-coherence.test.ts`:

```ts
import { consolidateDominantSource } from "./retriever-coherence.ts";

const sc = (id: string, sourceId: string | null, score: number) =>
  ({ id, source_id: sourceId, similarity: score } as unknown as Parameters<typeof consolidateDominantSource>[0][number]);

Deno.test("all null source_id leaves list unchanged", () => {
  const list = [sc("a", null, 0.08), sc("b", null, 0.07), sc("c", null, 0.06)];
  assertEquals(consolidateDominantSource(list).length, 3);
});

Deno.test("dominant multi-chunk guide wins and drops others", () => {
  const list = [
    sc("a", "guide-1", 0.08),
    sc("b", "guide-1", 0.07),
    sc("c", "guide-2", 0.06),
    sc("d", null, 0.05),
  ];
  const out = consolidateDominantSource(list);
  assertEquals(out.map((c) => c.id), ["a", "b"]);
});

Deno.test("single-chunk groups never consolidate", () => {
  const list = [sc("a", "guide-1", 0.08), sc("b", "guide-2", 0.07)];
  assertEquals(consolidateDominantSource(list).length, 2);
});

Deno.test("tie between two multi-chunk groups leaves list unchanged", () => {
  const list = [
    sc("a", "guide-1", 0.06),
    sc("b", "guide-1", 0.06),
    sc("c", "guide-2", 0.06),
    sc("d", "guide-2", 0.06),
  ];
  assertEquals(consolidateDominantSource(list).length, 4);
});

Deno.test("empty list stays empty", () => {
  assertEquals(consolidateDominantSource([]).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions && deno test generate-draft-v2/stages/retriever-coherence.test.ts`
Expected: FAIL — `consolidateDominantSource` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `retriever-coherence.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd supabase/functions && deno test generate-draft-v2/stages/retriever-coherence.test.ts`
Expected: PASS — all tests ok.

- [ ] **Step 5: Stage + commit (await human go-ahead)**

```bash
git add supabase/functions/generate-draft-v2/stages/retriever-coherence.ts supabase/functions/generate-draft-v2/stages/retriever-coherence.test.ts
git commit -m "feat(retriever): dominant-source consolidation helper"
```

---

### Task 6: Thread flags through pipeline.ts into runRetriever

**Files:**
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts` (eval_options interface ~46-50; runRetriever call ~873-883)
- Modify: `supabase/functions/generate-draft-v2/stages/retriever.ts` (RetrieverInput interface ~53-67)

- [ ] **Step 1: Extend the `eval_options` interface in pipeline.ts**

Replace the `eval_options?: { ... }` block (~46-50) with:

```ts
  eval_options?: {
    writer_model?: string;
    strong_model?: string;
    disable_escalation?: boolean;
    // Retrieval coherence rules (default off → production unchanged).
    retrieval_abs_floor?: number | null;
    retrieval_pq_budget?: number | null;
    retrieval_issue_tiebreak?: boolean;
    retrieval_source_consolidate?: boolean;
  };
```

- [ ] **Step 2: Add `coherenceFlags` to `RetrieverInput` in retriever.ts**

Add the import at the top of `retriever.ts` (after the existing imports, ~line 4):

```ts
import {
  applyAbsoluteFloor,
  applyIssueTiebreak,
  consolidateDominantSource,
  resolveKnowledgeBudget,
  type RetrievalCoherenceFlags,
} from "./retriever-coherence.ts";
```

In `export interface RetrieverInput`, after `excludeChunkIds?: string[];` (~66), add:

```ts
  // Retrieval coherence rules. Omitted/undefined fields = production defaults.
  coherenceFlags?: Partial<RetrievalCoherenceFlags>;
```

- [ ] **Step 3: Pass flags from pipeline.ts into runRetriever**

In `pipeline.ts`, in the `runRetriever({ ... })` call (~873), after `excludeChunkIds: input.exclude_chunk_ids,` add:

```ts
      coherenceFlags: {
        absFloor: eval_options?.retrieval_abs_floor ?? null,
        pqBudget: eval_options?.retrieval_pq_budget ?? null,
        issueTiebreak: eval_options?.retrieval_issue_tiebreak === true,
        sourceConsolidate: eval_options?.retrieval_source_consolidate === true,
      },
```

- [ ] **Step 4: Type-check both files**

Run: `cd supabase/functions && deno check generate-draft-v2/pipeline.ts generate-draft-v2/stages/retriever.ts`
Expected: no NEW errors in these files (pre-existing unrelated errors may remain).

- [ ] **Step 5: Stage + commit (await human go-ahead)**

```bash
git add supabase/functions/generate-draft-v2/pipeline.ts supabase/functions/generate-draft-v2/stages/retriever.ts
git commit -m "feat(retriever): thread coherence flags through pipeline"
```

---

### Task 7: Wire the helpers into runRetriever's selection chain

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever.ts` (regularChunks construction ~709-826; the destructure ~511-521)

Apply the rules at defined points. Default flags (all off/null) reproduce today's behavior exactly.

- [ ] **Step 1: Read `coherenceFlags` in the function signature**

In `runRetriever`'s destructured parameter (~511-521), add `coherenceFlags` after `excludeChunkIds,`:

```ts
    excludeChunkIds,
    coherenceFlags,
```

Immediately after the `excludedIdSet` line (~523-525), add a normalized flags object:

```ts
  const flags: RetrievalCoherenceFlags = {
    absFloor: coherenceFlags?.absFloor ?? null,
    pqBudget: coherenceFlags?.pqBudget ?? null,
    issueTiebreak: coherenceFlags?.issueTiebreak === true,
    sourceConsolidate: coherenceFlags?.sourceConsolidate === true,
  };
```

- [ ] **Step 2: Replace the `knowledgeBudget` constant with the resolver**

Replace the `const knowledgeBudget = plan.primary_intent === "complaint" || plan.primary_intent === "technical_support" ? 2 : 4;` block (~709-713) with:

```ts
  const knowledgeBudget = resolveKnowledgeBudget(plan.primary_intent, flags.pqBudget);
```

- [ ] **Step 3: Insert source-consolidation before dedup/floor/slice**

The current chain (~769-826) is: `.sort(...)` → `.reduce(dedupe)` → `.filter(floor)` → `.slice(budget)`. Change it so consolidation runs right after the sort. Locate the end of the `.sort((a, b) => { ... return score(b) - score(a); })` call (~811) and the start of the dedupe `.reduce(` (~813). Between them, the fluent chain currently flows directly. Refactor the tail from `.sort(...)` onward into explicit statements:

Replace everything from `    .sort((a, b) => {` (~769) through `    .slice(0, knowledgeBudget);` (~826) with a sorted array assignment plus post-steps. First close the chain at the sort by assigning to a variable — change the chain so `regularChunks` is built in steps:

```ts
  const scoredChunks = fused
    .filter((r) => {
      const meta = r.chunk.metadata && typeof r.chunk.metadata === "object"
        ? r.chunk.metadata as Record<string, unknown>
        : {};
      return String(meta.audience || "").toLowerCase() !== "internal";
    })
    .map((r) => {
      const meta = r.chunk.metadata && typeof r.chunk.metadata === "object"
        ? r.chunk.metadata as Record<string, unknown>
        : {};
      const base = {
        id: r.chunk.id as string,
        content: r.chunk.content as string,
        kind: (r.chunk.source_type as string) ?? "knowledge",
        source_label: sourceLabel(r.chunk),
        similarity: r.score,
        source_id: meta.source_id != null ? String(meta.source_id) : null,
        chunk_index: typeof meta.chunk_index === "number" ? meta.chunk_index : null,
        chunk_count: typeof meta.chunk_count === "number" ? meta.chunk_count : 1,
        products: Array.isArray(meta.products)
          ? (meta.products as unknown[]).map((p) => String(p || "").trim().toLowerCase()).filter(Boolean)
          : [],
        vector_similarity: r.vectorSimilarity,
      };
      return {
        ...base,
        ...classifyKnowledgeSource({
          ...base,
          source_provider: r.chunk.source_provider as string | null,
          metadata: r.chunk.metadata as Record<string, unknown> | null,
        }),
      };
    })
    .filter((chunk) =>
      !isVariantConflictingSource(customerMessage || "", {
        source_label: chunk.source_label,
        content: chunk.content,
        kind: chunk.kind,
        usable_as: chunk.usable_as,
      })
    )
    .sort((a, b) => {
      const score = (chunk: RetrievedChunk) => {
        const text = `${chunk.source_label} ${chunk.content}`;
        const productBoost = overlapCount(text, mentionedProducts) * 0.10;
        const crossProductPenalty =
          !chunk.applies_to_all_products &&
          mentionedProducts.length === 1 &&
          overlapCount(text, otherProducts) > 0 &&
          overlapCount(text, mentionedProducts) === 0
            ? 0.12
            : 0;
        const generalProductBoost =
          chunk.applies_to_all_products && mentionedProducts.length > 0 ? 0.05 : 0;
        const taggedIssueOverlap = chunk.chunk_issue_types.filter((t) =>
          issueTerms.includes(t)
        ).length;
        const taggedIssueBoost = taggedIssueOverlap * 0.06;
        return chunk.similarity +
          productBoost +
          generalProductBoost +
          taggedIssueBoost +
          overlapCount(text, issueTerms) * 0.02 +
          (/manual_text|snippet/i.test(`${chunk.source_label} ${chunk.kind}`)
            ? 0.04
            : 0) +
          (chunk.usable_as === "saved_reply" ? 0.06 : 0) +
          (chunk.usable_as === "policy" ? 0.02 : 0) +
          (chunk.usable_as === "fact" ? 0.02 : 0) -
          crossProductPenalty;
      };
      return score(b) - score(a);
    });

  // Mechanism 3: collapse to a dominant multi-chunk guide when one exists.
  const consolidated = flags.sourceConsolidate
    ? consolidateDominantSource(scoredChunks)
    : scoredChunks;

  const regularChunks: RetrievedChunk[] = consolidated
    .reduce((acc: RetrievedChunk[], chunk) => {
      const isDuplicate = acc.some(
        (k) => tokenOverlapJaccard(k.content, chunk.content) >= 0.6,
      );
      return isDuplicate ? acc : [...acc, chunk];
    }, [])
    .filter((chunk, _i, arr) => {
      if (arr.length === 0) return true;
      const topSimilarity = arr[0].similarity;
      return _i < 3 || chunk.similarity >= topSimilarity * 0.6;
    })
    .slice(0, knowledgeBudget);
```

- [ ] **Step 4: Apply issue-tiebreak and absolute floor after the Q&A title-match override**

The Q&A title-match override block ends at ~876 (the closing `}` of `if (regularChunks.length >= 2 && customerMessage) { ... }`). Immediately after that block, add:

```ts
  // Mechanism 2b: collapse to a single chunk when exactly one matches the
  // customer's detected issue tags.
  if (flags.issueTiebreak) {
    const tied = applyIssueTiebreak(regularChunks, issueTerms);
    if (tied.length !== regularChunks.length) {
      regularChunks.length = 0;
      regularChunks.push(...tied);
    }
  }

  // Mechanism 1: drop the whole knowledge block when nothing clears the
  // absolute cosine floor (junk-fallback guard).
  if (flags.absFloor !== null) {
    const floored = applyAbsoluteFloor(regularChunks, flags.absFloor);
    if (floored.length !== regularChunks.length) {
      regularChunks.length = 0;
      regularChunks.push(...floored);
    }
  }
```

- [ ] **Step 5: Type-check**

Run: `cd supabase/functions && deno check generate-draft-v2/stages/retriever.ts`
Expected: no NEW errors in retriever.ts.

- [ ] **Step 6: Run the coherence unit tests (regression guard)**

Run: `cd supabase/functions && deno test generate-draft-v2/stages/retriever-coherence.test.ts`
Expected: PASS — all tests still ok.

- [ ] **Step 7: Stage + commit (await human go-ahead)**

```bash
git add supabase/functions/generate-draft-v2/stages/retriever.ts
git commit -m "feat(retriever): wire coherence rules into selection chain"
```

---

### Task 8: Add eval_options passthrough to the golden-eval harness

**Files:**
- Modify: `apps/web/lib/server/eval-runner.js` (generateDraftV2 ~217-284)
- Modify: `supabase/scripts/lib/golden-eval-core.mjs` (parseArgs)
- Modify: `supabase/scripts/run-golden-eval.mjs` (generateDraftV2 call ~40-42)

This lets us A/B each mechanism against the deployed function from the CLI without redeploying.

- [ ] **Step 1: Forward new options in eval-runner.js**

In `generateDraftV2`, the `eval_options` object currently sends `writer_model`, `strong_model`, `disable_escalation`. Replace that `eval_options: { ... }` literal (~239-243) with:

```ts
        eval_options: {
          writer_model: options.writerModel || undefined,
          strong_model: options.strongModel || undefined,
          disable_escalation: options.disableEscalation === true,
          retrieval_abs_floor:
            typeof options.retrievalAbsFloor === "number"
              ? options.retrievalAbsFloor
              : undefined,
          retrieval_pq_budget:
            typeof options.retrievalPqBudget === "number"
              ? options.retrievalPqBudget
              : undefined,
          retrieval_issue_tiebreak: options.retrievalIssueTiebreak === true
            ? true
            : undefined,
          retrieval_source_consolidate: options.retrievalSourceConsolidate === true
            ? true
            : undefined,
        },
```

- [ ] **Step 2: Parse CLI flags in parseArgs (golden-eval-core.mjs)**

In `parseArgs`, before the `return {` statement, add:

```js
  const absFloorRaw = val("--abs-floor");
  const pqBudgetRaw = val("--pq-budget");
```

And add these fields to the returned object (after `accept: has("--accept"),`):

```js
    retrievalAbsFloor: absFloorRaw !== null ? parseFloat(absFloorRaw) : null,
    retrievalPqBudget: pqBudgetRaw !== null ? parseInt(pqBudgetRaw, 10) : null,
    retrievalIssueTiebreak: has("--issue-tiebreak"),
    retrievalSourceConsolidate: has("--source-consolidate"),
```

- [ ] **Step 3: Pass options into generateDraftV2 in the runner**

In `run-golden-eval.mjs`, the `generateDraftV2(opts.shop, c.subject, c.body, { sourceThreadId: ... })` call (~40-42) — extend the options object:

```js
    const gen = await generateDraftV2(opts.shop, c.subject, c.body, {
      sourceThreadId: c.source_thread_id || undefined,
      retrievalAbsFloor: opts.retrievalAbsFloor ?? undefined,
      retrievalPqBudget: opts.retrievalPqBudget ?? undefined,
      retrievalIssueTiebreak: opts.retrievalIssueTiebreak || undefined,
      retrievalSourceConsolidate: opts.retrievalSourceConsolidate || undefined,
    });
```

- [ ] **Step 4: Syntax-check the harness**

Run: `node --check supabase/scripts/run-golden-eval.mjs && node --check supabase/scripts/lib/golden-eval-core.mjs && node --check apps/web/lib/server/eval-runner.js && echo OK`
Expected: `OK`

- [ ] **Step 5: Run the core unit tests (no regression)**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs 2>&1 | tail -3`
Expected: `# fail 0`

- [ ] **Step 6: Stage + commit (await human go-ahead)**

```bash
git add apps/web/lib/server/eval-runner.js supabase/scripts/lib/golden-eval-core.mjs supabase/scripts/run-golden-eval.mjs
git commit -m "feat(eval): CLI passthrough for retrieval coherence flags"
```

---

### Task 9: Deploy, A/B each mechanism, keep what passes, re-baseline

**Files:** none (operational task). Requires explicit human go-ahead for each full eval run (OpenAI cost).

- [ ] **Step 1: Deploy v2 with all flags available (default off)**

Run: `npx supabase functions deploy generate-draft-v2`
Expected: `Deployed Functions on project ikuupzjaxzvatdnmyzoy: generate-draft-v2`

- [ ] **Step 2: Confirm baseline behavior is unchanged (flags off)**

Run: `set -a && source apps/web/.env.local 2>/dev/null && set +a && node supabase/scripts/run-golden-eval.mjs --intent complaint,product_question --limit 3`
Expected: scored=3, failed=0; coherence block prints; numbers match the pre-fix smoke run (no flag set → no behavior change).

- [ ] **Step 3: A/B Mechanism 1 (abs floor) — needs human go-ahead**

Run: `node supabase/scripts/run-golden-eval.mjs --intent complaint,product_question --abs-floor 0.30`
Compare `grab_bag_rate` and `overall_10` + per-case regressions vs the flags-off run. Try `0.25` and `0.35` to find the knee. Keep the threshold only if `overall_10` holds/rises and g-025-type cases escalate while real answers do not.

- [ ] **Step 4: A/B Mechanism 2a (pq budget)**

Run: `node supabase/scripts/run-golden-eval.mjs --intent complaint,product_question --pq-budget 2` then `--pq-budget 3`. Keep the value that lowers `grab_bag_rate` without dropping `overall_10`.

- [ ] **Step 5: A/B Mechanism 2b (issue tiebreak)**

Run: `node supabase/scripts/run-golden-eval.mjs --intent complaint,product_question --issue-tiebreak`. Keep only if it holds/raises `overall_10`.

- [ ] **Step 6: A/B Mechanism 3 (source consolidation)**

Run: `node supabase/scripts/run-golden-eval.mjs --intent complaint,product_question --source-consolidate`. Expected: no change on AceZone (null source_id) — confirms it is inert here and safe to ship for future shops.

- [ ] **Step 7: Combined run of the passing mechanisms**

Run the runner with all kept flags together on `--intent complaint,product_question`. Confirm combined `grab_bag_rate` is down and `overall_10` holds/rises with no per-case regressions.

- [ ] **Step 8: Full-set regression check + re-baseline (human go-ahead)**

Run the full 44-case set with the kept flags. Confirm no regression on the other intents. If clean and the human approves, set the kept flags' defaults to **on** in `pipeline.ts` (change the `?? null` / `=== true` defaults to the chosen values) and re-run `--accept` to write the new baseline. Deploy.

- [ ] **Step 9: Stage + commit (await human go-ahead)**

```bash
git add supabase/functions/generate-draft-v2/pipeline.ts supabase/eval/golden-baseline.acezone.json
git commit -m "feat(retriever): enable validated coherence rules by default"
```
