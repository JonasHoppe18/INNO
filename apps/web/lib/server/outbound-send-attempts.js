import crypto from "crypto";
import { applyScope } from "@/lib/server/workspace-auth";

export const OUTBOUND_SEND_ATTEMPT_STATES = Object.freeze({
  RESERVED: "reserved",
  SENT: "sent",
  FAILED: "failed",
  UNKNOWN: "unknown",
});

// Provider calls and response-body reads are bounded at 30 seconds and the
// browser gives the request 45 seconds. Two minutes leaves room for the
// reservation/update round trips while still recovering a crashed worker in a
// bounded time. A reservation with provider_started_at is never reclaimed;
// it becomes unknown because the provider may already have been invoked.
export const OUTBOUND_SEND_ATTEMPT_STALE_AFTER_MS = 2 * 60 * 1000;

export const OUTBOUND_ATTEMPT_SELECT =
  "id, user_id, workspace_id, mailbox_id, thread_id, operation_type, provider, request_fingerprint, state, failure_class, provider_message_id, message_id, provider_started_at, completed_at, created_at, updated_at";

function normalizedString(value) {
  return String(value ?? "").trim();
}

function hashAttachmentContent(contentBase64) {
  return crypto
    .createHash("sha256")
    .update(normalizedString(contentBase64))
    .digest("hex");
}

function canonicalizeAttachments(attachments) {
  return (Array.isArray(attachments) ? attachments : []).map((attachment) => ({
    filename: normalizedString(attachment?.filename),
    mime_type: normalizedString(attachment?.mime_type).toLowerCase(),
    size_bytes: Number(attachment?.size_bytes || 0),
    is_inline: attachment?.is_inline === true,
    content_id: normalizedString(attachment?.content_id),
    content_sha256: hashAttachmentContent(attachment?.content_base64),
  }));
}

export function buildOutboundRequestFingerprint({
  threadId,
  mailboxId,
  provider,
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
  const canonicalRequest = {
    thread_id: normalizedString(threadId),
    mailbox_id: normalizedString(mailboxId),
    provider: normalizedString(provider).toLowerCase(),
    operation: operationType === "forward" ? "forward" : "reply",
    source_message_id: normalizedString(sourceMessageId),
    subject: normalizedString(subject),
    body_text: normalizedString(bodyText),
    body_html: normalizedString(bodyHtml),
    to: Array.isArray(to) ? to.map(normalizedString) : [],
    cc: Array.isArray(cc) ? cc.map(normalizedString) : [],
    bcc: Array.isArray(bcc) ? bcc.map(normalizedString) : [],
    attachments: canonicalizeAttachments(attachments),
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalRequest))
    .digest("hex");
}

export function describeOutboundSendAttempt(row, requestFingerprint) {
  if (!row) return { state: "new" };
  if (String(row.request_fingerprint || "") !== String(requestFingerprint || "")) {
    return { state: "conflict", attempt: row };
  }
  return { state: row.state || "unknown", attempt: row };
}

export function isUniqueViolation(error) {
  return String(error?.code || "") === "23505";
}

export function describeAttemptResolution(attempt, requestFingerprint) {
  const description = describeOutboundSendAttempt(attempt, requestFingerprint);
  if (description.state === "conflict") return { kind: "new_attempt_required", attempt };
  if (description.state === "unknown") return { kind: "unknown", attempt };
  if (description.state === "reserved") return { kind: "in_progress", attempt };
  if (description.state === "sent") return { kind: "sent", attempt };
  if (description.state === "failed") return { kind: "new_attempt_required", attempt };
  return { kind: "new_attempt_required", attempt };
}

export function isStaleOutboundSendAttempt(
  attempt,
  { now = Date.now(), staleAfterMs = OUTBOUND_SEND_ATTEMPT_STALE_AFTER_MS } = {},
) {
  if (attempt?.state !== OUTBOUND_SEND_ATTEMPT_STATES.RESERVED) return false;
  const updatedAt = Date.parse(String(attempt.updated_at || ""));
  return Number.isFinite(updatedAt) && now - updatedAt >= staleAfterMs;
}

async function loadAttemptById(serviceClient, scope, attemptId) {
  let query = serviceClient
    .from("outbound_send_attempts")
    .select(OUTBOUND_ATTEMPT_SELECT)
    .eq("id", attemptId)
    .limit(1);
  query = applyScope(query, scope);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function recoverStaleOutboundSendAttempt({
  serviceClient,
  scope,
  attempt,
  now = Date.now(),
  staleAfterMs = OUTBOUND_SEND_ATTEMPT_STALE_AFTER_MS,
}) {
  if (!isStaleOutboundSendAttempt(attempt, { now, staleAfterMs })) {
    return { kind: "active", attempt };
  }

  const providerMayHaveStarted = Boolean(attempt.provider_started_at);
  const staleBefore = new Date(now - staleAfterMs).toISOString();
  const patch = providerMayHaveStarted
    ? {
        state: OUTBOUND_SEND_ATTEMPT_STATES.UNKNOWN,
        failure_class: "stale_after_provider_start",
      }
    : {
        state: OUTBOUND_SEND_ATTEMPT_STATES.FAILED,
        failure_class: "stale_before_provider_start",
      };

  let query = serviceClient
    .from("outbound_send_attempts")
    .update(patch)
    .eq("id", attempt.id)
    .eq("state", OUTBOUND_SEND_ATTEMPT_STATES.RESERVED)
    .lt("updated_at", staleBefore);
  query = providerMayHaveStarted
    ? query.not("provider_started_at", "is", null)
    : query.is("provider_started_at", null);
  query = applyScope(query, scope);

  const { data, error } = await query
    .select(OUTBOUND_ATTEMPT_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id) {
    return {
      kind: providerMayHaveStarted ? "unknown" : "reclaimed",
      attempt: data,
    };
  }

  return {
    kind: "raced",
    attempt: await loadAttemptById(serviceClient, scope, attempt.id),
  };
}

async function loadUnresolvedAttempt(
  serviceClient,
  scope,
  { mailboxId, threadId, operationType, requestFingerprint },
) {
  let query = serviceClient
    .from("outbound_send_attempts")
    .select(OUTBOUND_ATTEMPT_SELECT)
    .eq("mailbox_id", mailboxId)
    .eq("thread_id", threadId)
    .eq("operation_type", operationType)
    .eq("request_fingerprint", requestFingerprint)
    .or("state.in.(reserved,unknown),and(state.eq.sent,completed_at.is.null)")
    .order("created_at", { ascending: false })
    .limit(1);
  query = applyScope(query, scope);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function claimOutboundSendAttempt({
  serviceClient,
  scope,
  userId,
  workspaceId,
  mailboxId,
  threadId,
  operationType,
  provider,
  attemptId,
  requestFingerprint,
}) {
  for (let retry = 0; retry < 3; retry += 1) {
    const nowIso = new Date().toISOString();
    const { data, error } = await serviceClient
      .from("outbound_send_attempts")
      .insert({
        id: attemptId,
        user_id: userId,
        workspace_id: workspaceId || null,
        mailbox_id: mailboxId,
        thread_id: threadId,
        operation_type: operationType,
        provider,
        request_fingerprint: requestFingerprint,
        state: OUTBOUND_SEND_ATTEMPT_STATES.RESERVED,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select(OUTBOUND_ATTEMPT_SELECT)
      .maybeSingle();

    if (!error && data?.id) return { kind: "claimed", attempt: data };
    if (!isUniqueViolation(error)) {
      throw new Error(error?.message || "Could not reserve the send attempt safely.");
    }

    const existingById = await loadAttemptById(serviceClient, scope, attemptId);
    if (existingById) {
      const resolution = describeAttemptResolution(existingById, requestFingerprint);
      if (resolution.kind !== "in_progress") return resolution;
      const recovery = await recoverStaleOutboundSendAttempt({
        serviceClient,
        scope,
        attempt: existingById,
      });
      if (recovery.kind === "unknown") {
        return { kind: "unknown", attempt: recovery.attempt };
      }
      if (recovery.kind === "reclaimed") {
        return { kind: "new_attempt_required", attempt: recovery.attempt };
      }
      return describeAttemptResolution(
        recovery.attempt || existingById,
        requestFingerprint,
      );
    }

    const existingByFingerprint = await loadUnresolvedAttempt(serviceClient, scope, {
      mailboxId,
      threadId,
      operationType,
      requestFingerprint,
    });
    if (existingByFingerprint) {
      const resolution = describeAttemptResolution(
        existingByFingerprint,
        requestFingerprint,
      );
      if (resolution.kind !== "in_progress") return resolution;
      const recovery = await recoverStaleOutboundSendAttempt({
        serviceClient,
        scope,
        attempt: existingByFingerprint,
      });
      if (recovery.kind === "unknown") {
        return { kind: "unknown", attempt: recovery.attempt };
      }
      if (recovery.kind === "reclaimed") continue;
      return describeAttemptResolution(
        recovery.attempt || existingByFingerprint,
        requestFingerprint,
      );
    }
  }

  throw new Error("Could not determine the existing outbound send attempt safely.");
}
