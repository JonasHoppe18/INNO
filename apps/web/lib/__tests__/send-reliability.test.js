import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildClientSendFingerprint,
  ClientSendTimeoutError,
  createClientSendAttemptId,
  fetchWithClientSendTimeout,
  readResponseJsonWithClientSendTimeout,
} from "../send-reliability.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("client send reliability", () => {
  it("creates a stable-format secure attempt ID", () => {
    expect(createClientSendAttemptId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("changes the client fingerprint when the composed message changes", async () => {
    const first = await buildClientSendFingerprint({
      threadId: "thread-1",
      mailboxId: "mailbox-1",
      operationType: "reply",
      bodyText: "Hello",
      to: ["customer@example.com"],
    });
    const same = await buildClientSendFingerprint({
      threadId: "thread-1",
      mailboxId: "mailbox-1",
      operationType: "reply",
      bodyText: "Hello",
      to: ["customer@example.com"],
    });
    const edited = await buildClientSendFingerprint({
      threadId: "thread-1",
      mailboxId: "mailbox-1",
      operationType: "reply",
      bodyText: "Hello again",
      to: ["customer@example.com"],
    });

    expect(same).toBe(first);
    expect(edited).not.toBe(first);
  });

  it("aborts a hung request so the composer can leave loading state", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
    );

    const pending = fetchWithClientSendTimeout(
      "/api/threads/thread/send",
      {},
      { timeoutMs: 10 },
    );
    vi.advanceTimersByTime(10);

    await expect(pending).rejects.toBeInstanceOf(ClientSendTimeoutError);
    await expect(pending).rejects.toThrow(/status is unknown/i);
  });

  it("times out a response body that never finishes", async () => {
    vi.useFakeTimers();
    const pending = readResponseJsonWithClientSendTimeout(
      { json: () => new Promise(() => {}) },
      { timeoutMs: 10 },
    );
    vi.advanceTimersByTime(10);

    await expect(pending).rejects.toBeInstanceOf(ClientSendTimeoutError);
  });
});
