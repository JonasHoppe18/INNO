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

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function formatTimeSaved(totalMinutes) {
  if (!totalMinutes) return "0 hrs";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} hrs ${minutes} mins`;
}

function formatTimeAgo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
}

async function resolveShopId(serviceClient, scope) {
  let query = serviceClient
    .from("shops")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1);
  query = applyScope(query, scope, { workspaceColumn: "workspace_id", userColumn: "owner_user_id" });
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

async function loadMailboxIds(serviceClient, scope) {
  const { data } = await applyScope(
    serviceClient.from("mail_accounts").select("id"),
    scope
  );
  return (data ?? []).map((r) => r.id).filter(Boolean);
}

async function loadAwaitingThreads(serviceClient, scope, mailboxIds) {
  if (!mailboxIds.length) return { threads: [], count: 0 };
  const { data, count, error } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, subject, customer_email, updated_at", { count: "exact" })
      .in("mailbox_id", mailboxIds)
      .not("status", "in", '("Solved","Resolved","resolved")')
      .gt("unread_count", 0)
      .order("updated_at", { ascending: true })
      .limit(5),
    scope
  );
  if (error) return { threads: [], count: 0 };
  return { threads: data ?? [], count: count ?? 0 };
}

async function loadPendingActions(serviceClient, shopId) {
  if (!shopId) return { actions: [], count: 0 };
  const { data, count, error } = await serviceClient
    .from("thread_actions")
    .select("id, action_type, thread_id, created_at", { count: "exact" })
    .eq("shop_id", shopId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) return { actions: [], count: 0 };
  return { actions: data ?? [], count: count ?? 0 };
}

async function loadReturnsInTransit(serviceClient, shopId) {
  if (!shopId) return { returns: [], count: 0 };
  const { data, count, error } = await serviceClient
    .from("thread_actions")
    .select("id, action_type, payload, thread_id, created_at, updated_at", { count: "exact" })
    .eq("shop_id", shopId)
    .eq("action_type", "initiate_return")
    .eq("status", "applied")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) return { returns: [], count: 0 };
  return { returns: data ?? [], count: count ?? 0 };
}

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
    .filter("payload->>tracking_url", "is", null);
  if (error) return 0;
  return count ?? 0;
}

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
        .eq("status", "applied")
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
    badge: "approved",
  }));

  return [...draftEvents, ...actionEvents]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 10);
}

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

export default async function Page() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    redirect("/sign-in?redirect_url=/dashboard");
  }

  const clerkUser = await currentUser();
  const firstName = clerkUser?.firstName ?? "there";

  const serviceClient = createServiceClient();

  let drafts = [];
  let awaitingThreads = [];
  let awaitingCount = 0;
  let pendingCount = 0;
  let exampleCount = 0;
  let returnsInTransit = [];
  let returnsCount = 0;
  let missingTrackingCount = 0;
  let recentActivity = [];

  if (serviceClient) {
    try {
      const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
      const shopId = await resolveShopId(serviceClient, scope);
      const mailboxIds = await loadMailboxIds(serviceClient, scope);

      let draftQuery = serviceClient
        .from("drafts")
        .select("id, created_at, customer_email, subject, status")
        .order("created_at", { ascending: false });
      if (shopId) {
        draftQuery = draftQuery.eq("shop_id", shopId);
      }
      draftQuery = applyScope(draftQuery, scope);

      const exampleQuery = shopId
        ? serviceClient
            .from("agent_knowledge")
            .select("id", { count: "exact", head: true })
            .eq("shop_id", shopId)
            .eq("source_type", "ticket")
            .eq("source_provider", "sent_reply")
        : Promise.resolve({ count: 0 });

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

      if (!draftResult.error) {
        drafts = Array.isArray(draftResult.data) ? draftResult.data : [];
      }

      awaitingThreads = awaitingResult.threads;
      awaitingCount = awaitingResult.count;
      pendingCount = pendingResult.count;
      exampleCount = exampleResult.count ?? 0;
      returnsInTransit = returnsResult.returns;
      returnsCount = returnsResult.count;
      missingTrackingCount = missingTracking;
      recentActivity = activityResult;
    } catch (error) {
      console.error("Dashboard data lookup failed:", error);
    }
  }

  const sentDraftCount = drafts.filter((d) => d.status === "sent").length;
  const totalDrafts = drafts.length;
  const timeSavedMinutes = totalDrafts * 5;
  const timeSavedLabel = totalDrafts === 0 ? "0 hrs" : formatTimeSaved(timeSavedMinutes);

  const attentionItems = [
    pendingCount > 0 && {
      key: "pending",
      iconName: "alert",
      title: "Pending approvals",
      subtitle: "Actions waiting for your review",
      count: pendingCount,
      countColor: "text-amber-600",
    },
    awaitingCount > 0 && {
      key: "awaiting",
      iconName: "inbox",
      title: "Customers waiting over 12h",
      subtitle: "No reply from your team",
      count: awaitingCount,
      countColor: "text-red-600",
    },
    missingTrackingCount > 0 && {
      key: "tracking",
      iconName: "package",
      title: "Missing tracking link",
      subtitle: "Returns need tracking updates",
      count: missingTrackingCount,
      countColor: "text-blue-600",
    },
  ].filter(Boolean);

  const totalAttention = attentionItems.reduce((sum, item) => sum + item.count, 0);

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
                  <span className="flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-red-100 text-xs font-semibold text-red-600">
                    {totalAttention}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="pb-2">
              {attentionItems.length === 0 ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <CheckCircle2Icon className="size-4 text-green-500" />
                  All clear — no tasks require your attention.
                </div>
              ) : (
                <ul className="divide-y divide-border list-none">
                  {attentionItems.map((item) => (
                    <li key={item.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      {item.iconName === "alert" && <AlertCircleIcon className="size-4 shrink-0 text-amber-500" />}
                      {item.iconName === "inbox" && <InboxIcon className="size-4 shrink-0 text-red-500" />}
                      {item.iconName === "package" && <PackageMinusIcon className="size-4 shrink-0 text-blue-500" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold ${item.countColor}`}>
                        {item.count}
                      </span>
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    </li>
                  ))}
                </ul>
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
                <ol className="list-none">
                  {recentActivity.map((event, i) => (
                    <li key={event.id} className="flex gap-3">
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
                    </li>
                  ))}
                </ol>
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
}
