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
