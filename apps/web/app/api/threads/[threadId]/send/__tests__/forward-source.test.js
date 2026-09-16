import { describe, expect, it } from "vitest";
import { loadAuthorizedForwardSource } from "@/lib/server/forward-email";

function createQuery(rows, calls) {
  const filters = [];
  const builder = {
    select: () => builder,
    eq: (field, value) => {
      filters.push([field, value]);
      calls.push([field, value]);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    then: (resolve, reject) => {
      const filtered = rows.filter((row) =>
        filters.every(([field, value]) => row?.[field] === value),
      );
      return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

describe("authorized manual forward source lookup", () => {
  it("requires exact workspace, user, mailbox, and thread scope before loading attachments", async () => {
    const calls = [];
    const source = {
      id: "message-a",
      user_id: "user-a",
      mailbox_id: "mailbox-a",
      thread_id: "thread-a",
      workspace_id: "workspace-a",
      from_me: false,
      subject: "Original request",
      body_text: "See attachment",
      body_html: "<p>See attachment</p>",
      from_name: "Customer",
      from_email: "customer@example.com",
      to_emails: ["support@example.com"],
      cc_emails: [],
      received_at: "2026-09-16T08:00:00Z",
    };
    const attachment = {
      id: "attachment-a",
      user_id: "user-a",
      mailbox_id: "mailbox-a",
      message_id: "message-a",
      filename: "invoice.pdf",
      mime_type: "application/pdf",
      size_bytes: 9,
      storage_path: "inline:application/pdf;base64,JVBERi0xLjQK",
    };
    const client = {
      from: (table) =>
        table === "mail_messages"
          ? createQuery([source], calls)
          : createQuery([attachment], calls),
    };
    const result = await loadAuthorizedForwardSource(
      client,
      { workspaceId: "workspace-a", supabaseUserId: "user-a" },
      { id: "thread-a", workspace_id: "workspace-a", mailbox_id: "mailbox-a" },
      { id: "mailbox-a", user_id: "user-a", workspace_id: "workspace-a" },
      "message-a",
    );

    expect(result.source.id).toBe("message-a");
    expect(result.attachments[0]).toMatchObject({
      filename: "invoice.pdf",
      mime_type: "application/pdf",
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        ["workspace_id", "workspace-a"],
        ["user_id", "user-a"],
        ["mailbox_id", "mailbox-a"],
        ["thread_id", "thread-a"],
        ["message_id", "message-a"],
      ]),
    );
  });

  it("rejects a source message from another thread even when its ID is supplied", async () => {
    const source = {
      id: "message-b",
      user_id: "user-a",
      mailbox_id: "mailbox-a",
      thread_id: "thread-b",
      workspace_id: "workspace-a",
      from_me: false,
    };
    const client = {
      from: () => createQuery([source], []),
    };

    await expect(
      loadAuthorizedForwardSource(
        client,
        { workspaceId: "workspace-a", supabaseUserId: "user-a" },
        { id: "thread-a", workspace_id: "workspace-a", mailbox_id: "mailbox-a" },
        { id: "mailbox-a", user_id: "user-a", workspace_id: "workspace-a" },
        "message-b",
      ),
    ).rejects.toThrow(/original inbound message/i);
  });
});
