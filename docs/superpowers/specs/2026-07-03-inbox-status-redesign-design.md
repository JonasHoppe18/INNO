# Inbox & Status Redesign — Design Spec

**Date:** 2026-07-03
**Status:** Approved direction, pending implementation plan

## Problem

The current ticket workspace mixes three concepts — inboxes, statuses, and unread state — without a clear model. Statuses (Open / New / Pending / Resolved) compete with inboxes (All Tickets, Notifications, Courier) for the agent's attention, there is no single work queue, and "New" conflates unread with lifecycle state. Agents cannot answer the core question at a glance: *what needs me right now?*

## Goal

Build the workspace around one self-maintaining, prioritized work queue so that a support team can reach inbox zero every day, scale from one agent to a team, and extend to new channels (Instagram, etc.) without new navigation.

## Non-goals

- Auto-send / AI autonomy changes (design must not block it; it does not implement it)
- Icon-rail / contextual multi-product navigation (future v2, noted below)
- Order-value or intent-based priority scoring (sort design must allow it later; v1 sorts by wait time)

## Core model — four orthogonal dimensions

Every ticket has exactly one value in each of the first three, plus free-form metadata:

| Dimension | Question | Values |
|-----------|----------|--------|
| Inbox | Where does it live? | Exactly one user-created inbox, or none |
| Status | Where is it in its lifecycle? | `needs_attention`, `waiting_customer`, `waiting_third_party`, `resolved` |
| Assignee | Who owns it? | A team member, or unassigned |
| Metadata | Everything else | Tags (many), channel (email, instagram, …), unread flag |

The current mess comes from these being blended. Keeping them orthogonal is the design's core rule: **status is a lifecycle, not a folder; an inbox is a folder, not a state; unread is a flag, not a status.**

## Status model & automatic transitions

The queue is self-maintaining. Agents almost never touch a status dropdown:

| Event | Transition |
|-------|-----------|
| New ticket arrives | → `needs_attention` |
| Agent sends a reply | → `waiting_customer` (automatic — replying IS the action) |
| Customer replies | → `needs_attention` (automatic, prioritized above new tickets) |
| Agent hands off to third party (GLS, 3PL, supplier) | → `waiting_third_party` (manual, or set by an action; optional wake date: "wake me in N days") |
| Wake date reached without reply | → `needs_attention` |
| Customer silent for N days in `waiting_customer` | → `resolved` (auto-close) or → "approve close" group in the queue, per workspace config |
| Customer replies to a resolved ticket | → `needs_attention` (reopen) |

`waiting_customer` wakes on customer reply. For `waiting_third_party`, a customer reply moves the ticket to `needs_attention` (a human should see the message), but the third-party wait marker and its wake date persist on the ticket — replying to the customer returns it to `waiting_third_party`, not `waiting_customer`, until the third-party wait is cleared.

**Auto-close configuration (per workspace):** number of silent days (default 4) and mode: `auto` (close silently) or `approve` (ticket appears in a quiet "Approve close" group at the bottom of Needs attention).

## The work queue

"Needs attention" is the team's shared, default view. It contains **only** tickets where the ball is in the team's court — never waiting or resolved tickets, never automated/notification mail.

**Sorting:** by customer wait time (time since the customer's last message), oldest first. Customer-replied tickets naturally outrank fresh tickets. The sort is a scoring function so it can later incorporate order value, intent severity, and SLA targets without UI changes.

**Reason badges:** since everything in the view is "needs attention," the row's right-hand slot (where status text sits today) shows *why* it needs attention: `Customer replied` (amber), `New` (green), plus a purple `Draft ready` indicator on the meta line when an AI draft awaits review.

**Assignment (hybrid pull/assign):** all agents see the shared queue and pull freely; the "Mine" view shows tickets assigned to me. Anyone can assign/hand off. Unassigned is the default state, shown subtly (e.g. "Unassigned" text / dashed avatar).

**Send → next:** after sending a reply, the app advances to the next ticket in the queue instead of returning to the list. This is the inbox-zero working rhythm.

## Inboxes

- **User-created only. Default: zero.** The Inboxes sidebar section starts empty apart from the "+" affordance. The queue is fully functional with no inboxes; inboxes are an optional organizational layer, and each webshop structures them as they like (by topic, brand, mailbox, team — Sona doesn't dictate).
- **One inbox per ticket** (folder semantics), implemented today via the `inbox:<slug>` tag mechanism, which stays. Tags remain the free cross-cutting layer on top.
- Tickets route into inboxes via sender rules / automation, or manual move.
- Clicking an inbox shows *the same list component* filtered to that inbox, with the same status tabs. Nothing behaves differently inside an inbox.

## Sidebar information architecture

One sidebar, ordered by frequency of use. Configuration items (touched monthly) move behind Settings; the agent's 8-hours-a-day items get the space:

```
Dashboard

QUEUE
  Needs attention      12     ← default view, shared team queue
  Mine                  3
  Waiting              22     ← one line; customer/third-party split
  Resolved                       lives inside the view as groups

INBOXES              +        ← user-created; empty by default
  (workspace-defined)

▸ Automated                   ← collapsed by default: Notifications, Courier
                                 (routing-classified non-support mail)

─────────────
Knowledge
Analytics
Settings ⚙                    ← Mailboxes, Playground, Automation,
                                 Tags, Integrations move in here
```

- **Sidebar counts show only `needs_attention` tickets** — globally and per inbox. Waiting counts render muted; Automated has no counts. Inbox zero means exactly one thing: the Needs attention count is 0.
- **"View all"** stays as it is today (top of the list panel) as the lookup view across all statuses — it is never the working view.
- Realistic size: 4 queue items + a handful of inboxes + 1 collapsed section + 3 bottom items ≈ 14 rows — shorter than today's sidebar.
- **Future (v2):** if product areas multiply, move to an icon rail + contextual sidebar (Intercom/Front pattern). The queue structure transfers unchanged.

## List view & visual language

All ticket views are one list component with different filters. Visuals follow the existing Sona style — quiet, text-forward, no chips or avatars:

- **Status tabs** in the list header (next to search): `Needs attention · N` / `Waiting · N` / `Resolved`. Present identically in every view (queue, inbox, Mine).
- **Row format preserved:** `T-xxxxxx` mono pill + sender bold + timestamp right; subject line below with a small channel icon (mail / Instagram) in front; third meta line shows inbox name · purple "Draft ready" · assignee initials or "Unassigned".
- **Colored text, not chips**, for reason badges — same treatment as today's Open/New/Pending text.
- **Waiting view:** two groups — "Waiting on customer" and "Waiting on third party" — each row showing what it's waiting for and when it wakes ("wakes in 3 days").
- **Resolved view:** recently auto-closed tickets show an "auto-closed" marker; in approve mode, pending closures sit in the queue instead.
- **Unread** is a visual weight (bold), not a status.

## Channels

Channel is a ticket property, not navigation: an icon on the row and a filter option. Adding Instagram (or any channel) adds no sidebar entries and no new views.

## AI supervision (forward-looking principle)

As auto-send matures, agents shift from answering to supervising. The model must support an "Auto-handled by Sona" filter (e.g. within Resolved) for spot-checking AI-sent replies. Not built now — but it is only another filter on the same list, which this design guarantees.

## Data model implications

- **Status:** migrate thread status semantics to the four lifecycle values. Mapping: `open` → `needs_attention`; `new` → `needs_attention` + unread flag; `pending` → `waiting_customer` (verify current pending semantics before migrating); `resolved` → `resolved`.
- **Transitions:** inbound message handler (postmark-inbound and pollers — must not diverge) sets `needs_attention`; outbound send sets `waiting_customer`; both respect third-party wait markers.
- **Wake/auto-close fields:** per-thread `waiting_reason` (`customer` | `third_party`), optional `wake_at`, plus workspace-level config (auto-close days, `auto` | `approve` mode) — natural fit alongside `shop_action_config` patterns, but workspace-scoped (tenancy migration caveat applies: scope by workspace, not user).
- **Inboxes:** `workspace_inboxes` + `inbox:<slug>` tag stays as-is. No schema change required for v1.
- **Scheduled job:** a periodic task evaluates `wake_at` and auto-close timers (silence measured from the customer's last message).

## Error handling

- A ticket with an invalid/stale `inbox:` tag (inbox deleted) falls back to "no inbox" — never disappears from the queue.
- Auto-close never fires on tickets in `needs_attention` or `waiting_third_party` — only `waiting_customer` silence counts.
- Reopen-after-resolve always wins over auto-close races: any inbound customer message forces `needs_attention`.

## Testing

- Unit-test the transition table exhaustively (event × current status → next status), including third-party wake semantics and reopen races.
- Test count queries: sidebar counts include only `needs_attention`, per inbox and global.
- Test migration mapping on a copy of production data; verify no ticket becomes invisible (every ticket reachable via View all and exactly one status tab).
- Parser parity: transition triggers fire identically for Postmark and Gmail/Outlook ingest paths.

## Design principles (carry into implementation)

1. Priority is a scoring function, wait-time-based in v1, extensible to order value/intent/SLA.
2. Send advances to the next ticket — inbox zero is a rhythm, not a report.
3. Everything the AI does autonomously must remain inspectable as a filter on the same list.
