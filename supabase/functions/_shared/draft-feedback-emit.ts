// Feedback-1c-1: emit a `draft_generated` event into draft_feedback_events.
//
// Forward-looking coupling: a clean, append-only link from a completed pipeline
// generation to its thread/intent/routing, so future feedback suggestions can
// reach the AI draft (via generation_id -> draft_generations.final_draft_text)
// without fragile joins or JSON digging.
//
// Strictly a measurement sidecar:
//   - best-effort, never throws into the pipeline
//   - suppressed on no-write (eval / dry-run) runs
//   - 23505 (duplicate) is an idempotent success
//   - payload is whitelisted to small metadata — NEVER any draft/customer/reply
//     body (the AI draft stays in draft_generations.final_draft_text)
//
// It does not touch the writer/verifier/retriever/routing logic or their output.

const TABLE = "draft_feedback_events";

const VALID_ROUTING_HINTS = new Set(["auto", "review", "block"]);

// Only these non-body metadata keys may live in a draft_generated payload_json.
export const DRAFT_GENERATED_ALLOWED_PAYLOAD_KEYS = new Set([
  "intent",
  "language",
  "product",
  "pipeline_version",
  "writer_model",
  "verifier_block_send",
]);

function sanitizePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (DRAFT_GENERATED_ALLOWED_PAYLOAD_KEYS.has(key) && value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "23505") return true;
  return /duplicate key|unique constraint/i.test(String(e.message || ""));
}

export interface DraftGeneratedInput {
  generationId: string;
  draftId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  shopId?: string | null;
  workspaceId?: string | null;
  routingHint?: unknown;
  blockSendRecommended?: unknown;
  payload?: unknown;
}

// Build the draft_feedback_events insert row for a draft_generated event.
export function buildDraftGeneratedRow(input: DraftGeneratedInput): Record<string, unknown> {
  return {
    generation_id: input.generationId,
    draft_id: input.draftId != null ? String(input.draftId) : null,
    thread_id: input.threadId ?? null,
    message_id: input.messageId ?? null,
    shop_id: input.shopId ?? null,
    workspace_id: input.workspaceId ?? null,
    event_type: "draft_generated",
    routing_hint: VALID_ROUTING_HINTS.has(input.routingHint as string)
      ? (input.routingHint as string)
      : null,
    block_send_recommended:
      typeof input.blockSendRecommended === "boolean" ? input.blockSendRecommended : null,
    payload_json: sanitizePayload(input.payload),
    dedup_key: `gen:${input.generationId}`,
  };
}

interface Logger {
  warn?: (...args: unknown[]) => void;
}

interface EmitInput extends DraftGeneratedInput {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  isNoWrite: boolean;
  logger?: Logger;
}

type EmitResult =
  | { ok: true; deduped: boolean }
  | { ok: false; skipped?: string; error?: unknown };

// Best-effort emit. Returns a result object and NEVER throws.
export async function emitDraftGeneratedEvent(input: EmitInput): Promise<EmitResult> {
  const logger = input.logger ?? console;
  try {
    // No-write (eval / dry-run) runs must emit nothing.
    if (input.isNoWrite === true) {
      return { ok: false, skipped: "no_write" };
    }
    if (!input.supabase) {
      return { ok: false, skipped: "no_service_client" };
    }
    // Tenancy guard: never emit a workspace-less or shop-less event.
    if (!input.shopId || !input.workspaceId) {
      return { ok: false, skipped: "missing_scope" };
    }

    const row = buildDraftGeneratedRow(input);
    const { error } = await input.supabase.from(TABLE).insert(row);

    if (error) {
      if (isUniqueViolation(error)) {
        return { ok: true, deduped: true };
      }
      logger?.warn?.(
        "[draft-feedback] draft_generated emit failed:",
        (error as { message?: string })?.message ?? String(error),
      );
      return { ok: false, error };
    }
    return { ok: true, deduped: false };
  } catch (err) {
    // A measurement emit must never break draft generation.
    logger?.warn?.(
      "[draft-feedback] draft_generated emit threw:",
      (err as Error)?.message ?? String(err),
    );
    return { ok: false, error: err };
  }
}
