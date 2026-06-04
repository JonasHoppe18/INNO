# AceZone gold-eval seed — review

Companion to `gold-eval-cases.acezone.json`. One row per selected case so a human can
audit intent mapping, grading mode, missing context and the knowledge mapping before
import. **Nothing here has been imported or run.** No production behavior was touched.

## Counting (the one authoritative table)

| Bucket | Count | Cases |
|--------|-------|-------|
| **Total selected** | 33 | (11 excluded from the 44-case source — see below) |
| Active (`is_active=true`) | 26 | g-002, g-003, g-007, g-009, g-023, g-043, e-001, g-012, g-045, g-013, g-027, g-028, g-033, g-047, e-004, g-036, g-037, g-041, g-014, g-001, g-004, g-020, g-021, g-022, g-040, g-016 |
| Inactive review (`is_active=false`) | 7 | g-005, g-031, g-008, g-032, e-002, g-015, g-044 |
| Excluded (not in seed) | 11 | g-006, g-019, g-024, g-046, g-038, g-039, g-034, g-035, g-029, g-011, g-025 |
| `grading_mode = content_only` | 19 | of which 16 active, 3 inactive |
| `grading_mode = order_context_required` | 14 | of which 10 active, 4 inactive |
| Active but partial until enrichment | 10 | g-012, g-045, g-013, g-027, g-028, g-036, g-037, g-041, g-014, g-001 |
| Knowledge gap (empty `gold_knowledge_chunk_ids`) | 1 | g-044 |

`26 active = 33 total - 7 inactive`. `26 active = 16 active content_only + 10 active order_context_required`.

### Why the prior report said both "23" and "28"

The earlier Section 2–5 report quoted two different numbers without naming what each counted. This review supersedes that draft: the current active benchmark set is **26** cases, all of which are either READY_FULL or active READY_PARTIAL. Cases marked NEEDS_REVIEW or EXCLUDE are inactive and should not be used as trusted benchmark rows before import.

## Quality-gate classification (manual review)

This is the authoritative quality gate. Every case carries `benchmark_status`, `manual_reviewed` and `review_notes` in the seed JSON. `manual_reviewed = true` for all 33.

| Status | Count | Cases |
|--------|-------|-------|
| **READY_FULL** | 16 | g-002, g-003, g-007, g-009, g-023, g-043, e-001, g-033, g-047, e-004, g-004, g-020, g-021, g-022, g-040, g-016 |
| **READY_PARTIAL** | 10 | g-012, g-045, g-013, g-027, g-028, g-036, g-037, g-041, g-014, g-001 |
| **NEEDS_REVIEW** | 6 | g-005, g-031, g-008, g-032, g-015, g-044 |
| **EXCLUDE** | 1 | e-002 |

Classification rules applied:
- **READY_FULL** — clear primary intent, resolution gradable on content, knowledge exists (or
  is deliberately not needed), no missing Shopify data, enough thread history.
- **READY_PARTIAL** — intent + retrieval gradable now, but facts/action cannot be safely graded
  without `order_context_json`. Still valuable for a partial baseline.
- **NEEDS_REVIEW** — missing thread history, unclear business policy, conflicting/absent
  knowledge, or uncertain expected resolution. Do not import as a trusted benchmark yet.
- **EXCLUDE** — duplicate, too little context, or inconsistent/unusable facit.

### Structured review matrix

This matrix expands every case into the exact fields required for the manual quality gate. `gold_knowledge_chunk_ids` are bigint ids and should be compared with `String(id)` normalization when evaluated.

#### g-002

- source_case_id: g-002
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: technical_support
- grading_mode: content_only
- missing context: None.
- relevant knowledge: 3972, 3795, 3944
- expected resolution: Guide the customer through the Bluetooth hang-up recovery / re-pairing procedure for a dongle that reports an error and a headset that won't power on. Resolvable on message content alone.
- open questions: None.
- review_notes: Clean hardware-fault troubleshooting; pairing/firmware/hang-up guides are retrievable. Intent, resolution and retrieval all gradable on content. No missing data.

#### g-003

- source_case_id: g-003
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: technical_support
- grading_mode: content_only
- missing context: None.
- relevant knowledge: 3813, 3643, 3642
- expected resolution: Provide the forget-device + ANC-button pairing procedure for the AceZone app. Resolvable on message content alone.
- open questions: None.
- review_notes: App pairing fault; forget-device + ANC pairing guide retrievable. Fully gradable on content.

#### g-005

- source_case_id: g-005
- benchmark_status: NEEDS_REVIEW
- manual_reviewed: true
- expected_intent: technical_support
- grading_mode: order_context_required
- missing context: Missing prior ticket/thread history; prior firmware attempt is referenced but absent.
- relevant knowledge: 3835, 3948, 3990
- expected resolution: Continuation of a prior firmware-update troubleshooting thread; advise USB port placement and interference checks. The correct reply references prior context ("jeg kan se vi allerede prøvede at opdatere firmwaren") that is NOT reconstructable from this single message.
- open questions: Can the prior ticket turns be reconstructed into thread_history_json?
- review_notes: Reopened ticket: the gold reply explicitly references an earlier firmware-update attempt that is not in this message and not reconstructable. Missing thread history blocks fair resolution grading. Reconstruct prior turns before activating; intent alone (technical_support) is gradable but the case is not benchmark-trustworthy as-is.

#### g-007

- source_case_id: g-007
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: technical_support
- grading_mode: content_only
- missing context: None.
- relevant knowledge: 3833, 3944, 3978
- expected resolution: Recommend firmware update, disabling Standby Timer, driver reinstall + factory reset + re-pair, and trying a separate cable. Resolvable on message content alone.
- open questions: None.
- review_notes: Power-off-while-charging fault; standby-timer + driver/reset guides retrievable. Fully gradable on content. Representative of the g-046 cluster.

#### g-009

- source_case_id: g-009
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: technical_support
- grading_mode: content_only
- missing context: None; customer already lists tried devices/cables.
- relevant knowledge: 3837, 3895, 3331
- expected resolution: Primary need is troubleshooting (firmware update, driver reinstall, factory reset, re-pair); exchange is the fallback the customer raised. Gold reply continues troubleshooting before any swap. Resolvable on message content alone.
- open questions: None.
- review_notes: Customer-already-tried (other PC + cables); gold reply correctly continues troubleshooting before any swap. Troubleshooting knowledge retrievable. Fully gradable on content; exchange is only a documented secondary intent.

#### g-023

- source_case_id: g-023
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: technical_support
- grading_mode: content_only
- missing context: None.
- relevant knowledge: 3649, 3948, 3929
- expected resolution: Walk through driver reinstall + factory reset + dongle re-pair and firmware update before considering a replacement dongle. Resolvable on message content alone.
- open questions: None.
- review_notes: Dongle re-pair / driver-reinstall guide retrievable; gold reply troubleshoots before offering a replacement. Fully gradable on content.

#### g-031

- source_case_id: g-031
- benchmark_status: NEEDS_REVIEW
- manual_reviewed: true
- expected_intent: technical_support
- grading_mode: order_context_required
- missing context: Missing earlier troubleshooting mail and partially quoted engineering escalation.
- relevant knowledge: 3877, 3879, 3807
- expected resolution: Follow-up: confirm firmware status (headset + dongle), check Windows 'Voice Clarity' off, and ask whether the metallic sidetone is constant or occasional. The correct reply references an unresolved prior turn and engineering escalation that are not reconstructable from this message.
- open questions: Can the earlier troubleshooting and engineering escalation be reconstructed into thread_history_json?
- review_notes: Genuine multi-turn DE follow-up; the gold reply leans on an earlier troubleshooting mail + an engineering escalation that are only partially quoted and not cleanly reconstructable. Missing thread history blocks resolution grading. Reconstruct prior turns into thread_history_json before activating.

#### g-043

- source_case_id: g-043
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: technical_support
- grading_mode: content_only
- missing context: None.
- relevant knowledge: 3813, 3931, 3642
- expected resolution: Customer-already-tried (factory reset, other phone). Advise firmware update via Updater first, then ANC-button pairing and forget-on-app. Resolvable on message content alone.
- open questions: None.
- review_notes: Customer-already-tried (factory reset + other phone); firmware-updater + pairing guide retrievable. Fully gradable on content. Raw 'unknown' confidently remapped to technical_support.

#### e-001

- source_case_id: e-001
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: technical_support
- grading_mode: content_only
- missing context: None; intentionally short edge control.
- relevant knowledge: 3948, 3990, 3649
- expected resolution: Re-pair the dongle (hold dongle button until it flashes, reconnect via USB-C); offer replacement only if that fails. Must mention 'dongle'. Resolvable on message content alone.
- open questions: None.
- review_notes: Short synthetic edge prompt with a clean dongle re-pair facit and must_contain('dongle'). Content-only, fully gradable. Kept as a deliberate minimal-context positive control.

#### g-008

- source_case_id: g-008
- benchmark_status: NEEDS_REVIEW
- manual_reviewed: true
- expected_intent: exchange_request
- grading_mode: order_context_required
- missing context: Missing order date and warranty-coverage decision for cracked holder after about one year.
- relevant knowledge: 3964, 3758, 3638
- expected resolution: Confirm warranty coverage, verify customer shipping/contact details, and initiate a return-for-swap. Whether the unit is in warranty depends on the actual purchase date in the order — cannot be graded on facts/action without order context.
- open questions: Does AceZone cover normal-use holder cracking after about one year, and how should order age affect the reply?
- review_notes: Intent and retrieval are gradable, but the gold premise (still covered by warranty for a cracked holder after about one year) depends on real purchase date and an AceZone decision on whether normal-use cracking is covered. Keep inactive until both order_context and warranty policy are resolved.

#### g-012

- source_case_id: g-012
- benchmark_status: READY_PARTIAL
- manual_reviewed: true
- expected_intent: exchange_request
- grading_mode: order_context_required
- missing context: Order context needed only for actual swap/warranty execution.
- relevant knowledge: 3964, 3986, 3758
- expected resolution: Ask for a photo of the damage and the order number, then proceed with an exchange. Intent + retrieval gradable now; the actual exchange/action depends on order context.
- open questions: None.
- review_notes: Clear single-intent exchange; gold reply only asks for photo + order number, so intent + retrieval are fully gradable now. Swap execution / warranty-window check needs order_context enrichment. Good partial-baseline case.

#### g-045

- source_case_id: g-045
- benchmark_status: READY_PARTIAL
- manual_reviewed: true
- expected_intent: exchange_request
- grading_mode: order_context_required
- missing context: Order date needed to verify whether the customer is beyond the return period / inside warranty handling.
- relevant knowledge: 3986, 3758, 3638
- expected resolution: Note the request is beyond the 30-day return window but offer a manual review for a return-for-swap; ask the customer to attach images via mobile. The 30-day determination depends on the real purchase date.
- open questions: What exact warranty/return decision applies once purchase date is known?
- review_notes: Raw 'unknown' confidently remapped to exchange_request. The 'beyond 30-day period' framing depends on the real purchase date (order_context). Intent + retrieval gradable now; the swap/warranty decision is deferred. Solid partial case.

#### g-013

- source_case_id: g-013
- benchmark_status: READY_PARTIAL
- manual_reviewed: true
- expected_intent: refund_request
- grading_mode: order_context_required
- missing context: Order date needed for refund-window and refund-vs-exchange execution.
- relevant knowledge: 3758, 3054, 3978
- expected resolution: State the 30-day return policy (refund within window, otherwise exchange), verify contact details, and offer to create a return label + send a new unit. Refund eligibility depends on order date.
- open questions: What should the full refund/exchange outcome be once purchase date is known?
- review_notes: Customer explicitly prefers refund, exchange as fallback (clean primary/secondary split). 30-day return policy is the retrieval target. Refund-vs-exchange decision needs order date (order_context). Intent + retrieval gradable now; strong partial case.

#### g-027

- source_case_id: g-027
- benchmark_status: READY_PARTIAL
- manual_reviewed: true
- expected_intent: refund_request
- grading_mode: order_context_required
- missing context: Order context needed for refund/return execution; body recap is otherwise self-contained.
- relevant knowledge: 3974, 3651, 3054
- expected resolution: Explain mic-mute switch sensitivity + mic clip, then give the US return address and instruct trackable shipment; refund issued on receipt. Recap is self-contained in the message; the return/refund execution depends on order context.
- open questions: What concrete return/refund action applies once order context is attached?
- review_notes: Follow-up whose recap is fully self-contained in the message body (so no external thread history needed). Mic-switch knowledge + return address are the retrieval targets. Refund/return execution needs order_context. Intent + retrieval gradable now; good partial case.

#### g-028

- source_case_id: g-028
- benchmark_status: READY_PARTIAL
- manual_reviewed: true
- expected_intent: refund_request
- grading_mode: order_context_required
- missing context: Order date needed for out-of-window decision; A-Rise repair-only policy is content knowledge.
- relevant knowledge: 3899, 3657, 3758
- expected resolution: A-Rise is repair-only beyond the 30-day window: explain repair path, decline refund as out of return period, and ask the customer to detail all issues. Out-of-window determination depends on order date.
- open questions: How should A-Rise repair-only policy interact with refund/replace requests after order age is known?
- review_notes: Key retrieval target is the A-Rise-specific repair-only policy (distinct from A-Spire return path). Out-of-30-day determination needs order date. Intent + retrieval gradable now. Note: this case is the canonical A-Rise policy — e-002's contradictory facit should defer to this one.

#### g-033

- source_case_id: g-033
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: return_request
- grading_mode: content_only
- missing context: None; policy/how-to question does not require order lookup.
- relevant knowledge: 3913, 3651, 3192
- expected resolution: Explain the 30-day return policy, possible value deduction for opened/worn units (EU consumer law), the office return address, and the courier/label steps. Largely policy-driven; gradable on content (retrieval of return policy).
- open questions: None.
- review_notes: Policy-driven 'how does a return work' question; the canonical 30-day return policy chunk fully answers it without order lookup. Resolution + retrieval gradable on content. The diminished-value deduction is policy text, not order-specific here.

#### g-047

- source_case_id: g-047
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: return_request
- grading_mode: content_only
- missing context: None; return eligibility policy question does not require order lookup.
- relevant knowledge: 3919, 3913, 3651
- expected resolution: Reassure firmware/pairing first, then confirm returns are accepted within 30 days even if opened/tested, with possible deduction, and list the return procedure. Policy-driven; gradable on content.
- open questions: None.
- review_notes: Raw 'unknown' remapped to return_request (the question is whether a used return is reimbursable). The 30-day-even-if-opened policy chunk answers it on content. Resolution + retrieval gradable. Refund is a documented secondary intent.

#### g-032

- source_case_id: g-032
- benchmark_status: NEEDS_REVIEW
- manual_reviewed: true
- expected_intent: refund_request
- grading_mode: order_context_required
- missing context: Missing refund approval state, debit date, and order/refund status.
- relevant knowledge: 3057, 3192, 3651
- expected resolution: Tell the customer the refund is approved, 2-5 business days to arrive, the specific debit date, and the 50 EUR deduction for an opened/tried unit. The reply is entirely order/refund-status specific (approval, dates, deduction amount).
- open questions: Is the 50 EUR diminished-value deduction a stable business rule or this specific case only?
- review_notes: Intent (refund_request) is gradable, but the entire expected resolution is order/refund-status data — approval state, debit date, and a 50 EUR diminished-value deduction — none of which exists without order + refund-record enrichment. The deduction amount is also a per-case business decision. No trustworthy content facit; keep inactive until enriched. Borderline EXCLUDE if enrichment never lands.

#### e-002

- source_case_id: e-002
- benchmark_status: EXCLUDE
- manual_reviewed: true
- expected_intent: exchange_request
- grading_mode: content_only
- missing context: Purchase date absent and facit conflicts with A-Rise repair-only policy.
- relevant knowledge: 3758, 3899, 3638
- expected resolution: Confirm warranty coverage and ask for a photo + order number to arrange a replacement. Must mention 'warranty' and 'photo'.
- open questions: Should this synthetic case be rewritten to match A-Rise repair-only policy, or permanently dropped?
- review_notes: EXCLUDE: the synthetic edge facit says the A-Rise is 'covered by warranty' and should be replaced, which directly contradicts the real A-Rise repair-only policy seen in g-028 (and warranty coverage would itself depend on the purchase date). Inconsistent, unverifiable facit — not usable for benchmark. Drop rather than enrich; g-028 already covers A-Rise policy correctly.

#### e-004

- source_case_id: e-004
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: exchange_request
- grading_mode: content_only
- missing context: None; expected reply only requests order number and photo.
- relevant knowledge: 3964, 3986, 3638
- expected resolution: Ask for the order number and a photo of the damage so a replacement can be arranged. Must mention 'order'; must not invent a name.
- open questions: None.
- review_notes: Edge case done right: the gold reply makes no warranty assertion, it only requests order number + photo (must_contain 'order', must_not_contain a name). Fully content-gradable with no order data needed. Good minimal-context positive control for the exchange intake step.

#### g-036

- source_case_id: g-036
- benchmark_status: READY_PARTIAL
- manual_reviewed: true
- expected_intent: order_status
- grading_mode: order_context_required
- missing context: Fulfillment/order state needed for concrete shipping answer.
- relevant knowledge: 3958, 3145
- expected resolution: Explain the order is forwarded to the warehouse partner, which is delayed, with an expected ship date. The actual status/dates depend on the real order.
- open questions: What exact fulfillment state should be expected after enrichment?
- review_notes: Order-status request; the substantive answer (where the order is, expected ship date) needs real fulfillment data. Intent + retrieval gradable now. Note: gold reply's 'warehouse delay' is a point-in-time fact — when enriched, treat resolution as 'report accurate current fulfillment state', not this specific phrasing.

#### g-037

- source_case_id: g-037
- benchmark_status: READY_PARTIAL
- manual_reviewed: true
- expected_intent: order_status
- grading_mode: order_context_required
- missing context: Fulfillment/payment capture/order state needed for concrete order-status answer.
- relevant knowledge: 3958, 3145
- expected resolution: Explain the order is with the (delayed) warehouse partner and expected to ship soon. Actual status depends on real order data.
- open questions: What exact payment/fulfillment state should be expected after enrichment?
- review_notes: Representative of the warehouse-delay order-status cluster (g-038/g-039 excluded as near-duplicates). Substantive answer needs fulfillment data. Intent + retrieval gradable now. The 'payment not captured yet' detail is real order data to enrich, not a content facit.

#### g-041

- source_case_id: g-041
- benchmark_status: READY_PARTIAL
- manual_reviewed: true
- expected_intent: tracking
- grading_mode: order_context_required
- missing context: Shipment/carrier status needed for concrete tracking answer.
- relevant knowledge: 3958, 3954
- expected resolution: Tell the customer the shipment was created today and the warehouse is awaiting DAO pickup, possibly delivered later today. Specifics depend on the real shipment.
- open questions: What shipment status should be expected after enrichment?
- review_notes: Specific shipment/carrier (DAO) tracking question. Concrete shipment status needs order/shipment data. Intent + retrieval gradable now. Good partial case to distinguish tracking from generic order_status.

#### g-014

- source_case_id: g-014
- benchmark_status: READY_PARTIAL
- manual_reviewed: true
- expected_intent: order_status
- grading_mode: order_context_required
- missing context: Order lookup and delivered-but-missing/lost-in-transit process needed.
- relevant knowledge: 3958, 3638
- expected resolution: Could not locate the order from the provided info; ask the customer to verify the order number and purchase email / provide proof of purchase. Needs order lookup.
- open questions: What is AceZone policy for delivered-but-missing / wrong delivery-photo claims?
- review_notes: Raw 'other' remapped to order_status (whereabouts of a delivered-but-missing order). The gold reply's 'could not locate the order' itself depends on the order lookup, so resolution needs order_context. Intent + retrieval gradable now. Possible lost-in-transit/claim business policy to define for full grading.

#### g-001

- source_case_id: g-001
- benchmark_status: READY_PARTIAL
- manual_reviewed: true
- expected_intent: address_change
- grading_mode: order_context_required
- missing context: Order lookup needed; order number is unrecognized in the source case.
- relevant knowledge: 3952, 3638
- expected resolution: Order number not recognized; ask where the purchase was made so the order can be located before changing the address. Needs order lookup.
- open questions: What should happen when Shopify cannot locate the provided order number?
- review_notes: Address change blocked on an unrecognized order number; the gold reply (ask where the purchase was made) is itself driven by the failed order lookup, so resolution needs order_context. Intent + retrieval gradable now. Clean primary intent.

#### g-004

- source_case_id: g-004
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: complaint
- grading_mode: content_only
- missing context: None; cancellation has already failed and answer is policy/complaint handling.
- relevant knowledge: 3715, 3716
- expected resolution: Acknowledge the frustration, explain that shipped orders can't be cancelled, and point to the 30-day return window. Answerable on content (policy explanation).
- open questions: None.
- review_notes: Tricky intent call resolved well: the cancellation already failed, so there's no live cancel workflow — it's a complaint with cancel_order as secondary. The correct answer is a policy explanation (shipped orders can't cancel + 30-day return), retrievable and content-gradable. Verifies the complaint-vs-workflow rule.

#### g-020

- source_case_id: g-020
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: product_question
- grading_mode: content_only
- missing context: None for content grading; order number only needed for follow-up purchase flow.
- relevant knowledge: 3929, 3948
- expected resolution: Confirm a replacement dongle can be purchased and ask for the order number to find the correct spare part. Answerable on content (yes, spare available); order number is for follow-up.
- open questions: Confirm replacement dongles are actually sold as spare parts.
- review_notes: Core answer ('yes, a replacement dongle is purchasable') is content-gradable; the order number is only for follow-up, not blocking. Spare-part knowledge retrievable. Open question for full confidence: confirm a replacement dongle is actually sold as a spare on the store.

#### g-021

- source_case_id: g-021
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: product_question
- grading_mode: content_only
- missing context: None for current content grading, but firmware/product facts may drift.
- relevant knowledge: 3881, 3895
- expected resolution: Confirm firmware 146 is the latest for A-Spire, explain it has no EQ management, and suggest checking the connection/interference. Multi-question, answerable on content.
- open questions: Confirm firmware 146 remains latest and that no EQ management exists.
- review_notes: Good multi-question case (latest firmware + audio quality). Answer rests on product facts: 146 is latest for A-Spire and A-Spire has no EQ management. Content-gradable. Open question for full confidence: verify '146 is latest' and 'no EQ' are current product facts, since firmware versions drift over time.

#### g-022

- source_case_id: g-022
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: product_question
- grading_mode: content_only
- missing context: None for compatibility answer; commercial upgrade discount policy is separate.
- relevant knowledge: 3883, 3976, 3962
- expected resolution: Explain Wired vs Wireless earpad compatibility caveats and offer a discounted A-Spire Wireless upgrade as an alternative. Answerable on content (product knowledge).
- open questions: Is the 20% upgrade discount standard guidance or agent-discretionary?
- review_notes: Earpad Wired-vs-Wireless compatibility question; product knowledge retrievable. Content-gradable. Open question: the 20% discount upgrade offer is a commercial gesture — confirm whether AceZone wants that as standard guidance or treat it as an agent discretionary action (business decision for the action layer, not for intent/retrieval grading).

#### g-015

- source_case_id: g-015
- benchmark_status: NEEDS_REVIEW
- manual_reviewed: true
- expected_intent: product_question
- grading_mode: content_only
- missing context: Business policy missing for lost receiver replacement path and cost; gold reply mismatches lost-vs-damaged premise.
- relevant knowledge: 3929, 3638
- expected resolution: Ask for order number and images to look into a (possibly warranty-covered) replacement of the receiver/dongle. Core answer is about getting a replacement part — content-gradable.
- open questions: Is a lost receiver replaceable, and if so at what price/process?
- review_notes: Customer misplaced/lost the receiver, but the gold reply asks for images of damages and frames the path as warranty coverage. That mismatch makes the expected resolution uncertain. AceZone needs to define whether a lost receiver is replaceable and at what cost/process before this can become benchmark-trustworthy.

#### g-044

- source_case_id: g-044
- benchmark_status: NEEDS_REVIEW
- manual_reviewed: true
- expected_intent: invoice_request
- grading_mode: content_only
- missing context: No invoice-handling knowledge chunk and no defined invoice process.
- relevant knowledge: None (knowledge gap)
- expected resolution: Acknowledge the invoice request and route it to the shop manager to provide the invoice. Answerable on content (process), though no dedicated knowledge chunk currently covers invoices.
- open questions: Should invoices be routed to shop manager or generated/resent from Shopify? Which knowledge article should cover it?
- review_notes: Clear invoice_request intent, but no invoice-handling chunk exists and the correct process is undefined (route to shop manager vs generate/resend from Shopify). Retrieval and resolution are blocked by knowledge gap plus business-process decision. Keep inactive until both are resolved.

#### g-040

- source_case_id: g-040
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: checkout_issue
- grading_mode: content_only
- missing context: None; checkout-region guidance is content-only.
- relevant knowledge: 3952
- expected resolution: Tell the customer to click the globe icon and select the correct region (Australia & New Zealand), then retry checkout. Answerable on content.
- open questions: None.
- review_notes: Source label 'tracking' was a clear mislabel; correctly remapped to checkout_issue (region not selectable). The globe-icon / region-selector answer is content-gradable. Only checkout_issue case in the suite — keep as the representative.

#### g-016

- source_case_id: g-016
- benchmark_status: READY_FULL
- manual_reviewed: true
- expected_intent: partnership_request
- grading_mode: content_only
- missing context: None; partnership contact answer is content-only.
- relevant knowledge: 3713, 3650
- expected resolution: Provide the partnership inquiry email address. Answerable on content.
- open questions: Confirm the partnership email is current.
- review_notes: Raw 'other' remapped to partnership_request. Answer is simply the partnership email address (retrievable). Content-gradable. Only partnership_request case — keep as the representative. Confirm the partnership email in knowledge is current.

## Per-case review

Compact operational view of the same gate. Active rows are the only rows that should be imported as executable benchmark cases before enrichment.

| Case | benchmark_status | A | EI | GM | Chunks | Review blocker / note |
|------|------------------|---|----|----|--------|-----------------------|
| g-002 | READY_FULL | ✓ | technical_support | content_only | 3972, 3795, 3944 | Clean hardware-fault troubleshooting; pairing/firmware/hang-up guides are retrievable. Intent, resolution and retrieval all gradable on content. No missing data. |
| g-003 | READY_FULL | ✓ | technical_support | content_only | 3813, 3643, 3642 | App pairing fault; forget-device + ANC pairing guide retrievable. Fully gradable on content. |
| g-005 | NEEDS_REVIEW | ✗ | technical_support | order_context_required | 3835, 3948, 3990 | Reopened ticket: the gold reply explicitly references an earlier firmware-update attempt that is not in this message and not reconstructable. Missing thread history blocks fair resolution grading. Reconstruct prior turns before activating; intent alone (technical_support) is gradable but the case is not benchmark-trustworthy as-is. |
| g-007 | READY_FULL | ✓ | technical_support | content_only | 3833, 3944, 3978 | Power-off-while-charging fault; standby-timer + driver/reset guides retrievable. Fully gradable on content. Representative of the g-046 cluster. |
| g-009 | READY_FULL | ✓ | technical_support | content_only | 3837, 3895, 3331 | Customer-already-tried (other PC + cables); gold reply correctly continues troubleshooting before any swap. Troubleshooting knowledge retrievable. Fully gradable on content; exchange is only a documented secondary intent. |
| g-023 | READY_FULL | ✓ | technical_support | content_only | 3649, 3948, 3929 | Dongle re-pair / driver-reinstall guide retrievable; gold reply troubleshoots before offering a replacement. Fully gradable on content. |
| g-031 | NEEDS_REVIEW | ✗ | technical_support | order_context_required | 3877, 3879, 3807 | Genuine multi-turn DE follow-up; the gold reply leans on an earlier troubleshooting mail + an engineering escalation that are only partially quoted and not cleanly reconstructable. Missing thread history blocks resolution grading. Reconstruct prior turns into thread_history_json before activating. |
| g-043 | READY_FULL | ✓ | technical_support | content_only | 3813, 3931, 3642 | Customer-already-tried (factory reset + other phone); firmware-updater + pairing guide retrievable. Fully gradable on content. Raw 'unknown' confidently remapped to technical_support. |
| e-001 | READY_FULL | ✓ | technical_support | content_only | 3948, 3990, 3649 | Short synthetic edge prompt with a clean dongle re-pair facit and must_contain('dongle'). Content-only, fully gradable. Kept as a deliberate minimal-context positive control. |
| g-008 | NEEDS_REVIEW | ✗ | exchange_request | order_context_required | 3964, 3758, 3638 | Intent and retrieval are gradable, but the gold premise (still covered by warranty for a cracked holder after about one year) depends on real purchase date and an AceZone decision on whether normal-use cracking is covered. Keep inactive until both order_context and warranty policy are resolved. |
| g-012 | READY_PARTIAL | ✓ | exchange_request | order_context_required | 3964, 3986, 3758 | Clear single-intent exchange; gold reply only asks for photo + order number, so intent + retrieval are fully gradable now. Swap execution / warranty-window check needs order_context enrichment. Good partial-baseline case. |
| g-045 | READY_PARTIAL | ✓ | exchange_request | order_context_required | 3986, 3758, 3638 | Raw 'unknown' confidently remapped to exchange_request. The 'beyond 30-day period' framing depends on the real purchase date (order_context). Intent + retrieval gradable now; the swap/warranty decision is deferred. Solid partial case. |
| g-013 | READY_PARTIAL | ✓ | refund_request | order_context_required | 3758, 3054, 3978 | Customer explicitly prefers refund, exchange as fallback (clean primary/secondary split). 30-day return policy is the retrieval target. Refund-vs-exchange decision needs order date (order_context). Intent + retrieval gradable now; strong partial case. |
| g-027 | READY_PARTIAL | ✓ | refund_request | order_context_required | 3974, 3651, 3054 | Follow-up whose recap is fully self-contained in the message body (so no external thread history needed). Mic-switch knowledge + return address are the retrieval targets. Refund/return execution needs order_context. Intent + retrieval gradable now; good partial case. |
| g-028 | READY_PARTIAL | ✓ | refund_request | order_context_required | 3899, 3657, 3758 | Key retrieval target is the A-Rise-specific repair-only policy (distinct from A-Spire return path). Out-of-30-day determination needs order date. Intent + retrieval gradable now. Note: this case is the canonical A-Rise policy — e-002's contradictory facit should defer to this one. |
| g-033 | READY_FULL | ✓ | return_request | content_only | 3913, 3651, 3192 | Policy-driven 'how does a return work' question; the canonical 30-day return policy chunk fully answers it without order lookup. Resolution + retrieval gradable on content. The diminished-value deduction is policy text, not order-specific here. |
| g-047 | READY_FULL | ✓ | return_request | content_only | 3919, 3913, 3651 | Raw 'unknown' remapped to return_request (the question is whether a used return is reimbursable). The 30-day-even-if-opened policy chunk answers it on content. Resolution + retrieval gradable. Refund is a documented secondary intent. |
| g-032 | NEEDS_REVIEW | ✗ | refund_request | order_context_required | 3057, 3192, 3651 | Intent (refund_request) is gradable, but the entire expected resolution is order/refund-status data — approval state, debit date, and a 50 EUR diminished-value deduction — none of which exists without order + refund-record enrichment. The deduction amount is also a per-case business decision. No trustworthy content facit; keep inactive until enriched. Borderline EXCLUDE if enrichment never lands. |
| e-002 | EXCLUDE | ✗ | exchange_request | content_only | 3758, 3899, 3638 | EXCLUDE: the synthetic edge facit says the A-Rise is 'covered by warranty' and should be replaced, which directly contradicts the real A-Rise repair-only policy seen in g-028 (and warranty coverage would itself depend on the purchase date). Inconsistent, unverifiable facit — not usable for benchmark. Drop rather than enrich; g-028 already covers A-Rise policy correctly. |
| e-004 | READY_FULL | ✓ | exchange_request | content_only | 3964, 3986, 3638 | Edge case done right: the gold reply makes no warranty assertion, it only requests order number + photo (must_contain 'order', must_not_contain a name). Fully content-gradable with no order data needed. Good minimal-context positive control for the exchange intake step. |
| g-036 | READY_PARTIAL | ✓ | order_status | order_context_required | 3958, 3145 | Order-status request; the substantive answer (where the order is, expected ship date) needs real fulfillment data. Intent + retrieval gradable now. Note: gold reply's 'warehouse delay' is a point-in-time fact — when enriched, treat resolution as 'report accurate current fulfillment state', not this specific phrasing. |
| g-037 | READY_PARTIAL | ✓ | order_status | order_context_required | 3958, 3145 | Representative of the warehouse-delay order-status cluster (g-038/g-039 excluded as near-duplicates). Substantive answer needs fulfillment data. Intent + retrieval gradable now. The 'payment not captured yet' detail is real order data to enrich, not a content facit. |
| g-041 | READY_PARTIAL | ✓ | tracking | order_context_required | 3958, 3954 | Specific shipment/carrier (DAO) tracking question. Concrete shipment status needs order/shipment data. Intent + retrieval gradable now. Good partial case to distinguish tracking from generic order_status. |
| g-014 | READY_PARTIAL | ✓ | order_status | order_context_required | 3958, 3638 | Raw 'other' remapped to order_status (whereabouts of a delivered-but-missing order). The gold reply's 'could not locate the order' itself depends on the order lookup, so resolution needs order_context. Intent + retrieval gradable now. Possible lost-in-transit/claim business policy to define for full grading. |
| g-001 | READY_PARTIAL | ✓ | address_change | order_context_required | 3952, 3638 | Address change blocked on an unrecognized order number; the gold reply (ask where the purchase was made) is itself driven by the failed order lookup, so resolution needs order_context. Intent + retrieval gradable now. Clean primary intent. |
| g-004 | READY_FULL | ✓ | complaint | content_only | 3715, 3716 | Tricky intent call resolved well: the cancellation already failed, so there's no live cancel workflow — it's a complaint with cancel_order as secondary. The correct answer is a policy explanation (shipped orders can't cancel + 30-day return), retrievable and content-gradable. Verifies the complaint-vs-workflow rule. |
| g-020 | READY_FULL | ✓ | product_question | content_only | 3929, 3948 | Core answer ('yes, a replacement dongle is purchasable') is content-gradable; the order number is only for follow-up, not blocking. Spare-part knowledge retrievable. Open question for full confidence: confirm a replacement dongle is actually sold as a spare on the store. |
| g-021 | READY_FULL | ✓ | product_question | content_only | 3881, 3895 | Good multi-question case (latest firmware + audio quality). Answer rests on product facts: 146 is latest for A-Spire and A-Spire has no EQ management. Content-gradable. Open question for full confidence: verify '146 is latest' and 'no EQ' are current product facts, since firmware versions drift over time. |
| g-022 | READY_FULL | ✓ | product_question | content_only | 3883, 3976, 3962 | Earpad Wired-vs-Wireless compatibility question; product knowledge retrievable. Content-gradable. Open question: the 20% discount upgrade offer is a commercial gesture — confirm whether AceZone wants that as standard guidance or treat it as an agent discretionary action (business decision for the action layer, not for intent/retrieval grading). |
| g-015 | NEEDS_REVIEW | ✗ | product_question | content_only | 3929, 3638 | Customer misplaced/lost the receiver, but the gold reply asks for images of damages and frames the path as warranty coverage. That mismatch makes the expected resolution uncertain. AceZone needs to define whether a lost receiver is replaceable and at what cost/process before this can become benchmark-trustworthy. |
| g-044 | NEEDS_REVIEW | ✗ | invoice_request | content_only | None (knowledge gap) | Clear invoice_request intent, but no invoice-handling chunk exists and the correct process is undefined (route to shop manager vs generate/resend from Shopify). Retrieval and resolution are blocked by knowledge gap plus business-process decision. Keep inactive until both are resolved. |
| g-040 | READY_FULL | ✓ | checkout_issue | content_only | 3952 | Source label 'tracking' was a clear mislabel; correctly remapped to checkout_issue (region not selectable). The globe-icon / region-selector answer is content-gradable. Only checkout_issue case in the suite — keep as the representative. |
| g-016 | READY_FULL | ✓ | partnership_request | content_only | 3713, 3650 | Raw 'other' remapped to partnership_request. Answer is simply the partnership email address (retrievable). Content-gradable. Only partnership_request case — keep as the representative. Confirm the partnership email in knowledge is current. |

## Taxonomy remapping notes (source → target)

- All `complaint` raw labels on hardware faults (g-002, g-003, g-005, g-007) → **technical_support**
  per the rule "technical faults → technical_support even when the customer is unhappy".
- `complaint` is reserved for g-004 (no live workflow — cancellation already failed, pure venting).
- `unknown` raw labels remapped to the most precise category: g-043→technical_support,
  g-044→invoice_request, g-045→exchange_request, g-047→return_request.
- `other` remapped: g-014→order_status, g-015→product_question, g-016→partnership_request.
- `tracking` raw on g-040 was a source mislabel → **checkout_issue**.
- No compound labels: source `return|refund` (g-035, excluded) would have split into a
  primary + secondary; the kept refund/return/exchange cases each carry one primary EI and
  store the rest in `secondary_intents`.

## Excluded cases (11) and why

- **g-006** — near-duplicate of g-003 (app pairing spin). Kept g-003.
- **g-019** — near-duplicate of g-002/g-007 (random power-off + factory reset). Kept those.
- **g-046** — verbatim-ish duplicate of g-007 (same power-off-while-charging text). Kept g-007.
- **g-024** — near-duplicate troubleshooting of e-001/g-002 (won't power on). Kept those.
- **g-038, g-039** — same canned "warehouse delay" reply as g-037. Kept g-037 as representative.
- **g-034** — near-duplicate of g-027/g-033 (US refund return-address). Kept g-027.
- **g-035** — source `return|refund` compound; overlaps g-013/g-028 (mic warranty review). Held out
  to avoid a third near-identical mic-warranty case.
- **g-029** — overlaps g-027/g-013 (multiple-defect refund plea); kept the cleaner g-013/g-027.
- **g-011** — bare address/tracking fragment with no standalone customer intent (provisioning a swap
  shipment mid-thread). Not gradable as a single message.
- **g-025** — thank-you + spare-cable offer; reply is order-context-only with no standalone facit.

## Open items before a baseline run

1. **Order enrichment**: the 10 active `order_context_required` cases can be graded on intent + retrieval now; facts/action grading needs anonymized real order data attached to `order_context_json`. Do NOT invent it. Cases: g-012, g-045, g-013, g-027, g-028, g-036, g-037, g-041, g-014, g-001.
2. **Inactive review cases**: keep g-005, g-031, g-008, g-032, e-002, g-015, g-044 inactive until their blockers are resolved.
3. **Invoice knowledge gap (g-044)**: no `agent_knowledge` chunk covers invoices — either add one and define the process, or keep the case as a deliberate inactive knowledge-gap probe.
4. **Business decisions**: g-008 (cracked holder warranty), g-014 (delivered-but-missing policy), g-015 (lost receiver replacement), g-020 (spare dongle availability), g-021 (current firmware/EQ facts), g-022 (20% discount policy), g-044 (invoice process), g-016 (partnership email currency).
5. **Chunk-id verification**: `gold_knowledge_chunk_ids` are bigint `agent_knowledge.id` values. Verify they still resolve for this shop before trusting hit@k, and compare ids with `String(id)` normalization.
