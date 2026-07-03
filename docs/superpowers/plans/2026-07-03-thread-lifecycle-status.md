# Thread Lifecycle Status Foundation — Implementation Plan (1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text Open/New/Pending/Waiting/Solved thread statuses with the four-value lifecycle model (`needs_attention`, `waiting_customer`, `waiting_third_party`, `resolved`) with automatic transitions, wake timers, configurable auto-close, and needs-attention sidebar counts — while keeping the existing UI fully working.

**Spec:** `docs/superpowers/specs/2026-07-03-inbox-status-redesign-design.md`

**Scope note:** This is plan 1 of 2. The UI workspace rebuild (sidebar restructure, status tabs, queue sorting, send→next, waiting groups) is a separate follow-up plan that builds on the APIs delivered here. This plan ends with the new model live under the *existing* UI.

**Architecture:** Status semantics live in two small pure modules — `apps/web/lib/inbox/status-model.js` (Node/browser: send-path transition + UI mapping) and `supabase/functions/_shared/thread-status/transitions.ts` (Deno: inbound transition, shared by postmark-inbound and any future poller). Wake/auto-close runs as a SQL function scheduled with pg_cron (no edge-function auth plumbing). Reason badges are *stored* (`attention_reason`) at transition time, not derived client-side.

**Tech Stack:** Next.js 14 API routes (JS), Supabase Postgres + pg_cron, Supabase Edge Functions (Deno/TS), Vitest (new, web unit tests), Deno test (existing pattern).

## Global Constraints

- Tenancy: scope by `workspace_id`, never assume `user_id` suffices (CLAUDE.md).
- Postmark is the ONLY active ingest path (all mail is forwarded to it; Gmail/Outlook pollers are legacy and unused). Inbound transition logic still lives only in `supabase/functions/_shared/thread-status/transitions.ts` so nothing can diverge later.
- `postmark-inbound` deploys with `--no-verify-jwt`; prod edge deploys need `--use-api`.
- Status writes are lowercase snake_case strings; `blocked` remains a valid out-of-band status (spam), excluded from all queues and counts.
- Notification-classified threads (`classification_key = 'notification'`) never count as needs-attention.
- All timestamps ISO-8601 UTC via `new Date().toISOString()` / `now()`.
- Deploy order matters: Task 3 (UI compat) must be deployed to Vercel BEFORE Task 4's migration is applied to prod (the migration rewrites live status values).
- Commit after every task; do not batch.

## Lifecycle reference (used by every task)

Canonical statuses: `needs_attention`, `waiting_customer`, `waiting_third_party`, `resolved` (+ out-of-band `blocked`).

Legacy value mapping (case-insensitive): `new` → `needs_attention` · `open` → `needs_attention` · `pending` → `waiting_customer` · `waiting` → `waiting_customer` · `solved` → `resolved` · `resolved` → `resolved` · `blocked` → `blocked` · unknown/empty → `needs_attention`.

`attention_reason` values (set at transition time, null when not in needs_attention): `new`, `customer_replied`, `wake_timer`, `approve_close`.

New `mail_threads` columns (Task 4): `waiting_reason` (`customer` | `third_party` | null), `wake_at` (timestamptz), `close_pending` (bool, approve-close queue marker), `attention_reason` (text), `status_changed_at` (timestamptz — auto-close silence is measured from this).

Workspace config (columns on `workspaces`): `auto_close_days` (int, default 4), `auto_close_mode` (`auto` | `approve`, default `approve`).

---

### Task 1: Vitest infrastructure

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/lib/inbox/__tests__/smoke.test.js` (deleted again in Task 2)

**Interfaces:**
- Produces: `npm test` (vitest run) working in `apps/web`. Later tasks add `*.test.js` files under `apps/web/lib/inbox/__tests__/`.

- [ ] **Step 1: Install vitest**

```bash
cd /Users/jonashoppe/Developer/INNO/apps/web && npm install --save-dev vitest
```

- [ ] **Step 2: Add test script**

In `apps/web/package.json` scripts block, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Write a smoke test**

`apps/web/lib/inbox/__tests__/smoke.test.js`:

```js
import { describe, it, expect } from "vitest";

describe("vitest infra", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run it**

Run: `cd apps/web && npm test`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json apps/web/lib/inbox/__tests__/smoke.test.js
git commit -m "chore(web): add vitest for unit tests"
```

---

### Task 2: Canonical status module (web)

**Files:**
- Create: `apps/web/lib/inbox/status-model.js`
- Create: `apps/web/lib/inbox/__tests__/status-model.test.js`
- Delete: `apps/web/lib/inbox/__tests__/smoke.test.js`

**Interfaces:**
- Produces (consumed by Tasks 3, 6, 7, 8):
  - `LIFECYCLE_STATUSES: string[]`
  - `normalizeLifecycleStatus(raw: string|null): string` — any legacy/lifecycle value → canonical lifecycle value (or `"blocked"`)
  - `toLegacyUiStatus(raw: string|null): string|null` — any value → existing UI label (`"Open" | "Waiting" | "Solved" | "New" | "Pending"`), null for empty input
  - `buildAgentReplyStatusPatch(thread: {waiting_reason?: string|null}, nowIso: string): object` — DB patch applied when an agent sends a reply

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/inbox/__tests__/status-model.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  LIFECYCLE_STATUSES,
  normalizeLifecycleStatus,
  toLegacyUiStatus,
  buildAgentReplyStatusPatch,
} from "../status-model.js";

describe("normalizeLifecycleStatus", () => {
  it("passes canonical values through", () => {
    for (const s of LIFECYCLE_STATUSES) {
      expect(normalizeLifecycleStatus(s)).toBe(s);
    }
  });
  it("maps every legacy value", () => {
    expect(normalizeLifecycleStatus("new")).toBe("needs_attention");
    expect(normalizeLifecycleStatus("open")).toBe("needs_attention");
    expect(normalizeLifecycleStatus("Open")).toBe("needs_attention");
    expect(normalizeLifecycleStatus("pending")).toBe("waiting_customer");
    expect(normalizeLifecycleStatus("waiting")).toBe("waiting_customer");
    expect(normalizeLifecycleStatus("solved")).toBe("resolved");
    expect(normalizeLifecycleStatus("Resolved")).toBe("resolved");
  });
  it("keeps blocked out-of-band", () => {
    expect(normalizeLifecycleStatus("blocked")).toBe("blocked");
  });
  it("defaults unknown and empty to needs_attention", () => {
    expect(normalizeLifecycleStatus("")).toBe("needs_attention");
    expect(normalizeLifecycleStatus(null)).toBe("needs_attention");
    expect(normalizeLifecycleStatus("garbage")).toBe("needs_attention");
  });
});

describe("toLegacyUiStatus", () => {
  it("maps lifecycle values to existing UI labels", () => {
    expect(toLegacyUiStatus("needs_attention")).toBe("Open");
    expect(toLegacyUiStatus("waiting_customer")).toBe("Waiting");
    expect(toLegacyUiStatus("waiting_third_party")).toBe("Waiting");
    expect(toLegacyUiStatus("resolved")).toBe("Solved");
  });
  it("keeps legacy values rendering as today", () => {
    expect(toLegacyUiStatus("new")).toBe("New");
    expect(toLegacyUiStatus("open")).toBe("Open");
    expect(toLegacyUiStatus("pending")).toBe("Pending");
    expect(toLegacyUiStatus("waiting")).toBe("Waiting");
    expect(toLegacyUiStatus("solved")).toBe("Solved");
    expect(toLegacyUiStatus("resolved")).toBe("Solved");
  });
  it("returns null for empty input (existing behavior)", () => {
    expect(toLegacyUiStatus("")).toBe(null);
    expect(toLegacyUiStatus(null)).toBe(null);
  });
});

describe("buildAgentReplyStatusPatch", () => {
  const now = "2026-07-03T12:00:00.000Z";
  it("moves to waiting_customer by default", () => {
    expect(buildAgentReplyStatusPatch({ waiting_reason: null }, now)).toEqual({
      status: "waiting_customer",
      waiting_reason: "customer",
      close_pending: false,
      attention_reason: null,
      status_changed_at: now,
    });
  });
  it("returns to waiting_third_party when a third-party wait is active", () => {
    expect(
      buildAgentReplyStatusPatch({ waiting_reason: "third_party" }, now).status
    ).toBe("waiting_third_party");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npm test`
Expected: FAIL — `Cannot find module '../status-model.js'`

- [ ] **Step 3: Implement the module**

`apps/web/lib/inbox/status-model.js`:

```js
// Canonical thread lifecycle model. Keep in sync with
// supabase/functions/_shared/thread-status/transitions.ts (Deno side).
export const LIFECYCLE_STATUSES = [
  "needs_attention",
  "waiting_customer",
  "waiting_third_party",
  "resolved",
];

const LEGACY_TO_LIFECYCLE = {
  new: "needs_attention",
  open: "needs_attention",
  pending: "waiting_customer",
  waiting: "waiting_customer",
  solved: "resolved",
  resolved: "resolved",
};

export function normalizeLifecycleStatus(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "needs_attention";
  if (LIFECYCLE_STATUSES.includes(value)) return value;
  if (value === "blocked") return "blocked";
  return LEGACY_TO_LIFECYCLE[value] || "needs_attention";
}

const LIFECYCLE_TO_UI_LABEL = {
  needs_attention: "Open",
  waiting_customer: "Waiting",
  waiting_third_party: "Waiting",
  resolved: "Solved",
};

const LEGACY_TO_UI_LABEL = {
  new: "New",
  open: "Open",
  pending: "Pending",
  waiting: "Waiting",
  solved: "Solved",
  resolved: "Solved",
};

export function toLegacyUiStatus(raw) {
  if (!raw) return null;
  const value = String(raw).trim().toLowerCase();
  return LIFECYCLE_TO_UI_LABEL[value] || LEGACY_TO_UI_LABEL[value] || raw;
}

export function buildAgentReplyStatusPatch(thread, nowIso) {
  const waitingReason =
    String(thread?.waiting_reason || "").trim() === "third_party"
      ? "third_party"
      : "customer";
  return {
    status:
      waitingReason === "third_party" ? "waiting_third_party" : "waiting_customer",
    waiting_reason: waitingReason,
    close_pending: false,
    attention_reason: null,
    status_changed_at: nowIso,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test`
Expected: all PASS

- [ ] **Step 5: Delete the smoke test and commit**

```bash
rm apps/web/lib/inbox/__tests__/smoke.test.js
git add -A apps/web/lib/inbox
git commit -m "feat(web): canonical thread lifecycle status model"
```

---

### Task 3: Legacy UI compatibility (deploy before migration)

Make the existing UI render the new lifecycle values so live data can be migrated without a broken UI window.

**Files:**
- Modify: `apps/web/components/inbox/InboxSplitView.jsx:169-177` (the inline `normalizeStatus` arrow function)
- Test: covered by Task 2's `toLegacyUiStatus` tests (the component delegates)

**Interfaces:**
- Consumes: `toLegacyUiStatus` from `apps/web/lib/inbox/status-model.js`

- [ ] **Step 1: Replace the inline normalizer**

In `InboxSplitView.jsx`, add to the imports near the top of the file:

```js
import { toLegacyUiStatus } from "@/lib/inbox/status-model";
```

Replace the existing `normalizeStatus` definition (currently at lines 169-177):

```js
const normalizeStatus = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "solved" || normalized === "resolved") return "Solved";
  if (normalized === "pending") return "Pending";
  if (normalized === "waiting") return "Waiting";
  if (normalized === "open") return "Open";
  if (normalized === "new") return "New";
  return value;
};
```

with:

```js
const normalizeStatus = (value) => toLegacyUiStatus(value);
```

- [ ] **Step 2: Verify no other raw-status comparisons break**

Run: `grep -n '"open"\|"new"\|"pending"\|"solved"\|"resolved"\|"waiting"' apps/web/components/inbox/InboxSplitView.jsx`
Expected: any hits go through `normalizeStatus`/`effectiveStatus` (UI labels like `"Solved"` are fine). If a hit compares raw `thread.status` directly against a legacy value, wrap it in `normalizeStatus(...)` and compare against the UI label.

- [ ] **Step 3: Run tests + manual smoke**

Run: `cd apps/web && npm test` — Expected: PASS
Run: `cd apps/web && npm run dev` — open `/inbox`, confirm ticket list renders with status labels as before.

- [ ] **Step 4: Commit and deploy web**

```bash
git add apps/web/components/inbox/InboxSplitView.jsx
git commit -m "feat(web): render lifecycle statuses through toLegacyUiStatus (rollout compat)"
```

Deploy `apps/web` to production (Vercel) before running Task 4's migration.

---

### Task 4: Schema migration — lifecycle columns, workspace config, value backfill

**Files:**
- Create: `supabase/migrations/20260703100000_thread_lifecycle_status.sql`

**Interfaces:**
- Produces (consumed by Tasks 5-9): `mail_threads.waiting_reason`, `wake_at`, `close_pending`, `attention_reason`, `status_changed_at`; `workspaces.auto_close_days`, `auto_close_mode`; canonical status values in `mail_threads.status`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260703100000_thread_lifecycle_status.sql`:

```sql
-- Lifecycle columns on mail_threads
alter table public.mail_threads
  add column if not exists waiting_reason text
    check (waiting_reason in ('customer', 'third_party')),
  add column if not exists wake_at timestamptz,
  add column if not exists close_pending boolean not null default false,
  add column if not exists attention_reason text
    check (attention_reason in ('new', 'customer_replied', 'wake_timer', 'approve_close')),
  add column if not exists status_changed_at timestamptz not null default now();

-- Workspace auto-close configuration
alter table public.workspaces
  add column if not exists auto_close_days integer not null default 4,
  add column if not exists auto_close_mode text not null default 'approve'
    check (auto_close_mode in ('auto', 'approve'));

-- Backfill: normalize legacy status values (case-insensitive)
update public.mail_threads set
  status = case lower(coalesce(status, ''))
    when 'new' then 'needs_attention'
    when 'open' then 'needs_attention'
    when 'pending' then 'waiting_customer'
    when 'waiting' then 'waiting_customer'
    when 'solved' then 'resolved'
    when 'resolved' then 'resolved'
    when 'blocked' then 'blocked'
    when 'needs_attention' then 'needs_attention'
    when 'waiting_customer' then 'waiting_customer'
    when 'waiting_third_party' then 'waiting_third_party'
    else 'needs_attention'
  end,
  waiting_reason = case lower(coalesce(status, ''))
    when 'pending' then 'customer'
    when 'waiting' then 'customer'
    else waiting_reason
  end,
  attention_reason = case lower(coalesce(status, ''))
    when 'new' then 'new'
    when 'open' then 'customer_replied'
    else attention_reason
  end;

-- Queue count performance: partial index on the hot query
create index if not exists mail_threads_needs_attention_idx
  on public.mail_threads (workspace_id, mailbox_id)
  where status = 'needs_attention' or close_pending = true;

create index if not exists mail_threads_wake_at_idx
  on public.mail_threads (wake_at)
  where wake_at is not null;
```

- [ ] **Step 2: Apply the migration**

Run: `cd /Users/jonashoppe/Developer/INNO && supabase db push`
(If db push is unavailable in this environment, apply via the Supabase MCP `apply_migration` tool with the file's SQL — the established pattern from the evidence-columns migration.)
Expected: success, no errors.

- [ ] **Step 3: Verify the backfill**

Run this SQL (Supabase MCP `execute_sql` or dashboard):

```sql
select status, count(*) from public.mail_threads group by status order by 2 desc;
```

Expected: only `needs_attention`, `waiting_customer`, `waiting_third_party`, `resolved`, `blocked` appear.

- [ ] **Step 4: Verify the UI still renders (compat from Task 3)**

Open the production inbox; statuses render as Open/Waiting/Solved.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260703100000_thread_lifecycle_status.sql
git commit -m "feat(db): thread lifecycle columns, workspace auto-close config, status backfill"
```

---

### Task 5: Deno shared inbound-transition module

**Files:**
- Create: `supabase/functions/_shared/thread-status/transitions.ts`
- Create: `supabase/functions/_shared/thread-status/transitions.test.ts`

**Interfaces:**
- Produces (consumed by Task 6 and any future poller):
  - `statusOnInboundCustomerMessage(input: InboundInput, nowIso: string): ThreadStatusPatch`
  - Types `InboundInput { currentStatus: string | null; waitingReason: string | null; isBlockedSender: boolean; isNewThread: boolean }` and `ThreadStatusPatch { status: string; waiting_reason: string | null; close_pending: boolean; attention_reason: string | null; status_changed_at: string }`

- [ ] **Step 1: Write the failing tests**

`supabase/functions/_shared/thread-status/transitions.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { statusOnInboundCustomerMessage } from "./transitions.ts";

const NOW = "2026-07-03T12:00:00.000Z";

Deno.test("new thread -> needs_attention with reason new", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: null, waitingReason: null, isBlockedSender: false, isNewThread: true },
    NOW,
  );
  assertEquals(patch, {
    status: "needs_attention",
    waiting_reason: null,
    close_pending: false,
    attention_reason: "new",
    status_changed_at: NOW,
  });
});

Deno.test("blocked sender -> blocked regardless of state", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: "waiting_customer", waitingReason: "customer", isBlockedSender: true, isNewThread: false },
    NOW,
  );
  assertEquals(patch.status, "blocked");
});

Deno.test("customer reply on waiting_customer -> needs_attention, wait cleared", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: "waiting_customer", waitingReason: "customer", isBlockedSender: false, isNewThread: false },
    NOW,
  );
  assertEquals(patch.status, "needs_attention");
  assertEquals(patch.attention_reason, "customer_replied");
  assertEquals(patch.waiting_reason, null);
  assertEquals(patch.close_pending, false);
});

Deno.test("customer reply on waiting_third_party -> needs_attention, third-party marker persists", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: "waiting_third_party", waitingReason: "third_party", isBlockedSender: false, isNewThread: false },
    NOW,
  );
  assertEquals(patch.status, "needs_attention");
  assertEquals(patch.waiting_reason, "third_party");
});

Deno.test("customer reply on resolved -> reopen to needs_attention", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: "resolved", waitingReason: null, isBlockedSender: false, isNewThread: false },
    NOW,
  );
  assertEquals(patch.status, "needs_attention");
  assertEquals(patch.attention_reason, "customer_replied");
});

Deno.test("customer reply cancels a pending approve-close", () => {
  const patch = statusOnInboundCustomerMessage(
    { currentStatus: "waiting_customer", waitingReason: "customer", isBlockedSender: false, isNewThread: false },
    NOW,
  );
  assertEquals(patch.close_pending, false);
});

Deno.test("legacy current status values are tolerated", () => {
  for (const legacy of ["open", "new", "pending", "waiting", "solved", "Resolved"]) {
    const patch = statusOnInboundCustomerMessage(
      { currentStatus: legacy, waitingReason: null, isBlockedSender: false, isNewThread: false },
      NOW,
    );
    assertEquals(patch.status, "needs_attention");
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd supabase && deno test functions/_shared/thread-status/transitions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`supabase/functions/_shared/thread-status/transitions.ts`:

```ts
// Canonical inbound transition. Keep in sync with
// apps/web/lib/inbox/status-model.js (Node side handles the outbound/agent-reply patch).
export interface InboundInput {
  currentStatus: string | null;
  waitingReason: string | null;
  isBlockedSender: boolean;
  isNewThread: boolean;
}

export interface ThreadStatusPatch {
  status: string;
  waiting_reason: string | null;
  close_pending: boolean;
  attention_reason: string | null;
  status_changed_at: string;
}

export function statusOnInboundCustomerMessage(
  input: InboundInput,
  nowIso: string,
): ThreadStatusPatch {
  if (input.isBlockedSender) {
    return {
      status: "blocked",
      waiting_reason: null,
      close_pending: false,
      attention_reason: null,
      status_changed_at: nowIso,
    };
  }
  const keepsThirdPartyWait =
    String(input.waitingReason || "").trim() === "third_party";
  return {
    status: "needs_attention",
    waiting_reason: keepsThirdPartyWait ? "third_party" : null,
    close_pending: false,
    attention_reason: input.isNewThread ? "new" : "customer_replied",
    status_changed_at: nowIso,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd supabase && deno test functions/_shared/thread-status/transitions.test.ts`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/thread-status/
git commit -m "feat(functions): shared inbound lifecycle transition module"
```

---

### Task 6: Wire postmark-inbound to the transition module

**Files:**
- Modify: `supabase/functions/postmark-inbound/index.ts:1833` (new-thread insert) and `:1953-1959` (existing-thread update payload)

**Interfaces:**
- Consumes: `statusOnInboundCustomerMessage` from `../_shared/thread-status/transitions.ts`

- [ ] **Step 1: Import the module**

At the top of `supabase/functions/postmark-inbound/index.ts`, alongside the other `_shared` imports:

```ts
import { statusOnInboundCustomerMessage } from "../_shared/thread-status/transitions.ts";
```

- [ ] **Step 2: New-thread insert**

In the thread-insert payload (line ~1833), replace:

```ts
status: isBlockedSender ? "blocked" : "new",
```

with:

```ts
...statusOnInboundCustomerMessage(
  { currentStatus: null, waitingReason: null, isBlockedSender, isNewThread: true },
  new Date().toISOString(),
),
```

- [ ] **Step 3: Existing-thread update**

The existing-thread read (line ~1925) must also select the wait state — extend the select:

```ts
.select("subject, unread_count, tags, classification_key, classification_confidence, classification_reason, customer_name, customer_email, status, waiting_reason")
```

Replace the status block (currently lines ~1953-1959):

```ts
if (isBlockedSender) {
  updatePayload.status = "blocked";
} else if (!createdNewThread) {
  // Re-open existing threads when a new inbound customer message arrives.
  updatePayload.status = "open";
}
```

with:

```ts
if (!createdNewThread) {
  Object.assign(
    updatePayload,
    statusOnInboundCustomerMessage(
      {
        currentStatus: (existingThread as any)?.status ?? null,
        waitingReason: (existingThread as any)?.waiting_reason ?? null,
        isBlockedSender,
        isNewThread: false,
      },
      new Date().toISOString(),
    ),
  );
} else if (isBlockedSender) {
  updatePayload.status = "blocked";
}
```

- [ ] **Step 4: Type-check and run all function tests**

Run: `cd supabase && deno check functions/postmark-inbound/index.ts && deno test functions/_shared/thread-status/`
Expected: check passes, tests pass

- [ ] **Step 5: Deploy and verify**

```bash
cd /Users/jonashoppe/Developer/INNO && supabase functions deploy postmark-inbound --no-verify-jwt --use-api
```

Send a test email to the test inbox; verify in SQL that the thread lands with `status = 'needs_attention'`, `attention_reason = 'new'`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/postmark-inbound/index.ts
git commit -m "feat(postmark-inbound): lifecycle transitions on inbound customer messages"
```

---

### Task 7: Agent reply sets waiting status (send route)

**Files:**
- Modify: `apps/web/app/api/threads/[threadId]/send/route.js:1771-1783` (the `mail_threads` update after successful send) and the thread select feeding it (`grep -n 'from("mail_threads")' apps/web/app/api/threads/\[threadId\]/send/route.js` → first hit ~line 354; add `waiting_reason` and `status` to that select if absent)

**Interfaces:**
- Consumes: `buildAgentReplyStatusPatch` from `@/lib/inbox/status-model`

- [ ] **Step 1: Import**

```js
import { buildAgentReplyStatusPatch } from "@/lib/inbox/status-model";
```

- [ ] **Step 2: Extend the thread select**

Ensure the thread row loaded early in the POST handler includes `status, waiting_reason` (add to the select string if missing).

- [ ] **Step 3: Apply the patch in the post-send thread update**

Replace:

```js
let updateThreadQuery = serviceClient
  .from("mail_threads")
  .update({
    snippet,
    subject: thread.subject ? thread.subject : subject,
    tags:
      isExchangeThread && !alreadyAwaitingReturn ? updatedTags : undefined,
    updated_at: nowIso,
  })
  .eq("id", threadId);
```

with:

```js
let updateThreadQuery = serviceClient
  .from("mail_threads")
  .update({
    snippet,
    subject: thread.subject ? thread.subject : subject,
    tags:
      isExchangeThread && !alreadyAwaitingReturn ? updatedTags : undefined,
    ...buildAgentReplyStatusPatch(thread, nowIso),
    updated_at: nowIso,
  })
  .eq("id", threadId);
```

- [ ] **Step 4: Test**

Run: `cd apps/web && npm test` — Expected: PASS (patch shape covered by Task 2 tests).
Manual: send a reply from the dev UI on a `needs_attention` thread; verify SQL shows `status = 'waiting_customer'`, `status_changed_at` = send time. Repeat on a thread with `waiting_reason = 'third_party'`; verify it returns to `waiting_third_party`.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/api/threads/[threadId]/send/route.js"
git commit -m "feat(send): agent reply transitions thread to waiting status"
```

---

### Task 8: thread-status PATCH — validation, third-party handoff, wake dates

**Files:**
- Modify: `apps/web/app/api/inbox/thread-status/route.js:97-112`
- Create: `apps/web/lib/inbox/__tests__/status-patch.test.js`
- Create: `apps/web/lib/inbox/status-patch.js` (pure request→payload builder so it's unit-testable)

**Interfaces:**
- Produces: `buildManualStatusPatch(body, nowIso): { payload?: object, error?: string }` in `apps/web/lib/inbox/status-patch.js`. Accepted body fields: `status` (lifecycle or legacy value — normalized), `waitingReason` (`customer`|`third_party`), `wakeAt` (ISO string or null).
- Consumes: `normalizeLifecycleStatus` from `./status-model.js`.

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/inbox/__tests__/status-patch.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildManualStatusPatch } from "../status-patch.js";

const NOW = "2026-07-03T12:00:00.000Z";

describe("buildManualStatusPatch", () => {
  it("normalizes legacy status input", () => {
    const { payload } = buildManualStatusPatch({ status: "Solved" }, NOW);
    expect(payload.status).toBe("resolved");
    expect(payload.status_changed_at).toBe(NOW);
  });
  it("clears wait state when resolving", () => {
    const { payload } = buildManualStatusPatch({ status: "resolved" }, NOW);
    expect(payload.waiting_reason).toBe(null);
    expect(payload.wake_at).toBe(null);
    expect(payload.close_pending).toBe(false);
    expect(payload.attention_reason).toBe(null);
  });
  it("sets third-party wait with wake date", () => {
    const { payload } = buildManualStatusPatch(
      { status: "waiting_third_party", waitingReason: "third_party", wakeAt: "2026-07-08T00:00:00.000Z" },
      NOW
    );
    expect(payload.status).toBe("waiting_third_party");
    expect(payload.waiting_reason).toBe("third_party");
    expect(payload.wake_at).toBe("2026-07-08T00:00:00.000Z");
  });
  it("defaults waiting_reason from the status", () => {
    const { payload } = buildManualStatusPatch({ status: "waiting_customer" }, NOW);
    expect(payload.waiting_reason).toBe("customer");
  });
  it("rejects an invalid wakeAt", () => {
    const { error } = buildManualStatusPatch(
      { status: "waiting_third_party", wakeAt: "not-a-date" },
      NOW
    );
    expect(error).toBeTruthy();
  });
  it("passes through no-status bodies untouched", () => {
    const { payload } = buildManualStatusPatch({}, NOW);
    expect(payload).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && npm test` — Expected: FAIL, module missing

- [ ] **Step 3: Implement**

`apps/web/lib/inbox/status-patch.js`:

```js
import { normalizeLifecycleStatus } from "./status-model.js";

export function buildManualStatusPatch(body, nowIso) {
  const payload = {};
  if (typeof body?.status !== "string" || !body.status.trim()) {
    return { payload };
  }
  const status = normalizeLifecycleStatus(body.status);
  payload.status = status;
  payload.status_changed_at = nowIso;

  if (status === "waiting_customer" || status === "waiting_third_party") {
    const requested = String(body?.waitingReason || "").trim();
    payload.waiting_reason =
      requested === "third_party" || status === "waiting_third_party"
        ? "third_party"
        : "customer";
    if (body?.wakeAt !== undefined && body?.wakeAt !== null) {
      const parsed = Date.parse(String(body.wakeAt));
      if (Number.isNaN(parsed)) {
        return { error: "Invalid wakeAt timestamp." };
      }
      payload.wake_at = new Date(parsed).toISOString();
    } else {
      payload.wake_at = null;
    }
    payload.close_pending = false;
    payload.attention_reason = null;
  } else {
    payload.waiting_reason = null;
    payload.wake_at = null;
    payload.close_pending = false;
    payload.attention_reason = null;
  }
  return { payload };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test` — Expected: PASS

- [ ] **Step 5: Wire into the route**

In `apps/web/app/api/inbox/thread-status/route.js`, add the import:

```js
import { buildManualStatusPatch } from "@/lib/inbox/status-patch";
```

Replace lines 97-100:

```js
const payload = {};
if (typeof body?.status === "string") {
  payload.status = body.status.trim().toLowerCase();
}
```

with:

```js
const { payload, error: statusError } = buildManualStatusPatch(
  body,
  new Date().toISOString()
);
if (statusError) {
  return NextResponse.json({ error: statusError }, { status: 400 });
}
```

(The subsequent `priority` / `assigneeId` / `isRead` / `unreadCount` / `inboxSlug` / `classificationKey` blocks keep appending to the same `payload` object.)

- [ ] **Step 6: Manual verify + commit**

Manual: change status via the existing UI dropdown (sends e.g. `"Solved"`); verify the row gets `status = 'resolved'` and cleared wait fields.

```bash
git add apps/web/lib/inbox/status-patch.js apps/web/lib/inbox/__tests__/status-patch.test.js apps/web/app/api/inbox/thread-status/route.js
git commit -m "feat(api): validated lifecycle status PATCH with third-party handoff and wake dates"
```

---

### Task 9: Lifecycle tick — wake timers and auto-close (SQL + pg_cron)

**Files:**
- Create: `supabase/migrations/20260703110000_thread_lifecycle_tick.sql`
- Create: `supabase/scripts/test-lifecycle-tick.mjs`

**Interfaces:**
- Produces: `public.tick_thread_lifecycle()` (SQL function, idempotent), scheduled every 15 minutes as pg_cron job `thread-lifecycle-tick`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260703110000_thread_lifecycle_tick.sql`:

```sql
create extension if not exists pg_cron;

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
$$;

-- Re-schedule idempotently
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

- [ ] **Step 2: Write the verification script (runs against the linked project, cleans up after itself)**

`supabase/scripts/test-lifecycle-tick.mjs` — follows the env pattern of `supabase/scripts/run-golden-eval.mjs` (SUPABASE_URL + SERVICE_ROLE key from env):

```js
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}
const supabase = createClient(url, key);
const MARKER = `lifecycle-tick-test-${Date.now()}`;

async function main() {
  // mail_threads requires a real user_id + mailbox_id (FK to auth.users /
  // mail_accounts), so borrow an existing mailbox row for those fields.
  const { data: mailbox, error: mbErr } = await supabase
    .from("mail_accounts")
    .select("id, user_id")
    .limit(1)
    .single();
  if (mbErr) throw mbErr;

  // Seed: a throwaway workspace carries the auto-close config under test.
  const { data: ws, error: wsErr } = await supabase
    .from("workspaces")
    .insert({ name: MARKER, auto_close_days: 2, auto_close_mode: "approve" })
    .select("id")
    .single();
  if (wsErr) throw wsErr;

  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const base = {
    workspace_id: ws.id,
    user_id: mailbox.user_id,
    mailbox_id: mailbox.id,
    provider: "smtp",
    subject: MARKER,
  };
  const { data: threads, error: thErr } = await supabase
    .from("mail_threads")
    .insert([
      { ...base, status: "waiting_third_party", waiting_reason: "third_party", wake_at: daysAgo(1), status_changed_at: daysAgo(5) },
      { ...base, status: "waiting_customer", waiting_reason: "customer", status_changed_at: daysAgo(3) },
      { ...base, status: "waiting_customer", waiting_reason: "customer", status_changed_at: daysAgo(1) },
    ])
    .select("id");
  if (thErr) throw thErr;

  const { error: rpcErr } = await supabase.rpc("tick_thread_lifecycle");
  if (rpcErr) throw rpcErr;

  const { data: after } = await supabase
    .from("mail_threads")
    .select("id, status, attention_reason, close_pending, wake_at")
    .in("id", threads.map((t) => t.id))
    .order("created_at");

  const [woken, closeDue, notDue] = after;
  const checks = [
    ["wake-due thread woke", woken.status === "needs_attention" && woken.attention_reason === "wake_timer" && woken.wake_at === null],
    ["silent thread flagged for approve-close", closeDue.status === "waiting_customer" && closeDue.close_pending === true && closeDue.attention_reason === "approve_close"],
    ["fresh waiting thread untouched", notDue.status === "waiting_customer" && notDue.close_pending === false],
  ];
  let failed = false;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
    if (!ok) failed = true;
  }

  // Cleanup
  await supabase.from("mail_threads").delete().in("id", threads.map((t) => t.id));
  await supabase.from("workspaces").delete().eq("id", ws.id);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Note: if `workspaces` inserts require additional not-null columns beyond `name`, add them with dummy values in the same insert. Do not weaken the assertions.

- [ ] **Step 3: Apply the migration**

Run: `cd /Users/jonashoppe/Developer/INNO && supabase db push` (or MCP `apply_migration`).
Expected: success. If `create extension pg_cron` fails with a permissions error, enable pg_cron via the Supabase dashboard (Database → Extensions) and re-run.

- [ ] **Step 4: Run the verification script**

Run: `cd supabase && node scripts/test-lifecycle-tick.mjs`
Expected: three `PASS` lines, exit 0.

- [ ] **Step 5: Verify the cron job exists**

SQL: `select jobname, schedule from cron.job where jobname = 'thread-lifecycle-tick';`
Expected: one row, `*/15 * * * *`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260703110000_thread_lifecycle_tick.sql supabase/scripts/test-lifecycle-tick.mjs
git commit -m "feat(db): lifecycle tick — wake timers and configurable auto-close via pg_cron"
```

---

### Task 10: Needs-attention sidebar counts

**Files:**
- Modify: `apps/web/app/api/inbox/sidebar-counts/route.js`

**Interfaces:**
- Produces (consumed by the follow-up UI plan): response gains `needsAttentionCount`, `mineCount`, `waitingCustomerCount`, `waitingThirdPartyCount`, `inboxNeedsAttentionCounts` (slug → count). Existing keys `assignedCount`, `notificationsCount`, `customInboxUnreadCounts` remain unchanged for the current UI.

- [ ] **Step 1: Add the queue-count helpers**

In `sidebar-counts/route.js`, add below `loadAssignedCount`:

```js
function applyNeedsAttentionFilter(query) {
  return query
    .or("status.eq.needs_attention,close_pending.eq.true")
    .or("classification_key.is.null,classification_key.neq.notification");
}

async function loadNeedsAttentionCount(serviceClient, scope, mailboxIds) {
  const { count, error } = await applyScope(
    applyNeedsAttentionFilter(
      serviceClient
        .from("mail_threads")
        .select("id", { count: "exact", head: true })
        .in("mailbox_id", mailboxIds)
    ),
    scope
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function loadMineCount(serviceClient, scope, mailboxIds, supabaseUserId) {
  if (!supabaseUserId) return 0;
  const { count, error } = await applyScope(
    applyNeedsAttentionFilter(
      serviceClient
        .from("mail_threads")
        .select("id", { count: "exact", head: true })
        .in("mailbox_id", mailboxIds)
        .eq("assignee_id", supabaseUserId)
    ),
    scope
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function loadWaitingCounts(serviceClient, scope, mailboxIds) {
  const countFor = async (status) => {
    const { count, error } = await applyScope(
      serviceClient
        .from("mail_threads")
        .select("id", { count: "exact", head: true })
        .in("mailbox_id", mailboxIds)
        .eq("status", status)
        .or("classification_key.is.null,classification_key.neq.notification"),
      scope
    );
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const [waitingCustomerCount, waitingThirdPartyCount] = await Promise.all([
    countFor("waiting_customer"),
    countFor("waiting_third_party"),
  ]);
  return { waitingCustomerCount, waitingThirdPartyCount };
}

async function loadInboxNeedsAttentionCounts(serviceClient, scope, mailboxIds, inboxSlugs) {
  if (!mailboxIds.length || !inboxSlugs.length) return {};
  const inboxTags = inboxSlugs.map((slug) => `inbox:${slug}`);
  const { data, error } = await applyScope(
    applyNeedsAttentionFilter(
      serviceClient
        .from("mail_threads")
        .select("tags")
        .in("mailbox_id", mailboxIds)
        .overlaps("tags", inboxTags)
        .limit(1000)
    ),
    scope
  );
  if (error) throw new Error(error.message);
  const counts = {};
  for (const slug of inboxSlugs) counts[slug] = 0;
  for (const row of Array.isArray(data) ? data : []) {
    const slug = extractInboxSlugFromTags(row?.tags || []);
    if (counts.hasOwnProperty(slug)) counts[slug] += 1;
  }
  return counts;
}
```

- [ ] **Step 2: Extend the GET handler**

In `GET()`, extend the parallel load and the response:

```js
const [
  assignedCount,
  mailNotificationsCount,
  mentionNotificationsCount,
  customInboxUnreadCounts,
  needsAttentionCount,
  mineCount,
  waitingCounts,
  inboxNeedsAttentionCounts,
] = await Promise.all([
  mailboxIds.length
    ? loadAssignedCount(serviceClient, scope, mailboxIds, scope.supabaseUserId)
    : 0,
  loadNotificationsCount(serviceClient, scope, mailboxIds),
  loadMentionNotificationsCount(serviceClient, scope),
  loadCustomInboxUnreadCounts(serviceClient, scope, mailboxIds, inboxSlugs),
  mailboxIds.length ? loadNeedsAttentionCount(serviceClient, scope, mailboxIds) : 0,
  mailboxIds.length ? loadMineCount(serviceClient, scope, mailboxIds, scope.supabaseUserId) : 0,
  mailboxIds.length
    ? loadWaitingCounts(serviceClient, scope, mailboxIds)
    : { waitingCustomerCount: 0, waitingThirdPartyCount: 0 },
  loadInboxNeedsAttentionCounts(serviceClient, scope, mailboxIds, inboxSlugs),
]);
const notificationsCount = mailNotificationsCount + mentionNotificationsCount;

return NextResponse.json(
  {
    assignedCount,
    notificationsCount,
    customInboxUnreadCounts,
    needsAttentionCount,
    mineCount,
    ...waitingCounts,
    inboxNeedsAttentionCounts,
  },
  { status: 200 }
);
```

Also extend both fallback responses (the empty-scope return and the catch block) with the new keys set to `0` / `{}`.

- [ ] **Step 3: Verify PostgREST filter chaining**

Two chained `.or()` calls AND together in PostgREST — verify with a manual request:

Run: `curl -s "http://localhost:3000/api/inbox/sidebar-counts" -H "Cookie: <dev session>"` (or hit the endpoint from the running dev app and inspect the network tab).
Expected: JSON contains `needsAttentionCount` matching a hand-run SQL count:

```sql
select count(*) from mail_threads
where (status = 'needs_attention' or close_pending)
  and (classification_key is null or classification_key <> 'notification');
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/inbox/sidebar-counts/route.js
git commit -m "feat(api): needs-attention, mine, waiting and per-inbox queue counts"
```

---

### Task 11: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: All unit tests**

Run: `cd apps/web && npm test` — Expected: PASS
Run: `cd supabase && deno test functions/_shared/thread-status/` — Expected: PASS

- [ ] **Step 2: End-to-end lifecycle walk on the test workspace**

1. Send an inbound test email → thread is `needs_attention` / `attention_reason='new'` and appears in the UI as Open.
2. Reply from the UI → `waiting_customer`, disappears from unresolved-only views once the UI plan lands (for now: status shows Waiting).
3. Reply again as the customer → back to `needs_attention` / `customer_replied`.
4. Set `waiting_third_party` with a past `wake_at` via the PATCH; run `select tick_thread_lifecycle();` → thread wakes with `wake_timer`.
5. Backdate `status_changed_at` 10 days on a `waiting_customer` thread; run the tick → `close_pending = true` (approve mode default).

- [ ] **Step 3: Confirm counts**

`/api/inbox/sidebar-counts` returns consistent `needsAttentionCount` before/after each step above.

- [ ] **Step 4: Update CLAUDE.md "Seneste ændringer"**

Add one line describing the lifecycle status model. Commit:

```bash
git add CLAUDE.md
git commit -m "docs: note thread lifecycle status foundation"
```

---

## Follow-up plan (not in this document)

Plan 2 — "Queue workspace UI": sidebar restructure (QUEUE / INBOXES / AUTOMATED + Settings consolidation), status tabs on every list view, queue sorting by customer wait time, reason badges rendered from `attention_reason`, waiting view groups with wake info, approve-close group, send→next-ticket flow, channel icons. It consumes: the four lifecycle statuses, `attention_reason`, `close_pending`, the extended sidebar-counts payload, and the extended thread-status PATCH — all delivered here.
