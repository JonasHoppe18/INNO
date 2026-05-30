# Golden Eval Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable, versioned golden eval set for `generate-draft-v2` (AceZone) that runs the same curated cases repeatedly, scores them with the existing LLM judge, enforces hard gates on critical edge cases, and reports lift/regression against a committed baseline.

**Architecture:** A thin CLI runner (`run-golden-eval.mjs`) orchestrates the existing eval machinery (`generateDraftV2` + `judgeWithOpenAI` + `draftForJudge`, imported from `apps/web/lib/server/eval-runner.js`). All pure logic (arg parsing, case validation, gate checks, aggregate, baseline diff) lives in a separate, unit-tested core module (`lib/golden-eval-core.mjs`). The golden set and baseline are committed JSON; per-run reports are gitignored.

**Tech Stack:** Node 20 (global `fetch`, ESM `.mjs`), `node:test` + `node:assert` (zero-dependency test runner), Supabase PostgREST for data sampling, OpenAI (via the reused eval-runner functions).

---

## Background the engineer needs

- The repo is a monorepo. Run all commands from the repo root `/Users/jonashoppe/Developer/INNO`.
- Env loading for scripts: `set -a && source apps/web/.env.local && set +a` before running any `node` command that needs Supabase/OpenAI keys.
- `apps/web/package.json` has no `"type": "module"`, but `eval-runner.js` uses ESM `export {}`. Importing it from a `.mjs` file works — Node reparses it as ESM (emits a harmless `MODULE_TYPELESS_PACKAGE_JSON` warning). This has been verified.
- `generateDraftV2(shopId, subject, body, options)` calls the **deployed** edge function at `${SUPABASE_URL}/functions/v1/generate-draft-v2`. So the runner measures whatever is currently deployed — local writer/prompt changes must be deployed (`npx supabase functions deploy generate-draft-v2`) before they show up in scores.
- `generateDraftV2` returns `{ draft, actions, confidence, sources, routingHint, latencyMs }`. `options.sourceThreadId` excludes a thread from few-shot retrieval (prevents leakage).
- `judgeWithOpenAI(ticketBody, draftContent, humanReply, judgeModel)` returns `{ correctness, completeness, tone, actionability, overall (all 1-5), overall_10 (1-10), send_ready, primary_gap, missing_for_10, likely_root_cause, reasoning }`.
- `draftForJudge(draftContent, actions)` returns the draft, or a synthetic "pipeline paused for action approval" string when the draft is empty but actions exist.
- AceZone shop_id: `38df5fef-2a23-47f3-803e-39f2d6f1ed99`.
- Scale convention for this feature: sub-dimensions (`correctness/completeness/tone/actionability`) are **1-5**; `overall_10` is **1-10**; `per_case` baseline stores `overall_10`.

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `supabase/scripts/lib/golden-eval-core.mjs` | Create | Pure functions: arg parse, case validation, action-type extraction, gate checks, aggregate, baseline diff. No I/O. |
| `supabase/scripts/lib/golden-eval-core.test.mjs` | Create | `node:test` unit tests for every core function. |
| `supabase/scripts/build-golden-candidates.mjs` | Create | One-off helper: stratified sample of `ticket_examples` → draft candidates JSON for manual curation. Not on the run path. |
| `supabase/scripts/run-golden-eval.mjs` | Create | CLI orchestration: load set → generate → judge → gate → aggregate → diff → write report. |
| `supabase/eval/golden-set.acezone.json` | Create | The curated cases (historical + edge). |
| `supabase/eval/golden-baseline.acezone.json` | Create (via `--accept`) | Accepted baseline aggregate. |
| `supabase/eval/runs/` | Create (gitignored) | Per-run reports. |
| `.gitignore` | Modify | Ignore `supabase/eval/runs/`. |

The case format adds one field beyond the spec: an optional `intent` string per case (used for the `per_intent` aggregate). The build helper populates it from `ticket_examples.intent`.

---

## Task 1: Core module scaffold + arg parsing (TDD)

**Files:**
- Create: `supabase/scripts/lib/golden-eval-core.mjs`
- Test: `supabase/scripts/lib/golden-eval-core.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// supabase/scripts/lib/golden-eval-core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./golden-eval-core.mjs";

test("parseArgs: defaults", () => {
  const a = parseArgs([]);
  assert.equal(a.shop, "38df5fef-2a23-47f3-803e-39f2d6f1ed99");
  assert.equal(a.tier, null);
  assert.equal(a.limit, null);
  assert.equal(a.accept, false);
});

test("parseArgs: flags", () => {
  const a = parseArgs(["--shop", "abc", "--tier", "edge", "--limit", "5", "--accept"]);
  assert.equal(a.shop, "abc");
  assert.equal(a.tier, "edge");
  assert.equal(a.limit, 5);
  assert.equal(a.accept, true);
});

test("parseArgs: rejects bad tier", () => {
  assert.throws(() => parseArgs(["--tier", "bogus"]), /tier must be/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: FAIL — `Cannot find module './golden-eval-core.mjs'` (or `parseArgs is not a function`).

- [ ] **Step 3: Write minimal implementation**

```js
// supabase/scripts/lib/golden-eval-core.mjs
export const ACEZONE_SHOP_ID = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";

export function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : null;
  };
  const tier = val("--tier");
  if (tier !== null && tier !== "historical" && tier !== "edge") {
    throw new Error('tier must be "historical" or "edge"');
  }
  const limitRaw = val("--limit");
  return {
    shop: val("--shop") || ACEZONE_SHOP_ID,
    tier,
    limit: limitRaw !== null ? parseInt(limitRaw, 10) : null,
    accept: has("--accept"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/scripts/lib/golden-eval-core.mjs supabase/scripts/lib/golden-eval-core.test.mjs
git commit -m "Add golden-eval core: arg parsing"
```

---

## Task 2: Case validation (TDD)

**Files:**
- Modify: `supabase/scripts/lib/golden-eval-core.mjs`
- Test: `supabase/scripts/lib/golden-eval-core.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```js
import { validateCase, loadGoldenSet } from "./golden-eval-core.mjs";

const histCase = {
  id: "g-001", tier: "historical", subject: "s", body: "b",
  source_thread_id: "tid-1", human_reply: "r", language: "da", intent: "complaint",
};
const edgeCase = {
  id: "e-001", tier: "edge", subject: "s", body: "b",
  source_thread_id: null, human_reply: "r", language: "en",
  expected_action: "none", must_contain: ["photo"], must_not_contain: ["Bob"],
};

test("validateCase: accepts valid historical", () => {
  assert.deepEqual(validateCase(histCase).id, "g-001");
});

test("validateCase: accepts valid edge", () => {
  assert.deepEqual(validateCase(edgeCase).id, "e-001");
});

test("validateCase: requires id/body/human_reply", () => {
  assert.throws(() => validateCase({ ...histCase, body: "" }), /body/);
  assert.throws(() => validateCase({ ...histCase, human_reply: "" }), /human_reply/);
});

test("validateCase: historical requires source_thread_id", () => {
  assert.throws(() => validateCase({ ...histCase, source_thread_id: null }), /source_thread_id/);
});

test("validateCase: edge must have null source_thread_id", () => {
  assert.throws(() => validateCase({ ...edgeCase, source_thread_id: "x" }), /source_thread_id/);
});

test("loadGoldenSet: filters by tier and limit", () => {
  const set = { shop_id: "s", cases: [histCase, edgeCase] };
  assert.equal(loadGoldenSet(set, { tier: "edge", limit: null }).length, 1);
  assert.equal(loadGoldenSet(set, { tier: null, limit: 1 }).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: FAIL — `validateCase is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `golden-eval-core.mjs`)

```js
export function validateCase(c) {
  if (!c || typeof c !== "object") throw new Error("case must be an object");
  for (const f of ["id", "body", "human_reply"]) {
    if (!String(c[f] || "").trim()) throw new Error(`case ${c?.id || "?"}: missing ${f}`);
  }
  if (c.tier !== "historical" && c.tier !== "edge") {
    throw new Error(`case ${c.id}: tier must be "historical" or "edge"`);
  }
  if (c.tier === "historical" && !String(c.source_thread_id || "").trim()) {
    throw new Error(`case ${c.id}: historical case requires source_thread_id`);
  }
  if (c.tier === "edge" && c.source_thread_id != null) {
    throw new Error(`case ${c.id}: edge case must have null source_thread_id`);
  }
  return c;
}

export function loadGoldenSet(set, { tier = null, limit = null } = {}) {
  if (!set || !Array.isArray(set.cases)) throw new Error("golden set must have a cases array");
  let cases = set.cases.map(validateCase);
  if (tier) cases = cases.filter((c) => c.tier === tier);
  if (limit) cases = cases.slice(0, limit);
  return cases;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/scripts/lib/golden-eval-core.mjs supabase/scripts/lib/golden-eval-core.test.mjs
git commit -m "Add golden-eval core: case validation + set loader"
```

---

## Task 3: Action-type extraction + gate checks (TDD)

**Files:**
- Modify: `supabase/scripts/lib/golden-eval-core.mjs`
- Test: `supabase/scripts/lib/golden-eval-core.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```js
import { extractActionTypes, runGates } from "./golden-eval-core.mjs";

test("extractActionTypes: reads type/action_type/kind", () => {
  assert.deepEqual(
    extractActionTypes([{ type: "return" }, { action_type: "exchange" }, { kind: "refund" }]),
    ["return", "exchange", "refund"]
  );
  assert.deepEqual(extractActionTypes([]), []);
  assert.deepEqual(extractActionTypes(null), []);
});

const edge = {
  id: "e-001", tier: "edge",
  expected_action: "return", must_contain: ["photo", "30-day"], must_not_contain: ["Bob"],
};

test("runGates: passes when all conditions met", () => {
  const g = runGates("Please send a Photo so we can start the 30-DAY return.", [{ type: "return" }], edge);
  assert.equal(g.passed, true);
  assert.deepEqual(g.failures, []);
});

test("runGates: fails missing must_contain", () => {
  const g = runGates("Send a photo please.", [{ type: "return" }], edge);
  assert.equal(g.passed, false);
  assert.match(g.failures.join("|"), /must_contain.*30-day/i);
});

test("runGates: fails on must_not_contain", () => {
  const g = runGates("Photo, 30-day, hi Bob", [{ type: "return" }], edge);
  assert.equal(g.passed, false);
  assert.match(g.failures.join("|"), /must_not_contain.*Bob/i);
});

test("runGates: expected_action none requires empty actions", () => {
  const c = { id: "e", tier: "edge", expected_action: "none" };
  assert.equal(runGates("hi", [], c).passed, true);
  assert.equal(runGates("hi", [{ type: "return" }], c).passed, false);
});

test("runGates: historical tier has no gates (always passes)", () => {
  const g = runGates("anything", [], { id: "h", tier: "historical" });
  assert.equal(g.passed, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: FAIL — `extractActionTypes is not a function`.

- [ ] **Step 3: Write minimal implementation** (append)

```js
export function extractActionTypes(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((a) => a?.type || a?.action_type || a?.kind || a?.name || null)
    .filter(Boolean);
}

export function runGates(draft, actions, testCase) {
  if (testCase.tier !== "edge") return { passed: true, failures: [] };
  const failures = [];
  const hay = String(draft || "").toLowerCase();

  for (const needle of testCase.must_contain || []) {
    if (!hay.includes(String(needle).toLowerCase())) {
      failures.push(`must_contain missing: "${needle}"`);
    }
  }
  for (const needle of testCase.must_not_contain || []) {
    if (hay.includes(String(needle).toLowerCase())) {
      failures.push(`must_not_contain present: "${needle}"`);
    }
  }
  if (testCase.expected_action != null) {
    const types = extractActionTypes(actions);
    if (testCase.expected_action === "none") {
      if (types.length > 0) failures.push(`expected no action, got: [${types.join(", ")}]`);
    } else if (!types.includes(testCase.expected_action)) {
      failures.push(`expected_action "${testCase.expected_action}" not in [${types.join(", ")}]`);
    }
  }
  return { passed: failures.length === 0, failures };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/scripts/lib/golden-eval-core.mjs supabase/scripts/lib/golden-eval-core.test.mjs
git commit -m "Add golden-eval core: action extraction + edge-case gates"
```

---

## Task 4: Aggregate + baseline diff (TDD)

**Files:**
- Modify: `supabase/scripts/lib/golden-eval-core.mjs`
- Test: `supabase/scripts/lib/golden-eval-core.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```js
import { computeAggregate, diffBaseline } from "./golden-eval-core.mjs";

const results = [
  { id: "g-001", intent: "complaint", status: "scored",
    scores: { correctness: 4, completeness: 4, tone: 5, actionability: 4, overall_10: 8, send_ready: false } },
  { id: "g-002", intent: "return", status: "scored",
    scores: { correctness: 3, completeness: 3, tone: 4, actionability: 3, overall_10: 6, send_ready: true } },
  { id: "g-003", intent: "complaint", status: "failed", error: "boom" },
];

test("computeAggregate: averages only scored, builds per_intent + per_case", () => {
  const a = computeAggregate(results);
  assert.equal(a.n_cases, 2);
  assert.equal(a.aggregate.overall_10, 7);          // (8+6)/2
  assert.equal(a.aggregate.tone, 4.5);              // (5+4)/2
  assert.equal(a.aggregate.send_ready_rate, 0.5);   // 1 of 2
  assert.equal(a.per_intent.complaint, 8);          // only the scored complaint
  assert.equal(a.per_case["g-001"], 8);
});

test("diffBaseline: reports aggregate deltas and regressed cases", () => {
  const current = computeAggregate(results);
  const baseline = { aggregate: { overall_10: 7.5 }, per_case: { "g-001": 9, "g-002": 6 } };
  const d = diffBaseline(current, baseline);
  assert.equal(d.aggregateDeltas.overall_10, -0.5);          // 7 - 7.5
  assert.deepEqual(d.regressedCases.map((r) => r.id), ["g-001"]); // 8 < 9; g-002 8>=6 not regressed
});

test("diffBaseline: null baseline yields no diff", () => {
  const d = diffBaseline(computeAggregate(results), null);
  assert.equal(d.aggregateDeltas, null);
  assert.deepEqual(d.regressedCases, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: FAIL — `computeAggregate is not a function`.

- [ ] **Step 3: Write minimal implementation** (append)

```js
const DIMS = ["correctness", "completeness", "tone", "actionability", "overall_10"];

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function computeAggregate(results) {
  const scored = results.filter((r) => r.status === "scored");
  const aggregate = {};
  for (const dim of DIMS) {
    aggregate[dim] = scored.length
      ? round2(scored.reduce((s, r) => s + (r.scores[dim] || 0), 0) / scored.length)
      : 0;
  }
  aggregate.send_ready_rate = scored.length
    ? round2(scored.filter((r) => r.scores.send_ready).length / scored.length)
    : 0;

  const per_intent = {};
  const byIntent = {};
  for (const r of scored) {
    const k = r.intent || "unknown";
    (byIntent[k] = byIntent[k] || []).push(r.scores.overall_10 || 0);
  }
  for (const [k, arr] of Object.entries(byIntent)) {
    per_intent[k] = round2(arr.reduce((s, v) => s + v, 0) / arr.length);
  }

  const per_case = {};
  for (const r of scored) per_case[r.id] = r.scores.overall_10;

  return { n_cases: scored.length, aggregate, per_intent, per_case };
}

export function diffBaseline(current, baseline) {
  if (!baseline || !baseline.aggregate) {
    return { aggregateDeltas: null, regressedCases: [] };
  }
  const aggregateDeltas = {};
  for (const dim of [...DIMS, "send_ready_rate"]) {
    if (typeof baseline.aggregate[dim] === "number") {
      aggregateDeltas[dim] = round2((current.aggregate[dim] || 0) - baseline.aggregate[dim]);
    }
  }
  const regressedCases = [];
  for (const [id, score] of Object.entries(current.per_case)) {
    const base = baseline.per_case?.[id];
    if (typeof base === "number" && score < base) {
      regressedCases.push({ id, from: base, to: score });
    }
  }
  return { aggregateDeltas, regressedCases };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/scripts/lib/golden-eval-core.mjs supabase/scripts/lib/golden-eval-core.test.mjs
git commit -m "Add golden-eval core: aggregate + baseline diff"
```

---

## Task 5: Gitignore per-run reports

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append ignore rule**

Add this line to `.gitignore` (repo root):

```
supabase/eval/runs/
```

- [ ] **Step 2: Verify**

Run: `mkdir -p supabase/eval/runs && touch supabase/eval/runs/probe.json && git status --porcelain supabase/eval/runs`
Expected: no output (the directory is ignored).

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "Ignore golden-eval per-run reports"
```

---

## Task 6: Stratified candidate builder

**Files:**
- Create: `supabase/scripts/build-golden-candidates.mjs`

This is a convenience helper, not on the run path, so it is not unit-tested — it is verified by running it. It samples `ticket_examples` evenly across intents and writes a candidate file the human then prunes.

- [ ] **Step 1: Write the script**

```js
// supabase/scripts/build-golden-candidates.mjs
//
// Stratified sampler over ticket_examples → draft golden candidates for manual
// curation. NOT on the eval run path. Output is hand-pruned into golden-set.acezone.json.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/build-golden-candidates.mjs --shop 38df5fef-2a23-47f3-803e-39f2d6f1ed99 --per-intent 6 > supabase/eval/_candidates.json
import { ACEZONE_SHOP_ID } from "./lib/golden-eval-core.mjs";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = process.argv.slice(2);
const val = (f, d) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);
const SHOP_ID = val("--shop", ACEZONE_SHOP_ID);
const PER_INTENT = parseInt(val("--per-intent", "6"), 10);

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const headers = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/ticket_examples?shop_id=eq.${SHOP_ID}` +
    `&select=external_ticket_id,subject,customer_msg,agent_reply,intent,language&order=intent.asc`,
  { headers }
);
if (!res.ok) {
  console.error(`fetch failed ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const rows = await res.json();

// Bucket by intent, take up to PER_INTENT per bucket.
const buckets = {};
for (const r of rows) {
  const k = r.intent || "unknown";
  (buckets[k] = buckets[k] || []).push(r);
}
const cases = [];
let n = 1;
for (const [intent, list] of Object.entries(buckets)) {
  for (const r of list.slice(0, PER_INTENT)) {
    cases.push({
      id: `g-${String(n++).padStart(3, "0")}`,
      tier: "historical",
      subject: r.subject || "",
      body: r.customer_msg || "",
      source_thread_id: r.external_ticket_id || null,
      human_reply: r.agent_reply || "",
      language: r.language || "da",
      intent,
    });
  }
}
console.log(JSON.stringify({ shop_id: SHOP_ID, cases }, null, 2));
```

- [ ] **Step 2: Run it to verify output**

Run:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/build-golden-candidates.mjs --per-intent 6 > supabase/eval/_candidates.json
node -e "const j=require('./supabase/eval/_candidates.json'); console.log('cases:', j.cases.length, 'intents:', [...new Set(j.cases.map(c=>c.intent))])"
```
Expected: prints a non-zero case count and the list of intents. Every case has a non-empty `body`, `human_reply`, and `source_thread_id`.

- [ ] **Step 3: Commit**

```bash
git add supabase/scripts/build-golden-candidates.mjs
git commit -m "Add stratified candidate builder for golden set"
```

---

## Task 7: Curate the golden set JSON

**Files:**
- Create: `supabase/eval/golden-set.acezone.json`

No code — human curation. Produce the committed set from the candidates plus hand-authored edge cases.

- [ ] **Step 1: Seed historical cases**

From `supabase/eval/_candidates.json`, hand-pick ~30-40 cases that are clear, self-contained, and representative (drop truncated/garbled ones, drop near-duplicates). Save the pruned result as `supabase/eval/golden-set.acezone.json`.

- [ ] **Step 2: Append hand-authored edge cases**

Add ~10-15 `tier: "edge"` cases into the same `cases` array. Each has `source_thread_id: null` and concrete gates. Use these four as the mandatory core (expand as needed):

```jsonc
{
  "id": "e-001",
  "tier": "edge",
  "subject": "Dongle not working",
  "body": "Hi, the USB dongle for my A-Spire Wireless won't connect to my PC anymore. What do I do?",
  "source_thread_id": null,
  "human_reply": "Hi there, let's get your dongle reconnected. Re-pair it by holding the dongle button until it flashes, then reconnect via USB-C. If that fails we'll replace it.",
  "language": "en",
  "expected_action": "none",
  "must_contain": ["dongle"],
  "must_not_contain": []
},
{
  "id": "e-002",
  "tier": "edge",
  "subject": "A-Rise warranty claim",
  "body": "My A-Rise stopped working after 5 months. I bought it directly from your store. Can I get it repaired or replaced under warranty?",
  "source_thread_id": null,
  "human_reply": "Hi there, your A-Rise is covered by warranty. Please send a photo of the issue and your order number so we can arrange a replacement.",
  "language": "en",
  "expected_action": "none",
  "must_contain": ["warranty", "photo"],
  "must_not_contain": []
},
{
  "id": "e-003",
  "tier": "edge",
  "subject": "Partnership / wholesale enquiry",
  "body": "Hi, we run an esports venue and want to buy 40 headsets at wholesale. Who do I talk to about a partnership?",
  "source_thread_id": null,
  "human_reply": "Thanks for reaching out — I'll route this to our partnerships team who handle wholesale and venue deals.",
  "language": "en",
  "expected_action": "none",
  "must_contain": ["partnership"],
  "must_not_contain": ["return", "refund"]
},
{
  "id": "e-004",
  "tier": "edge",
  "subject": "Headset cracked, no order number",
  "body": "Hi, my A-Spire headset cracked near the headband. What can I do?",
  "source_thread_id": null,
  "human_reply": "Hi there, sorry to hear that. So we can help with a replacement, could you share your order number and a photo of the damage?",
  "language": "en",
  "expected_action": "none",
  "must_contain": ["photo"],
  "must_not_contain": ["Christoffer"]
}
```

> Note: `must_contain` tokens must be words the *correct* reply would naturally contain. After the first real run (Task 9), tighten any gate that proves too loose or too strict. The `expected_action` values must match what `generate-draft-v2` actually emits — verify against the Task 9 run output and adjust (e.g. to `"return"`/`"exchange"`) if the pipeline proposes an action.

- [ ] **Step 3: Validate the file parses and every case is structurally valid**

Run:
```bash
node --input-type=module -e "
import { loadGoldenSet } from './supabase/scripts/lib/golden-eval-core.mjs';
import { readFileSync } from 'node:fs';
const set = JSON.parse(readFileSync('supabase/eval/golden-set.acezone.json','utf8'));
console.log('valid cases:', loadGoldenSet(set).length);
"
```
Expected: prints the total case count with no validation error thrown.

- [ ] **Step 4: Commit**

```bash
git add supabase/eval/golden-set.acezone.json
git commit -m "Add curated golden eval set (historical + edge cases)"
```

---

## Task 8: The runner script

**Files:**
- Create: `supabase/scripts/run-golden-eval.mjs`

- [ ] **Step 1: Write the runner**

```js
// supabase/scripts/run-golden-eval.mjs
//
// Run the committed golden set against the DEPLOYED generate-draft-v2, judge each
// draft with the existing LLM judge, enforce edge-case gates, and report lift/
// regression vs the committed baseline.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/run-golden-eval.mjs                 # full run vs baseline
//   node supabase/scripts/run-golden-eval.mjs --tier edge     # gates only
//   node supabase/scripts/run-golden-eval.mjs --limit 2       # smoke test
//   node supabase/scripts/run-golden-eval.mjs --accept        # write current run as new baseline
//
// Exit code: non-zero if any edge gate fails. Baseline regressions are reported, not fatal.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  parseArgs, loadGoldenSet, runGates, computeAggregate, diffBaseline,
} from "./lib/golden-eval-core.mjs";
import {
  generateDraftV2, judgeWithOpenAI, draftForJudge,
} from "../../apps/web/lib/server/eval-runner.js";

const SET_PATH = "supabase/eval/golden-set.acezone.json";
const BASELINE_PATH = "supabase/eval/golden-baseline.acezone.json";
const RUNS_DIR = "supabase/eval/runs";

function readJsonOrNull(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

const opts = parseArgs(process.argv.slice(2));
const set = JSON.parse(readFileSync(SET_PATH, "utf8"));
const cases = loadGoldenSet(set, { tier: opts.tier, limit: opts.limit });
console.log(`Running ${cases.length} cases against deployed generate-draft-v2 (shop ${opts.shop})`);

const results = [];
let gateFailures = 0;
for (const c of cases) {
  try {
    const gen = await generateDraftV2(opts.shop, c.subject, c.body, {
      sourceThreadId: c.source_thread_id || undefined,
    });
    const judged = await judgeWithOpenAI(
      c.body, draftForJudge(gen.draft, gen.actions), c.human_reply, "gpt-4o-mini"
    );
    const gate = runGates(gen.draft, gen.actions, c);
    if (!gate.passed) gateFailures++;
    results.push({
      id: c.id, intent: c.intent || null, tier: c.tier, status: "scored",
      scores: {
        correctness: judged.correctness, completeness: judged.completeness,
        tone: judged.tone, actionability: judged.actionability,
        overall_10: judged.overall_10, send_ready: judged.send_ready,
      },
      gate, draft: gen.draft, actions: gen.actions, latencyMs: gen.latencyMs,
    });
    const flag = c.tier === "edge" ? (gate.passed ? "gate:PASS" : "gate:FAIL") : "";
    console.log(`  [${c.id}] overall_10=${judged.overall_10} ${flag}`);
  } catch (err) {
    results.push({ id: c.id, intent: c.intent || null, tier: c.tier, status: "failed", error: err.message });
    console.error(`  [${c.id}] ERROR: ${err.message}`);
  }
}

const summary = computeAggregate(results);
const baseline = readJsonOrNull(BASELINE_PATH);
const diff = diffBaseline(summary, baseline);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync(RUNS_DIR, { recursive: true });
const reportPath = `${RUNS_DIR}/${stamp}.json`;
writeFileSync(reportPath, JSON.stringify({ stamp, opts, summary, diff, results }, null, 2));

console.log("\n=== Aggregate ===");
console.log(summary.aggregate);
console.log("per_intent:", summary.per_intent);
if (diff.aggregateDeltas) {
  console.log("\n=== vs baseline ===");
  console.log("deltas:", diff.aggregateDeltas);
  if (diff.regressedCases.length) {
    console.log("REGRESSED:");
    for (const r of diff.regressedCases) console.log(`  ${r.id}: ${r.from} -> ${r.to}`);
  } else {
    console.log("no per-case regressions");
  }
} else {
  console.log("\n(no baseline yet — run with --accept to establish one)");
}
const failedRuns = results.filter((r) => r.status === "failed").length;
console.log(`\nReport: ${reportPath} | scored=${summary.n_cases} failed=${failedRuns} gateFailures=${gateFailures}`);

if (opts.accept) {
  const newBaseline = {
    accepted_at: new Date().toISOString(),
    n_cases: summary.n_cases,
    aggregate: summary.aggregate,
    per_intent: summary.per_intent,
    per_case: summary.per_case,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2));
  console.log(`Baseline updated: ${BASELINE_PATH}`);
}

process.exit(gateFailures > 0 ? 1 : 0);
```

- [ ] **Step 2: Smoke-test the loop with a 2-case run**

Run:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/run-golden-eval.mjs --limit 2
```
Expected: two `[g-00x] overall_10=N` lines, an `=== Aggregate ===` block, a `(no baseline yet ...)` line, and a `Report: supabase/eval/runs/<timestamp>.json` line. Exit code 0 (no edge gate in the first 2 historical cases).

- [ ] **Step 3: Verify the gate failure path produces a non-zero exit**

Run a single edge case that is rigged to fail by temporarily checking exit code:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/run-golden-eval.mjs --tier edge --limit 1; echo "exit=$?"
```
Expected: prints `gate:PASS` or `gate:FAIL` for the case. If the case passes its gate, `exit=0`. To prove the failure path, temporarily add an impossible token to that case's `must_contain` (e.g. `"zzz_never"`), re-run, confirm `gate:FAIL` and `exit=1`, then revert the token.

- [ ] **Step 4: Commit**

```bash
git add supabase/scripts/run-golden-eval.mjs
git commit -m "Add golden-eval runner (generate -> judge -> gate -> report)"
```

---

## Task 9: Establish the baseline

**Files:**
- Create: `supabase/eval/golden-baseline.acezone.json` (via `--accept`)

- [ ] **Step 1: Ensure the current pipeline is deployed**

The runner hits the deployed function. If local writer/prompt changes are not yet deployed, deploy first:
```bash
npx supabase functions deploy generate-draft-v2
```
(Skip if nothing changed since the last deploy.)

- [ ] **Step 2: Full run + accept baseline**

Run:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/run-golden-eval.mjs --accept
```
Expected: every case scored, `=== Aggregate ===` printed, and `Baseline updated: supabase/eval/golden-baseline.acezone.json`.

- [ ] **Step 3: Reconcile edge-case gates with real output**

Inspect the latest `supabase/eval/runs/<timestamp>.json` for the edge cases. If any `expected_action` or `must_contain` did not match what the pipeline actually produced (and the pipeline output was correct), adjust the gate in `golden-set.acezone.json` and re-run `--accept`. The gates should encode *correct* behaviour, not the current behaviour blindly.

- [ ] **Step 4: Commit the baseline**

```bash
git add supabase/eval/golden-baseline.acezone.json supabase/eval/golden-set.acezone.json
git commit -m "Establish golden-eval baseline for AceZone"
```

---

## Task 10: Run the full test suite + final verification

- [ ] **Step 1: All core unit tests pass**

Run: `node --test supabase/scripts/lib/golden-eval-core.test.mjs`
Expected: all tests pass, 0 failures.

- [ ] **Step 2: A clean re-run shows ~zero regression vs the just-accepted baseline**

Run:
```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/run-golden-eval.mjs
```
Expected: `deltas` near zero (LLM judge variance only), `no per-case regressions` or only minor ones, exit 0. This confirms the baseline round-trips.

- [ ] **Step 3: Confirm working tree is clean except ignored run reports**

Run: `git status --porcelain`
Expected: empty (per-run reports under `supabase/eval/runs/` are gitignored).

---

## Self-Review Notes (addressed)

- **Spec coverage:** architecture/reuse → Tasks 1-4,8; data format → Tasks 6-7,9; runner+report+flags → Task 8; baseline → Task 9; no-leakage `sourceThreadId` → Task 8 generate call; gitignore decision (gitignore runs/) → Task 5. All covered.
- **Scale:** sub-dims 1-5, `overall_10` 1-10, `per_case` stores `overall_10` — consistent across Tasks 4, 8, 9.
- **Naming consistency:** `parseArgs`, `loadGoldenSet`, `validateCase`, `extractActionTypes`, `runGates`, `computeAggregate`, `diffBaseline` used identically in core, tests, and runner.
- **Added field vs spec:** optional per-case `intent` (needed for `per_intent`); documented in File Structure and populated by Task 6.
