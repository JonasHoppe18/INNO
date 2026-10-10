import { applyScope } from "@/lib/server/workspace-auth";
import { buildDashboardQueue } from "@/lib/server/dashboard-queue";

// PostgREST caps a response at 1000 rows, and long `in` filters make long URLs.
const PAGE_SIZE = 1000;
const ID_CHUNK = 150;
const THREAD_COLUMNS =
  "id, ticket_number, subject, customer_name, customer_email, status, classification_key, close_pending, status_changed_at, created_at";
const MESSAGE_COLUMNS = "thread_id, from_me, is_draft, provider_message_id, received_at, sent_at, created_at, ai_draft_text";
const APPROVAL_STATUSES = ["pending", "awaiting_approval", "requires_approval"];

export async function fetchAllPages(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function chunk(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

async function fetchByThreadIds(threadIds, buildQuery) {
  const results = await Promise.all(chunk(threadIds, ID_CHUNK).map((ids) => fetchAllPages(() => buildQuery(ids))));
  return results.flat();
}

// Older senders only logged confirmations to agent_logs (see
// markConfirmationMessages in confirmation-messages.js). The log must name one
// of these open threads, and a workspace-tagged log must be ours.
async function fetchLoggedConfirmationIds(serviceClient, workspaceId, threadIds, since) {
  const threadSet = new Set(threadIds);
  const logs = await fetchAllPages(() =>
    serviceClient
      .from("agent_logs")
      .select("workspace_id, step_detail")
      .eq("step_name", "postmark_inbound_auto_reply_sent")
      .eq("status", "success")
      .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
      .gte("created_at", since)
      .order("created_at", { ascending: true }));
  const ids = [];
  for (const log of logs) {
    if (log.workspace_id && log.workspace_id !== workspaceId) continue;
    try {
      const detail = typeof log.step_detail === "string" ? JSON.parse(log.step_detail) : log.step_detail;
      if (detail?.sentMessageId && threadSet.has(detail.threadId)) ids.push(detail.sentMessageId);
    } catch {
      /* Invalid legacy log entries are not delivery evidence. */
    }
  }
  return ids;
}

export function fetchThreadMessages(serviceClient, scope, threadIds) {
  return fetchByThreadIds(threadIds, (ids) =>
    applyScope(
      serviceClient.from("mail_messages").select(MESSAGE_COLUMNS).in("thread_id", ids).order("id", { ascending: true }),
      scope,
    ));
}

// Provider ids of confirmation emails in these threads: their sent event, or
// for older senders their delivery log. Without a workspace there is nothing to
// match, and missing tables must not break the dashboard.
export async function loadConfirmationMessageIds(serviceClient, scope, threadIds, since) {
  if (!scope?.workspaceId || !threadIds.length) return [];
  const [events, logged] = await Promise.all([
    fetchByThreadIds(threadIds, (ids) =>
      serviceClient
        .from("mail_auto_reply_events")
        .select("sent_message_id")
        .eq("workspace_id", scope.workspaceId)
        .in("thread_id", ids)
        .order("sent_message_id", { ascending: true })).catch(() => []),
    fetchLoggedConfirmationIds(serviceClient, scope.workspaceId, threadIds, since).catch(() => []),
  ]);
  return [...events.map((row) => row.sent_message_id), ...logged];
}

export async function loadDashboardQueue(serviceClient, scope, { now = new Date() } = {}) {
  const threads = await fetchAllPages(() =>
    applyScope(
      serviceClient
        .from("mail_threads")
        .select(THREAD_COLUMNS)
        .or("status.not.in.(solved,resolved,closed,Solved,Resolved,Closed),close_pending.eq.true")
        .order("id", { ascending: true }),
      scope,
    ));
  const threadIds = threads.map((thread) => thread.id).filter(Boolean);
  if (!threadIds.length) return buildDashboardQueue({ threads: [], now });

  const oldestThread = threads.reduce((min, thread) => (thread.created_at && thread.created_at < min ? thread.created_at : min), new Date(now).toISOString());

  const [messages, actions, confirmationIds] = await Promise.all([
    fetchThreadMessages(serviceClient, scope, threadIds),
    fetchByThreadIds(threadIds, (ids) =>
      applyScope(
        serviceClient
          .from("thread_actions")
          .select("thread_id, action_type, status, created_at")
          .in("thread_id", ids)
          .in("status", APPROVAL_STATUSES)
          .order("id", { ascending: true }),
        scope,
      )),
    loadConfirmationMessageIds(serviceClient, scope, threadIds, oldestThread),
  ]);

  return buildDashboardQueue({
    threads,
    messages,
    actions,
    autoReplyMessageIds: confirmationIds,
    now,
  });
}
