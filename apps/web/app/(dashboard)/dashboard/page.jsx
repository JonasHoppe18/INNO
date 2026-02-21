import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  FileTextIcon,
  PercentIcon,
} from "lucide-react";

import { ChartAreaInteractive } from "@/components/chart-area-interactive";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

function getStatusBadgeStyles(status) {
  if (status === "sent") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

// Dashboardet viser en komplet TailArk demo med sidebar, kort og tabel.
export default async function Page() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    redirect("/sign-in?redirect_url=/dashboard");
  }

  const serviceClient = createServiceClient();
  let drafts = [];
  let sentMailCount = 0;
  let sentConversations = 0;
  if (serviceClient) {
    try {
      const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
      const shopId = await resolveShopId(serviceClient, scope);

      if (shopId || scope?.workspaceId || scope?.supabaseUserId) {
        let draftQuery = serviceClient
          .from("drafts")
          .select("id, created_at, customer_email, subject, status")
          .order("created_at", { ascending: false });
        if (shopId) {
          draftQuery = draftQuery.eq("shop_id", shopId);
        }
        draftQuery = applyScope(draftQuery, scope);
        const { data, error } = await draftQuery;
        if (error) {
          throw error;
        }
        drafts = Array.isArray(data) ? data : [];
      }

      if (scope?.workspaceId || scope?.supabaseUserId) {
        const { count: sentMailCountResult } = await applyScope(
          serviceClient
          .from("mail_messages")
          .select("id", { count: "exact", head: true })
          .eq("from_me", true)
          .not("sent_at", "is", null),
          scope
        );
        sentMailCount = sentMailCountResult ?? 0;

        const { data: conversationRows } = await applyScope(
          serviceClient
          .from("mail_messages")
          .select("thread_id")
          .eq("from_me", true)
          .not("sent_at", "is", null)
          .limit(2000),
          scope
        );
        sentConversations = new Set(
          (conversationRows || []).map((row) => row.thread_id).filter(Boolean)
        ).size;
      }
    } catch (error) {
      console.error("Dashboard drafts lookup failed:", error);
    }
  }

  const totalDrafts = drafts.length;
  const pendingCount = drafts.filter((draft) => draft.status === "pending").length;
  const sentDraftCount = drafts.filter((draft) => draft.status === "sent").length;
  const timeSavedMinutes = totalDrafts * 5;
  const timeSavedLabel =
    totalDrafts === 0 ? "0 hrs" : formatTimeSaved(timeSavedMinutes);
  const successRate =
    totalDrafts === 0 ? "N/A" : `${Math.round((sentDraftCount / totalDrafts) * 100)}%`;
  const recentDrafts = drafts.slice(0, 5);

  return (
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="*:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4 grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card lg:px-6">
            <Card className="@container/card">
              <CardHeader className="relative">
                <CardDescription>Time Saved</CardDescription>
                <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
                  {timeSavedLabel}
                </CardTitle>
                <div className="absolute right-4 top-4">
                  <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
                    <Clock3Icon className="size-3" />
                    Estimated
                  </Badge>
                </div>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1 text-sm">
                <div className="line-clamp-1 flex gap-2 font-medium">
                  Automation time saved <Clock3Icon className="size-4" />
                </div>
                <div className="text-muted-foreground">
                  Based on 5 minutes per draft
                </div>
              </CardFooter>
            </Card>
            <Card className="@container/card">
              <CardHeader className="relative">
                <CardDescription>Drafts Created</CardDescription>
                <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
                  {totalDrafts}
                </CardTitle>
                <div className="absolute right-4 top-4">
                  <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
                    <FileTextIcon className="size-3" />
                    {sentDraftCount} sent
                  </Badge>
                </div>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1 text-sm">
                <div className="line-clamp-1 flex gap-2 font-medium">
                  AI drafts ready for agents <FileTextIcon className="size-4" />
                </div>
                <div className="text-muted-foreground">
                  Generated across your inbox
                </div>
              </CardFooter>
            </Card>
            <Card className="@container/card">
              <CardHeader className="relative">
                <CardDescription>Success Rate</CardDescription>
                <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
                  {successRate}
                </CardTitle>
                <div className="absolute right-4 top-4">
                  <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
                    <PercentIcon className="size-3" />
                    {sentDraftCount}/{totalDrafts || 0} sent
                  </Badge>
                </div>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1 text-sm">
                <div className="line-clamp-1 flex gap-2 font-medium">
                  Drafts sent successfully <CheckCircle2Icon className="size-4" />
                </div>
                <div className="text-muted-foreground">
                  Success rate across all drafts
                </div>
              </CardFooter>
            </Card>
            <Card className="@container/card">
              <CardHeader className="relative">
                <CardDescription>Pending</CardDescription>
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
                    }`}>
                    <AlertCircleIcon className="size-3" />
                    {pendingCount > 0 ? "Action needed" : "All clear"}
                  </Badge>
                </div>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1 text-sm">
                <div className="line-clamp-1 flex gap-2 font-medium">
                  Reviews waiting on agent <AlertCircleIcon className="size-4" />
                </div>
                <div className="text-muted-foreground">Drafts queued for approval</div>
              </CardFooter>
            </Card>
          </div>
          <div className="px-4 lg:px-6">
            <LearningCard sentCount={sentMailCount} conversationCount={sentConversations} />
          </div>
          <div className="px-4 lg:px-6">
            {totalDrafts === 0 ? (
              <Card className="@container/card">
                <CardHeader>
                  <CardTitle>Ticket Volume</CardTitle>
                  <CardDescription>Incoming emails vs. AI drafts generated</CardDescription>
                </CardHeader>
                <CardContent className="flex min-h-[250px] items-center justify-center text-sm text-muted-foreground">
                  Waiting for your first email...
                </CardContent>
              </Card>
            ) : (
              <ChartAreaInteractive />
            )}
          </div>
          <div className="px-4 lg:px-6">
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest 5 drafts in your inbox</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer Email</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Time ago</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentDrafts.length ? (
                        recentDrafts.map((draft) => {
                          const status =
                            typeof draft.status === "string"
                              ? draft.status.toLowerCase()
                              : "pending";
                          const label =
                            status.charAt(0).toUpperCase() + status.slice(1);
                          return (
                            <TableRow key={draft.id}>
                              <TableCell className="font-medium">
                                {draft.customer_email || "Unknown"}
                              </TableCell>
                              <TableCell>{draft.subject || "No subject"}</TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={`${getStatusBadgeStyles(status)} capitalize`}>
                                  {label}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {formatTimeAgo(draft.created_at)}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                            No drafts yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
  );
}
