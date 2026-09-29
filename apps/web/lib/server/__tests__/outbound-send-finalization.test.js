import { describe, expect, it } from "vitest";
import {
  buildOutboundAttachmentKey,
  buildOutboundAttachmentRows,
  persistOutboundAttachments,
  persistOutboundConversationMessage,
} from "../outbound-send-finalization.js";
import { buildAgentReplyStatusPatch } from "../../inbox/status-model.js";

const userId = "99999999-9999-4999-8999-999999999999";
const mailboxId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const threadId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

class FakeQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = [];
    this.operation = "select";
    this.payload = null;
  }

  select() {
    return this;
  }

  eq(column, value) {
    this.filters.push({ column, operator: "eq", value });
    return this;
  }

  not(column, operator, value) {
    this.filters.push({ column, operator: "not", comparison: operator, value });
    return this;
  }

  insert(payload) {
    this.operation = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(payload) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  limit() {
    return this;
  }

  matches(row) {
    return this.filters.every((filter) => {
      if (filter.operator === "eq") return row[filter.column] === filter.value;
      if (filter.operator === "not" && filter.comparison === "is") {
        return row[filter.column] !== filter.value;
      }
      return true;
    });
  }

  async execute() {
    const rows = this.client.rows[this.table];
    if (!rows) throw new Error(`Unexpected table ${this.table}`);

    if (this.operation === "insert") {
      for (const candidate of this.payload) {
        const duplicateMessage =
          this.table === "mail_messages" &&
          rows.some(
            (row) =>
              row.mailbox_id === candidate.mailbox_id &&
              row.provider === candidate.provider &&
              row.provider_message_id === candidate.provider_message_id,
          );
        const duplicateAttachment =
          this.table === "mail_attachments" &&
          rows.some(
            (row) =>
              row.message_id === candidate.message_id &&
              row.attachment_key === candidate.attachment_key,
          );
        if (duplicateMessage || duplicateAttachment) {
          return { data: null, error: { code: "23505", message: "unique violation" } };
        }
      }
      rows.push(...this.payload.map((row) => ({ ...row })));
      return { data: this.payload.length === 1 ? { ...this.payload[0] } : this.payload, error: null };
    }

    if (this.operation === "update") {
      const row = rows.find((candidate) => this.matches(candidate));
      if (!row) return { data: null, error: null };
      Object.assign(row, this.payload);
      return { data: { ...row }, error: null };
    }

    if (this.operation === "delete") {
      const remaining = rows.filter((candidate) => !this.matches(candidate));
      this.client.rows[this.table] = remaining;
      return { data: null, error: null };
    }

    return {
      data: rows.filter((candidate) => this.matches(candidate)).map((row) => ({ ...row })),
      error: null,
    };
  }

  async maybeSingle() {
    const result = await this.execute();
    if (Array.isArray(result.data)) {
      return { data: result.data[0] || null, error: result.error };
    }
    return result;
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

function createClient() {
  return {
    rows: { mail_messages: [], mail_attachments: [] },
    from(table) {
      return new FakeQuery(this, table);
    },
  };
}

const scope = { workspaceId, supabaseUserId: userId };
const mailbox = { id: mailboxId, provider: "smtp" };

function messageInput(providerMessageId = "postmark-1") {
  return {
    serviceClient: null,
    scope,
    draftMessage: null,
    userId,
    mailbox,
    threadId,
    subject: "Re: Ticket",
    snippet: "Reply",
    persistedBodyText: "Reply",
    finalBodyHtml: "<p>Reply</p>",
    persistedBodyHtml: "<p>Reply</p>",
    sentFromName: "Support",
    sentFromEmail: "support@example.com",
    deliveryTo: ["customer@example.com"],
    deliveryCc: [],
    deliveryBcc: [],
    persistedProviderMessageId: providerMessageId,
    nowIso: "2026-09-29T12:00:00.000Z",
  };
}

describe("outbound local finalization", () => {
  it("converges after the provider message was inserted before attempt linking", async () => {
    const client = createClient();
    const input = messageInput();
    input.serviceClient = client;
    client.rows.mail_messages.push({
      id: "message-existing",
      user_id: userId,
      workspace_id: workspaceId,
      mailbox_id: mailboxId,
      thread_id: threadId,
      provider: "smtp",
      provider_message_id: "postmark-1",
      from_me: true,
      is_draft: false,
    });

    const messageId = await persistOutboundConversationMessage(input);

    expect(messageId).toBe("message-existing");
    expect(client.rows.mail_messages).toHaveLength(1);
  });

  it("makes concurrent finalizers converge on one message ID", async () => {
    const client = createClient();
    const first = messageInput();
    const second = messageInput();
    first.serviceClient = client;
    second.serviceClient = client;

    const [firstId, secondId] = await Promise.all([
      persistOutboundConversationMessage(first),
      persistOutboundConversationMessage(second),
    ]);

    expect(firstId).toBe(secondId);
    expect(client.rows.mail_messages).toHaveLength(1);
  });

  it("keeps duplicate filenames as separate deterministic attachment rows", () => {
    const attachments = [
      {
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        size_bytes: 3,
        content_base64: "YWJj",
      },
      {
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        size_bytes: 3,
        content_base64: "ZGVm",
      },
    ];
    const rows = buildOutboundAttachmentRows({
      attachments,
      userId,
      mailboxId,
      messageId: "message-1",
      provider: "smtp",
      nowIso: "2026-09-29T12:00:00.000Z",
    });

    expect(rows.map((row) => row.attachment_key)).toHaveLength(2);
    expect(rows[0].attachment_key).not.toBe(rows[1].attachment_key);
    expect(rows[0].attachment_key).toBe(buildOutboundAttachmentKey(attachments[0], 0));
  });

  it("repeated attachment finalization leaves one row per ordinal", async () => {
    const client = createClient();
    const attachments = [
      {
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        size_bytes: 3,
        content_base64: "YWJj",
      },
      {
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        size_bytes: 3,
        content_base64: "YWJj",
      },
    ];
    const input = {
      serviceClient: client,
      scope,
      attachments,
      userId,
      mailboxId,
      messageId: "message-1",
      provider: "smtp",
      nowIso: "2026-09-29T12:00:00.000Z",
    };

    await persistOutboundAttachments(input);
    await persistOutboundAttachments(input);

    expect(client.rows.mail_attachments).toHaveLength(2);
    expect(new Set(client.rows.mail_attachments.map((row) => row.attachment_key)).size).toBe(2);
  });

  it("uses the same idempotent waiting-status patch on every local retry", () => {
    const thread = { waiting_reason: "customer" };
    const first = buildAgentReplyStatusPatch(thread, "2026-09-29T12:00:00.000Z");
    const retry = buildAgentReplyStatusPatch(thread, "2026-09-29T12:00:00.000Z");

    expect(retry).toEqual(first);
    expect(retry.status).toBe("waiting_customer");
  });
});
