import { applyScope } from "@/lib/server/workspace-auth";
import { WEEK_COUNT, buildWeekStats } from "@/lib/server/dashboard-week";
import { fetchAllPages, fetchThreadMessages, loadConfirmationMessageIds } from "@/lib/server/dashboard-queue-data";
import { isSupportThread } from "@/lib/server/product-radar";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Workspace fact tables may not exist yet on every environment; that means
// "not collecting", not a broken dashboard.
async function fetchFacts(serviceClient, scope, table, fields, dateColumn, since) {
  if (!scope?.workspaceId) return [];
  try {
    return await fetchAllPages(() =>
      serviceClient
        .from(table)
        .select(fields)
        .eq("workspace_id", scope.workspaceId)
        .gte(dateColumn, since)
        .order(dateColumn, { ascending: true }));
  } catch {
    return [];
  }
}

export async function loadWeekStats(serviceClient, scope, { now = new Date() } = {}) {
  const nowMs = new Date(now).getTime();
  const since = new Date(nowMs - WEEK_COUNT * WEEK_MS).toISOString();

  const allThreads = await fetchAllPages(() =>
    applyScope(
      serviceClient
        .from("mail_threads")
        .select("id, classification_key, tags, created_at")
        .gte("created_at", since)
        .order("id", { ascending: true }),
      scope,
    ));
  const threads = allThreads.filter(isSupportThread);
  const threadIds = threads.map((thread) => thread.id);

  const [messages, confirmationIds, lifecycleEvents, feedback] = await Promise.all([
    threadIds.length ? fetchThreadMessages(serviceClient, scope, threadIds) : [],
    loadConfirmationMessageIds(serviceClient, scope, threadIds, since),
    fetchFacts(serviceClient, scope, "ticket_lifecycle_events", "thread_id, event_type, to_status, occurred_at", "occurred_at", since),
    fetchFacts(serviceClient, scope, "support_feedback", "score, submitted_at", "submitted_at", since),
  ]);

  return buildWeekStats({ threads, messages, autoReplyMessageIds: confirmationIds, lifecycleEvents, feedback, now });
}
