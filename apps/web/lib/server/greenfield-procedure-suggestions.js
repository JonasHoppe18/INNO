import {
  GREENFIELD_PROCEDURE_BLOCK_KINDS,
  buildMerchantKnowledgeSource,
  validateKnowledgePayload,
} from "./greenfield-knowledge";

export const GREENFIELD_PROCEDURE_SUGGESTION_STATUSES = Object.freeze([
  "suggested",
  "reviewed",
  "dismissed",
  "published",
]);

export const PROCEDURE_SUGGESTION_FIELDS = "id,workspace_id,suggestion_key,title,trigger,customer_phrasing_examples,recommended_steps,escalation_condition,policy_dependencies,action_permission_note,historical_evidence_count,confidence,status,provenance,published_knowledge_record_id,reviewed_at,dismissed_at,published_at,created_at,updated_at";

const EDITABLE_STATUSES = new Set(["suggested", "reviewed", "dismissed"]);
const MAX_TITLE_LENGTH = 180;
const MAX_TEXT_LENGTH = 2_000;
const MAX_ALIASES = 20;
const MAX_STEPS = 32;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clean(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function list(value, maxItems = MAX_ALIASES) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map((item) => clean(item)).filter(Boolean))).slice(0, maxItems);
}

function taskKey(value) {
  return clean(value, 120).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
}

export function normalizeSuggestionSteps(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const source = objectValue(item);
      const text = clean(source.text ?? item, 500);
      if (!text) return null;
      const kind = GREENFIELD_PROCEDURE_BLOCK_KINDS.includes(clean(source.kind, 40).toLowerCase())
        ? clean(source.kind, 40).toLowerCase()
        : "instruction";
      const listStyle = source.list_style === "unordered" ? "unordered" : "ordered";
      return { kind, text, list_style: kind === "instruction" ? listStyle : null };
    })
    .filter(Boolean)
    .slice(0, MAX_STEPS);
}

function suggestionConflictWarnings(row) {
  const provenance = objectValue(row?.provenance);
  return list(provenance.policy_conflict_warnings, 12);
}

export function serializeProcedureSuggestion(row) {
  const provenance = objectValue(row?.provenance);
  return {
    id: clean(row?.id, 80),
    suggestion_key: clean(row?.suggestion_key, 120),
    title: clean(row?.title, MAX_TITLE_LENGTH),
    trigger: clean(row?.trigger),
    customer_phrasing_examples: list(row?.customer_phrasing_examples),
    recommended_steps: normalizeSuggestionSteps(row?.recommended_steps),
    escalation_condition: clean(row?.escalation_condition),
    policy_dependencies: list(row?.policy_dependencies, 12),
    action_permission_note: clean(row?.action_permission_note),
    historical_evidence_count: Number(row?.historical_evidence_count || 0),
    confidence: clean(row?.confidence, 20).toUpperCase(),
    status: GREENFIELD_PROCEDURE_SUGGESTION_STATUSES.includes(clean(row?.status, 20).toLowerCase())
      ? clean(row?.status, 20).toLowerCase()
      : "suggested",
    provenance: {
      origin: clean(provenance.origin, 120) || "historical_support_suggestion",
      evidence_count: Number(provenance.evidence_count ?? row?.historical_evidence_count ?? 0),
      confidence_at_creation: clean(provenance.confidence_at_creation, 20).toUpperCase() || clean(row?.confidence, 20).toUpperCase(),
      policy_conflict_warnings: suggestionConflictWarnings(row),
    },
    published_knowledge_record_id: row?.published_knowledge_record_id ? clean(row.published_knowledge_record_id, 80) : null,
    reviewed_at: row?.reviewed_at || null,
    dismissed_at: row?.dismissed_at || null,
    published_at: row?.published_at || null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

export function validateProcedureSuggestionPayload(body, { existing = null } = {}) {
  const input = objectValue(body);
  const current = serializeProcedureSuggestion(existing || {});
  const title = clean(input.title ?? current.title, MAX_TITLE_LENGTH);
  const trigger = clean(input.trigger ?? current.trigger);
  const examples = list(input.customer_phrasing_examples ?? current.customer_phrasing_examples);
  const steps = normalizeSuggestionSteps(input.recommended_steps ?? current.recommended_steps);
  const escalationCondition = clean(input.escalation_condition ?? current.escalation_condition);
  const policyDependencies = list(input.policy_dependencies ?? current.policy_dependencies, 12);
  const actionPermissionNote = clean(input.action_permission_note ?? current.action_permission_note);
  const status = clean(input.status ?? current.status, 20).toLowerCase();
  const errors = [];

  if (!title) errors.push("Title is required.");
  if (!trigger) errors.push("Trigger is required.");
  if (!steps.length) errors.push("Add at least one suggested procedure step.");
  if (!escalationCondition) errors.push("Escalation condition is required.");
  if (!GREENFIELD_PROCEDURE_SUGGESTION_STATUSES.includes(status)) errors.push("Choose a supported suggestion status.");
  if (status === "published") errors.push("Publish through the canonical publish action.");

  return {
    valid: errors.length === 0,
    errors,
    value: {
      title,
      trigger,
      customerPhrasingExamples: examples,
      recommendedSteps: steps,
      escalationCondition,
      policyDependencies,
      actionPermissionNote,
      status,
    },
  };
}

export function buildSuggestionUpdate(value, now = new Date()) {
  const nowIso = now.toISOString();
  return {
    title: value.title,
    trigger: value.trigger,
    customer_phrasing_examples: value.customerPhrasingExamples,
    recommended_steps: value.recommendedSteps,
    escalation_condition: value.escalationCondition,
    policy_dependencies: value.policyDependencies,
    action_permission_note: value.actionPermissionNote,
    status: value.status,
    reviewed_at: value.status === "reviewed" ? nowIso : null,
    dismissed_at: value.status === "dismissed" ? nowIso : null,
  };
}

export function isEditableSuggestionStatus(status) {
  return EDITABLE_STATUSES.has(clean(status, 20).toLowerCase());
}

export function buildPublishedProcedure({ suggestion, value, now = new Date() }) {
  const serialized = serializeProcedureSuggestion(suggestion);
  const content = value.recommendedSteps.map((step) => step.text).join("\n\n");
  const validation = validateKnowledgePayload({
    title: value.title,
    type: "procedure",
    status: "published",
    content,
    task_key: taskKey(serialized.suggestion_key || value.title),
    customer_aliases: value.customerPhrasingExamples,
    procedure_blocks: value.recommendedSteps,
    applies_to: { kind: "all", product_ids: [] },
  });
  if (!validation.valid) throw new Error(validation.errors[0] || "The suggestion cannot be published.");

  const provenance = {
    origin: "historical_support_suggestion",
    suggestion_id: serialized.id,
    suggestion_key: serialized.suggestion_key,
    evidence_count: serialized.historical_evidence_count,
    confidence_at_creation: serialized.confidence,
    policy_conflict_warnings: suggestionConflictWarnings(suggestion),
  };
  const source = buildMerchantKnowledgeSource({
    value: validation.value,
    existing: {
      source_id: `historical-support-suggestion:${serialized.id}`,
      metadata: { historical_support_suggestion: provenance },
    },
    now,
  });
  return { source, provenance, value: validation.value };
}

export { MAX_ALIASES, MAX_STEPS, MAX_TEXT_LENGTH, MAX_TITLE_LENGTH };
