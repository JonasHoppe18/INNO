# Snippet-Matcher Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-lingual LLM snippet-matcher (gpt-4o-mini) as a precision/abstention layer after hybrid retrieval, plus a labeled retrieval-evaluation harness that proves it works — so `generate-draft-v2` selects the right knowledge snippet(s) across languages, or correctly selects none.

**Architecture:** Hybrid retrieval (vector + BM25) still builds a broad candidate pool for recall. A new isolated module `snippet-matcher.ts` re-ranks that pool against the customer message with an LLM and applies threshold/margin/budget selection rules, returning either the winning snippet(s) or an abstention (zero chunks). The retriever calls it after building the pool, removes the old lexical title-match override and the inert issue-tiebreak, and falls back to today's top-chunks on any matcher failure. A measurement-first evaluation layer (gold-labels + Recall@K / MRR / abstention-correctness) proves lift separately from answer quality.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript) for the pipeline; Node.js (`.mjs`, `node:test`) for the eval scripts; OpenAI Chat Completions (gpt-4o-mini, JSON output) via the existing `callOpenAIJson` helper.

---

## Source of truth

Spec: `docs/superpowers/specs/2026-05-31-snippet-matcher-precision-design.md`. Read it before starting. This plan implements that spec's rollout sequence: **E (measurement) first, then A (matcher) + B (query cleanup), then measure & calibrate.**

## Standing constraints (carry into every task)

- **No commits without an explicit ask from the user.** Steps below include `git commit` actions, but DO NOT run them unless the user has explicitly approved committing. Otherwise stop after the passing test and report.
- All app/user-facing text in English.
- All knowledge access scoped to explicit `shop_id`.
- Deploy with plain `npx supabase functions deploy generate-draft-v2`.
- Work on main.
- AceZone `shop_id`: `38df5fef-2a23-47f3-803e-39f2d6f1ed99`.

## File structure

Created:

| File | Responsibility |
|---|---|
| `supabase/functions/generate-draft-v2/stages/snippet-matcher.ts` | Pure matcher: prompt build, gpt-4o-mini call (injectable), JSON parse/validate, selection rules. No retrieval logic. |
| `supabase/functions/generate-draft-v2/stages/snippet-matcher.test.ts` | Deno unit tests with a stubbed LLM (no live API): single-winner / multi / abstain / margin / empty-pool / id-validation. |
| `supabase/scripts/build-gold-labels.mjs` | One-time: LLM proposes `correct_snippet_ids` per golden case → draft JSON for human review. |
| `supabase/eval/gold-labels.acezone.json` | Committed ground truth: case id → correct snippet identities (+ rationale). |

Modified:

| File | Change |
|---|---|
| `supabase/scripts/lib/golden-eval-core.mjs` | Add pure `computeRetrievalMetrics()` + `aggregateRetrievalMetrics()`. |
| `supabase/scripts/lib/golden-eval-core.test.mjs` | Tests for the new metric functions. |
| `supabase/scripts/run-golden-eval.mjs` | Load gold-labels; compute + report retrieval metrics alongside the judge. |
| `apps/web/lib/server/eval-runner.js` | Surface `matcher_debug` from `retrieval_debug` (already passes `retrievalDebug`; add the new field). |
| `supabase/functions/generate-draft-v2/stages/retriever.ts` | Add `question` to `RetrievedChunk`; populate it; insert matcher step; remove lexical override + issue-tiebreak; emit `matcher_debug`; B-cleanup of `buildFallbackQueries`. |
| `supabase/functions/generate-draft-v2/pipeline.ts` | Emit `retrieval_debug.matcher` from the retriever result (eval-gated). |

## Identity convention (used everywhere)

A snippet's stable identity is `source_id` when present, else its `title` (== `source_label`), lowercased and trimmed. This matches the existing `computeCoherence` convention in `golden-eval-core.mjs:169`. Gold-labels store these identities. Multiple chunks of one snippet share `source_id`.

---

## Phase E — Measurement foundation (build first, establish baseline)

### Task 1: Pure retrieval-metrics functions

**Files:**
- Modify: `supabase/scripts/lib/golden-eval-core.mjs`
- Test: `supabase/scripts/lib/golden-eval-core.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `supabase/scripts/lib/golden-eval-core.test.mjs`:

```js
import {
  computeRetrievalMetrics,
  aggregateRetrievalMetrics,
} from "./golden-eval-core.mjs";

test("computeRetrievalMetrics: recall hit, precision@1 hit, MRR 1", () => {
  const gold = ["snip-a"];
  const matcher = {
    candidates: [
      { id: "c1", source_id: "snip-a", title: "EQ" },
      { id: "c2", source_id: "snip-b", title: "Pairing" },
    ],
    ranked: [
      { id: "c1", source_id: "snip-a", title: "EQ", relevance: 0.8 },
      { id: "c2", source_id: "snip-b", title: "Pairing", relevance: 0.4 },
    ],
    selected_ids: ["c1"],
    abstained: false,
  };
  const m = computeRetrievalMetrics(gold, matcher);
  assert.equal(m.gold_empty, false);
  assert.equal(m.recall_at_k, 1);
  assert.equal(m.precision_at_1, 1);
  assert.equal(m.mrr, 1);
  assert.equal(m.abstention_correct, null);
});

test("computeRetrievalMetrics: correct ranked second → precision@1 0, MRR 0.5", () => {
  const gold = ["snip-a"];
  const matcher = {
    candidates: [
      { id: "c2", source_id: "snip-b", title: "Pairing" },
      { id: "c1", source_id: "snip-a", title: "EQ" },
    ],
    ranked: [
      { id: "c2", source_id: "snip-b", title: "Pairing", relevance: 0.7 },
      { id: "c1", source_id: "snip-a", title: "EQ", relevance: 0.65 },
    ],
    selected_ids: ["c2"],
    abstained: false,
  };
  const m = computeRetrievalMetrics(gold, matcher);
  assert.equal(m.recall_at_k, 1);
  assert.equal(m.precision_at_1, 0);
  assert.equal(m.mrr, 0.5);
});

test("computeRetrievalMetrics: correct not in pool → recall 0, MRR 0", () => {
  const gold = ["snip-z"];
  const matcher = {
    candidates: [{ id: "c1", source_id: "snip-a", title: "EQ" }],
    ranked: [{ id: "c1", source_id: "snip-a", title: "EQ", relevance: 0.9 }],
    selected_ids: ["c1"],
    abstained: false,
  };
  const m = computeRetrievalMetrics(gold, matcher);
  assert.equal(m.recall_at_k, 0);
  assert.equal(m.precision_at_1, 0);
  assert.equal(m.mrr, 0);
});

test("computeRetrievalMetrics: gold empty + abstained → abstention correct, recall null", () => {
  const matcher = {
    candidates: [{ id: "c1", source_id: "snip-a", title: "Mic" }],
    ranked: [{ id: "c1", source_id: "snip-a", title: "Mic", relevance: 0.3 }],
    selected_ids: [],
    abstained: true,
  };
  const m = computeRetrievalMetrics([], matcher);
  assert.equal(m.gold_empty, true);
  assert.equal(m.abstention_correct, 1);
  assert.equal(m.recall_at_k, null);
  assert.equal(m.precision_at_1, null);
  assert.equal(m.mrr, null);
});

test("computeRetrievalMetrics: gold empty but selected something → abstention wrong", () => {
  const matcher = {
    candidates: [{ id: "c1", source_id: "snip-a", title: "Mic" }],
    ranked: [{ id: "c1", source_id: "snip-a", title: "Mic", relevance: 0.7 }],
    selected_ids: ["c1"],
    abstained: false,
  };
  const m = computeRetrievalMetrics([], matcher);
  assert.equal(m.abstention_correct, 0);
});

test("computeRetrievalMetrics: identity falls back to title when source_id null", () => {
  const gold = ["why can't i change my eq"];
  const matcher = {
    candidates: [{ id: "c1", source_id: null, title: "Why can't I change my EQ" }],
    ranked: [{ id: "c1", source_id: null, title: "Why can't I change my EQ", relevance: 0.8 }],
    selected_ids: ["c1"],
    abstained: false,
  };
  const m = computeRetrievalMetrics(gold, matcher);
  assert.equal(m.recall_at_k, 1);
  assert.equal(m.precision_at_1, 1);
});

test("aggregateRetrievalMetrics: averages over non-null, counts abstention", () => {
  const per = [
    { gold_empty: false, recall_at_k: 1, precision_at_1: 1, mrr: 1, abstention_correct: null },
    { gold_empty: false, recall_at_k: 1, precision_at_1: 0, mrr: 0.5, abstention_correct: null },
    { gold_empty: true, recall_at_k: null, precision_at_1: null, mrr: null, abstention_correct: 1 },
    { gold_empty: true, recall_at_k: null, precision_at_1: null, mrr: null, abstention_correct: 0 },
  ];
  const agg = aggregateRetrievalMetrics(per);
  assert.equal(agg.n_labeled, 4);
  assert.equal(agg.recall_at_k, 1);      // 2/2
  assert.equal(agg.precision_at_1, 0.5); // 1/2
  assert.equal(agg.mrr, 0.75);           // (1+0.5)/2
  assert.equal(agg.abstention_correct, 0.5); // 1/2
  assert.equal(agg.n_abstain_cases, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: FAIL — `computeRetrievalMetrics is not a function` (and `aggregateRetrievalMetrics`).

- [ ] **Step 3: Implement the functions**

Append to `supabase/scripts/lib/golden-eval-core.mjs` (before the final newline; reuse the existing `round2`):

```js
// ---- Retrieval metrics (matcher precision, separate from answer quality) ----
// Identity convention: source_id when present, else title; lowercased+trimmed.
// Matches computeCoherence's grouping so gold-labels and live chunks line up.
function retrievalIdentity(entry) {
  return String(entry?.source_id ?? entry?.title ?? "").trim().toLowerCase();
}

// gold: array of correct snippet identities ([] means "no snippet should match").
// matcher: { candidates[], ranked[], selected_ids[], abstained } from retrieval_debug.
// Returns per-case metrics; fields are null when not applicable so the
// aggregate can average only over the cases each metric makes sense for.
export function computeRetrievalMetrics(gold, matcher) {
  const goldSet = new Set((gold || []).map((g) => String(g).trim().toLowerCase()));
  const goldEmpty = goldSet.size === 0;
  const m = matcher || {};
  const candidates = Array.isArray(m.candidates) ? m.candidates : [];
  const ranked = Array.isArray(m.ranked) ? m.ranked : [];
  const selected = Array.isArray(m.selected_ids) ? m.selected_ids : [];

  if (goldEmpty) {
    // Abstention case: correct iff we selected nothing.
    return {
      gold_empty: true,
      recall_at_k: null,
      precision_at_1: null,
      mrr: null,
      abstention_correct: selected.length === 0 ? 1 : 0,
    };
  }

  const recall = candidates.some((c) => goldSet.has(retrievalIdentity(c))) ? 1 : 0;

  let mrr = 0;
  for (let i = 0; i < ranked.length; i++) {
    if (goldSet.has(retrievalIdentity(ranked[i]))) {
      mrr = 1 / (i + 1);
      break;
    }
  }
  const precisionAt1 = ranked.length > 0 && goldSet.has(retrievalIdentity(ranked[0])) ? 1 : 0;

  return {
    gold_empty: false,
    recall_at_k: recall,
    precision_at_1: precisionAt1,
    mrr: round2(mrr),
    abstention_correct: null,
  };
}

export function aggregateRetrievalMetrics(perCase) {
  const arr = Array.isArray(perCase) ? perCase : [];
  const avg = (key) => {
    const vals = arr.map((p) => p?.[key]).filter((v) => typeof v === "number");
    return vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  };
  return {
    n_labeled: arr.length,
    n_abstain_cases: arr.filter((p) => p?.gold_empty).length,
    recall_at_k: avg("recall_at_k"),
    precision_at_1: avg("precision_at_1"),
    mrr: avg("mrr"),
    abstention_correct: avg("abstention_correct"),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: PASS — all new tests green, existing tests still green.

- [ ] **Step 5: Commit** (only if the user approved committing)

```bash
git add supabase/scripts/lib/golden-eval-core.mjs supabase/scripts/lib/golden-eval-core.test.mjs
git commit -m "feat(eval): pure retrieval-precision metrics (Recall@K, MRR, abstention)"
```

---

### Task 2: Gold-label proposal script

**Files:**
- Create: `supabase/scripts/build-gold-labels.mjs`

This is a one-time tool: it fetches every distinct snippet for the shop, asks an LLM to propose which snippet(s) correctly answer each golden case (empty = "no snippet should match"), and writes a draft JSON for a human to correct. It does NOT decide ground truth — the human does (Task 3). There is no unit test for this script; it is an operator tool validated by running it.

- [ ] **Step 1: Write the script**

Create `supabase/scripts/build-gold-labels.mjs`:

```js
// supabase/scripts/build-gold-labels.mjs
//
// One-time: propose gold retrieval labels for the committed golden set.
// For each golden case, an LLM is shown the customer message + every distinct
// shop snippet and proposes correct_snippet_ids (snippet identities) — empty
// when NO snippet should be used (e.g. g-020 dongle purchase). A human then
// reviews/corrects the output file; it is committed as ground truth.
//
// Identity = source_id when present, else title (matches the retriever/eval
// convention). Output ids are these identities.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/build-gold-labels.mjs
//   node supabase/scripts/build-gold-labels.mjs --shop 38df5fef-... --limit 3
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseArgs, loadGoldenSet } from "./lib/golden-eval-core.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = "gpt-4o-mini";
const SET_PATH = "supabase/eval/golden-set.acezone.json";
const OUT_PATH = "supabase/eval/gold-labels.acezone.json";

if (!SUPABASE_URL || !SERVICE_ROLE || !OPENAI_KEY) {
  console.error("Missing env. Run: set -a && source apps/web/.env.local && set +a");
  process.exit(1);
}

const opts = parseArgs(process.argv.slice(2));
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
const set = JSON.parse(readFileSync(SET_PATH, "utf8"));
const cases = loadGoldenSet(set, { tier: opts.tier, limit: opts.limit, intent: opts.intent });

// Fetch all knowledge chunks for the shop, scoped explicitly by shop_id.
const { data: rows, error } = await supabase
  .from("agent_knowledge")
  .select("id, content, source_type, metadata")
  .eq("shop_id", opts.shop)
  .neq("source_type", "ticket");
if (error) {
  console.error("agent_knowledge fetch failed:", error.message);
  process.exit(1);
}

// Collapse chunks into distinct snippets by identity (source_id || title).
const snippets = new Map();
for (const r of rows || []) {
  const meta = r.metadata && typeof r.metadata === "object" ? r.metadata : {};
  const title = String(meta.title || meta.name || meta.label || "").trim();
  const identity = String(meta.source_id ?? title).trim().toLowerCase();
  if (!identity) continue;
  if (!snippets.has(identity)) {
    snippets.set(identity, {
      identity,
      title: title || "(untitled)",
      question: meta.question ? String(meta.question) : null,
      text: String(r.content || "").slice(0, 600),
    });
  }
}
const snippetList = [...snippets.values()];
console.log(`Loaded ${snippetList.length} distinct snippets for shop ${opts.shop}`);

const catalog = snippetList
  .map((s, i) =>
    `#${i + 1} [id: ${s.identity}]\nTitle: ${s.title}` +
    (s.question ? `\nQuestion: ${s.question}` : "") +
    `\nExcerpt: ${s.text}`
  )
  .join("\n\n");

const SYSTEM = "You build a retrieval ground-truth set for a customer-support AI. " +
  "Given a customer message and a catalog of knowledge snippets, decide which " +
  "snippet(s) actually ANSWER the customer's specific request — match on meaning, " +
  "across languages. A snippet that is merely the same TOPIC does not count. If NO " +
  "snippet answers the request, return an empty list (this is correct and expected). " +
  "Return only snippet ids exactly as given in [id: ...].";

async function proposeForCase(c) {
  const userPrompt =
    `Customer message:\n${c.body}\n\nSnippet catalog:\n${catalog}\n\n` +
    `Return JSON: {"correct_snippet_ids": string[], "rationale": string}. ` +
    `Use the exact ids from the catalog. Empty array if nothing truly answers it.`;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  const validIds = new Set(snippetList.map((s) => s.identity));
  const ids = (parsed.correct_snippet_ids || [])
    .map((x) => String(x).trim().toLowerCase())
    .filter((x) => validIds.has(x));
  return { ids, rationale: String(parsed.rationale || "") };
}

const labels = [];
for (const c of cases) {
  try {
    const { ids, rationale } = await proposeForCase(c);
    labels.push({
      id: c.id,
      correct_snippet_ids: ids,
      rationale,
      _proposed_by: MODEL,
      _needs_human_review: true,
    });
    console.log(`  [${c.id}] proposed ${ids.length} snippet(s)`);
  } catch (err) {
    labels.push({ id: c.id, correct_snippet_ids: [], rationale: "", _error: err.message });
    console.error(`  [${c.id}] ERROR: ${err.message}`);
  }
}

writeFileSync(
  OUT_PATH,
  JSON.stringify(
    { shop_id: opts.shop, generated_at: new Date().toISOString(), labels },
    null,
    2,
  ),
);
console.log(`\nWrote ${labels.length} draft labels to ${OUT_PATH}. REVIEW BY HUMAN before use.`);
```

- [ ] **Step 2: Run the script (smoke, 3 cases)**

Run:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/build-gold-labels.mjs --limit 3
```
Expected: prints "Loaded N distinct snippets", three `[g-xxx] proposed K snippet(s)` lines, and writes `supabase/eval/gold-labels.acezone.json`. No crash.

- [ ] **Step 3: Run the full set**

Run: `node supabase/scripts/build-gold-labels.mjs`
Expected: 44 draft labels written. (Do NOT commit yet — human review is Task 3.)

---

### Task 3: Human review of gold-labels (HUMAN — not the agent)

**Files:**
- Modify: `supabase/eval/gold-labels.acezone.json`

> **STOP — hand this to the user.** This is a human judgment task. The agent must NOT invent ground truth.

- [ ] **Step 1:** The user opens `supabase/eval/gold-labels.acezone.json` and, for each case, corrects `correct_snippet_ids` against their knowledge of the shop. Key cases to scrutinise: **g-020** (dongle purchase — should be `[]`, no snippet), **g-021** (the "Why can't I change my EQ" snippet should be the correct id). Remove the `_needs_human_review` / `_proposed_by` / `_error` helper keys once reviewed, leaving `{ id, correct_snippet_ids, rationale }`.

- [ ] **Step 2: Commit the reviewed ground truth** (only when the user confirms it is reviewed)

```bash
git add supabase/scripts/build-gold-labels.mjs supabase/eval/gold-labels.acezone.json
git commit -m "feat(eval): gold retrieval labels for AceZone golden set (human-reviewed)"
```

---

### Task 4: Wire retrieval metrics into the runner

**Files:**
- Modify: `apps/web/lib/server/eval-runner.js`
- Modify: `supabase/scripts/run-golden-eval.mjs`

The runner already captures `retrievalDebug` (the selected chunks). The matcher's candidate/ranked detail rides on a new `retrieval_debug.matcher` object (emitted in Task 9). This task wires the eval side so that once the matcher emits, the metrics light up. Until Phase A is deployed, `matcher` is absent and metrics report `n_labeled: 0` gracefully.

- [ ] **Step 1: Surface `matcher_debug` in eval-runner**

In `apps/web/lib/server/eval-runner.js`, find the block (around line 285) that builds `retrievalDebug`:

```js
  const retrievalDebug =
    data?.retrieval_debug && Array.isArray(data.retrieval_debug.chunks)
      ? data.retrieval_debug.chunks
```

Locate the returned object that includes `retrievalDebug` (around line 295) and add a sibling field. Add this just before that return assembles its object:

```js
  const matcherDebug =
    data?.retrieval_debug && data.retrieval_debug.matcher
      ? data.retrieval_debug.matcher
      : null;
```

Then add `matcherDebug,` to the returned object alongside `retrievalDebug,`.

- [ ] **Step 2: Compute + report metrics in run-golden-eval.mjs**

In `supabase/scripts/run-golden-eval.mjs`:

(a) Extend the imports:

```js
import {
  parseArgs, loadGoldenSet, runGates, computeAggregate, diffBaseline, computeCoherence,
  computeRetrievalMetrics, aggregateRetrievalMetrics,
} from "./lib/golden-eval-core.mjs";
```

(b) After `const SET_PATH = ...` / path consts, add:

```js
const GOLD_LABELS_PATH = "supabase/eval/gold-labels.acezone.json";
```

(c) After `const cases = loadGoldenSet(...)`, load the labels into a map:

```js
const goldLabels = readJsonOrNull(GOLD_LABELS_PATH);
const goldById = new Map(
  (goldLabels?.labels || []).map((l) => [l.id, l.correct_snippet_ids || []]),
);
```

(d) Inside the per-case loop, after `const coherence = computeCoherence(...)`, compute the retrieval metric when the case is labeled and the matcher emitted:

```js
    const retrieval = goldById.has(c.id) && gen.matcherDebug
      ? computeRetrievalMetrics(goldById.get(c.id), gen.matcherDebug)
      : null;
```

and add `retrieval,` to the pushed result object.

(e) After `const summary = computeAggregate(results);`, aggregate:

```js
const retrievalAgg = aggregateRetrievalMetrics(
  results.filter((r) => r.status === "scored" && r.retrieval).map((r) => r.retrieval),
);
```

(f) Add a reporting block after the coherence block (around line 112):

```js
if (retrievalAgg.n_labeled > 0) {
  console.log("\n=== Retrieval precision (vs gold-labels) ===");
  console.log({
    n_labeled: retrievalAgg.n_labeled,
    recall_at_k: retrievalAgg.recall_at_k,
    precision_at_1: retrievalAgg.precision_at_1,
    mrr: retrievalAgg.mrr,
    abstention_correct: retrievalAgg.abstention_correct,
    n_abstain_cases: retrievalAgg.n_abstain_cases,
  });
} else {
  console.log("\n(no retrieval metrics — gold-labels missing or matcher not emitting yet)");
}
```

(g) Include it in the written report — change the `writeFileSync(reportPath, ...)` payload to add `retrievalAgg`:

```js
writeFileSync(reportPath, JSON.stringify({ stamp, opts, summary, retrievalAgg, diff, results }, null, 2));
```

- [ ] **Step 3: Run the runner (smoke, 2 cases) to verify no crash**

Run:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/run-golden-eval.mjs --limit 2
```
Expected: runs as before; prints `(no retrieval metrics — gold-labels missing or matcher not emitting yet)` because the matcher isn't deployed yet. No crash.

- [ ] **Step 4: Commit** (only if the user approved committing)

```bash
git add apps/web/lib/server/eval-runner.js supabase/scripts/run-golden-eval.mjs
git commit -m "feat(eval): wire gold-label retrieval metrics into golden runner"
```

---

### Task 5: Establish the baseline (HUMAN-run, measurement)

**Files:** none changed (produces a report under `supabase/eval/runs/`).

> Run BEFORE Phase A is deployed so A's lift is measured against a real baseline. Per spec the matcher isn't live yet, so retrieval metrics will be empty here — that's fine; the purpose is to snapshot the current judge/coherence numbers as the "before" picture.

- [ ] **Step 1: Run the full golden set against the current deployed pipeline**

Run:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/run-golden-eval.mjs
```
Expected: full aggregate + coherence printed; report written to `supabase/eval/runs/<stamp>.json`. Note the report path and the aggregate numbers — this is the baseline the agent compares against after Phase A.

---

## Phase A — Snippet-matcher (precision + abstention) and Phase B cleanup

### Task 6: Add `question` to the retrieved chunk

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever.ts`

The matcher weights the snippet's free-text question highest, so chunks must carry it. There is no Deno unit test for the type alone; it is covered by the matcher integration and verified by `deno check`.

- [ ] **Step 1: Add the field to `RetrievedChunk`**

In `supabase/functions/generate-draft-v2/stages/retriever.ts`, in the `RetrievedChunk` interface (ends at line 52, after `vector_similarity?`), add:

```ts
  // The snippet's free-text customer question (metadata.question), when this
  // chunk came from a Q&A snippet. The snippet-matcher weights this highest —
  // it is a more specific, cross-lingual discriminator than any tag. null for
  // non-Q&A chunks (Shopify product descriptions, manuals, policies).
  question?: string | null;
```

- [ ] **Step 2: Populate it in the `base` object**

In the `scoredChunks` map (the `base` object literal at lines 766-779), add after `vector_similarity: r.vectorSimilarity,`:

```ts
        question: typeof meta.question === "string" ? meta.question : null,
```

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/generate-draft-v2/stages/retriever.ts`
Expected: no type errors.

- [ ] **Step 4: Commit** (only if the user approved committing)

```bash
git add supabase/functions/generate-draft-v2/stages/retriever.ts
git commit -m "feat(retriever): carry snippet question through to chunks for matcher"
```

---

### Task 7: The snippet-matcher module (TDD, stubbed LLM)

**Files:**
- Create: `supabase/functions/generate-draft-v2/stages/snippet-matcher.ts`
- Test: `supabase/functions/generate-draft-v2/stages/snippet-matcher.test.ts`

The module does the LLM call (injectable for tests) AND applies the selection rules, returning `{ selected, ranked, abstained }`. The retriever (Task 8) handles error-fallback — the module just throws on LLM failure.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/generate-draft-v2/stages/snippet-matcher.test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  matchSnippets,
  selectFromRanked,
  type MatchCandidate,
} from "./snippet-matcher.ts";

const OPTS = { model: "gpt-4o-mini", threshold: 0.6, maxSelected: 2, marginMin: 0.15 };

const cands: MatchCandidate[] = [
  { id: "c1", question: "Why can't I change my EQ?", title: "EQ", excerpt: "..." },
  { id: "c2", question: "How do I pair the headset?", title: "Pairing", excerpt: "..." },
];

function stub(rankings: Array<{ id: string; relevance: number; reason?: string }>) {
  // deno-lint-ignore no-explicit-any
  return (_args: any) => Promise.resolve({ rankings } as any);
}

Deno.test("selectFromRanked: single clear winner above threshold", () => {
  const ranked = [
    { id: "c1", relevance: 0.9, reason: "" },
    { id: "c2", relevance: 0.3, reason: "" },
  ];
  const r = selectFromRanked(ranked, OPTS);
  assertEquals(r.abstained, false);
  assertEquals(r.selected.map((s) => s.id), ["c1"]);
});

Deno.test("selectFromRanked: two winners within margin → both up to budget", () => {
  const ranked = [
    { id: "c1", relevance: 0.85, reason: "" },
    { id: "c2", relevance: 0.78, reason: "" },
  ];
  const r = selectFromRanked(ranked, OPTS);
  assertEquals(r.selected.map((s) => s.id), ["c1", "c2"]);
});

Deno.test("selectFromRanked: #1 clears margin over #2 → only #1", () => {
  const ranked = [
    { id: "c1", relevance: 0.85, reason: "" },
    { id: "c2", relevance: 0.65, reason: "" },
  ];
  const r = selectFromRanked(ranked, OPTS);
  assertEquals(r.selected.map((s) => s.id), ["c1"]);
});

Deno.test("selectFromRanked: budget caps multi-select", () => {
  const ranked = [
    { id: "c1", relevance: 0.9, reason: "" },
    { id: "c2", relevance: 0.88, reason: "" },
    { id: "c3", relevance: 0.86, reason: "" },
  ];
  const r = selectFromRanked(ranked, { ...OPTS, maxSelected: 2 });
  assertEquals(r.selected.map((s) => s.id), ["c1", "c2"]);
});

Deno.test("selectFromRanked: none above threshold → abstain", () => {
  const ranked = [
    { id: "c1", relevance: 0.5, reason: "" },
    { id: "c2", relevance: 0.2, reason: "" },
  ];
  const r = selectFromRanked(ranked, OPTS);
  assertEquals(r.abstained, true);
  assertEquals(r.selected.length, 0);
});

Deno.test("matchSnippets: empty candidates → abstain, no LLM call", async () => {
  let called = false;
  const r = await matchSnippets("hi", [], OPTS, {
    // deno-lint-ignore no-explicit-any
    callJson: ((_a: any) => { called = true; return Promise.resolve({ rankings: [] } as any); }),
  });
  assertEquals(called, false);
  assertEquals(r.abstained, true);
  assertEquals(r.ranked.length, 0);
});

Deno.test("matchSnippets: selects winner from stubbed ranking", async () => {
  const r = await matchSnippets("Why won't my EQ change?", cands, OPTS, {
    callJson: stub([
      { id: "c1", relevance: 0.9, reason: "answers EQ" },
      { id: "c2", relevance: 0.2, reason: "pairing, unrelated" },
    ]),
  });
  assertEquals(r.abstained, false);
  assertEquals(r.selected.map((s) => s.id), ["c1"]);
  assertEquals(r.ranked.length, 2);
});

Deno.test("matchSnippets: topical-but-wrong single candidate → abstain (g-020)", async () => {
  const one: MatchCandidate[] = [
    { id: "c9", question: "How do I pair my mic?", title: "Mic pairing", excerpt: "..." },
  ];
  const r = await matchSnippets("I want to buy a replacement dongle", one, OPTS, {
    callJson: stub([{ id: "c9", relevance: 0.35, reason: "same topic, not the request" }]),
  });
  assertEquals(r.abstained, true);
  assertEquals(r.selected.length, 0);
});

Deno.test("matchSnippets: drops hallucinated ids not in candidates", async () => {
  const r = await matchSnippets("test", cands, OPTS, {
    callJson: stub([
      { id: "ghost", relevance: 0.95, reason: "not real" },
      { id: "c1", relevance: 0.8, reason: "real" },
    ]),
  });
  assertEquals(r.ranked.map((x) => x.id), ["c1"]);
  assertEquals(r.selected.map((s) => s.id), ["c1"]);
});

Deno.test("matchSnippets: clamps out-of-range relevance", async () => {
  const r = await matchSnippets("test", cands, OPTS, {
    callJson: stub([
      { id: "c1", relevance: 1.7, reason: "" },
      { id: "c2", relevance: -0.4, reason: "" },
    ]),
  });
  assertEquals(r.ranked.find((x) => x.id === "c1")?.relevance, 1);
  assertEquals(r.ranked.find((x) => x.id === "c2")?.relevance, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test supabase/functions/generate-draft-v2/stages/snippet-matcher.test.ts`
Expected: FAIL — module `./snippet-matcher.ts` not found.

- [ ] **Step 3: Implement the module**

Create `supabase/functions/generate-draft-v2/stages/snippet-matcher.ts`:

```ts
// supabase/functions/generate-draft-v2/stages/snippet-matcher.ts
//
// Cross-lingual LLM precision layer. Given the customer message and a broad
// candidate pool from hybrid retrieval, an LLM (gpt-4o-mini) ranks each
// candidate by how well it ANSWERS the customer's actual request — matching on
// meaning across languages, not topic. Threshold/margin/budget rules then
// select the winner(s) or abstain (zero chunks).
//
// Two jobs, both required:
//   1. Select among many (tiebreak) — relevant at >=2 candidates.
//   2. Reject a topical-but-wrong single candidate (relevance-gate) — relevant
//      even at exactly 1 candidate. So the call is NOT gated on >=2; it is only
//      skipped when there are 0 candidates.
//
// Pure module: no retrieval logic. The LLM call is injectable so unit tests run
// deterministically against stubbed rankings with no live API.
import { callOpenAIJson, type JsonSchema } from "./openai-json.ts";

export type MatchCandidate = {
  id: string;
  question: string | null;
  title: string;
  excerpt: string;
};

export type MatchResult = { id: string; relevance: number; reason: string };

export type MatchOptions = {
  model: string;
  threshold: number;
  maxSelected: number;
  marginMin: number;
};

export type MatchResponse = {
  selected: MatchResult[];
  ranked: MatchResult[];
  abstained: boolean;
};

type CallJson = typeof callOpenAIJson;

const SYSTEM_PROMPT =
  "You decide which knowledge snippet(s) actually answer the customer's " +
  "question. Match on MEANING ACROSS LANGUAGES — the customer may write Danish " +
  "or Spanish while the snippet is English. A snippet matches only if it answers " +
  "the customer's ACTUAL request, not merely the same topic. If none answers it, " +
  "return an empty list. Score each candidate 0-1 for how well it answers the " +
  "request (1 = directly answers, 0 = unrelated).";

const RANKING_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rankings"],
  properties: {
    rankings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "relevance", "reason"],
        properties: {
          id: { type: "string" },
          relevance: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
  },
};

export function buildUserPrompt(
  customerMessage: string,
  candidates: MatchCandidate[],
): string {
  const blocks = candidates.map((c, i) => {
    const lines = [`#${i + 1} [id: ${c.id}]`];
    if (c.question) lines.push(`Question: ${c.question}`);
    lines.push(`Title: ${c.title}`);
    lines.push(`Excerpt: ${c.excerpt.slice(0, 500)}`);
    return lines.join("\n");
  });
  return (
    `Customer message:\n${customerMessage}\n\n` +
    `Candidates (Question is the strongest signal, then Title, then Excerpt):\n` +
    `${blocks.join("\n\n")}\n\n` +
    `Return JSON {"rankings":[{"id","relevance","reason"}]} with one entry per ` +
    `candidate, using the exact ids above.`
  );
}

// Selection rules (spec): only candidates at/above threshold are selectable;
// if #1 clears #2 by marginMin (or #2 is below threshold) take only #1; else
// take the above-threshold winners up to maxSelected; none above → abstain.
export function selectFromRanked(
  ranked: MatchResult[],
  opts: MatchOptions,
): { selected: MatchResult[]; abstained: boolean } {
  const eligible = ranked
    .filter((r) => r.relevance >= opts.threshold)
    .sort((a, b) => b.relevance - a.relevance);
  if (eligible.length === 0) return { selected: [], abstained: true };
  if (
    eligible.length === 1 ||
    eligible[0].relevance - eligible[1].relevance >= opts.marginMin
  ) {
    return { selected: [eligible[0]], abstained: false };
  }
  return { selected: eligible.slice(0, opts.maxSelected), abstained: false };
}

export async function matchSnippets(
  customerMessage: string,
  candidates: MatchCandidate[],
  opts: MatchOptions,
  deps: { callJson?: CallJson } = {},
): Promise<MatchResponse> {
  if (candidates.length === 0) {
    return { selected: [], ranked: [], abstained: true };
  }
  const callJson = deps.callJson ?? callOpenAIJson;
  const raw = await callJson<{ rankings: MatchResult[] }>({
    model: opts.model,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(customerMessage, candidates),
    maxTokens: 800,
    schema: RANKING_SCHEMA,
    schemaName: "snippet_rankings",
    temperature: 0,
  });
  const validIds = new Set(candidates.map((c) => c.id));
  const ranked: MatchResult[] = (raw?.rankings ?? [])
    .filter((r) => r && validIds.has(r.id) && typeof r.relevance === "number")
    .map((r) => ({
      id: r.id,
      relevance: Math.max(0, Math.min(1, r.relevance)),
      reason: String(r.reason ?? ""),
    }))
    .sort((a, b) => b.relevance - a.relevance);
  const { selected, abstained } = selectFromRanked(ranked, opts);
  return { selected, ranked, abstained };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test supabase/functions/generate-draft-v2/stages/snippet-matcher.test.ts`
Expected: PASS — all matcher tests green.

- [ ] **Step 5: Commit** (only if the user approved committing)

```bash
git add supabase/functions/generate-draft-v2/stages/snippet-matcher.ts supabase/functions/generate-draft-v2/stages/snippet-matcher.test.ts
git commit -m "feat(matcher): cross-lingual snippet-matcher with threshold/margin selection"
```

---

### Task 8: Wire the matcher into the retriever (remove override + tiebreak, emit debug, fallback)

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever.ts`
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts`

The matcher re-ranks a broad pool and selects; on any failure the retriever keeps today's `regularChunks`. The lexical Q&A title-match override (877-912) and issue-tiebreak (916-925) are removed — the matcher replaces both.

- [ ] **Step 1: Import the matcher and extend the result type**

In `retriever.ts`, add to the imports near the top (after the `retriever-coherence.ts` import block, lines 5-11):

```ts
import { matchSnippets, type MatchCandidate } from "./snippet-matcher.ts";
```

Extend `RetrieverResult` (lines 54-64) with an optional debug field:

```ts
export interface RetrieverResult {
  chunks: RetrievedChunk[];
  past_ticket_examples: Array<{
    customer_msg: string;
    agent_reply: string;
    subject: string | null;
    score: number;
    csat_score: number | null;
    conversation_context: string | null;
  }>;
  // Eval-only observability for retrieval-precision metrics. Populated by the
  // matcher step; consumed by the golden runner. Omitted in production.
  matcher_debug?: {
    candidates: Array<{ id: string; source_id: string | null; title: string }>;
    ranked: Array<{ id: string; source_id: string | null; title: string; relevance: number }>;
    selected_ids: string[];
    abstained: boolean;
    fell_back: boolean;
  };
}
```

- [ ] **Step 2: Remove the lexical override and issue-tiebreak blocks**

Delete the entire Q&A title-match override block (lines 864-912, from the `// ---- Q&A title-match override ----` comment through its closing `}`) and the issue-tiebreak block (lines 914-925, from `// Mechanism 2b:` through its closing `}`). Leave the absolute-floor block (927-938) intact.

- [ ] **Step 3: Insert the matcher step after `regularChunks` (and after the abs-floor block)**

Immediately before the `// Past ticket examples` comment (currently line 940), insert:

```ts
  // ---- Snippet-matcher: cross-lingual precision + abstention ----
  // Re-rank a broad candidate pool against the customer message with an LLM and
  // select the winner(s) — or abstain (zero chunks) when nothing truly answers
  // the request. Replaces the old lexical title-match override + issue-tiebreak.
  // Never blocks a draft: on any failure we fall back to regularChunks (today's
  // behaviour). matcher_debug is for eval only.
  const MATCH_POOL_SIZE = 15;
  const pool = consolidated
    .reduce((acc: RetrievedChunk[], chunk) => {
      const dup = acc.some((k) => tokenOverlapJaccard(k.content, chunk.content) >= 0.6);
      return dup ? acc : [...acc, chunk];
    }, [])
    .slice(0, MATCH_POOL_SIZE);

  let finalChunks = regularChunks;
  let matcherDebug: RetrieverResult["matcher_debug"] | undefined;

  if (customerMessage && pool.length > 0) {
    const byId = new Map(pool.map((c) => [c.id, c]));
    const candidates: MatchCandidate[] = pool.map((c) => ({
      id: c.id,
      question: c.question ?? null,
      title: c.source_label,
      excerpt: c.content,
    }));
    try {
      const matched = await matchSnippets(customerMessage, candidates, {
        model: SNIPPET_MATCHER_MODEL,
        threshold: SNIPPET_MATCHER_THRESHOLD,
        maxSelected: knowledgeBudget,
        marginMin: SNIPPET_MATCHER_MARGIN,
      });
      finalChunks = matched.selected
        .map((s) => byId.get(s.id))
        .filter((c): c is RetrievedChunk => Boolean(c));
      console.log(
        `[retriever] snippet-matcher selected=${finalChunks.length} abstained=${matched.abstained} pool=${pool.length}`,
      );
      matcherDebug = {
        candidates: pool.map((c) => ({ id: c.id, source_id: c.source_id ?? null, title: c.source_label })),
        ranked: matched.ranked.map((r) => {
          const c = byId.get(r.id);
          return { id: r.id, source_id: c?.source_id ?? null, title: c?.source_label ?? "", relevance: r.relevance };
        }),
        selected_ids: finalChunks.map((c) => c.id),
        abstained: matched.abstained,
        fell_back: false,
      };
    } catch (err) {
      // Additive layer: never make things worse than today. Keep regularChunks.
      console.error(`[retriever] snippet-matcher failed, falling back to top-chunks: ${(err as Error).message}`);
      try {
        await supabase.from("agent_logs").insert({
          shop_id,
          workspace_id: workspace_id ?? null,
          step: "snippet_matcher_fallback",
          step_detail: { error: (err as Error).message, pool_size: pool.length },
        });
      } catch (_logErr) {
        // logging must never block a draft
      }
      finalChunks = regularChunks;
      matcherDebug = {
        candidates: pool.map((c) => ({ id: c.id, source_id: c.source_id ?? null, title: c.source_label })),
        ranked: regularChunks.map((c) => ({ id: c.id, source_id: c.source_id ?? null, title: c.source_label, relevance: 0 })),
        selected_ids: regularChunks.map((c) => c.id),
        abstained: false,
        fell_back: true,
      };
    }
  }
```

- [ ] **Step 4: Add the matcher config constants**

Near the top of `retriever.ts` (after the imports, before the first function), add:

```ts
// Snippet-matcher config. Thresholds are starting values calibrated against the
// retrieval-eval (E); adjust only against measured aggregates, never single cases.
const SNIPPET_MATCHER_MODEL = "gpt-4o-mini";
const SNIPPET_MATCHER_THRESHOLD = 0.6;
const SNIPPET_MATCHER_MARGIN = 0.15;
```

- [ ] **Step 5: Return `finalChunks` and `matcher_debug`**

Change the final return (currently lines 958-961) from `chunks: regularChunks` to use `finalChunks`, and pass the debug:

```ts
  return {
    chunks: finalChunks,
    past_ticket_examples: pastTicketExamples,
    ...(matcherDebug ? { matcher_debug: matcherDebug } : {}),
  };
```

Also update the `console.log` summary line (952-956) to log `finalChunks.length` instead of `regularChunks.length`:

```ts
  console.log(
    `[retriever] queries=${queries.length} knowledge=${finalChunks.length} saved_reply_knowledge=${
      finalChunks.filter((chunk) => chunk.usable_as === "saved_reply").length
    } past_tickets=${pastTicketExamples.length}`,
  );
```

- [ ] **Step 6: Emit `matcher` under `retrieval_debug` in the pipeline**

In `pipeline.ts`, the eval-gated `retrieval_debug` block (lines 1685-1703) currently emits only `chunks`. The retriever result is `retrieved` (the variable holding `runRetriever`'s output). Add the matcher debug alongside `chunks`:

```ts
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
            vector_similarity: c.vector_similarity ?? null,
            kind: c.kind,
            usable_as: c.usable_as,
            products: c.products ?? [],
            issue_types: c.chunk_issue_types,
          })),
          ...(retrieved.matcher_debug ? { matcher: retrieved.matcher_debug } : {}),
        },
      }
      : {}),
```

- [ ] **Step 7: Type-check the function**

Run: `deno check supabase/functions/generate-draft-v2/pipeline.ts`
Expected: no type errors (this checks the retriever + matcher modules transitively).

- [ ] **Step 8: Re-run the matcher unit tests (guard against signature drift)**

Run: `deno test supabase/functions/generate-draft-v2/stages/snippet-matcher.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit** (only if the user approved committing)

```bash
git add supabase/functions/generate-draft-v2/stages/retriever.ts supabase/functions/generate-draft-v2/pipeline.ts
git commit -m "feat(retriever): snippet-matcher precision step, replace lexical override + tiebreak"
```

---

### Task 9: Phase B — query cleanup in `buildFallbackQueries`

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever.ts`

Now that the matcher controls final selection, the keyword-bag/token-bag queries only pollute the candidate pool. Remove the raw token-bag and the generic issue+product keyword-bag so the pool is cleaner. Keep the targeted, intent-specific queries that add genuine recall.

- [ ] **Step 1: Remove the keyword-bag and token-bag query lines**

In `buildFallbackQueries` (lines 258-291), delete these two pollution sources:

- The generic product+issue keyword-bag (lines 271-273):
```ts
  if (products.length || issues.length) {
    queries.push([...products.slice(0, 2), ...issues.slice(0, 3)].join(" "));
  }
```
- The raw token-bag (line 288):
```ts
  if (tokens.length) queries.push(tokens.join(" "));
```

Also remove the now-unused `tokens` binding (line 268, `const tokens = tokenize(text).slice(0, 18);`) to keep `deno check` clean. Keep the `ear_pads`, `product_question`, and complaint/exchange/refund targeted queries — those are intent-specific recall, not pollution.

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/generate-draft-v2/stages/retriever.ts`
Expected: no type errors, no unused-variable complaints.

- [ ] **Step 3: Commit** (only if the user approved committing)

```bash
git add supabase/functions/generate-draft-v2/stages/retriever.ts
git commit -m "refactor(retriever): drop keyword-bag/token-bag fallback queries (matcher owns selection)"
```

---

### Task 10: Deploy, measure A vs baseline, calibrate (HUMAN-run)

**Files:** none changed (may tune the three constants in `retriever.ts`).

- [ ] **Step 1: Deploy**

Run: `npx supabase functions deploy generate-draft-v2`
Expected: deploy succeeds.

- [ ] **Step 2: Smoke two cases including g-020 and g-021**

Run:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/run-golden-eval.mjs --limit 2
```
Expected: the `=== Retrieval precision (vs gold-labels) ===` block now prints non-zero `n_labeled`.

- [ ] **Step 3: Full run and compare to baseline**

Run: `node supabase/scripts/run-golden-eval.mjs`
Expected: a new report under `supabase/eval/runs/`. Compare against the Task 5 baseline:
- **Recall@K must hold** (the B-cleanup must not drop correct snippets out of the pool).
- **Precision@1 / MRR must rise.**
- **Abstention-correctness:** g-020 must flip from a junk answer to a correct abstention.
- **judge overall_10 must hold or rise.**

- [ ] **Step 4: Calibrate thresholds against aggregates (not single cases)**

If Precision@1 is low because correct snippets sit just under threshold, or abstention is too eager/too shy, adjust `SNIPPET_MATCHER_THRESHOLD` (start 0.6) and `SNIPPET_MATCHER_MARGIN` (start 0.15) in `retriever.ts`, redeploy, and re-run. Change one knob at a time; judge variance is ±1-2 per case, so move only on aggregate shifts. Commit any constant change (only if the user approved committing):

```bash
git add supabase/functions/generate-draft-v2/stages/retriever.ts
git commit -m "tune(matcher): calibrate threshold/margin against retrieval-eval"
```

---

### Task 11: Re-baseline (HUMAN-run, once numbers are good)

**Files:** modifies `supabase/eval/golden-baseline.acezone.json`.

- [ ] **Step 1: Accept the new numbers as the baseline**

Run:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/run-golden-eval.mjs --accept
```
Expected: `Baseline updated: supabase/eval/golden-baseline.acezone.json`.

- [ ] **Step 2: Commit the new baseline** (only if the user approved committing)

```bash
git add supabase/eval/golden-baseline.acezone.json
git commit -m "chore(eval): re-baseline after snippet-matcher precision rollout"
```

---

## Out of scope (separate specs later — do not build here)

- **C** — Abstention *behaviour* (what the writer does on zero chunks). This plan delivers only the *mechanism* (zero chunks); downstream behaviour is unchanged.
- **D** — Past-tickets-as-answer tier (`ticket_examples` promoted to a trust-ranked answer source).
- **Embedding-tier cascade** — free embedding pre-filter to skip the LLM call on clear matches. Build only if volume demands it.

## Self-review notes (already applied)

- **Spec coverage:** E (Tasks 1-5), A (Tasks 6-8, 10-11), B (Task 9) all mapped; matcher contract, selection rules, error-fallback, agent_logs, gold-labels, three metrics, baseline + re-baseline all present.
- **Type consistency:** `MatchCandidate` / `MatchResult` / `MatchOptions` / `MatchResponse` defined in Task 7 and used unchanged in Task 8; `matcher_debug` shape defined in Task 8 (retriever) matches what `computeRetrievalMetrics` consumes in Task 1 (`candidates`/`ranked`/`selected_ids`/`abstained`, identity = `source_id`||`title`).
- **No placeholders:** every code step is concrete.
