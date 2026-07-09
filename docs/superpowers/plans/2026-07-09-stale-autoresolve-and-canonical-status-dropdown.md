# Stale Inbox Auto-Resolve + Canonical Status Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Give each workspace a configurable "auto-resolve inbox tickets with no activity for N days" policy (default 7, 0 = off) enforced by the lifecycle cron; (2) replace the ticket-header's legacy 5-status dropdown with the 4 canonical lifecycle statuses.

**Architecture:** Feature 1 adds a `workspaces.needs_attention_stale_days` column and a 4th step to the existing `tick_thread_lifecycle()` pg_cron function that resolves stale `needs_attention` threads, using a per-row effective-days lookup that coalesces to a global default of 7 so the ~3,100 `NULL`-`workspace_id` threads (incomplete tenancy migration) are still covered; a number field is added to the existing `/api/settings/test-mode` workspace-settings endpoint and rendered in `SettingsPanel`. Feature 2 reworks the `InboxHeaderActions` status `<Select>` in `InboxSplitView.jsx` to derive its displayed value from the selected thread's canonical `status` + `waiting_reason` (not the legacy-collapsed `ticketState`), removes the legacy `New→Open` auto-transition, and sends canonical status strings that the existing `buildManualStatusPatch` already accepts.

**Tech Stack:** Next.js 14.2.5 App Router, React 18.2, Supabase Postgres + pg_cron, Vitest, Tailwind/Radix Select.

## Global Constraints

- The 4 canonical lifecycle statuses are exactly: `needs_attention`, `waiting_customer`, `waiting_third_party`, `resolved` (from `apps/web/lib/inbox/status-model.js` `LIFECYCLE_STATUSES`).
- Canonical UI labels are exactly: "Needs attention", "Waiting on customer", "Waiting on third party", "Resolved".
- Deploy ordering is load-bearing (v87 incident, see `project_postmark_lifecycle_incident` + `docs/superpowers/plans/2026-07-03-thread-lifecycle-status-deploy-checklist.md`): a schema migration MUST be applied to prod BEFORE any deployed code depends on the new column. For Feature 1 the migration is self-contained (SQL only) and safe to apply first; the settings UI/API deploy after.
- Production prod Supabase ref: `ikuupzjaxzvatdnmyzoy`. Production runs on a droplet (`git pull && cd apps/web && npm run build && pm2 restart sona-web`), NOT Vercel.
- Migrations are written to `supabase/migrations/` but applied to prod via the Supabase MCP `apply_migration` (per `project_thread_lifecycle_deployed`).
- `needs_attention_stale_days` clamp range: integer `0`–`365`; `0` means the policy is disabled for that workspace. Global fallback default when a workspace row/column is absent: `7`.
- Run web tests with `npm --workspace apps/web test` (Vitest). Tests live in `apps/web/lib/inbox/__tests__/`.
- Do NOT run a full golden eval or any paid AI eval as part of this work (`feedback_eval_cost_discipline`).

---

## File Structure

**Feature 1 — stale auto-resolve**
- Create: `supabase/migrations/20260709120000_needs_attention_stale_resolve.sql` — adds the column + replaces `tick_thread_lifecycle()` with the 4-step version.
- Create: `apps/web/lib/inbox/stale-days.js` — pure `normalizeStaleDays(value)` clamp helper (testable, shared by the route).
- Create: `apps/web/lib/inbox/__tests__/stale-days.test.js` — unit tests for the clamp.
- Modify: `apps/web/app/api/settings/test-mode/route.js` — read/write `needs_attention_stale_days`.
- Modify: `apps/web/components/settings/SettingsPanel.jsx` — number input in the workspace-settings section that already consumes `/api/settings/test-mode`.

**Feature 2 — canonical status dropdown**
- Create: `apps/web/lib/inbox/__tests__/canonical-status-option.test.js` — tests for the new pure helper.
- Modify: `apps/web/lib/inbox/view-model.js` — add `canonicalStatusOption(thread)` + `CANONICAL_STATUS_OPTIONS`.
- Modify: `apps/web/components/inbox/InboxSplitView.jsx` — swap `STATUS_OPTIONS`/the header `<Select>` to canonical; remove the legacy `New→Open` auto-transition; change `DEFAULT_TICKET_STATE.status`; pass `canonicalStatus` to `InboxHeaderActions`; update the `"Solved"` advance check to `"resolved"`.

---

## Task 1: Migration — stale-resolve column + tick step 4

**Files:**
- Create: `supabase/migrations/20260709120000_needs_attention_stale_resolve.sql`

**Interfaces:**
- Produces: `workspaces.needs_attention_stale_days integer not null default 7`; a `tick_thread_lifecycle()` whose 4th statement resolves stale `needs_attention` threads.

- [ ] **Step 1: Write the migration file**

```sql
-- Feature 1: configurable per-workspace auto-resolve of stale inbox
-- (needs_attention) threads. 0 = disabled. Global fallback default is 7 so
-- threads with a NULL workspace_id (the bulk of the imported backlog while the
-- tenancy migration is incomplete) are still covered by the tick.
alter table public.workspaces
  add column if not exists needs_attention_stale_days integer not null default 7
    check (needs_attention_stale_days >= 0 and needs_attention_stale_days <= 365);

-- Replace the lifecycle tick with a 4-step version. Steps 1-3 are unchanged
-- from 20260703110000_thread_lifecycle_tick.sql; step 4 is new.
create or replace function public.tick_thread_lifecycle()
returns void
language sql
security definer
set search_path = public
as $$
  -- 1) Wake timers: due wake_at pulls the thread back into the queue.
  update public.mail_threads
  set status = 'needs_attention',
      attention_reason = 'wake_timer',
      wake_at = null,
      status_changed_at = now(),
      updated_at = now()
  where status in ('waiting_customer', 'waiting_third_party')
    and wake_at is not null
    and wake_at <= now();

  -- 2) Auto-close (mode 'auto'): silent waiting_customer threads resolve.
  update public.mail_threads t
  set status = 'resolved',
      waiting_reason = null,
      close_pending = false,
      attention_reason = null,
      wake_at = null,
      status_changed_at = now(),
      updated_at = now()
  from public.workspaces w
  where t.workspace_id = w.id
    and w.auto_close_mode = 'auto'
    and t.status = 'waiting_customer'
    and t.status_changed_at < now() - make_interval(days => greatest(coalesce(w.auto_close_days, 4), 1));

  -- 3) Auto-close (mode 'approve'): flag for the approve-close queue group.
  update public.mail_threads t
  set close_pending = true,
      attention_reason = 'approve_close',
      updated_at = now()
  from public.workspaces w
  where t.workspace_id = w.id
    and w.auto_close_mode = 'approve'
    and t.status = 'waiting_customer'
    and t.close_pending = false
    and t.status_changed_at < now() - make_interval(days => greatest(coalesce(w.auto_close_days, 4), 1));

  -- 4) NEW: resolve stale needs_attention threads whose last customer activity
  -- (last_message_at) is older than the workspace's configured window. The
  -- effective window is looked up per row via a correlated subquery that
  -- coalesces a NULL/absent workspace to the global default (7), so
  -- NULL-workspace_id threads are covered. A window of 0 disables the policy
  -- for that workspace (the > 0 guard skips those rows).
  with eff as (
    select t.id,
           coalesce(
             (select w.needs_attention_stale_days
                from public.workspaces w
               where w.id = t.workspace_id),
             7
           ) as stale_days
    from public.mail_threads t
    where t.status = 'needs_attention'
  )
  update public.mail_threads t
  set status = 'resolved',
      waiting_reason = null,
      close_pending = false,
      attention_reason = null,
      wake_at = null,
      status_changed_at = now(),
      updated_at = now()
  from eff
  where t.id = eff.id
    and eff.stale_days > 0
    and t.last_message_at is not null
    and t.last_message_at < now() - make_interval(days => eff.stale_days);
$$;

-- Re-schedule idempotently (function body changed; schedule name is stable).
do $$
begin
  perform cron.unschedule('thread-lifecycle-tick')
  where exists (select 1 from cron.job where jobname = 'thread-lifecycle-tick');
exception when others then null;
end $$;

select cron.schedule(
  'thread-lifecycle-tick',
  '*/15 * * * *',
  $$select public.tick_thread_lifecycle()$$
);
```

- [ ] **Step 2: Apply to prod via Supabase MCP `apply_migration`**

Use `mcp__…__apply_migration` with `project_id = ikuupzjaxzvatdnmyzoy`, name `needs_attention_stale_resolve`, and the SQL above. (This migration is SQL-only and depends on no deployed code, so applying first is safe and correct per the deploy-ordering rule.)

- [ ] **Step 3: Verify the column + tick effect with a dry-run SELECT (do NOT rely on waiting for the cron)**

Run via `execute_sql` (read-only preview of what step 4 will resolve, using the default 7 since all workspaces default to 7):

```sql
select count(*) as would_resolve
from public.mail_threads t
where t.status = 'needs_attention'
  and coalesce(
        (select w.needs_attention_stale_days from public.workspaces w where w.id = t.workspace_id),
        7) > 0
  and t.last_message_at is not null
  and t.last_message_at < now() - make_interval(days => coalesce(
        (select w.needs_attention_stale_days from public.workspaces w where w.id = t.workspace_id),
        7));
```

Expected: a number roughly equal to the count of `needs_attention` threads older than 7 days (after the earlier one-time mark-read cleanup, most old ones are already read but still `needs_attention`; this step now also resolves them). Confirm the number is plausible (thousands, matching the backlog) and non-zero.

- [ ] **Step 4: Manually run the tick once and confirm it resolves the backlog**

```sql
select public.tick_thread_lifecycle();
select count(*) filter (where status = 'needs_attention') as needs_attention_after,
       count(*) filter (where status = 'resolved') as resolved_after
from public.mail_threads;
```

Expected: `needs_attention_after` drops to roughly the count of threads with activity within 7 days (~hundreds); `resolved_after` grows by the previously-stale count. Confirm no error.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260709120000_needs_attention_stale_resolve.sql
git commit -m "feat(db): configurable stale needs_attention auto-resolve in lifecycle tick"
```

---

## Task 2: Settings API — read/write needs_attention_stale_days

**Files:**
- Create: `apps/web/lib/inbox/stale-days.js`
- Create: `apps/web/lib/inbox/__tests__/stale-days.test.js`
- Modify: `apps/web/app/api/settings/test-mode/route.js`

**Interfaces:**
- Produces: `normalizeStaleDays(value): number` (integer clamped 0–365, default 7); `/api/settings/test-mode` GET returns `needs_attention_stale_days`, PUT accepts it.
- Consumes: existing `getWorkspaceSettings`, `resolveAuthScope` in the route.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/inbox/__tests__/stale-days.test.js`:

```js
import { describe, it, expect } from "vitest";
import { normalizeStaleDays } from "../stale-days.js";

describe("normalizeStaleDays", () => {
  it("defaults non-numbers to 7", () => {
    expect(normalizeStaleDays(undefined)).toBe(7);
    expect(normalizeStaleDays(null)).toBe(7);
    expect(normalizeStaleDays("abc")).toBe(7);
  });
  it("passes through valid integers", () => {
    expect(normalizeStaleDays(0)).toBe(0);
    expect(normalizeStaleDays(14)).toBe(14);
    expect(normalizeStaleDays("30")).toBe(30);
  });
  it("clamps to 0..365 and rounds", () => {
    expect(normalizeStaleDays(-5)).toBe(0);
    expect(normalizeStaleDays(999)).toBe(365);
    expect(normalizeStaleDays(7.6)).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace apps/web test -- stale-days`
Expected: FAIL — `Cannot find module '../stale-days.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/lib/inbox/stale-days.js`:

```js
// Clamp for the per-workspace "auto-resolve inbox tickets with no activity for
// N days" setting. 0 = disabled. Default/global fallback is 7 (matches the
// tick_thread_lifecycle() coalesce default in
// supabase/migrations/20260709120000_needs_attention_stale_resolve.sql).
export const DEFAULT_STALE_DAYS = 7;
export const MIN_STALE_DAYS = 0;
export const MAX_STALE_DAYS = 365;

export function normalizeStaleDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_STALE_DAYS;
  const rounded = Math.round(parsed);
  return Math.max(MIN_STALE_DAYS, Math.min(MAX_STALE_DAYS, rounded));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace apps/web test -- stale-days`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the field into the route**

In `apps/web/app/api/settings/test-mode/route.js`:

1. Add the import near the top:
```js
import { normalizeStaleDays, DEFAULT_STALE_DAYS } from "@/lib/inbox/stale-days";
```

2. In `getWorkspaceSettings`, add `needs_attention_stale_days` to the primary `.select(...)` string and to the returned object, keeping the existing `42703` (undefined column) fallback which already re-selects a narrower set:
```js
  let query = await serviceClient
    .from("workspaces")
    .select("id, test_mode, test_email, support_language, close_suggestion_delay_hours, needs_attention_stale_days")
    .eq("id", workspaceId)
    .maybeSingle();
```
and in the returned object add:
```js
    needs_attention_stale_days: normalizeStaleDays(
      data?.needs_attention_stale_days ?? DEFAULT_STALE_DAYS
    ),
```

3. In the GET "no workspace" early return object, add `needs_attention_stale_days: DEFAULT_STALE_DAYS,`.

4. In `PUT`, compute and include the field in the `.update({...})` payload, and extend the graceful fallback's `message.includes(...)` check so a missing column degrades instead of 500ing:
```js
    const needsAttentionStaleDays = normalizeStaleDays(body?.needs_attention_stale_days);
    // ...
      .update({
        test_mode: testMode,
        test_email: testEmail,
        support_language: supportLanguage,
        close_suggestion_delay_hours: closeSuggestionDelayHours,
        needs_attention_stale_days: needsAttentionStaleDays,
        updated_at: nowIso,
      })
    // ...
      if (
        message.includes("updated_at") ||
        message.includes("close_suggestion_delay_hours") ||
        message.includes("needs_attention_stale_days")
      ) {
```

- [ ] **Step 6: Run the full web test suite**

Run: `npm --workspace apps/web test`
Expected: PASS (all prior tests + the 3 new).

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/inbox/stale-days.js apps/web/lib/inbox/__tests__/stale-days.test.js apps/web/app/api/settings/test-mode/route.js
git commit -m "feat(web): expose needs_attention_stale_days on workspace settings API"
```

---

## Task 3: Settings UI — stale-days control in SettingsPanel

**Files:**
- Modify: `apps/web/components/settings/SettingsPanel.jsx`

**Interfaces:**
- Consumes: `/api/settings/test-mode` GET/PUT (now returns/accepts `needs_attention_stale_days`).

- [ ] **Step 1: Locate the workspace-settings section**

Find the component/section in `SettingsPanel.jsx` that fetches `/api/settings/test-mode` (grep `settings/test-mode` in the file) and renders the test-mode / support-language / close settings, including the local state object it keeps for those values and its save handler (the one that PUTs to `/api/settings/test-mode`).

- [ ] **Step 2: Add local state + load**

In that section's settings state, add `needs_attention_stale_days` (initialized from the GET response, default `7`). Wherever the GET response populates the other fields, also set this one.

- [ ] **Step 3: Render the control**

Add, next to the existing close/test-mode controls, a labelled number input:

```jsx
<div className="flex flex-col gap-1">
  <label htmlFor="stale-days" className="text-sm font-medium">
    Auto-resolve inbox tickets with no activity for
  </label>
  <div className="flex items-center gap-2">
    <input
      id="stale-days"
      type="number"
      min={0}
      max={365}
      value={settings.needs_attention_stale_days ?? 7}
      onChange={(e) =>
        setSettings((prev) => ({
          ...prev,
          needs_attention_stale_days: e.target.value === "" ? "" : Number(e.target.value),
        }))
      }
      className="w-20 rounded-md border px-2 py-1 text-sm"
    />
    <span className="text-sm text-muted-foreground">days (0 = off)</span>
  </div>
  <p className="text-xs text-muted-foreground">
    Inbox tickets with no new customer activity for this many days are moved to
    Resolved automatically. Set to 0 to keep everything in the inbox.
  </p>
</div>
```

(Match the exact prop/state names and styling conventions of the surrounding controls in that section — use its `settings`/`setSettings` equivalents.)

- [ ] **Step 4: Include the field in the PUT save**

In that section's save handler, add `needs_attention_stale_days: Number(settings.needs_attention_stale_days) || 0` to the PUT body.

- [ ] **Step 5: Build to verify no compile error**

Run: `cd apps/web && npx next build`
Expected: "✓ Compiled successfully".

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/settings/SettingsPanel.jsx
git commit -m "feat(web): stale-inbox auto-resolve control in settings"
```

---

## Task 4: Feature-1 deploy

**Files:** none (ops).

- [ ] **Step 1: Confirm migration already applied**

The migration was applied in Task 1 (SQL-only, no code dependency). Re-confirm `needs_attention_stale_days` exists:
```sql
select column_name from information_schema.columns
where table_name='workspaces' and column_name='needs_attention_stale_days';
```
Expected: one row.

- [ ] **Step 2: Push + deploy frontend (settings API/UI)**

```bash
git push origin main
```
Then on the droplet: `cd ~/INNO && git pull && cd apps/web && npm run build && pm2 restart sona-web`.

- [ ] **Step 3: Live-verify**

Open Settings, confirm the "Auto-resolve … days" field shows `7`, change it to e.g. `14`, save, reload, confirm it persists. Then reset to the desired value.

---

## Task 5: Canonical status helper + remove legacy transition

**Files:**
- Modify: `apps/web/lib/inbox/view-model.js`
- Create: `apps/web/lib/inbox/__tests__/canonical-status-option.test.js`

**Interfaces:**
- Consumes: existing `getLifecycleStatus(thread)` (view-model.js:5) which returns one of the 4 canonical statuses from `thread.status`.
- Produces: `CANONICAL_STATUS_OPTIONS` (array of `{ value, label }`) and `canonicalStatusOption(thread): string` returning the canonical status key for the header select, honoring `waiting_reason` when the raw status is a generic waiting value.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/inbox/__tests__/canonical-status-option.test.js`:

```js
import { describe, it, expect } from "vitest";
import { canonicalStatusOption, CANONICAL_STATUS_OPTIONS } from "../view-model.js";

describe("canonicalStatusOption", () => {
  it("maps needs_attention", () => {
    expect(canonicalStatusOption({ status: "needs_attention" })).toBe("needs_attention");
  });
  it("preserves waiting_third_party", () => {
    expect(canonicalStatusOption({ status: "waiting_third_party" })).toBe("waiting_third_party");
  });
  it("splits generic waiting by waiting_reason", () => {
    expect(canonicalStatusOption({ status: "waiting_customer", waiting_reason: "third_party" }))
      .toBe("waiting_third_party");
    expect(canonicalStatusOption({ status: "Waiting", waiting_reason: "third_party" }))
      .toBe("waiting_third_party");
    expect(canonicalStatusOption({ status: "Waiting" })).toBe("waiting_customer");
  });
  it("maps legacy Solved/Open", () => {
    expect(canonicalStatusOption({ status: "Solved" })).toBe("resolved");
    expect(canonicalStatusOption({ status: "Open" })).toBe("needs_attention");
  });
  it("defaults empty to needs_attention", () => {
    expect(canonicalStatusOption({})).toBe("needs_attention");
    expect(canonicalStatusOption(null)).toBe("needs_attention");
  });
  it("exposes the 4 canonical options in order", () => {
    expect(CANONICAL_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      "needs_attention", "waiting_customer", "waiting_third_party", "resolved",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace apps/web test -- canonical-status-option`
Expected: FAIL — `canonicalStatusOption` / `CANONICAL_STATUS_OPTIONS` are not exported.

- [ ] **Step 3: Implement in view-model.js**

Add near `getLifecycleStatus` in `apps/web/lib/inbox/view-model.js` (it already imports/derives lifecycle status; reuse `getLifecycleStatus`):

```js
export const CANONICAL_STATUS_OPTIONS = [
  { value: "needs_attention", label: "Needs attention" },
  { value: "waiting_customer", label: "Waiting on customer" },
  { value: "waiting_third_party", label: "Waiting on third party" },
  { value: "resolved", label: "Resolved" },
];

// Canonical status key for the ticket-header status control. getLifecycleStatus
// already folds legacy strings + canonical values down to the 4 lifecycle
// statuses; the only thing it can't recover is the waiting subtype when the raw
// status is a generic "waiting"/"waiting_customer" but waiting_reason says
// third_party — so we layer that in explicitly.
export function canonicalStatusOption(thread) {
  const base = getLifecycleStatus(thread || {});
  if (
    (base === "waiting_customer" || base === "waiting_third_party") &&
    String(thread?.waiting_reason || "").trim() === "third_party"
  ) {
    return "waiting_third_party";
  }
  return base;
}
```

Confirm `getLifecycleStatus({})` / `getLifecycleStatus(null-safe)` returns `needs_attention` for empty input; if it does not already default that way, pass `thread || {}` (done above) and rely on `normalizeLifecycleStatus`'s empty→`needs_attention` behavior (status-model.js:21).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace apps/web test -- canonical-status-option`
Expected: PASS.

- [ ] **Step 5: Remove the legacy New→Open auto-transition**

In `apps/web/components/inbox/InboxSplitView.jsx`, delete the effect block (around lines 2357-2385) that does `if (isNewSelection && (hasUnreadMessages || !thread.is_read) && currentState?.status === "New") { setTicketStateByThread(... status: "Open" ...); fetch("/api/inbox/thread-status", ... status: "Open" ...) }`. This legacy status write does not belong in the canonical model (opening a thread must not change its lifecycle status; marking-read is handled separately by the existing `unread_count = 0` path). Keep any surrounding mark-read logic intact; remove ONLY the status→"Open" transition + its PATCH.

- [ ] **Step 6: Change DEFAULT_TICKET_STATE.status so "no override" is detectable**

In `InboxSplitView.jsx` change:
```js
const DEFAULT_TICKET_STATE = {
  status: null,
  assignee: null,
  priority: null,
};
```
Verify the queue-side fallback at ~line 2897 still resolves correctly: `(hasLocalState ? uiState?.status : null) || thread.status || DEFAULT_TICKET_STATE.status` becomes `… || thread.status || null`, which is fine (it falls back to the thread's real status).

- [ ] **Step 7: Run full suite + build**

Run: `npm --workspace apps/web test && cd apps/web && npx next build`
Expected: all tests PASS; build "✓ Compiled successfully".

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/inbox/view-model.js apps/web/lib/inbox/__tests__/canonical-status-option.test.js apps/web/components/inbox/InboxSplitView.jsx
git commit -m "feat(web): canonical status helper; drop legacy New→Open transition"
```

---

## Task 6: Canonical status dropdown in the header

**Files:**
- Modify: `apps/web/components/inbox/InboxSplitView.jsx`

**Interfaces:**
- Consumes: `CANONICAL_STATUS_OPTIONS`, `canonicalStatusOption` (Task 5); `handleTicketStateChange({ status })` (already forwards `status` verbatim to the PATCH, which derives `waiting_reason` via `buildManualStatusPatch`); `selectedThread` (in scope where `InboxHeaderActions` is rendered).
- Produces: `InboxHeaderActions` accepting a `canonicalStatus` prop.

- [ ] **Step 1: Import the helpers**

Ensure `InboxSplitView.jsx` imports `CANONICAL_STATUS_OPTIONS` and `canonicalStatusOption` from `@/lib/inbox/view-model` (add to the existing view-model import).

- [ ] **Step 2: Replace `STATUS_OPTIONS`**

Delete `const STATUS_OPTIONS = ["New", "Open", "Pending", "Waiting", "Solved"];` (line ~132). The dropdown will use `CANONICAL_STATUS_OPTIONS` instead.

- [ ] **Step 3: Add a `canonicalStatus` prop to `InboxHeaderActions`**

In the `InboxHeaderActions` component signature (destructured props starting ~line 278), add `canonicalStatus,`. Replace the status `<Select>` block (lines ~336-365) with a canonical version:

```jsx
  if (!ticketState) return null;
  const currentStatus = canonicalStatus || "needs_attention";
  const currentLabel =
    CANONICAL_STATUS_OPTIONS.find((o) => o.value === currentStatus)?.label ||
    "Needs attention";
  const statusStylesByStatus = {
    needs_attention: "bg-blue-50 text-blue-700 border-blue-200",
    waiting_customer: "bg-violet-50 text-violet-700 border-violet-200",
    waiting_third_party: "bg-amber-50 text-amber-700 border-amber-200",
    resolved: "bg-green-50 text-green-700 border-green-200",
  };
  const statusStyles = statusStylesByStatus[currentStatus] || statusStylesByStatus.needs_attention;
  return (
    <div className="flex items-center gap-2">
      <Select
        value={currentStatus}
        onValueChange={(value) => onTicketStateChange({ status: value })}
      >
        <SelectTrigger
          aria-label="Ticket status"
          className={`h-auto w-auto cursor-pointer gap-1.5 rounded-md border px-3 py-1 text-xs font-medium ${statusStyles}`}
        >
          {currentStatus === "resolved" ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle className="h-3.5 w-3.5" />
          )}
          <SelectValue placeholder={currentLabel} />
        </SelectTrigger>
        <SelectContent>
          {CANONICAL_STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
```

(Keep the assignee `<Select>` and the rest of the component below unchanged. `SelectValue` will render `currentLabel` via the selected item; the `placeholder` is a fallback.)

- [ ] **Step 4: Compute + pass `canonicalStatus` at the render site**

At the `InboxHeaderActions` render site (~line 3768), compute the display value from the optimistic override when present, else the thread. Just above the return/JSX where `selectedTicketState` and `selectedThread` are in scope, add:

```jsx
  const selectedCanonicalStatus = selectedTicketState?.status
    ? canonicalStatusOption({
        status: selectedTicketState.status,
        waiting_reason: selectedThread?.waiting_reason,
      })
    : canonicalStatusOption(selectedThread || {});
```

and pass `canonicalStatus={selectedCanonicalStatus}` to `<InboxHeaderActions … />`.

Rationale: after Task 5, `selectedTicketState.status` is `null` unless the user explicitly set a status this session (canonical), so the `? :` picks the optimistic canonical override when present and otherwise derives from the thread's real `status` + `waiting_reason`.

- [ ] **Step 5: Fix the `"Solved"` advance check**

In `apps/web/lib/inbox/useThreadActions.js` `handleTicketStateChange` (line ~541), the block keyed on `if (updates.status === "Solved")` (solution-summary + advance-to-next) will no longer fire, because the dropdown now sends `"resolved"`. Change the guard to fire on the canonical resolved value (and keep back-compat with any legacy caller):

```js
      if (updates.status === "resolved" || updates.status === "Solved") {
```

Also update the other in-file caller at InboxSplitView ~line 3366 `handleTicketStateChange({ status: "Solved" })` to `{ status: "resolved" }`.

- [ ] **Step 6: Build + full suite**

Run: `npm --workspace apps/web test && cd apps/web && npx next build`
Expected: PASS + "✓ Compiled successfully".

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/inbox/InboxSplitView.jsx apps/web/lib/inbox/useThreadActions.js
git commit -m "feat(web): canonical status dropdown in ticket header"
```

---

## Task 7: Feature-2 deploy + manual verification

**Files:** none (ops). Feature 2 is frontend-only (no migration).

- [ ] **Step 1: Push + deploy**

```bash
git push origin main
```
Droplet: `cd ~/INNO && git pull && cd apps/web && npm run build && pm2 restart sona-web`, then hard-refresh.

- [ ] **Step 2: Manual verification**

1. Open a `needs_attention` ticket → header shows "Needs attention".
2. Pick "Waiting on third party" → row leaves the Inbox; reopen it → header still shows "Waiting on third party" (NOT "Waiting on customer"); sidebar shows it under Waiting on third party.
3. Pick "Resolved" → selection advances to the next ticket; the resolved thread appears under Resolved.
4. Confirm the DB via `execute_sql`: the chosen thread's `status`/`waiting_reason` match the picked option.

---

## Self-Review

**1. Spec coverage:**
- Feature 1 column + tick step 4 with null-workspace coalesce → Task 1. Settings API → Task 2. Settings UI → Task 3. Deploy → Task 4. ✓
- Feature 2 canonical options + accurate `waiting_third_party` display from thread `status`+`waiting_reason` → Tasks 5–6. Legacy transition removal → Task 5. `"Solved"`→`"resolved"` ripple → Task 6 Step 5. Deploy/verify → Task 7. ✓
- Deploy ordering (migration first, SQL-only, no code dependency) → Task 1 Step 2 + Task 4 Step 1. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Task 3 references "the section that consumes /api/settings/test-mode" — this is a locate-step, not a placeholder, because the exact widget names live in a 1400-line file and must be matched to local conventions; the field, payload key, and control markup are all concrete.

**3. Type consistency:** `needs_attention_stale_days` (integer, 0–365, default 7) is spelled identically in the migration, `stale-days.js`, the route, and the UI. `canonicalStatusOption`/`CANONICAL_STATUS_OPTIONS` spelled identically in the helper, its test, and the header. Canonical status values match `LIFECYCLE_STATUSES` exactly.
