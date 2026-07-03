# Queue Workspace UI (Plan 2) — Design Spec

**Date:** 2026-07-03
**Status:** Approved direction, pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-07-03-inbox-status-redesign-design.md` (the approved UX design — sidebar IA, status tabs, queue semantics) and the merged thread-lifecycle backend foundation (`docs/superpowers/plans/2026-07-03-thread-lifecycle-status.md`, all 11 tasks on main). This spec covers the Plan 2-specific decisions: refactor strategy, rollout premise, and the concrete UI build. Where this spec is silent, the Plan 1 spec governs.

## Problem

The backend now runs the four-value lifecycle model with automatic transitions, but the UI still shows the old view structure (All Tickets / Assigned to me / Resolved / Notifications) and legacy status labels. The visible workspace from the approved design — one prioritized work queue, user-created inboxes, status tabs, send→next — does not exist yet. Additionally, `InboxSplitView.jsx` has grown to 5,597 lines (172 hooks, one orchestration component from line 1010), making every UI change slow and risky.

## Goal

Ship the approved queue workspace UI (matching the approved mockup, all UI copy in English), built on the merged lifecycle APIs — preceded by a refactor that shrinks `InboxSplitView.jsx` into focused, individually testable modules.

## Rollout premise

- Plan 1's migrations are **not yet applied** to production. Plan 1 + Plan 2 deploy together via one extended deploy checklist at the end.
- Local dev runs against the production Supabase project, whose data still carries legacy status values. Therefore the new UI **normalizes every status read through `normalizeLifecycleStatus`** (`apps/web/lib/inbox/status-model.js`, tested) and never assumes canonical values. It renders correctly against both migrated and unmigrated data.
- Known local-testing limitation: the DB-side sidebar counts (`needsAttentionCount` etc.) filter on canonical values in the database and return 0 until the migration runs. Count-consuming UI must tolerate zeros; count correctness is verified post-migration via the deploy checklist.
- `attention_reason` may be null (threads that never transitioned post-deploy, or pre-backfill data). Reason badges must tolerate null: fall back to deriving "New" from unread state, otherwise show no badge.

## Non-goals

- No backend/API changes (Plan 1 delivered them). If a gap is found, it is flagged, not silently patched into UI code.
- No new channels (channel icon renders from existing thread data; email-only today).
- No auto-send / AI-supervision views (the model supports them later as filters; not built now).
- No visual redesign beyond the approved mockup — same quiet Sona style, colored text not chips, existing row format preserved.

## Phase 1 — Refactor `InboxSplitView.jsx` (UI deliberately unchanged)

Extract the monolith's orchestration into focused modules. Each extraction is a pure move — behavior-preserving, verified individually before the next. The rendering components (`TicketList`, `TicketListItem`, `TicketDetail`, `Composer`) already exist and stay.

```
apps/web/lib/inbox/
  view-model.js            → PURE logic, no React: which threads belong to which
                             view (queue filtering, waiting groups, approve-close
                             group), queue sorting (customer wait time), reason-
                             badge derivation (attention_reason with null fallback).
                             Fully unit-tested (vitest, TDD).
  useThreadFilters.js      → search, status filters, sort state
  useThreadSelection.js    → selected thread, tabs, prefetch orchestration
  useThreadActions.js      → approvals, order-updates, optimistic updates
  useComposerState.js      → composer orchestration state (not Composer itself)
components/inbox/
  InboxSplitView.jsx       → shrinks to layout + composition; target < 800 lines
```

`view-model.js` is the keystone: all queue semantics become pure, testable JavaScript, same pattern as `status-model.js`. The hooks own React state and effects; the view-model owns decisions.

Verification per extraction: existing vitest suite passes + manual local walkthrough of /inbox confirming unchanged behavior (list renders, selection works, reply sends, status dropdown works).

## Phase 2 — Sidebar (English, per approved mockup)

Structure (in `app-sidebar.jsx`, restructured):

```
Dashboard

QUEUE
  Needs attention     N     ← default view; needsAttentionCount
  Mine                N     ← mineCount
  Waiting             N     ← waitingCustomerCount + waitingThirdPartyCount, muted
  Resolved

INBOXES             +       ← user-created (workspace_inboxes), per-inbox
  <workspace-defined> N        needs-attention counts; empty by default

▸ AUTOMATED                 ← collapsed by default: Notifications, Courier
                               (classification/sender-rule destinations)

─────────────
Knowledge
Analytics
Settings                    ← Mailboxes, Playground, Automation, Tags,
                               Integrations move in here
```

- Counts come from the extended `/api/inbox/sidebar-counts` response (Plan 1, Task 10). Only needs-attention counts render prominently; the Waiting count renders muted. AUTOMATED has no counts.
- "View all" stays exactly where it is today (top of the list panel) as the cross-status lookup view.
- The legacy `?view=` values (`resolved`, `notifications`) are superseded by the new navigation: QUEUE entries and status tabs drive the view. URLs remain shareable (view state in search params), but the old param values redirect/map onto the new views so old links don't break.
- Settings consolidation: the five configuration entries move behind one "Settings" sidebar item (their existing pages/routes are unchanged — this is navigation grouping, not page rewrites).

## Phase 3 — List views

**Status tabs** in the list header, present identically in every view (queue entry or inbox): `Needs attention · N` / `Waiting · N` / `Resolved`. Clicking an inbox in the sidebar shows the same list component filtered to that inbox, same tabs.

**Row format** (per approved mockup; preserves today's structure): `T-xxxxxx` mono pill + sender bold + timestamp right; subject line with channel icon in front; meta line with inbox name · purple "Draft ready" indicator · assignee initials or "Unassigned". Reason as colored text on the right where status text sits today: "Customer replied" (amber), "New" (green). Unread renders as bold — a visual weight, not a status.

**Queue sorting:** Needs attention sorts by customer wait time — oldest `customer_last_inbound_at` first. Implemented in `view-model.js` as a scoring function so order value/intent/SLA can extend it later without UI changes.

**Waiting view:** two groups — "Waiting on customer" and "Waiting on third party" (from `waiting_reason`) — each row showing "wakes in X days" when `wake_at` is set.

**Needs attention view:** an "Approve close" group at the bottom for `close_pending` threads, with approve (→ resolved) and keep-waiting actions wired to the existing thread-status PATCH.

**Resolved view:** recently auto-closed threads show a quiet "auto-closed" marker (derivable: resolved + no manual close event; if not cleanly derivable from existing data, show no marker rather than guessing — flag the gap).

## Phase 4 — Send → next

After a successful send, the workspace advances to the next thread in the current view's sorted queue instead of returning to the list. Empty queue → a quiet inbox-zero empty state. Implemented in `useThreadSelection.js` consuming `view-model.js`'s sorted order.

## Error handling

- Threads with an invalid/stale `inbox:` tag (deleted inbox) fall back to "no inbox" and never disappear from the queue (Plan 1 spec constraint, now enforced in `view-model.js`).
- Null/unknown `attention_reason`, `waiting_reason`, `wake_at` never crash a row — badges/groups degrade gracefully (no badge, "Waiting on customer" as default group, no wake info).
- Sidebar counts of 0 (pre-migration or API fallback) render as absent/zero, never as errors.

## Testing

- `view-model.js`: exhaustive vitest coverage (TDD) — view membership per status × view, sorting order, reason derivation incl. null fallbacks, waiting groups, approve-close group, stale-inbox fallback.
- Each refactor extraction: existing suite green + manual /inbox walkthrough before proceeding.
- New UI phases: manual local walkthrough against unmigrated prod data (statuses normalize; counts show 0 as expected).
- Deploy checklist (extended from Plan 1's): post-migration verification of counts, tabs, queue order, reason badges, send→next against real migrated data.

## Deploy

One combined checklist: `docs/superpowers/plans/2026-07-03-thread-lifecycle-status-deploy-checklist.md` is extended with Plan 2's UI verification steps. Order remains: deploy web (now including the new UI) → apply migrations → deploy postmark-inbound → verify end-to-end.
