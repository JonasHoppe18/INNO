import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
} from "lucide-react";

import { ReturnTrackingDashboardCard } from "@/components/dashboard/ReturnTrackingDashboardCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import { listReturnTrackingShipments } from "@/lib/server/return-tracking";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const SOLVED_STATUSES = new Set(["solved", "resolved", "closed"]);
const SUPPORT_CLASSIFICATION_KEY = "support";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return "Yesterday";
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function formatDuration(minutes) {
  if (minutes == null || Number.isNaN(Number(minutes))) return "Collecting data";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hrs`;
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} days`;
}

function minutesBetween(start, end) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 60000);
}

function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function average(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  return Math.round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function asTimestamp(row) {
  return row?.sent_at || row?.received_at || row?.created_at || null;
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isSolvedThread(thread) {
  return SOLVED_STATUSES.has(normalizeStatus(thread?.status));
}

function isSupportThread(thread) {
  const classification = String(thread?.classification_key || "").trim().toLowerCase();
  if (classification && classification !== SUPPORT_CLASSIFICATION_KEY) return false;
  const tags = Array.isArray(thread?.tags) ? thread.tags : [];
  if (tags.some((tag) => String(tag).startsWith("inbox:"))) return false;
  return true;
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

async function loadRecentActivity(serviceClient, scope, shopId) {
  const draftsPromise = applyScope(
    serviceClient
      .from("drafts")
      .select("id, draft_id, message_id, created_at, customer_email, subject, status")
      .eq("status", "sent")
      .order("created_at", { ascending: false })
      .limit(10),
    scope
  );

  const sentMessagesPromise = applyScope(
    serviceClient
      .from("mail_messages")
      .select("id, subject, to_emails, sent_at, created_at")
      .eq("from_me", true)
      .eq("is_draft", false)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
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

  const [draftsResult, sentMessagesResult, actionsResult] = await Promise.all([
    draftsPromise,
    sentMessagesPromise,
    actionsPromise,
  ]);

  const sentDraftMessageIds = new Set(
    (draftsResult.data ?? [])
      .flatMap((d) => [d.draft_id, d.message_id])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );

  const draftEvents = (draftsResult.data ?? []).map((d) => ({
    id: `draft-${d.id}`,
    time: d.created_at,
    label: "Draft sent",
    detail: d.subject || d.customer_email || "—",
    badge: "sent",
  }));

  const sentMessageEvents = (sentMessagesResult.data ?? [])
    .filter((message) => !sentDraftMessageIds.has(String(message.id || "").trim()))
    .map((message) => ({
      id: `message-${message.id}`,
      time: message.sent_at || message.created_at,
      label: "Reply sent",
      detail:
        message.subject ||
        (Array.isArray(message.to_emails) ? message.to_emails[0] : null) ||
        "—",
      badge: "sent",
    }));

  const actionEvents = (actionsResult.data ?? []).map((a) => ({
    id: `action-${a.id}`,
    time: a.created_at,
    label: actionLabel(a.action_type),
    detail: a.payload?.orderId ? `Order #${a.payload.orderId}` : null,
    badge: "approved",
  }));

  return [...draftEvents, ...sentMessageEvents, ...actionEvents]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 5);
}

async function loadDashboardSupportAnalytics(serviceClient, scope) {
  const sinceDate = new Date();
  sinceDate.setUTCDate(sinceDate.getUTCDate() - 30);
  const since = sinceDate.toISOString();

  let threadsQ = serviceClient
    .from("mail_threads")
    .select("id, status, classification_key, tags, created_at, updated_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  threadsQ = applyScope(threadsQ, scope);

  const { data, error } = await threadsQ;
  if (error) throw new Error(error.message);

  const threads = (Array.isArray(data) ? data : []).filter(isSupportThread);
  const threadIds = threads.map((thread) => thread.id).filter(Boolean);
  let messages = [];
  if (threadIds.length > 0) {
    const { data: messageRows, error: messageError } = await serviceClient
      .from("mail_messages")
      .select("id, thread_id, from_me, sent_at, received_at, created_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: true });
    if (messageError) throw new Error(messageError.message);
    messages = Array.isArray(messageRows) ? messageRows : [];
  }

  const messagesByThreadId = {};
  for (const message of messages) {
    if (!message.thread_id) continue;
    if (!messagesByThreadId[message.thread_id]) messagesByThreadId[message.thread_id] = [];
    messagesByThreadId[message.thread_id].push(message);
  }

  const firstReplyMinutes = [];
  let solvedTickets = 0;
  let oneTouchTickets = 0;
  for (const thread of threads) {
    const solved = isSolvedThread(thread);
    if (solved) solvedTickets++;

    const threadMessages = messagesByThreadId[thread.id] ?? [];
    const inboundMessages = threadMessages
      .filter((row) => row.from_me === false)
      .sort((a, b) => new Date(asTimestamp(a)).getTime() - new Date(asTimestamp(b)).getTime());
    const outboundMessages = threadMessages
      .filter((row) => row.from_me === true)
      .sort((a, b) => new Date(asTimestamp(a)).getTime() - new Date(asTimestamp(b)).getTime());

    const firstInboundAt = asTimestamp(inboundMessages[0]) || thread.created_at;
    const firstReply = outboundMessages.find((row) => {
      const replyAt = new Date(asTimestamp(row)).getTime();
      const inboundAt = new Date(firstInboundAt).getTime();
      return Number.isFinite(replyAt) && Number.isFinite(inboundAt) && replyAt >= inboundAt;
    });
    const replyMinutes = firstReply ? minutesBetween(firstInboundAt, asTimestamp(firstReply)) : null;
    if (replyMinutes != null) firstReplyMinutes.push(replyMinutes);
    if (solved && outboundMessages.length === 1) oneTouchTickets++;
  }

  const createdTickets = threads.length;
  const unsolvedTickets = createdTickets - solvedTickets;
  return {
    createdTickets,
    unsolvedTickets,
    solvedTickets,
    oneTouchTickets,
    oneTouchRate: pct(oneTouchTickets, solvedTickets),
    medianFirstReplyMinutes: median(firstReplyMinutes),
    averageFirstReplyMinutes: average(firstReplyMinutes),
    replyCoveragePct: pct(firstReplyMinutes.length, createdTickets),
  };
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

function PerformanceStrip({ analytics }) {
  const items = [
    { label: "Created", value: analytics.createdTickets, sub: "tickets" },
    { label: "Solved", value: analytics.solvedTickets, sub: "tickets" },
    { label: "One-touch", value: `${analytics.oneTouchRate}%`, sub: "of solved" },
    { label: "Avg. first reply", value: formatDuration(analytics.averageFirstReplyMinutes), sub: "response time" },
  ];
  return (
    <section aria-labelledby="performance-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p id="performance-heading" className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Performance
        </p>
        <p className="text-xs text-muted-foreground">Last 30 days</p>
      </div>
      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
        <CardContent className="grid gap-0 p-0 sm:grid-cols-2 xl:grid-cols-[1.1fr_repeat(4,minmax(0,1fr))]">
          <Link
            href="/inbox"
            className="group flex min-h-[136px] flex-col justify-between bg-primary/[0.045] p-4 transition-colors hover:bg-primary/[0.08] sm:col-span-2 sm:min-h-[144px] sm:p-5 xl:col-span-1"
          >
            <div className="flex items-center justify-between gap-3">
              <CardDescription>Open tickets</CardDescription>
              <ArrowUpRightIcon className="size-4 text-primary/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </div>
            <div>
              <p className="mt-5 text-3xl font-semibold tracking-tight tabular-nums">{analytics.unsolvedTickets}</p>
              <p className="mt-1 text-xs text-muted-foreground">Not marked as solved</p>
            </div>
          </Link>
          <div className="grid grid-cols-2 gap-0 sm:col-span-2 xl:col-span-4 xl:grid-cols-4">
            {items.map((item, index) => (
              <div
                key={item.label}
                className={cn(
                  "min-h-[128px] border-border/70 p-4 sm:min-h-[144px] sm:p-5",
                  index % 2 === 1 && "border-l",
                  index > 1 && "border-t xl:border-t-0",
                  index > 0 && "xl:border-l",
                )}
              >
                <CardDescription>{item.label}</CardDescription>
                <p className="mt-5 text-2xl font-semibold tracking-tight tabular-nums">{item.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.sub}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

export default async function Page() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    redirect("/sign-in?redirect_url=/dashboard");
  }

  const serviceClient = createServiceClient();

  let returnTrackingRows = [];
  let recentActivity = [];
  let supportAnalytics = {
    createdTickets: 0,
    unsolvedTickets: 0,
    solvedTickets: 0,
    oneTouchTickets: 0,
    oneTouchRate: 0,
    medianFirstReplyMinutes: null,
    averageFirstReplyMinutes: null,
    replyCoveragePct: 0,
  };

  if (serviceClient) {
    try {
      const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
      const shopId = await resolveShopId(serviceClient, scope);

      const [
        returnTrackingResult,
        activityResult,
        supportAnalyticsResult,
      ] = await Promise.all([
        listReturnTrackingShipments(serviceClient, scope).catch(() => []),
        loadRecentActivity(serviceClient, scope, shopId),
        loadDashboardSupportAnalytics(serviceClient, scope),
      ]);

      returnTrackingRows = Array.isArray(returnTrackingResult)
        ? returnTrackingResult
        : [];
      recentActivity = activityResult;
      supportAnalytics = supportAnalyticsResult;
    } catch (error) {
      console.error("Dashboard data lookup failed:", error);
    }
  }

  return (
    <div className="@container/main flex flex-1 flex-col bg-muted/30">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-7 px-4 py-6 lg:px-7 lg:py-8">
        <header className="flex flex-col gap-5 border-b border-border/70 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace overview</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">Support overview</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              A clear view of your team&apos;s workload, response speed, and latest activity.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-background px-3 text-sm text-muted-foreground">
              <CalendarDaysIcon className="size-4" />
              Last 30 days
            </div>
            <Button asChild className="h-9 rounded-lg">
              <Link href="/inbox">
                Open inbox
                <ArrowUpRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </header>

        <PerformanceStrip analytics={supportAnalytics} />

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card className="flex min-h-[360px] flex-col rounded-2xl border-border/70 shadow-sm">
            <CardHeader className="p-5 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ActivityIcon className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Recent activity</CardTitle>
                    <CardDescription className="mt-1">Replies, drafts, and approved actions.</CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-8 rounded-lg px-2" asChild>
                  <Link href="/inbox">
                    View inbox
                    <ChevronRightIcon className="ml-1 size-4" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-5 pt-0">
              {recentActivity.length === 0 ? (
                <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 text-center">
                  <div className="flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm">
                    <ActivityIcon className="size-4" />
                  </div>
                  <p className="mt-3 text-sm font-medium">No recent activity</p>
                  <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                    Sent replies and completed actions will appear here.
                  </p>
                  <Button variant="outline" size="sm" className="mt-4 rounded-lg" asChild>
                    <Link href="/inbox">Go to inbox</Link>
                  </Button>
                </div>
              ) : (
                <ol className="space-y-0">
                  {recentActivity.map((event, index) => (
                    <li
                      key={event.id}
                      className="group relative flex gap-3 pb-1 last:pb-0"
                    >
                      {index < recentActivity.length - 1 ? (
                        <span className="absolute bottom-0 left-[9px] top-5 w-px bg-border" aria-hidden="true" />
                      ) : null}
                      <div className="relative z-10 flex w-5 shrink-0 justify-center pt-3">
                        <div className={`size-2.5 rounded-full ring-4 ${ACTIVITY_DOT_CLASSES[event.badge] ?? ACTIVITY_DOT_CLASSES.pending}`} />
                      </div>
                      <div className="min-w-0 flex-1 rounded-xl border border-transparent px-3 py-2.5 transition-colors duration-150 group-hover:border-border/70 group-hover:bg-muted/30">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-medium">{event.label}</p>
                          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                            {formatTime(event.time)}
                          </span>
                        </div>
                        {event.detail && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{event.detail}</p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 rounded-md text-xs ${ACTIVITY_BADGE_CLASSES[event.badge]}`}
                      >
                        {ACTIVITY_BADGE_LABEL[event.badge]}
                      </Badge>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <ReturnTrackingDashboardCard rows={returnTrackingRows} />
        </section>
      </div>
    </div>
  );
}
