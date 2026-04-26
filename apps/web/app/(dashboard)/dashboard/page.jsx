import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  AlertCircleIcon,
  Clock3Icon,
  FileTextIcon,
  InboxIcon,
  PackageIcon,
  PackageMinusIcon,
} from "lucide-react";

import DashboardGreeting from "@/components/dashboard/DashboardGreeting";
import { LearningCard } from "@/components/agent/LearningCard";
import { Badge } from "@/components/ui/badge";
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
  let pendingActions = [];
  let pendingCount = 0;
  let exampleCount = 0;
  let returnsInTransit = [];
  let returnsCount = 0;

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

      const [draftResult, awaitingResult, pendingResult, exampleResult, returnsResult] = await Promise.all([
        draftQuery,
        loadAwaitingThreads(serviceClient, scope, mailboxIds),
        loadPendingActions(serviceClient, shopId),
        exampleQuery,
        loadReturnsInTransit(serviceClient, shopId),
      ]);

      if (!draftResult.error) {
        drafts = Array.isArray(draftResult.data) ? draftResult.data : [];
      }

      awaitingThreads = awaitingResult.threads;
      awaitingCount = awaitingResult.count;
      pendingActions = pendingResult.actions;
      pendingCount = pendingResult.count;
      exampleCount = exampleResult.count ?? 0;
      returnsInTransit = returnsResult.returns;
      returnsCount = returnsResult.count;
    } catch (error) {
      console.error("Dashboard data lookup failed:", error);
    }
  }

  const sentDraftCount = drafts.filter((d) => d.status === "sent").length;
  const totalDrafts = drafts.length;
  const timeSavedMinutes = totalDrafts * 5;
  const timeSavedLabel = totalDrafts === 0 ? "0 hrs" : formatTimeSaved(timeSavedMinutes);

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        {/* Greeting */}
        <div className="px-4 lg:px-6">
          <DashboardGreeting firstName={firstName} />
        </div>

        {/* Stat cards grid */}
        <div className="*:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4 grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card lg:px-6">
          {/* Awaiting Reply */}
          <Card className="@container/card">
            <CardHeader className="relative">
              <CardDescription>Awaiting Reply</CardDescription>
              <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
                {awaitingCount}
              </CardTitle>
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
            <CardFooter className="flex-col items-start gap-1 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                Tickets without a reply <InboxIcon className="size-4" />
              </div>
              <div className="text-muted-foreground">Over 12 hours old</div>
            </CardFooter>
          </Card>

          {/* Pending Approvals */}
          <Card className="@container/card">
            <CardHeader className="relative">
              <CardDescription>Pending Approvals</CardDescription>
              <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
                {pendingCount}
              </CardTitle>
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
            <CardFooter className="flex-col items-start gap-1 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                Actions waiting for you <AlertCircleIcon className="size-4" />
              </div>
              <div className="text-muted-foreground">Require manual approval</div>
            </CardFooter>
          </Card>

          {/* AI Drafts Sent */}
          <Card className="@container/card">
            <CardHeader className="relative">
              <CardDescription>AI Drafts Sent</CardDescription>
              <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
                {sentDraftCount}
              </CardTitle>
              <div className="absolute right-4 top-4">
                <Badge variant="outline" className="flex gap-1 rounded-lg text-xs text-muted-foreground">
                  <FileTextIcon className="size-3" />
                  {sentDraftCount} sent
                </Badge>
              </div>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                Drafts sent to customers <FileTextIcon className="size-4" />
              </div>
              <div className="text-muted-foreground">Generated across your inbox</div>
            </CardFooter>
          </Card>

          {/* Time Saved */}
          <Card className="@container/card">
            <CardHeader className="relative">
              <CardDescription>Time Saved</CardDescription>
              <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
                {timeSavedLabel}
              </CardTitle>
              <div className="absolute right-4 top-4">
                <Badge variant="outline" className="flex gap-1 rounded-lg text-xs text-muted-foreground">
                  <Clock3Icon className="size-3" />
                  Estimated
                </Badge>
              </div>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                Automation time saved <Clock3Icon className="size-4" />
              </div>
              <div className="text-muted-foreground">Based on 5 min per draft</div>
            </CardFooter>
          </Card>
        </div>

        {/* AI Self Learning */}
        <div className="px-4 lg:px-6">
          <LearningCard exampleCount={exampleCount} />
        </div>

        {/* Three-column section */}
        <div className="grid grid-cols-1 gap-4 px-4 lg:grid-cols-3 lg:px-6">
          {/* Awaiting Reply list */}
          <Card>
            <CardHeader>
              <CardTitle>Awaiting reply</CardTitle>
              <CardDescription>Tickets without a response for over 12 hours</CardDescription>
            </CardHeader>
            <CardContent>
              {awaitingThreads.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tickets awaiting reply.</p>
              ) : (
                <div className="divide-y divide-border">
                  {awaitingThreads.map((thread) => (
                    <div
                      key={thread.id}
                      className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          Date.now() - new Date(thread.updated_at).getTime() > 86400000
                            ? "bg-destructive"
                            : "bg-amber-400"
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {thread.subject || "No subject"}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatTimeAgo(thread.updated_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Actions list */}
          <Card>
            <CardHeader>
              <CardTitle>Pending approvals</CardTitle>
              <CardDescription>Actions waiting for your review</CardDescription>
            </CardHeader>
            <CardContent>
              {pendingActions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No actions pending approval.</p>
              ) : (
                <div className="divide-y divide-border">
                  {pendingActions.map((action) => (
                    <div
                      key={action.id}
                      className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <PackageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm capitalize">
                          {(action.action_type || "action").replace(/_/g, " ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Thread #{action.thread_id?.slice(0, 8) ?? "—"}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatTimeAgo(action.created_at)}
                      </span>
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
      </div>
    </div>
  );
}
