export const CLIENT_SEND_TIMEOUT_MS = 45_000;

export class ClientSendTimeoutError extends Error {
  constructor(message = "The send status is unknown. The provider may have accepted the email. Verify the thread before trying again.") {
    super(message);
    this.name = "ClientSendTimeoutError";
  }
}

export function createClientSendAttemptId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new Error("Secure send-attempt IDs are unavailable in this browser.");
}

function stableClientValue(value) {
  return String(value ?? "").trim();
}

function buildClientFingerprintPayload({
  threadId,
  mailboxId,
  operationType,
  sourceMessageId,
  subject,
  bodyText,
  bodyHtml,
  to,
  cc,
  bcc,
  attachments,
}) {
  return JSON.stringify({
    thread_id: stableClientValue(threadId),
    mailbox_id: stableClientValue(mailboxId),
    operation: operationType === "forward" ? "forward" : "reply",
    source_message_id: stableClientValue(sourceMessageId),
    subject: stableClientValue(subject),
    body_text: stableClientValue(bodyText),
    body_html: stableClientValue(bodyHtml),
    to: Array.isArray(to) ? to.map(stableClientValue) : [],
    cc: Array.isArray(cc) ? cc.map(stableClientValue) : [],
    bcc: Array.isArray(bcc) ? bcc.map(stableClientValue) : [],
    attachments: (Array.isArray(attachments) ? attachments : []).map((attachment) => ({
      filename: stableClientValue(attachment?.filename),
      mime_type: stableClientValue(attachment?.mime_type).toLowerCase(),
      size_bytes: Number(attachment?.size_bytes || 0),
      is_inline: attachment?.is_inline === true,
      content_id: stableClientValue(attachment?.content_id),
      content_base64: stableClientValue(attachment?.content_base64),
    })),
  });
}

function fallbackFingerprint(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(8);
}

export async function buildClientSendFingerprint(input) {
  // This fingerprint only detects edits across React remounts. The server
  // derives the authoritative fingerprint after loading server-owned Forward
  // content and attachments; this value is never trusted for authorization or
  // provider idempotency.
  const payload = buildClientFingerprintPayload(input);
  if (globalThis.crypto?.subtle && typeof TextEncoder !== "undefined") {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(payload),
    );
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }
  return fallbackFingerprint(payload);
}

export async function fetchWithClientSendTimeout(
  url,
  options = {},
  { timeoutMs = CLIENT_SEND_TIMEOUT_MS, timeoutMessage } = {},
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
      throw new ClientSendTimeoutError(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readResponseJsonWithClientSendTimeout(
  response,
  { timeoutMs = CLIENT_SEND_TIMEOUT_MS, timeoutMessage } = {},
) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new ClientSendTimeoutError(timeoutMessage)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([response.json(), timeoutPromise]);
  } catch (error) {
    if (error instanceof ClientSendTimeoutError) throw error;
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}
