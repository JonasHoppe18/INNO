# Snippet-Matcher Precision Design

**Status:** Approved design — ready for implementation plan
**Date:** 2026-05-31
**Author:** Jonas + Claude (brainstorming session)
**Supersedes the retrieval role of:** lexical Q&A title-match override + issue-type tiebreak in `generate-draft-v2/stages/retriever.ts`

---

## Problem

`generate-draft-v2` retrieval picks the wrong knowledge for support tickets. Three distinct failures, verified against the committed golden set (run `2026-05-30T19-06-02-573Z.json`):

1. **Wrong selection among siblings** — for a multi-part question the correct snippet is *not* the top-cosine one (g-021: correct "Why can't I change my EQ" at cosine 0.489 ranked below an irrelevant snippet at 0.528).
2. **Topical-but-wrong single snippet** — the correct answer does not exist in the knowledge base, but a topically-near snippet gets used anyway (g-020: customer wants to *buy a replacement dongle*; retrieval returns mic/pairing troubleshooting snippets because the contact-form dropdown said "Connectivity / Pairing"). The right behaviour is to use **no** snippet.
3. **Query pollution** — `buildFallbackQueries` manufactures keyword-bag queries from raw message text (issue keywords + first 18 raw tokens, retriever.ts:271-288). Contact-form boilerplate and dropdown words become real search queries that bias the candidate pool.

Verified non-fixes (ruled out this session):
- **Better/more-specific tags** do not solve it. Snippet-side tags can be made specific, but the *customer side* is matched by a hardcoded bilingual regex (`extractIssueTerms`, retriever.ts:216-250) that has no `power_off`, no Spanish, and would need per-language maintenance — the same burden, in a worse place. A snippet's free-text **question** is already a more specific, more expressive discriminator than any tag.
- **Multilingual data discipline** (authoring questions in every language) is rejected by the shop as unmaintainable. The AI must match across languages on meaning, from a single-language question.

## Goal

The retriever selects the correct snippet(s) across languages — or correctly selects none when nothing fits — and we can **measure** that it does, separately from answer quality.

This is the industry-standard RAG precision pattern: **retrieve (recall) → rerank (precision) → threshold-based selection with abstention.** An LLM is the reranker. Measurement-first proves lift instead of guessing.

## Scope

**In scope (this spec):**
- **E** — Labeled retrieval evaluation (gold-labels + Recall@K / MRR / abstention-correctness).
- **A** — Cross-lingual LLM snippet-matcher (gpt-4o-mini), always-on, replacing the lexical override and the inert issue-tiebreak.
- **B** — Query cleanup: remove the raw keyword-bag/token-bag queries from `buildFallbackQueries`.

**Explicitly out of scope (separate specs later):**
- **C** — Abstention *behaviour* (what the writer does on zero chunks: reply from context / ask a clarifying question / escalate). This spec only delivers the *mechanism* "zero chunks when nothing matches"; downstream behaviour is unchanged.
- **D** — Past-tickets-as-answer tier (`ticket_examples` promoted from tone-only few-shot to a trust-ranked answer source).
- **Embedding-tier cascade** — the free embedding pre-filter that skips the LLM call on clear matches. Deferred cost/latency optimization; build only if volume demands it.

## Architecture & data flow

New flow inside `runRetriever`:

```
1. Plan → hybrid retrieval (UNCHANGED)
   Vector + BM25 produce a broad CANDIDATE pool (top-K, ~12-20).
   Purpose: RECALL — the correct snippet must be in the pool.

2. NEW: LLM snippet-matcher (gpt-4o-mini) — the precision layer
   Input: customer message + the K candidates (question weighted highest,
   then title, then excerpt).
   Output: ranked list with a relevance score per candidate + explicit
   "no confident match". Native multilingual — a Danish/Spanish customer
   message matches an English question on meaning.
   SKIP this call only when there are 0 candidates (abstain directly).

3. Threshold-based selection (in the retriever, not the matcher):
   - one clear winner above threshold        → select that one
   - multiple winners above threshold         → select them, up to budget (g-021)
   - none above threshold                     → return 0 knowledge chunks (abstention-as-empty)

4. Writer receives exactly the selected chunks (downstream contract UNCHANGED).
```

The matcher has **two** jobs, both required:
1. **Select among many** (tiebreak role) — relevant at ≥2 candidates.
2. **Reject a topical-but-wrong single candidate** (relevance-gate role) — relevant even at exactly 1 candidate. This is what fixes g-020, so the call is **not** gated on ≥2 candidates.

**What it replaces:** the lexical Q&A title-match override (retriever.ts:877-912) and the issue-type tiebreak (proven inert this session). Both are removed; one semantic, multilingual precision step takes their place.

**Effect on B:** once the matcher controls final *selection*, the keyword-bag queries only affect what is in the candidate pool (recall), not the final pick. So B drops from "critical fix" to "cleanup" — it removes junk candidates (cheaper/faster matcher, fewer distractions) but is no longer the main lever. A carries almost all the value.

## Component: snippet-matcher

New module: `supabase/functions/generate-draft-v2/stages/snippet-matcher.ts` — isolated, one responsibility (rank candidates against the customer message). No retrieval logic.

Contract:
```ts
type MatchCandidate = { id: string; question: string | null; title: string; excerpt: string };
type MatchResult = { id: string; relevance: number /* 0-1 */; reason: string };

async function matchSnippets(
  customerMessage: string,
  candidates: MatchCandidate[],
  opts: { model: string; threshold: number; maxSelected: number; marginMin: number },
): Promise<{ selected: MatchResult[]; ranked: MatchResult[]; abstained: boolean }>;
```

Prompt (gpt-4o-mini, temperature 0, JSON output):
- System: "You decide which knowledge snippet(s) actually answer the customer's question. Match on **meaning across languages** — the customer may write Danish/Spanish, the snippet English. A snippet matches only if it answers the customer's **actual** request, not merely the same topic. If none answers it, return an empty list."
- Input: customer message + numbered candidates (question weighted highest, then title, then excerpt).
- Output: `[{ id, relevance, reason }]`, relevance 0-1 per candidate.

Selection rules (applied in the retriever using the matcher's ranked output):
- `threshold` — start **0.6** (calibrated against E). Only candidates at/above threshold are selectable.
- `maxSelected` — the existing `knowledgeBudget` (2 for complaint/technical_support, otherwise up to 4). Handles multi-part questions (g-021).
- Winner margin — if #1 is clearly above #2, select only #1 (avoids grab-bag). "Clearly" = #1 ≥ threshold AND (#2 < threshold OR #1 − #2 ≥ `marginMin`, start **0.15**).
- None above threshold → `abstained: true`, 0 chunks.

Error handling (must never make things worse than today):
- LLM call fails / times out / returns invalid JSON → **fall back to current behaviour** (return the top-ranked chunks from hybrid retrieval, as today). The matcher is additive; it must never block a draft due to its own failure.
- Fallback events logged to `agent_logs` so we can see how often it fires.

All thresholds (0.6, 0.15) are **starting values calibrated against E**, not final.

## Evaluation (E)

The foundation that lets us prove A works, separately from answer quality.

**Gold-labels — one-time setup (LLM proposes, human confirms):**
- New script `supabase/scripts/build-gold-labels.mjs`. For each of the 44 golden cases it fetches all shop snippets, has an LLM propose `correct_snippet_ids: []` (empty = "no snippet should match", e.g. g-020) + a short rationale, and writes a draft `supabase/eval/gold-labels.acezone.json`.
- Human reviews and corrects the file. It is committed as ground truth.

**New metrics in `supabase/scripts/lib/golden-eval-core.mjs` (pure, unit-tested):**
- **Recall@K** — is at least one correct snippet in the retrieved candidate pool? (measures RETRIEVAL — did we find it at all)
- **Precision@1 / MRR** — was a correct snippet selected as #1 / how highly ranked? (measures the MATCHER — did we rank correctly)
- **Abstention-correctness** — for cases where gold is empty: did we correctly select 0 snippets? (catches the g-020 type — rewards abstaining, penalises junk answers)

**Wiring:** the retriever already emits `retrieval_debug.chunks` with ids. The eval runner compares selected/retrieved ids against gold-labels and computes the three metrics alongside the existing LLM judge for answer quality. We get **two separate signals**: "did we pick the right knowledge" (E) and "was the answer good" (judge). That separation is what was missing when earlier changes could not be confirmed.

**Baseline:** run E against the current deployed pipeline BEFORE A is built, and commit the numbers, so A's lift is measured against a real baseline.

## File structure

Created:
| File | Responsibility |
|---|---|
| `supabase/functions/generate-draft-v2/stages/snippet-matcher.ts` | Pure matcher: prompt build, gpt-4o-mini call, JSON parse, selection rules. No retrieval logic. |
| `supabase/functions/generate-draft-v2/stages/snippet-matcher.test.ts` | Deno unit tests: selection (single winner / multi / abstain), margin rule, error-fallback, empty-candidate skip. Stubbed LLM responses — no live API calls. |
| `supabase/scripts/build-gold-labels.mjs` | One-time: LLM proposes gold-labels → JSON for human review. |
| `supabase/eval/gold-labels.acezone.json` | Committed ground truth: case id → correct snippet ids. |

Modified:
| File | Change |
|---|---|
| `stages/retriever.ts` | Insert matcher step after hybrid retrieval; remove lexical title-match override + issue-tiebreak; B-cleanup of `buildFallbackQueries` (remove raw token-bag + issue keyword-bag queries). |
| `scripts/lib/golden-eval-core.mjs` | Add pure `computeRetrievalMetrics()` (Recall@K, MRR, abstention) + tests. |
| `scripts/run-golden-eval.mjs` | Load gold-labels; compute and report retrieval metrics alongside the judge. |

## Testing

- Matcher tested against **stubbed LLM responses** (no live API calls in unit tests) — deterministic: given ranked JSON, verify the selection rules.
- Metrics functions tested purely (known input → known Recall/MRR/abstention).
- Integration proven via the eval harness against the deployed function, not unit tests.
- Follow TDD: failing test → minimal implementation → passing test → commit.

## Rollout sequence (each step shippable & measurable)

1. **E foundation first:** build metrics + gold-labels, run **baseline** against current pipeline, commit numbers. *(Now we can measure.)*
2. **Build A:** matcher module + tests, wire into retriever, B-cleanup. Deploy with plain `npx supabase functions deploy generate-draft-v2`.
3. **Measure A vs baseline:** Recall@K (must hold — do not lose recall), Precision@1/MRR (must rise), abstention-correctness (g-020 must go from junk answer → correct abstention), and judge-overall (must hold/rise). Calibrate thresholds (0.6 / 0.15) against the numbers.
4. **Re-baseline** (`--accept`) once numbers are good.

## Risks & mitigations

- **Matcher failure blocking a draft** → fallback to current top-chunks on any error/timeout/invalid JSON.
- **Recall regression** → E catches it explicitly; the B-cleanup is watched for accidentally dropping the correct snippet out of the pool.
- **Threshold miscalibration** → start conservative (0.6), adjust only against measured aggregates, never against single cases (judge variance is ±1-2 per case, confirmed this session).
- **Added latency** → one gpt-4o-mini call (~0.5-1.5s) on top of an already ~10.7s-median background generation; drafts are generated off the customer's critical path (background, employee-reviewed), so the impact is effectively invisible. The deferred embedding-tier cascade is the lever if volume ever makes latency matter.

## Standing constraints (carry into implementation)

- No commits without explicit ask.
- All app/user-facing text in English.
- All knowledge access scoped to explicit `shop_id`.
- Deploy `generate-draft-v2` with plain `npx supabase functions deploy generate-draft-v2`.
- Work on main.
