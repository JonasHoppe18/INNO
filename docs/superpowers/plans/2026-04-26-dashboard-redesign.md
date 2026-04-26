# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the dashboard page to show a richer layout with "Needs your attention", a 2×2 stat grid, a Recent AI activity feed, and an improved Returns card.

**Architecture:** Single-file full rewrite of `apps/web/app/(dashboard)/dashboard/page.jsx`. All data fetching stays in the server component. Two new async fetch functions are added; existing fetches are preserved and extended. JSX is replaced top-to-bottom with the new layout.

**Tech Stack:** Next.js 14 App Router, React 18 (server component), Supabase JS client, Tailwind CSS, Radix/shadcn `Card`/`Badge`/`Button`, Lucide icons.

---

## File Map

| File | Action |
|------|--------|
| `apps/web/app/(dashboard)/dashboard/page.jsx` | Full rewrite — new data fetches + new JSX layout |

No new files. No other files touched.

---

### Task 1: Add `loadMissingTrackingCount` and `loadRecentActivity` fetch functions + wire into page data loading

**Files:**
- Modify: `apps/web/app/(dashboard)/dashboard/page.jsx`

- [ ] **Step 1: Add `actionLabel` helper and `loadMissingTrackingCount` function**

Add these two functions after `loadReturnsInTransit` in `page.jsx`:

```js
function actionLabel(actionType) {
  const labels = {
    initiate_return: "Return initiated",
    create_refund: "Refund draft generated",
    cancel_order: "Order cancellation approved",
    change_shipping_address: "Shipping address updated",
    send_message: "Message sent to customer",
  };
  return labels[actionType] ?? "Action executed";
}

async function loadMissingTrackingCount(serviceClient, shopId) {
  if (!shopId) return 0;
  const { count, error } = await serviceClient
    .from("thread_actions")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("action_type", "initiate_return")
    .eq("status", "applied")
    .is("payload->tracking_url", null);
  if (error) return 0;
  return count ?? 0;
}
```

- [ ] **Step 2: Add `loadRecentActivity` function**

Add after `loadMissingTrackingCount`:

```js
async function loadRecentActivity(serviceClient, scope, shopId) {
  const draftsPromise = applyScope(
    serviceClient
      .from("drafts")
      .select("id, created_at, customer_email, subject, status")
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(10),
    scope
  );

  const actionsPromise = shopId
    ? serviceClient
        .from("thread_actions")
        .select("id, action_type, payload, created_at, status")
        .eq("shop_id", shopId)
        .in("status", ["applied", "pending"])
        .order("created_at", { ascending: false })
        .limit(10)
    : Promise.resolve({ data: [] });

  const [draftsResult, actionsResult] = await Promise.all([draftsPromise, actionsPromise]);

  const draftEvents = (draftsResult.data ?? []).map((d) => ({
    id: `draft-${d.id}`,
    time: d.created_at,
    label: "Draft sent",
    detail: d.subject || d.customer_email || "—",
    badge: "sent",
  }));

  const actionEvents = (actionsResult.data ?? []).map((a) => ({
    id: `action-${a.id}`,
    time: a.created_at,
    label: actionLabel(a.action_type),
    detail: a.payload?.orderId ? `Order #${a.payload.orderId}` : null,
    badge: a.status === "applied" ? "approved" : "pending",
  }));

  return [...draftEvents, ...actionEvents]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 10);
}
```

- [ ] **Step 3: Add `formatTime` helper for HH:MM display**

Add after `formatTimeAgo`:

```js
function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
}
```

- [ ] **Step 4: Add new variables to the Page component and wire up fetches**

In the `Page` function, add new variables after the existing ones:

```js
let missingTrackingCount = 0;
let recentActivity = [];
```

Then extend the `Promise.all` call to include the two new fetches. Replace the existing `Promise.all`:

```js
const [
  draftResult,
  awaitingResult,
  pendingResult,
  exampleResult,
  returnsResult,
  missingTracking,
  activityResult,
] = await Promise.all([
  draftQuery,
  loadAwaitingThreads(serviceClient, scope, mailboxIds),
  loadPendingActions(serviceClient, shopId),
  exampleQuery,
  loadReturnsInTransit(serviceClient, shopId),
  loadMissingTrackingCount(serviceClient, shopId),
  loadRecentActivity(serviceClient, scope, shopId),
]);
```

And assign the new results after the existing assignments:

```js
missingTrackingCount = missingTracking;
recentActivity = activityResult;
```

- [ ] **Step 5: Verify the app builds without errors**

```bash
cd /Users/jonashoppe/Developer/INNO && npm run build 2>&1 | tail -20
```

Expected: build succeeds (or only pre-existing warnings, no new errors).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(dashboard\)/dashboard/page.jsx
git commit -m "feat: add loadMissingTrackingCount and loadRecentActivity to dashboard"
```

---

### Task 2: Rewrite the page JSX with the new layout

**Files:**
- Modify: `apps/web/app/(dashboard)/dashboard/page.jsx`

- [ ] **Step 1: Update imports at the top of the file**

Replace the existing import block with:

```js
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  Clock3Icon,
  FileTextIcon,
  InboxIcon,
  PackageMinusIcon,
} from "lucide-react";

import DashboardGreeting from "@/components/dashboard/DashboardGreeting";
import { LearningCard } from "@/components/agent/LearningCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
```

- [ ] **Step 2: Add badge/dot style maps above the Page function**

Add these constants just before `export default async function Page()`:

```js
const ACTIVITY_BADGE_CLASSES = {
  sent: "border-green-200 bg-green-50 text-green-700",
  approved: "border-blue-200 bg-blue-50 text-blue-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
};

const ACTIVITY_DOT_CLASSES = {
  sent: "bg-green-500",
  approved: "bg-blue-500",
  pending: "bg-amber-400",
};

const ACTIVITY_BADGE_LABEL = {
  sent: "Sent",
  approved: "Approved",
  pending: "Pending",
};
```

- [ ] **Step 3: Build the attentionItems array inside the Page function**

Add this after the `timeSavedLabel` derivation:

```js
const attentionItems = [
  pendingCount > 0 && {
    key: "pending",
    icon: <AlertCircleIcon className="size-4 shrink-0 text-amber-500" />,
    title: "Pending approvals",
    subtitle: "Actions waiting for your review",
    count: pendingCount,
    countColor: "text-amber-600",
  },
  awaitingCount > 0 && {
    key: "awaiting",
    icon: <InboxIcon className="size-4 shrink-0 text-red-500" />,
    title: "Customers waiting over 12h",
    subtitle: "No reply from your team",
    count: awaitingCount,
    countColor: "text-red-600",
  },
  missingTrackingCount > 0 && {
    key: "tracking",
    icon: <PackageMinusIcon className="size-4 shrink-0 text-blue-500" />,
    title: "Missing tracking link",
    subtitle: "Returns need tracking updates",
    count: missingTrackingCount,
    countColor: "text-blue-600",
  },
].filter(Boolean);

const totalAttention = attentionItems.reduce((sum, item) => sum + item.count, 0);
```

- [ ] **Step 4: Replace the entire return statement with the new layout**

Replace everything from `return (` to the closing `);` with:

```jsx
return (
  <div className="@container/main flex flex-1 flex-col gap-2">
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      {/* Greeting */}
      <div className="px-4 lg:px-6">
        <DashboardGreeting firstName={firstName} />
      </div>

      {/* Middle row: Needs your attention + 2×2 stat cards */}
      <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-2 lg:px-6">
        {/* Needs your attention */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Needs your attention</CardTitle>
              {totalAttention > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-xs font-semibold text-red-600">
                  {totalAttention}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="pb-2">
            {attentionItems.length === 0 ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <CheckCircle2Icon className="size-4 text-green-500" />
                Alt ser godt ud — ingen opgaver kræver din opmærksomhed.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {attentionItems.map((item) => (
                  <div key={item.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    {item.icon}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                    </div>
                    <span className={`shrink-0 text-sm font-semibold ${item.countColor}`}>
                      {item.count}
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          {attentionItems.length > 0 && (
            <CardFooter className="pt-2">
              <Button variant="outline" className="w-full" asChild>
                <Link href="/inbox">
                  Review tickets
                  <ChevronRightIcon className="ml-1 size-4" />
                </Link>
              </Button>
            </CardFooter>
          )}
        </Card>

        {/* 2×2 stat cards */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="@container/card">
            <CardHeader className="relative pb-2">
              <CardDescription>Awaiting Reply</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums">{awaitingCount}</CardTitle>
              <div className="absolute right-4 top-4">
                <Badge
                  variant="outline"
                  className={`flex gap-1 rounded-lg text-xs ${
                    awaitingCount > 0
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "text-muted-foreground"
                  }`}
                >
                  <InboxIcon className="size-3" />
                  {awaitingCount > 0 ? "Action needed" : "All clear"}
                </Badge>
              </div>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-0.5 text-sm">
              <div className="font-medium">Tickets without a reply</div>
              <div className="text-xs text-muted-foreground">Over 12 hours old</div>
            </CardFooter>
          </Card>

          <Card className="@container/card">
            <CardHeader className="relative pb-2">
              <CardDescription>Pending Approvals</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums">{pendingCount}</CardTitle>
              <div className="absolute right-4 top-4">
                <Badge
                  variant="outline"
                  className={`flex gap-1 rounded-lg text-xs ${
                    pendingCount > 0
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "text-muted-foreground"
                  }`}
                >
                  <AlertCircleIcon className="size-3" />
                  {pendingCount > 0 ? "Need review" : "All clear"}
                </Badge>
              </div>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-0.5 text-sm">
              <div className="font-medium">Actions waiting for you</div>
              <div className="text-xs text-muted-foreground">Require manual approval</div>
            </CardFooter>
          </Card>

          <Card className="@container/card">
            <CardHeader className="relative pb-2">
              <CardDescription>AI Drafts Sent</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums">{sentDraftCount}</CardTitle>
              <div className="absolute right-4 top-4">
                <Badge variant="outline" className="flex gap-1 rounded-lg text-xs text-muted-foreground">
                  <FileTextIcon className="size-3" />
                  {sentDraftCount} sent
                </Badge>
              </div>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-0.5 text-sm">
              <div className="font-medium">Drafts sent to customers</div>
              <div className="text-xs text-muted-foreground">Generated across your inbox</div>
            </CardFooter>
          </Card>

          <Card className="@container/card">
            <CardHeader className="relative pb-2">
              <CardDescription>Time Saved</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums">{timeSavedLabel}</CardTitle>
              <div className="absolute right-4 top-4">
                <Badge variant="outline" className="flex gap-1 rounded-lg text-xs text-muted-foreground">
                  <Clock3Icon className="size-3" />
                  Estimated
                </Badge>
              </div>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-0.5 text-sm">
              <div className="font-medium">Automation time saved</div>
              <div className="text-xs text-muted-foreground">Based on 5 min per draft</div>
            </CardFooter>
          </Card>
        </div>
      </div>

      {/* Bottom row: Recent AI activity + Returns in transit */}
      <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-2 lg:px-6">
        {/* Recent AI activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent AI activity</CardTitle>
            <CardDescription>What Sona has done lately</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity.</p>
            ) : (
              <div>
                {recentActivity.map((event, i) => (
                  <div key={event.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ACTIVITY_DOT_CLASSES[event.badge]}`} />
                      {i < recentActivity.length - 1 && (
                        <div className="mt-1 w-px flex-1 bg-border" />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-2 pb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{event.label}</p>
                        {event.detail && (
                          <p className="truncate text-xs text-muted-foreground">{event.detail}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-xs text-muted-foreground">{formatTime(event.time)}</span>
                        <Badge
                          variant="outline"
                          className={`text-xs ${ACTIVITY_BADGE_CLASSES[event.badge]}`}
                        >
                          {ACTIVITY_BADGE_LABEL[event.badge]}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Returns in transit */}
        <Card>
          <CardHeader>
            <CardTitle>Returns in transit</CardTitle>
            <CardDescription>Packages on their way back — refund after inspection</CardDescription>
          </CardHeader>
          <CardContent>
            {returnsCount > 0 && (
              <div className="mb-4">
                <p className="text-2xl font-semibold tabular-nums">{returnsCount}</p>
                <p className="text-xs text-muted-foreground">In transit</p>
              </div>
            )}
            {returnsInTransit.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active returns.</p>
            ) : (
              <div className="divide-y divide-border">
                {returnsInTransit.map((ret) => {
                  const reason = ret.payload?.return_reason || ret.payload?.reason || null;
                  return (
                    <div key={ret.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <PackageMinusIcon className="h-4 w-4 shrink-0 text-amber-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          Order #{ret.payload?.orderId ?? ret.thread_id?.slice(0, 8) ?? "—"}
                        </p>
                        {reason && (
                          <p className="truncate text-xs text-muted-foreground">{reason}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatTimeAgo(ret.updated_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Self Learning — full width */}
      <div className="px-4 lg:px-6">
        <LearningCard exampleCount={exampleCount} />
      </div>
    </div>
  </div>
);
```

- [ ] **Step 5: Verify the app builds without errors**

```bash
cd /Users/jonashoppe/Developer/INNO && npm run build 2>&1 | tail -30
```

Expected: build succeeds with no new errors.

- [ ] **Step 6: Start dev server and verify the dashboard visually**

```bash
cd /Users/jonashoppe/Developer/INNO && npm run dev
```

Open `http://localhost:3000/dashboard` and check:
- Greeting displays correctly
- "Needs your attention" card shows rows only where count > 0; shows "Alt ser godt ud" when empty
- 4 stat cards appear in a 2×2 grid to the right
- "Recent AI activity" feed shows a timeline with colored dots and badges
- "Returns in transit" shows the count summary + list
- "AI Self Learning" card is full width at the bottom

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(dashboard\)/dashboard/page.jsx
git commit -m "feat: redesign dashboard with attention card, activity feed, and 2x2 stat grid"
```
