import { describe, expect, it } from "vitest";
import { buildDashboardQueue } from "../dashboard-queue.js";

const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

function thread(id, overrides = {}) {
  return {
    id,
    ticket_number: Number(id.replace(/\D/g, "")) || null,
    subject: `Subject ${id}`,
    customer_name: `Customer ${id}`,
    customer_email: `${id}@example.com`,
    status: "needs_attention",
    classification_key: "support",
    close_pending: false,
    status_changed_at: hoursAgo(1),
    created_at: hoursAgo(30),
    ...overrides,
  };
}

const inbound = (threadId, hours, { draft = false } = {}) => ({
  thread_id: threadId, from_me: false, is_draft: false, received_at: hoursAgo(hours), ai_draft_text: draft ? "Hi!" : null,
});
const outbound = (threadId, hours, providerId = `${threadId}-out-${hours}`) => ({
  thread_id: threadId, from_me: true, is_draft: false, sent_at: hoursAgo(hours), provider_message_id: providerId,
});

describe("buildDashboardQueue", () => {
  it("sorts open tickets into the four flow stages", () => {
    const queue = buildDashboardQueue({
      now: NOW,
      threads: [
        thread("t1"),
        thread("t2"),
        thread("t3"),
        thread("t4", { status: "waiting_customer", status_changed_at: hoursAgo(72) }),
        thread("t5", { status: "waiting_third_party", status_changed_at: hoursAgo(5) }),
      ],
      messages: [inbound("t1", 26), inbound("t2", 2, { draft: true }), inbound("t3", 1)],
      actions: [{ thread_id: "t3", action_type: "refund_order", status: "pending", created_at: hoursAgo(1) }],
    });

    expect(queue.flow.needsReply).toMatchObject({ count: 1, overdue: 1 });
    expect(queue.flow.repliesReady).toMatchObject({ count: 1, oldestHours: 2 });
    expect(queue.flow.awaitingApproval).toMatchObject({ count: 1, actionTypes: { refund_order: 1 } });
    expect(queue.flow.waiting).toMatchObject({ count: 2, oldestHours: 72 });
    expect(queue.openTotal).toBe(5);
  });

  it("does not count a confirmation email as a reply", () => {
    const queue = buildDashboardQueue({
      now: NOW,
      threads: [thread("t1"), thread("t2")],
      messages: [
        inbound("t1", 3), outbound("t1", 3, "auto-1"),
        inbound("t2", 3), outbound("t2", 2, "human-1"),
      ],
      autoReplyMessageIds: ["auto-1"],
      actions: [],
    });

    // t1 only got the automatic confirmation, so it still needs a reply.
    // t2 got a real reply after the customer wrote, so it is not waiting on us.
    expect(queue.flow.needsReply.count).toBe(1);
    expect(queue.upNext.map((row) => row.id)).toEqual(["t1"]);
  });

  it("only offers a reply as ready when the draft answers the latest message", () => {
    const queue = buildDashboardQueue({
      now: NOW,
      threads: [thread("t1")],
      messages: [inbound("t1", 5, { draft: true }), inbound("t1", 1)],
      actions: [],
    });
    expect(queue.flow.repliesReady.count).toBe(0);
    expect(queue.flow.needsReply.count).toBe(1);
  });

  it("leaves out solved tickets, notifications and tickets we already answered", () => {
    const queue = buildDashboardQueue({
      now: NOW,
      threads: [
        thread("t1", { status: "resolved" }),
        thread("t2", { classification_key: "notification" }),
        thread("t3"),
      ],
      messages: [inbound("t1", 2), inbound("t2", 2), inbound("t3", 4), outbound("t3", 1)],
      actions: [],
    });
    expect(queue.openTotal).toBe(0);
    expect(queue.upNext).toEqual([]);
  });

  it("puts tickets in Up next by how long the customer has waited", () => {
    const queue = buildDashboardQueue({
      now: NOW,
      threads: [thread("t1"), thread("t2"), thread("t3"), thread("t4", { status: "waiting_customer" })],
      messages: [inbound("t1", 2), inbound("t2", 26, { draft: true }), inbound("t3", 9), inbound("t4", 50)],
      actions: [{ thread_id: "t3", action_type: "update_shipping_address", status: "awaiting_approval", created_at: hoursAgo(9) }],
    });

    expect(queue.upNext.map((row) => [row.id, row.stage, row.waitedHours])).toEqual([
      ["t2", "replyReady", 26],
      ["t3", "approval", 9],
      ["t1", "needsReply", 2],
    ]);
    expect(queue.upNext[0]).toMatchObject({ ticketNumber: 2, customer: "Customer t2", url: "/inbox?thread=t2" });
  });

  it("keeps a closed-pending ticket in the queue like the inbox does", () => {
    const queue = buildDashboardQueue({
      now: NOW,
      threads: [thread("t1", { status: "resolved", close_pending: true })],
      messages: [inbound("t1", 1)],
      actions: [],
    });
    expect(queue.flow.needsReply.count).toBe(1);
  });
});
