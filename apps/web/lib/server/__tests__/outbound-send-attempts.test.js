import { describe, expect, it } from "vitest";
import {
  buildOutboundRequestFingerprint,
  buildDeterministicOutboundAttemptId,
  claimOutboundSendAttempt,
  recoverStaleOutboundSendAttempt,
  OUTBOUND_SEND_ATTEMPT_STALE_AFTER_MS,
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

  lt(column, value) {
    this.filters.push([column, { operator: "lt", value }]);
    return this;
  }

  is(column, value) {
    this.filters.push([column, { operator: "is", value }]);
    return this;
  }

  not(column, operator, value) {
    this.filters.push([column, { kind: "not", operator, value }]);
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

    if (this.operation === "update") {
      const row = this.rows.find((candidate) => this.matches(candidate));
      if (!row) return { data: null, error: null };
      Object.assign(row, this.patch);
      return { data: { ...row }, error: null };
    }

    const row = this.rows.find((candidate) => {
      const filtersMatch = this.matches(candidate);
      const unresolvedMatch = !this.orFilter
        ? true
        : ["reserved", "unknown"].includes(candidate.state) ||
          (candidate.state === "sent" && candidate.completed_at == null);
      return filtersMatch && unresolvedMatch;
    });
    return { data: row ? { ...row } : null, error: null };
  }

  matches(candidate) {
    return this.filters.every(([column, value]) => {
      if (Array.isArray(value)) return value.includes(candidate[column]);
      if (!value || typeof value !== "object") return candidate[column] === value;
      if (value.kind === "not" && value.operator === "is") {
        return candidate[column] !== value.value;
      }
      if (value.operator === "lt") return String(candidate[column]) < String(value.value);
      if (value.operator === "is") return candidate[column] === value.value;
      return true;
    });
  }
}

function scope(workspaceId) {
  return { workspaceId, supabaseUserId: "99999999-9999-4999-8999-999999999999" };
}

function claim(client, id, workspaceId, requestFingerprint, options = {}) {
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
    ...options,
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

  it("reclaims a failed per-recipient attempt atomically for an intentional retry", async () => {
    const client = createFakeServiceClient();
    const requestFingerprint = fingerprint();
    const first = await claim(client, attemptA, workspaceA, requestFingerprint);
    client.rows[0].state = "failed";

    const [retry, concurrentRetry] = await Promise.all([
      claim(client, attemptA, workspaceA, requestFingerprint, { allowFailedRetry: true }),
      claim(client, attemptA, workspaceA, requestFingerprint, { allowFailedRetry: true }),
    ]);

    expect(first.kind).toBe("claimed");
    expect([retry.kind, concurrentRetry.kind].sort()).toEqual(["claimed", "in_progress"]);
    expect(client.rows).toHaveLength(1);
  });

  it("derives a stable distinct UUID for each canonical recipient request", () => {
    const first = buildDeterministicOutboundAttemptId(fingerprint());
    const same = buildDeterministicOutboundAttemptId(fingerprint());
    const changed = buildDeterministicOutboundAttemptId(fingerprint("Different recipient"));

    expect(first).toBe(same);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("gives each recipient an independent canonical fingerprint", () => {
    const base = {
      threadId,
      mailboxId,
      provider: "smtp",
      operationType: "forward",
      sourceMessageId: "source-message-1",
      subject: "Fwd: Original",
      bodyText: "See below.",
      attachments: [{
        filename: "original.pdf",
        mime_type: "application/pdf",
        size_bytes: 3,
        content_base64: "YWJj",
      }],
    };

    const first = buildOutboundRequestFingerprint({ ...base, to: ["one@example.com"] });
    const second = buildOutboundRequestFingerprint({ ...base, to: ["two@example.com"] });

    expect(first).not.toBe(second);
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

  it("keeps an unchanged server-loaded Forward stable across remounts", () => {
    const sourceAttachments = [{
      filename: "original.pdf",
      mime_type: "application/pdf",
      size_bytes: 3,
      content_base64: "YWJj",
    }];
    const first = buildOutboundRequestFingerprint({
      threadId,
      mailboxId,
      provider: "smtp",
      operationType: "forward",
      sourceMessageId: "source-message-1",
      subject: "Fwd: Original",
      bodyText: "See below.",
      to: ["customer@example.com"],
      attachments: sourceAttachments,
    });
    const remount = buildOutboundRequestFingerprint({
      threadId,
      mailboxId,
      provider: "smtp",
      operationType: "forward",
      sourceMessageId: "source-message-1",
      subject: "Fwd: Original",
      bodyText: "See below.",
      to: ["customer@example.com"],
      attachments: sourceAttachments,
    });
    const edited = buildOutboundRequestFingerprint({
      threadId,
      mailboxId,
      provider: "smtp",
      operationType: "forward",
      sourceMessageId: "source-message-1",
      subject: "Fwd: Original",
      bodyText: "See the updated context.",
      to: ["customer@example.com"],
      attachments: sourceAttachments,
    });

    expect(remount).toBe(first);
    expect(edited).not.toBe(first);
  });

  it("does not reveal or reuse another workspace's attempt", async () => {
    const client = createFakeServiceClient();
    await claim(client, attemptA, workspaceA, fingerprint());

    await expect(claim(client, attemptA, workspaceB, fingerprint())).rejects.toThrow(
      /existing outbound send attempt safely/i,
    );
  });

  it("does not reuse an attempt UUID for another mailbox or thread", async () => {
    const client = createFakeServiceClient();
    await claim(client, attemptA, workspaceA, fingerprint());

    const changedScope = await claimOutboundSendAttempt({
      serviceClient: client,
      scope: scope(workspaceA),
      userId: "99999999-9999-4999-8999-999999999999",
      workspaceId: workspaceA,
      mailboxId: "11111111-1111-4111-8111-111111111111",
      threadId: "22222222-2222-4222-8222-222222222222",
      operationType: "reply",
      provider: "smtp",
      attemptId: attemptA,
      requestFingerprint: buildOutboundRequestFingerprint({
        threadId: "22222222-2222-4222-8222-222222222222",
        mailboxId: "11111111-1111-4111-8111-111111111111",
        provider: "smtp",
        operationType: "reply",
        subject: "Re: Ticket",
        bodyText: "Hello",
        to: ["customer@example.com"],
      }),
    });

    expect(changedScope.kind).toBe("new_attempt_required");
    expect(client.rows).toHaveLength(1);
  });

  it("reclaims a stale reservation that never crossed the provider boundary", async () => {
    const client = createFakeServiceClient();
    const now = Date.parse("2026-09-29T12:00:00.000Z");
    client.rows.push({
      id: attemptA,
      user_id: "99999999-9999-4999-8999-999999999999",
      workspace_id: workspaceA,
      mailbox_id: mailboxId,
      thread_id: threadId,
      operation_type: "reply",
      provider: "smtp",
      request_fingerprint: fingerprint(),
      state: "reserved",
      provider_started_at: null,
      completed_at: null,
      updated_at: new Date(0).toISOString(),
    });

    const result = await recoverStaleOutboundSendAttempt({
      serviceClient: client,
      scope: scope(workspaceA),
      attempt: client.rows[0],
      now,
    });

    expect(result.kind).toBe("reclaimed");
    expect(result.attempt.state).toBe("failed");
    expect(result.attempt.failure_class).toBe("stale_before_provider_start");
  });

  it("transitions a stale provider-started reservation to unknown", async () => {
    const client = createFakeServiceClient();
    const now = Date.parse("2026-09-29T12:00:00.000Z");
    client.rows.push({
      id: attemptA,
      user_id: "99999999-9999-4999-8999-999999999999",
      workspace_id: workspaceA,
      mailbox_id: mailboxId,
      thread_id: threadId,
      operation_type: "reply",
      provider: "smtp",
      request_fingerprint: fingerprint(),
      state: "reserved",
      provider_started_at: new Date(now - 90_000).toISOString(),
      completed_at: null,
      updated_at: new Date(now - OUTBOUND_SEND_ATTEMPT_STALE_AFTER_MS - 1).toISOString(),
    });

    const result = await recoverStaleOutboundSendAttempt({
      serviceClient: client,
      scope: scope(workspaceA),
      attempt: client.rows[0],
      now,
    });

    expect(result.kind).toBe("unknown");
    expect(result.attempt.state).toBe("unknown");
    expect(result.attempt.failure_class).toBe("stale_after_provider_start");
  });

  it("lets a different UUID claim after a stale pre-provider reservation is failed", async () => {
    const client = createFakeServiceClient();
    client.rows.push({
      id: attemptA,
      user_id: "99999999-9999-4999-8999-999999999999",
      workspace_id: workspaceA,
      mailbox_id: mailboxId,
      thread_id: threadId,
      operation_type: "reply",
      provider: "smtp",
      request_fingerprint: fingerprint(),
      state: "reserved",
      provider_started_at: null,
      completed_at: null,
      updated_at: new Date(0).toISOString(),
    });

    const claimed = await claim(client, attemptB, workspaceA, fingerprint());

    expect(claimed.kind).toBe("claimed");
    expect(client.rows.find((row) => row.id === attemptA)?.state).toBe("failed");
    expect(client.rows.find((row) => row.id === attemptB)?.state).toBe("reserved");
  });

  it("allows only one of two stale recoveries to win the compare-and-set", async () => {
    const client = createFakeServiceClient();
    const now = Date.parse("2026-09-29T12:00:00.000Z");
    client.rows.push({
      id: attemptA,
      user_id: "99999999-9999-4999-8999-999999999999",
      workspace_id: workspaceA,
      mailbox_id: mailboxId,
      thread_id: threadId,
      operation_type: "reply",
      provider: "smtp",
      request_fingerprint: fingerprint(),
      state: "reserved",
      provider_started_at: null,
      completed_at: null,
      updated_at: new Date(now - OUTBOUND_SEND_ATTEMPT_STALE_AFTER_MS - 1).toISOString(),
    });

    const staleAttempt = { ...client.rows[0] };
    const results = await Promise.all([
      recoverStaleOutboundSendAttempt({
        serviceClient: client,
        scope: scope(workspaceA),
        attempt: { ...staleAttempt },
        now,
      }),
      recoverStaleOutboundSendAttempt({
        serviceClient: client,
        scope: scope(workspaceA),
        attempt: { ...staleAttempt },
        now,
      }),
    ]);

    expect(results.filter((result) => result.kind === "reclaimed")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "raced")).toHaveLength(1);
    expect(client.rows[0].state).toBe("failed");
  });

  it("rejects the same UUID when its canonical request changes", async () => {
    const client = createFakeServiceClient();
    const first = await claim(client, attemptA, workspaceA, fingerprint());
    client.rows[0].state = "unknown";

    const changed = await claim(client, attemptA, workspaceA, fingerprint("Edited"));

    expect(first.kind).toBe("claimed");
    expect(changed.kind).toBe("new_attempt_required");
    expect(client.rows).toHaveLength(1);
  });
});
