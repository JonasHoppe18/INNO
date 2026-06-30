// Feedback-1b: pure builders that map route variables to emitDraftEvent args.
//
// Keeping these pure (no Supabase client, no next/clerk) makes the app-layer
// wiring unit-testable and keeps the route handlers thin: the route computes a
// small ctx from variables it already has, calls a builder, and spreads the
// result into emitDraftEvent (adding serviceClient/logger).
//
// Privacy: builders only ever copy ids, classification, scalar metrics, and a
// whitelisted `provider` into payload. They never read or forward any body
// field, even if the caller's ctx happens to carry one.

function providerPayload(provider) {
  return provider ? { provider } : {};
}

// draft_edited — emitted from the composer save route when the saved text
// diverged from the AI draft. Dedup is once-per-composer (keyed on the composer
// message id) so repeated autosaves collapse to a single "was edited" signal;
// the authoritative final-edit magnitude comes from draft_sent_with_edit.
export function buildDraftEditedEvent({
  threadId,
  shopId,
  workspaceId,
  agentUserId,
  draftId = null, // pipeline draft_id (draft_generations.draft_id) coupling key
  composerMessageId,
  editClassification,
  provider,
} = {}) {
  return {
    eventType: "draft_edited",
    threadId,
    shopId,
    workspaceId,
    agentUserId,
    draftId,
    generationId: null,
    editClassification: editClassification || null,
    editDistance: null, // draft route computes classification only, no distance
    editDeltaPct: null,
    payload: providerPayload(provider),
    dedupKey: `edit:${threadId}:${composerMessageId}`,
  };
}

// draft_sent (+ optional subtype) — emitted from the send route on a successful
// send. The umbrella always fires; the subtype fires only when an AI baseline
// existed (editClassification is a known value), carrying the edit metrics on
// draft_sent_with_edit.
export function buildDraftSentEvents({
  threadId,
  shopId,
  workspaceId,
  agentUserId,
  draftId = null,
  providerMessageId,
  provider,
  editClassification = null,
  editDistance = null,
  editDeltaPct = null,
} = {}) {
  const base = {
    threadId,
    shopId,
    workspaceId,
    agentUserId,
    draftId,
    generationId: null,
    payload: providerPayload(provider),
  };

  const events = [
    {
      ...base,
      eventType: "draft_sent",
      editClassification: null,
      editDistance: null,
      editDeltaPct: null,
      dedupKey: `sent:${providerMessageId}`,
    },
  ];

  if (editClassification) {
    const isEdit = editClassification !== "no_edit";
    events.push({
      ...base,
      eventType: isEdit ? "draft_sent_with_edit" : "draft_sent_without_edit",
      editClassification,
      // metrics only on with_edit; without_edit leaves them null
      editDistance: isEdit ? editDistance : null,
      editDeltaPct: isEdit ? editDeltaPct : null,
      dedupKey: `sent_sub:${providerMessageId}`,
    });
  }

  return events;
}
