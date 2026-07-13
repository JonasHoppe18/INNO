# Human tone + order-name greeting + partial address-change action — design

**Date:** 2026-07-13
**Status:** approved (Jonas, 2026-07-13)

Driven by real ticket T-051050 (address correction, order #4845). Customer:
"Hello, i have made an error in my shipping address ... order #4845 ...
There is a '7 1tv' on address line 2 or something like that it has to be
removed." Draft returned: "Hi there, I can help you with updating the shipping
address for your order #4845. I'll remove the '7 1tv' ...". Three defects.

## A. Greeting uses the customer's name

`resolveCustomerName` (stages/customer-name-resolution.ts) already accepts
`orderCustomerName` + `orderCustomerEmail` and has a `verified_order_customer`
source, but its guard is too strict: after confirming `orderEmail ===
senderEmail`, it STILL requires the order first name to appear as a token in the
sender's email local part (or match the display name). "simonboutrup@gmail.com"
does not tokenize to include "simon", so the guard rejects a genuine match and
the greeting falls back to "Hi there".

**Change:** An exact `orderEmail === senderEmail` match is sufficient on its own
to trust the order first name (high confidence) — this IS the order-match signal
Jonas approved. Keep the display-name / email-local-part heuristic ONLY as the
fallback when there is no order email to match against. Never use the order name
when `orderEmail` is present and differs from `senderEmail`.

Result: Simon's case → "Hi Simon,". No email / no match → neutral greeting
(unchanged).

## B. Human tone — kill robotic openers

"I can help you with updating the shipping address for your order #4845" reads
like an AI. The customer should not sense they are talking to a bot.

**Change:** Add a writer directive (in BOTH the compact gpt-5 rule set and the
classic gpt-4o set — keep them in sync) that:
- Bans corporate/AI opener phrasings: "I can help you with…", "I'd be happy to
  assist…", "I can assist you with…", "I'm here to help with…", and the Danish
  equivalents ("Jeg kan hjælpe dig med…", "Jeg vil med glæde assistere…").
- Models a natural, human, colleague voice that goes straight to the point and
  owns the task, e.g. "Selvfølgelig — jeg retter adressen på #4845 for dig." /
  "Of course — I'll get that address on #4845 fixed for you."

This is prose guidance; it complements (does not replace) the near-duplicate
few-shot examples that already anchor tone.

## C. Propose the Shopify change on a partial correction

The `update_shipping_address` proposal (pipeline.ts ~2000) only fires when
`parseReplacementShippingAddress` yields a COMPLETE new address (address1 + city
+ zip). A partial correction ("remove the '7 1tv' from line 2") provides no full
address, so no action is proposed and the draft merely promises "I'll remove it".

**Change:** When intent is `address_change`, the order is unfulfilled, and the
customer describes a correction to the EXISTING address rather than a full
replacement, build the corrected address by starting from
`facts.order.shipping_address` and applying the described edit (e.g. clearing /
fixing `address2`). Propose `update_shipping_address` with that corrected full
address, `requires_approval: true` (never auto-execute — actions are destructive,
default manual per repo rules). The writer then offers to make the change in
Shopify concretely.

Scope guard: only apply a correction we can localise to a specific field
(address2 / address1 / zip / city). If the edit is ambiguous, fall back to
today's behavior (no proposal) and ask the customer to confirm the full corrected
address — never guess a destructive mutation.

## Verification

Dry-run T-051050-equivalent (order #4845, partial line-2 correction):
- Greeting = "Hi Simon," (name from order, email match).
- Opening is natural, no "I can help you with…".
- An `update_shipping_address` proposal is present (requires_approval) with
  address2 corrected; draft offers to make the change.
Regression: a full-replacement address case still proposes as before; a
non-address ticket is unaffected; a customer with no matching order email still
gets a neutral greeting.

## Non-goals
- No auto-execution of address changes. Proposal + human approval only.
- No change to how orders are resolved/fetched.
- Greeting still falls back to neutral whenever identity is uncertain.
