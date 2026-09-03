# Sona Greenfield Support Agent — Real Quality Baseline

Run date: 2026-09-03  
Branch/worktree: `experiment/greenfield-support-agent` / `/Users/jonashoppe/Developer/INNO-greenfield-support-agent`  
Runtime: `@openai/agents` 0.17.0, one `Agent`, one `Runner`, `withTrace`  
Model: `gpt-5.2` (no `OPENAI_MODEL` override was configured)  
Cases: 17 representative cases, all with `history: []`  
Execution: real OpenAI model/API execution; no mocks; complete run finished with exit code 0  
Commerce writes: none executed; write-capable paths returned proposal-only actions requiring confirmation.

An earlier streamed attempt ended after three cases and was discarded. The results below are from the subsequent complete 17-case run from scratch, before any tuning.

## Scoring

Each vector is `F/C/P/T/A/N/Q/U/O`:

- `F` factual correctness
- `C` completeness
- `P` policy adherence and grounding
- `T` tool and knowledge use
- `A` operational action handling
- `N` natural tone
- `Q` avoidance of unnecessary questions (10 is best)
- `U` avoidance of unsupported claims (10 is best)
- `O` overall sendability quality

Sendability is the practical judgment for whether the exact response could be sent as-is: `YES`, `MINOR EDIT`, or `NO`.

## A. Quality baseline

- Average overall score: **8.14/10**.
- Overall score buckets: **0–3: 0**, **4–5.9: 1**, **6–7.9: 7**, **8–8.9: 2**, **9–10: 7**.
- Sendability: **YES 7/17 (41.2%)**, **MINOR EDIT 7/17 (41.2%)**, **NO 3/17 (17.6%)**.
- Nine cases scored at least 8.0 overall; seven scored at least 9.0.
- Average dimensions: factual **9.29**, completeness **8.71**, policy **8.29**, tool use **7.76**, action handling **8.06**, tone **8.35**, question discipline **7.00**, unsupported-claim avoidance **8.12**.
- No tool execution errors were observed. The quality losses were primarily grounding, retrieval selection, unnecessary questioning, and premature proposal readiness—not runtime failure.

## B. Full case table

| Case | Customer message | Tools / knowledge used | Score `F/C/P/T/A/N/Q/U/O` | Sendability | Main issue |
|---|---|---|---:|---|---|
| `gf-wismo-01` | Where is order #10231? | `get_tracking(10231)`, `inspect_fulfillment(10231)`; live ParcelCo in-transit result | 10/9/9/8/10/8/5/8/**8.1** | MINOR EDIT | Unnecessary request for shipping postcode after verified tracking answer |
| `gf-order-status-01` | Has order #10232 been sent yet? | `get_order(10232)`, `inspect_fulfillment(10232)`; live paid/processing, no shipment | 10/9/9/9/10/8/5/9/**8.5** | MINOR EDIT | Unnecessary date and country follow-up |
| `gf-tracking-01` | Can you check the tracking for #10231? | `get_tracking({order_id:"#10231"})`; live ParcelCo result | 10/10/10/9/10/9/10/10/**9.8** | YES | No material issue |
| `gf-delay-01` | My order #10233 is delayed and the tracking has an exception. | Tracking + fulfillment; low-score wrong damaged procedure; shipping policy; brand guidance | 8/7/6/7/6/8/4/4/**6.1** | NO | Speculates about exception causes and asks several questions without a verified remedy |
| `gf-return-policy-01` | What is your return window? | `search_policy`; authoritative Returns and exchanges result | 10/9/10/9/10/9/9/10/**9.6** | YES | No material issue |
| `gf-return-request-01` | I want to return item line-10234 from order #10234. | `search_policy`; `get_order(10234)`; authoritative return policy and delivered item | 9/8/8/8/5/8/6/10/**7.5** | MINOR EDIT | Correctly asks eligibility details, but does not yet make the next action/proposal explicit |
| `gf-cancellation-01` | Please cancel order #10232 before it ships. | `get_order(10232)`; proposal-only `cancel_order` | 9/8/7/8/8/7/5/6/**7.2** | MINOR EDIT | Redundant confirmation and stronger-than-grounded “eligible to cancel” claim |
| `gf-address-01` | Can you change the delivery address for order #10232? | Wrong low-score procedure hits; `get_order(10232)`; proposal-only `update_address(address:"TBD")` | 8/8/5/5/3/8/6/5/**5.6** | NO | Creates a proposal with a placeholder before the required address exists |
| `gf-damaged-01` | My Orion Wireless arrived damaged. What do you need from me? | Damaged procedure; warranty/refund/returns policies; brand guidance | 8/9/7/8/8/9/5/5/**7.3** | MINOR EDIT | Adds shipping-label, outer-box, and internal-packaging requirements not clearly grounded in retrieved policy |
| `gf-replacement-01` | The headset is defective. I want a replacement for order #10234. | `get_order(10234)`; defective-item policy search; proposal-only `send_replacement` | 9/8/6/5/4/8/6/6/**6.5** | NO | Detects item mismatch but prepares a replacement proposal before confirmation and eligibility verification |
| `gf-refund-question-01` | When will my refund arrive after you receive the return? | `search_policy`; authoritative Refund timing and Returns results | 10/9/10/9/10/9/9/10/**9.6** | YES | No material issue |
| `gf-product-01` | Does the Orion Wireless support Bluetooth? | `search_product_knowledge`; authoritative product reference | 10/10/10/9/10/9/10/10/**9.8** | YES | No material issue |
| `gf-compatibility-01` | Are the Orion replacement ear pads compatible with Orion Wired? | `search_product_knowledge`; authoritative compatibility reference | 10/10/10/9/10/9/10/10/**9.8** | YES | No material issue |
| `gf-warranty-01` | How long is the warranty for a manufacturing defect? | `search_policy`; authoritative Warranty result | 10/9/10/9/10/9/10/10/**9.7** | YES | No material issue |
| `gf-missing-info-01` | I need to change something on an order. | Low-quality procedure retrieval; `get_order_history` returning four orders | 8/8/7/6/7/7/4/7/**6.8** | MINOR EDIT | Over-answers with broad order history and retrieves irrelevant procedures before asking the needed question |
| `gf-ambiguous-01` | It is not working. Can you help? | `get_brand_guidance`; low-score generic tone result | 9/8/8/5/8/8/6/9/**7.4** | MINOR EDIT | Correctly asks for context, but asks a broad checklist and makes an unnecessary low-value knowledge call |
| `gf-multi-intent-01` | Where is order #10231, and if it is delayed I want to return it. | `get_order(10231)`, `get_tracking(10231)`, `search_policy`; live shipment + authoritative return/shipping policy | 10/9/9/9/8/9/9/9/**9.0** | YES | No material issue; correctly handles both intents without starting an unverified return |

## Per-case capture

All cases had no prior conversation history (`history: []`). The following records preserve the customer input, the application-level tool trace, key retrieved/live data and provenance, the exact response, and proposed actions. A successful live lookup is evidence about the case; it is not itself a merchant-policy instruction.

### `gf-wismo-01`

Trace: `get_tracking({order_id:"10231"})` → live ParcelCo `PC10231`, `in_transit`, tracking URL `https://tracking.example.test/PC10231`, observed `2026-09-03T08:00:00Z`; `inspect_fulfillment({order_id:"10231"})` → fulfilled, same tracking. No errors. No proposed actions.

Exact response:

> Order **#10231** has shipped and is currently **in transit** with **ParcelCo**.
>
> - **Tracking number:** PC10231  
> - **Tracking link:** https://tracking.example.test/PC10231  
> - **Latest scan:** **2026-09-03 08:00 UTC** (In transit)
>
> If you tell me your **shipping ZIP/postcode**, I can help confirm it’s headed to the right area.

### `gf-order-status-01`

Trace: `get_order({order_id:"10232"})` → order `#10232`, paid, processing, no fulfillment; `inspect_fulfillment({order_id:"10232"})` → no shipment. No errors. No proposed actions.

Exact response:

> Order **#10232 hasn’t been sent yet**. It’s currently **paid** and still **processing**, with **no fulfillment/shipment created** yet.
>
> If you’d like, tell me whether you need it by a specific date (and your shipping country), and I can advise on the fastest option.

### `gf-tracking-01`

Trace: `get_tracking({order_id:"#10231"})` → live ParcelCo `PC10231`, `in_transit`, observed `2026-09-03T08:00:00Z`, tracking URL as above. No errors. No proposed actions.

Exact response:

> Tracking for **order #10231** shows it’s currently **in transit**.
>
> - **Carrier:** ParcelCo  
> - **Tracking #:** PC10231  
> - **Latest update:** 2026-09-03 08:00 UTC  
> - **Tracking link:** https://tracking.example.test/PC10231

### `gf-delay-01`

Trace: `get_tracking(10233)` → ParcelCo `PC10233`, `exception`; `inspect_fulfillment(10233)` → fulfilled, exception. `get_procedure` for a tracking exception incorrectly returned **Damaged item procedure** (procedural authority, score 0.0583). `search_policy` returned authoritative **Refund timing** (0.4676), **Shipping and dispatch** (0.1954), and **Returns**. `get_brand_guidance` returned the tone guide. No errors. No proposed actions.

Exact response:

> I checked order **#10233** and the carrier is showing a **tracking exception** with ParcelCo.  
> Tracking: **PC10233** — https://tracking.example.test/PC10233
>
> A “tracking exception” usually means the carrier hit an issue in transit (common ones: address problem, missed delivery, or a processing delay). The tracking page typically has the most specific note—can you tell me what the exception message says there (or paste a screenshot/text)?
>
> Also, please confirm:
> 1) Is your shipping address the same as what you used at checkout?  
> 2) Do you see any option in the tracking link to **schedule redelivery** or **update address / pickup**?
>
> Once I have the exception note, I can tell you the fastest next step (and if we need to escalate it on our side).

### `gf-return-policy-01`

Trace: `search_policy({query:"Sona return window length and conditions"})` → **Returns and exchanges**, `policy-returns-v1`, authoritative, score 0.3908, structured data `return_window_days:30`, `return_condition:unused_original_packaging`; also a lower-ranked Shipping and dispatch result. No errors. No proposed actions.

Exact response:

> Our return window is **30 days from delivery**.
>
> To be eligible, items should be **unused** and in their **original packaging**. If you’d like to start a return, send your **order number** and tell me **which item(s)** you want to return, and I’ll share the next steps.

### `gf-return-request-01`

Trace: `search_policy` for return requirements → authoritative Returns and exchanges; `get_order({order_id:"10234"})` → delivered order containing `line-10234`, Orion replacement ear pads. No errors. No executed write. No proposed action was returned.

Exact response:

> I can help with that. Order **#10234** shows **line-10234 (Orion replacement ear pads)** was **delivered**.
>
> Per our returns policy, returns can be requested **within 30 days of delivery**, and items should be **unused and in the original packaging**.
>
> Before I start the return request, can you confirm:
> 1) Was the item **unused** and in **original packaging**?  
> 2) Is this return because it’s **defective/wrong item**, or just **no longer needed**? (This affects whether return shipping is covered.)

### `gf-cancellation-01`

Trace: `get_order({order_id:"10232"})` → paid, processing, no fulfillment; proposal-only `cancel_order({order_id:"10232",reason:"Customer requested cancellation before shipment."})` → proposed, confirmation required. No write executed.

Exact response:

> Order **#10232** is currently **processing** and shows **no fulfillment/shipment yet**, so it’s still eligible to cancel.
>
> I can **submit the cancellation request now**. Please confirm: **Cancel order #10232 (Orion Wired, €89.00) for a full cancellation before it ships?**
>
> This is only a proposal and has not been completed. Would you like me to submit it for confirmation?

Proposed action: `cancel_order`, order `10232`, reason as above, `requiresConfirmation: true`, status `proposed`.

### `gf-address-01`

Trace: `get_procedure` for address change incorrectly returned **Damaged item procedure** and **Cancellation procedure**; `get_order(10232)` → paid, processing, no fulfillment; `get_brand_guidance` → no result. Proposal-only `update_address({order_id:"10232",address:"TBD",reason:"Customer requested delivery address change"})` was created even though the address was missing. No write executed.

Exact response:

> I can help with that. Order **#10232** is currently **processing** (not fulfilled yet), so an address change should still be possible.
>
> Please reply with the **full new delivery address** exactly as it should appear (name, street + number, apt/unit if any, city, state/province, postal code, country, and a phone number if required by the courier).
>
> Once you send it, I’ll submit the **address update proposal** for your confirmation before anything is changed.

Proposed action: `update_address`, order `10232`, address `TBD`, reason as above, confirmation required, status `proposed`.

### `gf-damaged-01`

Trace: `get_procedure` for damaged item → authoritative Damaged item procedure plus irrelevant Cancellation procedure; `search_policy` → authoritative Warranty, Refund, and Returns; `get_brand_guidance` → no result. No errors. No proposed actions.

Exact response:

> Sorry that arrived damaged—here’s what I need to get this handled quickly:
>
> 1) **Order number** (or the email/name used at checkout)  
> 2) **What’s damaged** (quick description of the issue)  
> 3) **Photos**:
>    - Clear photo(s) of the **damage on the Orion Wireless**
>    - Photo of the **outer shipping box** (showing any dents/tears)
>    - Photo of the **shipping label** on the box
>    - Photo of the **internal packaging** (how it was packed)
>
> Once you send those, I can review it against our return/warranty options and guide you to the next step (replacement/return as eligible).

### `gf-replacement-01`

Trace: `get_order(10234)` → delivered order containing **Orion replacement ear pads**, not a headset. `search_policy` for defective items → authoritative Returns, Warranty, and Shipping results. Proposal-only `send_replacement({order_id:"10234",item_id:"line-10234",reason:"Customer reports defective headset and requests replacement."})` was created. No write executed.

Exact response:

> I can help with that. I’ve pulled up order **#10234** and it shows **delivered**.
>
> One quick check: order #10234 contains **“Orion replacement ear pads”** (not a headset). Is that the item that’s defective, or are you referring to a different order/item?
>
> Per our policy, defective items are covered and we’ll just need:
> 1) A brief description of the defect (what’s happening)  
> 2) **Clear photos** showing the issue (and packaging if available)
>
> If you confirm it’s the ear pads, I have a **replacement proposal ready** for order **#10234** (it won’t be requested until you confirm).

Proposed action: `send_replacement`, order `10234`, item `line-10234`, confirmation required, status `proposed`.

### `gf-refund-question-01`

Trace: `search_policy({query:"refund timing after return received"})` → authoritative **Refund timing**, score 0.4676, with **Returns** 0.2792 and **Shipping** 0.1396. No errors. No proposed actions.

Exact response:

> Once we **receive and approve your return**, we typically **process the refund within 5 business days**.
>
> After we process it, your **bank/payment provider may take additional time** to post the funds to your account (timing varies by provider), so we can’t promise an exact “arrival” date.
>
> If you share your **order number**, I can help confirm where your return/refund is in the process.

### `gf-product-01`

Trace: `search_product_knowledge` → authoritative Orion Wireless manual/product reference, score 0.4748, plus irrelevant lower-ranked Orion ear pads result at 0.3016. No errors. No proposed actions.

Exact response:

> Yes. The **Orion Wireless** supports **Bluetooth**, and it also works with the **included USB receiver** (for computers with a USB‑A port; you can use a compatible USB‑C adapter if needed). It isn’t compatible with arbitrary third‑party receivers.

### `gf-compatibility-01`

Trace: `search_product_knowledge` → authoritative compatibility reference for Orion replacement ear pads, score 0.9497, plus irrelevant Orion Wireless result. No errors. No proposed actions.

Exact response:

> Yes. Sona’s **Orion replacement ear pads are compatible with both Orion Wireless and Orion Wired** headsets (they’re just not compatible with the Nova speaker series).

### `gf-warranty-01`

Trace: `search_policy` → authoritative Warranty result, score 0.6547, structured warranty period 24 months from delivery. No errors. No proposed actions.

Exact response:

> Sona’s warranty for **manufacturing defects is 24 months from the delivery date**.
>
> If you’re seeing an issue, share your **order number**, a brief description of the defect, and **clear photos**, and I’ll help with the next steps (repair/replacement review).

### `gf-missing-info-01`

Trace: `get_procedure` for changing an order → incorrectly returned low-score **Damaged item procedure** (0.0306) and **Cancellation procedure** (0.0306); `get_order_history` → all four fixture orders `#10231`–`#10234`. No errors. No proposed actions.

Exact response:

> I can help—please tell me **what you want to change** (item/variant, quantity, shipping address, or cancel). The change type determines what’s possible and what information I need.
>
> I can see a few recent orders in your account: **#10231 (Orion Wireless)**, **#10232 (Orion Wired)**, **#10233 (Nova speaker)**, and **#10234 (Orion replacement ear pads)**. Which order number should I apply the change to?
>
> Note: if an order is already shipped/in transit, changes usually aren’t possible—then we’d look at return/exchange options instead.

### `gf-ambiguous-01`

Trace: `get_brand_guidance` for generic troubleshooting → low-score brand result (0.0184), source `brand-tone-v1`, authority `guidance`. No errors. No proposed actions.

Exact response:

> Yes—I can help. To troubleshoot quickly, what *isn’t working* exactly?
>
> Reply with:
> 1) The product name (or a link) and where you bought it (Sona order # if you have it)  
> 2) What you expected to happen vs what happens instead (any error message?)  
> 3) When it started and what device/app you’re using (iPhone/Android/Windows/Mac, app version if relevant)  
> 4) What you’ve already tried
>
> If you can, also send a photo/screenshot of the issue.

### `gf-multi-intent-01`

Trace: `get_order(10231)` → order fulfilled, paid, Orion Wireless, total €149.00, fulfillment in transit; `get_tracking(10231)` → ParcelCo `PC10231`, observed `2026-09-03T08:00:00Z`; `search_policy` → authoritative Returns and exchanges (`30 days from delivery`, unused/original packaging) and Shipping and dispatch (`1–2 business days`, live status required). No errors. No proposed actions.

Exact response:

> Order **#10231** has shipped and is currently **in transit** with **ParcelCo**.
>
> - **Tracking #:** PC10231  
> - **Tracking link:** https://tracking.example.test/PC10231  
> - **Latest update:** *In transit* (as of **2026-09-03 08:00 UTC**)
>
> On the return request: our policy allows **returns within 30 days of delivery** (items unused and in original packaging). So if it’s delayed, we can’t start a standard return *until it’s delivered*—but once it arrives, I can help you kick off the return right away.
>
> If you’d still prefer not to receive it, tell me and I’ll advise the best next step (it depends on whether ParcelCo allows interception/return-to-sender for this shipment).

## C. Best three

1. **`gf-compatibility-01` — 9.8, YES.** It selected the exact compatibility record, answered directly, and added a useful but still grounded exclusion (Nova speaker series).
2. **`gf-warranty-01` — 9.7, YES.** It gave the exact authoritative period, anchored it to delivery, and requested only the evidence needed for a follow-up.
3. **`gf-multi-intent-01` — 9.0, YES.** It resolved both live shipment status and the conditional return question in one response, without claiming a return had started or inventing an interception capability.

## D. Worst three with traces

### 1. `gf-address-01` — 5.6, NO

The order lookup was useful, but the procedure retriever returned unrelated Damaged item and Cancellation procedures. More importantly, the model called proposal-only `update_address` with `address: "TBD"` before the customer supplied the required address. The response also said an address change “should still be possible” without an authoritative address-change rule. The write was not executed, but the action proposal was not ready for presentation.

### 2. `gf-delay-01` — 6.1, NO

Live tracking correctly established an exception, but procedure retrieval returned the wrong damaged-item procedure. The response then speculated that the exception commonly meant an address problem, missed delivery, or processing delay, none of which was present in the live result, and asked for address/redelivery details without a verified carrier exception note or merchant next-step procedure.

### 3. `gf-replacement-01` — 6.5, NO

The model correctly detected that order `#10234` contained replacement ear pads rather than a headset. However, it still created a `send_replacement` proposal for `line-10234` before the customer confirmed the item and before defect eligibility was established. Proposal-only safety prevented an actual write, but the action state was premature.

## E. Root causes

1. **Retrieval acceptance is too permissive.** Low-score, semantically wrong procedural and brand results were accepted as context. This affected the delay, address, missing-information, and ambiguous cases. The agent needs a general abstention/authority decision rather than treating any returned hit as useful.
2. **The action boundary does not enforce readiness strongly enough.** Placeholder arguments (`TBD`) and proposals made before item identity or eligibility confirmation reached the proposal layer. This is a deterministic contract problem, not a need for another model or another agent.
3. **The response guidance over-collects information.** The agent often asks for postcode, country/date, shipping-label details, or a full troubleshooting checklist even when the verified answer is already sufficient or a single clarifying question would do.
4. **Some operational claims are inferred from state rather than policy.** “Eligible to cancel” and “address change should still be possible” go beyond the retrieved authoritative evidence. Live order state should establish facts about the order, while merchant procedures should establish what action is allowed.
5. **Tool selection is occasionally broader than necessary.** For a missing order/change request, `get_order_history` returned four orders before the customer identified the target. For straightforward WISMO, the extra fulfillment inspection was redundant after tracking was already decisive.

## F. Architecture observation

The small architecture is already capable of strong behavior on direct policy, product, warranty, tracking, and multi-intent questions: 7 cases were sendable as-is and 9/17 scored at least 8.0. The three worst cases all failed around evidence/action boundaries, not because the single-agent loop could not reason over the case. The current `Agent → tenant-scoped tools → verified result → response/proposal` shape is therefore a credible baseline.

The run also confirms the safety separation: tenant and authorization checks remained deterministic, provider access was read-only, tool failures were not observed, and proposal-only actions were not presented as completed writes. The remaining risk is that a proposal can still be structurally present before its inputs are genuinely ready.

## G. Complexity check

Do **not** add Master Agent, router, intent classifier, Policy Agent, Ticket Agent, planner, repair agent, extra validation model calls, or another orchestration stage based on this baseline. The failures are coherent and general: retrieval abstention, authoritative grounding, question discipline, and pre-action readiness. They can be improved inside the existing knowledge/capability boundary and primary agent prompt/tool contract.

## H. Exactly one next improvement — recommendation only

**Recommend strengthening the existing deterministic capability boundary with one action-readiness gate:** proposal tools must reject missing or placeholder arguments and require verified order/item identity plus the required policy/eligibility facts before returning a proposal. Do not implement this as part of the baseline run; measure it as the next isolated change against the same 17 cases.
