// Feedback-1a: append-only draft feedback event capture.
//
// emitDraftEvent inserts a single row into public.draft_feedback_events. It is a
// measurement sidecar: best-effort, fire-and-forget, and structurally incapable
// of changing draft generation. It NEVER mutates prompts/knowledge/Shopify and
// NEVER touches any auto-promotion path (ticket_examples / draft_previews).
//
// Design contract (pinned by tests/draft-feedback-events.test.mjs):
//   - writes only to draft_feedback_events
//   - stores ids + classification + numeric metrics only, never raw bodies
//   - payload_json is whitelisted to safe metadata keys
//   - deterministic dedup_key per event type → unique-violation (23505) is a
//     successful idempotent no-op
//   - never throws into the caller; skips the insert when scope is missing
//
// This module is intentionally free of next/clerk imports so it can be unit
// tested against a mock Supabase client.

const TABLE = "draft_feedback_events";

export const DRAFT_EVENT_TYPES = new Set([
  "draft_generated",
  "draft_inserted",
  "draft_edited",
  "draft_sent",
  "draft_sent_without_edit",
  "draft_sent_with_edit",
  "draft_discarded",
  "draft_regenerated",
  "safety_block_shown",
  "safety_block_overridden",
]);

const VALID_ROUTING_HINTS = new Set(["auto", "review", "block"]);
const VALID_EDIT_CLASSIFICATIONS = new Set(["no_edit", "minor_edit", "major_edit"]);

// Only safe, non-content metadata may live in payload_json. Anything else
// (especially raw draft / customer / reply bodies) is dropped.
const ALLOWED_PAYLOAD_KEYS = new Set([
  "pipeline_version",
  "prior_generation_id",
  "intent",
  "language",
  "provider",
  "model",
  "prompt_version",
]);

// Deterministic dedup_key per event type. Identifying ids that are not first-class
// columns (provider_message_id, composer_message_id, body_length, …) are passed
// through the `dedup` context object.
export function computeDedupKey({
  eventType,
  generationId = null,
  threadId = null,
  dedup = {},
}) {
  const {
    providerMessageId = null,
    composerMessageId = null,
    editDistance = null,
    bodyLength = null,
    discardedComposerMessageId = null,
    newGenerationId = null,
  } = dedup;
  switch (eventType) {
    case "draft_generated":
      return `gen:${generationId}`;
    case "draft_inserted":
      return `ins:${generationId}:${threadId}`;
    case "draft_edited":
      return `edit:${threadId}:${composerMessageId}:${editDistance}:${bodyLength}`;
    case "draft_sent":
      return `sent:${providerMessageId}`;
    case "draft_sent_without_edit":
    case "draft_sent_with_edit":
      return `sent_sub:${providerMessageId}`;
    case "draft_discarded":
      return `disc:${threadId}:${discardedComposerMessageId}`;
    case "draft_regenerated":
      return `regen:${newGenerationId ?? generationId}`;
    case "safety_block_shown":
      return `block_shown:${generationId}`;
    case "safety_block_overridden":
      return `block_override:${providerMessageId}`;
    default:
      return null;
  }
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const safe = {};
  for (const key of Object.keys(payload)) {
    if (ALLOWED_PAYLOAD_KEYS.has(key) && payload[key] !== undefined) {
      safe[key] = payload[key];
    }
  }
  return safe;
}

function isUniqueViolation(error) {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /duplicate key|unique constraint/i.test(String(error.message || ""));
}

function coerceInt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function coerceNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

// Append one draft feedback event. Returns one of:
//   { ok: true, deduped: false, id }   — inserted
//   { ok: true, deduped: true }        — already existed (idempotent)
//   { ok: false, skipped: <reason> }   — guard tripped, no insert attempted
//   { ok: false, error }               — DB/runtime error (logged, not thrown)
export async function emitDraftEvent({
  serviceClient,
  eventType,
  generationId = null,
  draftId = null,
  threadId = null,
  shopId,
  workspaceId,
  agentUserId = null,
  routingHint = null,
  blockSendRecommended = null,
  editClassification = null,
  editDistance = null,
  editDeltaPct = null,
  payload = {},
  dedup = {},
  dedupKey = null,
  logger = console,
}) {
  try {
    if (!serviceClient) return { ok: false, skipped: "no_service_client" };
    if (!DRAFT_EVENT_TYPES.has(eventType)) {
      return { ok: false, skipped: "invalid_event_type" };
    }
    // Tenancy guard: never emit a workspace-less or shop-less event. Mirrors the
    // existing `drafts` analytics behavior (a NULL workspace_id is a tenant-leak
    // vector). Coverage gap for not-yet-migrated threads is intentional for 1a.
    if (!shopId || !workspaceId) {
      return { ok: false, skipped: "missing_scope" };
    }

    const key = dedupKey || computeDedupKey({ eventType, generationId, threadId, dedup });

    const row = {
      generation_id: generationId || null,
      draft_id: draftId != null ? String(draftId) : null,
      thread_id: threadId || null,
      shop_id: shopId,
      workspace_id: workspaceId,
      agent_user_id: agentUserId || null,
      event_type: eventType,
      routing_hint: VALID_ROUTING_HINTS.has(routingHint) ? routingHint : null,
      block_send_recommended:
        typeof blockSendRecommended === "boolean" ? blockSendRecommended : null,
      edit_classification: VALID_EDIT_CLASSIFICATIONS.has(editClassification)
        ? editClassification
        : null,
      edit_distance: coerceInt(editDistance),
      edit_delta_pct: coerceNumber(editDeltaPct),
      payload_json: sanitizePayload(payload),
      dedup_key: key,
    };

    const { data, error } = await serviceClient
      .from(TABLE)
      .insert(row)
      .select("id")
      .maybeSingle();

    if (error) {
      if (isUniqueViolation(error)) {
        // Expected on retry / fallback resend — the event already exists.
        return { ok: true, deduped: true };
      }
      logger?.warn?.("[draft-feedback] emit failed", error.message);
      return { ok: false, error };
    }

    return { ok: true, deduped: false, id: data?.id ?? null };
  } catch (err) {
    // Best-effort: an emit must never break the surrounding request.
    logger?.warn?.("[draft-feedback] emit threw", err?.message || String(err));
    return { ok: false, error: err };
  }
}
