// Dashboard ticket flow and Up next. Pure: the loader in dashboard-queue-data.js
// fetches the rows, this module decides which stage each open ticket is in.
//
// Stages, in the order a ticket moves through them:
//   needsReply       the customer wrote last and no Sona reply is ready
//   repliesReady     the customer wrote last and their latest message has a Sona draft
//   awaitingApproval an action (refund, address change, ...) waits for approval
//   waiting          waiting on the customer or a third party
// A reply means a human reply: automatic confirmation emails do not count.

const HOUR_MS = 60 * 60 * 1000;
const OVERDUE_HOURS = 24;
const UP_NEXT_LIMIT = 5;
const CLOSED_STATUSES = new Set(["solved", "resolved", "closed"]);
const WAITING_STATUSES = new Set(["waiting_customer", "waiting_third_party"]);
const APPROVAL_STATUSES = new Set(["pending", "awaiting_approval", "requires_approval"]);

function timeOf(message) {
  const value = Date.parse(message?.received_at || message?.sent_at || message?.created_at || "");
  return Number.isFinite(value) ? value : null;
}

function isOpen(thread) {
  if (thread?.close_pending === true) return true;
  return !CLOSED_STATUSES.has(String(thread?.status || "").trim().toLowerCase());
}

function isNotification(thread) {
  return String(thread?.classification_key || "").trim().toLowerCase() === "notification";
}

function hoursBetween(fromMs, toMs) {
  return Math.max(0, Math.floor((toMs - fromMs) / HOUR_MS));
}

export function buildDashboardQueue({ threads = [], messages = [], actions = [], autoReplyMessageIds = [], now = new Date() }) {
  const nowMs = new Date(now).getTime();
  const autoReplies = new Set(autoReplyMessageIds.filter(Boolean));

  const latestInbound = new Map();
  const latestHumanReply = new Map();
  for (const message of messages) {
    if (message?.is_draft) continue;
    const at = timeOf(message);
    if (at == null) continue;
    if (message.from_me) {
      if (message.provider_message_id && autoReplies.has(message.provider_message_id)) continue;
      if (at > (latestHumanReply.get(message.thread_id) ?? -Infinity)) latestHumanReply.set(message.thread_id, at);
    } else if (at > (latestInbound.get(message.thread_id)?.at ?? -Infinity)) {
      latestInbound.set(message.thread_id, { at, hasDraft: Boolean(message.ai_draft_text) });
    }
  }

  const approvalsByThread = new Map();
  for (const action of actions) {
    if (!APPROVAL_STATUSES.has(String(action?.status || "").trim().toLowerCase())) continue;
    if (!approvalsByThread.has(action.thread_id)) approvalsByThread.set(action.thread_id, []);
    approvalsByThread.get(action.thread_id).push(action);
  }

  const flow = {
    needsReply: { count: 0, overdue: 0, oldestHours: null },
    repliesReady: { count: 0, oldestHours: null },
    awaitingApproval: { count: 0, actionTypes: {}, oldestHours: null },
    waiting: { count: 0, oldestHours: null },
  };
  const rows = [];
  const trackOldest = (bucket, hours) => {
    if (hours != null && (bucket.oldestHours == null || hours > bucket.oldestHours)) bucket.oldestHours = hours;
  };

  for (const thread of threads) {
    if (!isOpen(thread) || isNotification(thread)) continue;
    const status = String(thread.status || "").trim().toLowerCase();
    const approvals = approvalsByThread.get(thread.id);

    if (approvals?.length) {
      const since = Math.min(...approvals.map((action) => Date.parse(action.created_at) || nowMs));
      const hours = hoursBetween(since, nowMs);
      flow.awaitingApproval.count += 1;
      trackOldest(flow.awaitingApproval, hours);
      for (const action of approvals) {
        const type = action.action_type || "other";
        flow.awaitingApproval.actionTypes[type] = (flow.awaitingApproval.actionTypes[type] || 0) + 1;
      }
      rows.push({ thread, stage: "approval", waitedHours: hours });
      continue;
    }

    if (WAITING_STATUSES.has(status) && thread.close_pending !== true) {
      const since = Date.parse(thread.status_changed_at || thread.created_at || "");
      flow.waiting.count += 1;
      trackOldest(flow.waiting, Number.isFinite(since) ? hoursBetween(since, nowMs) : null);
      continue;
    }

    const inbound = latestInbound.get(thread.id);
    if (!inbound) continue;
    const repliedAfter = (latestHumanReply.get(thread.id) ?? -Infinity) >= inbound.at;
    if (repliedAfter && thread.close_pending !== true) continue;

    const hours = hoursBetween(inbound.at, nowMs);
    if (inbound.hasDraft) {
      flow.repliesReady.count += 1;
      trackOldest(flow.repliesReady, hours);
      rows.push({ thread, stage: "replyReady", waitedHours: hours });
    } else {
      flow.needsReply.count += 1;
      if (hours >= OVERDUE_HOURS) flow.needsReply.overdue += 1;
      trackOldest(flow.needsReply, hours);
      rows.push({ thread, stage: "needsReply", waitedHours: hours });
    }
  }

  const upNext = rows
    .sort((a, b) => b.waitedHours - a.waitedHours || String(a.thread.id).localeCompare(String(b.thread.id)))
    .slice(0, UP_NEXT_LIMIT)
    .map(({ thread, stage, waitedHours }) => ({
      id: thread.id,
      ticketNumber: thread.ticket_number ?? null,
      subject: thread.subject || null,
      customer: thread.customer_name || thread.customer_email || null,
      customerName: thread.customer_name || null,
      customerEmail: thread.customer_email || null,
      stage,
      waitedHours,
      url: `/inbox?thread=${encodeURIComponent(thread.id)}`,
    }));

  return {
    flow,
    openTotal: flow.needsReply.count + flow.repliesReady.count + flow.awaitingApproval.count + flow.waiting.count,
    upNext,
  };
}
