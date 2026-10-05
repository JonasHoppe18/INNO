import { describe, expect, it, vi } from "vitest";
import { markConfirmationMessages } from "../confirmation-messages";

function fixture(events, error = null) {
  const filters = [];
  const query = {
    select: vi.fn(() => query),
    eq: (key, value) => {
      filters.push([key, value]);
      return query;
    },
    in: (key, value) => {
      filters.push([key, value]);
      return query;
    },
    then: (resolve) => Promise.resolve({ data: events, error }).then(resolve),
  };
  return {
    client: {
      from: vi.fn((table) =>
        table === "agent_logs"
          ? {
              select() {
                return this;
              },
              eq() {
                return this;
              },
              or() {
                return this;
              },
              like() {
                return this;
              },
              limit: async () => ({ data: [], error: null }),
            }
          : query,
      ),
    },
    filters,
  };
}
const scope = {
  workspaceId: "workspace-a",
  threadId: "thread-a",
  mailboxIds: ["mail-a"],
};
const message = {
  id: "message-a",
  from_me: true,
  mailbox_id: "mail-a",
  thread_id: "thread-a",
  provider_message_id: "provider-a",
};
const event = {
  mailbox_id: "mail-a",
  thread_id: "thread-a",
  sent_message_id: "provider-a",
  sent_at: "2026-10-05T12:00:00Z",
};

describe("confirmation sent markers", () => {
  it("requires an actual sent event and scopes reads to workspace, mailbox and thread", async () => {
    const { client, filters } = fixture([event]);
    expect(
      (await markConfirmationMessages(client, [message], scope))[0]
        .confirmation_sent_at,
    ).toBe(event.sent_at);
    expect(filters).toEqual([
      ["workspace_id", "workspace-a"],
      ["thread_id", "thread-a"],
      ["mailbox_id", ["mail-a"]],
      ["sent_message_id", ["provider-a"]],
    ]);
  });
  it("never labels drafts, inbound messages or events from another thread/mailbox", async () => {
    for (const changed of [
      { sent_at: null },
      { thread_id: "other" },
      { mailbox_id: "other" },
      { sent_message_id: "other" },
    ]) {
      const { client } = fixture([{ ...event, ...changed }]);
      expect(await markConfirmationMessages(client, [message], scope)).toEqual([
        message,
      ]);
    }
    for (const changed of [{ from_me: false }, { is_draft: true }]) {
      const { client } = fixture([event]);
      const row = { ...message, ...changed };
      expect(await markConfirmationMessages(client, [row], scope)).toEqual([
        row,
      ]);
      expect(client.from).not.toHaveBeenCalled();
    }
  });
  it("keeps normal messages available when confirmation metadata cannot be read", async () => {
    const { client } = fixture(null, { message: "Unavailable" });
    expect(await markConfirmationMessages(client, [message], scope)).toEqual([
      message,
    ]);
    expect(
      await markConfirmationMessages(client, [message], {
        ...scope,
        workspaceId: null,
      }),
    ).toEqual([message]);
  });
});

describe("legacy confirmation delivery logs", () => {
  it("collapses only a successful sender log matching the authorized thread and provider ID", async () => {
    const log = {
      workspace_id: null,
      created_at: event.sent_at,
      step_detail: JSON.stringify({
        threadId: message.thread_id,
        sentMessageId: message.provider_message_id,
      }),
    };
    const filters = [];
    const logQuery = {
      select() {
        return this;
      },
      eq(key, value) {
        filters.push([key, value]);
        return this;
      },
      or(value) {
        filters.push(["or", value]);
        return this;
      },
      like(key, value) {
        filters.push([key, value]);
        return this;
      },
      limit: async () => ({ data: [log], error: null }),
    };
    const { client } = fixture([]);
    const original = client.from;
    client.from = (table) =>
      table === "agent_logs" ? logQuery : original(table);
    expect(
      (await markConfirmationMessages(client, [message], scope))[0]
        .confirmation_sent_at,
    ).toBe(event.sent_at);
    expect(filters).toContainEqual([
      "step_name",
      "postmark_inbound_auto_reply_sent",
    ]);
    expect(filters).toContainEqual(["status", "success"]);
    expect(filters).toContainEqual(["step_detail", '%"threadId":"thread-a"%']);
    for (const change of [
      { workspace_id: "foreign" },
      { step_detail: "invalid" },
      {
        step_detail: JSON.stringify({
          threadId: "foreign",
          sentMessageId: message.provider_message_id,
        }),
      },
      {
        step_detail: JSON.stringify({
          threadId: message.thread_id,
          sentMessageId: "other",
        }),
      },
    ]) {
      const modified = { ...log, ...change };
      logQuery.limit = async () => ({ data: [modified], error: null });
      expect(await markConfirmationMessages(client, [message], scope)).toEqual([
        message,
      ]);
    }
  });
});
