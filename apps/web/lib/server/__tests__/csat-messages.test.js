import { describe, expect, it, vi } from "vitest";
import { markCsatSentEvent } from "../csat-messages";
const scope = {
  workspaceId: "workspace-a",
  threadId: "thread-a",
  mailboxIds: ["mail-a"],
};
const row = {
  id: "message-a",
  thread_id: "thread-a",
  mailbox_id: "mail-a",
  created_at: "2026-10-05T10:00:00Z",
};
const sent = {
  id: "survey-a",
  workspace_id: "workspace-a",
  thread_id: "thread-a",
  status: "sent",
  sent_at: "2026-10-05T11:00:00Z",
};
function fixture(event = sent, error = null) {
  const filters = [];
  const query = {
    select: () => query,
    eq: (key, value) => {
      filters.push([key, value]);
      return query;
    },
    in: (key, value) => {
      filters.push([key, value]);
      return query;
    },
    maybeSingle: async () => ({ data: event, error }),
  };
  return { client: { from: vi.fn(() => query) }, filters };
}
describe("CSAT sent markers", () => {
  it("reads only sent or responded requests in the authorized workspace and thread", async () => {
    for (const status of ["sent", "responded"]) {
      const { client, filters } = fixture({ ...sent, status });
      const messages = await markCsatSentEvent(client, [row], scope);
      expect(messages[0].csat_sent_event).toEqual({
        id: sent.id,
        sent_at: sent.sent_at,
      });
      expect(filters).toEqual([
        ["workspace_id", "workspace-a"],
        ["thread_id", "thread-a"],
        ["status", ["sent", "responded"]],
      ]);
    }
  });
  it("places one notice chronologically without adding a message or changing reply targets", async () => {
    const rows = [
      row,
      { ...row, id: "later", created_at: "2026-10-05T12:00:00Z" },
      {
        ...row,
        id: "draft",
        is_draft: true,
        created_at: "2026-10-05T10:59:00Z",
      },
    ];
    const { client } = fixture();
    const result = await markCsatSentEvent(client, rows, scope);
    expect(result).toHaveLength(rows.length);
    expect(result.map((message) => message.id)).toEqual(
      rows.map((message) => message.id),
    );
    expect(
      result
        .filter((message) => message.csat_sent_event)
        .map((message) => message.id),
    ).toEqual([row.id]);
    expect(result[1]).toBe(rows[1]);
    expect(result[2]).toBe(rows[2]);
  });
  it("never reports pending, failed, unsent or foreign requests as sent", async () => {
    for (const changed of [
      { status: "pending" },
      { status: "sending" },
      { status: "failed" },
      { status: "skipped" },
      { sent_at: null },
      { sent_at: "invalid" },
      { workspace_id: "other" },
      { thread_id: "other" },
    ]) {
      const { client } = fixture({ ...sent, ...changed });
      expect(await markCsatSentEvent(client, [row], scope)).toEqual([row]);
    }
    const { client } = fixture(null, { message: "Unavailable" });
    expect(await markCsatSentEvent(client, [row], scope)).toEqual([row]);
  });
  it("does not query a survey for empty, draft-only or unauthorized mailbox messages", async () => {
    const { client } = fixture();
    for (const rows of [
      [],
      [{ ...row, mailbox_id: "foreign" }],
      [{ ...row, is_draft: true }],
    ]) {
      expect(await markCsatSentEvent(client, rows, scope)).toEqual(rows);
    }
    expect(client.from).not.toHaveBeenCalled();
  });
});
