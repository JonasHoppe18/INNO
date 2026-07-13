# Ticket-example near-duplicate grounding — design

**Date:** 2026-07-13
**Status:** approved (Jonas, 2026-07-13)

## Problem

AceZone's full Zendesk history (~3,929 examples, all embedded) is imported and
retrieved by the pipeline via `match_ticket_examples`. But two deliberate
governors limit those examples to **tone**, never **knowledge**:

1. The writer prompt marks examples "STYLE references ONLY" with a CRITICAL
   SUBJECT RULE forbidding carrying any factual claim (product, stock, price,
   availability) from an example into the reply. Added to fix the *ear-pads*
   leak (an example about a different product leaked its facts).
2. `assessGroundingCoverage` never counts ticket_examples. A case with zero KB
   chunks + zero facts but a near-identical past ticket is still judged
   "ungrounded" → the owns-the-case hedge fires, even though a correct answer
   exists in history.

Net effect: the biggest lever for breadth is switched off. Sona hedges on the
long tail instead of answering the way the shop's own agents did.

This is the mic-clip vs. ear-pads channel: the mic-clip answer came verbatim
from an example and was *correct* grounding; the ear-pads answer leaked a
*different* product's facts. The current blanket rule kills both to stay safe.

## Approach — near-duplicate promotion

Promote an example from *style* to *grounding* **only when it is a true
near-duplicate**: high embedding similarity AND (it shares a product term with
the current customer's message, OR the customer named no product at all).
Everything else stays style-only, unchanged.

The **product-term match is the safety mechanism**: an ear-pads example can
never become a near-duplicate for a headset question because their product
terms do not overlap.

### Change 1 — Retriever exposes near-duplicate signal
`stages/retriever.ts`

The ticket_examples lookup already computes raw `similarity` per candidate and
already has `extractMentionedProductTerms(queryText, shop)` + `overlapCount`.
Extend the returned example objects (and `RetrieverResult.past_ticket_examples`
type) with:

- `similarity: number` — raw cosine from the RPC (currently dropped in the
  final `.map`).
- `is_near_duplicate: boolean` — computed as:
  ```
  const threshold = Number(Deno.env.get("TICKET_EXAMPLE_GROUNDING_MIN_SIMILARITY") ?? "0.75");
  const productTerms = extractMentionedProductTerms(queryText, shop); // already computed
  const exampleText = `${subject||""} ${customer_msg} ${agent_reply}`;
  const productTermMatch = overlapCount(exampleText, productTerms) > 0;
  const customerNamedProduct = productTerms.length > 0;
  is_near_duplicate = similarity >= threshold && (productTermMatch || !customerNamedProduct);
  ```

Fail-safe: if `similarity` is missing/NaN, `is_near_duplicate = false`.

### Change 2 — Grounding-coverage counts strong examples
`stages/grounding-coverage.ts`

Add optional input `strongTicketExampleCount?: number | null`. After the
`hasFacts` short-circuit and before the `chunkCount === 0` branch:

```
const strongExamples =
  typeof input?.strongTicketExampleCount === "number" ? input.strongTicketExampleCount : 0;
...
if (hasFacts) return { ungrounded: false, reason: null };
if (strongExamples > 0) return { ungrounded: false, reason: null }; // near-duplicate history grounds the case
if (chunkCount === 0) { ... }
```

Fail-safe preserved: undefined → 0 → no behavior change vs. today.

### Change 3 — Pipeline wires the count
`pipeline.ts` at the existing `assessGroundingCoverage({...})` call (~1804):

```
strongTicketExampleCount: Array.isArray(retrieved.past_ticket_examples)
  ? retrieved.past_ticket_examples.filter((e) => e?.is_near_duplicate === true).length
  : null,
```

No other pipeline change — when strong examples exist the case is grounded, so
the owns-the-case block and abstained-chunk suppression are simply not entered.

### Change 4 — Writer relaxes SUBJECT RULE for near-duplicates only
`stages/writer.ts` (fewShotBlock, ~1740)

- In the per-example render, add a label when `ex.is_near_duplicate`:
  `" [Near-duplicate — SAME product as the current case]"`.
- After the blanket CRITICAL SUBJECT RULE, append a conditional paragraph
  rendered ONLY when at least one near-duplicate example is present:
  > EXCEPTION — near-duplicate examples: An example labelled
  > "[Near-duplicate — SAME product...]" is a near-identical match to the
  > current customer's question about the SAME product. For that example ONLY
  > you MAY reuse its factual resolution (what we do, whether the item is
  > sold/available, the concrete outcome). Still apply it ONLY to the exact
  > product the current customer named, and still copy NO personal data.
- The blanket rule continues to govern all non-near-duplicate examples.

## Calibration

- `TICKET_EXAMPLE_GROUNDING_MIN_SIMILARITY` env var, **default 0.75** raw cosine.
  Conservative start — prefer missing a grounding over leaking a wrong fact.
  Calibrated from real AceZone RPC data (2026-07-13): genuine same-topic
  near-duplicates measured 0.76–0.80 example-to-example (mic-clip 0.799,
  ear-pads 0.758); order-specific and cross-topic examples sat ≤0.72. 0.75 sits
  in that gap; the product-term match backstops cross-product regardless.
- **The threshold is validated empirically before merge**, not assumed: measure
  the similarity a true near-duplicate (mic-clip) actually receives and the
  highest similarity a cross-product example (ear-pads vs. headset) receives,
  and set the default between them. 0.75 chosen from real data (near-dups 0.76-0.80, noise <=0.72); env-tunable; adjust the
  documented default if the data demands it.

## Verification (before merge)

Dry-run matrix, shop 38df5fef, `dry_run:true`:

1. **Mic-clip near-duplicate** — must become grounded (`strongTicketExampleCount ≥ 1`),
   owns-the-case NOT injected, draft reuses the mic-clip factual resolution.
2. **Ear-pads / headset cross-product** — example must NOT be promoted
   (`is_near_duplicate=false`), draft must NOT mention the other product; if the
   case is otherwise ungrounded it still hedges.
3. **A normal KB-grounded case** — unchanged (regression guard).
4. **A genuinely ungrounded case with no near-duplicate** (Maxgaming-class) —
   still hedges (owns-the-case still fires).

## Non-goals

- No change to `match_ticket_examples` RPC or the score/lexical/correction
  ranking. Only the raw similarity is newly surfaced.
- No promotion of low-similarity examples. No multi-example fact merging.
- Personal-data privacy rule is untouched and still absolute.
