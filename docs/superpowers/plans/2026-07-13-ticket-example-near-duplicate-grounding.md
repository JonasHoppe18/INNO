# Ticket-example near-duplicate grounding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a near-identical past ticket ground the current answer (facts, not just tone), while non-near-duplicate examples stay style-only.

**Architecture:** Pure grounding-coverage gains a `strongTicketExampleCount` input; the retriever surfaces per-example `similarity` + `is_near_duplicate` (high similarity AND product-term match, or no product named); the pipeline counts strong examples and feeds coverage; the writer relaxes the SUBJECT RULE for near-duplicate examples only.

**Tech Stack:** Deno / TypeScript, Supabase Edge Functions, OpenAI embeddings.

## Global Constraints

- Threshold env var: `TICKET_EXAMPLE_GROUNDING_MIN_SIMILARITY`, default `0.75` raw cosine.
- Fail-safe everywhere: missing/NaN similarity → `is_near_duplicate=false`; undefined count → no behavior change.
- Personal-data privacy rule in the writer is untouched and absolute.
- Deno tests: `deno test --no-check --allow-env <file>`. Only 2 known pre-existing `deno check` errors (`_shared/shopify-credentials.ts:36`, `_shared/tracking/providers/gls/tracking.ts:204`) — no new ones.
- Product-term match is the safety mechanism; never promote a cross-product example.

---

### Task 1: Grounding-coverage counts strong ticket examples

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/grounding-coverage.ts`
- Test: `supabase/functions/generate-draft-v2/stages/grounding-coverage.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `assessGroundingCoverage` accepts optional `strongTicketExampleCount?: number | null`; when `> 0` the case is grounded (`{ ungrounded:false, reason:null }`), overriding the `no_chunks_no_facts` and `matcher_abstained_no_facts` branches.

- [ ] **Step 1: Write failing tests**

```ts
Deno.test("a strong ticket example grounds an otherwise ungrounded case", () => {
  const r = assessGroundingCoverage({
    intent: "product_question", chunkCount: 0, verifiedFactsCount: 0,
    structuredFactsCount: 0, strongTicketExampleCount: 1,
  });
  assertEquals(r.ungrounded, false);
});

Deno.test("strong example overrides matcher abstention", () => {
  const r = assessGroundingCoverage({
    intent: "product_question", chunkCount: 3, matcherAbstained: true,
    verifiedFactsCount: 0, structuredFactsCount: 0, strongTicketExampleCount: 2,
  });
  assertEquals(r.ungrounded, false);
});

Deno.test("zero strong examples leaves ungrounded behavior unchanged", () => {
  const r = assessGroundingCoverage({
    intent: "product_question", chunkCount: 0, verifiedFactsCount: 0,
    structuredFactsCount: 0, strongTicketExampleCount: 0,
  });
  assertEquals(r.ungrounded, true);
  assertEquals(r.reason, "no_chunks_no_facts");
});

Deno.test("undefined strongTicketExampleCount = today's behavior (fail-safe)", () => {
  const r = assessGroundingCoverage({
    intent: "product_question", chunkCount: 0, verifiedFactsCount: 0,
    structuredFactsCount: 0,
  });
  assertEquals(r.ungrounded, true);
});
```

- [ ] **Step 2: Run tests, verify they fail** — `deno test --no-check --allow-env supabase/functions/generate-draft-v2/stages/grounding-coverage.test.ts`. Expected: the two "strong example" tests fail (input ignored today).

- [ ] **Step 3: Implement**

Add to the input type: `strongTicketExampleCount?: number | null;`. After the `if (hasFacts) return ...` line, insert:

```ts
const strongExamples =
  typeof input?.strongTicketExampleCount === "number" ? input.strongTicketExampleCount : 0;
if (strongExamples > 0) return { ungrounded: false, reason: null };
```

Placement: AFTER the `chunkCount/verifiedFactsCount/structuredFactsCount === null` fail-safe return and the `hasFacts` return, BEFORE the `chunkCount === 0` branch.

- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(draft): count near-duplicate ticket examples as grounding`

---

### Task 2: Retriever surfaces similarity + is_near_duplicate

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever.ts`
- Test: `supabase/functions/generate-draft-v2/stages/retriever-near-duplicate.test.ts` (new — pure helper extraction)

**Interfaces:**
- Consumes: existing `item.similarity`, `extractMentionedProductTerms`, `overlapCount`.
- Produces: each object in `RetrieverResult.past_ticket_examples` gains `similarity: number` and `is_near_duplicate: boolean`.

**Design note — testability:** extract the decision into a pure exported helper so it can be unit-tested without the RPC:

```ts
export function isNearDuplicateExample(input: {
  similarity: number;
  exampleText: string;
  queryProductTerms: string[];
  overlap: (text: string, terms: string[]) => number;
  threshold: number;
}): boolean {
  const { similarity, exampleText, queryProductTerms, overlap, threshold } = input;
  if (!Number.isFinite(similarity)) return false;
  const productTermMatch = overlap(exampleText, queryProductTerms) > 0;
  const customerNamedProduct = queryProductTerms.length > 0;
  return similarity >= threshold && (productTermMatch || !customerNamedProduct);
}
```

- [ ] **Step 1: Write failing tests** for `isNearDuplicateExample`:

```ts
const ov = (text: string, terms: string[]) =>
  terms.filter((t) => text.toLowerCase().includes(t.toLowerCase())).length;

Deno.test("same-product high-similarity example is a near-duplicate", () => {
  assert(isNearDuplicateExample({
    similarity: 0.9, exampleText: "mic clip for the A-Spire headset",
    queryProductTerms: ["a-spire"], overlap: ov, threshold: 0.86,
  }));
});

Deno.test("cross-product example is NOT a near-duplicate even at high similarity", () => {
  assertEquals(isNearDuplicateExample({
    similarity: 0.95, exampleText: "ear pads replacement",
    queryProductTerms: ["a-spire"], overlap: ov, threshold: 0.86,
  }), false);
});

Deno.test("no product named -> similarity alone promotes", () => {
  assert(isNearDuplicateExample({
    similarity: 0.88, exampleText: "our return window is 30 days",
    queryProductTerms: [], overlap: ov, threshold: 0.86,
  }));
});

Deno.test("below threshold is never a near-duplicate", () => {
  assertEquals(isNearDuplicateExample({
    similarity: 0.7, exampleText: "mic clip for the A-Spire",
    queryProductTerms: ["a-spire"], overlap: ov, threshold: 0.86,
  }), false);
});

Deno.test("NaN similarity is fail-safe false", () => {
  assertEquals(isNearDuplicateExample({
    similarity: NaN, exampleText: "x", queryProductTerms: [], overlap: ov, threshold: 0.86,
  }), false);
});
```

- [ ] **Step 2: Run tests, verify they fail** (helper not exported yet).

- [ ] **Step 3: Implement**
  - Add the exported `isNearDuplicateExample` helper near the other pure helpers.
  - Add `similarity: number` and `is_near_duplicate: boolean` to the `RetrieverResult.past_ticket_examples` array type (line ~115).
  - In the ticket_examples lookup's final `.map` (~2118), compute and include both fields. The `productTerms` for the query are already computed as `extractMentionedProductTerms(queryText, shop)` inside the loop — hoist/recompute once for the query and pass to the helper. Read the threshold once: `const groundingThreshold = Number(Deno.env.get("TICKET_EXAMPLE_GROUNDING_MIN_SIMILARITY") ?? "0.75");`.
  - `exampleText` = `${subject||""} ${customer_msg} ${agent_reply}` (same text already built for lexical scoring).

- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Typecheck** — `deno check supabase/functions/generate-draft-v2/stages/retriever.ts` (only the 2 pre-existing errors).
- [ ] **Step 6: Commit** — `feat(draft): surface similarity + near-duplicate flag on ticket examples`

---

### Task 3: Writer relaxes SUBJECT RULE for near-duplicates only

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/writer.ts` (fewShotBlock ~1740)
- Test: `supabase/functions/generate-draft-v2/stages/writer.test.ts` (add cases; if fewShotBlock is not independently testable, extract a pure `buildFewShotBlock(examples, opts)` helper and test that)

**Interfaces:**
- Consumes: `retrieved.past_ticket_examples[].is_near_duplicate` (from Task 2).
- Produces: near-duplicate examples labelled; the relaxed-exception paragraph present ONLY when ≥1 near-duplicate exists; blanket SUBJECT RULE otherwise unchanged.

- [ ] **Step 1: Write failing tests**
  - `buildFewShotBlock` with a near-duplicate example → output contains "Near-duplicate — SAME product" AND the "EXCEPTION — near-duplicate examples" paragraph AND the phrase "MAY reuse its factual resolution".
  - `buildFewShotBlock` with only non-near-duplicate examples → output does NOT contain "EXCEPTION — near-duplicate" and still contains the blanket "STYLE references ONLY".
  - Empty examples → empty string.

- [ ] **Step 2: Run tests, verify they fail.**

- [ ] **Step 3: Implement**
  - If needed, extract the existing fewShotBlock string-builder into an exported pure `buildFewShotBlock(examples, { isReturnRefund })` returning the same string it builds today, then call it from writer. (Keep behavior identical for the non-near-duplicate path.)
  - Add the `[Near-duplicate — SAME product as the current case]` label when `ex.is_near_duplicate`.
  - Append the conditional EXCEPTION paragraph (verbatim from the spec) when `examples.some((e) => e.is_near_duplicate)`.

- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Typecheck** — `deno check supabase/functions/generate-draft-v2/stages/writer.ts` (only the 2 pre-existing errors).
- [ ] **Step 6: Commit** — `feat(draft): let writer reuse facts from near-duplicate examples`

---

### Task 4: Pipeline wiring + deploy + empirical threshold verification

**Files:**
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts` (assessGroundingCoverage call ~1804)

**Interfaces:**
- Consumes: `retrieved.past_ticket_examples[].is_near_duplicate` (Task 2), `assessGroundingCoverage` strong-count input (Task 1).

- [ ] **Step 1: Wire the count** into the existing `assessGroundingCoverage({...})` call:

```ts
strongTicketExampleCount: Array.isArray(retrieved.past_ticket_examples)
  ? retrieved.past_ticket_examples.filter((e) => (e as { is_near_duplicate?: boolean }).is_near_duplicate === true).length
  : null,
```

- [ ] **Step 2: Typecheck** — `deno check supabase/functions/generate-draft-v2/pipeline.ts` (only 2 pre-existing errors).
- [ ] **Step 3: Re-run all three stage test suites** (grounding-coverage, retriever-near-duplicate, writer). All green.
- [ ] **Step 4: Deploy** — from the worktree ROOT: `supabase functions deploy generate-draft-v2 --project-ref ikuupzjaxzvatdnmyzoy --use-api`.
- [ ] **Step 5: Empirical threshold check + verification matrix** (dry-run, shop `38df5fef-2a23-47f3-803e-39f2d6f1ed99`, `dry_run:true`, anon Bearer). For each thread, capture `draft_text`, and if the response exposes it, the ticket-example similarities / `is_near_duplicate` flags (else infer from whether owns-the-case hedge fired):
  - Mic-clip case → expect grounded (no hedge), draft answers the mic-clip resolution.
  - Ear-pads/headset cross → expect NOT promoted, no cross-product mention.
  - A KB-grounded case → unchanged.
  - Maxgaming-class ungrounded, no near-duplicate → still hedges.
  If the mic-clip near-duplicate scores BELOW 0.86, lower the documented default to sit just under it (and just above the highest cross-product similarity observed); redeploy; re-verify. Record the observed similarities in the task report.
- [ ] **Step 6: Commit** — `feat(draft): wire near-duplicate ticket-example grounding into pipeline` (include any threshold-default adjustment).

---

## Self-Review

- Spec coverage: Change 1→Task 2, Change 2→Task 1, Change 3→Task 4, Change 4→Task 3, calibration→Task 4 Step 5. ✓
- Type consistency: `is_near_duplicate` / `similarity` names identical across Tasks 2→3→4. ✓
- Fail-safe: Task 1 undefined-count test + Task 2 NaN test. ✓
