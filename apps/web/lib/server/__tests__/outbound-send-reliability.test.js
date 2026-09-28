import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOutboundAttemptLog,
  buildSendAttemptMarker,
  classifyOutboundError,
  createProviderHttpError,
  describeExistingSendAttempt,
  fetchWithOutboundTimeout,
  normalizeSendAttemptId,
} from "../outbound-send-reliability.js";

const attemptId = "11111111-1111-4111-8111-111111111111";
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

  it("does not retry a reserved attempt after an unknown result", () => {
    const marker = buildSendAttemptMarker(attemptId);
    expect(normalizeSendAttemptId(attemptId)).toBe(attemptId);
    expect(describeExistingSendAttempt({
      id: attemptId,
      is_draft: true,
      provider_message_id: marker,
    }, attemptId)).toEqual({ state: "unknown" });
    expect(describeExistingSendAttempt({
      id: attemptId,
      is_draft: false,
      provider: "smtp",
      provider_message_id: "postmark-message-id",
    }, attemptId)).toMatchObject({ state: "sent" });
  });

  it("records privacy-safe reply and forward attempt metadata", () => {
    expect(buildOutboundAttemptLog({
      sendAttemptId: attemptId,
      provider: "smtp",
      operationType: "reply",
      stage: "provider_send",
      outcome: "success",
      durationMs: 1234.4,
    })).toMatchObject({
      send_attempt_id: attemptId,
      operation: "reply",
      stage: "provider_send",
      outcome: "success",
      duration_ms: 1234,
    });
    expect(buildOutboundAttemptLog({
      sendAttemptId: attemptId,
      provider: "smtp",
      operationType: "forward",
      stage: "provider_send",
      outcome: "unknown",
      durationMs: 80,
      errorClass: "timeout",
    })).toMatchObject({
      operation: "forward",
      outcome: "unknown",
      error_class: "timeout",
    });
  });
});
