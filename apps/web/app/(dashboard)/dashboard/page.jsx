import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  Clock3Icon,
  InboxIcon,
  MessageCircleIcon,
  PackageIcon,
  PackageMinusIcon,
  SendIcon,
  SparklesIcon,
  TimerIcon,
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
  if (!totalMinutes) return "0h";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function Sparkline({ path, color, className = "" }) {
  return (
    <svg viewBox="0 0 100 32" className={`w-full h-8 ${className}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SPARKLINE_PATHS = {
  awaiting: "M0,24 C12,24 20,18 34,15 C48,12 58,14 72,12 C82,10 91,8 100,6",
  pending:  "M0,8  C10,8  20,12 36,16 C50,18 62,17 76,15 C87,13 94,15 100,16",
  drafts:   "M0,26 C10,24 20,18 36,13 C50,9  64,7  78,5  C88,4  95,3  100,2",
  saved:    "M0,28 C16,26 28,20 46,14 C60,10 74,6  88,4  C94,3  98,2  100,2",
};

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
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isToday) {
    return date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return "I går";
  return date.toLocaleDateString("da-DK", { day: "numeric", month: "short" });
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
      .or("classification_key.is.null,classification_key.neq.notification")
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
  sent: "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-400",
  approved: "border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  pending: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

const ACTIVITY_DOT_CLASSES = {
  sent: "bg-green-500 ring-green-500/20",
  approved: "bg-indigo-500 ring-indigo-500/20",
  pending: "bg-amber-400 ring-amber-400/20",
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
  const timeSavedLabel = totalDrafts === 0 ? "0h" : formatTimeSaved(timeSavedMinutes);

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
        <div className="px-4 lg:px-6 flex items-start justify-between gap-4">
          <DashboardGreeting
            firstName={firstName}
            conversationCount={sentDraftCount}
            attentionCount={totalAttention}
          />
        </div>

        {/* Middle row: Needs your attention + 2×2 stat cards */}
        <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-2 lg:px-6">
          {/* Needs your attention */}
          <Card className={`transition-[border-color,background-color] duration-200 ${
            attentionItems.length === 0
              ? "bg-green-500/[0.04] border-green-200 dark:border-green-800/40"
              : "border-red-200 dark:border-red-900/40"
          }`}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <CardTitle>
                  {attentionItems.length === 0 ? "All clear" : "Needs your attention"}
                </CardTitle>
                {totalAttention > 0 && (
                  <span className="flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-red-500/15 text-xs font-semibold text-red-600 dark:text-red-400">
                    {totalAttention}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="pb-2">
              {attentionItems.length === 0 ? (
                <div className="flex items-center gap-2 py-4 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2Icon className="size-4 text-green-500" />
                  All clear — no tasks require your attention.
                </div>
              ) : (
                <ul className="list-none">
                  {attentionItems.map((item) => (
                    <li key={item.key}>
                      <Link
                        href="/inbox"
                        className="group flex items-center gap-3 rounded-lg py-2.5 px-2 -mx-2 hover:bg-muted/60 active:scale-[0.99] transition-[background-color,transform] duration-150"
                      >
                        {item.iconName === "alert" && (
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
                            <AlertCircleIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
                          </span>
                        )}
                        {item.iconName === "inbox" && (
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-red-500/15">
                            <InboxIcon className="size-3.5 text-red-600 dark:text-red-400" />
                          </span>
                        )}
                        {item.iconName === "package" && (
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15">
                            <PackageMinusIcon className="size-3.5 text-blue-600 dark:text-blue-400" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                        </div>
                        <span className={`shrink-0 text-sm font-semibold tabular-nums ${item.countColor}`}>
                          {item.count}
                        </span>
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
                      </Link>
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
            {/* Awaiting Reply */}
            <Card className={`@container/card overflow-hidden transition-[box-shadow,transform] duration-150 hover:shadow-md hover:-translate-y-px ${
              awaitingCount > 0 ? "border-red-200 dark:border-red-900/40" : "border-indigo-500/15"
            }`}>
              <CardHeader className="pb-0">
                {awaitingCount > 0 && (
                  <div className="flex justify-end">
                    <Badge variant="outline" className="text-xs border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400">
                      Action needed
                    </Badge>
                  </div>
                )}
                <div className={awaitingCount > 0 ? "" : "mt-1"}>
                  <CardTitle className={`text-4xl font-bold tabular-nums ${
                    awaitingCount > 0 ? "text-red-600 dark:text-red-400" : ""
                  }`}>{awaitingCount}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pb-0 pt-1">
                <p className="text-sm font-medium">Awaiting reply</p>
                <p className="text-xs text-muted-foreground">Over 12 hours old</p>
                <Sparkline
                  path={SPARKLINE_PATHS.awaiting}
                  color={awaitingCount > 0 ? "rgb(239 68 68 / 0.4)" : "rgb(99 102 241 / 0.3)"}
                  className="mt-3"
                />
              </CardContent>
            </Card>

            {/* Pending Approvals */}
            <Card className={`@container/card overflow-hidden transition-[box-shadow,transform] duration-150 hover:shadow-md hover:-translate-y-px ${
              pendingCount > 0 ? "border-amber-200 dark:border-amber-900/40" : "border-indigo-500/15"
            }`}>
              <CardHeader className="pb-0">
                {pendingCount > 0 && (
                  <div className="flex justify-end">
                    <Badge variant="outline" className="text-xs border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                      Need review
                    </Badge>
                  </div>
                )}
                <div className={pendingCount > 0 ? "" : "mt-1"}>
                  <CardTitle className={`text-4xl font-bold tabular-nums ${
                    pendingCount > 0 ? "text-amber-600 dark:text-amber-400" : ""
                  }`}>{pendingCount}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pb-0 pt-1">
                <p className="text-sm font-medium">Pending approvals</p>
                <p className="text-xs text-muted-foreground">Require manual review</p>
                <Sparkline
                  path={SPARKLINE_PATHS.pending}
                  color={pendingCount > 0 ? "rgb(217 119 6 / 0.5)" : "rgb(99 102 241 / 0.3)"}
                  className="mt-3"
                />
              </CardContent>
            </Card>

            {/* AI Drafts Sent */}
            <Card className="@container/card overflow-hidden transition-[box-shadow,transform] duration-150 hover:shadow-md hover:-translate-y-px border-indigo-500/15">
              <CardHeader className="pb-0">
                <div className="mt-1">
                  <CardTitle className="text-4xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{sentDraftCount}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pb-0 pt-1">
                <p className="text-sm font-medium">AI drafts sent</p>
                <p className="text-xs text-muted-foreground">Across your inbox</p>
                <Sparkline
                  path={SPARKLINE_PATHS.drafts}
                  color="rgb(99 102 241 / 0.4)"
                  className="mt-3"
                />
              </CardContent>
            </Card>

            {/* Time Saved */}
            <Card className="@container/card overflow-hidden transition-[box-shadow,transform] duration-150 hover:shadow-md hover:-translate-y-px border-indigo-500/15">
              <CardHeader className="pb-0">
                <div className="mt-1">
                  <CardTitle className="text-4xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{timeSavedLabel}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pb-0 pt-1">
                <p className="text-sm font-medium">Time saved</p>
                <p className="text-xs text-muted-foreground">Est. 5 min per draft</p>
                <Sparkline
                  path={SPARKLINE_PATHS.saved}
                  color="rgb(99 102 241 / 0.4)"
                  className="mt-3"
                />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Bottom row: Recent AI activity + Returns in transit */}
        <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-2 lg:px-6">
          {/* Recent AI activity */}
          <Card className="flex flex-col">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>Recent AI activity</CardTitle>
              </div>
              <CardDescription>What Sona has done lately</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              {recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity.</p>
              ) : (
                <ol className="list-none">
                  {recentActivity.map((event, i) => (
                    <li key={event.id} className="flex gap-3 rounded-lg -mx-2 px-2 hover:bg-muted/40 transition-colors">
                      {/* Timestamp on left */}
                      <span className="w-10 shrink-0 pt-2.5 text-right text-[11px] tabular-nums text-muted-foreground leading-snug">
                        {formatTime(event.time)}
                      </span>
                      {/* Timeline dot + line */}
                      <div className="flex flex-col items-center py-2.5">
                        <div className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${ACTIVITY_DOT_CLASSES[event.badge]}`} />
                        {i < recentActivity.length - 1 && (
                          <div className="mt-1.5 w-px flex-1 bg-border" />
                        )}
                      </div>
                      {/* Content */}
                      <div className="flex min-w-0 flex-1 items-start justify-between gap-2 py-2.5 pb-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-snug">{event.label}</p>
                          {event.detail && (
                            <p className="truncate text-xs text-muted-foreground">{event.detail}</p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-xs ${ACTIVITY_BADGE_CLASSES[event.badge]}`}
                        >
                          {ACTIVITY_BADGE_LABEL[event.badge]}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
            <CardFooter className="pt-0">
              <Button variant="outline" className="w-full" asChild>
                <Link href="/inbox">
                  View all activity
                  <ChevronRightIcon className="ml-1 size-4" />
                </Link>
              </Button>
            </CardFooter>
          </Card>

          {/* Returns in transit */}
          <Card className={returnsCount > 0 ? "border-amber-500/20" : ""}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>Returns in transit</CardTitle>
                  <CardDescription>Packages on their way back — refund after inspection</CardDescription>
                </div>
                {returnsCount > 0 && (
                  <Link href="/inbox" className="shrink-0 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline underline-offset-2">
                    View all
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {returnsInTransit.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active returns.</p>
              ) : (
                <>
                  {/* Mini stats row */}
                  <div className="mb-4 grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-muted/50 px-3 py-2">
                      <p className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{returnsCount}</p>
                      <p className="text-xs text-muted-foreground">In transit</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 px-3 py-2">
                      <p className="text-xl font-bold tabular-nums">0</p>
                      <p className="text-xs text-muted-foreground">In inspection</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 px-3 py-2">
                      <p className="text-xl font-bold tabular-nums">0</p>
                      <p className="text-xs text-muted-foreground">Refund pending</p>
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {returnsInTransit.map((ret) => {
                      const reason = ret.payload?.return_reason || ret.payload?.reason || null;
                      return (
                        <div key={ret.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
                            <PackageMinusIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              Order #{ret.payload?.orderId ?? ret.thread_id?.slice(0, 8) ?? "—"}
                            </p>
                            {reason && (
                              <p className="truncate text-xs text-muted-foreground">{reason}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                              <span className="size-1.5 rounded-full bg-amber-500" />
                              In transit
                            </span>
                            <span className="text-xs text-muted-foreground">{formatTimeAgo(ret.updated_at)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
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
