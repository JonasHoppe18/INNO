# Queue Workspace UI (Plan 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved queue workspace UI (English copy, approved mockup) on top of the merged lifecycle backend — preceded by a behavior-preserving refactor that shrinks `InboxSplitView.jsx` from 5,597 lines into focused modules.

**Spec:** `docs/superpowers/specs/2026-07-03-queue-workspace-ui-design.md` (Plan 2). UX authority: `docs/superpowers/specs/2026-07-03-inbox-status-redesign-design.md` (Plan 1 spec).

**Architecture:** All queue semantics (view membership, sorting, reason badges, waiting groups) live in one pure, TDD-tested module `view-model.js` — the UI consumes decisions, never makes them. React state extraction happens as verbatim moves into hooks with hard verification gates between each move. New UI (sidebar sections, status tabs, row badges, send→next) lands only after the refactor stabilizes.

**Tech Stack:** Next.js 14 (App Router), React 18, vitest (configured, `**/__tests__/**/*.test.js`), existing Radix/Tailwind components.

## Global Constraints

- ALL new UI copy in English (Needs attention / Mine / Waiting / Resolved / Queue / Inboxes / Automated / Customer replied / New / Draft ready / Unassigned / Waiting on customer / Waiting on third party / Approve close).
- Every status read in new code goes through `normalizeLifecycleStatus` from `apps/web/lib/inbox/status-model.js` — never compare raw `thread.status` against a canonical value. The UI must work against BOTH migrated and unmigrated data.
- Null tolerance everywhere: `attention_reason`, `waiting_reason`, `wake_at`, `close_pending` may be null/undefined/absent (unmigrated rows, API fallbacks). No badge/group/count may crash or render garbage on null — degrade to no-badge / "Waiting on customer" group / no wake info / zero counts.
- Visual language: quiet Sona style — colored text (not filled chips), existing row format (`T-xxxxxx` pill + bold sender + timestamp; subject line; meta line), unread = bold weight only.
- The ONLY backend-file change permitted is adding the five lifecycle columns to the `loadThreads` select in `apps/web/lib/server/inbox-data.js` (Task 2). Any other API gap is flagged in the task report, not patched.
- Refactor tasks (3-5) are behavior-preserving: UI pixel/behavior-identical after each. Each ends with the full vitest suite green AND a manual /inbox walkthrough (list renders, thread opens, reply flow reachable, status dropdown works) before commit.
- Existing tests must stay green through every task: `cd apps/web && npm test`.
- Local dev runs against the production Supabase DB (unmigrated). Do NOT apply migrations, call Supabase MCP mutation tools, or deploy anything. DB-side counts showing 0 locally is expected, not a bug.
- Commit after every task; do not batch.
- Repo quirk: `npm run dev` uses `--turbo` which conflicts with `experimental.typedRoutes` — use `npx next dev` for manual walkthroughs.

## Thread object shape (client-side, after Task 2)

`id, user_id, mailbox_id, provider, provider_thread_id, ticket_number, subject, snippet, customer_name, customer_email, customer_last_inbound_at, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, classification_key, classification_confidence, classification_reason, created_at, updated_at, customer_language, waiting_reason, wake_at, close_pending, attention_reason, status_changed_at`

## Known accepted gaps (do not "fix")

- Resolved view shows NO "auto-closed" marker: auto-close leaves no distinguishing trace (`attention_reason` is nulled), so per spec the marker is omitted rather than guessed. If wanted later, Plan 1's tick would need to stamp a marker — out of scope.
- Sidebar DB-side counts read 0 until migrations run. Verified post-deploy via the checklist.

---

### Task 1: view-model.js — pure queue semantics (TDD)

**Files:**
- Create: `apps/web/lib/inbox/view-model.js`
- Test: `apps/web/lib/inbox/__tests__/view-model.test.js`

**Interfaces:**
- Consumes: `normalizeLifecycleStatus` from `./status-model.js`.
- Produces (consumed by Tasks 3, 6, 7, 8, 9, 10):
  - `getLifecycleStatus(thread): string` — normalized lifecycle value
  - `threadTab(thread): "needs_attention" | "waiting" | "resolved" | "blocked"` — which status tab a thread belongs to (`close_pending === true` forces `needs_attention` even while status is waiting)
  - `isAutomated(thread): boolean` — `classification_key === "notification"`
  - `resolveInboxSlug(thread, knownSlugs: string[]): string | null` — slug from `inbox:` tag if it exists in `knownSlugs`, else null (stale-inbox fallback)
  - `deriveReason(thread): { key: string, label: string } | null` — reason badge; keys `customer_replied`/`new`/`wake_timer`/`approve_close`; null when nothing applies
  - `queueCompare(a, b): number` — sort comparator: oldest customer wait first
  - `waitingGroup(thread): "customer" | "third_party"`
  - `wakeInDays(thread, nowMs: number): number | null` — whole days until `wake_at` (0 = today/overdue), null when unset/invalid
  - `sortForQueue(threads): Thread[]` — new array sorted by `queueCompare`

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/inbox/__tests__/view-model.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  getLifecycleStatus,
  threadTab,
  isAutomated,
  resolveInboxSlug,
  deriveReason,
  queueCompare,
  waitingGroup,
  wakeInDays,
  sortForQueue,
} from "../view-model.js";

const base = { id: "t1", status: "needs_attention", tags: [], unread_count: 0 };

describe("getLifecycleStatus", () => {
  it("normalizes legacy values", () => {
    expect(getLifecycleStatus({ ...base, status: "Open" })).toBe("needs_attention");
    expect(getLifecycleStatus({ ...base, status: "pending" })).toBe("waiting_customer");
    expect(getLifecycleStatus({ ...base, status: "Solved" })).toBe("resolved");
  });
  it("passes canonical values through", () => {
    expect(getLifecycleStatus({ ...base, status: "waiting_third_party" })).toBe("waiting_third_party");
  });
});

describe("threadTab", () => {
  it("maps lifecycle statuses to tabs", () => {
    expect(threadTab({ ...base, status: "needs_attention" })).toBe("needs_attention");
    expect(threadTab({ ...base, status: "waiting_customer" })).toBe("waiting");
    expect(threadTab({ ...base, status: "waiting_third_party" })).toBe("waiting");
    expect(threadTab({ ...base, status: "resolved" })).toBe("resolved");
    expect(threadTab({ ...base, status: "blocked" })).toBe("blocked");
  });
  it("close_pending forces needs_attention even while waiting", () => {
    expect(threadTab({ ...base, status: "waiting_customer", close_pending: true })).toBe("needs_attention");
  });
  it("maps legacy values through normalization", () => {
    expect(threadTab({ ...base, status: "open" })).toBe("needs_attention");
    expect(threadTab({ ...base, status: "waiting" })).toBe("waiting");
  });
});

describe("isAutomated", () => {
  it("flags notification-classified threads", () => {
    expect(isAutomated({ ...base, classification_key: "notification" })).toBe(true);
    expect(isAutomated({ ...base, classification_key: "support" })).toBe(false);
    expect(isAutomated(base)).toBe(false);
  });
});

describe("resolveInboxSlug", () => {
  it("returns the slug when the inbox exists", () => {
    expect(resolveInboxSlug({ ...base, tags: ["inbox:returns", "vip"] }, ["returns"])).toBe("returns");
  });
  it("falls back to null for a stale/deleted inbox", () => {
    expect(resolveInboxSlug({ ...base, tags: ["inbox:deleted-inbox"] }, ["returns"])).toBe(null);
  });
  it("handles no inbox tag and bad tags input", () => {
    expect(resolveInboxSlug({ ...base, tags: ["vip"] }, ["returns"])).toBe(null);
    expect(resolveInboxSlug({ ...base, tags: null }, ["returns"])).toBe(null);
  });
});

describe("deriveReason", () => {
  it("uses stored attention_reason", () => {
    expect(deriveReason({ ...base, attention_reason: "customer_replied" })).toEqual({
      key: "customer_replied",
      label: "Customer replied",
    });
    expect(deriveReason({ ...base, attention_reason: "new" })).toEqual({ key: "new", label: "New" });
    expect(deriveReason({ ...base, attention_reason: "wake_timer" })).toEqual({ key: "wake_timer", label: "Woke up" });
    expect(deriveReason({ ...base, attention_reason: "approve_close" })).toEqual({ key: "approve_close", label: "Approve close" });
  });
  it("falls back to New for unread threads with no stored reason", () => {
    expect(deriveReason({ ...base, attention_reason: null, unread_count: 2 })).toEqual({ key: "new", label: "New" });
  });
  it("returns null when nothing applies", () => {
    expect(deriveReason({ ...base, attention_reason: null, unread_count: 0 })).toBe(null);
    expect(deriveReason({ ...base, attention_reason: "garbage" })).toBe(null);
  });
});

describe("queueCompare + sortForQueue", () => {
  const at = (iso) => ({ ...base, customer_last_inbound_at: iso });
  it("puts the oldest customer wait first", () => {
    const older = at("2026-07-01T10:00:00Z");
    const newer = at("2026-07-03T10:00:00Z");
    expect(queueCompare(older, newer)).toBeLessThan(0);
    expect(sortForQueue([newer, older])[0]).toBe(older);
  });
  it("falls back to last_message_at when customer_last_inbound_at is missing", () => {
    const noInbound = { ...base, customer_last_inbound_at: null, last_message_at: "2026-07-01T10:00:00Z" };
    const withInbound = at("2026-07-02T10:00:00Z");
    expect(queueCompare(noInbound, withInbound)).toBeLessThan(0);
  });
  it("treats fully missing timestamps as newest (last)", () => {
    const nothing = { ...base, customer_last_inbound_at: null, last_message_at: null };
    const real = at("2026-07-01T10:00:00Z");
    expect(sortForQueue([nothing, real])[0]).toBe(real);
  });
  it("does not mutate the input array", () => {
    const arr = [at("2026-07-03T10:00:00Z"), at("2026-07-01T10:00:00Z")];
    const copy = [...arr];
    sortForQueue(arr);
    expect(arr).toEqual(copy);
  });
});

describe("waitingGroup", () => {
  it("groups by waiting_reason with customer as the default", () => {
    expect(waitingGroup({ ...base, waiting_reason: "third_party" })).toBe("third_party");
    expect(waitingGroup({ ...base, waiting_reason: "customer" })).toBe("customer");
    expect(waitingGroup({ ...base, waiting_reason: null })).toBe("customer");
    expect(waitingGroup(base)).toBe("customer");
  });
});

describe("wakeInDays", () => {
  const NOW = Date.parse("2026-07-03T12:00:00Z");
  it("computes whole days until wake_at", () => {
    expect(wakeInDays({ ...base, wake_at: "2026-07-08T12:00:00Z" }, NOW)).toBe(5);
  });
  it("clamps past-due to 0", () => {
    expect(wakeInDays({ ...base, wake_at: "2026-07-01T12:00:00Z" }, NOW)).toBe(0);
  });
  it("returns null for missing or invalid wake_at", () => {
    expect(wakeInDays(base, NOW)).toBe(null);
    expect(wakeInDays({ ...base, wake_at: "garbage" }, NOW)).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npm test`
Expected: FAIL — `Cannot find module '../view-model.js'`

- [ ] **Step 3: Implement**

`apps/web/lib/inbox/view-model.js`:

```js
// Pure queue semantics — no React, no I/O. The UI consumes these decisions.
// Status vocabulary comes from status-model.js; keep the two in sync.
import { normalizeLifecycleStatus } from "./status-model.js";

export function getLifecycleStatus(thread) {
  return normalizeLifecycleStatus(thread?.status);
}

export function threadTab(thread) {
  if (thread?.close_pending === true) return "needs_attention";
  const status = getLifecycleStatus(thread);
  if (status === "waiting_customer" || status === "waiting_third_party") return "waiting";
  if (status === "resolved") return "resolved";
  if (status === "blocked") return "blocked";
  return "needs_attention";
}

export function isAutomated(thread) {
  return String(thread?.classification_key || "") === "notification";
}

export function resolveInboxSlug(thread, knownSlugs) {
  const tags = Array.isArray(thread?.tags) ? thread.tags : [];
  const hit = tags.find((tag) => String(tag || "").startsWith("inbox:"));
  if (!hit) return null;
  const slug = String(hit).slice("inbox:".length).trim();
  if (!slug) return null;
  return Array.isArray(knownSlugs) && knownSlugs.includes(slug) ? slug : null;
}

const REASON_LABELS = {
  customer_replied: "Customer replied",
  new: "New",
  wake_timer: "Woke up",
  approve_close: "Approve close",
};

export function deriveReason(thread) {
  const stored = String(thread?.attention_reason || "").trim();
  if (REASON_LABELS[stored]) return { key: stored, label: REASON_LABELS[stored] };
  if (stored) return null;
  if (Number(thread?.unread_count ?? 0) > 0) return { key: "new", label: REASON_LABELS.new };
  return null;
}

function waitTimestamp(thread) {
  const inbound = Date.parse(thread?.customer_last_inbound_at || "");
  if (!Number.isNaN(inbound)) return inbound;
  const last = Date.parse(thread?.last_message_at || "");
  if (!Number.isNaN(last)) return last;
  return Number.POSITIVE_INFINITY;
}

export function queueCompare(a, b) {
  return waitTimestamp(a) - waitTimestamp(b);
}

export function sortForQueue(threads) {
  return [...(threads || [])].sort(queueCompare);
}

export function waitingGroup(thread) {
  return String(thread?.waiting_reason || "").trim() === "third_party" ? "third_party" : "customer";
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function wakeInDays(thread, nowMs) {
  const wake = Date.parse(thread?.wake_at || "");
  if (Number.isNaN(wake)) return null;
  return Math.max(0, Math.ceil((wake - nowMs) / DAY_MS));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test`
Expected: all PASS (previous 18 + these new tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/inbox/view-model.js apps/web/lib/inbox/__tests__/view-model.test.js
git commit -m "feat(web): pure queue view-model (tabs, sorting, reasons, waiting groups)"
```

---

### Task 2: Lifecycle columns in the thread select

**Files:**
- Modify: `apps/web/lib/server/inbox-data.js:96-101` (the `loadThreads` select strings)

**Interfaces:**
- Produces: client-side thread objects now carry `waiting_reason, wake_at, close_pending, attention_reason, status_changed_at` (consumed by every later task via `view-model.js`).

- [ ] **Step 1: Extend both select variants**

In `loadThreads`' `runQuery`, both select strings (the `withCustomerFields` true/false variants, lines 96-101) end with `..., created_at, updated_at, customer_language`. Append to BOTH:

```
, waiting_reason, wake_at, close_pending, attention_reason, status_changed_at
```

CRITICAL: the five columns exist in the merged migration file but NOT in the live database yet (migration unapplied), so a bare select extension would fail against the live DB. Handle this the same way the file already handles optional columns: gate the new columns behind a fallback tier. Extend the fallback error regex at line ~110 to also match the new column names — change it from:

```js
/customer_name|customer_email|customer_last_inbound_at|customer_language|ticket_number/i.test(String(error.message || ""))
```

to:

```js
/customer_name|customer_email|customer_last_inbound_at|customer_language|ticket_number|waiting_reason|wake_at|close_pending|attention_reason|status_changed_at/i.test(String(error.message || ""))
```

and give `runQuery` a `withLifecycleFields = true` parameter that gates the appended column string (same pattern as `withTicketNumber`). The retry cascade becomes: full → without lifecycle fields → without customer fields → without ticket_number. Preserve the existing cascade behavior for the old fields.

- [ ] **Step 2: Verify locally against the (unmigrated) live DB**

Run: `cd apps/web && npx next dev` — open /inbox, confirm the ticket list still loads (the fallback tier without lifecycle columns must kick in silently). Then stop the server.
Run: `npm test` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/server/inbox-data.js
git commit -m "feat(web): fetch lifecycle columns in thread select, with unmigrated-DB fallback"
```

---

### Task 3: Extract useThreadFilters + wire view-model into the filter pipeline

**Files:**
- Create: `apps/web/lib/inbox/useThreadFilters.js`
- Modify: `apps/web/components/inbox/InboxSplitView.jsx` (filters state ~lines 1470-1490; the filtering/sorting block ~lines 1830-1945)

**Interfaces:**
- Consumes: `threadTab`, `isAutomated`, `resolveInboxSlug`, `sortForQueue` from `apps/web/lib/inbox/view-model.js`.
- Produces: `useThreadFilters({ searchParams })` returning `{ filters, setFilters, activeView, effectiveFilters }` — exactly the state and derived values the filter block consumes today. Behavior-preserving: the visible list must be identical before/after.

This is a verbatim-move refactor, not a rewrite. Procedure:

- [ ] **Step 1: Map the current filter state**

Read `InboxSplitView.jsx` around lines 1120-1500 and identify: `activeView` (`searchParams?.get("view")`), the `filters` state (`DEFAULT_FILTERS` shape: `query`, `statuses`, `unreadsOnly`, `sortBy`), and `effectiveFilters` derivation. List every consumer of these identifiers in the file (grep). Record the list in your report.

- [ ] **Step 2: Create the hook by moving code verbatim**

`apps/web/lib/inbox/useThreadFilters.js` exports `useThreadFilters({ searchParams })`. Move the state declarations and derivations identified in Step 1 into it unchanged (imports adjusted). `InboxSplitView` calls the hook and destructures the same names — no call-site logic changes.

- [ ] **Step 3: Replace inline view-membership checks with view-model calls**

In the filtering block (~1830-1945), the checks `effectiveStatus === "Solved"` / `activeView === "resolved"` / `inboxBucket === "notification"` decide view membership. Replace ONLY the raw mechanics with `view-model.js` calls (`threadTab(thread) === "resolved"`, `isAutomated(thread)`) while preserving the exact same view semantics as today (legacy `?view=` values still work — the new views come in Task 6, not here). The rendered list must not change.

- [ ] **Step 4: Verify (hard gate)**

Run: `cd apps/web && npm test` — PASS.
Run: `npx next dev` → /inbox manual walkthrough: default list identical, `?view=resolved` shows resolved only, `?view=notifications` shows notifications, search box filters, sort dropdown works, unread filter works. Record what you checked.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/inbox/useThreadFilters.js apps/web/components/inbox/InboxSplitView.jsx
git commit -m "refactor(web): extract useThreadFilters; route view membership through view-model"
```

---

### Task 4: Extract useThreadSelection (selection, tabs, prefetch)

**Files:**
- Create: `apps/web/lib/inbox/useThreadSelection.js`
- Modify: `apps/web/components/inbox/InboxSplitView.jsx`

**Interfaces:**
- Produces: `useThreadSelection({ threads, sortedThreads })` returning the selection state (`selectedThreadId`, open-tab state, and the prefetch orchestration) under their existing names. Also exposes `selectNext()` — returns/selects the next thread after the currently selected one in `sortedThreads` order (consumed by Task 10; inert until then).

- [ ] **Step 1: Map selection + prefetch state**

Grep `InboxSplitView.jsx` for `selectedThreadId`, `setSelectedThreadId`, tab-state (the workspace tabs from `WorkspaceTabsRow` usage), and the prefetch machinery (`MAX_PREFETCH_IN_FLIGHT`, `SECONDARY_THREAD_FETCH_DELAY_MS`, `deferAfterInteraction` consumers). List every state variable and effect that belongs to "which thread is open and what do we preload". Record the list in your report.

- [ ] **Step 2: Move verbatim into the hook**

Same procedure as Task 3: state + effects move unchanged; `InboxSplitView` destructures the same names. Add `selectNext()` as a small new function inside the hook:

```js
const selectNext = useCallback(() => {
  const order = Array.isArray(sortedThreads) ? sortedThreads : [];
  const idx = order.findIndex((t) => t?.id === selectedThreadId);
  const next = idx >= 0 ? order[idx + 1] : order[0];
  if (next?.id) setSelectedThreadId(next.id);
  return next?.id ?? null;
}, [sortedThreads, selectedThreadId]);
```

- [ ] **Step 3: Verify (hard gate)**

`npm test` PASS + manual walkthrough: clicking threads opens them, tabs work, switching threads still prefetches (network tab shows detail fetches), nothing visually changed.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/inbox/useThreadSelection.js apps/web/components/inbox/InboxSplitView.jsx
git commit -m "refactor(web): extract useThreadSelection with selectNext for send-to-next"
```

---

### Task 5: Extract useThreadActions + useComposerState

**Files:**
- Create: `apps/web/lib/inbox/useThreadActions.js`
- Create: `apps/web/lib/inbox/useComposerState.js`
- Modify: `apps/web/components/inbox/InboxSplitView.jsx`

**Interfaces:**
- Produces: `useThreadActions(...)` owning approvals/order-updates/optimistic state (`pendingOrderUpdateByThread`, `orderUpdateDecisionByThread`, `ticketStateByThread`, follow-up handling); `useComposerState(...)` owning composer orchestration (`composeMode`, draft-generation guards, `handleSendDraft` at ~line 4566). Existing names preserved at the call site. `handleSendDraft` must accept an optional `{ onSent }` callback invoked exactly once after a fully successful send (inert until Task 10).

- [ ] **Step 1: Map, move verbatim, wire** — same procedure as Tasks 3-4: grep-map the state clusters, record the list, move unchanged, destructure same names. Add the `onSent` hook point at the end of `handleSendDraft`'s success path (after the optimistic status update block ~line 4825): `if (typeof onSent === "function") onSent();`

- [ ] **Step 2: Verify (hard gate)**

`npm test` PASS + manual walkthrough: open a thread with a pending action card (or verify the card code path renders for a thread with `thread_actions`), generate-draft button works, send flow reachable. Confirm `InboxSplitView.jsx` line count: run `wc -l apps/web/components/inbox/InboxSplitView.jsx` — expect a substantial drop (target trajectory toward < 800 after Task 6's deletions; record the number).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/inbox/useThreadActions.js apps/web/lib/inbox/useComposerState.js apps/web/components/inbox/InboxSplitView.jsx
git commit -m "refactor(web): extract useThreadActions and useComposerState from InboxSplitView"
```

---

### Task 6: New view routing + status tabs

**Files:**
- Create: `apps/web/components/inbox/StatusTabs.jsx`
- Modify: `apps/web/lib/inbox/useThreadFilters.js` (view routing)
- Modify: `apps/web/components/inbox/InboxSplitView.jsx` (render tabs in the list header)
- Test: extend `apps/web/lib/inbox/__tests__/view-model.test.js` only if new pure logic is added (view routing mapping goes in the hook; if any pure mapping function is factored out, test it)

**Interfaces:**
- Consumes: `threadTab`, `isAutomated`, `resolveInboxSlug`, `sortForQueue` from view-model; `useThreadFilters` from Task 3.
- Produces: URL scheme `?view=` with values `needs_attention` (default, omitted), `mine`, `waiting`, `resolved`, `automated`, `all`, `inbox:<slug>`; plus `?tab=` within inbox views (`needs_attention` default | `waiting` | `resolved`). Legacy values map: `resolved`→`resolved`, `notifications`→`automated`. Produces `<StatusTabs active counts onChange />`.

- [ ] **Step 1: View routing in useThreadFilters**

Extend the hook: parse `view`/`tab` params, map legacy values, and compute the visible thread set:

- `needs_attention` (default): `threadTab(t) === "needs_attention"` AND NOT `isAutomated(t)`, sorted by `sortForQueue`; approve-close threads (`close_pending === true`) sort to the BOTTOM as their own segment (stable partition after sorting).
- `mine`: needs_attention set further filtered to `assignee_id === currentSupabaseUserId` (the id the existing assign UI already uses — reuse its source).
- `waiting` / `resolved`: `threadTab(t)` match, NOT automated; keep existing sort dropdown behavior (newest activity default).
- `automated`: `isAutomated(t)` only.
- `all`: today's "View all" behavior — unchanged semantics, all statuses.
- `inbox:<slug>`: `resolveInboxSlug(t, knownSlugs) === slug`, then the `tab` param picks needs_attention/waiting/resolved subset with the same rules as above.

- [ ] **Step 2: StatusTabs component**

`apps/web/components/inbox/StatusTabs.jsx` — quiet text toggles matching the mockup (active = medium weight + subtle bg):

```jsx
"use client";

const TABS = [
  { key: "needs_attention", label: "Needs attention" },
  { key: "waiting", label: "Waiting" },
  { key: "resolved", label: "Resolved" },
];

export function StatusTabs({ active, counts = {}, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        const count = counts[tab.key];
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange?.(tab.key)}
            className={
              "rounded-md px-2.5 py-1 text-xs transition-colors " +
              (isActive
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {tab.label}
            {typeof count === "number" && count > 0 ? ` · ${count}` : ""}
          </button>
        );
      })}
    </div>
  );
}
```

Counts passed in are client-side (length of each computed subset) so they work pre-migration.

- [ ] **Step 3: Render tabs in the list header** — next to the existing search input row in `InboxSplitView.jsx`, visible in every view except `all`/`automated`. Tab clicks update the `tab`/`view` search params (router.replace, keep other params).

- [ ] **Step 4: Verify** — `npm test` PASS; manual walkthrough: default view shows needs-attention-tab list sorted oldest-wait-first (against unmigrated data: legacy `open`/`new` threads appear here via normalization — confirm), Waiting tab shows pending/waiting legacy threads, Resolved shows solved, `?view=notifications` legacy URL lands in Automated, View all unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/inbox/StatusTabs.jsx apps/web/lib/inbox/useThreadFilters.js apps/web/components/inbox/InboxSplitView.jsx
git commit -m "feat(web): lifecycle view routing and status tabs in the list header"
```

---

### Task 7: Row format — reason text, meta line, unread weight

**Files:**
- Modify: `apps/web/components/inbox/TicketListItem.jsx` (164 lines — read it fully first)
- Modify: `apps/web/components/inbox/TicketList.jsx` (pass-through props only, if needed)

**Interfaces:**
- Consumes: `deriveReason`, `resolveInboxSlug` from view-model.
- Produces: rows matching the approved mockup: reason as colored text where status text renders today; meta line `<inbox name> · Draft ready · <assignee initials|Unassigned>`; unread = bold sender/subject.

- [ ] **Step 1: Read `TicketListItem.jsx` fully.** Identify where the status text renders (the colored "Open"/"Pending" text) and what props it receives.

- [ ] **Step 2: Reason text replaces status text in queue views.** Add a `reason` prop (the `deriveReason` result, computed in the list layer where the thread object is available). Render:

```jsx
{reason ? (
  <span
    className={
      "text-xs whitespace-nowrap " +
      (reason.key === "customer_replied"
        ? "text-amber-700 dark:text-amber-500"
        : reason.key === "approve_close"
          ? "text-purple-700 dark:text-purple-400"
          : "text-green-700 dark:text-green-500")
    }
  >
    {reason.label}
  </span>
) : null}
```

In the `all` view (View all), keep today's status text (pass `reason={null}` and the existing status label) — lookup view stays familiar.

- [ ] **Step 3: Meta line.** Where the current third line renders (tag/pill area), render: inbox name (from `resolveInboxSlug` + the inbox list's display names), a purple "Draft ready" text when the thread has a ready AI draft (reuse the existing draft-presence signal the list already tracks for its draft indicator — grep `ai_draft` in TicketList/TicketListItem/InboxSplitView and reuse; if no list-level signal exists, note it in the report and render Draft ready only where the data is already available — do NOT add new fetches), and assignee initials or "Unassigned" (muted).

- [ ] **Step 4: Unread weight.** Bold sender + subject when `unread_count > 0` (likely already the case — verify and keep).

- [ ] **Step 5: Verify + commit**

`npm test` PASS; manual: rows show reason text (legacy `open` threads → no stored reason → unread fallback or none), meta line renders, no crash on threads with null lifecycle fields.

```bash
git add apps/web/components/inbox/TicketListItem.jsx apps/web/components/inbox/TicketList.jsx apps/web/components/inbox/InboxSplitView.jsx
git commit -m "feat(web): queue row format — reason text, meta line, unread weight"
```

---

### Task 8: Waiting view groups + wake info

**Files:**
- Modify: `apps/web/components/inbox/TicketList.jsx` (group rendering)
- Modify: `apps/web/lib/inbox/useThreadFilters.js` (waiting view exposes grouped lists)

**Interfaces:**
- Consumes: `waitingGroup`, `wakeInDays` from view-model.
- Produces: the Waiting tab renders two labeled groups — "Waiting on customer" and "Waiting on third party" (group omitted when empty) — with a muted "wakes in N days" / "wakes today" suffix on rows where `wake_at` is set.

- [ ] **Step 1:** In the waiting view, partition the visible set with `waitingGroup` and pass `groups=[{key,label,threads}]` to `TicketList`. `TicketList` renders a small muted uppercase group header (match the sidebar section-label style) above each group's rows; when only one group is non-empty, still show its header.
- [ ] **Step 2:** In the row (Waiting tab only), render `wakeInDays(thread, Date.now())` as: null → nothing; 0 → "wakes today"; N → `wakes in ${N} days` (singular "day" for 1) in muted text where the reason text renders in the queue view.
- [ ] **Step 3: Verify + commit** — `npm test` PASS; manual: Waiting tab shows groups (unmigrated data: all under "Waiting on customer" — expected), no crash on null wake_at.

```bash
git add apps/web/components/inbox/TicketList.jsx apps/web/lib/inbox/useThreadFilters.js apps/web/components/inbox/InboxSplitView.jsx
git commit -m "feat(web): waiting view groups with wake countdown"
```

---

### Task 9: Approve-close group + actions

**Files:**
- Modify: `apps/web/components/inbox/TicketList.jsx` (bottom group in the needs-attention view)
- Modify: `apps/web/lib/inbox/useThreadActions.js` (approve/keep-waiting handlers)

**Interfaces:**
- Consumes: the existing PATCH endpoint `/api/inbox/thread-status` (accepts `{ threadId, status, waitingReason, wakeAt }` — status values normalized server-side; Plan 1 Task 8).
- Produces: in the needs-attention view, `close_pending` threads render as a bottom group headed "Approve close" with two row actions: **Approve** → PATCH `{ threadId, status: "resolved" }`; **Keep waiting** → PATCH `{ threadId, status: "waiting_customer" }` (server clears `close_pending` on both — verified in Plan 1). Optimistic update: remove the thread from the group immediately, revert on failure (follow the existing optimistic patterns in `useThreadActions`).

- [ ] **Step 1:** Partition the needs-attention set on `close_pending === true` (already sorted to the bottom in Task 6); render as a group titled "Approve close" with the same group-header style as Task 8.
- [ ] **Step 2:** Add the two handlers to `useThreadActions` (fetch PATCH, optimistic local status update via the existing `ticketStateByThread` mechanism, toast on failure using the file's existing `toast` import pattern). Render two small quiet text-buttons on rows in this group: "Approve" and "Keep waiting".
- [ ] **Step 3: Verify + commit** — `npm test` PASS. Manual: no `close_pending` rows exist pre-migration, so verify by temporarily hardcoding one thread's `close_pending` in the browser (React DevTools or a temporary map in dev) OR verify the group renders via a quick throwaway unit test on the partition logic; state in the report which. The live behavior verifies post-deploy via the checklist.

```bash
git add apps/web/components/inbox/TicketList.jsx apps/web/lib/inbox/useThreadActions.js apps/web/components/inbox/InboxSplitView.jsx
git commit -m "feat(web): approve-close group with approve / keep-waiting actions"
```

---

### Task 10: Send → next

**Files:**
- Modify: `apps/web/components/inbox/InboxSplitView.jsx` (wire `onSent` → `selectNext`)
- Modify: `apps/web/components/inbox/TicketList.jsx` or `InboxSplitView.jsx` (inbox-zero empty state)

**Interfaces:**
- Consumes: `selectNext()` from `useThreadSelection` (Task 4); `onSent` callback on `handleSendDraft` (Task 5).

- [ ] **Step 1:** Pass `onSent: selectNext` into the composer state so a successful send advances to the next thread in the current sorted view (only in queue views — `needs_attention`/`mine`/inbox needs-attention tab; in `all`/`waiting`/`resolved` keep today's stay-on-thread behavior).
- [ ] **Step 2:** Empty state: when the needs-attention view has zero threads, render a quiet centered empty state in the list pane: an inbox icon (existing icon set), "Inbox zero", and muted "Nothing needs your attention right now." — no confetti, Sona-quiet.
- [ ] **Step 3: Verify + commit** — `npm test` PASS; manual: send a reply from the queue view (test-mode) and confirm the next thread opens; empty state renders when search filters produce zero results in the queue view.

```bash
git add apps/web/components/inbox/InboxSplitView.jsx apps/web/components/inbox/TicketList.jsx
git commit -m "feat(web): send advances to next queue thread; quiet inbox-zero empty state"
```

---

### Task 11: Sidebar restructure (QUEUE / INBOXES / AUTOMATED / Settings)

**Files:**
- Create: `apps/web/components/nav-queue.jsx`
- Modify: `apps/web/components/app-sidebar.jsx` (replace the INBOXES block ~lines 160-270; consume new count keys ~lines 374-420; move config entries behind Settings ~navMain data at line 64 and the NavAgent/NavSecondary rendering ~lines 684-696)

**Interfaces:**
- Consumes: `/api/inbox/sidebar-counts` extended keys (`needsAttentionCount`, `mineCount`, `waitingCustomerCount`, `waitingThirdPartyCount`, `inboxNeedsAttentionCounts`) — already returned by Plan 1 Task 10; `/api/inboxes` for the inbox list (existing).
- Produces: sidebar per the approved mockup — sections QUEUE (Needs attention N / Mine N / Waiting N-muted / Resolved), INBOXES (per-inbox needs-attention counts, "+" on the section header, empty by default), collapsed AUTOMATED (Notifications, Courier — the existing notifications view + courier inbox entries move here), bottom: Knowledge, Analytics, Settings (collapsible group containing the existing Mailboxes, Playground, Automation, Tags, Integrations links — routes unchanged).

- [ ] **Step 1: Read `app-sidebar.jsx` fully** (943 lines). Map: the current INBOXES section markup, the counts state/fetch (`customInboxUnreadCounts` at ~375-416), the navMain/agent/secondary data arrays, and how active-state highlighting works (pathname + `view` param).
- [ ] **Step 2: Build `nav-queue.jsx`** — a client component rendering the QUEUE + INBOXES + AUTOMATED sections with the existing sidebar primitives (same `SidebarMenu`/button components the file already uses — reuse, don't invent). Props: `{ counts, inboxes, activeView, onCreateInbox }`. Links are `/inbox?view=...` per Task 6's scheme. Needs-attention counts render as today's count badges; the Waiting count renders muted (`text-muted-foreground`); Resolved and AUTOMATED entries have no counts. AUTOMATED is a collapsible section (existing Radix Collapsible pattern in the codebase), default collapsed.
- [ ] **Step 3: Wire into `app-sidebar.jsx`** — replace the old INBOXES block with `<NavQueue …/>`; extend the counts state to store the new keys from the sidebar-counts payload (default 0); move Mailboxes/Playground/Automation/Tags/Integrations entries into a collapsible "Settings" group at the bottom (routes untouched); keep Dashboard, Knowledge, Analytics as-is per the mockup.
- [ ] **Step 4: Verify + commit** — `npm test` PASS; manual: sidebar matches the mockup structure, all links navigate to the right views, counts render (0 from DB-side keys pre-migration is expected — client-side tab counts in the list still show real numbers), Settings group expands/collapses, "+" opens the existing create-inbox flow.

```bash
git add apps/web/components/nav-queue.jsx apps/web/components/app-sidebar.jsx
git commit -m "feat(web): sidebar restructure — queue/inboxes/automated sections, settings group"
```

---

### Task 12: Final sweep — line-count check, deploy checklist extension, CLAUDE.md

**Files:**
- Modify: `docs/superpowers/plans/2026-07-03-thread-lifecycle-status-deploy-checklist.md`
- Modify: `CLAUDE.md` ("Seneste ændringer")

- [ ] **Step 1: Full test sweep** — `cd apps/web && npm test` (all suites) and `cd supabase && deno test functions/_shared/thread-status/`. Expected: all PASS.
- [ ] **Step 2: Line-count check** — `wc -l apps/web/components/inbox/InboxSplitView.jsx`. Target < 800; if above, report the number and the largest remaining block (do not force further extraction — report only).
- [ ] **Step 3: Extend the deploy checklist** with a "Plan 2 UI verification (post-migration)" section: sidebar counts show real numbers; Needs attention tab matches `needsAttentionCount`; reason badges show stored reasons (Customer replied on reopened threads); Waiting groups split correctly once `waiting_third_party` threads exist; approve-close group appears when the tick flags a thread (can be forced by backdating `status_changed_at` per the existing checklist step); send→next advances.
- [ ] **Step 4: CLAUDE.md bullet** — one new "Seneste ændringer" bullet (terse, Danish, real file names) describing the queue workspace UI + the InboxSplitView refactor (view-model.js + hooks), noting deploy still pending via the checklist.
- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-03-thread-lifecycle-status-deploy-checklist.md CLAUDE.md
git commit -m "docs: extend deploy checklist with Plan 2 UI verification; note queue UI in CLAUDE.md"
```
