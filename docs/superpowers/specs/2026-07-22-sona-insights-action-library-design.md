# Sona Insights — Action Library — Design

**Date:** 2026-07-22
**Scope:** A new "Actions" tab inside the per-ticket Sona Insights panel (`SonaInsightsModal.jsx`), letting an agent manually trigger the 5 core Shopify order actions on the current ticket's order, without leaving Sona.
**Inspiration:** Mobbin — Stripe, Square, Patreon refund modals; Intercom's inline structured fields in a ticket sidebar; existing `AutomationPanel.jsx` "Action permissions" row list.

## Problem

Sona Insights (`apps/web/components/inbox/SonaInsightsModal.jsx`) currently has two tabs — Overview (ticket summary/product/tags/solution) and Customer (order/customer lookup) — but no way for an agent to *act*. Today the only way an action reaches a ticket is the AI pipeline proposing one (surfaced via `ActionCard.jsx`, approval-only). If an agent wants to issue a refund, cancel an order, or start a return themselves — without waiting for or overriding an AI proposal — there is no in-app path; they have to leave Sona and use the Shopify admin directly.

## Approach: reuse the existing action-execution path, don't duplicate it

`apps/web/app/api/threads/[threadId]/order-updates/accept/route.js` already contains the full Shopify/Webshipper execution logic for the 5 core action types (address update, cancel, refund, return, exchange), keyed purely off a `thread_actions` row's `action_type` + `payload` — it does not care whether that row was created by the AI pipeline or a human. This design adds a human-initiated way to create that row and immediately accept it, rather than building a second execution path.

Two other approaches were considered and rejected:
- **Duplicate the Shopify/Webshipper logic in a new manual-only endpoint** — rejected: doubles the maintenance surface for the most complex, business-critical code in the app.
- **Extend the accept endpoint to accept a raw payload with no prior `thread_actions` row** — rejected: requires editing the riskiest file in the codebase, and loses the audit-trail benefit of a `thread_actions` row existing before execution.

## Scope

- **Action types (v1):** 4 of the 5 "core" actions defined in `lib/action-modes.js` — `update_shipping_address`, `cancel_order`, `refund_order`, `initiate_return`. **`create_exchange_request` is deferred** — discovered during implementation planning: it requires a Shopify line-item and replacement-variant picker, and no existing endpoint in this codebase exposes line-item/variant IDs (the order data already fetched for the Customer tab only has item titles as text). Building that picker is a separate follow-up plan once a variant-search API exists. The broader set of undocumented/globally-disabled action types (`change_shipping_method`, `edit_line_items`, etc.) remains out of scope entirely.
- **Platform:** Shopify only. If the ticket's shop `platform !== "shopify"`, the Actions tab shows an empty state and no action list.
- **Shop `action_modes` config is not consulted here.** `off`/`approve`/`auto` govern what the *AI* may do automatically; they do not restrict a human agent acting directly. All 5 actions are always available to the agent regardless of shop config (see "Action list" below).

## UI

### New "Actions" tab

Added to the existing `Tabs` in `SonaInsightsModal.jsx`, alongside "Overview" and "Customer".

```
┌─────────────────────────────┐
│ Overview | Customer | Actions│
├─────────────────────────────┤
│ Order #4538 · Fulfilled       │  ← compact order header (only if matched)
├─────────────────────────────┤
│ Update shipping address    → │
│ Cancel unfulfilled order   → │
│ Refund order                → │
│ Start return                → │
└─────────────────────────────┘
```

- **No shop / non-Shopify platform:** tab shows only an empty-state message — "Actions is only available for Shopify shops."
- **No order matched on this ticket:** a small info box — "No order found on this ticket — find the customer/order under the Customer tab." — and all 5 rows render disabled (no dialog opens on click).
- **Order matched:** a compact order header (order number + short status) followed by the action list.

### Action list

Reuses the visual pattern already established in `AutomationPanel.jsx`'s "Action permissions" section: a vertical list of rows in a single bordered card, each row divided by a bottom border. Per row: label (bold) + one-line description on the left, a button/chevron on the right. Labels and descriptions are read from the existing `CORE_ACTIONS` array (`lib/action-modes.js`) — no new copy to maintain in two places.

Every row is clickable regardless of the shop's `action_modes` setting for that type (see Scope).

### Parameter dialogs

Clicking a row opens a `Dialog` (the same primitive already used for "How Sona built this draft"), titled with the action + order number (e.g. "Refund order #4538"). Fields per type, derived from what the existing execution code in `order-updates/accept/route.js` already expects:

| Action | Fields |
|---|---|
| Update shipping address | Name, address line 1/2, zip, city, country — pre-filled from the order's current shipping address, editable |
| Cancel unfulfilled order | None — confirmation-only dialog showing order summary |
| Refund order | Amount (pre-filled with order total, editable for partial refunds), optional note |
| Start return | Reason (dropdown, same enum the pipeline already normalizes to — `COLOR`, `DEFECTIVE`, `NOT_AS_DESCRIBED`, `OTHER`, `SIZE_TOO_LARGE`, `SIZE_TOO_SMALL`, `STYLE`, `UNKNOWN`, `UNWANTED`, `WRONG_ITEM`), optional note |

The dialog's primary button states the concrete consequence rather than a generic "Confirm" (Stripe/Square pattern), e.g. "Refund 350 kr", "Cancel order #4538".

## Data flow / execution

1. Dialog submit → `POST /api/threads/[threadId]/actions/manual` (**new** endpoint). Validates the fields required for the chosen type, resolves the order already matched on the thread, and inserts a `thread_actions` row: `status: "pending"`, `action_type`, `order_id`/`order_number`, `payload` built from the form fields. Returns the new row.
2. The client places that row into `pendingOrderUpdateByThread[threadId]` (the same state `ActionCard` already renders from) via `setPendingOrderUpdateByThread`, then calls the **existing, unmodified** `handleOrderUpdateDecision("accepted")` — both already exposed by `useThreadActions.js` and already in scope in `InboxSplitView.jsx` (which passes `handleOrderUpdateDecision` to `TicketDetail` today as `onOrderUpdateDecision`). This reuses the entire existing accept flow as-is: the `POST order-updates/accept` call, Shopify/Webshipper mutation, test-mode simulation, `agent_logs` audit entry, post-action draft regeneration, loading/error state, and — because it writes through the same `pendingOrderUpdateByThread` state `ActionCard` reads — the result shows up automatically with no separate refetch needed.
3. `SonaInsightsModal` needs two new props from `InboxSplitView` to do this: `setPendingOrderUpdateByThread` and `handleOrderUpdateDecision` (same pattern as the existing `onOrderUpdateDecision` prop on `TicketDetail`).

No changes are made to `order-updates/accept/route.js`. Two mapping details the manual endpoint must get right for execution to work against the existing route, found during implementation planning:
- **`action_type` for "Start return" must be inserted as `create_return_case`**, not the `CORE_ACTIONS` type string `initiate_return` — the accept route branches on the legacy literal string for returns, not the core alias, and `initiate_return` alone falls through to "Unsupported action type".
- **`order_id`/`order_number` are not interchangeable with the Customer tab's order object fields of the same names.** The Customer tab's mapped order uses `id` for the human-readable order number and `adminId` for Shopify's actual numeric order ID. The `thread_actions.order_id` column must get the numeric `adminId`; `order_number` gets `id`.

## Error handling

Execution errors (e.g. "Order is Fulfilled and cannot be changed", a Shopify API error) surface inline in the still-open dialog, reusing `ActionCard.jsx`'s existing error-label logic — the agent can adjust fields and retry, or cancel.

## Out of scope for this iteration

- The broader (non-core) Shopify action types.
- Any change to how `action_modes` gates the AI pipeline.
- A picker for shops without a matched order (agent must resolve the order via the Customer tab first).

## Testing

- Unit tests for the new `actions/manual` endpoint: rejects when no order is matched, rejects missing required fields per action type, accepts valid payloads and returns an `actionId`.
- Manual browser verification of the UI flow (list → dialog → submit) in dev. Actual Shopify order mutation cannot be exercised without a connected live/test store, so execution correctness relies on the fact that this step reuses the existing, already-tested `order-updates/accept` path unchanged.
