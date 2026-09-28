import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyOutboundError,
  createProviderHttpError,
  fetchWithOutboundTimeout,
} from "../outbound-send-reliability.js";
import {
  buildOutboundRequestFingerprint,
  describeOutboundSendAttempt,
  isUniqueViolation,
} from "../outbound-send-attempts.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("outbound send reliability", () => {
  it("classifies Postmark inactive recipients without retaining provider text", () => {
    const result = classifyOutboundError(
      createProviderHttpError(
        "recipient marked as inactive by the provider: private-address@example.com",
        { provider: "smtp", stage: "provider_send", statusCode: 422 },
      ),
      { provider: "smtp", stage: "provider_send", providerInvoked: true },
    );

    expect(result).toMatchObject({
      errorClass: "recipient_suppressed",
      outcome: "failed",
      statusCode: 422,
    });
    expect(result).not.toHaveProperty("message");
  });

  it("treats a provider-send timeout as an unknown outcome", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
    );

    const pending = fetchWithOutboundTimeout(
      "https://provider.test/send",
      {},
      { provider: "smtp", stage: "provider_send", timeoutMs: 10 },
    );
    vi.advanceTimersByTime(10);

    await expect(pending).rejects.toMatchObject({
      name: "OutboundTimeoutError",
      outcome: "unknown",
      stage: "provider_send",
    });
  });

  it("treats a token-refresh timeout as a known pre-send failure", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
    );

    const pending = fetchWithOutboundTimeout(
      "https://oauth.test/token",
      {},
      { provider: "gmail", stage: "token_refresh", timeoutMs: 10 },
    );
    vi.advanceTimersByTime(10);

    await expect(pending).rejects.toMatchObject({
      name: "OutboundTimeoutError",
      outcome: "failed",
      stage: "token_refresh",
    });
  });

  it("uses a stable immutable fingerprint and never overloads mail_messages", () => {
    const first = buildOutboundRequestFingerprint({
      threadId: "thread-1",
      mailboxId: "mailbox-1",
      provider: "smtp",
      operationType: "reply",
      subject: "Re: Order",
      bodyText: "Hello",
      bodyHtml: "<p>Hello</p>",
      to: ["customer@example.com"],
      attachments: [{
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        size_bytes: 3,
        content_base64: "YWJj",
      }],
    });
    const same = buildOutboundRequestFingerprint({
      threadId: "thread-1",
      mailboxId: "mailbox-1",
      provider: "smtp",
      operationType: "reply",
      subject: "Re: Order",
      bodyText: "Hello",
      bodyHtml: "<p>Hello</p>",
      to: ["customer@example.com"],
      attachments: [{
        filename: "invoice.pdf",
        mime_type: "application/pdf",
        size_bytes: 3,
        content_base64: "YWJj",
      }],
    });
    const edited = buildOutboundRequestFingerprint({
      threadId: "thread-1",
      mailboxId: "mailbox-1",
      provider: "smtp",
      operationType: "reply",
      subject: "Re: Order",
      bodyText: "Hello again",
      to: ["customer@example.com"],
    });

    expect(first).toHaveLength(64);
    expect(same).toBe(first);
    expect(edited).not.toBe(first);
    expect(describeOutboundSendAttempt({
      state: "unknown",
      request_fingerprint: first,
    }, first)).toEqual({ state: "unknown", attempt: expect.any(Object) });
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
});
