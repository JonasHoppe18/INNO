# Server-side scope resolution caching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce server-side page load latency by parallelizing the DB calls inside `resolveAuthScope` and memoizing the result per-request with React `cache()`.

**Architecture:** Add a `resolveAuthScopeCached` export to `workspace-auth.js` that wraps the existing function in React `cache()`, and parallelize the internal `profiles`/`workspaces` queries. Update all server pages that call `resolveAuthScope` directly to use the cached variant. Also parallelize the sequential `resolveShopId` + `loadMailboxIds` calls on the dashboard page.

**Tech Stack:** Next.js 14 App Router, React `cache()`, Supabase service client, Clerk auth

---

## File map

| File | Change |
|------|--------|
| `apps/web/lib/server/workspace-auth.js` | Parallelize internals; export `resolveAuthScopeCached` |
| `apps/web/app/(dashboard)/dashboard/page.jsx` | Use cached variant; parallelize `resolveShopId` + `loadMailboxIds` |
| `apps/web/app/(dashboard)/mailboxes/page.jsx` | Use cached variant |
| `apps/web/lib/server/inbox-data.js` | Use cached variant |

---

## Task 1: Parallelize internals of `resolveAuthScope` and export cached variant

**File:** `apps/web/lib/server/workspace-auth.js`

**Context:** The function currently runs `profiles` and (if `orgId` present) `workspaces` sequentially. They are independent — parallelize them. Then export a React `cache()`-wrapped version as `resolveAuthScopeCached`.

- [ ] **Step 1: Open the file and read the current implementation**

  File: `apps/web/lib/server/workspace-auth.js` (full file, ~127 lines)

- [ ] **Step 2: Replace the body of `resolveAuthScope` to parallelize the two lookups**

  The key insight: when `orgId` is present, `profiles` and `workspaces` are independent — run both in one `Promise.all`. When `orgId` is absent, `profiles` and `workspace_members` are also independent (both use `clerkUserId`), so run them in parallel too.

  Replace the current `resolveAuthScope` function (lines 1–51) with:

  ```js
  export async function resolveAuthScope(
    serviceClient,
    { clerkUserId, orgId },
    { requireExplicitWorkspace = false } = {}
  ) {
    let supabaseUserId = null;
    let workspaceId = null;

    if (orgId) {
      // profiles and workspaces are independent — run in parallel
      const [profileResult, workspaceResult] = await Promise.all([
        serviceClient
          .from("profiles")
          .select("user_id")
          .eq("clerk_user_id", clerkUserId)
          .maybeSingle(),
        serviceClient
          .from("workspaces")
          .select("id")
          .eq("clerk_org_id", orgId)
          .maybeSingle(),
      ]);
      if (profileResult.error) throw new Error(profileResult.error.message);
      if (workspaceResult.error) throw new Error(workspaceResult.error.message);
      supabaseUserId = profileResult.data?.user_id ?? null;
      workspaceId = workspaceResult.data?.id ?? null;
    } else {
      // profiles and workspace_members are independent — run in parallel
      const membershipQuery = requireExplicitWorkspace
        ? serviceClient
            .from("workspace_members")
            .select("workspace_id")
            .eq("clerk_user_id", clerkUserId)
            .order("created_at", { ascending: false })
            .limit(2)
        : serviceClient
            .from("workspace_members")
            .select("workspace_id")
            .eq("clerk_user_id", clerkUserId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

      const [profileResult, membershipResult] = await Promise.all([
        serviceClient
          .from("profiles")
          .select("user_id")
          .eq("clerk_user_id", clerkUserId)
          .maybeSingle(),
        membershipQuery,
      ]);
      if (profileResult.error) throw new Error(profileResult.error.message);
      if (membershipResult.error) throw new Error(membershipResult.error.message);

      supabaseUserId = profileResult.data?.user_id ?? null;

      if (requireExplicitWorkspace) {
        const rows = Array.isArray(membershipResult.data) ? membershipResult.data : [];
        if (rows.length > 1) {
          throw new Error("Ambiguous workspace scope. Select a workspace explicitly.");
        }
        workspaceId = rows[0]?.workspace_id ?? null;
      } else {
        workspaceId = membershipResult.data?.workspace_id ?? null;
      }
    }

    return { supabaseUserId, workspaceId };
  }
  ```

- [ ] **Step 3: Add `resolveAuthScopeCached` export**

  At the top of the file, add `cache` to the React import (or add a new import line if React isn't imported yet):

  ```js
  import { cache } from "react";
  ```

  Then, immediately after the closing brace of `resolveAuthScope`, add:

  ```js
  export const resolveAuthScopeCached = cache(resolveAuthScope);
  ```

- [ ] **Step 4: Verify the file builds**

  ```bash
  cd apps/web && npm run build 2>&1 | head -40
  ```

  Expected: no errors related to `workspace-auth.js`. TypeScript/JS parse errors would show here.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/lib/server/workspace-auth.js
  git commit -m "perf: parallelize resolveAuthScope DB calls and export cached variant"
  ```

---

## Task 2: Update `dashboard/page.jsx`

**File:** `apps/web/app/(dashboard)/dashboard/page.jsx`

**Context:** This page calls `resolveAuthScope`, then sequentially calls `resolveShopId` and `loadMailboxIds`. Switch to the cached variant and parallelize the two independent data-fetches.

- [ ] **Step 1: Update the import line (line 25)**

  Find:
  ```js
  import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
  ```

  Replace with:
  ```js
  import { applyScope, resolveAuthScopeCached } from "@/lib/server/workspace-auth";
  ```

- [ ] **Step 2: Update the call site (line 301) and parallelize shopId + mailboxIds**

  Find (lines 301–303):
  ```js
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  const shopId = await resolveShopId(serviceClient, scope);
  const mailboxIds = await loadMailboxIds(serviceClient, scope);
  ```

  Replace with:
  ```js
  const scope = await resolveAuthScopeCached(serviceClient, { clerkUserId, orgId });
  const [shopId, mailboxIds] = await Promise.all([
    resolveShopId(serviceClient, scope),
    loadMailboxIds(serviceClient, scope),
  ]);
  ```

- [ ] **Step 3: Verify build**

  ```bash
  cd apps/web && npm run build 2>&1 | grep -E "error|Error" | head -20
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/app/\(dashboard\)/dashboard/page.jsx
  git commit -m "perf: use cached scope + parallelize shopId/mailboxIds on dashboard"
  ```

---

## Task 3: Update `mailboxes/page.jsx`

**File:** `apps/web/app/(dashboard)/mailboxes/page.jsx`

- [ ] **Step 1: Update the import (line 8)**

  Find:
  ```js
  import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
  ```

  Replace with:
  ```js
  import { applyScope, resolveAuthScopeCached } from "@/lib/server/workspace-auth";
  ```

- [ ] **Step 2: Update the call site (line 51)**

  Find:
  ```js
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  ```

  Replace with:
  ```js
  const scope = await resolveAuthScopeCached(serviceClient, { clerkUserId, orgId });
  ```

- [ ] **Step 3: Verify build**

  ```bash
  cd apps/web && npm run build 2>&1 | grep -E "error|Error" | head -20
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/app/\(dashboard\)/mailboxes/page.jsx
  git commit -m "perf: use cached scope on mailboxes page"
  ```

---

## Task 4: Update `inbox-data.js`

**File:** `apps/web/lib/server/inbox-data.js`

**Context:** `loadInboxData` is called from `inbox/page.jsx` (a server component). Switching it to the cached variant means the same request's scope lookup is deduplicated if anything else in the render tree also calls `resolveAuthScopeCached`.

- [ ] **Step 1: Update the import (line 2)**

  Find:
  ```js
  import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
  ```

  Replace with:
  ```js
  import { applyScope, resolveAuthScopeCached } from "@/lib/server/workspace-auth";
  ```

- [ ] **Step 2: Update the call site (line 213)**

  Find:
  ```js
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  ```

  Replace with:
  ```js
  const scope = await resolveAuthScopeCached(serviceClient, { clerkUserId, orgId });
  ```

- [ ] **Step 3: Verify build**

  ```bash
  cd apps/web && npm run build 2>&1 | grep -E "error|Error" | head -20
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/lib/server/inbox-data.js
  git commit -m "perf: use cached scope in loadInboxData"
  ```

---

## Task 5: Manual smoke test

No automated test runner is set up. Verify the changes work correctly by running the dev server and navigating between pages.

- [ ] **Step 1: Start the dev server**

  ```bash
  cd apps/web && npm run dev
  ```

- [ ] **Step 2: Open browser DevTools → Network tab. Filter by "Fetch/XHR"**

- [ ] **Step 3: Navigate to `/dashboard`**

  Expected: page loads and shows dashboard data. No 500 errors in the console. Check Network tab — no unexpected failed requests.

- [ ] **Step 4: Navigate to `/inbox`**

  Expected: thread list loads. Click a ticket — detail and draft load normally.

- [ ] **Step 5: Navigate to `/mailboxes`**

  Expected: connected mailboxes are listed correctly.

- [ ] **Step 6: Check server logs for errors**

  In the terminal running `npm run dev`, verify no stack traces appear when navigating between pages.

- [ ] **Step 7: Commit if all good (nothing to commit — all already committed)**

  If any issue found: debug against the specific page, check that `resolveAuthScopeCached` is correctly exported from `workspace-auth.js` and that the import name matches exactly.
