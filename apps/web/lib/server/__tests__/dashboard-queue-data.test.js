import { describe, expect, it } from "vitest";
import { loadDashboardQueue } from "../dashboard-queue-data.js";

const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

// Minimal supabase-js stand-in: records every query and serves the matching
// rows for the requested page.
function fakeClient(tables, { failTables = [] } = {}) {
  const calls = [];
  function from(table) {
    const state = { table, filters: [], eqs: [], range: null };
    const builder = {
      select() { return builder; },
      order() { return builder; },
      or(expression) {
        state.or = expression;
        state.filters.push((row) => row.close_pending === true || !["solved", "resolved", "closed"].includes(String(row.status).toLowerCase()));
        return builder;
      },
      gte(column, value) { state.filters.push((row) => !row[column] || row[column] >= value); return builder; },
      eq(column, value) { state.eqs.push([column, value]); state.filters.push((row) => row[column] === value); return builder; },
      in(column, values) { state.filters.push((row) => values.includes(row[column])); return builder; },
      range(start, end) { state.range = [start, end]; return builder; },
      then(resolve, reject) {
        calls.push(state);
        if (failTables.includes(table)) return Promise.resolve({ data: null, error: { message: "relation does not exist" } }).then(resolve, reject);
        let rows = (tables[table] || []).filter((row) => state.filters.every((test) => test(row)));
        if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }
  return { from, calls };
}

const scope = { workspaceId: "ws-1" };

function openThread(i, overrides = {}) {
  return {
    id: `t-${String(i).padStart(5, "0")}`, workspace_id: "ws-1", ticket_number: i, subject: `S${i}`,
    status: "needs_attention", classification_key: "support", close_pending: false, created_at: hoursAgo(10), ...overrides,
  };
}

describe("loadDashboardQueue", () => {
  it("pages through open threads and keeps every query inside the workspace", async () => {
    const threads = [
      ...Array.from({ length: 1200 }, (_, i) => openThread(i)),
      openThread(5000, { workspace_id: "ws-2" }),
      openThread(5001, { status: "resolved" }),
    ];
    const messages = threads.map((row) => ({ thread_id: row.id, workspace_id: row.workspace_id, from_me: false, is_draft: false, received_at: hoursAgo(2) }));
    const client = fakeClient({ mail_threads: threads, mail_messages: messages, thread_actions: [], mail_auto_reply_events: [] });

    const queue = await loadDashboardQueue(client, scope, { now: NOW });

    expect(queue.flow.needsReply.count).toBe(1200);
    const threadCalls = client.calls.filter((call) => call.table === "mail_threads");
    expect(threadCalls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    for (const call of client.calls) {
      if (call.table === "agent_logs") expect(call.or).toContain("workspace_id.eq.ws-1");
      else expect(call.eqs).toContainEqual(["workspace_id", "ws-1"]);
    }
  });

  it("treats a confirmation email as no reply, using its sent event", async () => {
    const client = fakeClient({
      mail_threads: [openThread(1)],
      mail_messages: [
        { thread_id: "t-00001", workspace_id: "ws-1", from_me: false, is_draft: false, received_at: hoursAgo(3) },
        { thread_id: "t-00001", workspace_id: "ws-1", from_me: true, is_draft: false, sent_at: hoursAgo(3), provider_message_id: "pm-1" },
      ],
      thread_actions: [],
      mail_auto_reply_events: [{ workspace_id: "ws-1", thread_id: "t-00001", sent_message_id: "pm-1" }],
    });

    const queue = await loadDashboardQueue(client, scope, { now: NOW });
    expect(queue.flow.needsReply.count).toBe(1);
  });

  it("falls back to confirmation logs for older senders, ignoring other workspaces", async () => {
    const log = (workspaceId, threadId, sentMessageId) => ({
      workspace_id: workspaceId, step_name: "postmark_inbound_auto_reply_sent", status: "success", created_at: hoursAgo(3),
      step_detail: JSON.stringify({ threadId, sentMessageId }),
    });
    const conversation = (threadId, providerId) => [
      { thread_id: threadId, workspace_id: "ws-1", from_me: false, is_draft: false, received_at: hoursAgo(3) },
      { thread_id: threadId, workspace_id: "ws-1", from_me: true, is_draft: false, sent_at: hoursAgo(3), provider_message_id: providerId },
    ];
    const client = fakeClient({
      mail_threads: [openThread(1), openThread(2), openThread(3)],
      mail_messages: [...conversation("t-00001", "pm-1"), ...conversation("t-00002", "pm-2"), ...conversation("t-00003", "pm-3")],
      thread_actions: [],
      mail_auto_reply_events: [],
      agent_logs: [log("ws-1", "t-00001", "pm-1"), log(null, "t-00002", "pm-2"), log("ws-2", "t-00003", "pm-3"), { ...log("ws-1", "t-00003", "x"), step_detail: "not json" }],
    });

    const queue = await loadDashboardQueue(client, scope, { now: NOW });
    // t1 and t2 only got confirmations. t3's log belongs to another workspace,
    // so its outbound message counts as a real reply.
    expect(queue.upNext.map((row) => row.id).sort()).toEqual(["t-00001", "t-00002"]);
  });

  it("still loads when the confirmation event table is unavailable", async () => {
    const client = fakeClient(
      { mail_threads: [openThread(1)], mail_messages: [{ thread_id: "t-00001", workspace_id: "ws-1", from_me: false, is_draft: false, received_at: hoursAgo(3) }], thread_actions: [] },
      { failTables: ["mail_auto_reply_events"] },
    );
    const queue = await loadDashboardQueue(client, scope, { now: NOW });
    expect(queue.flow.needsReply.count).toBe(1);
  });

  it("returns an empty queue without further queries when nothing is open", async () => {
    const client = fakeClient({ mail_threads: [openThread(1, { status: "resolved" })] });
    const queue = await loadDashboardQueue(client, scope, { now: NOW });
    expect(queue.openTotal).toBe(0);
    expect(client.calls.map((call) => call.table)).toEqual(["mail_threads"]);
  });
});
