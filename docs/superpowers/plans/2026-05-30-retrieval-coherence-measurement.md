# Retrieval Coherence Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure how often `generate-draft-v2`'s writer-facing knowledge set is a topical/product "grab-bag" by instrumenting the pipeline (eval-only) and computing a coherence metric over the golden set — producing a baseline for the later retrieval fix.

**Architecture:** The retriever already computes the final writer-facing chunk list (`retrieved.chunks`). We surface it on the edge-function response **only when the call is an eval call** (gated on `eval_payload`), capture it in the golden runner, and score it with a new pure function `computeCoherence` in `golden-eval-core.mjs`. No selection logic changes; no production behavior changes.

**Tech Stack:** Deno (Supabase Edge Function, TypeScript) for the pipeline; Node.js ESM + `node:test` for the pure scoring logic and runner.

---

## Repo conventions (read before starting)

- **Never commit unless the human explicitly asks.** The TDD commit steps below are part of the plan, but during execution pause and get explicit approval before each `git commit`.
- All user-facing/app text in English.
- Deploy v2 with plain `npx supabase functions deploy generate-draft-v2` (no special flags). Do NOT deploy postmark-inbound in this work.
- Pure logic lives in `supabase/scripts/lib/golden-eval-core.mjs`, unit-tested in the sibling `.test.mjs` via `node --test`. Follow the existing style (named exports, `round2` helper already defined).
- Env for runner: `set -a && source apps/web/.env.local && set +a` before running any `supabase/scripts/*.mjs`.

## File Structure

- `supabase/scripts/lib/golden-eval-core.mjs` — MODIFY: add `computeCoherence(chunks)`; extend `computeAggregate(results)` with a `coherence` block. Pure, no I/O.
- `supabase/scripts/lib/golden-eval-core.test.mjs` — MODIFY: add `node:test` cases for both.
- `supabase/functions/generate-draft-v2/stages/retriever.ts` — MODIFY: add optional debug fields to `RetrievedChunk` and populate them from chunk metadata at construction.
- `supabase/functions/generate-draft-v2/pipeline.ts` — MODIFY: include `retrieval_debug` on the writer-output return, gated on `eval_payload`.
- `apps/web/lib/server/eval-runner.js` — MODIFY: capture `retrieval_debug` into `generateDraftV2`'s return as `retrievalDebug`.
- `supabase/scripts/run-golden-eval.mjs` — MODIFY: compute coherence per case, print it, write it into the per-run report.

---

### Task 1: `computeCoherence` pure function

**Files:**
- Modify: `supabase/scripts/lib/golden-eval-core.mjs` (append new export after `computeAggregate`)
- Test: `supabase/scripts/lib/golden-eval-core.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

Append to `supabase/scripts/lib/golden-eval-core.test.mjs`:

```js
import { computeCoherence } from "./golden-eval-core.mjs";

test("computeCoherence: empty input is coherent", () => {
  const r = computeCoherence([]);
  assert.deepEqual(r, {
    n_chunks: 0, distinct_sources: 0, distinct_products: 0,
    top_source_share: 1, is_grab_bag: false,
  });
});

test("computeCoherence: single focused guide", () => {
  const r = computeCoherence([
    { title: "Warranty policy", source_id: "s1", products: ["a-spire"] },
    { title: "Warranty policy", source_id: "s1", products: ["a-spire"] },
  ]);
  assert.equal(r.n_chunks, 2);
  assert.equal(r.distinct_sources, 1);
  assert.equal(r.distinct_products, 1);
  assert.equal(r.top_source_share, 1);
  assert.equal(r.is_grab_bag, false);
});

test("computeCoherence: two-product scatter flags grab_bag", () => {
  const r = computeCoherence([
    { title: "Mic A-Spire", source_id: "s1", products: ["a-spire"] },
    { title: "Mic A-blaze", source_id: "s2", products: ["a-blaze"] },
  ]);
  assert.equal(r.distinct_products, 2);
  assert.equal(r.top_source_share, 0.5);
  assert.equal(r.is_grab_bag, true);
});

test("computeCoherence: three+ distinct sources flags grab_bag", () => {
  const r = computeCoherence([
    { title: "Privacy policy", source_id: "s1", products: [] },
    { title: "Shipping", source_id: "s2", products: [] },
    { title: "Terms", source_id: "s3", products: [] },
    { title: "Warranty", source_id: "s4", products: [] },
  ]);
  assert.equal(r.distinct_sources, 4);
  assert.equal(r.distinct_products, 0);
  assert.equal(r.top_source_share, 0.25);
  assert.equal(r.is_grab_bag, true);
});

test("computeCoherence: falls back to title when source_id missing", () => {
  const r = computeCoherence([
    { title: "DONGLE?", source_id: null, products: [] },
    { title: "DONGLE?", products: [] },
  ]);
  assert.equal(r.distinct_sources, 1);
  assert.equal(r.top_source_share, 1);
  assert.equal(r.is_grab_bag, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: FAIL — `computeCoherence is not a function` (or import error) for the 5 new tests.

- [ ] **Step 3: Implement `computeCoherence`**

Append to `supabase/scripts/lib/golden-eval-core.mjs` (after `computeAggregate`, before `diffBaseline`). Note `round2` is already defined above in the file:

```js
export function computeCoherence(chunks) {
  const arr = Array.isArray(chunks) ? chunks : [];
  const n_chunks = arr.length;
  if (n_chunks === 0) {
    return {
      n_chunks: 0, distinct_sources: 0, distinct_products: 0,
      top_source_share: 1, is_grab_bag: false,
    };
  }
  // Group identity: prefer source_id, fall back to title (multi-chunk guides
  // share both). Empty identity is ignored so it never inflates the count.
  const identity = (c) => String(c?.source_id ?? c?.title ?? "").trim().toLowerCase();
  const counts = new Map();
  for (const c of arr) {
    const id = identity(c);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const distinct_sources = counts.size;
  const maxCount = counts.size ? Math.max(...counts.values()) : 0;
  const top_source_share = round2(maxCount / n_chunks);

  const productSet = new Set();
  for (const c of arr) {
    const prods = Array.isArray(c?.products) ? c.products : [];
    for (const p of prods) {
      const name = String(p || "").trim().toLowerCase();
      if (name) productSet.add(name);
    }
  }
  const distinct_products = productSet.size;
  const is_grab_bag = distinct_sources >= 3 || distinct_products >= 2;

  return { n_chunks, distinct_sources, distinct_products, top_source_share, is_grab_bag };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: PASS — all tests (the original 18 + 5 new) green, `# fail 0`.

- [ ] **Step 5: Commit** (only after explicit human approval)

```bash
git add supabase/scripts/lib/golden-eval-core.mjs supabase/scripts/lib/golden-eval-core.test.mjs
git commit -m "feat(eval): add computeCoherence retrieval-scatter metric"
```

---

### Task 2: Extend `computeAggregate` with a coherence block

**Files:**
- Modify: `supabase/scripts/lib/golden-eval-core.mjs:87-113` (the `computeAggregate` function)
- Test: `supabase/scripts/lib/golden-eval-core.test.mjs` (append)

- [ ] **Step 1: Write the failing test**

Append to `supabase/scripts/lib/golden-eval-core.test.mjs`:

```js
import { computeAggregate as computeAggregateForCoh } from "./golden-eval-core.mjs";

test("computeAggregate: coherence block over results", () => {
  const results = [
    { id: "g-1", status: "scored", intent: "x",
      scores: { correctness: 4, completeness: 4, tone: 4, actionability: 4, overall_10: 8, send_ready: true },
      coherence: { n_chunks: 2, distinct_sources: 1, distinct_products: 1, top_source_share: 1, is_grab_bag: false } },
    { id: "g-2", status: "scored", intent: "y",
      scores: { correctness: 3, completeness: 3, tone: 3, actionability: 3, overall_10: 6, send_ready: false },
      coherence: { n_chunks: 4, distinct_sources: 4, distinct_products: 0, top_source_share: 0.25, is_grab_bag: true } },
  ];
  const agg = computeAggregateForCoh(results);
  assert.equal(agg.coherence.n, 2);
  assert.equal(agg.coherence.grab_bag_rate, 0.5);
  assert.equal(agg.coherence.avg_distinct_sources, 2.5);
  assert.equal(agg.coherence.avg_distinct_products, 0.5);
  assert.equal(agg.coherence.avg_top_source_share, 0.63); // (1 + 0.25) / 2 = 0.625 → round2
  assert.deepEqual(agg.coherence.per_case["g-2"], {
    is_grab_bag: true, distinct_sources: 4, distinct_products: 0,
  });
});

test("computeAggregate: coherence block is zeros when results lack coherence", () => {
  const results = [
    { id: "g-1", status: "scored", intent: "x",
      scores: { correctness: 4, completeness: 4, tone: 4, actionability: 4, overall_10: 8, send_ready: true } },
  ];
  const agg = computeAggregateForCoh(results);
  assert.equal(agg.coherence.n, 0);
  assert.equal(agg.coherence.grab_bag_rate, 0);
  assert.deepEqual(agg.coherence.per_case, {});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: FAIL — `Cannot read properties of undefined (reading 'n')` (no `coherence` on aggregate yet).

- [ ] **Step 3: Implement the coherence block**

In `supabase/scripts/lib/golden-eval-core.mjs`, modify the end of `computeAggregate`. Replace the final `return { n_cases: scored.length, aggregate, per_intent, per_case };` (currently line 112) with:

```js
  const withCoh = scored.filter(
    (r) => r.coherence && typeof r.coherence.n_chunks === "number",
  );
  const coherence = {
    n: withCoh.length,
    grab_bag_rate: withCoh.length
      ? round2(withCoh.filter((r) => r.coherence.is_grab_bag).length / withCoh.length)
      : 0,
    avg_distinct_sources: withCoh.length
      ? round2(withCoh.reduce((s, r) => s + r.coherence.distinct_sources, 0) / withCoh.length)
      : 0,
    avg_distinct_products: withCoh.length
      ? round2(withCoh.reduce((s, r) => s + r.coherence.distinct_products, 0) / withCoh.length)
      : 0,
    avg_top_source_share: withCoh.length
      ? round2(withCoh.reduce((s, r) => s + r.coherence.top_source_share, 0) / withCoh.length)
      : 0,
    per_case: {},
  };
  for (const r of withCoh) {
    coherence.per_case[r.id] = {
      is_grab_bag: r.coherence.is_grab_bag,
      distinct_sources: r.coherence.distinct_sources,
      distinct_products: r.coherence.distinct_products,
    };
  }

  return { n_cases: scored.length, aggregate, per_intent, per_case, coherence };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: PASS — `# fail 0`. The original `computeAggregate` tests still pass (they don't assert on `coherence`).

- [ ] **Step 5: Commit** (only after explicit human approval)

```bash
git add supabase/scripts/lib/golden-eval-core.mjs supabase/scripts/lib/golden-eval-core.test.mjs
git commit -m "feat(eval): aggregate retrieval coherence over golden run"
```

---

### Task 3: Add debug fields to `RetrievedChunk` and populate them

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever.ts:6-31` (interface) and `:727-743` (construction `.map`)

This is Deno/edge code — no local unit test. It is verified end-to-end by the smoke run in Task 7.

- [ ] **Step 1: Add optional debug fields to the interface**

In `supabase/functions/generate-draft-v2/stages/retriever.ts`, inside `export interface RetrievedChunk { ... }`, add these optional fields just after `chunk_issue_types: string[];` (line 30):

```ts
  // ---- Eval-only observability (populated from chunk metadata) ----
  // Used to measure retrieval coherence (single-guide vs grab-bag). Optional
  // because not every construction site has metadata; consumers fall back to
  // source_label/title when these are absent.
  source_id?: string | null;
  chunk_index?: number | null;
  chunk_count?: number;
  products?: string[];
```

- [ ] **Step 2: Populate the fields where the chunk is built from the DB row**

In the same file, the main chunk construction is the `.map((r) => { const base = {...}; return {...base, ...classifyKnowledgeSource(...)}; })` at lines 727-743. Replace that map body so `base` also carries the metadata-derived debug fields:

```ts
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
```

Note: `sourceLabel` and `classifyKnowledgeSource` are existing functions in this file — do not redefine them. `classifyKnowledgeSource` returns only `usable_as | risk_flags | applies_to_all_products | chunk_issue_types`, so it will not overwrite the new `base` fields.

- [ ] **Step 3: Type-check locally (best effort)**

Run: `cd supabase/functions/generate-draft-v2 && deno check stages/retriever.ts 2>&1 | head -20 ; cd -`
Expected: no type errors referencing `RetrievedChunk`, `source_id`, `chunk_index`, `chunk_count`, or `products`. (If `deno` is unavailable locally, skip — Task 7's deploy performs the authoritative type-check.)

- [ ] **Step 4: Commit** (only after explicit human approval)

```bash
git add supabase/functions/generate-draft-v2/stages/retriever.ts
git commit -m "feat(v2): expose chunk source/product metadata on RetrievedChunk"
```

---

### Task 4: Emit `retrieval_debug` on the writer-output return (eval-gated)

**Files:**
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts:1638-1654` (the final writer-output `return`)

- [ ] **Step 1: Add the eval-gated `retrieval_debug` field**

In `supabase/functions/generate-draft-v2/pipeline.ts`, the final return of the writer path is at lines 1638-1654. Add a `retrieval_debug` field that is present **only when `eval_payload` is set** (the canonical eval-mode flag used elsewhere in this function, e.g. line 1640 `eval_payload ? undefined : draftId`). Replace that return with:

```ts
  return {
    draft_text: deferDraftUntilActionDecision ? null : finalDraft,
    draft_id: eval_payload ? undefined : draftId,
    proposed_actions: finalProposals,
    routing_hint: finalRoutingHint,
    is_test_mode: isTestMode,
    confidence: finalConfidence,
    intent: plan.primary_intent,
    knowledge_gaps: knowledgeGaps,
    sources: retrieved.chunks.slice(0, 5).map((c) => ({
      content: c.content.slice(0, 200),
      kind: c.kind,
      source_label: c.source_label,
      usable_as: c.usable_as,
      risk_flags: c.risk_flags,
    })),
    ...(eval_payload
      ? {
        retrieval_debug: {
          chunks: retrieved.chunks.map((c) => ({
            id: c.id,
            title: c.source_label,
            source_id: c.source_id ?? null,
            chunk_index: c.chunk_index ?? null,
            chunk_count: c.chunk_count ?? 1,
            score: c.similarity,
            kind: c.kind,
            usable_as: c.usable_as,
            products: c.products ?? [],
            issue_types: c.chunk_issue_types,
          })),
        },
      }
      : {}),
  };
```

Rationale for scope: the golden runner always produces drafts via this writer path, so instrumenting only this return covers every golden case. The action-only early return (line 1111) yields `draft_text: null` and is rejected by the runner ("returned no reply"), so it needs no debug payload. Production calls (`postmark-inbound`) pass `thread_id`, never `eval_payload`, so they get the unchanged response.

- [ ] **Step 2: Commit** (only after explicit human approval)

```bash
git add supabase/functions/generate-draft-v2/pipeline.ts
git commit -m "feat(v2): return eval-only retrieval_debug for coherence measurement"
```

---

### Task 5: Capture `retrieval_debug` in the golden runner client

**Files:**
- Modify: `apps/web/lib/server/eval-runner.js:261-279` (the tail of `generateDraftV2`)

- [ ] **Step 1: Parse and return `retrievalDebug`**

In `apps/web/lib/server/eval-runner.js`, inside `generateDraftV2`, after the existing `const routingHint = ...` line (line 270) and before the `return {` (line 271), add:

```js
  const retrievalDebug =
    data?.retrieval_debug && Array.isArray(data.retrieval_debug.chunks)
      ? data.retrieval_debug.chunks
      : [];
```

Then add `retrievalDebug` to the returned object so it reads:

```js
  return {
    draft,
    actions,
    confidence,
    sources,
    routingHint,
    retrievalDebug,
    latencyMs: Date.now() - startTime,
  };
```

- [ ] **Step 2: Sanity-check the module still imports cleanly**

Run: `node -e "import('./apps/web/lib/server/eval-runner.js').then(m => console.log('ok', typeof m.generateDraftV2)).catch(e => { console.error(e); process.exit(1); })"`
Expected: prints `ok function`. (If it errors on missing env, that's fine — re-run after `set -a && source apps/web/.env.local && set +a`; the goal is just that the file parses.)

- [ ] **Step 3: Commit** (only after explicit human approval)

```bash
git add apps/web/lib/server/eval-runner.js
git commit -m "feat(eval): capture retrieval_debug from generate-draft-v2"
```

---

### Task 6: Wire coherence into `run-golden-eval.mjs`

**Files:**
- Modify: `supabase/scripts/run-golden-eval.mjs:16-18` (import), `:48-56` (push result), `:74-88` (printing)

- [ ] **Step 1: Import `computeCoherence`**

In `supabase/scripts/run-golden-eval.mjs`, extend the existing import from the core module (lines 16-18) to include `computeCoherence`:

```js
import {
  parseArgs, loadGoldenSet, runGates, computeAggregate, diffBaseline, computeCoherence,
} from "./lib/golden-eval-core.mjs";
```

- [ ] **Step 2: Compute and attach coherence per case**

In the scored branch of the loop (the `results.push({ ... })` at lines 48-56), compute coherence from `gen.retrievalDebug` and attach it. Replace that `results.push({...})` with:

```js
    const coherence = computeCoherence(gen.retrievalDebug || []);
    results.push({
      id: c.id, intent: c.intent || null, tier: c.tier, status: "scored",
      scores: {
        correctness: judged.correctness, completeness: judged.completeness,
        tone: judged.tone, actionability: judged.actionability,
        overall_10: judged.overall_10, send_ready: judged.send_ready,
      },
      gate, coherence, draft: gen.draft, actions: gen.actions, latencyMs: gen.latencyMs,
    });
```

- [ ] **Step 3: Print the coherence summary + grab-bag cases**

After the existing `console.log("per_intent:", summary.per_intent);` line (line 76), add:

```js
console.log("coherence:", summary.coherence);
const grabBag = results
  .filter((r) => r.coherence && r.coherence.is_grab_bag)
  .map((r) => `  ${r.id}: sources=${r.coherence.distinct_sources} products=${r.coherence.distinct_products}`);
if (grabBag.length) {
  console.log("grab-bag cases:");
  for (const line of grabBag) console.log(line);
} else {
  console.log("grab-bag cases: none");
}
```

The per-run report already serializes `summary` (now containing `coherence`) and `results` (now each containing `coherence`), so no change is needed to the `writeFileSync` call.

- [ ] **Step 4: Commit** (only after explicit human approval)

```bash
git add supabase/scripts/run-golden-eval.mjs
git commit -m "feat(eval): report retrieval coherence in golden runs"
```

---

### Task 7: Deploy, smoke-test, and establish the measurement baseline

**Files:** none (operational)

- [ ] **Step 1: Deploy the instrumented v2**

Run: `npx supabase functions deploy generate-draft-v2`
Expected: deploy succeeds (this is also the authoritative TypeScript check for Tasks 3-4). If it fails on a type error, fix the referenced file and redeploy.

- [ ] **Step 2: Smoke-test 3 cases and verify the debug field is populated**

Run:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/run-golden-eval.mjs --limit 3
```
Expected:
- Console prints `coherence: { n: 3, grab_bag_rate: …, … }` with `n` equal to the number of scored cases (not 0).
- A `grab-bag cases:` line appears (either a list or `none`).
- Open the newest file in `supabase/eval/runs/` and confirm each scored result has a non-empty `coherence` object and a `retrieval_debug`-derived chunk count (`coherence.n_chunks >= 1` for cases that retrieved knowledge).

If `coherence.n_chunks` is 0 for every case, the debug field is not arriving — recheck Task 4 (`eval_payload` gate) and Task 5 (parsing `data.retrieval_debug.chunks`) before proceeding.

- [ ] **Step 3: Run the full set to establish the measurement baseline**

> Cost note: this judges all ~44 cases via OpenAI. Get explicit human go-ahead before running (the human is cost-sensitive). Do NOT pass `--accept` — coherence is reported, not gated, and we are not changing the draft-quality baseline here.

Run:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/run-golden-eval.mjs
```
Expected: an aggregate `coherence` block with `grab_bag_rate` over the full set, plus the list of grab-bag cases. Record the report path printed at the end — that report is the retrieval-coherence baseline the later fix will be measured against.

- [ ] **Step 4: Summarize findings for the human**

Report: the `grab_bag_rate`, `avg_distinct_sources`, `avg_distinct_products`, and the worst grab-bag cases (id + counts). State explicitly whether the data confirms scatter is widespread enough to justify the retrieval fix (the `2026-05-19` design), and propose threshold adjustments to `is_grab_bag` if the observed distribution suggests them.

---

## Self-Review

**Spec coverage:**
- Spec §1 (eval-gated `retrieval_debug` on v2 response) → Tasks 3 + 4.
- Spec §2 (capture in `generateDraftV2`) → Task 5.
- Spec §3 (`computeCoherence` + metric definitions) → Task 1; aggregate `coherence` block → Task 2.
- Spec §4 (reporting in runner, no baseline-file change) → Task 6 + Task 7.
- Spec "Test" section (unit tests + manual smoke) → Tasks 1-2 tests + Task 7 Steps 2-3.
- Spec "Edge cases" (empty debug, missing source_id, missing products, backward-compat empty array) → covered by `computeCoherence` impl + tests in Task 1 (empty input, title fallback) and the `|| []` guards in Tasks 5-6.

**Placeholder scan:** No TBD/TODO; every code step shows the full code and exact run command with expected output.

**Type/name consistency:** `retrieval_debug.chunks[]` field names emitted in Task 4 (`title`, `source_id`, `chunk_index`, `chunk_count`, `score`, `kind`, `usable_as`, `products`, `issue_types`) match what `computeCoherence` consumes in Task 1 (`title`, `source_id`, `products`) and what the tests pass. `coherence` object shape (`n_chunks`, `distinct_sources`, `distinct_products`, `top_source_share`, `is_grab_bag`) is identical across Task 1 (produce), Task 2 (aggregate), and Task 6 (attach/print). Runner field `gen.retrievalDebug` (Task 6) matches the `retrievalDebug` returned in Task 5.
