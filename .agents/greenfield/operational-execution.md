# Greenfield operational execution

The normal Greenfield Playground and support Inbox routes use one deterministic operational service. TurnIR supplies the explicit action meaning. Scoped CaseState binds the customer and order; fresh commerce reads establish requirements and eligibility. Server permissions, provider capability and channel then select simulation, execution or human review. Writer output cannot authorize a provider mutation.

## Server configuration

`GREENFIELD_OPERATIONAL_PERMISSIONS` is a JSON object keyed by workspace ID, then shop ID, then action family. Every missing or invalid setting defaults to `disabled`. There are no merchant names or wildcard permissions.

```json
{
  "workspace-id": {
    "shop-id": {
      "cancel_order": { "mode": "hitl" },
      "update_address": { "mode": "hitl", "requireConfirmation": false },
      "update_order_line": { "mode": "hitl" }
    }
  }
}
```

Supported modes are `disabled`, `hitl`, and `auto`. Confirmation defaults to false; a merchant can explicitly require it for an action. An ordinary explicit customer request already supplies action intent.

Inbox provider writes additionally require `GREENFIELD_ALLOW_PROVIDER_MUTATIONS=true`. This is a server kill switch, not customer input. Playground always constructs the provider with writes disabled, including when that switch is true. No configuration or provider write was enabled during this development wave.

## Capability and outcomes

The Shopify write adapter supports cancellation and structured delivery-address changes. Its GraphQL operations use API 2026-07. Cancellation acceptance may be an asynchronous job; only a subsequent fresh order read can confirm cancellation. No refund method, automatic charge, notification or restock is requested by this adapter.

The current Shopify adapter does **not** support safe order-line mutation. The service still resolves the source line and live catalog target, quantity, stock and price delta. It returns a bounded handoff with that full context and the capability reason. Simulated line transitions and the generic Inbox line-execution contract are verified with fake providers; this does not establish Shopify line mutation support.

A higher price requires payment and acceptance handling. A lower price requires authorized refund handling. Both are handed to a human, without a charge or refund promise. Multiple inventory locations remain unknown until sellable stock can be scoped safely.

Playground outcomes contain `SIMULATED`, before/after state, verified arguments and read-back, with `executed=false` and `providerMutationAttempted=false`. Inbox human review returns `PROPOSED`; the support API exposes these decisions as `operational_handoffs`. This is a response contract for the calling Inbox workflow, not a new persisted approval queue.

Auto mode rechecks the live order immediately before the one mutation attempt. Changed state stops the attempt. Provider rejection, ambiguous transport failure or failed read-back never produces a completion claim. Mutation requests are not automatically retried. Line read-back checks the expected variant, quantity, currency and net line value; address read-back verifies every supplied field and clears an omitted apartment field.

## Tracking

Verified fulfillment tracking identifiers feed the existing read-only tracking provider. Carrier results are bound back to the exact identifier and normalized to pre-transit, in-transit, out-for-delivery, delivered, exception or unknown. Available event, timestamp, location and ETA facts remain bound to each shipment. An ETA is rendered only when provided by verified live evidence. If no carrier status is available, verified Shopify fulfillment status remains in the answer; merchant policy estimates cannot become live ETA facts.

## Verification

Run deterministic Greenfield tests with external live-eval files excluded, plus server Playground and normal route tests. The three operational test files cover simulation, fake Inbox mutations, scoped configuration, provider HTTP failures, line changes and prices, tracking, CaseState continuity and response-contract negatives. Use DEV fixtures only with a GET-only Shopify transport, a read-only database transport and disabled mutation provider. Keep fixture traces private. Do not run the sealed Customer #2 benchmark as part of this wave.
