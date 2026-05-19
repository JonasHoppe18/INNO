# Design: Server-side scope resolution caching

**Date:** 2026-05-19  
**Status:** Approved  
**Goal:** Reduce server-side page load time by eliminating the sequential DB waterfall in `resolveAuthScope`

---

## Problem

Every server-rendered page calls `resolveAuthScope` before it can fetch page data. The current implementation runs up to 3 sequential Supabase queries:

1. `profiles` — map Clerk user ID → Supabase user ID  
2. `workspaces` — map Clerk org ID → workspace ID (if orgId present)  
3. `workspace_members` — fallback workspace lookup (if no orgId)

These run sequentially, adding ~150–300ms of latency *before* any real data fetch begins. Because all dashboard pages call this independently, each navigation incurs the full cost.

Additionally, the dashboard page runs `resolveShopId` and `loadMailboxIds` sequentially after scope resolution, even though they are independent of each other.

---

## Solution

### Change 1: Parallelize internal queries in `resolveAuthScope`

The `profiles` lookup and the `workspaces` lookup (when `orgId` is present) are independent. Run them with `Promise.all` instead of sequentially.

```js
// Before
const profile = await serviceClient.from("profiles")...
const workspace = await serviceClient.from("workspaces")...

// After
const [profile, workspace] = await Promise.all([
  serviceClient.from("profiles")...,
  serviceClient.from("workspaces")...,
])
```

When `orgId` is absent, we skip the `workspaces` query entirely (unchanged behavior) and fall through to `workspace_members`.

### Change 2: Export a cached variant using React `cache()`

Add a new export `resolveAuthScopeCached` to `workspace-auth.js`:

```js
import { cache } from "react";

export const resolveAuthScopeCached = cache(resolveAuthScope);
```

React `cache()` is request-scoped — it memoizes the result for the duration of a single server render pass. If multiple components or functions in the same request call `resolveAuthScopeCached` with the same arguments, only the first call hits the DB. No cross-request state leaks.

The original `resolveAuthScope` export is preserved so no existing code breaks.

### Change 3: Parallelize `shopId` and `mailboxIds` on the dashboard page

In `dashboard/page.jsx`, `resolveShopId` and `loadMailboxIds` are currently called sequentially after scope resolution. They are independent and can run in parallel:

```js
// Before
const shopId = await resolveShopId(serviceClient, scope)
const mailboxIds = await loadMailboxIds(serviceClient, scope)

// After
const [shopId, mailboxIds] = await Promise.all([
  resolveShopId(serviceClient, scope),
  loadMailboxIds(serviceClient, scope),
])
```

---

## Files changed

| File | Change |
|------|--------|
| `apps/web/lib/server/workspace-auth.js` | Add internal `Promise.all`, export `resolveAuthScopeCached` |
| `apps/web/app/(dashboard)/dashboard/page.jsx` | Use cached variant, parallelize shopId + mailboxIds |
| `apps/web/app/(dashboard)/inbox/page.jsx` | Use cached variant |
| Other server pages calling `resolveAuthScope` directly | Switch to cached variant (identified by grep) |

---

## What we do not change

- Client components (`InboxSplitView`, hooks, etc.)
- API routes that are already fast
- Database schema, RLS policies, Supabase Edge Functions
- The existing `resolveAuthScope` export (backwards compatible)

---

## Risk

**Low.** React `cache()` is a first-party Next.js/React primitive designed exactly for this use case. It is request-scoped, so there is no risk of stale data across requests or between users. The internal `Promise.all` is safe because `profiles` and `workspaces` queries are truly independent.

---

## Expected outcome

- 40–60ms reduction per page navigation (varies with Supabase region latency)
- All server-rendered pages benefit: dashboard, inbox, settings, analytics, etc.
- No client-side changes required
