# Tools and actions

The capability surface is deliberately small. The model sees strict business
arguments only; the server supplies tenant, shop, customer identity, and
credentials.

## READ-ONLY CAPABILITIES

The current contracts are the capabilities in
`apps/web/lib/greenfield-support/tool-contracts.ts` and the
`CommerceReadProvider` interface:

- `search_policy`, `search_product_knowledge`, `search_historical_cases`
- `get_brand_guidance`, `get_procedure`
- `get_order`, `get_order_history`, `get_customer`
- `get_product`, `inspect_fulfillment`, `get_tracking`

The first live adapter is `ShopifyReadOnlyProvider`, using the existing
server-side Shopify connection. The provider performs GET-only Admin API
lookups and normalizes order, fulfillment, product, and tracking results.
Webshipper/Ship24 support exists elsewhere in Sona but is not exposed here
until it has a similarly tenant-scoped read contract.

## MUTATING / SENSITIVE ACTIONS

The current proposal contracts are `cancel_order`, `update_address`,
`create_return`, `create_refund`, and `send_replacement`. They do not call a
provider. They return a structured proposal with the reason and
`requiresConfirmation: true`.

During the experiment, read-only tools may execute when safe and tenant-scoped.
Mutating actions are proposal-only; greenfield never cancels, refunds, changes
an address, creates a return, or sends a replacement.

The loop is:

`model → tool request → deterministic validation → execution/result → model continues`

Calls are sequential and bounded. Tool results have explicit states such as
`ok`, `not_found`, `missing_context`, `invalid_arguments`, `error`, and
`proposed`, so the model can ask, explain, or escalate instead of guessing.
