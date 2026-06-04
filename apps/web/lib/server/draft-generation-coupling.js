// Unambiguous coupling of employee outcomes back to a draft_generations row.
//
// The original implementation matched on final_draft_text, which updates every
// generation that happens to share identical draft text on a thread. These helpers
// couple by an explicit unique key instead:
//   - rejection  -> the preview's stored generation_id (draft_generations.id)
//   - save-edit  -> the pipeline's per-run draft_id (draft_generations.draft_id)
//
// A controlled legacy fallback remains for rows created before generation_id /
// draft_id were available. The fallback NEVER updates more than one row: it selects
// the single newest exact-text match by id, then updates that id. Both helpers
// return { matchedBy, updatedCount } so callers (and tests) can verify the coupling.
//
// These functions are intentionally free of next/clerk imports so they can be unit
// tested against a mock Supabase client. Each Supabase update appends .select("id")
// so updatedCount reflects the rows actually written.

const TABLE = "draft_generations";

async function countedUpdate(builder) {
  const { data, error } = await builder.select("id");
  if (error) return { error, updatedCount: 0 };
  return { error: null, updatedCount: Array.isArray(data) ? data.length : 0 };
}

// Resolve the single newest draft_generations id matching the given equality
// filters. Returns the id string or null. Used only by legacy fallbacks.
async function findNewestGenerationId(serviceClient, { eq = {}, isNull = {} }) {
  let query = serviceClient.from(TABLE).select("id");
  for (const [col, val] of Object.entries(eq)) {
    query = query.eq(col, val);
  }
  for (const [col] of Object.entries(isNull)) {
    query = query.is(col, null);
  }
  query = query.order("created_at", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error || !data?.id) return null;
  return data.id;
}

// Couple a preview rejection to its generation.
// Sets rejection_reason + rejected_at. Never touches completed_at.
export async function applyRejectionToGeneration({
  serviceClient,
  generationId = null,
  rejectionReason,
  fallback = {},
  logger = console,
}) {
  if (!serviceClient) return { matchedBy: "none", updatedCount: 0 };
  const patch = {
    rejection_reason: rejectionReason || null,
    rejected_at: new Date().toISOString(),
  };

  if (generationId) {
    const { error, updatedCount } = await countedUpdate(
      serviceClient.from(TABLE).update(patch).eq("id", generationId),
    );
    if (error) {
      logger?.warn?.("[draft-coupling] rejection update by generation_id failed", error.message);
    }
    return { matchedBy: "generation_id", updatedCount };
  }

  // Legacy fallback: newest single exact-text row for this thread/shop.
  const { threadId, shopId, messageId, draftText } = fallback;
  if (!threadId || !shopId || draftText == null) {
    return { matchedBy: "none", updatedCount: 0 };
  }
  const eq = { thread_id: threadId, shop_id: shopId, final_draft_text: draftText };
  if (messageId) eq.message_id = messageId;
  const targetId = await findNewestGenerationId(serviceClient, { eq });
  if (!targetId) {
    return { matchedBy: "legacy_text_fallback", updatedCount: 0 };
  }
  logger?.warn?.(
    "[draft-coupling] rejection used legacy text fallback (no generation_id on preview); " +
      "this fallback can be removed once all preview rows carry generation_id",
  );
  const { error, updatedCount } = await countedUpdate(
    serviceClient.from(TABLE).update(patch).eq("id", targetId),
  );
  if (error) {
    logger?.warn?.("[draft-coupling] rejection legacy fallback update failed", error.message);
  }
  return { matchedBy: "legacy_text_fallback", updatedCount };
}

// Couple a manual save/edit to its generation.
// Primary key is the pipeline draft_id (draft_generations.draft_id), which is the
// same per-run UUID stored on the drafts analytics row. Sets edit_classification
// (+ optional edit_distance).
export async function applySavedEditToGeneration({
  serviceClient,
  draftId = null,
  threadId,
  workspaceId = null,
  editClassification,
  editDistance = null,
  fallback = {},
  logger = console,
}) {
  if (!serviceClient || !threadId) return { matchedBy: "none", updatedCount: 0 };
  const patch = {
    edit_classification: editClassification || null,
    edit_distance: typeof editDistance === "number" ? editDistance : null,
  };

  if (draftId) {
    let builder = serviceClient
      .from(TABLE)
      .update(patch)
      .eq("draft_id", String(draftId))
      .eq("thread_id", threadId);
    if (workspaceId) builder = builder.eq("workspace_id", workspaceId);
    const { error, updatedCount } = await countedUpdate(builder);
    if (error) {
      logger?.warn?.("[draft-coupling] saved-edit update by draft_id failed", error.message);
    }
    if (updatedCount > 0) {
      return { matchedBy: "draft_id", updatedCount };
    }
    // draft_id present but no match (e.g. a later manual-save row whose draft_id is a
    // composer id, not a pipeline UUID) — fall through to the controlled text fallback.
  }

  // Legacy fallback: newest single exact-text row that has no recorded outcome yet.
  const { originalAiText } = fallback;
  if (originalAiText == null || originalAiText === "") {
    return { matchedBy: draftId ? "draft_id" : "none", updatedCount: 0 };
  }
  const eq = { thread_id: threadId, final_draft_text: originalAiText };
  if (workspaceId) eq.workspace_id = workspaceId;
  const targetId = await findNewestGenerationId(serviceClient, {
    eq,
    isNull: { employee_sent_text: true },
  });
  if (!targetId) {
    return { matchedBy: "legacy_text_fallback", updatedCount: 0 };
  }
  logger?.warn?.(
    "[draft-coupling] saved-edit used legacy text fallback (no matching draft_id); " +
      "this fallback can be removed once every generation carries its pipeline draft_id",
  );
  const { error, updatedCount } = await countedUpdate(
    serviceClient.from(TABLE).update(patch).eq("id", targetId),
  );
  if (error) {
    logger?.warn?.("[draft-coupling] saved-edit legacy fallback update failed", error.message);
  }
  return { matchedBy: "legacy_text_fallback", updatedCount };
}
