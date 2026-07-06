// Feedback Loop v1: pure helpers for the major-edit distiller.
//
// No Supabase client and no OpenAI client here — the script in
// supabase/scripts/distill-major-edits.mjs does all I/O. These helpers only
// build the classification prompt, parse/validate the LLM response against
// the canonical feedback-suggestions enums, and shape an insert row via
// buildFeedbackSuggestionInsert (which enforces tenancy scope and strips
// body-like keys from evidence_json).
import {
  ROOT_CAUSES,
  SUGGESTION_TYPES,
  buildFeedbackSuggestionInsert,
} from "./feedback-suggestions.js";

export function buildDistillerPrompt({ aiDraftText, finalSentText, ticketCategory }) {
  const system = [
    "Du analyserer hvorfor en supportmedarbejder omskrev et AI-udkast markant. Det gælder på tværs af vilkårlige webshops — antag ingen shop-specifik proces.",
    `Klassificér den PRIMÆRE årsag til omskrivningen som præcis én af: ${[...ROOT_CAUSES].join(", ")}.`,
    `Vælg suggestion_type som præcis én af: ${[...SUGGESTION_TYPES].join(", ")}.`,
    "root_cause skal matche redigeringens RETNING: 'too_verbose' KUN når medarbejderen primært FORKORTEDE svaret. Hvis medarbejderen TILFØJEDE indhold (procedure, viden, betingelser, tal), er årsagen den manglende viden/policy — ikke længde.",
    'Svar KUN med JSON på formen {"root_cause": ..., "suggestion_type": ..., "proposed_change_summary": ..., "confidence": ...}.',
    "proposed_change_summary: 1-2 sætninger på dansk der konkret siger hvad der var GALT med AI-udkastet (hvad manglede/var forkert) — ikke blot hvad medarbejderen gjorde. Parafrasér: citér ALDRIG kundens eller medarbejderens tekst ordret, og medtag ingen navne, emails eller ordrenumre.",
    "confidence: tal mellem 0 og 1.",
  ].join("\n");
  const user = [
    `Ticket-kategori: ${ticketCategory || "ukendt"}`,
    "--- AI-UDKAST ---",
    String(aiDraftText ?? ""),
    "--- MEDARBEJDERENS SENDTE SVAR ---",
    String(finalSentText ?? ""),
  ].join("\n");
  return { system, user };
}

export function parseDistillerResponse(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!ROOT_CAUSES.has(parsed.root_cause)) {
    throw new Error(`unknown root_cause: ${parsed.root_cause}`);
  }
  if (!SUGGESTION_TYPES.has(parsed.suggestion_type)) {
    throw new Error(`unknown suggestion_type: ${parsed.suggestion_type}`);
  }
  const summary = String(parsed.proposed_change_summary ?? "").trim();
  if (!summary) throw new Error("empty proposed_change_summary");
  const confidence = Number(parsed.confidence);
  return {
    root_cause: parsed.root_cause,
    suggestion_type: parsed.suggestion_type,
    proposed_change_summary: summary,
    confidence: Number.isFinite(confidence)
      ? Math.min(Math.max(confidence, 0), 1)
      : 0.5,
  };
}

// Returns buildFeedbackSuggestionInsert's result shape:
// { ok: true, row } | { ok: false, skipped } | { ok: false, errors }.
export function buildSuggestionFromDraftRow({ draftRow, classification }) {
  return buildFeedbackSuggestionInsert({
    shopId: draftRow.shop_id,
    workspaceId: draftRow.workspace_id,
    threadId: draftRow.thread_id || null,
    draftId: draftRow.draft_id,
    suggestionType: classification.suggestion_type,
    rootCause: classification.root_cause,
    confidence: classification.confidence,
    proposedChangeSummary: classification.proposed_change_summary,
    evidence: {
      source: "major_edit_distiller",
      ticket_category: draftRow.ticket_category ?? null,
      edit_delta_pct: draftRow.edit_delta_pct ?? null,
      edit_classification: "major_edit",
    },
    dedupKey: `distill:${draftRow.draft_id}`,
  });
}
