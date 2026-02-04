const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN || "";
const POSTMARK_ACCOUNT_TOKEN = process.env.POSTMARK_ACCOUNT_TOKEN || "";
const POSTMARK_MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM || "outbound";

class PostmarkApiError extends Error {
  constructor(message, statusCode, errorCode) {
    super(message);
    this.name = "PostmarkApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function ensureServerToken() {
  if (!POSTMARK_SERVER_TOKEN) {
    throw new Error("POSTMARK_SERVER_TOKEN is missing.");
  }
}

function ensureAccountToken() {
  if (!POSTMARK_ACCOUNT_TOKEN) {
    throw new Error(
      "POSTMARK_ACCOUNT_TOKEN is missing. Domain setup requires an Account API token in Postmark."
    );
  }
}

async function postmarkRequest(path, { method = "GET", body, accountLevel = false } = {}) {
  if (accountLevel) {
    ensureAccountToken();
  } else {
    ensureServerToken();
  }
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    [accountLevel ? "X-Postmark-Account-Token" : "X-Postmark-Server-Token"]: accountLevel
      ? POSTMARK_ACCOUNT_TOKEN
      : POSTMARK_SERVER_TOKEN,
  };

  const response = await fetch(`https://api.postmarkapp.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.Message || `Postmark request failed (${response.status})`;
    throw new PostmarkApiError(String(message), response.status, payload?.ErrorCode ?? null);
  }
  return payload;
}

function toRelativeHost(host, domain) {
  const safeHost = String(host || "").trim().replace(/\.$/, "");
  const safeDomain = String(domain || "").trim().replace(/\.$/, "");
  if (!safeHost || !safeDomain) return safeHost;
  const suffix = `.${safeDomain}`;
  if (safeHost.toLowerCase().endsWith(suffix.toLowerCase())) {
    return safeHost.slice(0, safeHost.length - suffix.length);
  }
  return safeHost;
}

function extractDomainDnsRecords(domainPayload, domainName) {
  const dkimHost = domainPayload?.DKIMPendingHost || domainPayload?.DKIMHost || "";
  const dkimValue = domainPayload?.DKIMPendingTextValue || domainPayload?.DKIMTextValue || "";
  const returnPathDomain = domainPayload?.ReturnPathDomain || "";
  const returnPathValue = domainPayload?.ReturnPathDomainCNAMEValue || "";

  const records = [];
  if (dkimHost && dkimValue) {
    records.push({
      type: "TXT",
      host: toRelativeHost(dkimHost, domainName),
      value: dkimValue,
    });
  }
  if (returnPathDomain && returnPathValue) {
    records.push({
      type: "CNAME",
      host: toRelativeHost(returnPathDomain, domainName),
      value: returnPathValue,
    });
  }
  return records;
}

export async function createPostmarkDomain({ domainName, returnPathDomain }) {
  return await postmarkRequest("/domains", {
    method: "POST",
    accountLevel: true,
    body: {
      Name: domainName,
      ReturnPathDomain: returnPathDomain,
    },
  });
}

export async function getPostmarkDomain(domainId) {
  return await postmarkRequest(`/domains/${encodeURIComponent(domainId)}`, {
    method: "GET",
    accountLevel: true,
  });
}

export function buildDomainDns(domainName, domainPayload) {
  const records = extractDomainDnsRecords(domainPayload, domainName);
  return {
    domain: domainName,
    records,
    notes: `Add these records at your DNS provider for ${domainName} and then click Check status.`,
  };
}

export function isPostmarkDomainVerified(domainPayload) {
  return Boolean(domainPayload?.DKIMVerified) && Boolean(domainPayload?.ReturnPathDomainVerified);
}

export async function sendPostmarkEmail(message, options = {}) {
  const candidateStreams = [options?.messageStream || POSTMARK_MESSAGE_STREAM, "transactional", "outbound"]
    .filter(Boolean);
  const tried = new Set();
  let lastError = null;

  for (const stream of candidateStreams) {
    if (tried.has(stream)) continue;
    tried.add(stream);
    try {
      return await postmarkRequest("/email", {
        method: "POST",
        body: {
          ...message,
          MessageStream: stream,
        },
      });
    } catch (error) {
      lastError = error;
      const messageText = String(error?.message || "").toLowerCase();
      const isStreamError =
        messageText.includes("messagestream") ||
        messageText.includes("message stream") ||
        messageText.includes("stream provided") ||
        messageText.includes("stream");
      if (!isStreamError) break;
    }
  }

  throw lastError || new Error("Postmark send failed");
}
