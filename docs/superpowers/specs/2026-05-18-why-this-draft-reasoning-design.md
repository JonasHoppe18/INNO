# Why This Draft — Richer Reasoning Design

## Problem
`buildReasoning` in `apps/web/app/api/threads/[threadId]/insights/route.js` generates a mechanical, unreadable string like *"Classified as 'other'. Retrieved 8 knowledge chunks."* Users cannot understand why the draft was written the way it was.

## Goal
Replace the template string with a natural English explanation that names the intent, references the order (if any), and lists the actual KB source titles used.

## Scope
One file only: `apps/web/app/api/threads/[threadId]/insights/route.js`

No UI changes. No new API calls. No pipeline changes.

## Design

### 1. Extend `parseDiagnostic`

Currently extracts: `intent`, `kb_chunks`, `ticket_examples`, `knowledge_gaps`.

Add:
- `order_number` — from `draft_context_loaded` log (`step_detail.order_number`)
- `confidence` — from `draft_intent_assessed` log (`step_detail.confidence`)

Both fields are already logged by the pipeline; we just aren't reading them.

### 2. Add `INTENT_LABELS` map

```js
const INTENT_LABELS = {
  tracking:       "a shipment tracking request",
  return:         "a return request",
  refund:         "a refund request",
  exchange:       "an exchange request",
  address_change: "a shipping address change",
  product_question: "a product question",
  complaint:      "a complaint",
  thanks:         "a thank-you message",
  update:         "a status update",
  other:          "a general inquiry",
};
```

### 3. Rewrite `buildReasoning(intent, confidence, orderNumber, kb_chunks, knowledge_gaps)`

Output: up to 3 sentences.

**Sentence 1 — Classification:**
- `"Classified as [label]."` where label comes from `INTENT_LABELS[intent]` (fallback: `intent` raw value)
- Appended with `" (low confidence)"` if `confidence < 0.75`

**Sentence 2 — Sources:**
- If `orderNumber`: `"Found order #[orderNumber]."`
- If `kb_chunks.length > 0`: list top-2 titles by name, then `"and N more source(s)"` if remainder. E.g. `"Used "A-Spire Wireless – Update Firmware" and 7 more sources."`
- If `kb_chunks.length === 0`: `"No matching knowledge found in the knowledge base."`

**Sentence 3 — Gaps (optional):**
- Only if `knowledge_gaps.length > 0`: `"Missing information about: [title1] and [title2]."` (max 2 titles)

### Example output
> Classified as a general inquiry. Used "A-Spire Wireless – Update Firmware", "Acezone App – Connect A-Spire" and 6 more sources.

> Classified as a shipment tracking request. Found order #1234. Used "Shipping – GLS standard" and 1 more source.

> Classified as a return request (low confidence). No matching knowledge found in the knowledge base. Missing information about: Return policy.

## What does NOT change
- `SonaActivityContent.jsx` — renders `reasoning` as-is
- The pipeline (`generate-draft-v2`) — no log changes needed
- Database schema
