export const OUTBOUND_PROVIDER_TIMEOUT_MS = 30_000;
export const SEND_ATTEMPT_MARKER_PREFIX = "send-attempt:";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OutboundTimeoutError extends Error {
  constructor({ provider, stage, timeoutMs }) {
    super(`${provider} ${stage} timed out after ${timeoutMs}ms.`);
    this.name = "OutboundTimeoutError";
    this.provider = provider;
    this.stage = stage;
    this.timeoutMs = timeoutMs;
    this.outcome = stage === "provider_send" ? "unknown" : "failed";
  }
}

export function normalizeSendAttemptId(value) {
  const candidate = String(value || "").trim();
  return UUID_REGEX.test(candidate) ? candidate.toLowerCase() : null;
}

export function buildSendAttemptMarker(attemptId) {
  const normalized = normalizeSendAttemptId(attemptId);
  return normalized ? `${SEND_ATTEMPT_MARKER_PREFIX}${normalized}` : null;
}

export function isSendAttemptMarker(value, attemptId = null) {
  const marker = String(value || "");
  if (!marker.startsWith(SEND_ATTEMPT_MARKER_PREFIX)) return false;
  if (!attemptId) return true;
  return marker === buildSendAttemptMarker(attemptId);
}

export function describeExistingSendAttempt(row, attemptId) {
  if (!row) return { state: "new" };
  if (!row.is_draft) {
    return {
      state: "sent",
      messageId: row.id,
      providerMessageId: row.provider_message_id || null,
      provider: row.provider || null,
    };
  }
  if (isSendAttemptMarker(row.provider_message_id, attemptId)) {
    return { state: "unknown" };
  }
  return { state: "draft" };
}

export async function fetchWithOutboundTimeout(
  url,
  options = {},
  { provider, stage, timeoutMs = OUTBOUND_PROVIDER_TIMEOUT_MS } = {},
) {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (didTimeout) {
      throw new OutboundTimeoutError({ provider, stage, timeoutMs });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readResponseTextWithOutboundTimeout(
  response,
  { provider, stage, timeoutMs = OUTBOUND_PROVIDER_TIMEOUT_MS } = {},
) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("response body timeout")), timeoutMs);
  });
  try {
    const body = await Promise.race([
      response.text(),
      timeoutPromise,
    ]);
    return body;
  } catch (error) {
    if (String(error?.message || "").includes("response body timeout")) {
      throw new OutboundTimeoutError({ provider, stage, timeoutMs });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function readResponseJsonWithOutboundTimeout(
  response,
  metadata = {},
) {
  const text = await readResponseTextWithOutboundTimeout(response, metadata);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createProviderHttpError(
  message,
  { provider, stage, statusCode = null } = {},
) {
  const error = new Error(String(message || `${provider} request failed.`));
  error.name = "OutboundProviderHttpError";
  error.provider = provider;
  error.stage = stage;
  error.statusCode = Number.isFinite(Number(statusCode))
    ? Number(statusCode)
    : null;
  error.outcome =
    error.statusCode !== null && error.statusCode < 500
      ? "failed"
      : "unknown";
  return error;
}

function isSuppressedRecipientMessage(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    (normalized.includes("recipient") || normalized.includes("email")) &&
    (normalized.includes("inactive") ||
      normalized.includes("suppressed") ||
      normalized.includes("hard bounce") ||
      normalized.includes("spam complaint"))
  );
}

export function classifyOutboundError(
  error,
  { provider, stage, providerInvoked = false } = {},
) {
  const message = String(error?.message || error || "");
  const statusCode = Number.isFinite(Number(error?.statusCode))
    ? Number(error.statusCode)
    : null;
  const resolvedStage = error?.stage || stage || "unknown";
  const isTimeout = error?.name === "OutboundTimeoutError";
  const suppressedRecipient =
    provider === "smtp" && isSuppressedRecipientMessage(message);
  const outcome =
    error?.outcome ||
    (providerInvoked && (isTimeout || statusCode === null || statusCode >= 500)
      ? "unknown"
      : "failed");

  let errorClass = "provider_error";
  if (suppressedRecipient) errorClass = "recipient_suppressed";
  else if (isTimeout) errorClass = "timeout";
  else if (/refresh|oauth|token/i.test(message)) errorClass = "auth";
  else if (statusCode !== null && statusCode >= 500) errorClass = "provider_5xx";
  else if (statusCode !== null && statusCode >= 400) errorClass = "provider_4xx";
  else if (!statusCode && providerInvoked) errorClass = "network";

  return {
    provider: provider || error?.provider || "unknown",
    stage: resolvedStage,
    outcome,
    errorClass,
    statusCode,
    recipientSuppressed: suppressedRecipient,
  };
}

export function buildOutboundAttemptLog({
  sendAttemptId,
  provider,
  operationType,
  stage,
  outcome,
  durationMs,
  errorClass = null,
  statusCode = null,
}) {
  return {
    send_attempt_id: normalizeSendAttemptId(sendAttemptId),
    provider: provider || "unknown",
    operation: operationType === "forward" ? "forward" : "reply",
    stage: stage || "unknown",
    outcome: outcome || "failed",
    duration_ms: Math.max(0, Math.round(Number(durationMs) || 0)),
    error_class: errorClass || null,
    provider_status: Number.isFinite(Number(statusCode))
      ? Number(statusCode)
      : null,
  };
}
