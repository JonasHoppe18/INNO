import { describe, expect, it } from "vitest";
import {
  buildOutboundRequestFingerprint,
  claimOutboundSendAttempt,
} from "../outbound-send-attempts.js";

const workspaceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workspaceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const mailboxId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const threadId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const attemptA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const attemptB = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function fingerprint(bodyText = "Hello") {
  return buildOutboundRequestFingerprint({
    threadId,
    mailboxId,
    provider: "smtp",
    operationType: "reply",
    subject: "Re: Ticket",
    bodyText,
    to: ["customer@example.com"],
  });
}

function createFakeServiceClient() {
  const rows = [];
  const client = {
    rows,
    from(table) {
      if (table !== "outbound_send_attempts") throw new Error(`Unexpected table: ${table}`);
      return new FakeQuery(rows);
    },
  };
  return client;
}

class FakeQuery {
  constructor(rows) {
    this.rows = rows;
    this.filters = [];
    this.operation = "select";
    this.insertRow = null;
    this.patch = null;
    this.orFilter = null;
  }

  select() {
    return this;
  }

  insert(row) {
    this.operation = "insert";
    this.insertRow = row;
    return this;
  }

  update(patch) {
    this.operation = "update";
    this.patch = patch;
    return this;
  }

  eq(column, value) {
    this.filters.push([column, value]);
    return this;
  }

  in(column, values) {
    this.filters.push([column, values]);
    return this;
  }

  or(filter) {
    this.orFilter = filter;
    return this;
  }

  limit() {
    return this;
  }

  order() {
    return this;
  }

  async maybeSingle() {
    if (this.operation === "insert") {
      const duplicate = this.rows.find((row) =>
        row.id === this.insertRow.id ||
        ((["reserved", "unknown"].includes(row.state) ||
          (row.state === "sent" && row.completed_at == null)) &&
          row.mailbox_id === this.insertRow.mailbox_id &&
          row.thread_id === this.insertRow.thread_id &&
          row.operation_type === this.insertRow.operation_type &&
          row.request_fingerprint === this.insertRow.request_fingerprint),
      );
      if (duplicate) return { data: null, error: { code: "23505", message: "unique violation" } };
      this.rows.push({ ...this.insertRow });
      return { data: { ...this.insertRow }, error: null };
    }

    const row = this.rows.find((candidate) => {
      const filtersMatch = this.filters.every(([column, value]) =>
        Array.isArray(value)
          ? value.includes(candidate[column])
          : candidate[column] === value,
      );
      const unresolvedMatch = !this.orFilter
        ? true
        : ["reserved", "unknown"].includes(candidate.state) ||
          (candidate.state === "sent" && candidate.completed_at == null);
      return filtersMatch && unresolvedMatch;
    });
    return { data: row ? { ...row } : null, error: null };
  }
}

function scope(workspaceId) {
  return { workspaceId, supabaseUserId: "99999999-9999-4999-8999-999999999999" };
}

function claim(client, id, workspaceId, requestFingerprint) {
  return claimOutboundSendAttempt({
    serviceClient: client,
    scope: scope(workspaceId),
    userId: "99999999-9999-4999-8999-999999999999",
    workspaceId,
    mailboxId,
    threadId,
    operationType: "reply",
    provider: "smtp",
    attemptId: id,
    requestFingerprint,
  });
}

describe("outbound send attempt claiming", () => {
  it("allows only one provider owner for concurrent same-attempt claims", async () => {
    const client = createFakeServiceClient();
    const [first, second] = await Promise.all([
      claim(client, attemptA, workspaceA, fingerprint()),
      claim(client, attemptA, workspaceA, fingerprint()),
    ]);

    expect([first.kind, second.kind].sort()).toEqual(["claimed", "in_progress"]);
    expect(client.rows).toHaveLength(1);
    expect([first, second].filter((result) => result.kind === "claimed")).toHaveLength(1);
  });

  it("converges different UUIDs for the same unresolved fingerprint", async () => {
    const client = createFakeServiceClient();
    const first = await claim(client, attemptA, workspaceA, fingerprint());
    const second = await claim(client, attemptB, workspaceA, fingerprint());

    expect(first.kind).toBe("claimed");
    expect(second.kind).toBe("in_progress");
    expect(client.rows).toHaveLength(1);
  });

  it("blocks remount retries after unknown and permits an edited new attempt", async () => {
    const client = createFakeServiceClient();
    const first = await claim(client, attemptA, workspaceA, fingerprint());
    client.rows[0].state = "unknown";

    const remountRetry = await claim(client, attemptB, workspaceA, fingerprint());
    const edited = await claim(client, attemptB, workspaceA, fingerprint("Edited"));

    expect(first.kind).toBe("claimed");
    expect(remountRetry.kind).toBe("unknown");
    expect(edited.kind).toBe("claimed");
    expect(client.rows).toHaveLength(2);
  });

  it("resumes local finalization for a provider-sent attempt without a second claim", async () => {
    const client = createFakeServiceClient();
    const first = await claim(client, attemptA, workspaceA, fingerprint());
    client.rows[0].state = "sent";
    client.rows[0].provider_message_id = "provider-message-1";
    client.rows[0].completed_at = null;

    const resumed = await claim(client, attemptB, workspaceA, fingerprint());

    expect(first.kind).toBe("claimed");
    expect(resumed.kind).toBe("sent");
    expect(resumed.attempt.id).toBe(attemptA);
    expect(client.rows).toHaveLength(1);
  });

  it("allows an intentional new attempt after a known provider rejection", async () => {
    const client = createFakeServiceClient();
    const first = await claim(client, attemptA, workspaceA, fingerprint());
    client.rows[0].state = "failed";
    client.rows[0].failure_class = "recipient_suppressed";

    const replacement = await claim(client, attemptB, workspaceA, fingerprint());

    expect(first.kind).toBe("claimed");
    expect(replacement.kind).toBe("claimed");
    expect(client.rows).toHaveLength(2);
  });

  it("keeps forward attachment bytes in the immutable request fingerprint", async () => {
    const first = buildOutboundRequestFingerprint({
      threadId,
      mailboxId,
      provider: "smtp",
      operationType: "forward",
      sourceMessageId: "source-message-1",
      subject: "Fwd: Invoice",
      bodyText: "See attached.",
      to: ["customer@example.com"],
      attachments: [{
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        size_bytes: 3,
        content_base64: "YWJj",
      }],
    });
    const changedBytes = buildOutboundRequestFingerprint({
      threadId,
      mailboxId,
      provider: "smtp",
      operationType: "forward",
      sourceMessageId: "source-message-1",
      subject: "Fwd: Invoice",
      bodyText: "See attached.",
      to: ["customer@example.com"],
      attachments: [{
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        size_bytes: 3,
        content_base64: "ZGVm",
      }],
    });

    expect(changedBytes).not.toBe(first);
  });

  it("does not reveal or reuse another workspace's attempt", async () => {
    const client = createFakeServiceClient();
    await claim(client, attemptA, workspaceA, fingerprint());

    await expect(claim(client, attemptA, workspaceB, fingerprint())).rejects.toThrow(
      /existing outbound send attempt safely/i,
    );
  });
});
