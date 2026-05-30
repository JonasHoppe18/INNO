# Golden Eval Set (v1, AceZone) — Design

**Date:** 2026-05-30
**Status:** Approved (pending written-spec review)
**Scope:** A stable, versioned regression-and-quality measurement set for `generate-draft-v2`, scoped to the first customer (AceZone).

## Problem

Today, judging whether Sona's drafts are improving is manual and subjective: pick a ticket, run it, read the reply, form an impression. The same case is rarely tested twice, so when we change a prompt we cannot tell whether we improved quality or silently broke a different path. We have no objective baseline and no regression signal.

We already have mature eval *machinery* (`generateDraftV2` + `judgeWithOpenAI` in `apps/web/lib/server/eval-runner.js`, plus `eval_runs` and `EvalPanel`), but every run pulls its input ad-hoc. What is missing is a **fixed, curated, version-controlled set of representative cases** run repeatedly against a baseline.

## Goal

Answer one question objectively and repeatably: **"Are we measurably closer to AceZone's own customer service?"** — and catch regressions in critical rule paths before they ship.

Non-goals (explicitly out of scope for v1, YAGNI):
- UI integration / `EvalPanel` surfacing
- An `eval_cases` database table
- Multi-tenant / multi-shop support
- CI wiring (the runner will be CI-*ready* via exit codes, but we will not wire CI now)

## Architecture & Reuse

No new pipeline and no duplicated prompts. We add a thin orchestration layer on top of the existing eval machinery.

- `generateDraftV2()`, `judgeWithOpenAI()`, and `draftForJudge()` are already exported from `apps/web/lib/server/eval-runner.js`. They remain the **single source of truth** for generation and judging.
- A new CLI script `supabase/scripts/run-golden-eval.mjs` imports those three functions, loops the cases, applies gates, and writes a report.
- The golden set itself is **committed JSON** — diffable and code-reviewable.

```
golden-set.acezone.json ──► run-golden-eval.mjs ──► generateDraftV2() ──► judgeWithOpenAI()
                                     │                                            │
                                     ├── edge-case gates (must_contain, ...)      │
                                     ▼                                            ▼
                          supabase/eval/runs/<timestamp>.json   +   diff vs golden-baseline.acezone.json
```

### Critical correctness detail: no few-shot leakage

The historical cases now also live in `ticket_examples` as few-shot anchors. Each historical case **must exclude its own source** from retrieval via `generateDraftV2(..., { sourceThreadId })` (already supported by the pipeline). Without this we would measure data leakage instead of generalisation. Hand-authored edge cases have `source_thread_id: null` (nothing to exclude).

## Data Format

Two committed files under `supabase/eval/`.

### `golden-set.acezone.json` — the cases

```jsonc
{
  "shop_id": "38df5fef-2a23-47f3-803e-39f2d6f1ed99",
  "cases": [
    {
      "id": "g-001",
      "tier": "historical",              // "historical" | "edge"
      "subject": "My A-Spire headset cracked",
      "body": "Hi, my headset cracked near the headband...",
      "source_thread_id": "3bc94659-...", // historical: excluded from few-shot. edge: null
      "human_reply": "Hi there, sorry to hear...", // reference answer (scrubbed). edge: ideal answer
      "language": "da",                   // "da" | "en"

      // edge-tier only — hard gates (omitted/empty for historical):
      "expected_action": "none",          // e.g. "return", "exchange", "none"
      "must_contain": ["photo", "30-day"],     // case-insensitive substrings, all required
      "must_not_contain": ["Christoffer"]      // none may appear (PII-leak / wrong-name guard)
    }
  ]
}
```

Field rules:
- `human_reply` is **always** the scrubbed text (we never store raw PII in the repo).
- `must_contain` / `must_not_contain` / `expected_action` apply only to `tier: "edge"`. For `historical` they are ignored.
- `language` lets us spot a language-mismatch failure (e.g. replying in English to a Danish ticket).

### `golden-baseline.acezone.json` — the accepted baseline

The last deliberately-accepted aggregate, used for the regression diff:

```jsonc
{
  "accepted_at": "2026-05-30T12:00:00Z",
  "n_cases": 50,
  "aggregate": {
    "overall_10": 7.8, "tone": 8.1, "correctness": 7.6,
    "completeness": 7.7, "actionability": 7.9, "send_ready_rate": 0.42
  },
  "per_intent": { "complaint": 7.4, "return": 8.0, "shipping": 8.2 },
  "per_case": { "g-001": 8, "g-002": 6 }   // per-case overall_10 for case-level regression detection
}
```

### Composition

- **~30-40 historical cases** — stratified sample from the 199 scrubbed `ticket_examples` by intent and product, so the set mirrors real ticket distribution.
- **~10-15 hand-authored edge cases** — for rules we know must hold and that historical tickets may not cover systematically: dongle rule, A-Rise warranty, partnership routing, order-not-found gate.

## Runner & Reporting

`supabase/scripts/run-golden-eval.mjs`:

For each case:
1. `generateDraftV2(shopId, subject, body, { sourceThreadId })` — generate the draft.
2. `judgeWithOpenAI(body, draftForJudge(draft, actions), human_reply)` — score correctness/completeness/tone/actionability/overall_10 + send_ready + root cause.
3. If `tier: "edge"`, run the hard gates against the draft + proposed actions:
   - every `must_contain` substring present (case-insensitive),
   - no `must_not_contain` substring present,
   - proposed action matches `expected_action`.

Outputs:
- A timestamped per-case + aggregate report to `supabase/eval/runs/<timestamp>.json`.
- A printed **diff vs `golden-baseline.acezone.json`**: aggregate deltas, plus a list of cases whose `overall_10` dropped below their per-case baseline.
- A printed gate summary: which edge cases passed/failed.

Exit codes (CI-ready, not wired now):
- Non-zero if any hard gate fails.
- Zero otherwise (baseline regressions are reported but do not fail the run — regression is a signal to read, not an automatic block, in v1).

Flags:
- `--accept` — write the current run's aggregate as the new `golden-baseline.acezone.json`.
- `--tier historical|edge` — run only one tier.
- `--limit N` — run the first N cases (fast smoke test).
- `--shop <id>` — shop id (defaults to AceZone).

## Error Handling

- A case whose generation or judging throws is recorded as `failed` in the report (not silently dropped) and excluded from the aggregate; the run continues.
- The runner reads env the same way the existing scripts do (`set -a && source apps/web/.env.local && set +a`).
- If the baseline file is missing, the first run prints "no baseline — establishing one" and writes the report without a diff; `--accept` then seeds the baseline.

## Building the Historical Cases

A one-off helper (or a `--build` mode) selects a stratified sample from `ticket_examples` (by `intent`/product) and emits a draft `golden-set.acezone.json` that the author then prunes by hand. The committed file is the source of truth; the helper is convenience only and is not part of the run path.

## Testing

- Self-test the runner with `--limit 2` against live `generate-draft-v2` to confirm the generate→judge→report loop and the gate logic both work end to end.
- Verify a deliberately failing edge gate (e.g. `must_not_contain` a token the draft will contain) produces a non-zero exit.

## File Summary

| File | Status | Purpose |
|------|--------|---------|
| `supabase/eval/golden-set.acezone.json` | new | The curated cases |
| `supabase/eval/golden-baseline.acezone.json` | new | Accepted baseline aggregate |
| `supabase/eval/runs/<timestamp>.json` | generated | Per-run reports (gitignored or committed per preference) |
| `supabase/scripts/run-golden-eval.mjs` | new | Orchestration + gates + reporting |
| `apps/web/lib/server/eval-runner.js` | reused | `generateDraftV2`, `judgeWithOpenAI`, `draftForJudge` |
