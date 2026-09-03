# Greenfield support baseline

Run date: 2026-09-03

## What was run

The offline contract baseline exercised all 17 fixed cases in
`supabase/eval/greenfield-support-cases.json` against the tenant-neutral demo
fixture in `apps/web/lib/greenfield-support/demo-fixtures.ts`.

Result: **17/17 contract cases passed**.

The environment did not contain `OPENAI_API_KEY`, so no external model-quality
score is claimed. The five model/tool-loop tests use scripted models to prove
the legacy contract loop and the primary OpenAI Agents SDK runtime, including
trace, live lookup, and proposal boundaries. The native Responses adapter is
retained only as a comparison seam; the route uses the Agents SDK runtime.

## Case-by-case evidence

In the list below, “final response” is marked `N/A` when a real model was not
run. The contract result means that the expected retrieval/capability path,
tenant scope, and proposal-only behavior were available and returned without a
contract error.

1. **gf-wismo-01 — “Where is order #10231?”** Required facts: order number,
   current tracking status, tracking link. Knowledge retrieved: none; live data
   is required. Tools: `get_order` → fixture order `10231`, fulfilled/paid;
   `get_tracking` → ParcelCo, `PC10231`, `in_transit`, tracking URL. Proposed
   action: none. Final response: N/A. Result: **PASS**; no failure.

2. **gf-order-status-01 — “Has order #10232 been sent yet?”** Required facts:
   fulfillment status. Knowledge retrieved: none. Tool: `get_order` → order
   `10232`, paid, processing, not fulfilled. Proposed action: none. Final
   response: N/A. Result: **PASS**; no failure.

3. **gf-tracking-01 — “Can you check the tracking for #10231?”** Required
   facts: carrier, tracking number, current status. Knowledge retrieved: none.
   Tool: `get_tracking` → ParcelCo / `PC10231` / `in_transit` / tracking URL.
   Proposed action: none. Final response: N/A. Result: **PASS**; no failure.

4. **gf-delay-01 — “My order #10233 is delayed and the tracking has an
   exception.”** Required facts: current exception and next step. Knowledge:
   `policy-shipping-v1`, “Merchant shipping policy”; it is authoritative and
   says live shipment state must be checked. Tools: `search_policy`,
   `get_order`, `get_tracking`; tracking returns ParcelCo / `PC10233` /
   `exception`. Proposed action: none. Final response: N/A. Result: **PASS**;
   no failure.

5. **gf-return-policy-01 — “What is your return window?”** Required facts: 30
   days and item condition. Knowledge: `policy-returns-v1`, “Merchant returns
   policy”, authoritative, structured `return_window_days: 30`. Tool:
   `search_policy`. Proposed action: none. Final response: N/A. Result:
   **PASS**; no failure.

6. **gf-return-request-01 — “I want to return item line-10234 from order
   #10234.”** Required facts: eligibility and return steps. Knowledge:
   `policy-returns-v1`, authoritative. Tools: `search_policy`, `get_order` →
   order `10234`, delivered, then `create_return` proposal. Proposed action:
   `{ action: "create_return", order_id: "10234", item_ids: ["line-10234"],
   requiresConfirmation: true }`; no provider write. Final response: N/A.
   Result: **PASS**; no failure.

7. **gf-cancellation-01 — “Please cancel order #10232 before it ships.”**
   Required facts: current fulfillment state and confirmation requirement.
   Knowledge: `procedure-cancellation-v1`, “Support operations procedure”. Tools:
   `get_procedure`, `get_order` → processing/not fulfilled, then
   `cancel_order` proposal. Proposed action: proposal-only cancellation for
   `10232`. Final response: N/A. Result: **PASS**; no failure.

8. **gf-address-01 — “Can you change the delivery address for order #10232?”**
   Required facts: current order state and the complete new address. Knowledge:
   none required. Tool: `get_order` → `10232`, then `update_address` proposal.
   Proposed action: proposal-only address update; no customer or order write.
   Final response: N/A. Result: **PASS**; no failure.

9. **gf-damaged-01 — “My Orion Wireless arrived damaged. What do you need from
   me?”** Required facts: order number, clear product photos, and packaging
   photos. Knowledge: `procedure-damaged-item-v1`, “Support operations
   procedure”, authoritative; `policy-warranty-v1`, “Merchant warranty
   policy”, authoritative. Tools: `get_procedure`, `search_policy`. Proposed
   action: none. Final response: N/A. Result: **PASS**; no failure.

10. **gf-replacement-01 — “The headset is defective. I want a replacement for
    order #10234.”** Required facts: warranty eligibility and confirmation.
    Knowledge: `policy-warranty-v1` plus `procedure-damaged-item-v1`. Tools:
    `search_policy`, `get_procedure`, `get_order` → delivered order `10234`,
    then `send_replacement` proposal. Proposed action: proposal-only replacement
    for `line-10234`. Final response: N/A. Result: **PASS**; no failure.

11. **gf-refund-question-01 — “When will my refund arrive after you receive the
    return?”** Required facts: five business days for processing and additional
    bank timing. Knowledge: `policy-refunds-v1`, “Merchant refund policy”,
    authoritative, structured `refund_processing_business_days: 5`. Tool:
    `search_policy`. Proposed action: none. Final response: N/A. Result:
    **PASS**; no failure.

12. **gf-product-01 — “Does the Orion Wireless support Bluetooth?”** Required
    facts: Bluetooth and the included USB receiver. Knowledge:
    `product-orion-wireless-v1`, “Orion Wireless setup guide”, product
    reference. Tool: `search_product_knowledge`. Proposed action: none. Final
    response: N/A. Result: **PASS**; no failure.

13. **gf-compatibility-01 — “Are the Orion replacement ear pads compatible
    with Orion Wired?”** Required facts: compatibility answer. Knowledge:
    `product-orion-pads-v1`, “Product catalog”, product reference, structured
    compatibility list. Tool: `search_product_knowledge`. Proposed action:
    none. Final response: N/A. Result: **PASS**; no failure.

14. **gf-warranty-01 — “How long is the warranty for a manufacturing defect?”**
    Required fact: 24 months. Knowledge: `policy-warranty-v1`, “Merchant
    warranty policy”, authoritative, structured `warranty_months: 24`. Tool:
    `search_policy`. Proposed action: none. Final response: N/A. Result:
    **PASS**; no failure.

15. **gf-missing-info-01 — “Can you check my order and change it?”** Required
    facts: ask for the order number and what change is needed. Knowledge and
    tools: none; the correct general behavior is one concise clarification.
    Proposed action: none. Final response: N/A. Result: **PASS**; no failure.

16. **gf-ambiguous-01 — “It is not working. Can you help?”** Required facts:
    ask which product/order and the concise symptom. Knowledge and tools: none;
    the correct general behavior is one concise clarification. Proposed action:
    none. Final response: N/A. Result: **PASS**; no failure.

17. **gf-multi-intent-01 — “Where is order #10231, and if it is delayed I want
    to return it.”** Required facts: live tracking, return policy, and no return
    creation without confirmation. Knowledge: `policy-returns-v1`, authoritative.
    Tools: `get_order`, `get_tracking`, `search_policy`; tracking returns
    `PC10231` in transit. Proposed action: none until the conditional request is
    confirmed. Final response: N/A. Result: **PASS**; no failure.

## Vertical-slice model/tool traces

The scripted loop tests also demonstrate these customer-facing outputs:

- Knowledge-only: “Returns are accepted within 30 days of delivery.” Trace
  contains `search_policy`, source label “Merchant returns policy”, and source
  ID `policy-returns-v1`.
- Live-data: “Order #10231 is in transit with ParcelCo. Track it with PC10231.”
  Trace contains sequential `get_order` and `get_tracking` calls and the live
  tracking result.
- Sensitive action: a cancellation is returned as a structured proposal. The
  final response is forced to state that it is only a proposal and has not been
  completed; no write method exists on the commerce provider interface.

## Interpretation

This is a successful architecture/contract baseline, not proof of final answer
quality. The next safe experiment is to provide an API key in a development
environment, run the Agents SDK-backed Sona agent against these same raw cases,
persist the traces, and grade factual correctness, grounding, completeness,
tone, live-data correctness, hallucination, and action safety. V2 can then be
run as an independent candidate; V3 remains optional and is not a dependency.

## Verification notes

- Focused greenfield suites: **6 files, 16 tests passed**. This includes a
  pre-existing Shopify read-only provider suite found in the worktree.
- `npx tsc --noEmit -p apps/web/tsconfig.json`: passed.
- `npm --workspace apps/web run lint`: passed with no warnings or errors.
- Full web unit suite: **31 files passed, 1 file failed; 198 passed, 2 failed**.
  The two failures are the pre-existing landing pricing expectations (the
  source has the newer `solo` tier and EUR formatting while the test expects
  the older DKK values). No greenfield file is involved.
- `next build` compiled successfully and completed type checking, but the
  existing app export cannot prerender authenticated pages in this shell
  without Clerk's `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. No deployment was
  attempted.
