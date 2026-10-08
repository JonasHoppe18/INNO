import { ANSWER_FACETS, compilePreciseAnswerRequests, documentedUnknown, internalAnswerInstruction, sourceSupportsFacet, sourceDomainSupportsFacet, type CoveredAnswerFacet, type PreciseAnswerRequest } from "./answer-facets";
import { isVerifiedOperationalOutcome, operationalReply } from "./operational-execution";
import type { OperationalOutcome } from "./operational-types";
import type { TurnIR } from "./turn-ir";
import { z } from "zod";
import { PRODUCT_AVAILABILITY_STATES } from "./types";
import type { CapabilityManifest, ConversationContext, GreenfieldInteractionChannel, JsonObject, ProposedAction, ToolExecutionResult } from "./types";
import { isExplicitAddressChangeRequest } from "./tool-contracts";
import type { StrictToolDefinition } from "./tool-contracts";

const BasisSchema = z.object({
  result_id: z.string().min(1),
  field_paths: z.array(z.string()).max(32),
}).strict();

const FactKindSchema = z.enum([
  "order_reference",
  "order_item",
  "order_financial_status",
  "order_fulfillment_status",
  "order_amount",
  "line_fulfillment",
  "shipment_item",
  "product_value",
  "product_availability",
  "shipment_carrier",
  "shipment_tracking_number",
  "shipment_status",
  "shipment_event",
  "shipment_timestamp",
  "shipment_location",
  "shipment_eta",
]);

const FactSchema = z.object({
  type: z.literal("fact"),
  fact_kind: FactKindSchema,
  evidence: z.array(BasisSchema).min(1).max(8),
}).strict();

const QuestionSchema = z.object({
  type: z.literal("question"),
  purpose: z.enum([
    "pure_clarification",
    "enable_capability",
    "disambiguate_entity",
    "disambiguate_variant",
    "resolve_required_argument",
    "clarify_task",
    "clarify_item",
  ]),
  text: z.string().nullable(),
  capability: z.string().nullable(),
  missing_arguments: z.array(z.string()).max(32),
  basis: BasisSchema.nullable().optional(),
}).strict();

const LimitationSchema = z.object({
  type: z.literal("limitation"),
  text: z.string().min(1),
  basis: BasisSchema,
}).strict();

const ActionOfferSchema = z.object({
  type: z.literal("action_offer"),
  capability: z.string().min(1),
  mode: z.literal("proposal"),
  missing_arguments: z.array(z.string()).max(32),
}).strict();

const KnowledgeGuidanceSchema = z.object({
  type: z.literal("knowledge_guidance"),
  text: z.string().min(1),
  basis: BasisSchema,
}).strict();

const ProcedureGuidanceSchema = z.object({
  type: z.literal("procedure_guidance"),
  text: z.string().min(1),
  basis: BasisSchema,
  // Stable block identifiers are preferred. step_paths remains accepted for
  // compatibility with older callers and stored traces.
  block_ids: z.array(z.string().min(1)).max(32).optional(),
  step_paths: z.array(z.string().min(1)).max(32).optional(),
}).strict().refine((value) => Boolean(value.block_ids?.length || value.step_paths?.length), {
  message: "Procedure guidance must cite at least one procedure block.",
  path: ["block_ids"],
});

const AcknowledgementSchema = z.object({
  type: z.literal("acknowledgement"),
  kind: z.enum(["resolution", "thanks", "correction", "closure", "transition"]),
}).strict();

export const ResponseSegmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("evidence_limitation"), kind: z.enum(["photo_channel", "charged_shipping", "line_timing", "product_care", "product_property", "line_fulfillment", "shipping_qualification"]), property_key: z.enum(["composition", "dimensions", "general"]).optional(), basis: BasisSchema }).strict(),
  z.object({ type: z.literal("source_content"), kind: z.enum(["product_property", "care_constraint", "policy_condition", "product_constraint"]), facet: z.enum([...ANSWER_FACETS, "qualified_next_step"]).optional(), basis: BasisSchema }).strict(),
  z.object({ type: z.literal("facet_limit"), facet: z.enum([...ANSWER_FACETS, "qualified_next_step"]), request_index: z.number().int().min(0).max(7), basis: BasisSchema }).strict(),
  z.object({ type: z.literal("source_comparison"), kind: z.literal("shipping_threshold"), order: BasisSchema, policy: BasisSchema }).strict(),
  z.object({ type: z.literal("operational_result"), basis: BasisSchema }).strict(),
  FactSchema,
  QuestionSchema,
  LimitationSchema,
  ActionOfferSchema,
  KnowledgeGuidanceSchema,
  ProcedureGuidanceSchema,
  AcknowledgementSchema,
]);

export const StructuredResponseSchema = z.object({
  segments: z.array(ResponseSegmentSchema).min(1).max(12),
}).strict();

export type ResponseSegment = z.infer<typeof ResponseSegmentSchema>;
export type StructuredResponse = z.infer<typeof StructuredResponseSchema>;
type KnowledgeBasis = z.infer<typeof BasisSchema>;
type FactKind = Extract<ResponseSegment, { type: "fact" }>["fact_kind"];

export interface ResponseEvidenceRecord {
  resultId: string;
  toolName: string;
  result: ToolExecutionResult;
}

export interface ResponseValidationIssue {
  index: number | null;
  code: string;
  message: string;
}

export interface CompletenessRecoveryDiagnostic {
  type: string;
  result: "recovered" | "ambiguous" | "unavailable" | "skipped";
}

export interface ResponseCompletenessDiagnostics {
  entered: boolean;
  cues: string[];
  recovery: CompletenessRecoveryDiagnostic[];
  intent_resolved_by_approved_segment?: boolean;
  timing_candidates?: TimingCandidateDiagnostic[];
}

export interface TimingCandidateDiagnostic {
  text: string;
  timing_pattern_detected: boolean;
  event_trigger_detected: boolean;
  duration_detected: boolean;
  explicit_date_detected: boolean;
  subject_outcome_detected: boolean;
  rejected: boolean;
  rejection_reason: string[];
  certified_candidate: boolean;
  conflict_group: string | null;
}

export interface ResponseValidationResult {
  schemaValid: boolean;
  allValid: boolean;
  approvedSegments: ResponseSegment[];
  rejectedSegments: Array<{ index: number; type?: string; issues: ResponseValidationIssue[] }>;
  issues: ResponseValidationIssue[];
  parsed: StructuredResponse | null;
  completenessDiagnostics?: ResponseCompletenessDiagnostics;
  coverage?: AnswerCoverage;
  segmentDiagnostics?: SegmentBoundaryDiagnostic[];
}

export type ResponseFailureClass =
  | "system_tool_failure"
  | "insufficient_knowledge"
  | "insufficient_specificity"
  | "valid_not_found"
  | "model_response_invalid";

export interface ResponseValidationContext {
  turnIR?: TurnIR;
  manifest: CapabilityManifest;
  getResult: (resultId: string) => ResponseEvidenceRecord | undefined;
  definitions: StrictToolDefinition[];
  /** The locale inferred from the current customer request, if it is clear. */
  locale?: ResponseLocale;
  /** Legacy/trusted profile name used as the highest-confidence display source. */
  customerName?: string | null;
  /** Display-only sender/profile name; never used for authorization. */
  customerDisplayName?: string | null;
  /** True only when this is the first substantive response in the conversation. */
  firstResponse?: boolean;
  /** Server-observed proposal results from the current tool loop. */
  proposedActions?: ProposedAction[];
  /** Server-owned active order focus used to avoid re-asking a known order id. */
  activeOrder?: ConversationContext["activeOrder"];
  getActiveOrderFocus?: () => ConversationContext["activeOrder"];
  /** Current customer message used only to avoid repeating a supplied lookup reference. */
  customerMessage?: string;
  /** Customer-supplied continuity hints; never treated as verified operational evidence. */
  customerProvidedContext?: {
    product?: string;
    variant?: string;
    platform?: string;
    issue?: string;
    returnDetails?: string;
    attemptedSteps?: string[];
  };
  /** Server-owned channel context used to adapt source instructions to the current interaction. */
  interactionChannel?: GreenfieldInteractionChannel;
  evidenceScope?: { workspaceId: string; shopId: string };
  operationalScope?: { workspaceId: string; shopId: string; caseId?: string; customerEmail?: string };
  knownCaseArguments?: string[];
  caseState?: ConversationContext["caseState"];
  preciseRequests?: PreciseAnswerRequest[];
  preciseReadResults?: Record<string, string[]>;
  confirmedAction?: (capability: string) => boolean;
  /** Server-owned identity availability; never inferred from untrusted message text. */
  trustedCustomerIdentity?: {
    verified: boolean;
    hasName: boolean;
    hasEmail: boolean;
  };
  /** Server-recorded results from this run, used to ground generic clarification purposes. */
  getResults?: () => ResponseEvidenceRecord[];
}

export type ResponseLocale = "da" | "en";

function parseInput(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function pathParts(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
}

function fieldValue(value: unknown, path: string): { exists: boolean; value: unknown } {
  const parts = pathParts(path);
  if (!parts.length) return { exists: false, value: undefined };
  let current: unknown = value;
  for (const part of parts) {
    if (current === null || current === undefined || (typeof current !== "object" && !Array.isArray(current))) {
      return { exists: false, value: undefined };
    }
    if (!(part in (current as object))) return { exists: false, value: undefined };
    current = (current as Record<string, unknown>)[part];
  }
  return { exists: true, value: current };
}

function dataFieldValue(result: ToolExecutionResult, path: string) {
  const dataPath = path.startsWith("data.") ? path.slice("data.".length) : path;
  return fieldValue(result.data, dataPath);
}

function resultFieldValue(result: ToolExecutionResult, path: string) {
  const envelopeField = fieldValue(result, path);
  if (envelopeField.exists) return envelopeField;
  return dataFieldValue(result, path);
}

function meaningful(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function resultFor(basis: { result_id: string }, context: ResponseValidationContext) {
  return context.getResult(basis.result_id);
}

function effectiveResultStatus(evidence: ResponseEvidenceRecord | undefined) {
  if (!evidence) return null;
  if (evidence.result.status !== "ok") return evidence.result.status;
  if (!["get_product", "get_product_availability"].includes(evidence.toolName)) return evidence.result.status;
  const data = objectValue(evidence.result.data);
  const nestedStatus = typeof data?.status === "string" ? data.status : null;
  return nestedStatus && ["not_found", "unknown", "unavailable"].includes(nestedStatus)
    ? nestedStatus
    : evidence.result.status;
}

function validateBasis(
  basis: { result_id: string; field_paths: string[] },
  context: ResponseValidationContext,
  options: { requireOk: boolean; requireMeaningfulFields: boolean; scope: "data" | "result" },
  index: number,
): ResponseValidationIssue[] {
  const evidence = resultFor(basis, context);
  if (!evidence) return [{ index, code: "unknown_result_id", message: "The response references a tool result from outside this run." }];
  if (options.requireOk && evidence.result.status !== "ok") {
    return [{ index, code: "result_not_verified", message: "The referenced tool result is not a successful verified result." }];
  }
  if (options.requireMeaningfulFields && !basis.field_paths.length) {
    return [{ index, code: "field_path_required", message: "A fact or guidance segment must cite at least one returned field." }];
  }
  const issues: ResponseValidationIssue[] = evidenceScopeIssues(evidence, context, index);
  for (const path of basis.field_paths) {
    const field = options.scope === "data"
      ? dataFieldValue(evidence.result, path)
      : resultFieldValue(evidence.result, path);
    if (!field.exists) {
      issues.push({ index, code: "unknown_field_path", message: `The referenced field was not returned by ${evidence.toolName}.` });
    } else if (options.requireMeaningfulFields && !meaningful(field.value)) {
      issues.push({ index, code: "empty_field", message: `The referenced field from ${evidence.toolName} is null or empty.` });
    }
  }
  return issues;
}

function validateKnowledgeBasis(
  basis: { result_id: string; field_paths: string[] },
  context: ResponseValidationContext,
  index: number,
): ResponseValidationIssue[] {
  const issues = validateBasis(basis, context, { requireOk: true, requireMeaningfulFields: true, scope: "data" }, index);
  if (issues.length) return issues;
  const evidence = resultFor(basis, context);
  const data = objectValue(evidence?.result.data);
  const results = data?.results;
  if (!Array.isArray(results) || !results.length) {
    return [{ index, code: "knowledge_evidence_missing", message: "The referenced result does not contain retrieved knowledge evidence." }];
  }
  const citedRecords = citedKnowledgeRecords(results, basis.field_paths);
  const supported = citedRecords.length > 0 && citedRecords.every((item) => {
    const record = objectValue(item);
    if (!record) return false;
    const authority = String(record.authority ?? "");
    if (["authoritative", "operational", "guidance"].includes(authority)) return true;
    return record.knowledge_type === "product" && authority === "reference"
      && (evidence?.toolName === "search_product_knowledge" || (meaningful(objectValue(record.provenance)?.source_id)
        && objectValue(record.structured_data)?.semantic_type === "FACT" && objectValue(record.structured_data)?.support_domain === "product"));
  });
  if (!supported) {
    return [{ index, code: "knowledge_authority_insufficient", message: "The cited knowledge source cannot support this guidance." }];
  }
  return [];
}

type PolicyTruthState = "allowed" | "disallowed" | "conditional";
type PolicyTruthConfidence = "structured" | "prose_strong" | "prose_ambiguous";

type PolicyTruthRule = {
  state: PolicyTruthState;
  confidence: PolicyTruthConfidence;
  sourceText: string;
  conditionText?: string;
  consequenceText?: string;
};

type PolicyTruthDecision =
  | { kind: "none" }
  | { kind: "correct"; rule: PolicyTruthRule }
  | { kind: "ambiguous" };

function policyTextValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const values = value.map(policyTextValue).filter((item): item is string => Boolean(item));
    return values.length ? values.join("; ") : undefined;
  }
  return undefined;
}

function policyTruthState(value: unknown, hasCondition = false, hasConsequence = false): PolicyTruthState | null {
  if (value === false) return "disallowed";
  if (value === true) return hasCondition || hasConsequence ? "conditional" : "allowed";
  const text = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (hasCondition || hasConsequence || /conditional|subject_to|depends|with_condition/.test(text)) return "conditional";
  if (/disallow|prohibit|forbidden|ineligible|not_eligible|not_allowed|rejected|reject|denied|not_covered|cannot/.test(text)) return "disallowed";
  if (/allow|allowed|permit|permitted|eligible|accepted|covered|available|ship|return|refund|true/.test(text)) return "allowed";
  return null;
}

function structuredPolicyTruthRules(record: JsonObject): PolicyTruthRule[] {
  const structuredData = objectValue(record.structured_data);
  if (!structuredData) return [];
  const candidates: unknown[] = [
    structuredData.policy_truth,
    structuredData.policyTruth,
    structuredData.policy_rules,
    structuredData.policyRules,
    structuredData.policy,
  ];
  const entries = candidates.flatMap((candidate) => {
    if (Array.isArray(candidate)) return candidate;
    const object = objectValue(candidate);
    if (!object) return [];
    return Array.isArray(object.rules) ? object.rules : [object];
  });
  return entries.flatMap((entry) => {
    const rule = objectValue(entry);
    if (!rule) return [];
    const conditionText = policyTextValue(rule.condition ?? rule.conditions ?? rule.requirement ?? rule.requirements);
    const consequenceText = policyTextValue(rule.consequence ?? rule.consequences ?? rule.deduction ?? rule.exception);
    const state = policyTruthState(rule.eligibility ?? rule.outcome ?? rule.status ?? rule.allowed, Boolean(conditionText), Boolean(consequenceText));
    if (!state) return [];
    const sourceText = policyTextValue(rule.source_text ?? rule.sourceText ?? rule.text ?? rule.evidence)
      ?? [conditionText, consequenceText].filter(Boolean).join(". ");
    return sourceText ? [{ state, confidence: "structured", sourceText, conditionText, consequenceText }] : [];
  });
}

function policyEvidenceUnits(value: string): string[] {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((unit) => unit.trim())
    .filter(Boolean);
}

function policyAllowanceSignal(value: string): boolean {
  return /\b(?:allow(?:ed)?|accept(?:ed|s)?|eligible|permit(?:ted)?|cover(?:ed|s)?|available|ship(?:ped|s)?|can|could|may|akzeptiert|kann|accepter(?:et|es)?|berettig(?:et|ede)?|dækk(?:et|es)?|kan|må|tilladt|angenommen|berechtigt|abgedeckt|versendet)\b/i.test(value);
}

function policyProhibitionSignal(value: string): boolean {
  const explicitConditional = /\b(?:only\s+(?:if|when)|nur\s+(?:wenn|bei)|kun\s+hvis|alleen\s+als)\b/i.test(value);
  const explicitNegative = /\b(?:not\s+(?:allowed|eligible|permitted|accepted|covered|available)|cannot|can't|prohibited|forbidden|rejected|denied|not\s+possible|ikke\s+(?:tilladt|berettiget|accepteret|dækket|muligt)|kan\s+ikke|må\s+ikke|afvis(?:es|t)?|nicht\s+(?:zulässig|berechtigt|angenommen|abgedeckt|möglich)|kann\s+nicht|darf\s+nicht|abgelehnt|verboten)\b/i.test(value)
    || /\b(?:can|kan|kann)\b[\s\S]{0,48}\b(?:rejected|abgelehnt|afvist|afvises)\b/i.test(value);
  if (explicitNegative) return true;
  if (explicitConditional) return false;
  return /\b(?:only|nur|kun)\b[\s\S]{0,120}\b(?:return|retur|rückgabe|zurück|eligible|berettig|tilladt|berechtigt)\b/i.test(value)
    || /\b(?:return|retur|rückgabe|zurück|eligible|berettig|tilladt|berechtigt)\b[\s\S]{0,120}\b(?:only|nur|kun)\b/i.test(value);
}

function policyConditionSignal(value: string): boolean {
  return /\b(?:if|when|unless|except|once|only\s+if|only\s+when|subject\s+to|provided|depending|may\s+still|can\s+still|within|under|before|after|requires?|requirement|condition|eligible|eligibility|for|deduct(?:ion|ed)?|fee|proof|restricted|hvis|når|medmindre|undtagen|kun\s+hvis|forudsat|afhængig|kan\s+stadig|inden|under|kræver|betingelse|berettig(?:et|ede)?|fradrag|gebyr|bevis|begrænset|wenn|außer|sobald|vorausgesetzt|abhängig|kann\s+weiterhin|innerhalb|erfordert|Bedingung|Abzug|Nachweis|beschränkt)\b/i.test(value);
}

function prosePolicyConsequenceSignal(value: string): boolean {
  return /\b(?:deduct(?:ion|ed)?|fee|refund|restricted|responsib(?:le|ility)|shipping\s+cost|fradrag|fratrækk(?:es|e|et)?|trækk(?:es|e|et)?|gebyr|refunder(?:es|et)?|begrænset|ansvar(?:lig|et)?|returporto|returfragt|abzug|gebühr|erstatt(?:et|ung)|verantwortlich|versandkosten)\b/i.test(value)
    || /\b(?:not|ikke|nicht)\b[\s\S]{0,32}\b(?:allowed|eligible|permitted|covered|tilladt|berettiget|zulässig|berechtigt)\b/i.test(value);
}

function prosePolicyTruthRules(record: JsonObject): PolicyTruthRule[] {
  const sections = Array.isArray(record.evidence_sections)
    ? record.evidence_sections
      .map((section) => objectValue(section)?.content ?? objectValue(section)?.text)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const content = [
    typeof record.content === "string" ? record.content : "",
    ...sections,
  ].filter(Boolean).join("\n");
  return policyEvidenceUnits(content).flatMap((unit): PolicyTruthRule[] => {
    const hasAllowance = policyAllowanceSignal(unit);
    const hasProhibition = policyProhibitionSignal(unit);
    const hasCondition = policyConditionSignal(unit);
    const hasConsequence = prosePolicyConsequenceSignal(unit);
    if (!hasAllowance && !hasProhibition) return [];
    if (hasProhibition && !/\b(?:may\s+still|can\s+still|kan\s+stadig|kann\s+weiterhin|still\s+(?:be|return)|weiterhin)\b/i.test(unit)) {
      return [{
        state: "disallowed" as const,
        confidence: hasCondition ? "prose_strong" : "prose_ambiguous",
        sourceText: unit,
      }];
    }
    if (hasAllowance) {
      return [{
        state: hasCondition ? "conditional" as const : "allowed" as const,
        confidence: hasCondition && hasConsequence ? "prose_strong" : "prose_ambiguous",
        sourceText: unit,
      }];
    }
    return [];
  });
}

function policyTruthRulesForBasis(
  basis: KnowledgeBasis,
  context: ResponseValidationContext,
): PolicyTruthRule[] {
  const evidence = resultFor(basis, context);
  if (!evidence || evidence.toolName !== "search_policy" || evidence.result.status !== "ok") return [];
  const data = objectValue(evidence.result.data);
  const results = Array.isArray(data?.results) ? data.results : [];
  return citedKnowledgeRecords(results, basis.field_paths)
    .flatMap((item) => {
      const record = objectValue(item);
      if (!record || String(record.authority ?? "") !== "authoritative") return [];
      const structured = structuredPolicyTruthRules(record);
      return structured.length ? structured : prosePolicyTruthRules(record);
    });
}

function policyRuleMatchScore(rule: PolicyTruthRule, message: string): number {
  const messageWords = new Set(String(message ?? "").toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  const ruleWords = `${rule.sourceText} ${rule.conditionText ?? ""} ${rule.consequenceText ?? ""}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return Array.from(new Set(ruleWords)).filter((word) => messageWords.has(word)).length;
}

function selectedPolicyTruthRule(rules: PolicyTruthRule[], customerMessage: string): PolicyTruthRule | null | "ambiguous" {
  if (!rules.length) return null;
  const focus = customerKnowledgeFocus(customerMessage);
  const conditionRules = focus.asksCondition
    ? rules.filter((rule) => rule.consequenceText || /\b(?:may\s+still|can\s+still|deduct(?:ion|ed)?|fee|proof|condition|restricted|kan\s+stadig|kann\s+weiterhin)\b/i.test(rule.sourceText))
    : rules;
  const scored = (conditionRules.length ? conditionRules : rules).map((rule) => ({ rule, score: policyRuleMatchScore(rule, customerMessage) }));
  const highest = Math.max(...scored.map(({ score }) => score));
  const candidates = scored.filter(({ score }) => score === highest).map(({ rule }) => rule);
  const states = new Set(candidates.map((rule) => rule.state));
  if (states.size > 1) return "ambiguous";
  return candidates[0] ?? null;
}

function modelClaimsPolicySubject(value: string, rule: PolicyTruthRule): boolean {
  const source = `${rule.sourceText} ${rule.conditionText ?? ""} ${rule.consequenceText ?? ""}`;
  if (/\b(?:return\w*|retur\w*|rückgabe\w*|zurück\w*)\b/i.test(source)) return /\b(?:return\w*|retur\w*|rückgabe\w*|zurück\w*|items?|products?|varer?|vare|artik(?:el|ler))\b/i.test(value);
  if (/\b(?:warranty|garanti\w*)\b/i.test(source)) return /\b(?:warranty|garanti\w*|claim|dækket|covered|abgedeckt)\b/i.test(value);
  if (/\b(?:ship\w*|delivery|levering|versand)\b/i.test(source)) return /\b(?:ship\w*|delivery|lever\w*|versand|send)\b/i.test(value);
  return true;
}

function modelClaimsPolicyPermission(value: string, rule: PolicyTruthRule): boolean {
  return modelClaimsPolicySubject(value, rule)
    && !policyConditionSignal(value)
    && (/\b(?:return(?:s|ed|able)?|item|product|warranty|claim)\b[\s\S]{0,64}\b(?:allow(?:ed)?|accept(?:ed|s)?|eligible|permit(?:ted)?|cover(?:ed|s)?|available)\b/i.test(value)
    || /\b(?:you|customers?|items?|products?|returns?)\b[\s\S]{0,24}\b(?:can|could|may)\b[\s\S]{0,24}\b(?:return(?:ed)?|be\s+returned|be\s+covered)\b/i.test(value)
    || /\bwe\s+ship\b/i.test(value));
}

function modelClaimsPolicyProhibition(value: string, rule: PolicyTruthRule): boolean {
  return modelClaimsPolicySubject(value, rule) && policyProhibitionSignal(value);
}

function modelHasUnqualifiedPermission(value: string, rule: PolicyTruthRule): boolean {
  if (!policyAllowanceSignal(value) || !modelClaimsPolicyPermission(value, rule) || policyProhibitionSignal(value)) return false;
  if (/:\s*$/.test(value)) return false;
  if (rule.state === "disallowed") return true;
  const absolute = /\b(?:always|every|all|any|regardless|without\s+(?:condition|restriction)|worldwide|everywhere|automatically|full(?:y)?|altid|alle|enhver|uanset|overalt|immer|alle|jeder|weltweit|überall)\b/i.test(value);
  const repeatsCondition = Boolean(rule.conditionText && policyRuleMatchScore({ ...rule, sourceText: rule.conditionText ?? "" }, value) > 0);
  return absolute || (!repeatsCondition && Boolean(rule.conditionText || rule.consequenceText || policyConditionSignal(rule.sourceText)) && !policyConditionSignal(value));
}

function policyContradictionDecision(value: string, rules: PolicyTruthRule[], customerMessage: string): PolicyTruthDecision {
  const selected = selectedPolicyTruthRule(rules, customerMessage);
  if (selected === "ambiguous") return { kind: "ambiguous" };
  if (!selected) return { kind: "none" };
  const hasPolicyProhibition = policyEvidenceUnits(value).some((unit) => modelClaimsPolicyProhibition(unit, selected));
  const hasUnqualifiedPermission = policyEvidenceUnits(value).some((unit) => modelHasUnqualifiedPermission(unit, selected));
  const contradiction = (selected.state === "conditional" && (hasPolicyProhibition || hasUnqualifiedPermission))
    || (selected.state === "allowed" && hasPolicyProhibition)
    || (selected.state === "disallowed" && hasUnqualifiedPermission);
  if (contradiction && selected.confidence === "prose_ambiguous") return { kind: "ambiguous" };
  if (selected.state === "conditional" && (hasPolicyProhibition || hasUnqualifiedPermission)) {
    return { kind: "correct", rule: selected };
  }
  if (selected.state === "allowed" && hasPolicyProhibition) {
    return { kind: "correct", rule: selected };
  }
  if (selected.state === "disallowed" && hasUnqualifiedPermission) {
    return { kind: "correct", rule: selected };
  }
  return { kind: "none" };
}

function replaceContradictoryPolicyText(value: string, rule: PolicyTruthRule): string {
  const units = policyEvidenceUnits(value);
  const contradictory = units.map((unit) => modelClaimsPolicyProhibition(unit, rule) || modelHasUnqualifiedPermission(unit, rule));
  const first = contradictory.findIndex(Boolean);
  if (first < 0) return rule.sourceText;
  return units
    .map((unit, index) => index === first ? rule.sourceText : (contradictory[index] ? "" : unit))
    .filter(Boolean)
    .join(" ");
}

function validatePolicyTruth(
  segment: Extract<ResponseSegment, { type: "knowledge_guidance" }>,
  context: ResponseValidationContext,
  index: number,
): ResponseValidationIssue[] {
  const decision = policyContradictionDecision(segment.text, policyTruthRulesForBasis(segment.basis, context), context.customerMessage ?? "");
  return decision.kind === "ambiguous"
    ? [{ index, code: "policy_truth_ambiguous", message: "The authoritative policy contains conflicting conditions, so the response was withheld rather than guessing." }]
    : [];
}

function policyTextForRendering(
  value: string,
  basis: KnowledgeBasis,
  context: ResponseValidationContext,
): string {
  const decision = policyContradictionDecision(value, policyTruthRulesForBasis(basis, context), context.customerMessage ?? "");
  return decision.kind === "correct" ? replaceContradictoryPolicyText(value, decision.rule) : value;
}

function procedureStepPath(path: string, defaultResultIndex?: number): { resultIndex: number; stepIndex: number } | null {
  const normalized = normalizedDataPath(path);
  const match = normalized.match(/^results(?:\[(\d+)\]|\.(\d+))\.structured_data\.procedure_steps(?:\[(\d+)\]|\.(\d+))(?:\.text)?$/);
  if (match) return { resultIndex: Number(match[1] ?? match[2]), stepIndex: Number(match[3] ?? match[4]) };
  const relative = normalized.match(/^structured_data\.procedure_steps(?:\[(\d+)\]|\.(\d+))(?:\.text)?$/);
  return relative && defaultResultIndex != null
    ? { resultIndex: defaultResultIndex, stepIndex: Number(relative[1] ?? relative[2]) }
    : null;
}

function procedureStepCollectionResult(path: string, defaultResultIndex?: number): number | null {
  const normalized = normalizedDataPath(path);
  const match = normalized.match(/^results(?:\[(\d+)\]|\.(\d+))\.structured_data\.procedure_steps$/);
  if (match) return Number(match[1] ?? match[2]);
  return normalized === "structured_data.procedure_steps" && defaultResultIndex != null
    ? defaultResultIndex
    : null;
}

/**
 * Some SDK responses cite the complete returned procedure_steps array rather
 * than enumerating every item. Expand that source-bound collection reference
 * into stable individual paths; it never creates steps that the tool did not
 * return and still preserves record/step ordering during validation/rendering.
 */
function expandedProcedureStepPaths(
  paths: string[],
  result: ToolExecutionResult,
  defaultResultIndex: number,
): string[] {
  return paths.flatMap((path) => {
    if (procedureStepPath(path, defaultResultIndex)) return [path];
    const resultIndex = procedureStepCollectionResult(path, defaultResultIndex);
    if (resultIndex == null) return [path];
    return procedureBlocks(result, resultIndex).map((entry) => `data.results[${resultIndex}].structured_data.procedure_steps[${entry.index}]`);
  });
}

function resultIndexFromPath(path: string): number | null {
  const normalized = normalizedDataPath(path);
  const match = normalized.match(/^results(?:\[(\d+)\]|\.(\d+))(?:\.|$)/);
  return match ? Number(match[1] ?? match[2]) : null;
}

function procedureStepDataPath(path: string, defaultResultIndex?: number) {
  const normalized = normalizedDataPath(path);
  return defaultResultIndex != null && normalized.startsWith("structured_data.")
    ? `data.results[${defaultResultIndex}].${normalized}`
    : path;
}

function procedureStepObject(result: ToolExecutionResult, path: string, defaultResultIndex?: number): JsonObject | null {
  const effectivePath = procedureStepDataPath(path, defaultResultIndex).replace(/\.text$/i, "");
  return objectValue(dataFieldValue(result, effectivePath).value);
}

function procedureStepValue(result: ToolExecutionResult, path: string, defaultResultIndex?: number): unknown {
  const effectivePath = procedureStepDataPath(path, defaultResultIndex);
  const field = dataFieldValue(result, effectivePath);
  if (!field.exists) return undefined;
  const object = objectValue(field.value);
  return object && "text" in object ? object.text : field.value;
}

function procedureBlocks(result: ToolExecutionResult, resultIndex: number): Array<{ index: number; block: JsonObject; blockId: string }> {
  const data = objectValue(result.data);
  const results = Array.isArray(data?.results) ? data.results : [];
  const record = objectValue(results[resultIndex]);
  const structuredData = objectValue(record?.structured_data);
  const blocks = Array.isArray(structuredData?.procedure_steps)
    ? structuredData.procedure_steps
    : Array.isArray(structuredData?.procedure_blocks)
      ? structuredData.procedure_blocks
      : [];
  return blocks.map((value, index) => {
    const block = objectValue(value) ?? {};
    return {
      index,
      block,
      blockId: String(block.block_id ?? block.id ?? `block_${index + 1}`),
    };
  });
}

function normalizedPhrase(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function procedureProductMismatch(
  results: unknown[],
  customerMessage: string | undefined,
  citedResultIndex: number,
  index: number,
): ResponseValidationIssue[] {
  if (!customerMessage) return [];
  const message = ` ${normalizedPhrase(customerMessage)} `;
  const matchingModels = results.flatMap((item, resultIndex) => {
    const record = objectValue(item);
    const structuredData = objectValue(record?.structured_data);
    const appliesTo = objectValue(structuredData?.applies_to);
    const models = Array.isArray(appliesTo?.product_models) ? appliesTo.product_models : [];
    return models
      .map((model) => ({ model: normalizedPhrase(model), resultIndex }))
      .filter(({ model }) => model && message.includes(` ${model} `));
  });
  if (!matchingModels.length) return [];
  const longest = Math.max(...matchingModels.map(({ model }) => model.length));
  const expectedIndexes = new Set(
    matchingModels.filter(({ model }) => model.length === longest).map(({ resultIndex }) => resultIndex),
  );
  return expectedIndexes.has(citedResultIndex)
    ? []
    : [{
        index,
        code: "procedure_product_mismatch",
        message: "The selected procedure does not apply to the product named by the customer.",
      }];
}

function validateProcedureGuidance(
  segment: Extract<ResponseSegment, { type: "procedure_guidance" }>,
  context: ResponseValidationContext,
  index: number,
): ResponseValidationIssue[] {
  const issues = validateKnowledgeBasis(segment.basis, context, index);
  const evidence = resultFor(segment.basis, context);
  if (!semanticProcedureSource(evidence)) {
    issues.push({ index, code: "procedure_source_required", message: "Procedure guidance requires verified procedural evidence and authority." });
    return issues;
  }
  const results = objectValue(evidence.result.data)?.results;
  if (!Array.isArray(results)) {
    issues.push({ index, code: "procedure_evidence_missing", message: "The referenced procedure result does not contain retrieved procedure evidence." });
    return issues;
  }
  const citedIndexes = new Set(
    segment.basis.field_paths
      .map(resultIndexFromPath)
      .filter((value): value is number => value != null),
  );
  if (citedIndexes.size !== 1) {
    issues.push({ index, code: "procedure_source_ambiguous", message: "Procedure guidance must cite exactly one retrieved procedure record." });
    return issues;
  }
  const citedResultIndex = Array.from(citedIndexes)[0];
  const citedRecord = objectValue(results[citedResultIndex]);
  if (citedRecord?.knowledge_type !== "procedural" || !["authoritative", "operational"].includes(String(citedRecord.authority))) {
    issues.push({ index, code: "procedure_source_required", message: "Procedure guidance must cite a procedural knowledge record." });
  }
  const applies = objectValue(objectValue(citedRecord?.structured_data)?.applicability);
  if (applies?.kind === "products" && citedRecord && !productScopeSupported(citedRecord, context)) {
    issues.push({ index, code: "procedure_product_mismatch", message: "The selected procedure is not bound to the current product." });
  }
  const blockIds = segment.block_ids?.length ? segment.block_ids : null;
  const availableBlocks = procedureBlocks(evidence.result, citedResultIndex);
  const blocksById = new Map(availableBlocks.map((entry) => [entry.blockId, entry]));
  const references = blockIds
    ? blockIds.map((blockId) => blocksById.get(blockId)).filter((entry): entry is (typeof availableBlocks)[number] => Boolean(entry))
    : [];
  if (blockIds) {
    const foundIds = new Set(references.map((entry) => entry.blockId));
    for (const blockId of blockIds) {
      if (!foundIds.has(blockId)) {
        issues.push({ index, code: "procedure_block_missing", message: "A cited procedure block was not returned by the tool." });
      }
    }
    if (new Set(availableBlocks.map(entry => entry.blockId)).size !== availableBlocks.length) {
      issues.push({ index, code: "procedure_block_identity_ambiguous", message: "Returned procedure block identifiers are not unique." });
    }
    for (const entry of references) {
      if (!meaningful(entry.block.text)) {
        issues.push({ index, code: "procedure_block_missing", message: "A cited procedure block was empty." });
      }
    }
    for (let blockIndex = 1; blockIndex < references.length; blockIndex += 1) {
      if (references[blockIndex - 1].index >= references[blockIndex].index) {
        issues.push({ index, code: "procedure_step_order", message: "Procedure block references must remain in source order." });
        break;
      }
    }
  } else {
    const paths = expandedProcedureStepPaths(segment.step_paths ?? [], evidence.result, citedResultIndex)
      .map((path) => ({ path, parsed: procedureStepPath(path, citedResultIndex) }));
    if (paths.some(({ parsed }) => !parsed)) {
      issues.push({ index, code: "procedure_step_path_invalid", message: "Procedure steps must cite returned structured procedure step fields." });
      return issues;
    }
    if (paths.some(({ parsed }) => parsed!.resultIndex !== citedResultIndex)) {
      issues.push({ index, code: "procedure_cross_record_merge", message: "Procedure guidance cannot combine steps from different retrieved records." });
    }
    for (const { path } of paths) {
      const value = procedureStepValue(evidence.result, path, citedResultIndex);
      if (!meaningful(value)) {
        issues.push({ index, code: "procedure_step_missing", message: "A cited procedure step was not returned by the tool." });
      }
    }
    for (let stepIndex = 1; stepIndex < paths.length; stepIndex += 1) {
      if (paths[stepIndex - 1].parsed!.stepIndex >= paths[stepIndex].parsed!.stepIndex) {
        issues.push({ index, code: "procedure_step_order", message: "Procedure step references must remain in source order." });
        break;
      }
    }
  }
  issues.push(...procedureProductMismatch(results, context.customerMessage, citedResultIndex, index));
  return issues;
}

function citesProceduralKnowledge(
  basis: { result_id: string; field_paths: string[] },
  context: ResponseValidationContext,
): boolean {
  const evidence = resultFor(basis, context);
  if (!semanticProcedureSource(evidence)) return false;
  const data = objectValue(evidence.result.data);
  const results = Array.isArray(data?.results) ? data.results : [];
  return citedKnowledgeRecords(results, basis.field_paths).some((item) => objectValue(item)?.knowledge_type === "procedural");
}

function citedKnowledgeRecords(results: unknown[], fieldPaths: string[]) {
  const normalizedPaths = fieldPaths.map(normalizedDataPath);
  const indexed = new Set<number>();
  let citesWholeCollection = false;
  for (const path of normalizedPaths) {
    const resultIndex = resultIndexFromPath(path);
    if (resultIndex != null) indexed.add(resultIndex);
    else if (path === "results" || path.startsWith("results.")) citesWholeCollection = true;
  }
  if (citesWholeCollection) return results;
  return Array.from(indexed).map((index) => results[index]).filter((item) => item !== undefined);
}

function normalizedDataPath(path: string): string {
  return (path.startsWith("data.") ? path.slice("data.".length) : path)
    .replace(/\.(\d+)(?=\.|$)/g, "[$1]");
}

function pathHasSuffix(path: string, suffix: string): boolean {
  const normalized = normalizedDataPath(path);
  return normalized === suffix || normalized.endsWith(`.${suffix}`);
}

function pathHasAnySuffix(path: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => pathHasSuffix(path, suffix));
}

const SAFE_LIVE_PRODUCT_FIELDS = new Set([
  "title",
  "handle",
  "sku",
  "price",
  "compare_at_price",
  "option1",
  "option2",
  "option3",
  "weight",
  "weight_unit",
  "requires_shipping",
]);

const UNSUPPORTED_PRODUCT_FIELDS = new Set([
  "inventory_quantity",
  "old_inventory_quantity",
  "inventory_management",
  "inventory_policy",
]);

function safeLiveProductFieldPath(path: string): boolean {
  const normalized = normalizedDataPath(path);
  const match = normalized.match(/^products\[\d+\](?:\.variants\[\d+\])?\.([a-z0-9_]+)$/i);
  if (!match) return false;
  const field = match[1].toLowerCase();
  return !UNSUPPORTED_PRODUCT_FIELDS.has(field) && SAFE_LIVE_PRODUCT_FIELDS.has(field);
}

function unsupportedLiveProductFieldPath(path: string): boolean {
  const normalized = normalizedDataPath(path);
  const match = normalized.match(/^products\[\d+\](?:\.variants\[\d+\])?\.([a-z0-9_]+)$/i);
  return Boolean(match && UNSUPPORTED_PRODUCT_FIELDS.has(match[1].toLowerCase()));
}

function safeLiveProductAvailabilityFieldPath(path: string): boolean {
  return /^products\[\d+\]\.variants\[\d+\]\.availability_state$/i.test(normalizedDataPath(path));
}

function pathHasIndexedProperty(path: string, collectionPath: string, property: string): boolean {
  const normalized = normalizedDataPath(path);
  return normalized.includes(`${collectionPath}[`) && normalized.endsWith(`.${property}`);
}

function indexedCollectionProperty(path: string, collection: string, property: string): { index: string; property: string } | null {
  const normalized = normalizedDataPath(path);
  const marker = `${collection}[`;
  const start = normalized.indexOf(marker);
  if (start < 0 || !normalized.endsWith(`.${property}`)) return null;
  const indexStart = start + marker.length;
  const indexEnd = normalized.indexOf("]", indexStart);
  if (indexEnd < 0) return null;
  return { index: normalized.slice(indexStart, indexEnd), property };
}

type ItemPath = {
  scope: "order" | "fulfillment";
  fulfillmentIndex: string | null;
  index: string | null;
  property: "collection" | "object" | "title" | "quantity";
};

function itemPath(path: string): ItemPath | null {
  const normalized = normalizedDataPath(path);
  const fulfillmentMatch = normalized.match(/(?:^|\.)fulfillments\[(\d+)\]\.items(?:\[(\d+)\])?(?:\.(title|quantity))?$/i);
  if (fulfillmentMatch) {
    return {
      scope: "fulfillment",
      fulfillmentIndex: fulfillmentMatch[1],
      index: fulfillmentMatch[2] ?? null,
      property: (fulfillmentMatch[3] as ItemPath["property"] | undefined) ?? (fulfillmentMatch[2] == null ? "collection" : "object"),
    };
  }
  const match = normalized.match(/(?:^|\.)items(?:\[(\d+)\])?(?:\.(title|quantity))?$/i);
  if (!match) return null;
  if (match[1] == null) return { scope: "order", fulfillmentIndex: null, index: null, property: "collection" };
  return { scope: "order", fulfillmentIndex: null, index: match[1], property: (match[2] as ItemPath["property"] | undefined) ?? "object" };
}

function itemPathBase(path: string, index: string): string | null {
  const normalized = normalizedDataPath(path);
  const marker = `items[${index}]`;
  const markerIndex = normalized.lastIndexOf(marker);
  return markerIndex < 0 ? null : normalized.slice(0, markerIndex + marker.length);
}

function siblingItemValue(evidence: ResponseEvidenceRecord | undefined, path: string, index: string, property: "title" | "quantity") {
  const base = itemPathBase(path, index);
  return evidence && base ? dataFieldValue(evidence.result, `${base}.${property}`) : { exists: false, value: undefined };
}

function fieldPathMatchesFactKind(factKind: FactKind, path: string): boolean {
  switch (factKind) {
    case "order_amount":
      return ["total", "currency"].includes(normalizedDataPath(path));
    case "line_fulfillment":
      return /^items\[\d+\]$/.test(normalizedDataPath(path));
    case "order_reference":
      return pathHasAnySuffix(path, ["orderNumber", "order_number"]);
    case "order_financial_status":
      return pathHasAnySuffix(path, ["financialStatus", "financial_status"]);
    case "order_fulfillment_status":
      return pathHasAnySuffix(path, ["fulfillmentStatus", "fulfillment_status"]);
    case "shipment_carrier":
      return pathHasAnySuffix(path, ["carrier"]);
    case "shipment_tracking_number":
      return pathHasAnySuffix(path, ["trackingNumber", "tracking_number"]);
    case "shipment_status":
      return pathHasAnySuffix(path, ["live_tracking.status"]);
    case "shipment_event":
      return pathHasAnySuffix(path, ["live_tracking.latestEvent.description"])
        || Boolean(normalizedDataPath(path).match(/live_tracking\.checkpoints\[\d+\]\.description$/));
    case "shipment_timestamp":
      return pathHasAnySuffix(path, ["live_tracking.latestEvent.timestamp"])
        || pathHasIndexedProperty(path, "live_tracking.checkpoints", "timestamp");
    case "shipment_location":
      return pathHasAnySuffix(path, ["live_tracking.latestEvent.location"])
        || pathHasIndexedProperty(path, "live_tracking.checkpoints", "location");
    case "shipment_eta":
      return pathHasAnySuffix(path, ["live_tracking.estimatedDelivery"]);
    case "order_item":
      return itemPath(path)?.scope === "order";
    case "shipment_item":
      return itemPath(path)?.scope === "fulfillment";
    case "product_value":
      return safeLiveProductFieldPath(path);
    case "product_availability":
      return safeLiveProductAvailabilityFieldPath(path);
    default:
      return false;
  }
}

function verifiedUnfulfilledValue(evidence: ResponseEvidenceRecord | undefined, path: string): string | null {
  if (evidence?.toolName !== "get_order" || evidence.result.status !== "ok"
    || !["fulfillmentStatus", "fulfillment_status"].includes(normalizedDataPath(path))) return null;
  const data = objectValue(evidence.result.data);
  const field = dataFieldValue(evidence.result, path);
  return field.exists && field.value === null && meaningful(data?.id)
    && Array.isArray(data?.fulfillments) && data.fulfillments.length === 0 ? "unfulfilled" : null;
}

function verifiedAmbiguousAvailability(
  evidence: ResponseEvidenceRecord | undefined, path: string, context: ResponseValidationContext,
): boolean {
  const data = objectValue(evidence?.result.data);
  if (evidence?.toolName !== "get_product_availability" || evidence.result.status !== "invalid_request"
    || data?.status !== "ambiguous" || data.selection !== "ambiguous"
    || data.provider !== "shopify_read_only" || data.source !== "shopify_live") return false;
  const match = normalizedDataPath(path).match(/^(products\[\d+\])\.variants\[(\d+)\]\.availability_state$/);
  if (!match) return false;
  const productId = dataFieldValue(evidence.result, `${match[1]}.id`).value;
  const variantId = dataFieldValue(evidence.result, `${match[1]}.variants[${match[2]}].id`).value;
  const state = dataFieldValue(evidence.result, path).value;
  if (!meaningful(productId) || !meaningful(variantId) || !(PRODUCT_AVAILABILITY_STATES as readonly string[]).includes(String(state))) return false;
  return (context.getResults?.() ?? []).some((record) => {
    if (record.result.status !== "ok") return false;
    const source = objectValue(record.result.data);
    if (record.toolName === "get_order" && context.activeOrder?.state === "verified"
      && String(source?.id) === String(context.activeOrder.order?.id)) {
      const items = Array.isArray(source?.items) ? source.items : [];
      const ids = new Set(items.map((item) => objectValue(item)?.variantId).filter(meaningful).map(String));
      return items.length > 0 && items.every((item) => meaningful(objectValue(item)?.variantId))
        && ids.size === 1 && ids.has(String(variantId));
    }
    if (record.toolName === "get_product" && effectiveResultStatus(record) === "ok") {
      const products = Array.isArray(source?.products) ? source.products : [];
      const product = products.length === 1 ? objectValue(products[0]) : null;
      const variants = Array.isArray(product?.variants) ? product.variants : [];
      return String(product?.id) === String(productId) && variants.length === 1
        && String(objectValue(variants[0])?.id) === String(variantId);
    }
    return false;
  });
}

function validateFact(segment: Extract<ResponseSegment, { type: "fact" }>, context: ResponseValidationContext, index: number) {
  if (segment.fact_kind === "line_fulfillment") {
    return segment.evidence.length === 1 && lineDisposition(segment.evidence[0], context)
      ? [] : [{ index, code: "line_mapping_not_verified", message: "Line disposition requires a complete scoped order and matching quantities." }];
  }
  if (segment.fact_kind === "order_amount") {
    const basis = segment.evidence[0];
    const evidence = basis && resultFor(basis, context);
    const data = objectValue(evidence?.result.data);
    return segment.evidence.length === 1 && verifiedOrderSource(evidence, context)
      && basis.field_paths.length === 2 && ["total", "currency"].every(path => basis.field_paths.map(normalizedDataPath).includes(path))
      && meaningful(data?.total) && Number.isFinite(Number(data?.total)) && Number(data?.total) >= 0 && /^[A-Z]{3}$/.test(String(data?.currency))
      ? [] : [{ index, code: "order_amount_binding_required", message: "Order amount requires matching verified total and currency fields." }];
  }
  const issues = segment.evidence.flatMap((basis) => {
    const states = basis.field_paths.filter(safeLiveProductAvailabilityFieldPath);
    const boundAmbiguity = segment.fact_kind === "product_availability" && states.length > 0
      && states.every((path) => verifiedAmbiguousAvailability(resultFor(basis, context), path, context));
    return validateBasis(basis, context, { requireOk: !boundAmbiguity, requireMeaningfulFields: true, scope: "data" }, index);
  });
  const semanticIssues = segment.fact_kind === "order_fulfillment_status"
    ? issues.filter((issue) => issue.code !== "empty_field" || !segment.evidence.every((basis) =>
      basis.field_paths.every((path) => meaningful(dataFieldValue(resultFor(basis, context)!.result, path).value)
        || verifiedUnfulfilledValue(resultFor(basis, context), path) !== null
        || (normalizedDataPath(path) === "fulfillments" && basis.field_paths.some((field) =>
          verifiedUnfulfilledValue(resultFor(basis, context), field) !== null)))))
    : issues;
  if (semanticIssues.length) return semanticIssues;

  const paths = segment.evidence.flatMap((basis) => basis.field_paths);
  if (segment.fact_kind === "product_value" && paths.some(unsupportedLiveProductFieldPath)) {
    return [{
      index,
      code: "product_inventory_unsupported",
      message: "Inventory fields are not a supported product capability.",
    }];
  }
  const matchingPaths = paths.filter((path) => fieldPathMatchesFactKind(segment.fact_kind, path));
  if (!matchingPaths.length) {
    return [{
      index,
      code: "fact_field_kind_mismatch",
      message: `The cited fields cannot support a ${segment.fact_kind} fact.`,
    }];
  }

  if (segment.fact_kind === "product_value") {
    const productSource = segment.evidence.every((basis) => resultFor(basis, context)?.toolName === "get_product");
    if (!productSource) {
      return [{
        index,
        code: "product_source_required",
        message: "A product value fact must cite a successful get_product result.",
      }];
    }
  }

  if (segment.fact_kind === "product_availability") {
    const productSource = segment.evidence.every((basis) => resultFor(basis, context)?.toolName === "get_product_availability");
    if (!productSource) {
      return [{
        index,
        code: "product_availability_source_required",
        message: "A product availability fact must cite a successful get_product_availability result.",
      }];
    }
    const availabilityValues = segment.evidence.flatMap((basis) => {
      const evidence = resultFor(basis, context);
      return basis.field_paths
        .filter(safeLiveProductAvailabilityFieldPath)
        .map((path) => evidence ? dataFieldValue(evidence.result, path).value : undefined);
    });
    if (availabilityValues.some((value) => typeof value !== "string" || !(PRODUCT_AVAILABILITY_STATES as readonly string[]).includes(value))) {
      return [{
        index,
        code: "invalid_product_availability_state",
        message: "A product availability fact must cite a normalized availability state.",
      }];
    }
  }

  if (segment.fact_kind === "order_item") {
    const bindings = segment.evidence.flatMap((basis) => basis.field_paths.map((path) => ({
      basis,
      path,
      binding: itemPath(path),
    }))).filter((item): item is { basis: { result_id: string; field_paths: string[] }; path: string; binding: ItemPath } => Boolean(item.binding));
    if (bindings.some(({ binding }) => binding.property === "collection")) return [];

    const itemIndexes = new Set(bindings.map(({ binding }) => binding.index).filter((index): index is string => index != null));
    const resultIds = new Set(bindings.map(({ basis }) => basis.result_id));
    const hasTitle = bindings.some(({ binding, basis, path }) => binding.property === "title"
      || (binding.property === "object" && meaningful(objectValue(dataFieldValue(resultFor(basis, context)!.result, path).value)?.title))
      || (binding.index != null && meaningful(siblingItemValue(resultFor(basis, context), path, binding.index, "title").value)));
    const hasQuantity = bindings.some(({ binding, basis, path }) => binding.property === "quantity"
      || (binding.property === "object" && meaningful(objectValue(dataFieldValue(resultFor(basis, context)!.result, path).value)?.quantity))
      || (binding.index != null && meaningful(siblingItemValue(resultFor(basis, context), path, binding.index, "quantity").value)));
    if (!hasTitle || !hasQuantity || itemIndexes.size !== 1 || resultIds.size !== 1) {
      return [{
        index,
        code: "order_item_fields_required",
        message: "An order item fact must bind the title and quantity of one returned item object.",
      }];
    }
  }

  if (segment.fact_kind === "shipment_item") {
    const bindings = segment.evidence.flatMap((basis) => basis.field_paths.map((path) => ({
      basis,
      path,
      binding: itemPath(path),
    }))).filter((item): item is { basis: { result_id: string; field_paths: string[] }; path: string; binding: ItemPath } => Boolean(item.binding?.scope === "fulfillment"));
    const bindingKeys = new Set(bindings.map(({ binding }) => `${binding.fulfillmentIndex}:${binding.index}`));
    const itemResultIds = new Set(bindings.map(({ basis }) => basis.result_id));
    const itemBasis = bindings[0]?.basis;
    const itemEvidence = itemBasis ? resultFor(itemBasis, context) : undefined;
    const firstBinding = bindings[0]?.binding;
    const hasTitle = bindings.some(({ binding, basis, path }) => binding.property === "title"
      || (binding.property === "object" && meaningful(objectValue(dataFieldValue(resultFor(basis, context)!.result, path).value)?.title))
      || (binding.index != null && meaningful(siblingItemValue(resultFor(basis, context), path, binding.index, "title").value)));
    const hasQuantity = bindings.some(({ binding, basis, path }) => binding.property === "quantity"
      || (binding.property === "object" && meaningful(objectValue(dataFieldValue(resultFor(basis, context)!.result, path).value)?.quantity))
      || (binding.index != null && meaningful(siblingItemValue(resultFor(basis, context), path, binding.index, "quantity").value)));
    if (!bindings.length || !firstBinding?.fulfillmentIndex || !firstBinding.index || bindingKeys.size !== 1 || itemResultIds.size !== 1 || !hasTitle || !hasQuantity) {
      return [{ index, code: "shipment_item_fields_required", message: "A shipment item fact must bind one fulfillment item with its title and quantity." }];
    }
    if (!verifiedFulfillmentSource(itemEvidence, context) && !verifiedOrderSource(itemEvidence, context)) {
      return [{ index, code: "shipment_item_source_required", message: "A shipment item fact must cite an inspect_fulfillment result." }];
    }
    const fulfillmentId = dataFieldValue(itemEvidence.result, `fulfillments[${firstBinding.fulfillmentIndex}].id`).value;
    if (!meaningful(fulfillmentId)) {
      return [{ index, code: "shipment_item_fulfillment_id_required", message: "A shipment item fact must bind to a returned fulfillment ID." }];
    }
    {
      const fulfillment = objectValue(dataFieldValue(itemEvidence.result, `fulfillments[${firstBinding.fulfillmentIndex}]`).value);
      const mapped = objectValue(dataFieldValue(itemEvidence.result, `fulfillments[${firstBinding.fulfillmentIndex}].items[${firstBinding.index}]`).value);
      const mappingOrder = verifiedOrderSource(itemEvidence, context) ? itemEvidence : (context.getResults?.() ?? []).find(record => verifiedOrderSource(record, context));
      const active = context.activeOrder ?? context.getActiveOrderFocus?.();
      const activeData = active?.state === "verified" ? objectValue(active.order) : null;
      const sourceData = objectValue(mappingOrder?.result.data) ?? (activeData
        && String(objectValue(itemEvidence.result.data)?.order_id ?? objectValue(itemEvidence.result.data)?.orderId) === String(activeData.id) ? activeData : null);
      const orderItems = sourceData?.items;
      const currentFulfillments = Array.isArray(sourceData?.fulfillments) ? sourceData.fulfillments : [];
      const currentFulfillment = currentFulfillments.map(objectValue).find(value => String(value?.id) === String(fulfillment?.id));
      const currentItems = Array.isArray(currentFulfillment?.items) ? currentFulfillment.items : [];
      const currentItem = currentItems.map(objectValue).find(value => String(value?.orderLineItemId) === String(mapped?.orderLineItemId));
      const exactMapping = currentItem && currentItem.title === mapped?.title && Number(currentItem.quantity) === Number(mapped?.quantity)
        && String(currentItem.variantId ?? "") === String(mapped?.variantId ?? "");
      const originalIndex = Array.isArray(orderItems) ? orderItems.findIndex(value => String(objectValue(value)?.id) === String(mapped?.orderLineItemId)) : -1;
      const standaloneMapping = (!Array.isArray(orderItems) || !orderItems.length) && verifiedFulfillmentSource(itemEvidence, context)
        && exactMapping && standaloneMappedQuantity(itemEvidence, mapped);
      if (fulfillment?.itemMappingStatus !== "verified" || (!standaloneMapping && (originalIndex < 0 || !sourceData || !exactMapping || !lineDispositionFromOrder(sourceData, `items[${originalIndex}]`)))) {
        return [{ index, code: "shipment_item_mapping_required", message: "Shipment items require verified line and quantity mappings." }];
      }
    }
    const trackingBases = segment.evidence.filter((basis) => resultFor(basis, context)?.toolName === "get_tracking");
    if (trackingBases.length) {
      const trackingEvidence = resultFor(trackingBases[0], context);
      const trackingFulfillmentId = dataFieldValue(trackingEvidence!.result, "tracking_identifier.fulfillment_id").value;
      const trackingStatus = dataFieldValue(trackingEvidence!.result, "live_tracking.status").value;
      if (!meaningful(trackingFulfillmentId) || !meaningful(trackingStatus)) {
        return [{ index, code: "shipment_item_tracking_binding_required", message: "Item-level tracking claims must cite the matching fulfillment ID and live tracking status." }];
      }
      if (String(trackingFulfillmentId) !== String(fulfillmentId)) {
        return [{ index, code: "shipment_item_tracking_scope_mismatch", message: "The tracking result belongs to a different fulfillment than the cited item." }];
      }
    }
  }
  return [];
}

function definitionFor(capability: string, context: ResponseValidationContext) {
  return context.definitions.find((definition) => definition.name === capability);
}

function availableCapability(capability: string, context: ResponseValidationContext) {
  return [...context.manifest.readTools, ...context.manifest.proposalOnlyTools].includes(capability);
}

function validateCapabilityArguments(
  capability: string,
  missingArguments: string[],
  context: ResponseValidationContext,
  index: number,
  codePrefix: "question" | "action",
) {
  const definition = definitionFor(capability, context);
  if (!definition) return [{ index, code: `unknown_${codePrefix}_capability`, message: "The referenced capability is not part of the current tool registry." }];
  const properties = Object.keys(definition.parameters.properties);
  const required = new Set(definition.parameters.required);
  const issues: ResponseValidationIssue[] = [];
  for (const argument of missingArguments) {
    if (context.knownCaseArguments?.includes(argument)) {
      issues.push({ index, code: "known_case_argument_reasked", message: "This argument is already present in the scoped canonical case context." });
    }
    if (!properties.includes(argument)) {
      issues.push({ index, code: `${codePrefix}_argument_not_in_schema`, message: `The requested argument is not accepted by ${capability}.` });
    } else if (!required.has(argument)) {
      issues.push({ index, code: `${codePrefix}_argument_not_required`, message: `The requested information is not required to call ${capability}.` });
    }
  }
  return issues;
}

function questionEvidence(
  segment: Extract<ResponseSegment, { type: "question" }>,
  context: ResponseValidationContext,
) {
  if (segment.basis) return resultFor(segment.basis, context);
  const records = context.getResults?.() ?? [];
  const candidates = segment.capability
    ? records.filter((record) => record.toolName === segment.capability)
    : records;
  // Order disambiguation is preloaded through get_order_history, while the
  // model asks to enable the exact get_order capability. Keep that safe
  // history result available as grounding for the clarification.
  return candidates.at(-1)
    ?? (segment.capability === "get_order"
      ? records.filter((record) => record.toolName === "get_order_history").at(-1)
      : undefined);
}

function validateQuestionBasis(
  segment: Extract<ResponseSegment, { type: "question" }>,
  context: ResponseValidationContext,
  index: number,
) {
  if (segment.basis) {
    return {
      evidence: resultFor(segment.basis, context),
      issues: validateBasis(
        segment.basis,
        context,
        { requireOk: false, requireMeaningfulFields: false, scope: "data" },
        index,
      ),
    };
  }
  const evidence = questionEvidence(segment, context);
  return evidence
    ? { evidence, issues: [] }
    : {
        evidence: undefined,
        issues: [{ index, code: "question_evidence_required", message: "This clarification must be grounded in the current tool result." }],
      };
}

function productVariantChoices(evidence: ResponseEvidenceRecord | undefined) {
  const data = objectValue(evidence?.result.data);
  const products = Array.isArray(data?.products) ? data.products : [];
  return products.flatMap((product) => {
    const record = objectValue(product);
    const variants = Array.isArray(record?.variants) ? record.variants : [];
    return variants.map((variant) => objectValue(variant)?.title).filter((title): title is string => meaningful(title));
  });
}

function asksForKnownProduct(value: string, context: Pick<ResponseValidationContext, "customerProvidedContext">) {
  if (!context.customerProvidedContext?.product) return false;
  return /\b(?:which|what)\s+(?:exact\s+)?(?:product|headset|device)\b|\b(?:exact\s+)?model\s+number\b/i.test(value);
}

function hasSpecificCustomerIssue(context: Pick<ResponseValidationContext, "customerProvidedContext">) {
  const issue = String(context.customerProvidedContext?.issue ?? "").trim();
  if (!issue) return false;
  if (/\b(?:pair|connect|disconnect|power|sound|audio|microphone|mic|charge|charging|detected|detection|firmware|reset|button|volume|static|noise|echo)\b/i.test(issue)) return true;
  return !/\b(?:broken|not\s+working|problem|issue|trouble|something\s+wrong)\b/i.test(issue);
}

function asksForMissingCustomerContext(value: string, context: ResponseValidationContext) {
  if (!context.customerMessage?.trim()) return false;
  const asksForProduct = /\b(?:which|what)\s+(?:exact\s+)?(?:[a-z][\w-]*\s+)?(?:product|device|model)(?:\s+(?:number|name))?\b|\b(?:exact\s+)?model\s+(?:number|name)\b|\bwhat(?:'s|\s+is)\s+the\s+(?:make|model)\b/i.test(value);
  const asksForTask = /\bwhat(?:'s|\s+is)?\s+(?:exactly\s+)?wrong\b|\bwhat(?:'s|\s+is)\s+(?:the\s+)?(?:problem|issue|symptom|happening)\b|\bwhat\s+(?:problem|issue|symptom)\b|\bwhich\s+(?:problem|issue|symptom)\b|\b(?:describe|tell\s+me)\s+(?:the\s+)?(?:problem|issue|symptoms?)\b|\bis\s+it\s+(?:a|an)?\s*(?:power|connection|sound|audio|physical|pairing|detection|charging)\b/i.test(value);
  const productMissing = !meaningful(context.customerProvidedContext?.product);
  const taskMissing = !hasSpecificCustomerIssue(context);
  return (productMissing && asksForProduct) || (taskMissing && asksForTask);
}

/**
 * A clarification can be grounded in the deterministic absence of required
 * customer context when no lookup has run yet. This deliberately does not
 * treat customer context as a verified fact and does not apply once a tool
 * result exists, where the result must remain the source of truth.
 */
function canClarifyMissingCustomerContext(
  segment: Extract<ResponseSegment, { type: "question" }>,
  context: ResponseValidationContext,
) {
  if (segment.purpose !== "clarify_task" || segment.basis || segment.capability !== null || segment.missing_arguments.length) return false;
  const results = context.getResults?.();
  if (!results || results.length) return false;
  const productMissing = !meaningful(context.customerProvidedContext?.product);
  const taskMissing = !hasSpecificCustomerIssue(context);
  if (!productMissing && !taskMissing) return false;
  // A safe clarification may be phrased naturally by the model; the
  // deterministic boundary is the missing customer context, not a brittle
  // list of question templates. Still prevent it from asking for a product
  // that the customer already supplied.
  const supportContextQuestion = /\b(?:product|model|device|headset|issue|problem|help|wrong|trouble|symptom|happening|working|connect|pair|power|sound|audio|microphone|charging|firmware|reset)\b/i.test(segment.text ?? "");
  return !asksForKnownProduct(segment.text ?? "", context)
    && (asksForMissingCustomerContext(segment.text ?? "", context) || supportContextQuestion);
}

/**
 * The runtime can safely ground a task clarification in the latest
 * insufficient knowledge result even when the model omitted the optional
 * basis. This never applies to a successful procedure result.
 */
function canClarifyInsufficientTaskResult(
  segment: Extract<ResponseSegment, { type: "question" }>,
  context: ResponseValidationContext,
) {
  if (segment.purpose !== "clarify_task" || segment.basis || segment.capability !== null || segment.missing_arguments.length) return false;
  return (context.getResults?.() ?? []).some((record) => {
    if (!["search_procedures", "search_product_knowledge", "search_policy", "get_brand_guidance"].includes(record.toolName)) return false;
    const data = objectValue(record.result.data);
    return effectiveResultStatus(record) === "not_found" || data?.task_specificity === "insufficient";
  });
}

function knowledgeTool(toolName: string) {
  return ["search_procedures", "search_product_knowledge", "search_policy", "get_brand_guidance"].includes(toolName);
}

function latestKnowledgeEvidence(context: Pick<ResponseValidationContext, "getResults">) {
  return [...(context.getResults?.() ?? [])].reverse().find((record) => knowledgeTool(record.toolName));
}

/**
 * Keep safe customer-facing gaps separate from transport/provider failures.
 * This classification is intentionally derived only from server-recorded tool
 * results; it never treats model text or retrieved content as instructions.
 */
export function classifyResponseFailure(
  context: Pick<ResponseValidationContext, "getResults">,
): ResponseFailureClass {
  const results = context.getResults?.() ?? [];
  if (results.some((record) => ["error", "unavailable"].includes(record.result.status))) return "system_tool_failure";
  const knowledge = latestKnowledgeEvidence(context);
  if (knowledge) {
    const status = effectiveResultStatus(knowledge);
    const data = objectValue(knowledge.result.data);
    if (["error", "unavailable"].includes(status ?? "") || knowledge.result.status === "error") return "system_tool_failure";
    if (knowledge.toolName === "search_procedures" && data?.task_specificity === "insufficient") return "insufficient_specificity";
    if (knowledge.toolName === "search_procedures" && status === "not_found") return "insufficient_knowledge";
    if (status === "not_found") return "valid_not_found";
    if (knowledge.toolName === "search_procedures" && !Array.isArray(data?.results)) return "insufficient_knowledge";
  }
  return "model_response_invalid";
}

function hasCustomerProduct(context: Pick<ResponseValidationContext, "customerProvidedContext">) {
  return meaningful(context.customerProvidedContext?.product);
}

function customerFacingKnowledgeGap(
  context: Pick<ResponseValidationContext, "locale" | "customerMessage" | "customerProvidedContext" | "getResults">,
): string | null {
  const evidence = latestKnowledgeEvidence(context);
  if (!evidence) return null;
  const failureClass = classifyResponseFailure(context);
  const locale = context.locale ?? "en";
  if (failureClass === "system_tool_failure" || failureClass === "model_response_invalid") return null;

  if (evidence.toolName === "search_procedures" && failureClass === "insufficient_specificity") {
    if (!hasCustomerProduct(context) && !hasSpecificCustomerIssue(context)) {
      return locale === "da"
        ? "Hvilket produkt eller hvilken model drejer det sig om, og hvad er det præcist, der er galt?"
        : "Which product or model is this about, and what exactly is going wrong?";
    }
    if (!hasSpecificCustomerIssue(context)) {
      return locale === "da"
        ? "Hvad er det præcist, der sker med produktet — for eksempel lyd, mikrofon, strøm, forbindelse eller opladning?"
        : "What exactly is happening with the product—for example, is it audio, microphone, power, connection, or charging?";
    }
    return locale === "da"
      ? "Jeg kunne ikke identificere én bestemt supportprocedure ud fra den nuværende beskrivelse. Hvilken model bruger du, og hvad har du allerede prøvet?"
      : "I couldn’t identify one specific support procedure from the current description. Which model are you using, and what have you already tried?";
  }

  if (evidence.toolName === "search_procedures" && failureClass === "insufficient_knowledge") {
    return locale === "da"
      ? "Jeg kunne ikke bekræfte en supportprocedure for dette problem ud fra den aktuelle vejledning. Hvilken model bruger du, og hvad har du allerede prøvet?"
      : "I couldn’t verify a support procedure for this issue from the current guidance. Which model are you using, and what have you already tried?";
  }

  if (failureClass === "valid_not_found") {
    if (evidence.toolName === "search_product_knowledge") {
      return locale === "da"
        ? "Jeg kunne ikke bekræfte den produktoplysning ud fra vores aktuelle produktinformation. Hvis du sender et produktlink, SKU eller det præcise modelnavn, kan jeg prøve igen."
        : "I couldn’t verify that product detail from our current product information. If you share a product link, SKU, or exact model name, I can try again.";
    }
    if (evidence.toolName === "search_policy") {
      return locale === "da"
        ? "Jeg kunne ikke bekræfte den politikoplysning ud fra vores aktuelle politikoplysninger."
        : "I couldn’t verify that policy detail from our current policy information.";
    }
    if (evidence.toolName === "get_brand_guidance") {
      return locale === "da"
        ? "Jeg kunne ikke bekræfte yderligere vejledning til denne henvendelse."
        : "I couldn’t verify any additional guidance for this request.";
    }
  }

  // Keep this branch intentionally narrow. A future knowledge result must not
  // silently become a claim merely because it has an unfamiliar shape.
  return null;
}

export function composeSafeKnowledgeGapResponse(
  context: Pick<ResponseValidationContext, "locale" | "customerMessage" | "customerProvidedContext" | "getResults">,
): string | null {
  return customerFacingKnowledgeGap(context);
}

function validateGroundedQuestion(
  segment: Extract<ResponseSegment, { type: "question" }>,
  context: ResponseValidationContext,
  index: number,
  purpose: Extract<Extract<ResponseSegment, { type: "question" }>["purpose"], "disambiguate_entity" | "disambiguate_variant" | "clarify_task" | "clarify_item">,
) {
  const issues: ResponseValidationIssue[] = [];
  if (!segment.text?.trim()) issues.push({ index, code: "question_text_required", message: "A grounded clarification needs customer-facing question text." });
  if (segment.capability && !availableCapability(segment.capability, context)) {
    issues.push({ index, code: "unknown_question_capability", message: "The question references a capability that is not available in this run." });
  }
  const contextOnlyClarification = canClarifyMissingCustomerContext(segment, context)
    || (purpose === "clarify_task" && segment.capability === null && !segment.missing_arguments.length
      && !segment.basis && !meaningful(context.customerProvidedContext?.product)
      && /\b(?:which|what)\s+(?:product|model|device|item)\b/i.test(segment.text ?? "")
      && productCareRequest(context) && !selectedCareSubject(context));
  const implicitTaskClarification = canClarifyInsufficientTaskResult(segment, context);
  const grounded = contextOnlyClarification || implicitTaskClarification
    ? { evidence: undefined, issues: [] }
    : validateQuestionBasis(segment, context, index);
  issues.push(...grounded.issues);
  const evidence = grounded.evidence;
  if (!evidence) {
    if (purpose === "clarify_task" && asksForKnownProduct(segment.text ?? "", context)) {
      issues.push({ index, code: "known_context_reasked", message: "The clarification must not ask for customer-provided product context again." });
    }
    return issues;
  }
  const data = objectValue(evidence.result.data);
  const status = effectiveResultStatus(evidence);

  if (purpose === "disambiguate_variant") {
    if (segment.capability !== "get_product_availability") {
      issues.push({ index, code: "variant_capability_required", message: "Variant clarification must use the availability capability." });
    }
    if (segment.missing_arguments.length !== 1 || segment.missing_arguments[0] !== "variant") {
      issues.push({ index, code: "variant_argument_required", message: "Variant clarification must name only the missing variant." });
    }
    if (status !== "invalid_request" && data?.selection !== "ambiguous") {
      issues.push({ index, code: "variant_ambiguity_required", message: "Variant clarification requires an ambiguous availability result." });
    }
    if (productVariantChoices(evidence).length < 2) {
      issues.push({ index, code: "variant_choices_missing", message: "Variant clarification requires multiple returned variant choices." });
    }
    return issues;
  }

  if (purpose === "disambiguate_entity") {
    if (!["not_found", "invalid_request", "unknown", "unavailable"].includes(status ?? "")) {
      issues.push({ index, code: "entity_ambiguity_required", message: "Entity clarification requires an unresolved or ambiguous lookup." });
    }
    return issues;
  }

  if (purpose === "clarify_task") {
    if (segment.capability !== null || segment.missing_arguments.length) {
      issues.push({ index, code: "task_question_has_capability", message: "A task clarification must not request an unverified tool argument." });
    }
    if (!(["search_procedures", "search_product_knowledge", "search_policy", "get_brand_guidance"].includes(evidence.toolName))) {
      issues.push({ index, code: "task_question_source_required", message: "A task clarification must follow a knowledge or procedure lookup." });
    }
    const hasGroundedTaskCandidates = Array.isArray(data?.possible_tasks) && data.possible_tasks.length > 0;
    if (status !== "not_found" && data?.task_specificity !== "insufficient" && !hasGroundedTaskCandidates) {
      issues.push({ index, code: "task_ambiguity_required", message: "Task clarification requires missing or insufficient task evidence." });
    }
    if (asksForKnownProduct(segment.text ?? "", context)) {
      issues.push({ index, code: "known_context_reasked", message: "The clarification must not ask for customer-provided product context again." });
    }
    return issues;
  }

  if (segment.missing_arguments.length !== 1 || segment.missing_arguments[0] !== "item") {
    issues.push({ index, code: "item_clarification_argument_required", message: "Item clarification must name the missing item." });
  }
  if (!data || (!Array.isArray(data.items) && !Array.isArray(data.fulfillments))) {
    issues.push({ index, code: "item_clarification_source_required", message: "Item clarification requires a current order or fulfillment result." });
  }
  return issues;
}

function validateQuestion(segment: Extract<ResponseSegment, { type: "question" }>, context: ResponseValidationContext, index: number) {
  if (segment.purpose === "pure_clarification") {
    if (segment.capability !== null || segment.missing_arguments.length) {
      return [{ index, code: "pure_question_has_capability", message: "A pure clarification cannot carry a capability commitment." }];
    }
    return segment.text?.trim()
      ? []
      : [{ index, code: "pure_question_text_required", message: "A pure clarification needs customer-facing question text." }];
  }

  if (segment.purpose === "disambiguate_entity"
    || segment.purpose === "disambiguate_variant"
    || segment.purpose === "clarify_task"
    || segment.purpose === "clarify_item") {
    return validateGroundedQuestion(segment, context, index, segment.purpose);
  }

  // Preserve compatibility with the previous output shape when the model
  // names a semantic variant rather than a real tool argument.
  if (segment.capability === "get_product_availability" && segment.missing_arguments.includes("variant")) {
    return validateGroundedQuestion({ ...segment, purpose: "disambiguate_variant" }, context, index, "disambiguate_variant");
  }

  // A failed product lookup can leave the entity label ambiguous even though
  // `query` is the only actual tool argument. Keep that distinction explicit
  // instead of accepting arbitrary arguments into the tool schema.
  if (segment.capability === "search_product_knowledge" && segment.missing_arguments.some((argument) => argument !== "query")) {
    return validateGroundedQuestion({ ...segment, purpose: "disambiguate_entity" }, context, index, "disambiguate_entity");
  }

  // A procedure lookup may establish the product but still lack the task. The
  // clarification is grounded in the failed/insufficient lookup and does not
  // authorize an invented procedure or a new tool argument.
  if (segment.capability === "search_procedures" && segment.missing_arguments.some((argument) => argument !== "query")) {
    return validateGroundedQuestion({ ...segment, purpose: "clarify_task", capability: null, missing_arguments: [] }, context, index, "clarify_task");
  }

  if (!segment.capability) {
    return [{ index, code: "question_capability_required", message: "A capability-enabling question must name one capability." }];
  }
  if (segment.capability === "update_address"
    && context.customerMessage?.trim()
    && !isExplicitAddressChangeRequest(context.customerMessage, context.turnIR)) {
    return [{ index, code: "address_change_request_required", message: "An address proposal requires an explicit request to change the existing order address." }];
  }
  if (!availableCapability(segment.capability, context)) {
    return [{ index, code: "unknown_question_capability", message: "The question references a capability that is not available in this run." }];
  }
  if (!segment.missing_arguments.length) {
    return [{ index, code: "question_argument_required", message: "A capability-enabling question must identify missing required arguments." }];
  }
  return validateCapabilityArguments(segment.capability, segment.missing_arguments, context, index, "question");
}

function validateSegment(segment: ResponseSegment, context: ResponseValidationContext, index: number): ResponseValidationIssue[] {
  switch (segment.type) {
    case "facet_limit": return validateFacetLimit(segment, context, index);
    case "evidence_limitation":
      if (preciseRequests(context).length && ["product_care", "product_property"].includes(segment.kind)) return [{ index, code: "answer_facet_binding_required", message: "A broad product limitation cannot satisfy a precise requested facet." }];
      return validateEvidenceLimitation(segment, context, index);
    case "source_content": return validateSourceContent(segment, context, index);
    case "source_comparison": return shippingComparison(segment, context)
      ? [] : [{ index, code: "comparison_inputs_not_verified", message: "The comparison requires verified compatible inputs and applicability." }];
    case "operational_result": {
      const evidence = resultFor(segment.basis, context);
      const outcome = (evidence?.result.data as JsonObject)?.operation as unknown as OperationalOutcome;
      const scope = context.operationalScope;
      const scoped = scope && outcome?.workspaceId === scope.workspaceId && outcome?.shopId === scope.shopId
        && outcome?.caseId === (scope.caseId ?? null) && outcome?.customerEmail === scope.customerEmail?.trim().toLowerCase();
      const channelValid = outcome?.status !== "SIMULATED" || context.interactionChannel === "playground";
      const executionChannelValid = outcome?.status !== "EXECUTED" || ["support_inbox", "support_email"].includes(context.interactionChannel ?? "");
      return evidence?.toolName === "operational_execution" && evidence.result.status === "ok" && scoped && channelValid && executionChannelValid
        && segment.basis.field_paths.length === 1 && segment.basis.field_paths[0] === "data.operation" && isVerifiedOperationalOutcome(outcome)
        ? [] : [{ index, code: "operational_result_not_verified", message: "An execution outcome must cite the scoped server decision and verified read-back." }];
    }
    case "fact":
      return validateFact(segment, context, index);
    case "knowledge_guidance": {
      const issues = validateKnowledgeBasis(segment.basis, context, index);
      if (!issues.length) issues.push(...validatePolicyTruth(segment, context, index));
      if (!issues.length) issues.push(...validateProductCareGuidance(segment, context, index));
      if (!issues.length) issues.push(...validateMaterialPolicyValues(segment, context, index));
      if (!issues.length && citesProceduralKnowledge(segment.basis, context)) {
        issues.push({ index, code: "procedure_binding_required", message: "Procedural guidance must cite source-bound procedure steps." });
      }
      if (!issues.length && containsUnvalidatedOperationalCommitment(segment.text)) {
        issues.push({ index, code: "unsupported_operational_commitment", message: "Operational commitments must use a validated proposal-only capability." });
      }
      if (!issues.length && /\b(?:refund|replacement|return)\s+(?:has been|was|is already|already)\s+(?:approved|completed|issued|sent)\b|\b(?:we|i)\s+(?:have|already)\s+(?:refunded|replaced|sent|submitted)\b/i.test(segment.text)) {
        issues.push({ index, code: "unverified_remedy_outcome", message: "A completed remedy requires a verified operational result." });
      }
      if (!issues.length && modernProductBasis(segment.basis, context) && !projectedProductContent(segment.basis, context)) {
        issues.push({ index, code: "product_content_binding_required", message: "Product guidance requires current scoped source content, not free-form value substitution." });
      }
      return issues;
    }
    case "procedure_guidance":
      return validateProcedureGuidance(segment, context, index);
    case "limitation": {
      const evidence = resultFor(segment.basis, context);
      if (!evidence) return [{ index, code: "unknown_result_id", message: "The limitation references a tool result from outside this run." }];
      const issues = validateBasis(segment.basis, context, { requireOk: false, requireMeaningfulFields: false, scope: "result" }, index);
      if (!issues.length && preciseRequests(context).length && (evidence.toolName.includes("product") || modernProductBasis(segment.basis, context))) {
        issues.push({ index, code: "answer_facet_binding_required", message: "Precise product limitations require a source-bound facet or a validated typed uncertainty, not arbitrary model prose." });
      }
      if (!issues.length && containsUnvalidatedOperationalCommitment(segment.text)) {
        issues.push({ index, code: "unsupported_operational_commitment", message: "Operational commitments must use a validated proposal-only capability." });
      }
      return issues;
    }
    case "action_offer": {
      if (segment.capability === "update_address"
        && context.customerMessage?.trim()
        && !isExplicitAddressChangeRequest(context.customerMessage, context.turnIR)) {
        return [{ index, code: "address_change_request_required", message: "An address proposal requires an explicit request to change the existing order address." }];
      }
      const definition = definitionFor(segment.capability, context);
      if (!context.manifest.proposalOnlyTools.includes(segment.capability) || definition?.sensitivity !== "proposed_action") {
        return [{ index, code: "unknown_action_capability", message: "The offered action is not a current proposal-only capability." }];
      }
      const issues = validateCapabilityArguments(segment.capability, segment.missing_arguments, context, index, "action");
      if (context.proposedActions && !context.proposedActions.some((action) => action.action === segment.capability)) {
        issues.push({ index, code: "action_not_proposed", message: "The action must come from a validated proposal tool result in this run." });
      }
      return issues;
    }
    case "question": {
      const issues = validateQuestion(segment, context, index);
      if (!issues.length && segment.text && containsUnvalidatedOperationalCommitment(segment.text)) {
        issues.push({ index, code: "unsupported_operational_commitment", message: "Operational commitments must use a validated proposal-only capability." });
      }
      return issues;
    }
    case "acknowledgement":
      return [];
    default:
      return [{ index, code: "unknown_segment_type", message: "The response segment type is not supported." }];
  }
}

/**
 * Free-form knowledge and question text may explain policy, but cannot make a
 * future operational commitment. Those commitments must be represented by an
 * action_offer backed by a proposal-only tool result.
 */
function containsUnvalidatedOperationalCommitment(value: string): boolean {
  const text = String(value ?? "").replace(/[\u2019]/g, "'");
  if (!text.trim()) return false;
  const subject = "(?:i|we|our team|support|vi|teamet)";
  const future = "(?:will|can|shall|going to|kan|vil|skal|kan få)";
  const operation = "(?:cancel\\w*|refund\\w*|chang\\w*|updat\\w*|hold\\w*|delay\\w*|replac\\w*|send\\w*|contact\\w*|investigat\\w*|look into|look further|open (?:a )?(?:carrier )?trace|carrier trace|track(?:\\s+(?:the|your|this|it)\\b|\\s+(?:the|your)\\s+(?:package|shipment|order|parcel|case)\\b)|escalat\\w*|reorder\\w*|re-order\\w*|reschedul\\w*|postpon\\w*|add (?:a )?note|prepare (?:a )?proposal for|ændr\\w*|opdater\\w*|hold\\w*|forsink\\w*|erstat\\w*|send\\w*|genbestil\\w*|ombook\\w*|kontakt\\w*|undersøg\\w*|noter\\w*|få teamet)";
  return new RegExp(`\\b${subject}\\b\\s+${future}\\s+${operation}\\b`, "i").test(text)
    || new RegExp(`\\b(?:so|then|så)\\s+(?:i|we|jeg|vi)\\s+${future}\\s+${operation}\\b`, "i").test(text)
    || /\b(?:i|we|jeg|vi)\s+(?:can|will|kan|vil)\s+get the team\s+to\s+(?:put|place)\b[\s\S]{0,80}\b(?:on hold|hold)\b/i.test(text)
    || new RegExp(`\\b(?:do you mean|do you want us|would you like us|shall we|should we|are you asking(?: us)?|which option do you prefer|what would you prefer|would you rather|let me know whether|vil du have os|skal vi|hvilken mulighed foretrækker du)\\b[\\s\\S]{0,96}\\b${operation}\\b`, "i").test(text);
}

function productCareRequest(context: ResponseValidationContext): boolean {
  if (context.turnIR?.answerRequests?.some(request => request.kind === "product_care")) return true;
  const pattern = /\b(?:wash\w*|dishwasher|clean\w*|dry\w*|care|bleach|vask\w*|tør\w*|rengør\w*)\b/i;
  if (pattern.test(context.customerMessage ?? "")) return true;
  // Follow-up intent may be carried by the current read query. It selects
  // evidence only; it never establishes a product fact or instruction.
  return /\b(?:same|it|that|this|samme|det)\b/i.test(context.customerMessage ?? "")
    && (context.getResults?.() ?? []).some((record) => record.toolName === "search_product_knowledge"
      && pattern.test(String(objectValue(record.result.data)?.query ?? "")));
}

function careSubject(record: JsonObject): string {
  const title = String(record.title ?? "");
  const parts = title.split(/\s+\/\s+/);
  const productHeading = parts[0].split(/\s+[—–]\s+/);
  const label = productHeading.length > 1 ? productHeading[0]
    : parts.length > 1 && parts.at(-1)!.trim().split(/\s+/).length > 2 ? parts.at(-1)! : parts[0];
  return normalizedPhrase(label);
}

function careRecords(context: ResponseValidationContext) {
  return (context.getResults?.() ?? []).flatMap((evidence) => {
    if (evidence.toolName !== "search_product_knowledge" || evidence.result.status !== "ok") return [];
    const results = objectValue(evidence.result.data)?.results;
    return Array.isArray(results) ? results.flatMap((value, resultIndex) => {
      const record = objectValue(value);
      if (!record || record.knowledge_type !== "product" || !["authoritative", "guidance", "reference"].includes(String(record.authority))) return [];
      const sections = Array.isArray(record.evidence_sections) ? record.evidence_sections : [];
      return sections.flatMap((section, sectionIndex) => {
        const text = objectValue(section)?.content ?? objectValue(section)?.text;
        return typeof text === "string" && (["care", "product"].includes(String(objectValue(record.structured_data)?.support_domain)) && objectValue(record.structured_data)?.semantic_type === "GUIDANCE" || /\b(?:wash\w*|dishwasher|clean\w*|dry\w*|bleach|reshape|abrasive\w*|damp cloth)\b/i.test(text))
          ? [{ evidence, resultIndex, sectionIndex, subject: careSubject(record), text, textField: typeof objectValue(section)?.content === "string" ? "content" : "text" }] : [];
      });
    }) : [];
  });
}

function selectedCareSubject(context: ResponseValidationContext): string | null {
  const subjects = Array.from(new Set(careRecords(context).map((record) => record.subject).filter(Boolean)));
  const stop = new Set("textile care support guide instructions product the a an for and".split(" "));
  const match = (value: string) => {
    const phrase = normalizedPhrase(value);
    const exact = subjects.filter((subject) => ` ${phrase} `.includes(` ${subject} `));
    if (exact.length) {
      const longest = Math.max(...exact.map((subject) => subject.length));
      return exact.filter((subject) => subject.length === longest);
    }
    const words = new Set(phrase.split(" "));
    const candidates = subjects.flatMap((subject) => {
      const tokens = subject.split(" ").filter((word) => word.length > 2 && !stop.has(word));
      if (!tokens.length || !words.has(tokens[0])) return [];
      return [{ subject, count: tokens.filter((word) => words.has(word)).length }];
    });
    const best = Math.max(0, ...candidates.map((candidate) => candidate.count));
    return candidates.filter((candidate) => candidate.count === best).map((candidate) => candidate.subject);
  };
  const current = match(context.customerMessage ?? "");
  if (current.length) return current.length === 1 ? current[0] : null;
  const previous = match(context.customerProvidedContext?.product ?? "");
  return previous.length === 1 ? previous[0] : null;
}

function citedCareText(basis: KnowledgeBasis, context: ResponseValidationContext): string | null {
  const evidence = resultFor(basis, context);
  if (evidence?.toolName !== "search_product_knowledge") return null;
  const selected = careRecords(context).filter((record) => record.evidence.resultId === evidence.resultId
    && basis.field_paths.some((path) => {
      const normalized = normalizedDataPath(path);
      return normalized === `results[${record.resultIndex}]`
        || normalized === `results[${record.resultIndex}].evidence_sections`
        || normalized === `results[${record.resultIndex}].evidence_sections[${record.sectionIndex}]`
        || normalized === `results[${record.resultIndex}].evidence_sections[${record.sectionIndex}].content`
        || normalized === `results[${record.resultIndex}].evidence_sections[${record.sectionIndex}].text`;
    }));
  const subject = selectedCareSubject(context);
  return subject && selected.length && selected.every((record) => record.subject === subject)
    ? Array.from(new Set(selected.map((record) => record.text))).join("\n\n") : null;
}

function undocumentedDishwasherMethod(text: string): boolean {
  return /not (?:established|specified|documented)|no (?:verified|documented|confirmed) evidence|(?:does|do) not (?:state|specify|confirm|establish)\b/i.test(text);
}

function validateProductCareGuidance(
  segment: Extract<ResponseSegment, { type: "knowledge_guidance" }>, context: ResponseValidationContext, index: number,
): ResponseValidationIssue[] {
  if (!productCareRequest(context) || resultFor(segment.basis, context)?.toolName !== "search_product_knowledge") return [];
  const source = citedCareText(segment.basis, context);
  if (!source) return [{ index, code: "product_care_binding_required", message: "Care guidance must bind returned care content for the current product, not metadata or another product." }];
  const sourceNumbers = new Set(source.match(/\d+(?:[.,]\d+)?/g) ?? []);
  if ((segment.text.match(/\d+(?:[.,]\d+)?/g) ?? []).some((number) => !sourceNumbers.has(number))) {
    return [{ index, code: "unsupported_care_value", message: "Care values must be established by the cited care evidence." }];
  }
  const uncertainty = /(?:couldn['’]?t|cannot|can['’]?t|unable to)\s+(?:verify|confirm|establish)|not (?:specified|documented|verified|confirmed|established)|(?:does|do) not (?:state|specify|confirm|establish)|(?:no|without)\s+(?:verified|documented|confirmed|evidence)/i;
  const sourceHasMethod = /dishwasher/i.test(source) && !undocumentedDishwasherMethod(source);
  const methodClaims = segment.text.split(/[.!?;\n]|\bbut\b/i).filter((clause) => /dishwasher/i.test(clause));
  if (!sourceHasMethod && methodClaims.some((clause) => !uncertainty.test(clause))) {
    return [{ index, code: "unsupported_care_method", message: "An undocumented cleaning method cannot be claimed safe or unsafe." }];
  }
  const method = /\b(?:machine[ -]+wash\w*|washing machine)\b/i;
  const prohibition = /\b(?:do not|don['’]?t|cannot|can['’]?t|must not|mustn['’]?t|should not|shouldn['’]?t|not|never|avoid)\b[\s\S]{0,96}\b(?:machine[ -]+wash\w*|washing machine)\b|\bno\s+machine[ -]+wash\w*/i;
  if (prohibition.test(source)) {
    const clauses = segment.text.split(/[.!?;\n]|,|\band\b|\bbut\b/i);
    if (clauses.some((clause) => method.test(clause) && !prohibition.test(clause)
      && !/machine[ -]+wash\w*[^.!?;]{0,40}\bnot\b/i.test(clause))) {
      return [{ index, code: "care_instruction_conflict", message: "Care guidance contradicts the cited machine-washing prohibition." }];
    }
  }
  return [];
}

/** Restore only current, source-bound answers. No new lookup or model prose. */
function preserveSupportedProductAnswers(validation: ResponseValidationResult, context: ResponseValidationContext): ResponseValidationResult {
  const approved = [...validation.approvedSegments];
  const recovery: CompletenessRecoveryDiagnostic[] = [];
  if (context.activeOrder?.state === "verified" && !context.turnIR?.actions.length
    && /\b(?:update|status|shipped|afsendt|opdatering)\b/i.test(context.customerMessage ?? "")
    && !approved.some((segment) => segment.type === "fact" && segment.fact_kind === "order_fulfillment_status")) {
    const orderId = String(context.activeOrder.order?.id);
    const evidence = (context.getResults?.() ?? []).find((record) =>
      String(objectValue(record.result.data)?.id) === orderId && verifiedUnfulfilledValue(record, "fulfillmentStatus") !== null);
    if (evidence) {
      const segment: ResponseSegment = { type: "fact", fact_kind: "order_fulfillment_status",
        evidence: [{ result_id: evidence.resultId, field_paths: ["fulfillmentStatus"] }] };
      if (!validateSegment(segment, context, -1).length) { approved.push(segment); recovery.push({ type: "status", result: "recovered" }); }
    }
  }
  if (/\b(?:price|pris)\b/i.test(context.customerMessage ?? "")) {
    const candidates = (context.getResults?.() ?? []).flatMap((evidence) => {
      if (evidence.toolName !== "get_product" || evidence.result.status !== "ok") return [];
      const data = objectValue(evidence.result.data);
      const products = Array.isArray(data?.products) ? data.products : [];
      if (products.length !== 1) return [];
      const product = objectValue(products[0]);
      const variants = Array.isArray(product?.variants) ? product.variants : [];
      if (!meaningful(product?.id) || variants.length !== 1) return [];
      const variant = objectValue(variants[0]);
      if (!meaningful(variant?.id) || typeof variant?.price !== "string" || !/^\d+(?:\.\d+)?$/.test(variant.price)) return [];
      return [{ evidence, price: variant.price, identity: `${product.id}/${variant.id}/${variant.price}` }];
    });
    const latest = candidates.at(-1);
    if (latest && new Set(candidates.map((candidate) => candidate.identity)).size === 1) {
      const path = "products[0].variants[0].price";
      const alreadyCited = approved.some((segment) => segment.type === "fact" && segment.fact_kind === "product_value"
        && segment.evidence.some((basis) => basis.result_id === latest.evidence.resultId && basis.field_paths.some((field) => normalizedDataPath(field) === path)));
      if (!alreadyCited) {
        const segment: ResponseSegment = { type: "fact", fact_kind: "product_value", evidence: [{ result_id: latest.evidence.resultId, field_paths: [path] }] };
        if (!validateSegment(segment, context, -1).length) { approved.push(segment); recovery.push({ type: "cost", result: "recovered" }); }
      }
    }
  }
  if (/\b(?:stock|availability|available|lager)\b/i.test(context.customerMessage ?? "")) {
    const candidates = (context.getResults?.() ?? []).flatMap((evidence) => {
      if (evidence.toolName !== "get_product_availability") return [];
      const products = objectValue(evidence.result.data)?.products;
      if (!Array.isArray(products)) return [];
      return products.flatMap((product, productIndex) => {
        const variants = objectValue(product)?.variants;
        if (!Array.isArray(variants)) return [];
        return variants.flatMap((variant, variantIndex) => {
          const value = objectValue(variant);
          const path = `products[${productIndex}].variants[${variantIndex}].availability_state`;
          const unique = evidence.result.status === "ok" && products.length === 1 && variants.length === 1;
          return meaningful(value?.id) && (PRODUCT_AVAILABILITY_STATES as readonly string[]).includes(String(value?.availability_state))
            && (unique || verifiedAmbiguousAvailability(evidence, path, context))
            ? [{ evidence, path, identity: `${objectValue(product)?.id}/${value.id}/${value.availability_state}` }] : [];
        });
      });
    });
    const latest = candidates.at(-1);
    const alreadyCited = latest && approved.some((segment) => segment.type === "fact" && segment.fact_kind === "product_availability"
      && segment.evidence.some((basis) => basis.result_id === latest.evidence.resultId && basis.field_paths.some((field) => normalizedDataPath(field) === latest.path)));
    if (latest && !alreadyCited && new Set(candidates.map((candidate) => candidate.identity)).size === 1) {
      const segment: ResponseSegment = { type: "fact", fact_kind: "product_availability", evidence: [{ result_id: latest.evidence.resultId, field_paths: [latest.path] }] };
      if (!validateSegment(segment, context, -1).length) { approved.push(segment); recovery.push({ type: "status", result: "recovered" }); }
    }
  }
  if (productCareRequest(context)) {
    const subject = selectedCareSubject(context);
    const records = subject ? careRecords(context).filter((record) => record.subject === subject) : [];
    const latestId = records.at(-1)?.evidence.resultId;
    const text = approved.filter((segment) => segment.type === "knowledge_guidance" && citedCareText(segment.basis, context))
      .map((segment) => (segment as Extract<ResponseSegment, { type: "knowledge_guidance" }>).text).join(" ");
    const facets = (value: string) => ["wash", "dry", "reshape", "bleach", "spot clean", "professional dry clean", "air", "abrasive", "damp cloth"]
      .filter((facet) => new RegExp(`\\b${facet.replace(/ /g, "[ -]+")}\\w*`, "i").test(value));
    const present = new Set(facets(text));
    const selected = records.filter((record) => record.evidence.resultId === latestId
      && facets(record.text).some((facet) => !present.has(facet)));
    if (selected.length) {
      const segment: ResponseSegment = { type: "knowledge_guidance", text: Array.from(new Set(selected.map((record) => record.text))).join("\n\n"),
        basis: { result_id: latestId!, field_paths: selected.map((record) => `results[${record.resultIndex}].evidence_sections[${record.sectionIndex}].${record.textField}`) } };
      if (segment.basis.field_paths.length <= 32 && !validateSegment(segment, context, -1).length) {
        approved.push(segment); recovery.push({ type: "process", result: "recovered" });
      }
    }
  }
  if (/\b(?:because|due to|caused by|reason)\b[\s\S]{0,80}\b(?:stock|inventory)\b/i.test(context.customerMessage ?? "")) {
    const order = (context.getResults?.() ?? []).find((evidence) => verifiedUnfulfilledValue(evidence, "fulfillmentStatus") !== null);
    const items = objectValue(order?.result.data)?.items;
    const availability = (context.getResults?.() ?? []).filter((evidence) => evidence.toolName === "get_product_availability");
    const matchingStock = Array.isArray(items) && availability.some((evidence) => {
      const products = objectValue(evidence.result.data)?.products;
      return Array.isArray(products) && products.some((product, productIndex) => {
        const variants = objectValue(product)?.variants;
        return Array.isArray(variants) && variants.some((variant, variantIndex) => {
          const value = objectValue(variant);
          return value?.availability_state === "OUT_OF_STOCK"
            && (evidence.result.status === "ok" || verifiedAmbiguousAvailability(evidence,
              `products[${productIndex}].variants[${variantIndex}].availability_state`, context)) && items.some((item) =>
            meaningful(objectValue(item)?.variantId) && String(objectValue(item)?.variantId) === String(value?.id));
        });
      });
    });
    const alreadyBounded = approved.some((segment) => segment.type === "limitation"
      && /not (?:confirm|establish)|cannot (?:confirm|establish)|couldn['’]?t (?:verify|confirm)|unverified/i.test(segment.text));
    if (order && matchingStock && !alreadyBounded) {
      const segment: ResponseSegment = { type: "limitation",
        text: "The available order and stock records do not establish that stock is the reason for this order's delay.",
        basis: { result_id: order.resultId, field_paths: ["id", "fulfillmentStatus"] } };
      if (!validateSegment(segment, context, -1).length) { approved.push(segment); recovery.push({ type: "status", result: "recovered" }); }
    }
  }
  if (/dishwasher/i.test(context.customerMessage ?? "") && productCareRequest(context)) {
    const subject = selectedCareSubject(context);
    const selected = subject ? careRecords(context).filter((record) => record.subject === subject) : [];
    const documentedMethod = selected.some((record) => /dishwasher/i.test(record.text)
      && !undocumentedDishwasherMethod(record.text));
    const alreadyBounded = approved.some((segment) => segment.type === "limitation" && /dishwasher/i.test(segment.text));
    const evidence = selected.at(-1);
    if (evidence && !documentedMethod && !alreadyBounded) {
      const segment: ResponseSegment = { type: "limitation", text: "Dishwasher safety is not established in the retrieved product guidance.",
        basis: { result_id: evidence.evidence.resultId, field_paths: [`results[${evidence.resultIndex}].evidence_sections[${evidence.sectionIndex}].${evidence.textField}`] } };
      if (!validateSegment(segment, context, -1).length) { approved.push(segment); recovery.push({ type: "process", result: "recovered" }); }
    }
  }
  if (!approved.length && productCareRequest(context) && !selectedCareSubject(context)
    && !meaningful(context.customerProvidedContext?.product) && !context.turnIR?.actions.length
    && (careRecords(context).length || /\b(?:it|this|that|den|det)\b/i.test(context.customerMessage ?? ""))) {
    const segment: ResponseSegment = { type: "question", purpose: "clarify_task",
      text: "Which product or model are you referring to?", capability: null, missing_arguments: [] };
    if (!validateSegment(segment, context, -1).length) { approved.push(segment); recovery.push({ type: "process", result: "recovered" }); }
  }
  return recovery.length ? { ...validation, approvedSegments: approved,
    completenessDiagnostics: { entered: true, cues: [], recovery } } : validation;
}

export function recoverSupportedProductResponse(
  input: Pick<ResponseValidationContext, "customerMessage" | "customerProvidedContext" | "interactionChannel" | "locale" | "activeOrder" | "getResults">,
): string | null {
  const results = input.getResults?.() ?? [];
  const context: ResponseValidationContext = {
    ...input, getResults: () => results, getResult: (id) => results.find((record) => record.resultId === id),
    definitions: [], manifest: { readTools: results.map((record) => record.toolName), proposalOnlyTools: [],
      configured: { knowledge: true, commerce: true, tracking: false } },
  };
  const recovered = preserveSupportedProductAnswers(validateStructuredResponse(null, context), context);
  return recovered.approvedSegments.length ? renderResponseSegments(recovered.approvedSegments, context) || null : null;
}

function canonicalSemanticSegment(segment: ResponseSegment, context: ResponseValidationContext): ResponseSegment {
  if (segment.type === "limitation") {
    const evidence = resultFor(segment.basis, context);
    if (verifiedOrderSource(evidence, context) && /\b(?:shipping|coupon|discount code|fragt|rabatkode)\b/i.test(segment.text)) {
      const candidate: ResponseSegment = { type: "evidence_limitation", kind: "charged_shipping", basis: { result_id: segment.basis.result_id, field_paths: ["data"] } };
      if (!validateEvidenceLimitation(candidate, context, -1).length) return candidate;
    }
  }
  if (segment.type === "question" && ["clarify_item", "clarify_task", "disambiguate_entity"].includes(segment.purpose)
    && productCareRequest(context) && !segment.basis && !context.turnIR?.actions.length
    && !meaningful(context.customerProvidedContext?.product) && !selectedCareSubject(context)
    && (segment.capability === null || segment.capability === "search_product_knowledge")
    && segment.missing_arguments.every((argument) => argument === "product")
    && /\b(?:which|what)\s+(?:product|model|device|item)\b/i.test(segment.text ?? "")) {
    return { ...segment, purpose: "clarify_task", capability: null, missing_arguments: [] };
  }
  if (segment.type === "question" && segment.purpose === "clarify_item"
    && segment.capability === null && segment.missing_arguments.length === 0 && !segment.basis
    && !meaningful(context.customerProvidedContext?.product) && !selectedCareSubject(context)
    && /\b(?:which|what)\s+(?:product|model|device)\b/i.test(segment.text ?? "")
    && !context.turnIR?.actions.length) {
    return { ...segment, purpose: "clarify_task" };
  }
  if (segment.type === "limitation" && productCareRequest(context)
    && /dishwasher/i.test(context.customerMessage ?? "") && /dishwasher/i.test(segment.text)
    && !containsUnvalidatedOperationalCommitment(segment.text)
    && segment.basis && citedCareText(segment.basis, context)) {
    const records = careRecords(context).filter((record) => record.subject === selectedCareSubject(context));
    if (!records.some((record) => /dishwasher/i.test(record.text) && !undocumentedDishwasherMethod(record.text))) {
      return { ...segment, text: "Dishwasher safety is not established in the retrieved product guidance." };
    }
  }
  if (segment.type === "limitation" && /\b(?:because|due to|caused by|reason)\b[\s\S]{0,80}\b(?:stock|inventory)\b/i.test(context.customerMessage ?? "")
    && ["get_order", "get_product_availability"].includes(resultFor(segment.basis, context)?.toolName ?? "")
    && !containsUnvalidatedOperationalCommitment(segment.text)
    && !validateBasis(segment.basis, context, { requireOk: false, requireMeaningfulFields: false, scope: "result" }, -1).length) {
    return { ...segment, text: "The available order and stock records do not establish that stock is the reason for this order's delay." };
  }
  if (segment.type === "knowledge_guidance" && /\b(?:price|pris)\b/i.test(context.customerMessage ?? "")
    && /\b(?:shipping|postage|include|includes|included|insert|fragt|indeholder)\b/i.test(context.customerMessage ?? "")
    && ["search_policy", "search_product_knowledge"].includes(resultFor(segment.basis, context)?.toolName ?? "")
    && !containsUnvalidatedOperationalCommitment(segment.text)
    && segment.basis.field_paths.every((path) => /^results\[\d+\]\.evidence_sections\[\d+\]\.(?:content|text)$/.test(normalizedDataPath(path)))
    && !validateBasis(segment.basis, context, { requireOk: true, requireMeaningfulFields: true, scope: "data" }, -1).length) {
    const evidence = resultFor(segment.basis, context)!;
    const values = segment.basis.field_paths.map((path) => dataFieldValue(evidence.result, path).value);
    if (values.every((value) => typeof value === "string")) {
      segment = { ...segment, text: Array.from(new Set(values as string[])).join("\n\n") };
    }
  }
  const careBasis = segment.type === "knowledge_guidance" ? segment.basis
    : segment.type === "fact" && segment.fact_kind === "product_value" && segment.evidence.length === 1 ? segment.evidence[0] : null;
  if (careBasis && productCareRequest(context) && careBasis.field_paths.some((path) => normalizedDataPath(path) === "results")
    && resultFor(careBasis, context)?.toolName === "search_product_knowledge"
    && !validateBasis(careBasis, context, { requireOk: true, requireMeaningfulFields: true, scope: "data" }, -1).length) {
    const subject = selectedCareSubject(context);
    const selected = careRecords(context).filter((record) => record.subject === subject && record.evidence.resultId === careBasis.result_id);
    if (selected.length && selected.length <= 32) {
      const basis = { result_id: careBasis.result_id, field_paths: selected.map((record) =>
        `results[${record.resultIndex}].evidence_sections[${record.sectionIndex}].${record.textField}`) };
      if (segment.type === "knowledge_guidance") segment = { ...segment, basis };
      else if (segment.type === "fact") segment = { ...segment, evidence: [basis] };
    }
  }
  if (segment.type === "fact" && segment.fact_kind === "product_value" && segment.evidence.length === 1) {
    const candidate: ResponseSegment = { type: "source_content", kind: productCareRequest(context) ? "care_constraint" : "product_property", basis: segment.evidence[0] };
    if (!validateSourceContent(candidate, context, -1).length) return candidate;
  }
  // A static care value cited as a live product fact is a semantic kind error.
  // Render only the actual cited source content, never model-written prose.
  if (segment.type === "fact" && segment.fact_kind === "product_value" && productCareRequest(context)
    && segment.evidence.length === 1) {
    const basis = segment.evidence[0];
    const evidence = resultFor(basis, context);
    if (evidence?.toolName === "search_product_knowledge" && !validateKnowledgeBasis(basis, context, -1).length) {
      const text = citedCareText(basis, context);
      if (text) return { type: "knowledge_guidance", text, basis };
    }
  }
  return segment;
}

export function validateStructuredResponse(input: unknown, context: ResponseValidationContext): ResponseValidationResult {
  const parsed = StructuredResponseSchema.safeParse(parseInput(input));
  if (!parsed.success) {
    const issue: ResponseValidationIssue = { index: null, code: "schema_invalid", message: "The model did not return the required structured response contract." };
    return { schemaValid: false, allValid: false, approvedSegments: [], rejectedSegments: [], issues: [issue], parsed: null };
  }

  const approvedSegments: ResponseSegment[] = [];
  const segmentDiagnostics: SegmentBoundaryDiagnostic[] = [];
  const rejectedSegments: Array<{ index: number; type?: string; issues: ResponseValidationIssue[] }> = [];
  for (let index = 0; index < parsed.data.segments.length; index += 1) {
    const canonical = canonicalSemanticSegment(parsed.data.segments[index], context);
    const segment = canonical.type === "knowledge_guidance"
      ? { ...canonical, text: normalizeMerchantPolicyAttribution(canonical.text) } : canonical;
    const issues = validateSegment(segment, context, index);
    segmentDiagnostics.push(segmentBoundaryDiagnostic(segment, context, index, issues));
    if (issues.length) rejectedSegments.push({ index, type: segment.type, issues });
    else {
      const careContent = segment.type === "knowledge_guidance" && productCareRequest(context)
        ? citedCareText(segment.basis, context) : null;
      const sourceCandidate: ResponseSegment | null = segment.type === "knowledge_guidance"
        ? projectedProductContent(segment.basis, context) : null;
      approvedSegments.push(sourceCandidate && !validateSourceContent(sourceCandidate, context, index).length ? sourceCandidate
        : careContent && segment.type === "knowledge_guidance" ? { ...segment, text: careContent } : segment);
    }
  }
  return {
    schemaValid: true,
    allValid: rejectedSegments.length === 0,
    approvedSegments,
    rejectedSegments,
    issues: rejectedSegments.flatMap((item) => item.issues),
    parsed: parsed.data,
    segmentDiagnostics,
  };
}

export function summarizeResponseValidation(
  result: ResponseValidationResult,
  { includeCompleteness = false }: { includeCompleteness?: boolean } = {},
) {
  const summary = {
    schema_valid: result.schemaValid,
    all_valid: result.allValid,
    approved_count: result.approvedSegments.length,
    required_answer_coverage: result.coverage ?? null,
    segment_diagnostics: result.segmentDiagnostics ?? [],
    rejected_segments: result.rejectedSegments.map(({ index, type, issues }) => ({
      index,
      type: type ?? null,
      issues: issues.map(({ code, message }) => ({ code, message })),
    })),
  };
  return includeCompleteness
    ? {
        ...summary,
        completeness: result.completenessDiagnostics
          ? {
              entered: result.completenessDiagnostics.entered,
              intent_resolved_by_approved_segment: result.completenessDiagnostics.intent_resolved_by_approved_segment ?? null,
              cues: result.completenessDiagnostics.cues,
              recovery: result.completenessDiagnostics.recovery,
              ...(result.completenessDiagnostics.timing_candidates
                ? { timing_candidates: result.completenessDiagnostics.timing_candidates }
                : {}),
            }
          : null,
      }
    : summary;
}

const DANISH_MARKERS = [
  "jeg", "min", "mit", "mine", "ordre", "ordren", "pakke", "pakken", "hvor", "hvornår",
  "kan", "gerne", "ikke", "har", "leveret", "kommer", "købt", "returnere", "refusion",
  "betaling", "hvilken", "hvad", "fortælle", "vil", "venter", "modtage", "med", "fra",
];

/** Uses only clear lexical signals; otherwise the existing English default remains in place. */
export function inferResponseLocale(input: string): ResponseLocale {
  const source = String(input ?? "").toLowerCase();
  if (/[æøå]/.test(source)) return "da";
  const markerCount = DANISH_MARKERS.filter((marker) => new RegExp(`\\b${marker}\\b`, "i").test(source)).length;
  return markerCount >= 2 ? "da" : "en";
}

function localeFor(context: ResponseValidationContext): ResponseLocale {
  return context.locale ?? "en";
}

function safeCustomerFirstName(value: unknown): string | null {
  const firstName = String(value ?? "").trim().replace(/\s+/g, " ").split(" ")[0] ?? "";
  return /^[\p{L}][\p{L}'’-]{0,39}$/u.test(firstName) ? firstName : null;
}

function greetingFor(context: ResponseValidationContext): string | null {
  if (!context.firstResponse) return null;
  const displayName = context.customerDisplayName
    ?? (context.trustedCustomerIdentity?.verified ? context.customerName : null);
  const firstName = safeCustomerFirstName(displayName);
  if (!firstName) return null;
  return localeFor(context) === "da" ? `Hej ${firstName},` : `Hi ${firstName},`;
}

function firstSentence(value: string) {
  return value.split(".", 1)[0].trim();
}

function lowerFirst(value: string) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function humanArgumentName(argument: string, locale: ResponseLocale = "en") {
  const names: Record<ResponseLocale, Record<string, string>> = {
    en: {
      order_id: "the order number",
      item_id: "the item ID",
      item_ids: "the item IDs",
      address: "the new address",
      amount: "the amount",
      reason: "the reason",
      tracking_number: "the tracking number",
      query: "the product name or SKU",
    },
    da: {
      order_id: "ordrenummeret",
      item_id: "vare-ID'et",
      item_ids: "vare-ID'erne",
      address: "den nye adresse",
      amount: "beløbet",
      reason: "årsagen",
      tracking_number: "trackingnummeret",
      query: "produktnavnet eller SKU'en",
    },
  };
  return names[locale][argument] ?? argument
    .replace(/_ids$/i, locale === "da" ? "-ID'er" : " IDs")
    .replace(/_id$/i, locale === "da" ? "-ID" : " ID")
    .replace(/_/g, " ");
}

function listArguments(argumentsList: string[], locale: ResponseLocale = "en") {
  const labels = argumentsList.map((argument) => humanArgumentName(argument, locale));
  if (labels.length < 2) return labels[0] ?? (locale === "da" ? "de manglende oplysninger" : "the missing information");
  if (labels.length === 2) return locale === "da" ? `${labels[0]} og ${labels[1]}` : `${labels[0]} and ${labels[1]}`;
  const conjunction = locale === "da" ? " og " : ", and ";
  return `${labels.slice(0, -1).join(", ")}${conjunction}${labels.at(-1)}`;
}

const CUSTOMER_FACING_ACTIONS: Record<ResponseLocale, Record<string, string>> = {
  en: {
    cancel_order: "request a cancellation",
    update_address: "request an address change",
    create_return: "request a return",
    create_refund: "request a refund",
    send_replacement: "request a replacement",
  },
  da: {
    cancel_order: "anmode om at få ordren annulleret",
    update_address: "anmode om at få leveringsadressen ændret",
    create_return: "anmode om en returnering",
    create_refund: "anmode om en refundering",
    send_replacement: "anmode om en erstatning",
  },
};

function customerFacingAction(capability: string, locale: ResponseLocale) {
  return CUSTOMER_FACING_ACTIONS[locale][capability]
    ?? (locale === "da" ? "gå videre med denne anmodning" : "continue with this request");
}

function renderCapabilityQuestion(segment: Extract<ResponseSegment, { type: "question" }>, context: ResponseValidationContext) {
  const definition = definitionFor(segment.capability ?? "", context);
  const locale = localeFor(context);
  if (!definition) return locale === "da" ? "Kan du sende de manglende oplysninger, så jeg kan fortsætte?" : "Could you share the missing information so I can continue?";

  if (segment.capability === "get_order" && segment.missing_arguments.includes("order_id")) {
    if (context.activeOrder?.requestedOrderId) {
      const reference = ` #${context.activeOrder.requestedOrderId.replace(/^#/, "")}`;
      return locale === "da"
        ? `Jeg kunne ikke bekræfte ordre${reference}. Hvis du har et andet gyldigt ordrenummer eller en anden ordreidentifikator, må du gerne sende det.`
        : `I couldn’t verify order${reference}. If you have a different valid order number or order identifier, please share it.`;
    }
    const choices = orderCandidateChoices(questionEvidence(segment, context));
    if (choices.length > 1) {
      return renderOrderCandidateClarification(choices, locale);
    }
    return locale === "da"
      ? "Kan du sende ordrenummeret fra din ordrebekræftelse?"
      : "Could you send the order number from your order confirmation?";
  }
  if (segment.capability === "get_tracking" && segment.missing_arguments.includes("tracking_number")) {
    return locale === "da"
      ? "Kan du sende trackingnummeret, du vil have mig til at tjekke?"
      : "Could you send the tracking number you would like me to check?";
  }
  if (segment.capability === "get_product" && segment.missing_arguments.includes("query")) {
    return locale === "da"
      ? "Hvilket produktnavn eller SKU skal jeg tjekke?"
      : "Which product name or SKU should I check?";
  }
  if (segment.capability === "get_product_availability" && segment.missing_arguments.includes("query")) {
    return locale === "da"
      ? "Hvilket produktnavn eller SKU skal jeg tjekke til lagerstatus?"
      : "Which product name or SKU should I check for availability?";
  }

  if (context.manifest.proposalOnlyTools.includes(segment.capability ?? "")) {
    const information = listArguments(segment.missing_arguments, locale);
    const action = customerFacingAction(segment.capability ?? "", locale);
    return locale === "da"
      ? `Kan du sende ${information} først? Når jeg har dem, kan jeg hjælpe dig med at ${action}. Der bliver ikke ændret noget, før du bekræfter.`
      : `Could you share ${information} first? Once I have them, I can help you ${action}. Nothing will be changed until you confirm.`;
  }

  const operation = firstSentence(definition.description)
    .replace(/^Read\s+/i, locale === "da" ? "slå op i " : "look up ")
    .replace(/^Propose\s+/i, locale === "da" ? "forberede et forslag om " : "prepare a proposal for ");
  const information = listArguments(segment.missing_arguments, locale);
  return locale === "da"
    ? `Kan du sende ${information}, så jeg kan ${lowerFirst(operation)}?`
    : `Could you share ${information} so I can ${lowerFirst(operation)}?`;
}

function renderGroundedQuestion(segment: Extract<ResponseSegment, { type: "question" }>, context: ResponseValidationContext) {
  if (segment.purpose !== "disambiguate_variant") return renderTextSegment(segment.text);
  const evidence = questionEvidence(segment, context);
  const data = objectValue(evidence?.result.data);
  const product = Array.isArray(data?.products) ? objectValue(data.products[0]) : null;
  const productTitle = meaningful(product?.title) ? String(product.title) : null;
  const choices = productVariantChoices(evidence);
  if (!productTitle || choices.length < 2) return renderTextSegment(segment.text);
  const locale = localeFor(context);
  const choiceText = joinList(choices, locale);
  return locale === "da"
    ? `Hvilken variant af ${productTitle} vil du gerne have, at jeg tjekker — ${choiceText}?`
    : `Which ${productTitle} variant would you like me to check — ${choiceText}?`;
}

function renderActionOffer(segment: Extract<ResponseSegment, { type: "action_offer" }>, context: ResponseValidationContext) {
  const definition = definitionFor(segment.capability, context);
  const locale = localeFor(context);
  if (!definition) {
    return locale === "da"
      ? "Jeg mangler nogle oplysninger, før jeg kan forberede den ønskede anmodning."
      : "I still need a few details before I can prepare the requested change.";
  }
  const action = customerFacingAction(segment.capability, locale);
  if (!segment.missing_arguments.length && context.confirmedAction?.(segment.capability)) {
    return locale === "da" ? "Din bekræftede anmodning er klar til gennemgang. Der er ikke ændret noget."
      : "Your confirmed request is ready for review. Nothing has been changed.";
  }
  if (locale === "da") {
    if (segment.missing_arguments.length) {
      return `Kan du sende ${listArguments(segment.missing_arguments, locale)} først? Når jeg har dem, kan jeg hjælpe dig med at ${action}. Der bliver ikke ændret noget, før du bekræfter.`;
    }
    return `Jeg kan hjælpe dig med at ${action}. Der bliver ikke ændret noget, før du bekræfter.`;
  }
  if (segment.missing_arguments.length) {
    return `Could you share ${listArguments(segment.missing_arguments, locale)} first? Once I have them, I can help you ${action}. Nothing will be changed until you confirm.`;
  }
  return `I can help you ${action}. Nothing will be changed until you confirm.`;
}

type CustomerCompositionRole = "resolution" | "destination" | "method" | "obligation" | "eligibility" | "outcome" | "clarification" | "action_offer";

type CustomerCompositionPiece = {
  role: CustomerCompositionRole;
  segment: ResponseSegment;
  facet?: ActionablePolicyFacet;
};

function compositionFacetRole(kind: ActionablePolicyFacetKind): CustomerCompositionRole | null {
  switch (kind) {
    case "eligibility": return "eligibility";
    case "destination": return "destination";
    case "shipping_method": return "method";
    case "cost": return "obligation";
    case "timing": return "outcome";
    case "process": return null;
  }
}

function compositionPolicySegmentForFacet(
  facet: ActionablePolicyFacet,
  segments: ResponseSegment[],
  context: ResponseValidationContext,
) {
  const role = compositionFacetRole(facet.kind);
  if (!role || facet.status === "satisfied") return null;
  return segments.find((segment) => segment.type === "knowledge_guidance"
    && isPolicyKnowledgeBasis(segment.basis, context)
    && actionablePolicyFacetCovered(facet, [segment], context));
}

function compositionPieces(
  segments: ResponseSegment[],
  plan: ActionablePolicyPlan,
  context: ResponseValidationContext,
) {
  const pieces: CustomerCompositionPiece[] = [];
  for (const facet of plan.facets) {
    const role = compositionFacetRole(facet.kind);
    if (!role) continue;
    const segment = compositionPolicySegmentForFacet(facet, segments, context);
    if (segment) pieces.push({ role, segment, facet });
  }
  segments.forEach((segment) => {
    if (segment.type === "action_offer") pieces.push({ role: "action_offer", segment });
    else if (segment.type === "question"
      && segment.purpose !== "enable_capability"
      && segment.purpose !== "disambiguate_entity"
      && segment.purpose !== "disambiguate_variant"
      && segment.purpose !== "resolve_required_argument") {
      pieces.push({ role: "clarification", segment });
    }
  });
  return pieces;
}

function compositionFacetSourceText(
  piece: CustomerCompositionPiece,
  context: ResponseValidationContext,
) {
  if (!piece.facet || piece.segment.type !== "knowledge_guidance") return piece.segment.type === "knowledge_guidance" ? piece.segment.text : "";
  const records = answerEvidenceRecords(piece.segment.basis, context, piece.facet.cue);
  const units = answerEvidenceSections(records).flatMap(policyEvidenceUnits);
  const relevant = piece.facet.kind === "eligibility"
    ? units.filter((unit) => isAnswerBearingEligibility(unit) || isReturnProhibition(unit) || isReturnEligibility(unit) || isReturnConditionConsequence(unit))
    : piece.facet.kind === "shipping_method"
      ? units.filter(isReturnShippingMethodInstruction)
      : piece.facet.kind === "cost"
        ? units.filter(isReturnShippingResponsibility)
        : piece.facet.kind === "timing"
          ? units.filter(isRefundTiming)
          : [];
  if (relevant.length) return Array.from(new Set(relevant)).join(" ");
  if (piece.facet.recovery.kind === "usable" && piece.facet.recovery.candidate) return piece.facet.recovery.candidate.value;
  return piece.segment.text;
}

function compositionPieceText(piece: CustomerCompositionPiece, context: ResponseValidationContext) {
  if (piece.segment.type !== "knowledge_guidance") return "";
  const sourceText = compositionFacetSourceText(piece, context);
  return adaptCustomerFacingKnowledgeText(sourceText, context, {
    policy: true,
    basis: piece.segment.basis,
  });
}

/** Correct policy ownership only; retain the claim, conditions, numbers and formatting. */
export function normalizeMerchantPolicyAttribution(value: string): string {
  const terms = "(?:returns?|refunds?|shipping|delivery|warranty|guarantee|prices?|pricing|cancellation|order[ -]changes?|polic(?:y|ies)|terms?|conditions?|rules?)\\b";
  const modifiers = "(?:(?!(?:agent|support|assistant|reply|response|message|advice|explanation|help|service|signature|Sona|and|or)\\b)(?!" + terms + ")[\\p{L}\\p{N}][\\p{L}\\p{N}’'_-]*\\s+){0,5}";
  const owner = new RegExp("\\bSona(?:['’ʼ]s|s|['’ʼ])\\s+(" + modifiers + ")(?=" + terms + ")|\\bSona\\s+()(?=" + terms + ")", "giu");
  return value
    .replace(owner, (_match, adjectives: string | undefined, _bare: string | undefined, offset: number) => {
      const sentenceStart = !value.slice(0, offset).trim() || /[.!?]\s*$/.test(value.slice(0, offset));
      return `${sentenceStart ? "The" : "the"} store's ${adjectives ?? ""}`;
    })
    .replace(/\bSonas?['’]?\s+(?=(?:retur(?:politik|betingelser|vilkår)|fragt(?:priser|betingelser)|leverings(?:vilkår|betingelser)|garanti(?:vilkår|betingelser)?|priser|handelsbetingelser)\b)/gi, "butikkens ")
    .replace(/\bSonas?['’]?\s+((?:Rückgabe|Versand|Liefer|Garantie|Geschäfts)(?:bedingungen|richtlinien|preise)?|Garantie|Preise)\b/g, "$1 des Shops")
    .replace(/\b((?:(?:return|shipping|delivery|warranty|operational)\s+)?(?:polic(?:y|ies)|terms|conditions|rules|prices))\s+(?:of|from)\s+Sona\b/gi, "$1 of the store")
    .replace(/\bSona\s+(sets|charges|requires|accepts|offers)\s+(?=(?:(?:ordinary|standard|normal|free)\s+){0,3}(?:returns?|shipping|delivery|warrant(?:y|ies)|prices?|pricing|policies|terms|conditions|rules)\b)/gi, "The store $1 ");
}

function neutralizeAgentPolicyOwnership(value: string) {
  return value
    .replace(/\bSona(?:['’]s)?\s+policy\s+(?=(?:allows?|accepts?|permits?|covers?)\b)/gi, "")
    .replace(/^\s*(?:as\s+per|according\s+to)\s+(?:Sona(?:['’]s)?|our|the\s+support\s+agent(?:['’]s)?)\s+policy\s*[:,]?\s*/i, "")
    .replace(/\bwe\s+(?:accept|allow|permit)\s+returns?\b/gi, "returns are accepted")
    .replace(/\bSona(?:['’]s)?\s+policy\b/gi, "the store's policy")
    .replace(/\s+/g, " ")
    .trim();
}

function compositionEligibilityText(value: string, locale: ResponseLocale) {
  const normalized = neutralizeAgentPolicyOwnership(value);
  if (!normalized) return "";
  const directEligibility = policyEvidenceUnits(normalized).filter((unit) =>
    isReturnEligibility(unit)
    && !/^\s*(?:to|in\s+order\s+to)\s+return\b/i.test(unit)
    && !/:\s*\d+\./.test(unit),
  );
  const concise = directEligibility.length ? directEligibility.join(" ") : normalized;
  if (locale === "da") {
    return concise
      .replace(/^returns?\s+are\s+accepted\b/i, "Returneringer accepteres")
      .replace(/^returns?\s+are\s+allowed\b/i, "Returneringer er tilladt");
  }
  return concise
    .replace(/^returns?\s+are\s+accepted\b/i, "Returns are accepted")
    .replace(/^returns?\s+are\s+allowed\b/i, "Returns are allowed");
}

function compositionShippingMethodText(value: string, locale: ResponseLocale) {
  const text = neutralizeAgentPolicyOwnership(value);
  if (/\b(?:tracked|trackable|track\s+and\s+trace|tracking)\b/i.test(text)) {
    return locale === "da" ? "sporbar forsendelse" : "tracked shipping";
  }
  if (/\b(?:insured|registered)\b/i.test(text)) {
    return locale === "da" ? "forsikret eller registreret forsendelse" : "insured or registered shipping";
  }
  if (/\bprepaid\b/i.test(text)) return locale === "da" ? "forudbetalt forsendelse" : "prepaid shipping";
  return text.replace(/[.!?]+$/g, "").trim();
}

function compositionObligationText(value: string, locale: ResponseLocale) {
  const text = neutralizeAgentPolicyOwnership(value);
  const customerPays = /\b(?:you|your|customer|buyer|du|din|kunden|køber)\b[\s\S]{0,64}\b(?:pay|paid|pays|cost|expense|responsib|betaler|betalt|omkostning|udgift|ansvar)\w*\b/i.test(text)
    || /\b(?:paid|borne|covered|betalt|båret|dækket)\s+by\s+(?:you|the\s+customer|kunden|dig)\b/i.test(text)
    || /\b(?:at|on|til|på)\s+(?:your|customer['’]s|din|kundens)(?:\s+own)?\s+(?:cost|expense|omkostning\w*|udgift\w*)\b/i.test(text);
  const merchantPays = /\b(?:we|our|merchant|store|seller|vi|forhandler|butik|sælger)\b[\s\S]{0,64}\b(?:pay|paid|pays|cover|covered|cost|expense|betaler|betalt|dækker|omkostning|udgift)\w*\b/i.test(text);
  const mentionsPackaging = /\b(?:secure|protective)\s+packaging\b|\bemballage\b|\bverpackung\b/i.test(text);
  if (customerPays) {
    if (mentionsPackaging) {
      return locale === "da"
        ? "Du betaler returfragt og andre returomkostninger, f.eks. forsvarlig emballage."
        : "Return shipping and other return-related costs, such as secure packaging, are your responsibility.";
    }
    return locale === "da" ? "Du betaler returfragten." : "Return shipping is at your own cost.";
  }
  if (merchantPays) return locale === "da" ? "Butikken dækker returfragten." : "The store covers return shipping.";
  return text;
}

function compositionOutcomeText(value: string, locale: ResponseLocale) {
  const text = neutralizeAgentPolicyOwnership(value);
  const receivedAndProcessed = /(?:after|once|when|as\s+soon\s+as)\b[\s\S]{0,120}\b(?:receive\w*|receipt|return\w*|process\w*)\b[\s\S]{0,80}\b(?:refund|refunder\w*|tilbagebetaling\w*)\b/i.test(text)
    || /\b(?:receive\w*|receipt|return\w*|process\w*)\b[\s\S]{0,120}\b(?:after|once|when|as\s+soon\s+as)\b[\s\S]{0,80}\b(?:refund|refunder\w*|tilbagebetaling\w*)\b/i.test(text)
    || /\b(?:refund|refunder\w*|tilbagebetaling\w*)\b[\s\S]{0,120}\b(?:after|once|when|as\s+soon\s+as)\b[\s\S]{0,120}\b(?:receive\w*|receipt|return\w*|process\w*)\b/i.test(text);
  if (receivedAndProcessed && /\brefund\w*\b/i.test(text)) {
    return locale === "da"
      ? "Når returneringen er modtaget og behandlet, bliver refunderingen igangsat."
      : "Once the return is received and processed, your refund will be issued.";
  }
  return text;
}

function destinationComponentsFromEvidence(segment: Extract<ResponseSegment, { type: "knowledge_guidance" }>, context: ResponseValidationContext) {
  const records = answerEvidenceRecords(segment.basis, context, "destination");
  for (const evidenceText of answerEvidenceSections(records)) {
    const lines = evidenceText.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line || !isConcreteReturnDestinationInstruction(line)) continue;
      const afterCue = line.replace(/^.*?(?::|\bto\b|\btil\b|\ban\b|\bzu\b)\s*/i, "").trim();
      const block: string[] = [];
      if (afterCue && simpleAddressLabel(afterCue) && physicalAddressMarker(lines[index + 1] ?? "")) block.push(afterCue);
      let nextIndex = index + 1;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex += 1;
      for (; nextIndex < lines.length; nextIndex += 1) {
        const next = lines[nextIndex].trim();
        if (!next) break;
        const nextIsAddress = physicalAddressMarker(next);
        const nextCouldBeName = block.length === 0 && simpleAddressLabel(next) && physicalAddressMarker(lines[nextIndex + 1] ?? "");
        const nextCouldBeCity = block.length > 0 && block.some(physicalAddressMarker) && simpleAddressLabel(next);
        if (!nextIsAddress && !nextCouldBeName && !nextCouldBeCity) break;
        block.push(next);
      }
      if (block.some(physicalAddressMarker)) return block.join("\n");
    }
  }
  return null;
}

function compositionOrderFacts(segments: ResponseSegment[]) {
  return segments.filter((segment): segment is Extract<ResponseSegment, { type: "fact" }> => segment.type === "fact" && ORDER_FACT_KINDS.has(segment.fact_kind));
}

function compositionQuestionText(piece: CustomerCompositionPiece) {
  return piece.segment.type === "question" ? renderTextSegment(piece.segment.text) : "";
}

function compositionProcessClarification(plan: ActionablePolicyPlan, context: ResponseValidationContext) {
  const processFacet = plan.facets.find((facet) => facet.kind === "process");
  const candidate = processFacet?.recovery.kind === "usable" ? processFacet.recovery.candidate : null;
  if (!candidate) return "";
  const requirement = candidate.value.replace(/^please\s+provide\s+/i, "").trim();
  if (!requirement) return "";
  return naturalMissingRequirementQuestion([requirement], context);
}

function composeActionableResponse(segments: ResponseSegment[], context: ResponseValidationContext): string | null {
  const plan = actionablePolicyPlan(context);
  if (!plan || plan.facets.some((facet) => facet.status === "ambiguous")) return null;
  const hasVerifiedOrder = context.activeOrder?.state === "verified";
  const hasActionOffer = segments.some((segment) => segment.type === "action_offer");
  if (!hasVerifiedOrder && !hasActionOffer) return null;
  const pieces = compositionPieces(segments, plan, context);
  const byRole = (role: CustomerCompositionRole) => pieces.filter((piece) => piece.role === role);
  const eligibility = byRole("eligibility")[0];
  const destination = byRole("destination")[0];
  const method = byRole("method")[0];
  const obligation = byRole("obligation")[0];
  const outcome = byRole("outcome")[0];
  const action = byRole("action_offer")[0];
  const clarifications = byRole("clarification");
  const orderFacts = compositionOrderFacts(segments);
  const locale = localeFor(context);
  const clarificationTexts = Array.from(new Set([
    ...clarifications.map(compositionQuestionText).filter(Boolean),
    compositionProcessClarification(plan, context),
  ].filter(Boolean)));
  const composed: string[] = [];
  const canResolveVerifiedOrder = context.activeOrder?.state === "verified"
    && Boolean(context.activeOrder.requestedOrderId)
    && Boolean(eligibility)
    && Boolean(verifiedOrderItemTitle(context));

  if (canResolveVerifiedOrder) {
    const reference = context.activeOrder!.requestedOrderId!.replace(/^#/, "");
    const subject = customerFacingReturnSubject(context);
    composed.push(locale === "da"
      ? `Du kan anmode om at returnere ${subject} fra ordre #${reference}.`
      : `You can request a return for ${subject} from order #${reference}.`);
  } else if (orderFacts.length) {
    composed.push(renderOrderFacts(orderFacts, context));
  }

  if (eligibility) {
    const text = compositionEligibilityText(compositionPieceText(eligibility, context), locale);
    if (text && !composed.some((item) => item.includes(text))) composed.push(text);
  }

  if (destination) {
    const destinationSegment = destination.segment.type === "knowledge_guidance" ? destination.segment : null;
    const address = destinationSegment ? destinationComponentsFromEvidence(destinationSegment, context) : null;
    const renderedAddress = address ?? compositionPieceText(destination, context);
    const methodText = method ? compositionShippingMethodText(compositionPieceText(method, context), locale) : "";
    if (renderedAddress) {
      if (methodText) {
        composed.push(locale === "da"
          ? `Send den med ${methodText} til:\n\n${renderedAddress}`
          : `Please send it with ${methodText} to:\n\n${renderedAddress}`);
      } else {
        composed.push(locale === "da" ? `Send den til:\n\n${renderedAddress}` : `Please send it to:\n\n${renderedAddress}`);
      }
    }
  } else if (method) {
    const methodText = compositionShippingMethodText(compositionPieceText(method, context), locale);
    if (methodText) composed.push(locale === "da" ? `Brug ${methodText}.` : `Please use ${methodText}.`);
  }

  if (obligation) {
    const text = compositionObligationText(compositionPieceText(obligation, context), locale);
    if (text) composed.push(text);
  }
  if (outcome) {
    const text = compositionOutcomeText(compositionPieceText(outcome, context), locale);
    if (text) composed.push(text);
  }

  const actionText = action && action.segment.type === "action_offer" ? renderActionOffer(action.segment, context) : "";
  if (actionText && action?.segment.type === "action_offer" && action.segment.missing_arguments.length === 0 && clarificationTexts.length) {
    const question = clarificationTexts[0];
    composed.push(`${actionText.replace(/\.$/, "")}. ${locale === "da" ? `Hvis du vil have mig til at gøre det, ${lowerFirst(question)}` : `If you'd like me to do that, ${lowerFirst(question)}`}`);
  } else {
    if (clarificationTexts.length) composed.push(...clarificationTexts);
    if (actionText) composed.push(actionText);
  }

  const response = composed.filter(Boolean).join("\n\n");
  if (!response) return null;
  const hasSubstantiveSegment = segments.some((segment) => segment.type !== "acknowledgement");
  const greeting = hasSubstantiveSegment ? greetingFor(context) : null;
  return greeting && response ? `${greeting}\n\n${response}` : response;
}

function factEvidenceValues(segment: Extract<ResponseSegment, { type: "fact" }>, context: ResponseValidationContext) {
  return segment.evidence.flatMap((basis) => {
    const evidence = resultFor(basis, context);
    if (!evidence) return [];
    return basis.field_paths.flatMap((path) => {
      const field = dataFieldValue(evidence.result, path);
      const value = segment.fact_kind === "order_fulfillment_status"
        ? verifiedUnfulfilledValue(evidence, path) ?? field.value : field.value;
      if (!field.exists || !meaningful(value)) return [];
      return [{ path, value, evidence }];
    });
  });
}

function scalarFactValue(
  facts: Extract<ResponseSegment, { type: "fact" }>[],
  context: ResponseValidationContext,
  predicate: (path: string) => boolean,
) {
  for (const fact of facts) {
    const value = factEvidenceValues(fact, context).find((item) => predicate(item.path))?.value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
}

function sentence(value: string) {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function joinList(values: string[], locale: ResponseLocale) {
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return locale === "da" ? `${values[0]} og ${values[1]}` : `${values[0]} and ${values[1]}`;
  return locale === "da"
    ? `${values.slice(0, -1).join(", ")} og ${values.at(-1)}`
    : `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function orderCandidateChoices(evidence: ResponseEvidenceRecord | undefined) {
  const data = objectValue(evidence?.result.data);
  if (data?.order_resolution !== "multiple" || !Array.isArray(data.order_candidates)) return [];
  return data.order_candidates.flatMap((value) => {
    const candidate = objectValue(value);
    const orderNumber = meaningful(candidate?.order_number) ? String(candidate.order_number).replace(/^#/, "") : "";
    if (!orderNumber) return [];
    const titles = Array.isArray(candidate?.item_titles)
      ? candidate.item_titles.filter(meaningful).map((title) => String(title).replace(/\s+/g, " ").trim()).slice(0, 3)
      : [];
    return [`#${orderNumber}${titles.length ? ` — ${titles.join(", ")}` : ""}`];
  }).slice(0, 5);
}

function renderOrderCandidateClarification(choices: string[], locale: ResponseLocale) {
  const choiceText = joinList(choices, locale);
  return locale === "da"
    ? `Hvilken ordre vil du gerne have hjælp til — ${choiceText}?`
    : `Which order would you like help with — ${choiceText}?`;
}

export function renderOrderCandidateClarificationFromResults(
  getResults: (() => ResponseEvidenceRecord[]) | undefined,
  locale: ResponseLocale = "en",
) {
  const historyEvidence = (getResults?.() ?? [])
    .filter((record) => record.toolName === "get_order_history")
    .at(-1);
  const choices = orderCandidateChoices(historyEvidence);
  return choices.length > 1 ? renderOrderCandidateClarification(choices, locale) : undefined;
}

function isOrderCandidateClarification(
  segment: Extract<ResponseSegment, { type: "question" }>,
  context: ResponseValidationContext,
) {
  const choiceText = renderOrderCandidateClarificationFromResults(context.getResults, localeFor(context));
  if (!choiceText || context.activeOrder?.state === "verified") return false;
  if (segment.capability === "get_order" && segment.missing_arguments.includes("order_id")) return true;
  return /\b(?:order|purchase)\b/i.test(segment.text ?? "");
}

type RenderedOrderItem = { title: string; quantity: number | string };

function quantityValue(value: unknown): number | string | null {
  if (!meaningful(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  const numeric = Number(text);
  return Number.isFinite(numeric) && text !== "" ? numeric : text;
}

function addRenderedOrderItem(items: Map<string, RenderedOrderItem>, titleValue: unknown, quantityValueInput: unknown) {
  if (!meaningful(titleValue)) return;
  const quantity = quantityValue(quantityValueInput);
  if (quantity === null) return;
  const title = String(titleValue);
  const existing = items.get(title);
  if (!existing) {
    items.set(title, { title, quantity });
    return;
  }
  if (typeof existing.quantity === "number" && typeof quantity === "number") {
    existing.quantity += quantity;
  }
}

function orderItems(facts: Extract<ResponseSegment, { type: "fact" }>[], context: ResponseValidationContext) {
  const items = new Map<string, RenderedOrderItem>();
  const indexedItems = new Map<string, { title?: unknown; quantity?: unknown }>();
  for (const fact of facts) {
    for (const { path, value, evidence } of factEvidenceValues(fact, context)) {
      if (pathHasAnySuffix(path, ["items"]) && Array.isArray(value)) {
        for (const item of value) {
          const record = objectValue(item);
          addRenderedOrderItem(items, record?.title, record?.quantity);
        }
        continue;
      }
      const binding = itemPath(path);
      if (!binding || binding.index == null || !meaningful(value)) continue;
      const item = indexedItems.get(binding.index) ?? {};
      if (binding.property === "title") {
        item.title = String(value);
        if (item.quantity == null) {
          const sibling = siblingItemValue(evidence, path, binding.index, "quantity");
          if (sibling.exists && meaningful(sibling.value)) item.quantity = sibling.value;
        }
      }
      if (binding.property === "quantity") {
        item.quantity = String(value);
        if (item.title == null) {
          const sibling = siblingItemValue(evidence, path, binding.index, "title");
          if (sibling.exists && meaningful(sibling.value)) item.title = sibling.value;
        }
      }
      if (binding.property === "object") {
        const record = objectValue(value);
        item.title = record?.title;
        item.quantity = record?.quantity;
      }
      indexedItems.set(binding.index, item);
    }
  }
  indexedItems.forEach((item) => {
    addRenderedOrderItem(items, item.title, item.quantity);
  });
  return Array.from(items.values()).map((item) => `${item.quantity} × ${item.title}`);
}

function orderHistoryItems(facts: Extract<ResponseSegment, { type: "fact" }>[], context: ResponseValidationContext) {
  const rows = new Map<string, {
    orderNumber?: string;
    items: Map<string, RenderedOrderItem>;
    indexedItems: Map<string, { title?: unknown; quantity?: unknown }>;
  }>();
  for (const fact of facts) {
    for (const { path, value } of factEvidenceValues(fact, context)) {
      const normalized = normalizedDataPath(path);
      const match = normalized.match(/^orders\[(\d+)\]\.(orderNumber|items(?:\[\d+\])?(?:\.(?:title|quantity))?)$/i);
      if (!match) continue;
      const row = rows.get(match[1]) ?? {
        items: new Map<string, RenderedOrderItem>(),
        indexedItems: new Map<string, { title?: unknown; quantity?: unknown }>(),
      };
      if (match[2] === "orderNumber" && meaningful(value)) row.orderNumber = String(value);
      if (match[2] === "items" && Array.isArray(value)) {
        for (const item of value) {
          const record = objectValue(item);
          addRenderedOrderItem(row.items, record?.title, record?.quantity);
        }
      }
      const itemMatch = match[2].match(/^items\[(\d+)\]\.(title|quantity)$/i);
      if (itemMatch) {
        const item = row.indexedItems.get(itemMatch[1]) ?? {};
        item[itemMatch[2] as "title" | "quantity"] = value;
        row.indexedItems.set(itemMatch[1], item);
      }
      rows.set(match[1], row);
    }
  }
  for (const row of rows.values()) {
    for (const item of row.indexedItems.values()) addRenderedOrderItem(row.items, item.title, item.quantity);
  }
  return Array.from(rows.values())
    .filter((row) => row.orderNumber && row.items.size)
    .map((row) => `#${row.orderNumber!.replace(/^#/, "")}: ${Array.from(row.items.values()).map((item) => `${item.quantity} × ${item.title}`).join(", ")}`);
}

function orderStateClause(kind: "financial" | "fulfillment", value: string, locale: ResponseLocale) {
  const key = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (kind === "financial") {
    if (key === "paid") return locale === "da" ? "er betalt" : "is paid";
    if (key === "pending") return locale === "da" ? "har en afventende betaling" : "has a pending payment";
    if (key === "refunded") return locale === "da" ? "er refunderet" : "has been refunded";
    return locale === "da" ? `har betalingsstatus ${value}` : `has payment status ${value}`;
  }
  if (key === "fulfilled") return locale === "da" ? "er afsendt" : "has shipped";
  if (key === "partial" || key === "partially_fulfilled") {
    return locale === "da"
      ? "har sendt nogle varer, mens andre stadig ikke er afsendt"
      : "has shipped some items while others are still unfulfilled";
  }
  if (key === "unfulfilled" || key === "pending") return locale === "da" ? "er endnu ikke afsendt" : "has not shipped yet";
  return locale === "da" ? `har leveringsstatus ${value}` : `has fulfillment status ${value}`;
}

function renderOrderFacts(facts: Extract<ResponseSegment, { type: "fact" }>[], context: ResponseValidationContext) {
  const locale = localeFor(context);
  const history = orderHistoryItems(facts.filter((fact) => fact.fact_kind === "order_reference" || fact.fact_kind === "order_item"), context);
  if (history.length) {
    return locale === "da"
      ? `Dine seneste ordrer er ${joinList(history, locale)}.`
      : `Your recent orders include ${joinList(history, locale)}.`;
  }
  const reference = scalarFactValue(facts, context, (path) => pathHasAnySuffix(path, ["orderNumber", "order_number"]));
  const financial = scalarFactValue(facts, context, (path) => pathHasAnySuffix(path, ["financialStatus", "financial_status"]));
  const fulfillment = scalarFactValue(facts, context, (path) => pathHasAnySuffix(path, ["fulfillmentStatus", "fulfillment_status"]));
  const items = orderItems(facts.filter((fact) => fact.fact_kind === "order_item"), context);
  const details = [
    financial ? orderStateClause("financial", financial, locale) : null,
    fulfillment ? orderStateClause("fulfillment", fulfillment, locale) : null,
    items.length ? (locale === "da" ? `indeholder ${joinList(items, locale)}` : `includes ${joinList(items, locale)}`) : null,
  ].filter((value): value is string => Boolean(value));
  if (reference && details.length) {
    return locale === "da"
      ? `Jeg har tjekket ordre #${reference.replace(/^#/, "")}, og den ${joinList(details, locale)}.`
      : `I’ve checked order #${reference.replace(/^#/, "")}, and it ${joinList(details, locale)}.`;
  }
  if (reference) {
    return locale === "da"
      ? `Jeg har tjekket ordre #${reference.replace(/^#/, "")}.`
      : `I’ve checked order #${reference.replace(/^#/, "")}.`;
  }
  if (details.length) {
    return locale === "da" ? `Din ordre ${joinList(details, locale)}.` : `Your order ${joinList(details, locale)}.`;
  }
  return "";
}

function shipmentStatusClause(value: string, locale: ResponseLocale) {
  const key = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (key === "delivered") return "delivered";
  if (key === "in_transit" || key === "transit") return "in_transit";
  if (key === "out_for_delivery") return "out_for_delivery";
  if (key === "pending" || key === "pre_transit") return "pending";
  return null;
}

function formatTimestamp(value: string, locale: ResponseLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    const language = locale === "da" ? "da-DK" : "en-GB";
    return `${new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
  } catch {
    return value;
  }
}

function formatEta(value: string, locale: ResponseLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    const language = locale === "da" ? "da-DK" : "en-GB";
    const hasTime = /T\d{2}:\d{2}/.test(value) && !/T00:00(?::00(?:\.000)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value);
    return new Intl.DateTimeFormat(language, hasTime
      ? { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }
      : { dateStyle: "medium", timeZone: "UTC" }).format(date);
  } catch {
    return value;
  }
}

function safeTrackingUrl(value: unknown): string | null {
  const candidate = String(value ?? "").trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? candidate : null;
  } catch {
    return null;
  }
}

function verifiedTrackingUrl(facts: Extract<ResponseSegment, { type: "fact" }>[], context: ResponseValidationContext) {
  for (const fact of facts) {
    for (const basis of fact.evidence) {
      const evidence = resultFor(basis, context);
      if (!evidence || !["get_tracking", "get_order", "inspect_fulfillment"].includes(evidence.toolName) || evidence.result.status !== "ok") continue;
      for (const path of [
        "tracking_identifier.tracking_url",
        "tracking_identifier.trackingUrl",
        "fulfillments[0].trackingUrl",
        "fulfillments[0].tracking_url",
        "tracking_url",
      ]) {
        const field = dataFieldValue(evidence.result, path);
        const url = safeTrackingUrl(field.value);
        if (field.exists && url) return url;
      }
    }
  }
  return null;
}

function verifiedTrackingSourceFromLimitedResult(evidence: ResponseEvidenceRecord | undefined) {
  if (!evidence || evidence.toolName !== "get_tracking" || !["not_found", "unavailable", "error"].includes(evidence.result.status)) {
    return null;
  }
  const carrier = resultFieldValue(evidence.result, "data.tracking_identifier.carrier").value;
  const trackingUrl = safeTrackingUrl(resultFieldValue(evidence.result, "data.tracking_identifier.tracking_url").value);
  if (!meaningful(carrier) && !trackingUrl) return null;
  return {
    carrier: meaningful(carrier) ? String(carrier) : null,
    trackingUrl,
  };
}

function renderVerifiedTrackingSource(evidence: ResponseEvidenceRecord | undefined, locale: ResponseLocale) {
  const source = verifiedTrackingSourceFromLimitedResult(evidence);
  if (!source) return "";
  const carrier = source.carrier
    ? locale === "da" ? `Pakken sendes med ${source.carrier}.` : `Your package is being handled by ${source.carrier}.`
    : "";
  const link = source.trackingUrl
    ? locale === "da" ? `Du kan følge pakken her: ${source.trackingUrl}` : `Track your package here: ${source.trackingUrl}`
    : "";
  return [carrier, link].filter(Boolean).join(" ");
}

function latestShipmentScan(facts: Extract<ResponseSegment, { type: "fact" }>[], context: ResponseValidationContext) {
  const latestEvent: { timestamp?: string; location?: string } = {};
  const checkpoints = new Map<string, { timestamp?: string; location?: string }>();
  let eventCheckpointIndex: string | undefined;
  for (const fact of facts) {
    for (const { path, value } of factEvidenceValues(fact, context)) {
      const normalized = normalizedDataPath(path);
      if (normalized.endsWith("live_tracking.latestEvent.timestamp")) latestEvent.timestamp = String(value);
      else if (normalized.endsWith("live_tracking.latestEvent.location")) latestEvent.location = String(value);
      else {
        const eventMatch = normalized.match(/live_tracking\.checkpoints\[(\d+)\]\.description$/);
        if (fact.fact_kind === "shipment_event" && eventMatch) eventCheckpointIndex = eventMatch[1];
        const match = normalized.match(/live_tracking\.checkpoints\[(\d+)\]\.(timestamp|location)$/);
        if (!match) continue;
        const checkpoint = checkpoints.get(match[1]) ?? {};
        checkpoint[match[2] as "timestamp" | "location"] = String(value);
        checkpoints.set(match[1], checkpoint);
      }
    }
  }
  if (eventCheckpointIndex != null) return checkpoints.get(eventCheckpointIndex) ?? {};
  if (latestEvent.timestamp || latestEvent.location) return latestEvent;
  return Array.from(checkpoints.values())
    .filter((checkpoint) => checkpoint.timestamp || checkpoint.location)
    .sort((left, right) => String(right.timestamp ?? "").localeCompare(String(left.timestamp ?? "")))[0] ?? {};
}

function renderShipmentFacts(facts: Extract<ResponseSegment, { type: "fact" }>[], context: ResponseValidationContext) {
  const trackingIds = Array.from(new Set(facts.flatMap(fact => fact.evidence.filter(basis => resultFor(basis, context)?.toolName === "get_tracking").map(basis => basis.result_id))));
  if (trackingIds.length > 1) return trackingIds.map(id => {
    const grouped = facts.filter(fact => fact.evidence.some(basis => basis.result_id === id)).map(fact => ({ ...fact, evidence: fact.evidence.filter(basis => basis.result_id === id) }));
    const result = context.getResult(id)?.result.data as JsonObject;
    const number = (result?.tracking_identifier as JsonObject)?.tracking_number;
    return `${number ? `Shipment ${number}:\n` : ""}${renderShipmentFacts(grouped, context)}`;
  }).join("\n\n");
  const locale = localeFor(context);
  const carrier = scalarFactValue(facts, context, (path) => pathHasAnySuffix(path, ["carrier"]));
  const tracking = scalarFactValue(facts, context, (path) => pathHasAnySuffix(path, ["trackingNumber", "tracking_number"]));
  const status = scalarFactValue(facts, context, (path) => pathHasAnySuffix(path, ["live_tracking.status"]));
  const event = scalarFactValue(facts, context, (path) => pathHasAnySuffix(path, ["live_tracking.latestEvent.description"])
    || Boolean(normalizedDataPath(path).match(/live_tracking\.checkpoints\[\d+\]\.description$/)));
  const latestScan = latestShipmentScan(facts, context);
  const timestamp = latestScan.timestamp;
  const location = latestScan.location;
  const eta = scalarFactValue(facts, context, (path) => pathHasAnySuffix(path, ["live_tracking.estimatedDelivery"]));
  const trackingUrl = verifiedTrackingUrl(facts, context);
  const paragraphs: string[] = [];
  const statusClause = status ? shipmentStatusClause(status, locale) : null;
  if (statusClause === "delivered") {
    paragraphs.push(locale === "da"
      ? carrier ? `${carrier} viser, at pakken er leveret.` : "Pakken er leveret."
      : carrier ? `${carrier} shows that your package has been delivered.` : "Your package has been delivered.");
  } else if (statusClause === "out_for_delivery") {
    paragraphs.push(locale === "da"
      ? `Godt nyt — pakken er på vej til levering i dag${carrier ? ` med ${carrier}` : ""}.`
      : `Great news — your package is out for delivery today${carrier ? ` with ${carrier}` : ""}.`);
  } else if (statusClause === "in_transit") {
    paragraphs.push(locale === "da"
      ? carrier ? `${carrier} viser, at pakken er på vej.` : "Pakken er på vej."
      : carrier ? `${carrier} shows that your package is on the way.` : "Your package is currently on the way.");
  } else if (statusClause === "pending") {
    paragraphs.push(locale === "da" ? "Pakken afventer afsendelse." : "Your package is awaiting shipment.");
  } else if (carrier) {
    paragraphs.push(locale === "da" ? `Pakken sendes med ${carrier}.` : `Your package is being handled by ${carrier}.`);
  } else if (tracking && !trackingUrl) {
    paragraphs.push(locale === "da" ? `Trackingnummeret er ${tracking}.` : `Your tracking number is ${tracking}.`);
  }

  const normalizedEvent = event?.toLowerCase().replace(/[.!?]+$/g, "");
  const normalizedStatus = status?.toLowerCase().replace(/[_\s-]+/g, " ");
  const duplicateEvent = Boolean(normalizedEvent && normalizedStatus && normalizedEvent === normalizedStatus);
  if (event && !duplicateEvent && !(carrier && tracking && !status)) {
    paragraphs.push(locale === "da" ? `Den seneste opdatering er: ${sentence(event)}` : `The latest update is: ${sentence(event)}`);
  }
  if (timestamp || location) {
    const details = [
      timestamp ? (locale === "da" ? `den ${formatTimestamp(timestamp, locale)}` : `on ${formatTimestamp(timestamp, locale)}`) : null,
      location ? (locale === "da" ? `i ${location}` : `in ${location}`) : null,
    ].filter((value): value is string => Boolean(value));
    paragraphs.push(locale === "da"
      ? `Den seneste scanning var ${details.join(" ")}.`
      : `The latest scan was ${details.join(" ")}.`);
  }
  if (eta) paragraphs.push(locale === "da" ? `Pakken forventes leveret ${formatEta(eta, locale)}.` : `It’s expected to arrive by ${formatEta(eta, locale)}.`);
  if (trackingUrl) paragraphs.push(locale === "da" ? `Du kan følge pakken her: ${trackingUrl}` : `Track your package here: ${trackingUrl}`);
  if (statusClause === "delivered") {
    paragraphs.push(locale === "da"
      ? "Hvis pakken ikke er kommet, selvom tracking viser, at den er leveret, så sig endelig til, så hjælper jeg med næste skridt."
      : "If you haven’t received it even though tracking shows delivered, let me know and I’ll help with the next step.");
  }
  return paragraphs.join(" ");
}

function renderShipmentItemFacts(facts: Extract<ResponseSegment, { type: "fact" }>[], context: ResponseValidationContext) {
  const locale = localeFor(context);
  return facts
    .filter((fact) => fact.fact_kind === "shipment_item")
    .map((fact) => {
      const candidate = factEvidenceValues(fact, context).find((item) => itemPath(item.path)?.scope === "fulfillment");
      if (!candidate) return "";
      const binding = itemPath(candidate.path);
      if (!binding || binding.index == null || binding.fulfillmentIndex == null) return "";
      const base = itemPathBase(candidate.path, binding.index);
      const record = base ? objectValue(dataFieldValue(candidate.evidence.result, base).value) : null;
      const title = meaningful(record?.title)
        ? String(record.title)
        : String(siblingItemValue(candidate.evidence, candidate.path, binding.index, "title").value ?? "").trim();
      const quantity = meaningful(record?.quantity)
        ? String(record.quantity)
        : String(siblingItemValue(candidate.evidence, candidate.path, binding.index, "quantity").value ?? "").trim();
      if (!title || !quantity) return "";
      const fulfillmentId = dataFieldValue(candidate.evidence.result, `fulfillments[${binding.fulfillmentIndex}].id`).value;
      const tracking = fact.evidence
        .map((basis) => resultFor(basis, context))
        .find((evidence) => evidence?.toolName === "get_tracking");
      const trackingFulfillmentId = tracking ? dataFieldValue(tracking.result, "tracking_identifier.fulfillment_id").value : null;
      const trackingStatus = tracking && String(trackingFulfillmentId) === String(fulfillmentId)
        ? String(dataFieldValue(tracking.result, "live_tracking.status").value ?? "").toLowerCase()
        : "";
      const itemText = `${quantity} × ${title}`;
      if (trackingStatus === "delivered") {
        return locale === "da" ? `Den leverede forsendelse indeholdt ${itemText}.` : `The delivered shipment included ${itemText}.`;
      }
      return locale === "da" ? `Forsendelsen indeholdt ${itemText}.` : `The shipment included ${itemText}.`;
    })
    .filter(Boolean)
    .join("\n");
}

function renderSingleFact(segment: Extract<ResponseSegment, { type: "fact" }>, context: ResponseValidationContext) {
  const values = factEvidenceValues(segment, context);
  switch (segment.fact_kind) {
    case "order_amount": {
      const data = objectValue(resultFor(segment.evidence[0], context)?.result.data);
      return localeFor(context) === "da" ? `Ordretotalen er ${data?.total} ${data?.currency}.` : `The order total is ${data?.total} ${data?.currency}.`;
    }
    case "line_fulfillment": {
      const line = lineDisposition(segment.evidence[0], context);
      if (!line) return "";
      return localeFor(context) === "da"
        ? `${line.title}: ${line.fulfilled} af ${line.quantity} er opfyldt; ${line.remaining} er endnu ikke afsendt. Opfyldelse bekræfter ikke levering.`
        : `${line.title}: ${line.fulfilled} of ${line.quantity} fulfilled; ${line.remaining} not yet dispatched. Fulfillment does not confirm delivery.`;
    }
    case "product_value": {
      return Array.from(new Set(values.filter((candidate) => safeLiveProductFieldPath(candidate.path)).map((item) => {
      const locale = localeFor(context);
      const phrase = /\.variants\[\d+\]\.title$/i.test(item.path)
        ? locale === "da" ? "Varianten er" : "The variant is"
        : /\.variants\[\d+\]\.sku$/i.test(item.path)
          ? locale === "da" ? "Produktets SKU er" : "The product SKU is"
          : /\.title$/i.test(item.path)
            ? locale === "da" ? "Produktet er" : "The product is"
            : /\.price$/i.test(item.path)
              ? locale === "da" ? "Prisen er" : "The price is"
              : locale === "da" ? "Produktinformationen er" : "The product information is";
      return `${phrase} ${String(item.value)}.`;
      }))).join("\n\n");
    }
    case "product_availability": {
      const item = values.find((candidate) => safeLiveProductAvailabilityFieldPath(candidate.path));
      if (!item) return "";
      const match = normalizedDataPath(item.path).match(/^(products\[\d+\])\.variants\[(\d+)\]\.availability_state$/i);
      const evidence = segment.evidence
        .map((basis) => resultFor(basis, context))
        .find((candidate) => candidate && dataFieldValue(candidate.result, item.path).exists);
      const productTitle = match && evidence ? dataFieldValue(evidence.result, `${match[1]}.title`).value : null;
      const variantTitle = match && evidence ? dataFieldValue(evidence.result, `${match[1]}.variants[${match[2]}].title`).value : null;
      const subject = meaningful(productTitle)
        ? `${String(productTitle)}${meaningful(variantTitle) && String(variantTitle) !== "Default Title" ? ` (${String(variantTitle)})` : ""}`
        : localeFor(context) === "da" ? "Produktet" : "The product";
      const state = String(item.value);
      const locale = localeFor(context);
      if (state === "AVAILABLE") return locale === "da" ? `${subject} er på lager lige nu.` : `${subject} is currently available.`;
      if (state === "OUT_OF_STOCK") return locale === "da" ? `${subject} er udsolgt lige nu.` : `${subject} is currently out of stock.`;
      if (state === "AVAILABLE_TO_ORDER") return locale === "da" ? `${subject} kan bestilles, selvom der ikke er registreret lager lige nu.` : `${subject} can be ordered even though no stock is currently recorded.`;
      if (state === "NOT_TRACKED") return locale === "da" ? `Jeg kan ikke bekræfte lagerstatus for ${subject}, fordi lageret ikke spores.` : `I couldn’t verify current availability for ${subject} because its inventory is not tracked.`;
      return locale === "da" ? `Jeg kunne ikke bekræfte den aktuelle lagerstatus for ${subject}.` : `I couldn’t verify the current availability for ${subject}.`;
    }
    default:
      return "";
  }
}

const ORDER_FACT_KINDS = new Set<FactKind>([
  "order_reference", "order_item", "order_financial_status", "order_fulfillment_status",
]);
const SHIPMENT_FACT_KINDS = new Set<FactKind>([
  "shipment_item", "shipment_carrier", "shipment_tracking_number", "shipment_status", "shipment_event",
  "shipment_timestamp", "shipment_location", "shipment_eta",
]);
const PRODUCT_AVAILABILITY_FACT_KINDS = new Set<FactKind>(["product_availability"]);

function renderShipmentBundle(facts: Extract<ResponseSegment, { type: "fact" }>[], context: ResponseValidationContext) {
  const itemFacts = renderShipmentItemFacts(facts, context);
  const standardFacts = renderShipmentFacts(facts.filter((fact) => fact.fact_kind !== "shipment_item"), context);
  return [itemFacts, standardFacts].filter(Boolean).join("\n\n");
}

function renderTextSegment(value: string | null) {
  return value?.trim().replace(/\n{3,}/g, "\n\n") ?? "";
}

/**
 * Keeps model-written knowledge readable without changing its words or facts.
 * Explicit line-oriented formatting (addresses and lists) is preserved; a
 * dense prose block is split into small sentence groups for customer display.
 */
function formatReadableKnowledgeText(value: string) {
  const paragraphs = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs.flatMap((paragraph) => {
    if (paragraph.includes("\n")) return [paragraph];
    const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length <= 2) return [paragraph];
    const groups: string[] = [];
    for (let index = 0; index < sentences.length; index += 2) {
      groups.push(sentences.slice(index, index + 2).join(" "));
    }
    return groups;
  }).join("\n\n");
}

function isActiveSupportChannel(channel?: GreenfieldInteractionChannel) {
  return channel === "support_email"
    || channel === "support_inbox"
    || channel === "playground"
    || channel === "web_chat";
}

function isMerchantSideProcessInstruction(value: string) {
  return /\b(?:we|our\s+(?:team|support)|the\s+(?:merchant|store|seller))\s+(?:will|may|might|can|could|shall)\s+(?:contact|ask|process|review|deduct|notify|email|send)\b/i.test(value);
}

function hasKnownOrderReference(context: ResponseValidationContext) {
  return Boolean(context.activeOrder?.requestedOrderId);
}

function hasVerifiedOrderReference(context: Pick<ResponseValidationContext, "activeOrder">) {
  return context.activeOrder?.state === "verified"
    && Boolean(context.activeOrder.requestedOrderId);
}

function verifiedOrderItemTitle(context: Pick<ResponseValidationContext, "activeOrder">) {
  if (context.activeOrder?.state !== "verified") return null;
  const titles = Array.from(new Set((context.activeOrder.order?.items ?? [])
    .map((item) => String(item.title ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)));
  return titles.length === 1 ? titles[0] : null;
}

function customerFacingReturnSubject(context: Pick<ResponseValidationContext, "activeOrder">) {
  const title = verifiedOrderItemTitle(context);
  return title ? `the ${title}` : "the item";
}

function cleanContextualizedKnowledgeSentence(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/,\s*(?:and|or)\s*(?=[.!?]|$)/gi, "")
    .replace(/\b(?:with|including)\s*(?:,|and|or)?\s*(?=[.!?]|$)/gi, "")
    .replace(/\b(?:please\s+)?(?:provide|share|send|include)\s*(?:and|or)?\s*(?=[.!?]|$)/gi, "")
    .replace(/([,;])\s*(?=[.!?]|$)/g, "")
    .replace(/([.!?])\s*([.!?])/g, "$1")
    .trim();
}

function requirementListFromSentence(value: string) {
  const text = String(value ?? "");
  const contentRequirement = "(?:reason|name|order|email|photo|picture|image|video|screenshot|serial|document|receipt|proof|evidence|measurement|details?|description|sku|barcode|form)";
  const match = [
    text.match(/\bincluding\s+(.+?)(?:[.!?]|$)/i),
    text.match(new RegExp(`\\b(?:provide|share|send|include)\\s+((?:(?:the|your|an?|any)\\s+)?${contentRequirement}\\b.+?)(?:[.!?]|$)`, "i")),
    text.match(new RegExp(`\\bwith\\s+((?:(?:the|your|an?|any)\\s+)?${contentRequirement}\\b.+?)(?:[.!?]|$)`, "i")),
  ].find((candidate) => candidate?.[1]);
  if (!match?.[1]) return null;
  const items = match[1]
    .split(/,\s*|\s+(?:and|or)\s+/i)
    .map((item) => item.trim().replace(/^(?:the|your|an?|any)\s+/i, "").trim())
    .filter(Boolean);
  return items.length ? items : null;
}

type ProcessRequirementKind = "contact_support" | "customer_name" | "order_reference" | "return_reason" | "customer_content";

type ProcessRequirement = {
  kind: ProcessRequirementKind;
  value: string;
  satisfied: boolean;
};

function isReturnReasonRequirement(value: string) {
  return /\breason\b/i.test(value);
}

function customerMessageProvidesReturnReason(
  context: Pick<ResponseValidationContext, "customerMessage" | "customerProvidedContext">,
) {
  const text = [context.customerMessage, context.customerProvidedContext?.returnDetails]
    .filter(Boolean)
    .join(" ");
  if (!text.trim()) return false;
  return /\b(?:because|since|as|due\s+to|because\s+of|reason\s*(?:is|:))\s+[^.!?]{2,}/i.test(text)
    || /\b(?:damaged|defective|dissatisf(?:ied|ying)|unhappy|not\s+happy|doesn['’]?t\s+fit|does\s+not\s+fit|wrong|unwanted|changed\s+my\s+mind)\b/i.test(text);
}

function processRequirementKind(value: string): ProcessRequirementKind | null {
  if (isSupportContactInstruction(value)) return "contact_support";
  if (/\border\s+(?:number|no\.?|id|identifier)\b/i.test(value)) return "order_reference";
  if (/\bname\s+(?:used\s+(?:at|when)\s+(?:purchase|checkout|ordering)|on\s+the\s+order)\b/i.test(value)) return "customer_name";
  if (isReturnReasonRequirement(value)) return "return_reason";
  if (isCustomerContentRequirement(value) || /\b(?:photo|picture|image|video|screenshot|serial|document|receipt|proof|measurement|details?|description|sku|barcode|form)\b/i.test(value)) return "customer_content";
  return null;
}

function processRequirementSatisfied(
  kind: ProcessRequirementKind,
  value: string,
  context: AnswerCompletenessContext,
) {
  if (kind === "contact_support") {
    return isActiveSupportChannel(context.interactionChannel)
      && customerMessagePerformsSupportRequest(context.customerMessage ?? "")
      && isSupportContactInstruction(value)
      && (!isNegatedSupportContactInstruction(value) || isConditionalSupportContactInstruction(value));
  }
  if (kind === "order_reference") return hasVerifiedOrderReference(context);
  if (kind === "customer_name") return Boolean(context.trustedCustomerIdentity?.verified && context.trustedCustomerIdentity.hasName);
  if (kind === "return_reason") return customerMessageProvidesReturnReason(context);
  return false;
}

function processRequirementsForInstruction(
  value: string,
  context: AnswerCompletenessContext,
): ProcessRequirement[] | null {
  if (!isSupportContactInstruction(value)) return null;
  const items = requirementListFromSentence(value);
  if (!items) {
    if (hasSupportContactContentRequirement(value)) return null;
    return [{
      kind: "contact_support",
      value,
      satisfied: processRequirementSatisfied("contact_support", value, context),
    }];
  }
  return [
    {
      kind: "contact_support",
      value,
      satisfied: processRequirementSatisfied("contact_support", value, context),
    },
    ...items.map((item) => {
      const kind = processRequirementKind(item) ?? "customer_content";
      return { kind, value: item, satisfied: processRequirementSatisfied(kind, item, context) };
    }),
  ];
}

function processRequirementCandidateValue(requirement: ProcessRequirement) {
  if (requirement.kind === "customer_name"
    || requirement.kind === "order_reference"
    || requirement.kind === "return_reason"
    || requirement.kind === "customer_content") {
    return `Please provide ${requirement.value}`;
  }
  return requirement.value;
}

function processInstructionCandidates(value: string, context: AnswerCompletenessContext) {
  if (isMerchantSideProcessInstruction(value)) return [];
  if (!isActiveSupportChannel(context.interactionChannel)
    || !customerMessagePerformsSupportRequest(context.customerMessage ?? "")) return [value];
  const requirements = processRequirementsForInstruction(value, context);
  if (!requirements) return [value];
  return requirements
    .filter((requirement) => !requirement.satisfied)
    .map(processRequirementCandidateValue);
}

function requirementAlreadyKnown(value: string, context: ResponseValidationContext) {
  if (/\border\s+(?:number|no\.?|id|identifier)\b/i.test(value)) return hasKnownOrderReference(context);
  if (/\bname\s+(?:used\s+(?:at|when)\s+(?:purchase|checkout|ordering)|on\s+the\s+order)\b/i.test(value)) {
    return Boolean(context.trustedCustomerIdentity?.verified && context.trustedCustomerIdentity.hasName);
  }
  if (/\bemail(?:\s+address)?\s+(?:used\s+(?:at|when)\s+(?:purchase|checkout|ordering)|on\s+the\s+order)\b/i.test(value)) {
    return Boolean(context.trustedCustomerIdentity?.verified);
  }
  if (isReturnReasonRequirement(value)) return customerMessageProvidesReturnReason(context);
  return false;
}

function requirementPromptLabel(value: string, context: ResponseValidationContext) {
  return isReturnReasonRequirement(value)
    ? (localeFor(context) === "da"
      ? `årsagen til at returnere ${customerFacingReturnSubject(context)}`
      : `the reason for returning ${customerFacingReturnSubject(context)}`)
    : value;
}

function naturalMissingRequirementQuestion(items: string[], context: ResponseValidationContext) {
  const locale = localeFor(context);
  if (items.length === 1 && isReturnReasonRequirement(items[0])) {
    const verifiedOrder = context.activeOrder?.state === "verified"
      && Boolean(context.activeOrder.requestedOrderId);
    return locale === "da"
      ? verifiedOrder
        ? `Hvad er årsagen til, at du returnerer ${customerFacingReturnSubject(context)}?`
        : "Hvad er årsagen til returneringen?"
      : verifiedOrder
        ? `What’s the reason for returning ${customerFacingReturnSubject(context)}?`
        : "What’s the reason for return?";
  }
  const promptedItems = items.map((item) => requirementPromptLabel(item, context));
  if (items.length === 1) {
    return locale === "da" ? `Hvad er ${promptedItems[0]}?` : `What’s the ${promptedItems[0]}?`;
  }
  const information = joinList(promptedItems, locale);
  return locale === "da" ? `Kan du sende ${information}?` : `Could you share ${information}?`;
}

/**
 * Filters a complete source-authored requirement list as one semantic unit.
 * This prevents context adaptation from leaving punctuation or conjunction
 * fragments behind when known order/identity fields are removed.
 */
function adaptKnownRequirementList(value: string, context: ResponseValidationContext, allowWithClause: boolean) {
  if (!allowWithClause && !/\b(?:provide|share|send|include)\b/i.test(value)) return undefined;
  const items = requirementListFromSentence(value);
  if (!items) return undefined;
  const missing = items.filter((item) => !requirementAlreadyKnown(item, context));
  return missing.length ? naturalMissingRequirementQuestion(missing, context) : "";
}

function adaptSupportContactInstruction(value: string) {
  const contactPattern = /\b(?:please\s+)?(?:contact|email|write\s+to|reach\s+out\s+to|send\s+(?:an\s+)?email\s+to)\s+(?:us|our\s+support(?:\s+team)?|the\s+support(?:\s+team)?|support(?:\s+team)?|\[[^\]]+\]|[^\s,.;!?]+@[^\s,.;!?]+)(?:\s+(?:via|by|through|using)\s+(?:e-?mail|the\s+contact\s+form))?(?:\s+(?:on|at)\s+(?:\[[^\]]+\]|[^\s,.;!?]+@[^\s,.;!?]+))?/gi;
  const formPattern = /\b(?:via|through|using)\s+(?:our|the)\s+contact\s+form\b/gi;
  const hasContactInstruction = contactPattern.test(value) || formPattern.test(value);
  contactPattern.lastIndex = 0;
  formPattern.lastIndex = 0;
  if (!hasContactInstruction) return value;

  let adapted = value.replace(contactPattern, "").replace(formPattern, "");
  adapted = adapted.replace(/,\s*(?:with|including)\s+/i, ", please provide ");
  adapted = cleanContextualizedKnowledgeSentence(adapted);
  if (/^(?:to\s+)?(?:start|initiate|request)\s+(?:the\s+)?(?:return|refund|claim)\.?$/i.test(adapted)) return "";
  return adapted;
}

type CustomerQuestionShape = "process" | "destination" | "eligibility" | "timing" | "cost" | "status" | "troubleshooting" | "action" | "unknown";

type CustomerKnowledgeFocus = {
  hasReturnIntent: boolean;
  asksProcess: boolean;
  asksReturnDestination: boolean;
  asksRefundTiming: boolean;
  asksShippingResponsibility: boolean;
  mentionsCondition: boolean;
  asksCondition: boolean;
  asksEligibility: boolean;
  questionShape: CustomerQuestionShape;
};

function customerKnowledgeFocus(customerMessage?: string): CustomerKnowledgeFocus {
  const message = String(customerMessage ?? "").replace(/[\u2019]/g, "'").trim();
  const hasReturnIntent = /\b(?:return\w*|retur\w*|rücksend\w*|retoure\w*|zurück(?:geben|schick\w*|send\w*)|send\s+(?:it|the\s+item|the\s+order)\s+back|sende?\s+(?:den|varen|ordren)\s+tilbage)\b/i.test(message);
  const asksHow = /\bhow\b|\b(?:steps?|process|procedure|initiate|start)\b|\bhvordan\b|\b(?:trin|proces|procedure|starte|påbegynde|gøre)\b|\bwie\b|\b(?:schritte|prozess|vorgehen)\b/i.test(message);
  const asksReturnDestination = hasReturnIntent
    && (/\b(?:where|hvor|wo)\b/i.test(message) || /\b(?:send|ship|sende|schick(?:en)?|sende)\b[\s\S]{0,40}\b(?:return|retur|rücksend|retoure)\b/i.test(message));
  const hasRefundIntent = /\b(?:refund\w*|refundering\w*|tilbagebetaling\w*|pengene\s+tilbage|erstatt\w*|rückerstatt\w*)\b/i.test(message);
  const hasTimingQuestion = /\b(?:when|how\s+long|tim(?:e|ing)|within|after|hvornår|hvor\s+lang\s+tid|hvor\s+hurtigt|tid|wann|wie\s+lange|zeit)\b/i.test(message);
  const asksRefundTiming = hasRefundIntent && hasTimingQuestion;
  // Keep inflected forms in the same intent family (for example Danish
  // "returfragten"), while still requiring an explicit shipping term before
  // treating a payer question as return-shipping related.
  const mentionsShipping = /\b(?:shipping\w*|returfragt\w*|fragt\w*|levering\w*|versand\w*|rückversand\w*)\b/i.test(message);
  const asksShippingResponsibility = mentionsShipping && /\b(?:who\s+(?:pays|covers)|pay|cost|responsib)\w*\b|\b(?:hvem\s+betaler|betaler\s+jeg|ansvar|omkostning|udgift)\w*\b|\b(?:wer\s+zahlt|kosten|verantwort)\w*\b/i.test(message);
  const mentionsCondition = /\b(?:open(?:ed)?|used|seal(?:ed|ed)?|unused|intact|defect(?:ive)?|damaged|åbnet|brudt|forsegling|forseglet|ubrugt|intakt|brugt|beskadiget|geöffnet|benutzt|versiegelt|unbenutzt|beschädigt)\b/i.test(message);
  const asksCondition = hasReturnIntent && mentionsCondition;
  const asksEligibility = hasReturnIntent && /\b(?:can\s+i|may\s+i|am\s+i\s+eligible|is\s+it\s+allowed|still\s+(?:return|send)|kan\s+jeg|må\s+jeg|er\s+det\s+muligt|berettiget|tilladt|darf\s+ich|kann\s+ich|ist\s+das\s+zulässig|berechtigt)\b/i.test(message);
  const asksAction = /\b(?:cancel|annullere|annullér|change\s+(?:the\s+)?address|ændre\s+(?:leverings)?adressen|refund|refunder|remplacement|erstatning)\b/i.test(message);
  const asksStatus = /\b(?:where\s+is|status|hvor\s+er|hvad\s+er\s+status|wo\s+ist)\b/i.test(message);
  const asksTroubleshooting = /\b(?:not\s+working|won't|will\s+not|broken|pair|connect|problem|virker\s+ikke|forbinder|parre|fejl|funktioniert\s+nicht|verbinden|koppeln|problem)\b/i.test(message);
  const questionShape: CustomerQuestionShape = asksCondition || asksEligibility
    ? "eligibility"
    : asksRefundTiming
      ? "timing"
      : asksShippingResponsibility
        ? "cost"
        : asksReturnDestination
          ? "destination"
          : asksHow || (hasReturnIntent && /\b(?:want|would\s+like|need|vil|ønsker|skal|ich\s+m(?:ö|oe)chte|ich\s+will)\b/i.test(message))
            ? "process"
            : asksAction
              ? "action"
              : asksStatus
                ? "status"
                : asksTroubleshooting
                  ? "troubleshooting"
                  : "unknown";
  return {
    hasReturnIntent,
    asksProcess: questionShape === "process",
    asksReturnDestination,
    asksRefundTiming,
    asksShippingResponsibility,
    mentionsCondition,
    asksCondition,
    asksEligibility,
    questionShape,
  };
}

function isReturnConditionConsequence(value: string) {
  return /\b(?:opened|open|used|seal(?:ed|ed)?|deduct(?:ion|ed)?|fee|charge|reduced|not\s+fully\s+refunded|åbnet|brudt|forsegling\w*|forseglet|ubrugt|intakt|brugt|fradrag|gebyr|reduceret|trækk\w*|ikke\s+fuldt\s+refunderet|geöffnet|benutzt|versiegelt|unbenutzt|beschädigt)\b/i.test(value)
    && /\b(?:return\w*|refund\w*|product\w*|item\w*|packag\w*|condition\w*|retur\w*|refundering\w*|vare\w*|emballage\w*|forsegling\w*|deduct\w*|fradrag|gebyr|trækk\w*|fee|charge)\b/i.test(value);
}

function isReturnShippingResponsibility(value: string) {
  return /\b(?:return\s+)?(?:shipping|shipment)\b|\breturn\s+(?:postage|label)\b|\breturfragt\w*\b|\breturporto\w*\b|\bfragt\w*\b|\bpostage\b|\bversand\w*\b|\brücksendekosten\w*\b/i.test(value)
    && /\b(?:responsib|covered|cover|cost|pay|paid|pays|expense|borne|prepaid|free|ansvar|omkostning|udgift|betal|betalt|zahlt|kosten|verantwort|übernommen)\w*\b/i.test(value);
}

function isPayerProposition(value: string) {
  if (!isReturnShippingResponsibility(value)) return false;
  const actor = "(?:customer|merchant|store|seller|buyer|you|we|us|kunden|forhandler|butik|sælger|køber|du|vi|os)";
  const responsibilityVerb = "(?:pay|paid|pays|cover\\w*|responsib\\w*|borne|prepaid|free|betaler|betalt|ansvar\\w*|zahlt|verantwort\\w*|übernommen)";
  const passiveResponsibility = new RegExp(`\\b${responsibilityVerb}\\b[\\s\\S]{0,48}\\b(?:by|af|von)\\s+(?:the\\s+)?${actor}\\b`, "i");
  const activeResponsibility = new RegExp(`\\b${actor}\\b[\\s\\S]{0,48}\\b${responsibilityVerb}\\b`, "i");
  const expenseResponsibility = new RegExp(`\\b(?:at|on|til|på|zu)\\s+(?:your|customer['’]s|merchant['’]s|our|din|kundens|forhandlerens|vores|ihre|deine|unsere)(?:\\s+own)?\\s+(?:expense|cost|omkostning\\w*|udgift\\w*|bekostning|kosten)\\b`, "i");
  const returnShippingConcept = /\breturn\s+(?:shipping|shipment|postage|label)\b|\bretur(?:fragt|porto)\w*\b|\brücksend(?:ung|e|ekosten|etikett)\w*\b/i;
  const prepaidReturnLabel = /\b(?:we|merchant|store|seller|vi|forhandler|butik|wir)\b[\s\S]{0,64}\b(?:provide|offer|send|give|tilbyd\w*|leverer|geben|bieten)\b[\s\S]{0,64}\bprepaid\b[\s\S]{0,32}\b(?:return\s+label|returlabel|return\s+shipping|returfragt|rücksendeetikett)\b/i;
  return activeResponsibility.test(value)
    || passiveResponsibility.test(value)
    || expenseResponsibility.test(value)
    || prepaidReturnLabel.test(value)
    || (returnShippingConcept.test(value) && /\b(?:free|prepaid)\b/i.test(value));
}

function timingCandidateEvaluation(value: string) {
  const text = String(value ?? "");
  const mentionsRefund = /\brefund\w*\b|\brefunder\w*\b|\btilbagebetaling\w*\b|\bpengene\s+tilbage\b|\berstatt\w*\b|\brückerstatt\w*\b/i.test(text);
  const mentionsProviderTiming = /\b(?:bank|payment\s+provider|betalingsudbyder)\b[\s\S]{0,80}\b(?:display|post|funds?|vise|beløb|time|tid|dage|tage)\b/i.test(text);
  const hasDuration = /\b(?:within|inden\s+for|indenfor)\s+\d{1,3}\s+(?:business\s+)?(?:days?|dage|tage|wochen|monate)\b/i.test(text);
  const hasEventTrigger = /\b(?:after|once|when|upon|as\s+soon\s+as|efter|når|så\s+snart|nach|sobald|wenn)\b[\s\S]{0,180}\b(?:receive\w*|receipt|return\w*|process\w*|inspect\w*|approve\w*|modtag\w*|behandl\w*|igangsæt\w*|modtaget|bearbeitet|erhalten|prüf\w*)\b/i.test(text)
    || /\b(?:receive\w*|receipt|return\w*|process\w*|inspect\w*|approve\w*|modtag\w*|behandl\w*|modtaget|bearbeitet|erhalten|prüf\w*)\b[\s\S]{0,180}\b(?:after|once|when|upon|as\s+soon\s+as|efter|når|så\s+snart|nach|sobald|wenn)\b/i.test(text);
  const hasRefundAction = /\b(?:initiat\w*|process\w*|issu\w*|releas\w*|pay\w*|display\w*|udbetal\w*|igangsæt\w*|behandl\w*|ausgezahlt|erstatt\w*)\b/i.test(text);
  const hasExplicitDate = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/i.test(text)
    || /\b(?:on|den|am|d\.)\s+\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\s+\d{2,4}\b/i.test(text);
  const timingPatternDetected = hasDuration || hasEventTrigger || mentionsProviderTiming || hasExplicitDate;
  const subjectOutcomeDetected = mentionsProviderTiming
    || hasExplicitDate
    || hasDuration
    || (hasEventTrigger && hasRefundAction);
  const certifiedCandidate = (mentionsRefund || mentionsProviderTiming)
    && (hasDuration || (hasEventTrigger && hasRefundAction) || mentionsProviderTiming || hasExplicitDate)
    && (hasExplicitDate || /\b(?:after|once|when|upon|as\s+soon\s+as|within|efter|når|så\s+snart|nach|sobald|wann|wie\s+lange|inden\s+for|indenfor|dage|days?|tage|wochen|monate|bank|payment\s+provider|betalingsudbyder)\b/i.test(text));
  const rejectionReason: string[] = [];
  if (!mentionsRefund && !mentionsProviderTiming) rejectionReason.push("missing_refund_or_payment_subject");
  if (!timingPatternDetected) rejectionReason.push("missing_timing_pattern");
  if (!subjectOutcomeDetected) rejectionReason.push("missing_timing_outcome");
  if (!certifiedCandidate && !rejectionReason.length) rejectionReason.push("timing_requirements_not_met");
  return {
    mentionsRefund,
    mentionsProviderTiming,
    hasDuration,
    hasEventTrigger,
    hasExplicitDate,
    hasRefundAction,
    timingPatternDetected,
    subjectOutcomeDetected,
    certifiedCandidate,
    rejectionReason,
  };
}

function isRefundTiming(value: string) {
  return timingCandidateEvaluation(value).certifiedCandidate;
}

function timingCandidateDiagnostics(evidenceTexts: string[]): TimingCandidateDiagnostic[] {
  return evidenceTexts
    .flatMap((evidenceText) => answerEvidenceUnits(evidenceText))
    .map((candidate) => {
      const evaluation = timingCandidateEvaluation(candidate);
      return {
        text: candidate.slice(0, 240),
        timing_pattern_detected: evaluation.timingPatternDetected,
        event_trigger_detected: evaluation.hasEventTrigger,
        duration_detected: evaluation.hasDuration,
        explicit_date_detected: evaluation.hasExplicitDate,
        subject_outcome_detected: evaluation.subjectOutcomeDetected,
        rejected: !evaluation.certifiedCandidate,
        rejection_reason: evaluation.rejectionReason,
        certified_candidate: evaluation.certifiedCandidate,
        conflict_group: null,
      };
    });
}

/** @internal DEV/test-only candidate diagnostics; not exposed by any route. */
export function inspectTimingCandidateDiagnostics(evidenceTexts: string[]): TimingCandidateDiagnostic[] {
  return timingCandidateDiagnostics(evidenceTexts);
}

function isReturnEligibility(value: string) {
  return /\b(?:return\w*|retur\w*|rücksend\w*|retoure\w*|zurück(?:geben|schick\w*|send\w*))\b/i.test(value)
    && /\b(?:within|under|accepted|eligible|allowed|days?|dage|accepter\w*|berettig\w*|tilladt|inden|innerhalb|tage)\b/i.test(value)
    && !isReturnConditionConsequence(value);
}

function isAnswerBearingEligibility(value: string) {
  return /\b(?:return\w*|retur\w*|rücksend\w*|retoure\w*|zurück(?:geben|schick\w*|send\w*))\b/i.test(value)
    && /\b(?:yes|no|can|cannot|can't|may|still|ja|nej|kan|må|darf|kann|berechtigt|tilladt)\b/i.test(value);
}

function isReturnProhibition(value: string) {
  return /\b(?:return\w*|retur\w*|rücksend\w*|retoure\w*|zurück(?:geben|schick\w*|send\w*))\b/i.test(value)
    && /\b(?:not\s+(?:allowed|eligible|permitted|accepted)|cannot|can't|prohibited|forbidden|ikke\s+(?:tilladt|berettiget|accepteret|muligt)|kan\s+ikke|må\s+ikke|nicht\s+(?:zulässig|berechtigt|angenommen|möglich)|kann\s+nicht|darf\s+nicht|abgelehnt|verboten)\b/i.test(value);
}

function isReturnApprovalPrerequisite(value: string) {
  return /\b(?:approval|approved|accepted\s+before|confirmation|godkend\w*|bekræft\w*|godkendt|bestätigung|genehmig\w*)\b/i.test(value)
    && /\b(?:return\w*|retur\w*|send|ship|sende|schick|rücksend\w*|retoure)\b/i.test(value);
}

function isReturnDestinationInstruction(value: string) {
  return /\b(?:address|portal|label|return\s+to|send\s+(?:it|the\s+(?:return|item|product|order))?\s+to|ship\s+(?:it|the\s+(?:return|item|product|order))?\s+to|adresse|retur(?:adresse|label)|send\w*\s+(?:den|die|das|die\s+retoure|die\s+ware)?\s*(?:an|zu|til)|rücksendeadresse|zurückschick\w*\s+an|retoure\s+an)\b/i.test(value);
}

function isConcreteReturnDestinationInstruction(value: string) {
  return /\b(?:return\w*|retur\w*|rücksend\w*|retoure\w*)\b/i.test(value)
    && isReturnDestinationInstruction(value);
}

function isReturnProcessInstruction(value: string) {
  if (isRefundTiming(value)) return false;
  return /\b(?:start|initiate|request\s+(?:a\s+)?(?:return|refund|claim)|send|ship|portal|label|address|contact|email|next\s+steps?|follow\s+(?:the\s+)?instructions?|procedure|instructions?|anmod\w*|sende|returlabel|adresse|kontakt|kontaktformular\w*|formular|udfyld|næste\s+trin|beantrag\w*|schritt\w*|vorgehen)\b/i.test(value);
}

function isReturnShippingMethodInstruction(value: string) {
  if (isReturnShippingResponsibility(value)) return false;
  return /\b(?:tracked|trackable|insured|registered|prepaid)\b/i.test(value)
    && /\b(?:return|shipping|shipment|postage|label|send|ship|retur|returfragt|returporto|rücksend|versand)\w*\b/i.test(value);
}

function isCustomerContentRequirement(value: string) {
  return /\b(?:provide|share|send|include|attach|upload|submit|enter|tell|give)\b/i.test(value)
    && /\b(?:photo|picture|image|video|screenshot|screen\s*shot|serial(?:\s+(?:number|no\.?)|number)?|document|receipt|proof|evidence|measurement\w*|reason|details?|description|sku|barcode|form)\b/i.test(value);
}

function isProcessAnswerBearingInstruction(value: string) {
  if (isCustomerContentRequirement(value) || isSupportContactInstruction(value)) return true;
  return isReturnProcessInstruction(value)
    && /\b(?:return\w*|retur\w*|rücksend\w*|retoure\w*)\b/i.test(value);
}

function isSupportContactInstruction(value: string) {
  const supportTarget = "(?:us|our\\s+support(?:\\s+team)?|support(?:\\s+team)?|customer\\s+service|the\\s+merchant|the\\s+store|the\\s+seller)";
  return new RegExp(`\\b(?:contact|email|e-?mail|write\\s+to|reach\\s+out\\s+to)\\s+${supportTarget}\\b`, "i").test(value)
    || new RegExp(`\\bsend\\s+${supportTarget}\\s+(?:an?\\s+)?e-?mail\\b`, "i").test(value)
    || /\b(?:use|via|through|using)\s+(?:our|the)?\s*(?:support|contact)\s+form\b/i.test(value)
    || /\b(?:let|letting)\s+(?:us|the\s+merchant|support)\s+know\b/i.test(value)
    || (/\b(?:submit|request)\s+(?:a|the)?\s*(?:return|refund|claim)\s*(?:request)?\b/i.test(value)
      && !/\b(?:portal|online|website|app)\b/i.test(value));
}

function isNegatedSupportContactInstruction(value: string) {
  return /\b(?:do\s+not|don't|must\s+not|never|without)\b[\s\S]{0,60}\b(?:contact|email|e-?mail|write\s+to|reach\s+out\s+to|support|customer\s+service|let\s+(?:us|the\s+merchant|support)\s+know)\b/i.test(value);
}

function isExplicitSupportContactProhibition(value: string) {
  return /\b(?:do\s+not|don't|must\s+not|never)\b[\s\S]{0,60}\b(?:contact|email|e-?mail|write\s+to|reach\s+out\s+to|support|customer\s+service|let\s+(?:us|the\s+merchant|support)\s+know)\b/i.test(value);
}

function isConditionalSupportContactInstruction(value: string) {
  return /\bwithout\b[\s\S]{0,60}\b(?:contact|email|e-?mail|write\s+to|reach\s+out\s+to|support|customer\s+service|let\s+(?:us|the\s+merchant|support)\s+know)\b/i.test(value);
}

function hasSupportContactContentRequirement(value: string) {
  const text = value.replace(/\b(?:support|contact)\s+form\b/gi, "");
  return /\b(?:photo|picture|image|video|screenshot|screen\s*shot|serial(?:\s+(?:number|no\.?)|number)?|document|receipt|proof|evidence|measurement\w*|reason|details?|description|sku|barcode|form)\b/i.test(text);
}

function customerMessagePerformsSupportRequest(value: string) {
  return /\b(?:i\s+(?:would|want|need|wish)|please|can\s+you|could\s+you|would\s+you|how\s+(?:do|can)\s+i|request(?:ing)?|submit(?:ted)?|contact(?:ed)?|email(?:ed)?|help)\b/i.test(value);
}

function isSatisfiedSupportContactPrerequisite(
  value: string,
  context: Pick<ResponseValidationContext, "customerMessage" | "interactionChannel">,
) {
  return processRequirementSatisfied("contact_support", value, context)
    && !hasSupportContactContentRequirement(value);
}

function hasContradictoryProcessInstructions(values: string[]) {
  const actionable = values.filter((value) => !isMerchantSideProcessInstruction(value));
  return actionable.some((value) => isSupportContactInstruction(value) && !isNegatedSupportContactInstruction(value))
    && actionable.some(isExplicitSupportContactProhibition);
}

type AnswerBearingCue = "process" | "destination" | "contact" | "tracking" | "timing" | "cost" | "eligibility" | "status";

function answerBearingCueFor(value: string, focus: CustomerKnowledgeFocus): AnswerBearingCue | null {
  const text = value.trim();
  if (!text || !/:\s*$/.test(text)) return null;
  if (focus.questionShape === "destination" && isReturnDestinationInstruction(text)) return "destination";
  if (focus.questionShape === "process" && isReturnProcessInstruction(text)) return "process";
  if (/\b(?:contact|support|email|e-mail|phone|telefon|tel\.?|kontakt)\b[\s\S]*:\s*$/i.test(text)) return "contact";
  if (/\b(?:tracking|track(?:ing)?\s+(?:link|url|number)|shipment|parcel|package)\b[\s\S]*:\s*$/i.test(text)) return "tracking";
  if (focus.questionShape === "timing" || /\b(?:when|how\s+long|refund|refundering|tilbagebetaling|pengene\s+tilbage|wann|wie\s+lange)\b[\s\S]*:\s*$/i.test(text)) return "timing";
  if (focus.questionShape === "cost" || /\b(?:cost|price|fee|amount|pay|payer|omkostning|udgift|betaler|kosten|zahlt)\b[\s\S]*:\s*$/i.test(text)) return "cost";
  if (focus.questionShape === "eligibility" || /\b(?:eligible|allowed|can|may|must|berettiget|tilladt|kan|må|darf|kann)\b[\s\S]*:\s*$/i.test(text)) return "eligibility";
  if (focus.questionShape === "status" || /\b(?:status|state|levering|shipment|order)\b[\s\S]*:\s*$/i.test(text)) return "status";
  return null;
}

function hasAnswerBearingValueMarker(value: string, cue: AnswerBearingCue) {
  const text = value.trim();
  const hasLinkOrContact = /https?:\/\/|mailto:|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\+?\d[\d\s().-]{5,}/i.test(text);
  const hasNumericValue = /(?:€|eur|usd|dkk|gbp|£|\$)\s*\d|\b\d+(?:[.,]\d+)?\s*(?:business\s+)?(?:days?|hours?|weeks?|months?|dage|timer|uger|måneder|tage|stunden|wochen|monate)\b|\b\d{2,}\b/i.test(text);
  const hasCostPayer = /\b(?:pay|payer|paid|pays|responsib\w*|betaler|ansvar\w*|zahlt|verantwort\w*)\b/i.test(text);
  if (cue === "eligibility") return hasLinkOrContact || hasNumericValue || /\b(?:yes|no|can|cannot|can't|may|must|required|eligible|allowed|still|ja|nej|kan|må|skal|berettiget|tilladt|darf|kann|muss|berechtigt)\b/i.test(text);
  if (cue === "process") return isReturnProcessInstruction(text) || hasLinkOrContact;
  if (cue === "status") return hasLinkOrContact || hasNumericValue || /\b(?:delivered|shipped|dispatched|processing|in transit|leveret|afsendt|behandles|undervjs|zugestellt|versendet)\b/i.test(text);
  if (cue === "cost") return hasLinkOrContact || hasNumericValue || hasCostPayer;
  return hasLinkOrContact || hasNumericValue;
}

type AnswerCompletenessCandidate = {
  value: string;
  normalized: string;
};

type AnswerCompletenessContext = Pick<ResponseValidationContext, "customerMessage" | "interactionChannel" | "activeOrder" | "trustedCustomerIdentity" | "customerProvidedContext" | "proposedActions" | "getResults"> & {
  preserveProcessConflicts?: boolean;
};

function normalizeAnswerCompletenessValue(value: string) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:!?]+$/g, "")
    .trim()
    .toLowerCase();
}

function pushAnswerCompletenessCandidate(candidates: AnswerCompletenessCandidate[], value: unknown) {
  const cleaned = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\s]+/g, " ")
    .replace(/[\s.,;!?]+$/g, "")
    .trim();
  const normalized = normalizeAnswerCompletenessValue(cleaned);
  if (!cleaned || !normalized || candidates.some((candidate) => candidate.normalized === normalized)) return;
  candidates.push({ value: cleaned, normalized });
}

function answerCompletenessMessageCue(message: string, focus: CustomerKnowledgeFocus): AnswerBearingCue | null {
  const text = String(message ?? "");
  if (focus.questionShape === "process") return "process";
  if (focus.questionShape === "destination") return "destination";
  if (focus.questionShape === "timing") return "timing";
  if (focus.questionShape === "cost") return "cost";
  if (focus.questionShape === "eligibility") return "eligibility";
  if (focus.questionShape === "status"
    && /\b(?:tracking|track(?:ing)?\s+(?:link|url|number)|shipment|parcel|sporing|forsendelse)\b/i.test(text)) return "tracking";
  if (focus.questionShape === "status") return "status";
  if (/\b(?:contact|support|email|e-mail|phone|telephone|telefon|kontakt)\b/i.test(text)) return "contact";
  return null;
}

function answerCompletenessMessageCues(message: string, focus: CustomerKnowledgeFocus): AnswerBearingCue[] {
  const text = String(message ?? "");
  const cues: AnswerBearingCue[] = [];
  if (focus.asksProcess) cues.push("process");
  if (focus.asksReturnDestination) cues.push("destination");
  if (focus.questionShape === "timing" || focus.asksRefundTiming) cues.push("timing");
  if (focus.questionShape === "cost" || focus.asksShippingResponsibility) cues.push("cost");
  if (focus.questionShape === "eligibility" || focus.asksEligibility) cues.push("eligibility");
  if (focus.questionShape === "status"
    && /\b(?:tracking|track(?:ing)?\s+(?:link|url|number)|shipment|parcel|sporing|forsendelse)\b/i.test(text)) cues.push("tracking");
  if (focus.questionShape === "status") cues.push("status");
  if (/\b(?:contact|support|email|e-mail|phone|telephone|telefon|kontakt)\b/i.test(text)) cues.push("contact");
  return Array.from(new Set(cues));
}

function policyAnswerNeedsCustomerSpecificLookup(cue: AnswerBearingCue, message: string) {
  if (cue !== "timing") return false;
  const text = String(message ?? "");
  if (isExplicitOrderReference(text)) return true;
  return /\b(?:has|was|is|been|already|did|have)\b[\s\S]{0,40}\b(?:my|the)?\s*(?:refund|money\s+back|tilbagebetaling|pengene\s+tilbage|rückerstattung)\b/i.test(text)
    || /\b(?:refund|refundering\w*|tilbagebetaling\w*|pengene\s+tilbage|rückerstattung)\b[\s\S]{0,40}\b(?:processed|issued|received|arrived|behandl\w*|modtag\w*|erhalten|bearbeitet)\b/i.test(text);
}

function physicalAddressMarker(value: string) {
  return /\b(?:street|st\.?|road|avenue|lane|boulevard|vej|gade|strasse|straße|postcode|postal|city)\b|[\p{L}\p{N}]+(?:vej|gade)\b|\b\d{4,6}\s+[\p{L}][\p{L}'’-]*/iu.test(value);
}

function simpleAddressLabel(value: string) {
  const text = value.trim();
  return text.length >= 2
    && text.length <= 80
    && /^[\p{L}\p{N}][\p{L}\p{N} &'.,\-/]*$/u.test(text)
    && !/\b(?:return|retur|refund|shipping|fragt|versand|opened|åbnet|contact|kontakt|portal|policy)\b/i.test(text);
}

function answerEvidenceUnits(value: string) {
  return String(value ?? "")
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function answerProcessEvidenceUnits(value: string) {
  return answerEvidenceUnits(String(value ?? "").replace(/\r?\n/g, " "));
}

function answerEvidenceSections(records: unknown[]) {
  return records.flatMap((item) => {
    const record = objectValue(item);
    if (!record) return [];
    const sections = Array.isArray(record.evidence_sections) ? record.evidence_sections : [];
    const sectionText = sections
      .map((section) => objectValue(section)?.content ?? objectValue(section)?.text)
      .filter((content): content is string => typeof content === "string" && content.trim().length > 0)
      .map((content) => content.trim());
    if (sectionText.length) return sectionText;
    return typeof record.content === "string" && record.content.trim() ? [record.content.trim()] : [];
  });
}

function answerEvidenceRecords(
  basis: KnowledgeBasis,
  context: ResponseValidationContext,
  cue: AnswerBearingCue,
) {
  const evidence = resultFor(basis, context);
  if (!evidence || evidence.result.status !== "ok") return [];
  const data = objectValue(evidence.result.data);
  const results = Array.isArray(data?.results) ? data.results : [];
  return citedKnowledgeRecords(results, basis.field_paths).filter((item) => {
    const record = objectValue(item);
    if (!record) return false;
    const authority = String(record.authority ?? "");
    return authority === "authoritative" || (cue === "tracking" && authority === "operational");
  });
}

function answerCompletenessCandidates(
  cue: AnswerBearingCue,
  evidenceTexts: string[],
  customerMessage: string,
  context?: AnswerCompletenessContext,
) {
  const candidates: AnswerCompletenessCandidate[] = [];
  const processContext: AnswerCompletenessContext = {
    customerMessage: context?.customerMessage ?? customerMessage,
    interactionChannel: context?.interactionChannel,
    activeOrder: context?.activeOrder,
    trustedCustomerIdentity: context?.trustedCustomerIdentity,
    customerProvidedContext: context?.customerProvidedContext,
    proposedActions: context?.proposedActions,
  };
  const pushUrls = (text: string) => {
    for (const match of text.match(/https?:\/\/[^\s<>)]+/gi) ?? []) pushAnswerCompletenessCandidate(candidates, match);
  };
  const pushEmails = (text: string) => {
    for (const match of text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? []) pushAnswerCompletenessCandidate(candidates, match);
  };
  const rawProcessUnits = cue === "process"
    ? evidenceTexts
      .flatMap((evidenceText) => answerProcessEvidenceUnits(evidenceText))
      .filter(isProcessAnswerBearingInstruction)
      .filter((unit) => !isMerchantSideProcessInstruction(unit))
    : [];
  const processUnits = cue === "process"
    ? rawProcessUnits
      .flatMap((unit) => processInstructionCandidates(unit, processContext))
    : [];
  const preserveProcessConflicts = cue === "process"
    && (context?.preserveProcessConflicts ?? hasContradictoryProcessInstructions(rawProcessUnits));

  for (const evidenceText of evidenceTexts) {
    if (cue === "destination") {
      const lines = evidenceText.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line || !isConcreteReturnDestinationInstruction(line)) continue;
        const inline = line.match(/https?:\/\/[^\s<>)]+/i)?.[0];
        if (inline) pushAnswerCompletenessCandidate(candidates, inline);

        const afterCue = line.replace(/^.*?(?::|\bto\b|\btil\b|\ban\b|\bzu\b)\s*/i, "").trim();
        if (physicalAddressMarker(afterCue)) pushAnswerCompletenessCandidate(candidates, afterCue);

        const block: string[] = [];
        let nextIndex = index + 1;
        while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex += 1;
        for (; nextIndex < lines.length; nextIndex += 1) {
          const next = lines[nextIndex].trim();
          if (!next) break;
          const nextIsAddress = physicalAddressMarker(next);
          const nextCouldBeName = block.length === 0 && simpleAddressLabel(next) && physicalAddressMarker(lines[nextIndex + 1] ?? "");
          const nextCouldBeCity = block.length > 0 && block.some(physicalAddressMarker) && simpleAddressLabel(next);
          if (!nextIsAddress && !nextCouldBeName && !nextCouldBeCity) break;
          block.push(next);
        }
        if (block.some(physicalAddressMarker)) pushAnswerCompletenessCandidate(candidates, block.join("\n"));
        if (isReturnApprovalPrerequisite(line)) pushAnswerCompletenessCandidate(candidates, line);
      }
      const units = answerEvidenceUnits(evidenceText);
      for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
        const unit = units[unitIndex];
        if (isConcreteReturnDestinationInstruction(unit) && physicalAddressMarker(unit)) pushAnswerCompletenessCandidate(candidates, unit);
        if (isConcreteReturnDestinationInstruction(unit)) {
          pushUrls(unit);
          pushUrls(units[unitIndex + 1] ?? "");
        }
        if (isReturnApprovalPrerequisite(unit)) pushAnswerCompletenessCandidate(candidates, unit);
      }
      continue;
    }

    if (cue === "contact") {
      pushEmails(evidenceText);
      pushUrls(evidenceText);
      for (const unit of answerEvidenceUnits(evidenceText)) {
        if (/\b(?:contact|support|email|e-mail|phone|telephone|telefon|kontakt)\b/i.test(unit) && !/:\s*$/.test(unit)) {
          const phone = unit.match(/\+?\d[\d\s().-]{5,}\d/)?.[0];
          if (phone) pushAnswerCompletenessCandidate(candidates, phone);
        }
      }
      continue;
    }

    if (cue === "tracking") {
      if (/\b(?:link|url)\b/i.test(customerMessage)) pushUrls(evidenceText);
      for (const unit of answerEvidenceUnits(evidenceText)) {
        if (/(?:delivered|shipped|dispatched|processing|in transit|leveret|afsendt|behandles|undervejs|zugestellt|versendet)/i.test(unit)
          && /(?:tracking|shipment|parcel|package|order|sporing|forsendelse|pakke)/i.test(unit)) pushAnswerCompletenessCandidate(candidates, unit);
      }
      continue;
    }

    const units = cue === "process"
      ? answerProcessEvidenceUnits(evidenceText)
      : answerEvidenceUnits(evidenceText);
    if (cue === "process") {
      const processUnitsForEvidence = units
        .filter(isProcessAnswerBearingInstruction)
        .filter((unit) => !isMerchantSideProcessInstruction(unit));
      const nextSteps = preserveProcessConflicts
        ? processUnitsForEvidence
        : processUnitsForEvidence
          .flatMap((unit) => processInstructionCandidates(unit, processContext))
          .slice(0, 1);
      nextSteps.forEach((nextStep) => pushAnswerCompletenessCandidate(candidates, nextStep));
    }
    if (cue === "timing") units.filter(isRefundTiming).forEach((unit) => pushAnswerCompletenessCandidate(candidates, unit));
    if (cue === "cost") units.filter(isReturnShippingResponsibility).forEach((unit) => pushAnswerCompletenessCandidate(candidates, unit));
    if (cue === "eligibility") units
      .filter((unit) => isAnswerBearingEligibility(unit) || isReturnProhibition(unit) || isReturnEligibility(unit) || isReturnConditionConsequence(unit))
      .forEach((unit) => pushAnswerCompletenessCandidate(candidates, unit));
    if (cue === "status") units
      .filter((unit) => /(?:delivered|shipped|dispatched|processing|in transit|leveret|afsendt|behandles|undervejs|zugestellt|versendet)/i.test(unit))
      .forEach((unit) => pushAnswerCompletenessCandidate(candidates, unit));
  }
  return candidates;
}

type EvidenceRecovery =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "usable"; evidence: ResponseEvidenceRecord; resultIndex: number; candidate?: AnswerCompletenessCandidate };

type PolicyRecoveryOptions = {
  allowCustomerSpecificTiming?: boolean;
};

type ProcedureRecovery =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "usable"; evidence: ResponseEvidenceRecord; resultIndex: number; blockIds: string[] };

function successfulKnowledgeResults(context: Pick<ResponseValidationContext, "getResults">, toolName: string) {
  return (context.getResults?.() ?? []).filter((evidence) => {
    if (evidence.toolName !== toolName || evidence.result.status !== "ok") return false;
    return Array.isArray(objectValue(evidence.result.data)?.results);
  });
}

function timingCandidateDiagnosticsForContext(context: Pick<ResponseValidationContext, "getResults">): TimingCandidateDiagnostic[] {
  return successfulKnowledgeResults(context, "search_policy").flatMap((evidence) => {
    const data = objectValue(evidence.result.data);
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.flatMap((record) => {
      const value = objectValue(record);
      if (!value || String(value.authority ?? "") !== "authoritative" || String(value.knowledge_type ?? "") !== "policy") return [];
      return timingCandidateDiagnostics(answerEvidenceSections([value]));
    });
  }).slice(0, 64);
}

function uniqueAnswerCandidates(candidates: AnswerCompletenessCandidate[]) {
  return candidates.filter((candidate, index) => candidates.findIndex((item) => item.normalized === candidate.normalized) === index);
}

function recoveryCandidatesForRecord(
  cue: AnswerBearingCue,
  record: JsonObject,
  context: AnswerCompletenessContext,
): AnswerCompletenessCandidate[] {
  const candidates = answerCompletenessCandidates(
    cue,
    answerEvidenceSections([record]),
    context.customerMessage ?? "",
    context,
  );
  if (cue === "destination") {
    return uniqueAnswerCandidates(candidates.filter((candidate) =>
      /^https?:\/\//i.test(candidate.value) || physicalAddressMarker(candidate.value)));
  }
  if (cue === "contact") {
    return uniqueAnswerCandidates(candidates.filter((candidate) =>
      /https?:\/\/|mailto:|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\+?\d[\d\s().-]{5,}/i.test(candidate.value)));
  }
  if (cue === "cost") {
    return uniqueAnswerCandidates(candidates.filter((candidate) =>
      isPayerProposition(candidate.value)));
  }
  if (cue === "eligibility") {
    const stateCandidates = candidates.filter((candidate) =>
      isAnswerBearingEligibility(candidate.value) || isReturnProhibition(candidate.value) || isReturnEligibility(candidate.value));
    const consequenceCandidates = candidates.filter((candidate) => isReturnConditionConsequence(candidate.value));
    const relevant = uniqueAnswerCandidates([...stateCandidates, ...consequenceCandidates]);
    if (!stateCandidates.length) return [];
    if (!consequenceCandidates.length) return relevant;
    return [{
      value: relevant.map((candidate) => candidate.value).join(" "),
      normalized: normalizeAnswerCompletenessValue(relevant.map((candidate) => candidate.value).join(" ")),
    }];
  }
  return uniqueAnswerCandidates(candidates);
}

function mergeRecordAnswerCandidates(cue: AnswerBearingCue, candidates: AnswerCompletenessCandidate[]) {
  const unique = uniqueAnswerCandidates(candidates);
  if (unique.length <= 1) return unique;
  if (cue === "eligibility") {
    const stateCandidates = unique.filter((candidate) =>
      isAnswerBearingEligibility(candidate.value) || isReturnProhibition(candidate.value) || isReturnEligibility(candidate.value));
    const consequenceCandidates = unique.filter((candidate) => isReturnConditionConsequence(candidate.value));
    if (!stateCandidates.length) return [];
    if (!consequenceCandidates.length) return stateCandidates;
  }
  if (cue === "timing" || cue === "cost") {
    // Multiple answer-bearing sentences from one authoritative policy can be
    // complementary (for example, merchant processing followed by payment
    // provider display time). Keep the relation instead of treating every
    // sentence as a conflicting scalar value.
    return [{
      value: unique.map((candidate) => candidate.value).join(" "),
      normalized: normalizeAnswerCompletenessValue(unique.map((candidate) => candidate.value).join(" ")),
    }];
  }
  return unique;
}

function recoverPolicyAnswer(
  context: AnswerCompletenessContext,
  cue: AnswerBearingCue,
  options: PolicyRecoveryOptions = {},
): EvidenceRecovery {
  if (!options.allowCustomerSpecificTiming
    && policyAnswerNeedsCustomerSpecificLookup(cue, context.customerMessage ?? "")) return { kind: "none" };
  for (const evidence of successfulKnowledgeResults(context, "search_policy").reverse()) {
    const data = objectValue(evidence.result.data);
    const results = Array.isArray(data?.results) ? data : null;
    if (!results) continue;
    const records = (Array.isArray(data.results) ? data.results : []).map((value, resultIndex) => ({
      record: objectValue(value),
      resultIndex,
      rank: Number(objectValue(value)?.rank ?? resultIndex + 1),
    })).filter((item): item is { record: JsonObject; resultIndex: number; rank: number } =>
      Boolean(item.record) && String(item.record.authority ?? "") === "authoritative" && String(item.record.knowledge_type ?? "") === "policy");
    const preserveProcessConflicts = cue === "process" && hasContradictoryProcessInstructions(
      records
        .flatMap((item) => answerEvidenceSections([item.record]))
        .flatMap((evidenceText) => answerProcessEvidenceUnits(evidenceText))
        .filter(isProcessAnswerBearingInstruction),
    );
    const candidateContext = { ...context, preserveProcessConflicts };
    const matches = records.flatMap((item) => {
      const candidates = mergeRecordAnswerCandidates(cue, recoveryCandidatesForRecord(cue, item.record, candidateContext));
      return candidates.length ? [{ ...item, candidates }] : [];
    });
    if (!matches.length) continue;
    const candidateSets = matches.map((item) => item.candidates.map((candidate) => candidate.normalized).sort().join("\u001f"));
    const sameAnswerAcrossRecords = candidateSets.every((value) => value === candidateSets[0]);
    if (!sameAnswerAcrossRecords) return { kind: "ambiguous" };
    const candidates = uniqueAnswerCandidates(matches[0].candidates);
    if (candidates.length !== 1) return { kind: "ambiguous" };
    return { kind: "usable", evidence, resultIndex: matches[0].resultIndex, candidate: candidates[0] };
  }
  return { kind: "none" };
}

function shippingMethodCandidatesForRecord(
  record: JsonObject,
  context: AnswerCompletenessContext,
) {
  const units = answerEvidenceSections([record])
    .flatMap((evidenceText) => answerEvidenceUnits(evidenceText))
    .filter(isReturnShippingMethodInstruction)
    .filter((unit) => !isMerchantSideProcessInstruction(unit))
    .filter((unit) => !isSatisfiedSupportContactPrerequisite(unit, context));
  return uniqueAnswerCandidates(
    units.map((unit) => ({
      value: unit,
      normalized: normalizeAnswerCompletenessValue(unit),
    })),
  );
}

function mergedFacetCandidates(candidates: AnswerCompletenessCandidate[]) {
  const unique = uniqueAnswerCandidates(candidates);
  if (unique.length <= 1) return unique;
  const value = unique.map((candidate) => candidate.value).join(" ");
  return [{ value, normalized: normalizeAnswerCompletenessValue(value) }];
}

function recoverShippingMethodAnswer(
  context: Pick<ResponseValidationContext, "customerMessage" | "getResults" | "interactionChannel">,
): EvidenceRecovery {
  for (const evidence of successfulKnowledgeResults(context, "search_policy").reverse()) {
    const data = objectValue(evidence.result.data);
    const results = Array.isArray(data?.results) ? data.results : [];
    const records = results.map((value, resultIndex) => ({
      record: objectValue(value),
      resultIndex,
      rank: Number(objectValue(value)?.rank ?? resultIndex + 1),
    })).filter((item): item is { record: JsonObject; resultIndex: number; rank: number } =>
      Boolean(item.record)
      && String(item.record.authority ?? "") === "authoritative"
      && String(item.record.knowledge_type ?? "") === "policy");
    const matches = records.flatMap((item) => {
      const candidates = mergedFacetCandidates(shippingMethodCandidatesForRecord(item.record, context));
      return candidates.length ? [{ ...item, candidates }] : [];
    });
    if (!matches.length) continue;
    const candidateSets = matches.map((item) => item.candidates.map((candidate) => candidate.normalized).sort().join("\u001f"));
    if (!candidateSets.every((value) => value === candidateSets[0])) return { kind: "ambiguous" };
    const candidates = uniqueAnswerCandidates(matches[0].candidates);
    if (candidates.length !== 1) return { kind: "ambiguous" };
    return { kind: "usable", evidence, resultIndex: matches[0].resultIndex, candidate: candidates[0] };
  }
  return { kind: "none" };
}

type ActionablePolicyFacetKind = "eligibility" | "destination" | "shipping_method" | "cost" | "timing" | "process";
type ActionablePolicyFacetStatus = "satisfied" | "required" | "useful" | "irrelevant" | "ambiguous" | "unavailable";
type ActionablePolicyFacet = {
  kind: ActionablePolicyFacetKind;
  cue: AnswerBearingCue;
  status: ActionablePolicyFacetStatus;
  recovery: EvidenceRecovery;
};
type ActionablePolicyPlan = {
  task: "return_request";
  facets: ActionablePolicyFacet[];
};

function processInstructionState(
  context: Pick<ResponseValidationContext, "customerMessage" | "getResults" | "interactionChannel">,
) {
  const instructions = successfulKnowledgeResults(context, "search_policy")
    .flatMap((evidence) => {
      const data = objectValue(evidence.result.data);
      const records = Array.isArray(data?.results) ? data.results : [];
      return records
        .filter((value) => {
          const record = objectValue(value);
          return Boolean(record)
            && String(record.authority ?? "") === "authoritative"
            && String(record.knowledge_type ?? "") === "policy";
        })
        .flatMap((record) => answerEvidenceSections([objectValue(record)!]))
        .flatMap((evidenceText) => answerProcessEvidenceUnits(evidenceText))
        .filter(isProcessAnswerBearingInstruction)
        .flatMap((unit) => processInstructionCandidates(unit, context));
    });
  return {
    hasInstructions: instructions.length > 0,
    hasRemaining: instructions.length > 0,
  };
}

function actionablePolicyPlan(
  context: Pick<ResponseValidationContext, "customerMessage" | "getResults" | "interactionChannel">,
): ActionablePolicyPlan | null {
  const focus = customerKnowledgeFocus(context.customerMessage);
  if (!focus.hasReturnIntent || !focus.asksProcess) return null;

  const processState = processInstructionState(context);
  const facets = [
    {
      kind: "eligibility",
      cue: "eligibility",
      status: "required",
      recovery: recoverPolicyAnswer(context, "eligibility"),
    },
    {
      kind: "destination",
      cue: "destination",
      status: "required",
      recovery: recoverPolicyAnswer(context, "destination"),
    },
    {
      kind: "shipping_method",
      cue: "process",
      status: "required",
      recovery: recoverShippingMethodAnswer(context),
    },
    {
      kind: "cost",
      cue: "cost",
      status: "required",
      recovery: recoverPolicyAnswer(context, "cost"),
    },
    {
      kind: "timing",
      cue: "timing",
      status: "useful",
      recovery: recoverPolicyAnswer(context, "timing", { allowCustomerSpecificTiming: true }),
    },
    {
      kind: "process",
      cue: "process",
      status: processState.hasRemaining
        ? "required"
        : processState.hasInstructions
          ? "satisfied"
          : "unavailable",
      recovery: recoverPolicyAnswer(context, "process"),
    },
  ] satisfies ActionablePolicyFacet[];
  const normalizedFacets: ActionablePolicyFacet[] = facets.map((facet) => ({
    ...facet,
    status: facet.recovery.kind === "ambiguous"
      ? "ambiguous"
      : facet.recovery.kind === "usable"
        ? facet.status
        : facet.status === "satisfied"
          ? "satisfied"
          : "unavailable",
  } as ActionablePolicyFacet));

  return {
    task: "return_request",
    facets: normalizedFacets.filter((facet) => facet.status !== "unavailable"),
  };
}

function actionablePolicyFacetCovered(
  facet: ActionablePolicyFacet,
  segments: ResponseSegment[],
  context: ResponseValidationContext,
) {
  if (facet.status === "satisfied") return true;
  const recovery = facet.recovery;
  if (recovery.kind !== "usable" || !recovery.candidate) return false;
  const candidate = recovery.candidate;
  return segments.some((segment) => {
    if (segment.type !== "knowledge_guidance" || !isPolicyKnowledgeBasis(segment.basis, context)) return false;
    if (normalizeAnswerCompletenessValue(segment.text).includes(candidate.normalized)) return true;
    if (facet.kind === "shipping_method") {
      return isReturnShippingMethodInstruction(segment.text);
    }
    if (facet.kind === "eligibility") {
      return isAnswerBearingEligibility(segment.text)
        || isReturnProhibition(segment.text)
        || isReturnEligibility(segment.text)
        || isReturnConditionConsequence(segment.text);
    }
    if (facet.kind === "destination") {
      return isReturnDestinationInstruction(segment.text)
        && (/https?:\/\//i.test(segment.text) || physicalAddressMarker(segment.text));
    }
    if (facet.kind === "cost") return isPayerProposition(segment.text);
    if (facet.kind === "timing") return isRefundTiming(segment.text);
    return isReturnProcessInstruction(segment.text) || isCustomerContentRequirement(segment.text);
  });
}

function actionablePolicyPlanComplete(
  validation: Pick<ResponseValidationResult, "approvedSegments">,
  context: ResponseValidationContext,
  plan: ActionablePolicyPlan | null,
) {
  if (!plan) return true;
  return !plan.facets.some((facet) =>
    (facet.status === "required" || facet.status === "useful")
    && !actionablePolicyFacetCovered(facet, validation.approvedSegments, context));
}

function approvedSegmentResolvesCue(
  segment: ResponseSegment,
  cue: AnswerBearingCue,
  context: ResponseValidationContext,
) {
  if (segment.type === "question" || segment.type === "limitation" || segment.type === "acknowledgement") return false;

  if (segment.type === "procedure_guidance") return cue === "process";
  if (segment.type === "fact") return cue === "status";
  if (segment.type === "action_offer") return cue === "process";
  if (segment.type !== "knowledge_guidance") return false;

  const records = answerEvidenceRecords(segment.basis, context, cue);
  const candidates = answerCompletenessCandidates(
    cue,
    answerEvidenceSections(records),
    context.customerMessage ?? "",
    context,
  );
  if (candidates.length && answerCompletenessValuePresent(segment.text, cue, candidates)) return true;

  // A model may faithfully answer in language that is not an exact substring
  // of the cited source. Keep this fallback limited to the same answer-bearing
  // classifiers used by deterministic recovery; it never treats a question
  // or a generic acknowledgement as resolving the intent.
  if (cue === "timing") return isRefundTiming(segment.text);
  if (cue === "cost") return isPayerProposition(segment.text);
  if (cue === "eligibility") {
    return isAnswerBearingEligibility(segment.text)
      || isReturnProhibition(segment.text)
      || isReturnEligibility(segment.text)
      || isReturnConditionConsequence(segment.text);
  }
  if (cue === "destination") return isReturnDestinationInstruction(segment.text) && hasAnswerBearingValueMarker(segment.text, cue);
  if (cue === "process") return isReturnProcessInstruction(segment.text) || hasAnswerBearingValueMarker(segment.text, cue);
  return hasAnswerBearingValueMarker(segment.text, cue);
}

function approvedSegmentsResolveIntent(
  validation: Pick<ResponseValidationResult, "approvedSegments">,
  context: ResponseValidationContext,
  cues: AnswerBearingCue[],
  plan: ActionablePolicyPlan | null = actionablePolicyPlan(context),
) {
  if (!cues.length) return validation.approvedSegments.some(segment => segment.type !== "acknowledgement");
  return cues.every((cue) => validation.approvedSegments.some((segment) => approvedSegmentResolvesCue(segment, cue, context)))
    && actionablePolicyPlanComplete(validation, context, plan);
}

/**
 * An approved segment can still be a non-answer clarification. Prefer the
 * deterministic evidence fallback only when the customer intent is otherwise
 * resolvable from authoritative policy evidence. This keeps required
 * customer-specific clarifications and ambiguous evidence fail-closed.
 */
export function shouldPreferAuthoritativeEvidenceFallback(
  validation: Pick<ResponseValidationResult, "approvedSegments">,
  context: ResponseValidationContext,
) {
  if (validation.approvedSegments.some(segment => ["source_content", "source_comparison", "evidence_limitation"].includes(segment.type)
    || segment.type === "fact" && ["order_amount", "line_fulfillment"].includes(segment.fact_kind))) return false;
  const focus = customerKnowledgeFocus(context.customerMessage);
  const cues = answerCompletenessMessageCues(context.customerMessage ?? "", focus);
  const plan = actionablePolicyPlan(context);
  const hasSafeActionableComposition = Boolean(
    plan
    && !plan.facets.some((facet) => facet.status === "ambiguous")
    && composeActionableResponse(validation.approvedSegments, context),
  );
  if (hasSafeActionableComposition) return false;
  if (plan?.facets.some((facet) =>
    facet.status === "ambiguous"
    || ((facet.status === "required" || facet.status === "useful")
      && !actionablePolicyFacetCovered(facet, validation.approvedSegments, context)))) {
    return true;
  }
  if (!cues.length || approvedSegmentsResolveIntent(validation, context, cues)) return false;
  return cues.some((cue) => recoverPolicyAnswer(context, cue).kind === "usable");
}

/**
 * Returns only propositions that can be resolved from one or more successful,
 * authoritative policy results. This is also used by the transport fallback
 * path when the SDK cannot produce a structured final output.
 */
export function recoverAuthoritativePolicyAnswer(
  context: AnswerCompletenessContext,
) {
  const focus = customerKnowledgeFocus(context.customerMessage);
  const values: string[] = [];
  for (const cue of answerCompletenessMessageCues(context.customerMessage ?? "", focus)) {
    const recovery = recoverPolicyAnswer(context, cue);
    if (recovery.kind === "usable" && recovery.candidate) values.push(recovery.candidate.value);
  }
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).join("\n\n") || null;
}

function recoverProcedureAnswer(context: ResponseValidationContext): ProcedureRecovery {
  const customerMessage = [
    context.customerMessage,
    context.customerProvidedContext?.product,
    context.customerProvidedContext?.platform,
    context.customerProvidedContext?.issue,
  ].filter(Boolean).join(" ");
  for (const evidence of (context.getResults?.() ?? []).filter(semanticProcedureSource).reverse()) {
    const data = objectValue(evidence.result.data);
    if (data?.task_specificity !== "sufficient" || data?.procedure_evidence_quality !== "usable") continue;
    const results = Array.isArray(data.results) ? data.results : [];
    const matches = results.flatMap((value, resultIndex) => {
      const record = objectValue(value);
      if (!record || !["authoritative", "operational"].includes(String(record.authority ?? "")) || String(record.knowledge_type ?? "") !== "procedural") return [];
      const blocks = procedureBlocks(evidence.result, resultIndex);
      if (!blocks.length || blocks.length > 32 || blocks.some((entry) => !meaningful(entry.block.text))) return [];
      if (procedureProductMismatch(results, customerMessage, resultIndex, -1).length) return [];
      return [{
        record,
        resultIndex,
        rank: Number(record.rank ?? resultIndex + 1),
        blockIds: blocks.map((entry) => entry.blockId),
      }];
    });
    if (!matches.length) continue;
    const bestRank = Math.min(...matches.map((item) => item.rank));
    const best = matches.filter((item) => item.rank === bestRank);
    if (best.length !== 1) return { kind: "ambiguous" };
    return { kind: "usable", evidence, resultIndex: best[0].resultIndex, blockIds: best[0].blockIds };
  }
  return { kind: "none" };
}

function looksLikeGenericEvidenceFallback(value: string) {
  return /\b(?:couldn['’]?t|cannot|can't|unable|no\s+(?:support\s+)?(?:procedure|policy|guidance)|not\s+(?:available|found|verified)|try\s+again|safely\s+complete|verify\s+(?:a\s+)?(?:support\s+)?(?:procedure|policy))\b/i.test(value);
}

function isReplaceableEvidenceFallback(
  segment: ResponseSegment,
  context: ResponseValidationContext,
  toolName: string,
) {
  if (!(segment.type === "limitation" || segment.type === "knowledge_guidance" || segment.type === "question")) return false;
  if (!looksLikeGenericEvidenceFallback(segment.text ?? "")) return false;
  const basis = "basis" in segment ? segment.basis : null;
  const evidence = basis ? resultFor(basis, context) : undefined;
  return evidence?.toolName === toolName && evidence.result.status === "ok";
}

function recoveredPolicySegment(recovery: EvidenceRecovery): ResponseSegment | null {
  if (recovery.kind !== "usable" || !recovery.candidate) return null;
  return {
    type: "knowledge_guidance",
    text: recovery.candidate.value,
    basis: {
      result_id: recovery.evidence.resultId,
      field_paths: [`results[${recovery.resultIndex}]`],
    },
  } satisfies Extract<ResponseSegment, { type: "knowledge_guidance" }>;
}

/**
 * Recovery enters the same validator as model segments. Source selection
 * cannot grant a bypass for truth, values, or operational commitments.
 */
function validateRecoveredPolicySegment(
  segment: Extract<ResponseSegment, { type: "knowledge_guidance" }>,
  context: ResponseValidationContext,
  index: number,
) {
  return validateSegment(segment, context, index);
}

function recoveredProcedureSegment(recovery: ProcedureRecovery): ResponseSegment | null {
  if (recovery.kind !== "usable") return null;
  return {
    type: "procedure_guidance",
    text: "Relevant support steps.",
    basis: {
      result_id: recovery.evidence.resultId,
      field_paths: [`results[${recovery.resultIndex}]`],
    },
    block_ids: recovery.blockIds,
  } satisfies Extract<ResponseSegment, { type: "procedure_guidance" }>;
}

function answerCompletenessValuePresent(value: string, cue: AnswerBearingCue, candidates: AnswerCompletenessCandidate[]) {
  const normalizedValue = normalizeAnswerCompletenessValue(value);
  if (candidates.some((candidate) => normalizedValue.includes(candidate.normalized))) return true;
  if (cue === "process" && candidates.some((candidate) => {
    const sourceRequirement = candidate.value.replace(/^please\s+provide\s+/i, "");
    const normalizedRequirement = normalizeAnswerCompletenessValue(sourceRequirement);
    return normalizedRequirement.length > 3 && normalizedValue.includes(normalizedRequirement);
  })) return true;
  if (cue === "cost") {
    const hasAmount = /(?:€|eur|usd|dkk|gbp|£|\$)\s*\d|\b\d+(?:[.,]\d+)?\s*(?:kr|dkk|eur|euro|euros?)\b/i.test(value);
    const hasNamedPayer = isPayerProposition(value);
    return hasAmount || hasNamedPayer;
  }
  return hasAnswerBearingValueMarker(value, cue);
}

function restoreAnswerCompletenessValue(value: string, focus: CustomerKnowledgeFocus, cue: AnswerBearingCue, candidate: AnswerCompletenessCandidate) {
  const lines = String(value ?? "").trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const cueIndex = lines.findIndex((line) => answerBearingCueFor(line, focus) === cue);
  if (cueIndex >= 0) {
    lines.splice(cueIndex + 1, 0, ...candidate.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    return lines.join("\n");
  }
  return `${String(value ?? "").trim()}\n\n${candidate.value}`.trim();
}

/**
 * Ensures a model cannot silently omit the smallest answer-bearing value that
 * is already present in the current authoritative evidence. This stays at the
 * contract boundary: it neither retrieves new data nor asks the model to
 * repair its own output. Server-recorded evidence may be used when the model
 * emitted a generic fallback instead of citing the result itself.
 */
export function ensureAnswerCompleteness(validation: ResponseValidationResult, context: ResponseValidationContext): ResponseValidationResult {
  return preserveRequiredAnswers(ensureLegacyAnswerCompleteness(validation, context), context);
}

function ensureLegacyAnswerCompleteness(
  validation: ResponseValidationResult,
  context: ResponseValidationContext,
): ResponseValidationResult {
  validation = preserveSupportedProductAnswers(validation, context);
  const focus = customerKnowledgeFocus(context.customerMessage);
  const cues = answerCompletenessMessageCues(context.customerMessage ?? "", focus);
  const plan = actionablePolicyPlan(context);
  const completenessDiagnostics: ResponseCompletenessDiagnostics = {
    entered: true,
    cues: [...cues],
    recovery: [...(validation.completenessDiagnostics?.recovery ?? [])],
    intent_resolved_by_approved_segment: approvedSegmentsResolveIntent(validation, context, cues, plan),
    ...(cues.includes("timing") ? { timing_candidates: timingCandidateDiagnosticsForContext(context) } : {}),
  };
  if (!validation.schemaValid && !cues.length) {
    return { ...validation, completenessDiagnostics };
  }
  const procedureRequested = /\b(?:procedure|steps?|troubleshoot(?:ing)?|pair(?:ing)?|connect(?:ion|ing)?|reset|firmware|microphone|interference|not\s+working|won['’]?t|will\s+not|problem|issue|fejl|forbinder|parre|funktioniert|verbinden|koppeln)\b/i.test([
    context.customerMessage,
    context.customerProvidedContext?.issue,
  ].filter(Boolean).join(" "));

  const approvedSegments: ResponseSegment[] = [];
  const rejectedSegments = [...validation.rejectedSegments];
  const issues = [...validation.issues];
  const restoredValues = new Set<string>();
  let changed = false;

  validation.approvedSegments.forEach((segment) => {
    if (segment.type !== "knowledge_guidance") {
      approvedSegments.push(segment);
      return;
    }
    let currentSegment = segment;
    let rejected = false;
    for (const cue of cues) {
      const records = answerEvidenceRecords(currentSegment.basis, context, cue);
      const candidates = answerCompletenessCandidates(
        cue,
        answerEvidenceSections(records),
        context.customerMessage ?? "",
        context,
      );
      if (!candidates.length || answerCompletenessValuePresent(currentSegment.text, cue, candidates)) {
        candidates.forEach((candidate) => {
          if (normalizeAnswerCompletenessValue(currentSegment.text).includes(candidate.normalized)) restoredValues.add(candidate.normalized);
        });
        continue;
      }

      const index = validation.parsed?.segments.indexOf(segment) ?? validation.approvedSegments.indexOf(segment);
      if (candidates.length === 1 && !restoredValues.has(candidates[0].normalized)) {
        currentSegment = {
          ...currentSegment,
          text: restoreAnswerCompletenessValue(currentSegment.text, focus, cue, candidates[0]),
        };
        restoredValues.add(candidates[0].normalized);
        completenessDiagnostics.recovery.push({ type: cue, result: "recovered" });
        changed = true;
        continue;
      }

      const issue: ResponseValidationIssue = {
        index,
        code: candidates.length > 1 ? "answer_value_ambiguous" : "answer_value_duplicate",
        message: candidates.length > 1
          ? "The selected evidence contains multiple conflicting answer values, so the response was withheld rather than guessing."
          : "The response repeated an incomplete answer-bearing segment, so it was withheld rather than rendered twice.",
      };
      rejectedSegments.push({ index, type: segment.type, issues: [issue] });
      issues.push(issue);
      rejected = true;
      changed = true;
      break;
    }
    if (!rejected) approvedSegments.push(currentSegment);
  });

  const recoveredSegments: ResponseSegment[] = [];
  const recoveredTools = new Set<string>();
  for (const cue of cues) {
    const recovery = recoverPolicyAnswer(context, cue);
    let recoveryResult: CompletenessRecoveryDiagnostic["result"] = recovery.kind === "ambiguous"
      ? "ambiguous"
      : recovery.kind === "usable"
        ? "unavailable"
        : policyAnswerNeedsCustomerSpecificLookup(cue, context.customerMessage ?? "")
          ? "skipped"
          : "unavailable";
    if (recovery.kind !== "usable") {
      completenessDiagnostics.recovery.push({ type: cue, result: recoveryResult });
      continue;
    }
    const hasAnswer = approvedSegments.some((segment) => {
      if (segment.type !== "knowledge_guidance") return false;
      const evidence = resultFor(segment.basis, context);
      if (evidence?.toolName !== "search_policy") return false;
      const candidates = answerCompletenessCandidates(
        cue,
        answerEvidenceSections(answerEvidenceRecords(segment.basis, context, cue)),
        context.customerMessage ?? "",
        context,
      );
      return candidates.length > 0 && answerCompletenessValuePresent(segment.text, cue, candidates);
    });
    if (hasAnswer) {
      recoveryResult = "skipped";
    } else {
      const segment = recoveredPolicySegment(recovery);
      if (segment?.type === "knowledge_guidance" && !validateRecoveredPolicySegment(segment, context, -1).length) {
        recoveredSegments.push(segment);
        recoveredTools.add("search_policy");
        recoveryResult = "recovered";
        changed = true;
      }
    }
    completenessDiagnostics.recovery.push({ type: cue, result: recoveryResult });
  }

  for (const facet of plan?.facets ?? []) {
    if (facet.kind === "process") continue;
    if (facet.status === "ambiguous") {
      completenessDiagnostics.recovery.push({ type: facet.kind, result: "ambiguous" });
      continue;
    }
    if (facet.recovery.kind !== "usable") {
      completenessDiagnostics.recovery.push({ type: facet.kind, result: "unavailable" });
      continue;
    }
    if (actionablePolicyFacetCovered(facet, [...recoveredSegments, ...approvedSegments], context)) {
      completenessDiagnostics.recovery.push({ type: facet.kind, result: "skipped" });
      continue;
    }
    const segment = recoveredPolicySegment(facet.recovery);
    const segmentIssues = segment && segment.type === "knowledge_guidance"
      ? validateRecoveredPolicySegment(segment, context, -1)
      : [];
    if (segment && !segmentIssues.length) {
      recoveredSegments.push(segment);
      recoveredTools.add("search_policy");
      completenessDiagnostics.recovery.push({ type: facet.kind, result: "recovered" });
      changed = true;
    } else {
      completenessDiagnostics.recovery.push({ type: facet.kind, result: "unavailable" });
    }
  }

  if (procedureRequested) {
    const recovery = recoverProcedureAnswer(context);
    let recoveryResult: CompletenessRecoveryDiagnostic["result"] = recovery.kind === "ambiguous"
      ? "ambiguous"
      : recovery.kind === "usable"
        ? "unavailable"
        : "unavailable";
    const hasProcedure = approvedSegments.some((segment) => segment.type === "procedure_guidance");
    if (recovery.kind === "usable" && !hasProcedure) {
      const segment = recoveredProcedureSegment(recovery);
      if (segment && !validateSegment(segment, context, -1).length) {
        recoveredSegments.push(segment);
        recoveredTools.add("search_procedures");
        recoveryResult = "recovered";
        changed = true;
      }
    } else if (hasProcedure) {
      recoveryResult = "skipped";
    }
    completenessDiagnostics.recovery.push({ type: "procedure", result: recoveryResult });
  }

  if (recoveredTools.size) {
    for (let index = approvedSegments.length - 1; index >= 0; index -= 1) {
      const segment = approvedSegments[index];
      if ([...recoveredTools].some((toolName) => isReplaceableEvidenceFallback(segment, context, toolName))) {
        approvedSegments.splice(index, 1);
        changed = true;
      }
    }
  }

  if (plan) {
    completenessDiagnostics.intent_resolved_by_approved_segment = approvedSegmentsResolveIntent(
      { approvedSegments: [...recoveredSegments, ...approvedSegments] },
      context,
      cues,
      plan,
    );
  }

  if (!changed) return { ...validation, completenessDiagnostics };
  return {
    ...validation,
    allValid: validation.schemaValid && rejectedSegments.length === 0,
    approvedSegments: [...recoveredSegments, ...approvedSegments],
    rejectedSegments,
    issues,
    completenessDiagnostics,
  };
}

function isAnswerBearingContinuation(value: string, cue: AnswerBearingCue) {
  const text = value.trim();
  const hasAddressMarker = /\b(?:street|road|avenue|vej|gade|strasse|straße|postcode|postal|city|by)\b|\b\d{4,6}\s+[A-Za-zÀ-ÿ]/i.test(text);
  const looksLikePolicyText = /\b(?:returns?|retur\w*|refund\w*|shipping|fragt\w*|versand\w*|opened|åbnet|geöffnet|tracking|efterkrav)\b/i.test(text)
    && (/[.!?]$/.test(text) || /\b(?:are|is|can|must|will|within|after|recommend|you|we|not|should|may|er|kan|skal|vil|inden|efter|anbefal\w*|du|vi|ikke|bør|darf|muss|wird|nach|empfehl\w*)\b/i.test(text));
  if (!text) return false;
  if (cue === "destination"
    && !/^https?:\/\//i.test(text)
    && !hasAddressMarker
    && looksLikePolicyText) {
    return false;
  }
  return isAddressContinuation(text) || hasAnswerBearingValueMarker(text, cue);
}

function answerBearingContinuationLines(lines: string[], startIndex: number, cue: AnswerBearingCue) {
  const continuation: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    if (!isAnswerBearingContinuation(lines[index], cue)) break;
    continuation.push(lines[index]);
  }
  return continuation;
}

function answerBearingContinuationPrefix(value: string, cue: AnswerBearingCue) {
  const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const continuation = answerBearingContinuationLines(lines, 0, cue);
  return continuation.length > 0 && continuation.some((line) => hasAnswerBearingValueMarker(line, cue))
    ? continuation
    : [];
}

function mergeAnswerBearingParagraphs(paragraphs: string[], focus: CustomerKnowledgeFocus) {
  const merged: string[] = [];
  paragraphs.forEach((paragraph) => {
    const previous = merged[merged.length - 1];
    const previousLines = previous?.split(/\n+/).map((line) => line.trim()).filter(Boolean) ?? [];
    const previousLine = previousLines[previousLines.length - 1];
    const cue = previousLine ? answerBearingCueFor(previousLine, focus) : null;
    const continuation = cue && previous ? answerBearingContinuationPrefix(paragraph, cue) : [];
    if (continuation.length > 0 && previous) {
      merged[merged.length - 1] = `${previous}\n${continuation.join("\n")}`;
      const remaining = paragraph.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(continuation.length);
      if (remaining.length > 0) merged.push(remaining.join("\n"));
    } else {
      merged.push(paragraph);
    }
  });
  return merged;
}

function focusedPolicyClause(value: string, focus: CustomerKnowledgeFocus) {
  if (focus.questionShape !== "destination" && focus.questionShape !== "cost") return value;
  if (!isReturnShippingResponsibility(value)) return value;
  const clauses = value.split(/,\s+(?:and|og|und)\s+/i);
  if (clauses.length <= 1) return value;
  return clauses.find(isReturnShippingResponsibility) ?? value;
}

function policySentencePriority(value: string, focus: CustomerKnowledgeFocus) {
  if (focus.questionShape === "eligibility") {
    return isReturnConditionConsequence(value) ? 0 : 1;
  }
  if (focus.questionShape === "timing") return isRefundTiming(value) ? 0 : 1;
  if (focus.questionShape === "destination") return isReturnDestinationInstruction(value) ? 0 : 1;
  if (focus.questionShape === "process") return isReturnProcessInstruction(value) ? 0 : 1;
  return 0;
}

type PolicyCompositionOptions = {
  includeShippingResponsibility?: boolean;
  hasDirectDestination?: boolean;
};

function composePolicyLine(value: string, focus: CustomerKnowledgeFocus, options: PolicyCompositionOptions = {}) {
  const includeShippingResponsibility = options.includeShippingResponsibility !== false;
  const sentences = value.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return value;

  let retained = sentences.filter((candidate) => {
    if (focus.questionShape === "eligibility") return isReturnEligibility(candidate) || isAnswerBearingEligibility(candidate) || isReturnConditionConsequence(candidate);
    if (focus.questionShape === "timing") return isRefundTiming(candidate);
    if (focus.questionShape === "cost") return isReturnShippingResponsibility(candidate);
    if (focus.questionShape === "destination") return isReturnDestinationInstruction(candidate)
      || isReturnApprovalPrerequisite(candidate)
      || (options.hasDirectDestination !== true && isReturnProcessInstruction(candidate))
      || (includeShippingResponsibility && isReturnShippingResponsibility(candidate));
    if (focus.questionShape === "process") return isReturnProcessInstruction(candidate) || isReturnEligibility(candidate) || isReturnApprovalPrerequisite(candidate);
    if (isReturnConditionConsequence(candidate)) return focus.mentionsCondition;
    if (isReturnShippingResponsibility(candidate)) return focus.asksShippingResponsibility;
    if (isRefundTiming(candidate)) return focus.asksRefundTiming;
    return true;
  }).map((candidate) => focusedPolicyClause(candidate, focus));
  if (!retained.length) return value;

  if (focus.questionShape === "eligibility") {
    const condition = retained.filter(isReturnConditionConsequence);
    const eligibility = retained.filter((candidate) => isReturnEligibility(candidate) || isAnswerBearingEligibility(candidate));
    if (condition.length || eligibility.length) retained = [...eligibility, ...condition];
  } else if (focus.questionShape === "timing") {
    const timing = retained.filter(isRefundTiming);
    if (timing.length) retained = timing;
  } else if (focus.questionShape === "destination") {
    const destination = retained.filter((candidate) => isReturnDestinationInstruction(candidate)
      || isReturnApprovalPrerequisite(candidate)
      || (options.hasDirectDestination !== true && isReturnProcessInstruction(candidate))
      || (includeShippingResponsibility && isReturnShippingResponsibility(candidate)));
    if (destination.length) retained = destination;
  } else if (focus.questionShape === "cost") {
    const shipping = retained.filter(isReturnShippingResponsibility);
    if (shipping.length) retained = shipping;
  }

  if (focus.questionShape === "process") {
    retained = retained
      .map((candidate, index) => ({ candidate, index }))
      .sort((left, right) => policySentencePriority(left.candidate, focus) - policySentencePriority(right.candidate, focus) || left.index - right.index)
      .map(({ candidate }) => candidate);
  }
  return retained.join(" ");
}

function isAddressContinuation(value: string) {
  const line = value.trim();
  if (!line || /[.!?]$/.test(line)) return false;
  return /\d|\b(?:street|road|avenue|vej|gade|strasse|straße|city|by|postcode|postal|danmark|denmark|germany|deutschland|phone|telefon|tel|email|e-mail|att\.?|c\/o)\b/i.test(line)
    || !/\b(?:return|retur|rücksend|refund|refunder|shipping|fragt|versand|opened|åbnet|geöffnet|portal|contact|kontakt|formular)\b/i.test(line);
}

function composePolicyParagraph(paragraph: string, focus: CustomerKnowledgeFocus, options: PolicyCompositionOptions = {}) {
  const lines = paragraph.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (focus.questionShape === "unknown") return paragraph;

  const destinationIndex = lines.findIndex(isReturnDestinationInstruction);
  const selected: string[] = [];
  const pushLine = (line: string) => {
    if (line && !selected.includes(line)) selected.push(line);
  };

  if (focus.questionShape === "destination" && destinationIndex >= 0) {
    const destinationLine = composePolicyLine(lines[destinationIndex], focus, options);
    const destinationCue = answerBearingCueFor(destinationLine, focus);
    const continuation = destinationCue
      ? answerBearingContinuationLines(lines, destinationIndex + 1, destinationCue)
      : [];
    const hasDestinationValue = !destinationCue
      || continuation.some((line) => hasAnswerBearingValueMarker(line, destinationCue));
    if (hasDestinationValue) {
      pushLine(destinationLine);
      continuation.forEach(pushLine);
    }
    lines.forEach((line, index) => {
      if (index !== destinationIndex && (isReturnApprovalPrerequisite(line) || (options.includeShippingResponsibility !== false && isReturnShippingResponsibility(line)))) {
        pushLine(composePolicyLine(line, focus, options));
      }
    });
    return selected.join("\n");
  }

  const answerCueIndex = lines.findIndex((line) => answerBearingCueFor(line, focus) !== null);
  if (answerCueIndex >= 0) {
    const answerCue = answerBearingCueFor(lines[answerCueIndex], focus);
    if (answerCue) {
      const continuation = answerBearingContinuationLines(lines, answerCueIndex + 1, answerCue);
      if (continuation.some((line) => hasAnswerBearingValueMarker(line, answerCue))) {
        pushLine(lines[answerCueIndex]);
        continuation.forEach(pushLine);
        return selected.join("\n");
      }
    }
  }

  if (focus.questionShape === "destination") {
    lines.forEach((line) => {
      if (isReturnApprovalPrerequisite(line)
        || (options.includeShippingResponsibility !== false && isReturnShippingResponsibility(line))
        || (options.hasDirectDestination !== true && isReturnProcessInstruction(line))) {
        pushLine(composePolicyLine(line, focus, options));
      }
    });
    return selected.join("\n");
  }

  lines.forEach((line) => {
    const composed = composePolicyLine(line, focus);
    if (composed && (focus.questionShape === "eligibility"
          ? composed.split(/(?<=[.!?])\s+/).some((sentenceValue) => isReturnEligibility(sentenceValue) || isAnswerBearingEligibility(sentenceValue) || isReturnConditionConsequence(sentenceValue))
          : focus.questionShape === "timing"
            ? composed.split(/(?<=[.!?])\s+/).some(isRefundTiming)
            : focus.questionShape === "cost"
              ? composed.split(/(?<=[.!?])\s+/).some(isReturnShippingResponsibility)
              : focus.questionShape === "process"
            ? composed.split(/(?<=[.!?])\s+/).some((sentenceValue) => isReturnProcessInstruction(sentenceValue) || isReturnEligibility(sentenceValue) || isReturnApprovalPrerequisite(sentenceValue) || physicalAddressMarker(sentenceValue))
            : true)) {
      pushLine(composed);
    }
  });

  return selected.length ? selected.join("\n") : paragraph;
}

function composeMinimumSufficientPolicyText(value: string, context: ResponseValidationContext) {
  const focus = customerKnowledgeFocus(context.customerMessage);
  const paragraphs = mergeAnswerBearingParagraphs(String(value ?? "").split(/\n\s*\n/), focus);
  if (focus.questionShape === "unknown") return paragraphs.join("\n\n");
  const hasDirectDestination = focus.questionShape === "destination"
    && paragraphs.some((paragraph) => paragraph.split(/\n+/).some(isReturnDestinationInstruction));
  const hasApprovalPrerequisite = focus.questionShape === "destination"
    && paragraphs.some((paragraph) => paragraph.split(/\n+/).some(isReturnApprovalPrerequisite));
  const options = {
    includeShippingResponsibility: !hasApprovalPrerequisite,
    hasDirectDestination,
  };
  return paragraphs.map((paragraph) => composePolicyParagraph(paragraph, focus, options)).filter(Boolean).join("\n\n");
}

function isPolicyKnowledgeBasis(basis: KnowledgeBasis, context: ResponseValidationContext) {
  return context.getResult(basis.result_id)?.toolName === "search_policy";
}

/**
 * Applies only current-conversation semantics to model-written knowledge
 * guidance. The stored source and cited evidence remain unchanged.
 */
export function adaptCustomerFacingKnowledgeText(
  value: string,
  context: ResponseValidationContext,
  options: { policy?: boolean; basis?: KnowledgeBasis } = {},
) {
  const policyText = options.policy && options.basis
    ? policyTextForRendering(value, options.basis, context)
    : value;
  const paragraphs = String(policyText ?? "").split(/\n\s*\n/);
  const adapted = paragraphs.flatMap((paragraph) => {
    const lines = paragraph.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const nextLines = lines.map((line) => {
      const sentences = line.split(/(?<=[.!?])\s+/).filter(Boolean);
      return sentences.map((sentence) => {
        const hadSupportContactInstruction = isActiveSupportChannel(context.interactionChannel)
          && /\b(?:contact|email|write\s+to|reach\s+out\s+to|send\s+(?:an\s+)?email\s+to)\b/i.test(sentence);
        const satisfiedSupportContactPrerequisite = isSatisfiedSupportContactPrerequisite(sentence, context);
        let current = satisfiedSupportContactPrerequisite
          ? ""
          : isActiveSupportChannel(context.interactionChannel)
          ? adaptSupportContactInstruction(sentence)
          : sentence;
        const adaptedRequirementList = adaptKnownRequirementList(current, context, hadSupportContactInstruction);
        if (adaptedRequirementList !== undefined) return adaptedRequirementList;
        if (hasKnownOrderReference(context)) {
          current = current.replace(/\b(?:your\s+|the\s+|an?\s+)?order\s+(?:number|no\.?|id|identifier)\b/gi, "");
        }
        if (context.trustedCustomerIdentity?.verified) {
          current = current
            .replace(/\b(?:your\s+|the\s+|an?\s+)?name\s+(?:used\s+(?:at|when)\s+(?:purchase|checkout|ordering))\b/gi, "")
            .replace(/\b(?:your\s+|the\s+|an?\s+)?email(?:\s+address)?\s+(?:used\s+(?:at|when)\s+(?:purchase|checkout|ordering))\b/gi, "");
        }
        return cleanContextualizedKnowledgeSentence(current);
      }).filter(Boolean).join(" ");
    }).filter(Boolean);
    return nextLines.length ? [nextLines.join("\n")] : [];
  });
  const composed = options.policy
    ? composeMinimumSufficientPolicyText(adapted.join("\n\n"), context)
    : adapted.join("\n\n");
  return formatReadableKnowledgeText(composed);
}

type ProcedureStepPresentation = {
  text: string;
  path: string;
  blockId: string;
  sourceIndex: number;
  kind: "heading" | "prerequisite" | "condition" | "note" | "warning" | "instruction" | "expected_result" | "alternative";
  listStyle: "ordered" | "unordered" | null;
};

function normalizeProcedureText(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .replace(/\s+([,.;:!?])/g, "$1");
}

function isPlainProcedureHeading(value: string) {
  const text = value.trim();
  return /[:?]$/.test(text)
    || /^(?:faq|manual|questions|how to|troubleshooting|critical values|steps?|instructions?|procedure)\b/i.test(text);
}

function removeLeadingProcedureHeadings(value: string, sourceIndex: number) {
  if (sourceIndex !== 0) return value;
  const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  while (lines.length > 0 && isPlainProcedureHeading(lines[0])) lines.shift();
  return lines.join("\n");
}

function procedureStepKind(text: string, source: JsonObject | null): ProcedureStepPresentation["kind"] {
  // A source-authored title/section label can be stored by older imports as
  // an instruction. Presentation must still avoid turning that label into an
  // action bullet; the underlying cited value remains unchanged.
  if (/[:?]$/.test(text.trim())) return "heading";
  const declared = String(source?.kind ?? source?.presentation_kind ?? "").toLowerCase();
  if (["heading", "prerequisite", "condition", "note", "warning", "instruction", "expected_result", "alternative"].includes(declared)) return declared as ProcedureStepPresentation["kind"];
  if (/^(?:if|when|unless)\b/i.test(text)) return "condition";
  if (/^(?:please note|note:|important:)\b/i.test(text)) return "note";
  if (/:$/.test(text) && !/^\d+(?:\.\d+)?\s*(?:seconds?|minutes?)\b/i.test(text)) return "heading";
  return "instruction";
}

function procedureStepListStyle(source: JsonObject | null): ProcedureStepPresentation["listStyle"] {
  const declared = String(source?.list_style ?? "").toLowerCase();
  return declared === "ordered" || declared === "unordered" ? declared : null;
}

function procedureStepPresentation(
  value: unknown,
  path: string,
  blockId: string,
  sourceIndex: number,
  source: JsonObject | null,
) {
  const text = removeLeadingProcedureHeadings(normalizeProcedureText(value), sourceIndex);
  return text ? {
    text,
    path,
    blockId,
    sourceIndex,
    kind: procedureStepKind(text, source),
    listStyle: procedureStepListStyle(source),
  } satisfies ProcedureStepPresentation : null;
}

/**
 * Conditions and warnings are source-bound blocks, but rendering one without
 * its adjacent instruction makes the customer-facing answer look truncated.
 * Complete only the local source block boundary; do not merge records or
 * invent any text.
 */
function completeProcedureSteps(
  selectedSteps: ProcedureStepPresentation[],
  allSteps: ProcedureStepPresentation[],
) {
  const available = new Map(allSteps.map((step) => [step.sourceIndex, step]));
  const selected = new Map(selectedSteps.map((step) => [step.sourceIndex, step]));
  for (const step of [...selected.values()]) {
    if (step.kind === "condition") {
      const child = available.get(step.sourceIndex + 1);
      if (child && ["instruction", "expected_result", "alternative", "note"].includes(child.kind)) {
        selected.set(child.sourceIndex, child);
      }
    }
    if (step.kind === "warning" || step.kind === "expected_result") {
      const preceding = available.get(step.sourceIndex - 1);
      if (preceding && preceding.kind === "instruction") selected.set(preceding.sourceIndex, preceding);
    }
  }
  return [...selected.values()]
    .filter((step) => step.kind !== "condition" || selected.has(step.sourceIndex + 1))
    .sort((left, right) => left.sourceIndex - right.sourceIndex);
}

function procedureStepValues(
  segment: Extract<ResponseSegment, { type: "procedure_guidance" }>,
  context: ResponseValidationContext,
) {
  const evidence = resultFor(segment.basis, context);
  if (!evidence) return [];
  const citedResultIndex = segment.basis.field_paths
    .map(resultIndexFromPath)
    .find((value): value is number => value != null);
  if (citedResultIndex == null) return [];
  const availableBlocks = procedureBlocks(evidence.result, citedResultIndex);
  const allSteps = availableBlocks.flatMap((entry) => {
    const step = procedureStepPresentation(
      entry.block.text,
      `structured_data.procedure_steps[${entry.index}]`,
      entry.blockId,
      entry.index,
      entry.block,
    );
    return step ? [step] : [];
  });
  const blocksById = new Map(availableBlocks.map((entry) => [entry.blockId, entry]));
  const selectedSteps = segment.block_ids?.length
    ? segment.block_ids.flatMap((blockId) => {
        const entry = blocksById.get(blockId);
        const step = entry
          ? procedureStepPresentation(
              entry.block.text,
              `structured_data.procedure_steps[${entry.index}]`,
              entry.blockId,
              entry.index,
              entry.block,
            )
          : null;
        return step ? [step] : [];
      })
    : expandedProcedureStepPaths(segment.step_paths ?? [], evidence.result, citedResultIndex).flatMap((path) => {
        const value = procedureStepValue(evidence.result, path, citedResultIndex);
        if (!meaningful(value)) return [];
        const parsed = procedureStepPath(path, citedResultIndex);
        if (!parsed) return [];
        const source = procedureStepObject(evidence.result, path, citedResultIndex);
        const step = procedureStepPresentation(
          value,
          path,
          String(source?.block_id ?? source?.id ?? `block_${parsed.stepIndex + 1}`),
          parsed.stepIndex,
          source,
        );
        return step ? [step] : [];
      });
  return completeProcedureSteps(selectedSteps, allSteps);
}

function normalizedProcedurePhrase(value: unknown) {
  return normalizeProcedureText(value)
    .toLowerCase()
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourceTitleForProcedure(
  segment: Extract<ResponseSegment, { type: "procedure_guidance" }>,
  context: ResponseValidationContext,
) {
  const evidence = resultFor(segment.basis, context);
  const citedResultIndex = segment.basis.field_paths
    .map(resultIndexFromPath)
    .find((value): value is number => value != null);
  const data = objectValue(evidence?.result.data);
  const results = Array.isArray(data?.results) ? data.results : [];
  return objectValue(results[citedResultIndex ?? 0])?.title;
}

function isDuplicateProcedureTitle(step: ProcedureStepPresentation, title: unknown) {
  if (step.sourceIndex !== 0 || step.kind !== "instruction") return false;
  const stepPhrase = normalizedProcedurePhrase(step.text);
  const titlePhrase = normalizedProcedurePhrase(title);
  return Boolean(stepPhrase && titlePhrase && (stepPhrase === titlePhrase || titlePhrase.endsWith(stepPhrase)));
}

function focusedProcedureSteps(steps: ProcedureStepPresentation[], customerMessage?: string) {
  const message = String(customerMessage ?? "");
  if (!/\bhow long\b|\bhow many seconds?\b|\bwhat(?:'s| is) the (?:duration|time)\b/i.test(message)) return steps;
  const candidates = steps.filter((step) =>
    /\b\d+(?:\.\d+)?\s*(?:seconds?|minutes?)\b/i.test(step.text)
    && /\b(?:hold|press|wait|keep)\b/i.test(step.text),
  );
  return candidates.length === 1 ? candidates : steps;
}

function renderProcedureGuidance(
  segment: Extract<ResponseSegment, { type: "procedure_guidance" }>,
  context: ResponseValidationContext,
) {
  const sourceSteps = procedureStepValues(segment, context);
  const title = sourceTitleForProcedure(segment, context);
  const steps = focusedProcedureSteps(sourceSteps, context.customerMessage)
    .filter(step => !(hasKnownOrderReference(context) && /\b(?:order identification|order (?:number|reference|id))\b/i.test(step.text)))
    .filter((step) => !isDuplicateProcedureTitle(step, title) && step.kind !== "heading");
  if (!steps.length) return "";
  if (steps.length === 1 && steps[0].kind === "instruction") return sentence(steps[0].text);
  const locale = localeFor(context);
  const heading = locale === "da" ? "Her er de relevante trin:" : "Here are the relevant steps:";
  const useOrderedList = steps.some((step) => step.listStyle === "ordered")
    && steps.every((step) => step.listStyle !== "unordered");
  let ordinal = 0;
  const list = steps.map((step) => {
    if (step.kind !== "instruction") return step.text;
    ordinal += 1;
    return `${useOrderedList ? `${ordinal}.` : "-"} ${step.text}`;
  }).join("\n");
  return `${heading}\n${list}`;
}

function renderLimitation(
  segment: Extract<ResponseSegment, { type: "limitation" }>,
  context: ResponseValidationContext,
  options: { includeVerifiedTrackingSource?: boolean } = {},
) {
  const evidence = resultFor(segment.basis, context);
  const locale = localeFor(context);
  const status = effectiveResultStatus(evidence);
  if (evidence?.toolName === "get_product_availability") {
    if (status === "not_found") {
      return locale === "da"
        ? "Jeg kunne ikke finde et matchende produkt eller en variant i butikkens katalog. Hvis du har et SKU eller et produktlink, må du gerne sende det, så kan jeg tjekke det i stedet."
        : "I couldn’t find a matching product or variant in the store catalog. If you have a SKU or product link, send it and I can check that instead.";
    }
    if (status === "invalid_request") {
      return locale === "da" ? "Hvilken variant vil du gerne have, at jeg tjekker?" : "Which variant would you like me to check?";
    }
    if (["unavailable", "error", "unknown"].includes(status ?? "")) {
      if (status === "unknown") {
        const query = resultFieldValue(evidence.result, "data.query").value;
        return meaningful(query)
          ? locale === "da" ? "Jeg kunne ikke bekræfte den aktuelle lagerstatus for dette produkt." : "I couldn’t verify the current availability for this product."
          : locale === "da" ? "Jeg kunne ikke bekræfte den aktuelle lagerstatus, fordi opslaget ikke indeholdt et bestemt produkt eller en variant." : "I couldn’t verify the current availability because the lookup did not include a specific product or variant.";
      }
      return locale === "da" ? "Jeg kan ikke tjekke den aktuelle lagerstatus lige nu." : "I can’t check the current availability right now.";
    }
  }
  if (evidence?.toolName === "get_product" && ["not_found", "unavailable", "error", "unknown"].includes(status ?? "")) {
    return locale === "da"
      ? status === "not_found"
        ? "Jeg kunne ikke bekræfte et aktuelt produkt i butikkens katalog."
        : "Jeg kan ikke bekræfte produktet i butikkens katalog lige nu."
      : status === "not_found"
        ? "I couldn’t verify a current product record in the store catalog."
        : "I can’t verify this product in the store catalog right now.";
  }
  if (evidence?.toolName === "get_tracking") {
    const source = options.includeVerifiedTrackingSource ? renderVerifiedTrackingSource(evidence, locale) : "";
    const limitation = evidence.result.status === "not_found"
      ? locale === "da"
        ? "Jeg kunne ikke finde en live trackingopdatering på pakken."
        : "I couldn’t find a live tracking update for this shipment."
      : ["unavailable", "error"].includes(evidence.result.status)
        ? locale === "da"
          ? "Jeg kan ikke hente en live trackingopdatering på pakken lige nu."
          : "I can’t retrieve a live tracking update for this shipment right now."
        : null;
    if (limitation) return [source, limitation].filter(Boolean).join("\n\n");
  }
  if (evidence?.toolName === "get_order" && evidence.result.status === "not_found") {
    const orderId = resultFieldValue(evidence.result, "data.order_id").value
      ?? resultFieldValue(evidence.result, "data.order_focus.requested_order_id").value;
    const reference = meaningful(orderId) ? ` #${String(orderId).replace(/^#/, "")}` : "";
    return locale === "da"
      ? `Jeg kunne ikke finde en ordre med nummer${reference}.`
      : `I couldn’t find an order with number${reference}.`;
  }
  if (evidence?.result.status === "not_found") {
    const messages: Record<string, Record<ResponseLocale, string>> = {
      search_policy: {
        en: "I couldn’t verify that policy detail from our current policy information.",
        da: "Jeg kunne ikke bekræfte den politikoplysning ud fra vores aktuelle politikoplysninger.",
      },
      search_product_knowledge: {
        en: "I couldn’t verify that product detail from our current product information.",
        da: "Jeg kunne ikke bekræfte den produktoplysning ud fra vores aktuelle produktinformation.",
      },
      search_procedures: {
        en: "I couldn’t verify a support procedure for this issue from our current guidance.",
        da: "Jeg kunne ikke bekræfte en supportprocedure for dette problem ud fra vores aktuelle vejledning.",
      },
      get_brand_guidance: {
        en: "I couldn’t verify any additional guidance for this request.",
        da: "Jeg kunne ikke bekræfte yderligere vejledning til denne henvendelse.",
      },
    };
    const message = messages[evidence.toolName]?.[locale];
    if (message) return message;
  }
  return renderTextSegment(segment.text);
}

function renderAcknowledgement(kind: Extract<ResponseSegment, { type: "acknowledgement" }>["kind"], context: ResponseValidationContext) {
  const locale = localeFor(context);
  const copy = {
    en: {
      resolution: "Glad to hear that’s sorted.",
      thanks: "You’re welcome.",
      correction: "Thanks for clarifying.",
      closure: "Understood.",
      transition: "Got it.",
    },
    da: {
      resolution: "Godt at høre, at det er løst.",
      thanks: "Det var så lidt.",
      correction: "Tak for afklaringen.",
      closure: "Det er noteret.",
      transition: "Det er noteret.",
    },
  } as const;
  return copy[locale][kind];
}

function sameArguments(left: string[], right: string[]) {
  return left.length === right.length && left.every((argument, index) => argument === right[index]);
}

function limitedResultQuestionIsRedundant(
  segment: Extract<ResponseSegment, { type: "question" }>,
  limitations: Array<{ segment: Extract<ResponseSegment, { type: "limitation" }>; evidence: ResponseEvidenceRecord | undefined }>,
) {
  return limitations.some(({ evidence }) => {
    if (!evidence) return false;
    const status = effectiveResultStatus(evidence);
    if (evidence.toolName === "get_tracking" && ["not_found", "unavailable", "error"].includes(status)) {
      if (status === "not_found") return segment.purpose === "enable_capability" && segment.capability === "get_tracking";
      return segment.purpose === "enable_capability" && segment.capability === "get_tracking"
        || segment.purpose === "pure_clarification";
    }
    if (evidence.toolName === "get_product_availability" && ["not_found", "unavailable", "error", "unknown"].includes(status ?? "")) {
      if (status === "unknown") {
        const query = resultFieldValue(evidence.result, "data.query").value;
        return meaningful(query) && segment.purpose === "enable_capability" && segment.capability === "get_product_availability";
      }
      return segment.purpose === "enable_capability" && segment.capability === "get_product_availability"
        || segment.purpose === "pure_clarification";
    }
    if (evidence.toolName === "get_product" && ["unavailable", "error"].includes(status)) {
      return segment.purpose === "enable_capability" && segment.capability === "get_product";
    }
    return false;
  });
}

function isExplicitOrderReference(value?: string) {
  return /(?:#\s*\d+|\border\s*(?:number|no\.?|id|identifier)?\s*[:#]?\s*\d+)/i.test(String(value ?? ""));
}

function isRedundantPolicyQuestion(
  segment: Extract<ResponseSegment, { type: "question" }>,
  focus: CustomerKnowledgeFocus,
  hasPolicyGuidance: boolean,
  context: ResponseValidationContext,
) {
  return hasPolicyGuidance
    && ["timing", "destination", "cost", "eligibility"].includes(focus.questionShape)
    && !isExplicitOrderReference(context.customerMessage)
    && segment.purpose === "enable_capability"
    && segment.capability === "get_order"
    && segment.missing_arguments.includes("order_id");
}

/** Renders only segments accepted by the deterministic validator, then composes related facts. */
export function renderResponseSegments(segments: ResponseSegment[], context: ResponseValidationContext): string {
  const hasOperationalTracking = context.operationalScope && segments.some(segment => segment.type === "fact" && segment.evidence.some(basis => resultFor(basis, context)?.toolName === "get_tracking"));
  const actionableComposition = hasOperationalTracking || segments.some(segment => segment.type === "facet_limit" || segment.type === "evidence_limitation" || segment.type === "source_content" || segment.type === "source_comparison" || segment.type === "fact" && ["order_amount", "line_fulfillment"].includes(segment.fact_kind)) ? null : composeActionableResponse(segments, context);
  if (actionableComposition) return normalizeMerchantPolicyAttribution(actionableComposition);

  const rendered: string[] = [];
  const consumed = new Set<number>();
  const policyFocus = customerKnowledgeFocus(context.customerMessage);
  const hasPolicyGuidance = segments.some((segment) => segment.type === "knowledge_guidance" && isPolicyKnowledgeBasis(segment.basis, context));
  const hasOrderRecoveryQuestion = context.activeOrder?.state === "unresolved"
    && segments.some((segment) => segment.type === "question"
      && segment.purpose === "enable_capability"
      && segment.capability === "get_order"
      && segment.missing_arguments.includes("order_id"));
  const factSegments = segments.filter((segment): segment is Extract<ResponseSegment, { type: "fact" }> => segment.type === "fact");
  const orderFacts = factSegments.filter((segment) => ORDER_FACT_KINDS.has(segment.fact_kind));
  const shipmentFacts = factSegments.filter((segment) => SHIPMENT_FACT_KINDS.has(segment.fact_kind));
  const limitations = segments
    .filter((segment): segment is Extract<ResponseSegment, { type: "limitation" }> => segment.type === "limitation")
    .map((segment) => ({ segment, evidence: resultFor(segment.basis, context) }));
  const hasLimitedResult = limitations.some(({ evidence }) => ["not_found", "unavailable", "error", "unknown"].includes(effectiveResultStatus(evidence) ?? ""));

  // A limited result should follow verified facts, even when the model placed
  // its limitation segment before those facts in the structured response.
  if (hasLimitedResult) {
    if (orderFacts.length) {
      rendered.push(renderOrderFacts(orderFacts, context));
      segments.forEach((candidate, candidateIndex) => {
        if (candidate.type === "fact" && ORDER_FACT_KINDS.has(candidate.fact_kind)) consumed.add(candidateIndex);
      });
    }
    if (shipmentFacts.length) {
      rendered.push(renderShipmentBundle(shipmentFacts, context));
      segments.forEach((candidate, candidateIndex) => {
        if (candidate.type === "fact" && SHIPMENT_FACT_KINDS.has(candidate.fact_kind)) consumed.add(candidateIndex);
      });
    }
    factSegments
      .filter((segment) => PRODUCT_AVAILABILITY_FACT_KINDS.has(segment.fact_kind))
      .forEach((segment) => {
        rendered.push(renderSingleFact(segment, context));
        const segmentIndex = segments.indexOf(segment);
        if (segmentIndex >= 0) consumed.add(segmentIndex);
      });
  }

  segments.forEach((segment, index) => {
    if (consumed.has(index)) return;
    if (segment.type === "fact" && ORDER_FACT_KINDS.has(segment.fact_kind)) {
      rendered.push(renderOrderFacts(orderFacts, context));
      segments.forEach((candidate, candidateIndex) => {
        if (candidate.type === "fact" && ORDER_FACT_KINDS.has(candidate.fact_kind)) consumed.add(candidateIndex);
      });
      return;
    }
    if (segment.type === "fact" && SHIPMENT_FACT_KINDS.has(segment.fact_kind)) {
      rendered.push(renderShipmentBundle(shipmentFacts, context));
      segments.forEach((candidate, candidateIndex) => {
        if (candidate.type === "fact" && SHIPMENT_FACT_KINDS.has(candidate.fact_kind)) consumed.add(candidateIndex);
      });
      return;
    }
    if (segment.type === "fact" && PRODUCT_AVAILABILITY_FACT_KINDS.has(segment.fact_kind)) {
      rendered.push(renderSingleFact(segment, context));
      consumed.add(index);
      return;
    }
    if (segment.type === "evidence_limitation") rendered.push(renderEvidenceLimitation(segment, context));
    else if (segment.type === "facet_limit") rendered.push(renderFacetLimit(segment, context));
    else if (segment.type === "source_content") rendered.push(sourceSections(segment.basis, context).map(section => {
      const requests = preciseRequests(context);
      const request = requests.find(request => sourceMatchesRequest(section.record, request, context));
      const subject = request && verifiedAnswerSubject(context, request);
      const prefix = subject && new Set(requests.map(request => request.subject).filter(Boolean)).size > 1 ? `${subject.title}: ` : "";
      return prefix + normalizeMerchantPolicyAttribution(section.text);
    }).join("\n\n"));
    else if (segment.type === "source_comparison") {
      const comparison = shippingComparison(segment, context);
      if (comparison) rendered.push(localeFor(context) === "da"
        ? `Den verificerede ordretotal på ${comparison.amount} ${comparison.currency} er ${comparison.amount > comparison.threshold || !comparison.above && comparison.amount === comparison.threshold ? "over eller på" : "under"} grænsen på ${comparison.threshold} ${comparison.currency}. Det bekræfter ikke den faktisk opkrævede fragt eller rabatkoden; de oplysninger er ikke tilgængelige i ordreopslaget.`
        : `The verified order total of ${comparison.amount} ${comparison.currency} is ${comparison.amount > comparison.threshold || !comparison.above && comparison.amount === comparison.threshold ? "at or above" : "below"} the ${comparison.threshold} ${comparison.currency} threshold. This does not confirm the shipping actually charged or coupon treatment; those fields are unavailable in the order lookup.`);
    }
    else if (segment.type === "fact") rendered.push(renderSingleFact(segment, context));
    else if (segment.type === "procedure_guidance") rendered.push(renderProcedureGuidance(segment, context));
    else if (segment.type === "knowledge_guidance") rendered.push(adaptCustomerFacingKnowledgeText(
      segment.text,
      context,
      { policy: isPolicyKnowledgeBasis(segment.basis, context), basis: segment.basis },
    ));
    else if (segment.type === "operational_result") rendered.push(operationalReply((resultFor(segment.basis, context)!.result.data as JsonObject).operation as unknown as OperationalOutcome, context.locale ?? inferResponseLocale(context.customerMessage ?? "")));
    else if (segment.type === "action_offer") rendered.push(renderActionOffer(segment, context));
    else if (segment.type === "acknowledgement") rendered.push(renderAcknowledgement(segment.kind, context));
    else if (segment.type === "question" && isRedundantPolicyQuestion(segment, policyFocus, hasPolicyGuidance, context)) {
      consumed.add(index);
    }
    else if (segment.type === "question" && limitedResultQuestionIsRedundant(segment, limitations)) {
      consumed.add(index);
    }
    else if (segment.type === "question" && isOrderCandidateClarification(segment, context)) {
      rendered.push(renderOrderCandidateClarificationFromResults(context.getResults, localeFor(context)) ?? "");
    }
    else if (segment.type === "question" && segment.purpose === "disambiguate_variant") {
      rendered.push(renderGroundedQuestion(segment, context));
    }
    else if (segment.type === "question" && ["enable_capability", "resolve_required_argument"].includes(segment.purpose)) {
      const repeatedByAction = segments.some((candidate) => candidate.type === "action_offer"
        && candidate.capability === segment.capability
        && sameArguments(candidate.missing_arguments, segment.missing_arguments));
      if (!repeatedByAction) rendered.push(renderCapabilityQuestion(segment, context));
    }
    else if (segment.type === "limitation") {
      const evidence = resultFor(segment.basis, context);
      if (!(hasOrderRecoveryQuestion && evidence?.toolName === "get_order" && evidence.result.status === "not_found")) {
        rendered.push(renderLimitation(segment, context, { includeVerifiedTrackingSource: shipmentFacts.length === 0 }));
      }
    }
    else rendered.push(renderTextSegment(segment.text));
  });
  const response = [...new Set(rendered.filter(Boolean))].join("\n\n");
  const hasSubstantiveSegment = segments.some((segment) => segment.type !== "acknowledgement");
  const greeting = hasSubstantiveSegment ? greetingFor(context) : null;
  return normalizeMerchantPolicyAttribution(greeting && response ? `${greeting}\n\n${response}` : response);
}

/** Preserve exact selected material policy text through the ordinary claim contract. */
export function preserveMaterialPolicyEvidence(validation: ResponseValidationResult, context: ResponseValidationContext): ResponseValidationResult {
  const approved = [...validation.approvedSegments];
  const diagnostics = [...validation.issues];
  const rejected = [...validation.rejectedSegments];
  for (const record of context.getResults?.() ?? []) {
    if (record.toolName !== "search_policy" || record.result.status !== "ok") continue;
    const data = record.result.data as any;
    const incompleteIndex = (data?.results ?? []).findIndex((item: any) => item.structured_data?.policy_coverage?.some((coverage: any) => coverage.omitted?.length));
    if (incompleteIndex >= 0) {
      const bounded = validateStructuredResponse({ segments: [{ type: "limitation",
        text: "Some material policy conditions are unavailable in the selected evidence, so I cannot confirm an unconditional policy outcome.",
        basis: { result_id: record.resultId, field_paths: [`data.results.${incompleteIndex}.structured_data.policy_coverage`] } }] }, context);
      approved.push(...bounded.approvedSegments);
      rejected.push(...bounded.rejectedSegments);
      diagnostics.push(...bounded.issues);
    }
    for (let index = 0; index < (data?.results ?? []).length; index++) {
      const item = data.results[index];
      // Procedures retain their existing source-bound step contract.
      if (item.knowledge_type === "procedural" || !item.structured_data?.policy_coverage?.length) continue;
      for (let sectionIndex = 0; sectionIndex < (item.evidence_sections ?? []).length; sectionIndex++) {
        const text = item.evidence_sections[sectionIndex].content?.trim();
        if (!text || approved.some(segment => segment.type === "knowledge_guidance" && segment.text.toLowerCase().includes(text.toLowerCase()))) continue;
        const addition = validateStructuredResponse({ segments: [{ type: "knowledge_guidance", text,
          basis: { result_id: record.resultId, field_paths: [`results.${index}.evidence_sections.${sectionIndex}.content`] } }] }, context);
        approved.push(...addition.approvedSegments);
        rejected.push(...addition.rejectedSegments);
        diagnostics.push(...addition.issues);
      }
    }
  }
  return { ...validation, approvedSegments: approved, rejectedSegments: rejected, issues: diagnostics };
}

function validateMaterialPolicyValues(segment: Extract<ResponseSegment, { type: "knowledge_guidance" }>, context: ResponseValidationContext, index: number): ResponseValidationIssue[] {
  const evidence = resultFor(segment.basis, context);
  if (evidence?.toolName !== "search_policy") return [];
  const data = evidence.result.data as any;
  const records = citedKnowledgeRecords(data?.results ?? [], segment.basis.field_paths) as any[];
  if (!records.some(record => record.structured_data?.policy_coverage?.length)) return [];
  const source = records.flatMap(record => (record.evidence_sections ?? []).map((section: any) => section.content)).join("\n");
  if (records.some(record => record.structured_data?.policy_coverage?.some((coverage: any) => coverage.omitted?.length))
    && !source.toLowerCase().includes(segment.text.trim().toLowerCase())) {
    return [{ index, code: "material_policy_evidence_incomplete", message: "Incomplete material coverage cannot support an unconditional policy conclusion." }];
  }
  const attribution = segment.text.match(/(?:under|according to|ifølge)\s+([\p{L}][\p{L}\s-]{0,60}?)['’]s\s+(?:standard\s+)?(?:returns?|shipping|delivery)\s+policy/iu)?.[1];
  if (attribution && !/^(?:the )?(?:store|merchant|shop)$/i.test(attribution)
    && !records.some(record => JSON.stringify(record).toLowerCase().includes(attribution.toLowerCase()))) {
    return [{ index, code: "unsupported_policy_attribution", message: "Policy attribution must come from the cited merchant evidence." }];
  }
  const numbers = new Set(source.match(/\d+(?:[.,]\d+)?/g) ?? []);
  if ((segment.text.match(/\d+(?:[.,]\d+)?/g) ?? []).some(number => !numbers.has(number))) {
    return [{ index, code: "unsupported_material_policy_value", message: "Material policy values must be supported by the selected applicable source evidence." }];
  }
  return [];
}

/** Current-run evidence only. Scope is inherited from the scoped registry;
 * any explicit conflicting scope or expired provenance fails closed. */
export function normalizedEvidenceKind(evidence: ResponseEvidenceRecord): string {
  const data = objectValue(evidence.result.data);
  if (Array.isArray(data?.results)) {
    const kinds = new Set(data.results.map(value => String(objectValue(objectValue(value)?.structured_data)?.semantic_type ?? objectValue(value)?.knowledge_type ?? "").toLowerCase()));
    return kinds.size === 1 ? [...kinds][0] : "mixed_knowledge";
  }
  if (Array.isArray(data?.items) && Array.isArray(data?.fulfillments)) return "order_state";
  if (Array.isArray(data?.fulfillments)) return "fulfillment_mapping";
  if (data?.live_tracking) return "live_tracking";
  return "operational_result";
}

function evidenceScopeIssues(evidence: ResponseEvidenceRecord, context: ResponseValidationContext, index: number): ResponseValidationIssue[] {
  const scope = context.evidenceScope ?? context.operationalScope;
  const data = objectValue(evidence.result.data);
  if (context.caseState && scope && (context.caseState.scope.workspaceId !== scope.workspaceId
    || context.caseState.scope.shopId !== scope.shopId)) {
    return [{ index, code: "case_scope_mismatch", message: "CaseState is not scoped to the current evidence boundary." }];
  }
  const records = Array.isArray(data?.results) ? data.results.map(objectValue) : [data];
  for (const record of records) {
    const provenance = objectValue(record?.provenance);
    for (const candidate of [data, record, provenance, objectValue(record?.scope)]) {
      if (!candidate) continue;
      const workspace = candidate.workspaceId ?? candidate.workspace_id;
      const shop = candidate.shopId ?? candidate.shop_id;
      if (scope && ((workspace && workspace !== scope.workspaceId)
        || (shop && shop !== scope.shopId))) {
        return [{ index, code: "evidence_scope_mismatch", message: "The evidence belongs to a different tenant scope." }];
      }
    }
    if (provenance?.expires_at && (!Number.isFinite(Date.parse(String(provenance.expires_at)))
      || Date.parse(String(provenance.expires_at)) <= Date.now())) {
      return [{ index, code: "evidence_expired", message: "The cited source provenance has expired." }];
    }
  }
  return [];
}

function semanticProcedureSource(evidence: ResponseEvidenceRecord | undefined): boolean {
  if (!evidence || evidence.result.status !== "ok") return false;
  const data = objectValue(evidence.result.data);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.some(value => {
    const record = objectValue(value);
    const structured = objectValue(record?.structured_data);
    // Keep the legacy procedural contract; new transports must carry verified
    // semantic provenance, not merely name themselves a procedure tool.
    return record?.knowledge_type === "procedural"
      && ["authoritative", "operational"].includes(String(record.authority))
      && (evidence.toolName === "search_procedures" || (structured?.semantic_type === "PROCEDURE"
        && meaningful(objectValue(record.provenance)?.source_id)
        && data?.task_specificity === "sufficient" && data.procedure_evidence_quality === "usable"));
  });
}

function sourceSections(basis: KnowledgeBasis, context: ResponseValidationContext) {
  const evidence = resultFor(basis, context);
  const results = objectValue(evidence?.result.data)?.results;
  if (!Array.isArray(results)) return [];
  return basis.field_paths.flatMap(path => {
    const match = normalizedDataPath(path).match(/^results\[(\d+)\]\.evidence_sections\[(\d+)\]\.(content|text)$/);
    if (!match) return [];
    const record = objectValue(results[Number(match[1])]);
    const sections = record?.evidence_sections;
    const section = Array.isArray(sections) ? objectValue(sections[Number(match[2])]) : null;
    const text = section?.[match[3]];
    return record && typeof text === "string" && text.trim() ? [{ record, text, path }] : [];
  });
}

function productScopeSupported(record: JsonObject, context: ResponseValidationContext): boolean {
  const structured = objectValue(record.structured_data);
  const applicability = objectValue(structured?.applicability);
  const ids = Array.isArray(applicability?.product_ids) ? applicability.product_ids.map(String) : [];
  if (!ids.length) return false;
  const currentRecords = (context.getResults?.() ?? []).flatMap(evidence => {
    const data = objectValue(evidence.result.data);
    return Array.isArray(data?.results) ? data.results.map(objectValue).filter((r): r is JsonObject => Boolean(r?.knowledge_type === "product")) : [];
  });
  const question = normalizedPhrase([context.customerMessage, context.customerProvidedContext?.product].filter(Boolean).join(" "));
  const matched = currentRecords.filter(candidate => {
    const subject = careSubject(candidate);
    const tokens = subject.split(" ").filter(token => token.length > 2 && !["guide", "care", "textile", "support", "instructions", "product"].includes(token));
    return tokens.length > 0 && question.split(" ").includes(tokens[0]);
  });
  const verifiedSubjects = preciseRequests(context).map(request => verifiedAnswerSubject(context, request)).filter(subject => subject !== null);
  const verified = verifiedAnswerSubject(context);
  const identityReadsAttempted = preciseRequests(context).some(request => context.preciseReadResults?.[request.id]?.some(id => context.getResult(id)?.toolName === "get_product"));
  if (verifiedSubjects.length || identityReadsAttempted) return ids.length === 1 && verifiedSubjects.some(subject => subject.id === ids[0]);
  if (verified) return ids.length === 1 && ids[0] === verified.id;
  const expectedIds = new Set(matched.flatMap(candidate => {
    const applies = objectValue(objectValue(candidate.structured_data)?.applicability);
    return Array.isArray(applies?.product_ids) ? applies.product_ids.map(String) : [];
  }));
  // Ambiguous product references are not repaired by choosing the first source.
  return expectedIds.size === 1 && ids.length === 1 && expectedIds.has(ids[0]);
}

function validateSourceContent(segment: Extract<ResponseSegment, { type: "source_content" }>, context: ResponseValidationContext, index: number) {
  const issues = validateKnowledgeBasis(segment.basis, context, index);
  if (issues.length) return issues;
  const sections = sourceSections(segment.basis, context);
  if (!sections.length || sections.length !== segment.basis.field_paths.length) {
    return [{ index, code: "source_content_path_required", message: "Source content must bind exact returned section text fields." }];
  }
  for (const { record, path } of sections) {
    const sectionMatch = normalizedDataPath(path).match(/evidence_sections\[(\d+)\]/);
    const section = sectionMatch && Array.isArray(record.evidence_sections) ? objectValue(record.evidence_sections[Number(sectionMatch[1])]) : null;
    if (/\b(?:internal instructions|agent instructions)\b/i.test(`${record.title ?? ""} ${section?.heading ?? ""}`) || internalAnswerInstruction(String(section?.content ?? section?.text ?? ""))) {
      return [{ index, code: "non_answer_source_role", message: "Internal evidence boundaries cannot substitute for customer answer facts." }];
    }
    const structured = objectValue(record.structured_data);
    const provenance = objectValue(record.provenance);
    if (!meaningful(provenance?.source_id) || !meaningful(structured?.semantic_type)) {
      return [{ index, code: "source_provenance_required", message: "Typed content requires verified semantic source provenance." }];
    }
    if (segment.kind === "policy_condition") {
      if (objectValue(structured?.applicability)?.kind === "products" && !productScopeSupported(record, context)) {
        return [{ index, code: "policy_product_scope_mismatch", message: "The policy condition does not apply to the current product." }];
      }
      if (record.knowledge_type !== "policy" || !["authoritative", "operational"].includes(String(record.authority))) {
        return [{ index, code: "policy_source_required", message: "A policy condition requires a verified policy source." }];
      }
    } else {
      if (record.knowledge_type !== "product" || !productScopeSupported(record, context)) {
        return [{ index, code: "product_scope_mismatch", message: "The cited content is not bound to the current product." }];
      }
      if (segment.kind === "product_constraint" && (!segment.facet || !["GUIDANCE", "FACT"].includes(String(structured?.semantic_type)) || !sourceDomainSupportsFacet(String(structured?.support_domain), segment.facet) || !sourceSupportsFacet(String(section?.content ?? section?.text ?? ""), segment.facet))) {
        return [{ index, code: "answer_facet_source_mismatch", message: "The source does not establish the requested facet." }];
      }
      if (segment.kind === "product_constraint" && preciseRequests(context).length && !preciseRequests(context).some(request => request.facet === segment.facet && sourceMatchesRequest(record, request, context))) {
        return [{ index, code: "answer_facet_scope_unverified", message: "The source does not bind a requested facet for this subject." }];
      }
      if (segment.kind === "product_property" && structured?.semantic_type !== "FACT") {
        return [{ index, code: "product_property_kind_mismatch", message: "A static product property requires a source-authored fact." }];
      }
      if (segment.kind === "care_constraint" && !(structured?.semantic_type === "GUIDANCE" && ["care", "product"].includes(String(structured.support_domain))
        || structured?.semantic_type === "FACT" && structured.support_domain === "care")) {
        return [{ index, code: "care_source_required", message: "A care constraint requires verified product guidance." }];
      }
    }
  }
  return [];
}

function verifiedOrderSource(evidence: ResponseEvidenceRecord | undefined, context: ResponseValidationContext): boolean {
  const data = objectValue(evidence?.result.data);
  if (!evidence || evidence.result.status !== "ok" || !meaningful(data?.id)
    || !Array.isArray(data?.items) || !Array.isArray(data?.fulfillments)) return false;
  const active = context.activeOrder ?? context.getActiveOrderFocus?.();
  const activeId = active?.state === "verified" ? active.order?.id : null;
  const focus = objectValue(data.order_focus);
  return !evidenceScopeIssues(evidence, context, -1).length && (activeId
    ? String(data.id) === String(activeId)
    : focus?.state === "verified" && String(focus.verified_order_id) === String(data.id));
}

function lineDisposition(basis: KnowledgeBasis, context: ResponseValidationContext) {
  const evidence = resultFor(basis, context);
  if (!verifiedOrderSource(evidence, context)) return null;
  const data = objectValue(evidence!.result.data)!;
  const path = basis.field_paths.length === 1 ? normalizedDataPath(basis.field_paths[0]) : "";
  return lineDispositionFromOrder(data, path);
}

function lineDispositionFromOrder(data: JsonObject, path: string) {
  const match = path.match(/^items\[(\d+)\]$/);
  if (!match) return null;
  const items = data.items as unknown[];
  if (new Set(items.map(value => String(objectValue(value)?.id ?? ""))).size !== items.length) return null;
  const item = objectValue(items[Number(match[1])]);
  const quantity = Number(item?.quantity);
  const fulfillments = data.fulfillments as unknown[];
  if (!meaningful(item?.id) || !meaningful(item?.title) || !Number.isInteger(quantity) || quantity <= 0) return null;
  let fulfilled = 0;
  const ids = new Set<string>();
  for (const value of fulfillments) {
    const fulfillment = objectValue(value);
    if (!meaningful(fulfillment?.id) || ids.has(String(fulfillment.id)) || fulfillment?.itemMappingStatus !== "verified"
      || !Array.isArray(fulfillment.items) || fulfillment.status !== "success") return null;
    ids.add(String(fulfillment.id));
    for (const entry of fulfillment.items) {
      const mapped = objectValue(entry);
      const original = items.map(objectValue).find(candidate => String(candidate?.id) === String(mapped?.orderLineItemId));
      const count = Number(mapped?.quantity);
      if (!original || !Number.isInteger(count) || count <= 0 || count > Number(original.quantity)
        || mapped?.title !== original.title || (mapped?.variantId && original.variantId && String(mapped.variantId) !== String(original.variantId))) return null;
      if (String(mapped?.orderLineItemId) === String(item.id)) fulfilled += count;
    }
  }
  if (fulfilled > quantity) return null;
  // An absence is informative only in a complete current order snapshot.
  return { title: String(item.title), quantity, fulfilled, remaining: quantity - fulfilled };
}

function shippingComparison(segment: Extract<ResponseSegment, { type: "source_comparison" }>, context: ResponseValidationContext) {
  const order = resultFor(segment.order, context);
  if (!verifiedOrderSource(order, context) || segment.order.field_paths.length !== 2
    || !["total", "currency"].every(path => segment.order.field_paths.map(normalizedDataPath).includes(path))) return null;
  const data = objectValue(order!.result.data)!;
  const amount = Number(data.total), currency = String(data.currency ?? "");
  if (!meaningful(data.total) || !Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100)) || !/^[A-Z]{3}$/.test(currency)) return null;
  const source = sourceSections(segment.policy, context);
  if (source.length !== 1 || validateKnowledgeBasis(segment.policy, context, -1).length) return null;
  const record = source[0].record;
  const structured = objectValue(record.structured_data);
  const coverage = Array.isArray(structured?.policy_coverage) ? structured.policy_coverage : [];
  const country = String(objectValue(data.shippingAddress)?.countryCode ?? "");
  if (!country || record.knowledge_type !== "policy" || record.authority !== "authoritative"
    || structured?.semantic_type !== "POLICY" || !meaningful(objectValue(record.provenance)?.source_id)
    || !coverage.some(value => { const c = objectValue(value); return c?.domain === "shipping" && c.destination === country
      && Array.isArray(c.available) && c.available.includes("threshold"); })) return null;
  // Only a source-authored monetary threshold is comparable. No coupon,
  // charged-shipping or subtotal inference is permitted.
  const matches = [...source[0].text.matchAll(/(?:free shipping|fri fragt)[^.!?\n]{0,100}?(?:over|above|at least|from|minimum|fra|mindst)\s*(\d+(?:[.,]\d+)?)\s*([A-Z]{3})/gi)];
  if (matches.length !== 1 || matches[0][2].toUpperCase() !== currency) return null;
  return { amount, currency, threshold: Number(matches[0][1].replace(",", ".")), above: /\b(?:over|above)\b/i.test(matches[0][0]), country };
}

export interface AnswerObligation {
  id: string;
  kind: string;
  status: "supported" | "unavailable" | "unknown" | "missing";
  facet?: CoveredAnswerFacet;
  subjectIds?: string[];
  rendered?: boolean;
  satisfied: boolean;
  resultIds: string[];
  sourceIds: string[];
  recovery: "not_needed" | "recovered" | "rejected" | "unavailable";
  rejectionCodes: string[];
}
export interface AnswerCoverage {
  requested: string[];
  supported: string[];
  satisfied: string[];
  missing: string[];
  unknown: string[];
  obligations: AnswerObligation[];
}

/** Coverage is validation metadata over the existing segments, not an answer
 * plan or an authorization layer. Only validator-approved projections recover. */
function preserveRequiredAnswers(validation: ResponseValidationResult, context: ResponseValidationContext): ResponseValidationResult {
  const records = (context.getResults?.() ?? []).filter(record => record.result.status === "ok" && !evidenceScopeIssues(record, context, -1).length);
  const requests = new Set(context.turnIR?.answerRequests?.filter(request => !request.facets?.length && request.propertyKey !== "composition").map(request => request.kind) ?? []);
  // Existing callers without TurnIR use the existing care-request semantics.
  if (!preciseRequests(context).length && (productCareRequest(context)
    || validation.approvedSegments.some(segment => segment.type === "source_content" && segment.kind === "care_constraint"))) requests.add("product_care");
  if (!context.turnIR?.answerRequests && records.some(evidence => {
    const results = objectValue(evidence.result.data)?.results;
    return Array.isArray(results) && results.some(value => { const record = objectValue(value);
      const structured = objectValue(record?.structured_data);
      return record && structured?.semantic_type === "FACT" && structured.support_domain === "product" && productScopeSupported(record, context); });
  })) requests.add("product_property");
  const approved = [...validation.approvedSegments];
  const obligations: AnswerObligation[] = [];
  const add = (id: string, kind: string, candidates: ResponseSegment[]) => {
    if (obligations.some(obligation => obligation.id === id)) return;
    const checkedResults = candidates.map(candidate => validateStructuredResponse({ segments: [candidate] }, context));
    const checked = checkedResults.flatMap(result => result.approvedSegments);
    const rejectionCodes = [...new Set(checkedResults.flatMap(result => result.issues.map(issue => issue.code)))];
    const satisfied = checked.length > 0 && checked.every(segment => approved.some(existing => segmentCovers(existing, segment, context)));
    const bases = checked.flatMap(segment => segment.type === "fact" ? segment.evidence
      : segment.type === "source_comparison" ? [segment.order, segment.policy]
      : "basis" in segment && segment.basis ? [segment.basis] : []);
    const resultIds = [...new Set(bases.map(basis => basis.result_id))];
    const sourceIds = [...new Set(bases.flatMap(basis => {
      const results = objectValue(resultFor(basis, context)?.result.data)?.results;
      const paths = basis.field_paths.map(path => normalizedDataPath(path) === "results" ? "results" : path);
      return Array.isArray(results) ? citedKnowledgeRecords(results, paths).map(value => String(objectValue(objectValue(value)?.provenance)?.source_id ?? "")).filter(Boolean) : [];
    }))];
    obligations.push({ id, kind, status: checked.length ? "supported" : "unavailable", satisfied: checked.length > 0,
      resultIds, sourceIds, rejectionCodes, recovery: satisfied ? "not_needed" : checked.length ? "recovered" : candidates.length ? "rejected" : "unavailable" });
    for (const segment of checked) {
      if (approved.some(existing => segmentCovers(existing, segment, context))) continue;
      // A validated full source projection replaces its partial projection.
      // Keep one canonical segment instead of rendering both copies.
      for (let i = approved.length - 1; i >= 0; i -= 1) if (segmentCovers(segment, approved[i], context)) approved.splice(i, 1);
      approved.push(segment);
    }
  };
  const order = records.find(record => verifiedOrderSource(record, context));
  const orderData = objectValue(order?.result.data);
  const orderBasis = order ? { result_id: order.resultId, field_paths: ["total", "currency"] } : null;
  const qualificationIntentConsistent = !context.turnIR?.policyIntents || context.turnIR.policyIntents.some(intent => intent.domain === "shipping" && intent.facets.some(facet => facet === "price" || facet === "threshold"));
  const shippingQualification = Boolean(order || context.turnIR?.orderContext) && requests.has("shipping_qualification") && qualificationIntentConsistent || (Boolean(order) && (context.turnIR?.policyIntents ?? []).some(intent => intent.domain === "shipping" && intent.facets.includes("threshold")));
  if (requests.has("order_amount") || shippingQualification) add("order.amount", "order_amount", orderBasis ? [{ type: "fact", fact_kind: "order_amount", evidence: [orderBasis] }] : []);
  const partial = orderData?.fulfillmentStatus === "partial";
  const statusRequested = context.turnIR?.orderContext === "status" || context.turnIR?.answerRequests?.some(request => request.kind === "line_fulfillment")
    || (partial && context.turnIR?.confirmation?.confirmed);
  if (requests.has("line_fulfillment") || (partial && statusRequested)) {
    const items = Array.isArray(orderData?.items) ? orderData.items : [];
    if (!items.length) add("order.lines", "line_fulfillment", []);
    items.forEach((_, index) => add(`order.line.${index}`, "line_fulfillment", [{ type: "fact", fact_kind: "line_fulfillment", evidence: [{ result_id: order!.resultId, field_paths: [`items[${index}]`] }] }]));
  }
  const propertyKeys = [...new Set(context.turnIR?.answerRequests?.filter(request => request.kind === "product_property").map(request => request.propertyKey ?? "general") ?? [])];
  const productRequests = [...(requests.has("product_property") ? (propertyKeys.length ? propertyKeys : ["general"]).map(key => ({ request: "product_property" as const, key })) : []),
    ...(requests.has("product_care") ? [{ request: "product_care" as const, key: "general" }] : [])];
  for (const { request, key } of productRequests) {
    const sections = records.flatMap(evidence => {
      const results = objectValue(evidence.result.data)?.results;
      return Array.isArray(results) ? results.flatMap((value, index) => {
        const record = objectValue(value);
        const structured = objectValue(record?.structured_data);
        if (!record || !productScopeSupported(record, context)) return [];
        const relevant = request === "product_property" ? structured?.semantic_type === "FACT" && structured.support_domain === "product"
          : structured?.semantic_type === "GUIDANCE" && ["care", "product"].includes(String(structured.support_domain));
        if (!relevant || !Array.isArray(record.evidence_sections)) return [];
        return record.evidence_sections.flatMap((value, sectionIndex) => {
          const section = objectValue(value); const field = typeof section?.content === "string" ? "content" : "text";
          return typeof section?.[field] === "string" && (key === "general" || sourcePropertyKey(String(section[field])) === key) ? [{ type: "source_content" as const, kind: request === "product_property" ? "product_property" as const : "care_constraint" as const,
            basis: { result_id: evidence.resultId, field_paths: [`results[${index}].evidence_sections[${sectionIndex}].${field}`] } }] : [];
        });
      }) : [];
    });
    add(request === "product_care" ? "product.care" : key === "general" ? "product.properties" : `product.properties.${key}`, request, sections);
  }
  const policyIntents = context.turnIR?.policyIntents ?? [];
  for (const intent of policyIntents) {
    for (const facet of intent.facets) {
      const candidates: ResponseSegment[] = [];
      for (const evidence of records) {
        const data = objectValue(evidence.result.data);
        const results = Array.isArray(data?.results) ? data.results : [];
        results.forEach((value, index) => {
          const record = objectValue(value); const structured = objectValue(record?.structured_data);
          const coverage = Array.isArray(structured?.policy_coverage) ? structured.policy_coverage : [];
          const applicable = coverage.some(value => { const c = objectValue(value); return c?.domain === intent.domain
            && (!intent.destinationCountryCode || c.destination === intent.destinationCountryCode)
            && Array.isArray(c.available) && c.available.includes(facet); });
          if (!record || !applicable) return;
          if (record.knowledge_type === "procedural" && ["intake", "assessment"].includes(facet)) {
            const blocks = procedureBlocks(evidence.result, index);
            if (blocks.length && blocks.length <= 32) candidates.push({ type: "procedure_guidance", text: "Source-bound procedure", basis: { result_id: evidence.resultId, field_paths: [`results[${index}]`] }, block_ids: blocks.map(block => block.blockId) });
          } else if (record.knowledge_type === "policy" && Array.isArray(record.evidence_sections)) {
            record.evidence_sections.forEach((value, sectionIndex) => {
              const section = objectValue(value); const field = typeof section?.content === "string" ? "content" : "text";
              const relevantChunks = coverage.flatMap(value => {
                const c = objectValue(value); const byFacet = objectValue(c?.evidenceByFacet);
                return c?.domain === intent.domain && (!intent.destinationCountryCode || c.destination === intent.destinationCountryCode)
                  && Array.isArray(byFacet?.[facet]) ? byFacet[facet] as unknown[] : [];
              }).map(String);
              const chunks = Array.isArray(section?.chunk_ids) ? section.chunk_ids.map(String) : [];
              if (relevantChunks.length && !chunks.some(chunk => relevantChunks.includes(chunk))) return;
              if (typeof section?.[field] === "string") candidates.push({ type: "source_content", kind: "policy_condition", basis: { result_id: evidence.resultId, field_paths: [`results[${index}].evidence_sections[${sectionIndex}].${field}`] } });
            });
          }
        });
      }
      add(`policy.${intent.domain}.${facet}`, facet, candidates);
    }
  }
  if (policyIntents.some(intent => intent.domain === "damaged_item" && intent.facets.includes("intake"))) {
    const procedure = records.find(semanticProcedureSource);
    if (procedure) {
      const candidate: ResponseSegment = { type: "evidence_limitation", kind: "photo_channel", basis: { result_id: procedure.resultId, field_paths: ["data.results"] } };
      if (!validateEvidenceLimitation(candidate, context, -1).length) {
        add("damage.photo_channel", "photo_channel", [candidate]);
        const obligation = obligations.find(obligation => obligation.id === "damage.photo_channel")!;
        obligation.status = "unavailable";
      }
    }
  }
  if (shippingQualification) {
    const candidates: ResponseSegment[] = records.flatMap(evidence => {
      const results = objectValue(evidence.result.data)?.results;
      return Array.isArray(results) && orderBasis ? results.flatMap((value, index) => {
        const sections = objectValue(value)?.evidence_sections;
        return Array.isArray(sections) ? sections.map((_, sectionIndex) => ({ type: "source_comparison" as const, kind: "shipping_threshold" as const,
          order: orderBasis, policy: { result_id: evidence.resultId, field_paths: [`results[${index}].evidence_sections[${sectionIndex}].content`] } })) : [];
      }) : [];
    });
    add("shipping.threshold_comparison", "shipping_qualification", candidates);
    if (order) {
      const candidate: ResponseSegment = { type: "evidence_limitation", kind: "charged_shipping", basis: { result_id: order.resultId, field_paths: ["data"] } };
      if (!validateEvidenceLimitation(candidate, context, -1).length) {
        add("provider.shipping_charge_and_coupon", "charged_shipping", [candidate]);
        obligations.find(obligation => obligation.id === "provider.shipping_charge_and_coupon")!.status = "unavailable";
      }
    }
  }
  if (partial && statusRequested && policyIntents.some(intent => intent.domain === "shipping" && intent.facets.includes("timing")) && order) {
    const candidate: ResponseSegment = { type: "evidence_limitation", kind: "line_timing", basis: { result_id: order.resultId, field_paths: ["data"] } };
    if (!validateEvidenceLimitation(candidate, context, -1).length) {
      add("order.line_timing", "line_timing", [candidate]);
      obligations.find(obligation => obligation.id === "order.line_timing")!.status = "unavailable";
    }
  }
  for (const obligation of obligations.filter(obligation => obligation.status === "unavailable")) {
    const kind = obligation.kind === "product_property" ? "product_property" : obligation.kind === "product_care" ? "product_care"
      : obligation.kind === "line_fulfillment" ? "line_fulfillment" : obligation.kind === "shipping_qualification" ? "shipping_qualification" : null;
    if (!kind) continue;
    for (const record of (context.getResults?.() ?? [])) {
      const candidate: ResponseSegment = { type: "evidence_limitation", kind, ...(kind === "product_property" && obligation.id.endsWith(".composition") ? { property_key: "composition" as const } : kind === "product_property" && obligation.id.endsWith(".dimensions") ? { property_key: "dimensions" as const } : {}), basis: { result_id: record.resultId, field_paths: ["data"] } };
      const checked = validateStructuredResponse({ segments: [candidate] }, context);
      if (checked.approvedSegments.length) {
        if (!approved.some(segment => JSON.stringify(segment) === JSON.stringify(candidate))) approved.push(candidate);
        obligation.satisfied = true;
        obligation.recovery = "unavailable";
        obligation.resultIds = [record.resultId];
        break;
      }
    }
  }
  const coverage: AnswerCoverage = { requested: obligations.map(o => o.id), supported: obligations.filter(o => o.status === "supported").map(o => o.id),
    satisfied: obligations.filter(o => o.satisfied).map(o => o.id), missing: obligations.filter(o => !o.satisfied).map(o => o.id),
    unknown: obligations.filter(o => o.status === "unavailable").map(o => o.id), obligations };
  const canonicalApproved = approved.filter((candidate, index) => !approved.some((other, otherIndex) => otherIndex !== index
    && segmentCovers(other, candidate, context) && (!segmentCovers(candidate, other, context) || otherIndex < index)));
  const safeApproved = coverage.missing.length && canonicalApproved.every(segment => segment.type === "acknowledgement") ? [] : canonicalApproved;
  return preservePreciseAnswers({ ...validation, approvedSegments: safeApproved, coverage, completenessDiagnostics: {
    entered: true, cues: validation.completenessDiagnostics?.cues ?? [],
    ...validation.completenessDiagnostics,
    recovery: [...(validation.completenessDiagnostics?.recovery ?? []), ...obligations.map(obligation => ({ type: obligation.id, result: obligation.recovery === "not_needed" ? "skipped" as const : obligation.recovery === "recovered" ? "recovered" as const : "unavailable" as const }))], intent_resolved_by_approved_segment: obligations.length ? coverage.missing.length === 0
      : validation.completenessDiagnostics?.intent_resolved_by_approved_segment ?? approved.some(segment => !["acknowledgement", "question"].includes(segment.type)) } }, context);
}

function validateEvidenceLimitation(segment: Extract<ResponseSegment, { type: "evidence_limitation" }>, context: ResponseValidationContext, index: number): ResponseValidationIssue[] {
  const issues = validateBasis(segment.basis, context, { requireOk: false, requireMeaningfulFields: false, scope: "result" }, index);
  if (issues.length) return issues;
  const evidence = resultFor(segment.basis, context)!;
  const data = objectValue(evidence.result.data);
  if (segment.kind === "photo_channel" && semanticProcedureSource(evidence)) {
    const records = Array.isArray(data?.results) ? data.results.map(objectValue) : [];
    const text = JSON.stringify(records.map(record => objectValue(record?.structured_data)?.procedure));
    if (records.some(record => objectValue(record?.structured_data)?.support_domain === "damaged_item")
      && !/(?:https?:|mailto:|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|upload_url|submission_channel)/i.test(text)) return [];
  }
  if (segment.kind === "charged_shipping" && verifiedOrderSource(evidence, context)
    && !["shippingPrice", "shipping_price", "shipping_lines", "discount_codes"].some(key => data && key in data)) return [];
  if (segment.kind === "line_timing" && verifiedOrderSource(evidence, context)) {
    const items = Array.isArray(data?.items) ? data.items : [];
    if (items.some((item, itemIndex) => {
      const line = lineDisposition({ result_id: evidence.resultId, field_paths: [`items[${itemIndex}]`] }, context);
      return line && line.remaining > 0 && !["estimatedDelivery", "estimatedDispatch", "deliveryDate", "dispatchDate"].some(key => meaningful(objectValue(item)?.[key]));
    })) return [];
  }
  if (segment.kind === "line_fulfillment" && verifiedOrderSource(evidence, context)) {
    const items = Array.isArray(data?.items) ? data.items : [];
    if (items.length && items.some((_, itemIndex) => !lineDisposition({ result_id: evidence.resultId, field_paths: [`items[${itemIndex}]`] }, context))) return [];
  }
  if (segment.kind === "shipping_qualification" && verifiedOrderSource(evidence, context)
    && context.turnIR?.answerRequests?.some(request => request.kind === "shipping_qualification")) {
    const alternatives = (context.getResults?.() ?? []).flatMap(record => {
      const results = objectValue(record.result.data)?.results;
      return Array.isArray(results) ? results.flatMap((value, recordIndex) => {
        const sections = objectValue(value)?.evidence_sections;
        return Array.isArray(sections) ? sections.map((_, sectionIndex) => ({ type: "source_comparison" as const, kind: "shipping_threshold" as const,
          order: { result_id: evidence.resultId, field_paths: ["total", "currency"] }, policy: { result_id: record.resultId, field_paths: [`results[${recordIndex}].evidence_sections[${sectionIndex}].content`] } })) : [];
      }) : [];
    });
    if (!alternatives.some(candidate => shippingComparison(candidate, context))) return [];
  }
  if (["product_care", "product_property"].includes(segment.kind) && Array.isArray(data?.results)) {
    const matching = data.results.map(objectValue).filter((record): record is JsonObject => Boolean(record?.knowledge_type === "product" && productScopeSupported(record!, context)));
    const relevant = matching.filter(record => {
      const structured = objectValue(record.structured_data);
      return segment.kind === "product_property" ? structured?.semantic_type === "FACT" && structured.support_domain === "product"
        && (!segment.property_key || segment.property_key === "general" || (Array.isArray(record.evidence_sections) && record.evidence_sections.some(value => sourcePropertyKey(String(objectValue(value)?.content ?? objectValue(value)?.text ?? "")) === segment.property_key)))
        : structured?.semantic_type === "GUIDANCE" && ["care", "product"].includes(String(structured.support_domain));
    });
    if (matching.length && !relevant.length) return [];
  }
  if (["not_found", "unavailable", "unknown", "error"].includes(evidence.result.status)
    && (segment.kind.startsWith("product_") ? evidence.toolName.includes("product") : segment.kind === "line_fulfillment" ? ["get_order", "inspect_fulfillment"].includes(evidence.toolName) : false)) return [];
  return [{ index, code: "limitation_not_established", message: "The requested limitation is not established by current evidence." }];
}

function renderEvidenceLimitation(segment: Extract<ResponseSegment, { type: "evidence_limitation" }>, context: ResponseValidationContext): string {
  const da = localeFor(context) === "da";
  if (segment.kind === "photo_channel") return da
    ? "Den verificerede procedure angiver ikke en kanal til indsendelse af billeder. Klargjorte billeder er ikke det samme som modtagne filer. Sagen kræver billeder og vurdering; der er endnu ikke bekræftet en løsning."
    : "The verified procedure does not specify a photo submission channel. Having photos ready does not establish that files have been received. Photos and assessment are required; no remedy has been confirmed.";
  if (segment.kind === "line_timing") return da ? "Der er ikke en verificeret afsendelses- eller leveringsdato for de varer, der endnu ikke er afsendt. Generelle leveringstider fastlægger ikke denne dato." : "No verified dispatch or delivery date is available for the items not yet dispatched. General delivery estimates do not establish that date.";
  if (segment.kind === "charged_shipping") return da ? "Ordreopslaget viser ikke den faktisk opkrævede fragt eller rabatkoden." : "The order lookup does not expose the shipping actually charged or coupon details.";
  if (segment.kind === "line_fulfillment") return da ? "Jeg kan bekræfte ordren, men ikke knytte alle varer og mængder til forsendelserne. Jeg kan derfor ikke bekræfte status for den enkelte vare." : "I can verify the order, but cannot map all items and quantities to shipments. I therefore cannot verify the individual item's shipment status.";
  if (segment.kind === "shipping_qualification") return da ? "Ordretotalen kan bekræftes, men jeg kan ikke bekræfte, om den opfylder betingelserne for fri fragt, ud fra de tilgængelige vilkår." : "The order total can be verified, but the available terms do not establish whether it qualifies for free shipping.";
  if (segment.kind === "product_property" && segment.property_key === "composition") return da ? "Den tilgængelige produktdokumentation fastlægger ikke materialesammensætningen." : "The available product information does not establish its material composition.";
  if (segment.kind === "product_property" && segment.property_key === "dimensions") return da ? "Den tilgængelige produktdokumentation fastlægger ikke dimensionerne." : "The available product information does not establish its dimensions.";
  return da ? "Jeg kan ikke bekræfte den ønskede oplysning ud fra den tilgængelige dokumentation." : "I cannot verify that requested detail from the available evidence.";
}

export interface SegmentBoundaryDiagnostic {
  index: number;
  type: string;
  evidenceKinds: string[];
  resultIds: string[];
  sourceIds: string[];
  rejectionCodes: string[];
}
function segmentBoundaryDiagnostic(segment: ResponseSegment, context: ResponseValidationContext, index: number, issues: ResponseValidationIssue[]): SegmentBoundaryDiagnostic {
  const bases = segment.type === "fact" ? segment.evidence : segment.type === "source_comparison" ? [segment.order, segment.policy]
    : "basis" in segment && segment.basis ? [segment.basis] : [];
  const records = bases.map(basis => resultFor(basis, context)).filter((evidence): evidence is ResponseEvidenceRecord => Boolean(evidence));
  const sourceIds = bases.flatMap(basis => {
    const results = objectValue(resultFor(basis, context)?.result.data)?.results;
    return Array.isArray(results) ? citedKnowledgeRecords(results, basis.field_paths).map(record => String(objectValue(objectValue(record)?.provenance)?.source_id ?? "")).filter(Boolean) : [];
  });
  return { index, type: segment.type, evidenceKinds: [...new Set(records.map(normalizedEvidenceKind))],
    resultIds: [...new Set(records.map(record => record.resultId))], sourceIds: [...new Set(sourceIds)], rejectionCodes: issues.map(issue => issue.code) };
}

function modernProductBasis(basis: KnowledgeBasis, context: ResponseValidationContext): boolean {
  const results = objectValue(resultFor(basis, context)?.result.data)?.results;
  return Array.isArray(results) && citedKnowledgeRecords(results, basis.field_paths).some(value => {
    const record = objectValue(value);
    return record?.knowledge_type === "product" && meaningful(objectValue(record.provenance)?.source_id)
      && meaningful(objectValue(record.structured_data)?.semantic_type);
  });
}
function projectedProductContent(basis: KnowledgeBasis, context: ResponseValidationContext): Extract<ResponseSegment, { type: "source_content" }> | null {
  const evidence = resultFor(basis, context);
  const results = objectValue(evidence?.result.data)?.results;
  if (!Array.isArray(results)) return null;
  const paths = basis.field_paths.flatMap(path => {
    const normalized = normalizedDataPath(path);
    const match = normalized.match(/^results\[(\d+)\](?:\.evidence_sections(?:\[(\d+)\](?:\.(content|text))?)?)?$/);
    if (!match) return [];
    const sections = objectValue(results[Number(match[1])])?.evidence_sections;
    if (!Array.isArray(sections)) return [];
    return sections.flatMap((value, index) => {
      if (match[2] != null && Number(match[2]) !== index) return [];
      const section = objectValue(value);
      const field = match[3] ?? (typeof section?.content === "string" ? "content" : "text");
      return typeof section?.[field] === "string" ? [`results[${match[1]}].evidence_sections[${index}].${field}`] : [];
    });
  });
  const facet = preciseRequests(context).find(request => paths.length && paths.every(path => sourceSections({ result_id: basis.result_id, field_paths: [path] }, context).some(section => sourceSupportsFacet(section.text, request.facet))))?.facet;
  const sourceCare = paths.length > 0 && sourceSections({ result_id: basis.result_id, field_paths: paths }, context).every(section => {
    const structured = objectValue(section.record.structured_data);
    return structured?.support_domain === "care" && ["GUIDANCE", "FACT"].includes(String(structured.semantic_type));
  });
  const candidate: Extract<ResponseSegment, { type: "source_content" }> = { type: "source_content", ...(facet ? { kind: "product_constraint", facet } : { kind: sourceCare || productCareRequest(context) ? "care_constraint" : "product_property" }),
    basis: { result_id: basis.result_id, field_paths: [...new Set(paths)] } };
  return paths.length && paths.length <= 32 && !validateSourceContent(candidate, context, -1).length ? candidate : null;
}

function verifiedFulfillmentSource(evidence: ResponseEvidenceRecord | undefined, context: ResponseValidationContext): boolean {
  if (!evidence || evidence.result.status !== "ok" || evidenceScopeIssues(evidence, context, -1).length) return false;
  const data = objectValue(evidence.result.data);
  const active = context.activeOrder ?? context.getActiveOrderFocus?.();
  return active?.state === "verified" && meaningful(active.order?.id)
    && String(data?.order_id ?? data?.orderId) === String(active.order.id) && Array.isArray(data?.fulfillments);
}

function standaloneMappedQuantity(evidence: ResponseEvidenceRecord, mapped: JsonObject | null): boolean {
  if (!meaningful(mapped?.orderLineItemId) || !Number.isInteger(Number(mapped?.orderedQuantity)) || Number(mapped?.orderedQuantity) <= 0
    || !Number.isInteger(Number(mapped?.quantity)) || Number(mapped?.quantity) <= 0) return false;
  const fulfillments = objectValue(evidence.result.data)?.fulfillments;
  if (!Array.isArray(fulfillments)) return false;
  const ids = new Set<string>();
  let sum = 0;
  for (const value of fulfillments) {
    const fulfillment = objectValue(value);
    if (!meaningful(fulfillment?.id) || ids.has(String(fulfillment.id)) || fulfillment?.itemMappingStatus !== "verified"
      || fulfillment.status !== "success" || !Array.isArray(fulfillment.items)) return false;
    ids.add(String(fulfillment.id));
    for (const value of fulfillment.items) {
      const item = objectValue(value);
      if (String(item?.orderLineItemId) !== String(mapped?.orderLineItemId)) continue;
      const quantity = Number(item?.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0 || item?.title !== mapped?.title
        || String(item?.variantId ?? "") !== String(mapped?.variantId ?? "")
        || Number(item?.orderedQuantity) !== Number(mapped?.orderedQuantity)) return false;
      sum += quantity;
    }
  }
  return sum > 0 && sum <= Number(mapped?.orderedQuantity) && sum === Number(mapped?.fulfilledQuantity);
}

/** Parse the role of source-authored fields; this never supplies a model value. */
function sourcePropertyKey(text: string): "composition" | "dimensions" | "general" {
  if (/\d+(?:[.,]\d+)?\s*%|\b(?:composition|material|made (?:of|from)|veneer|engineered wood core)\b/i.test(text)) return "composition";
  if (/\b(?:size|dimensions|width|height|length)\b|\d+\s*(?:×|x)\s*\d+\s*(?:cm|mm|m|inches)/i.test(text)) return "dimensions";
  return "general";
}

function basisCovers(existing: KnowledgeBasis, required: KnowledgeBasis): boolean {
  return existing.result_id === required.result_id && required.field_paths.every(path => existing.field_paths.map(normalizedDataPath).includes(normalizedDataPath(path)));
}
function segmentCovers(existing: ResponseSegment, required: ResponseSegment, context: ResponseValidationContext): boolean {
  if (existing.type === "source_content" && required.type === "knowledge_guidance") {
    const source = sourceSections(required.basis, context).map(section => section.text).join("\n\n");
    return source.length > 0 && required.text.trim() === source.trim() && basisCovers(existing.basis, required.basis);
  }
  if (existing.type === "knowledge_guidance" && required.type === "source_content") {
    const source = sourceSections(required.basis, context).map(section => section.text).join("\n\n");
    return source.length > 0 && existing.text.trim() === source.trim() && basisCovers(existing.basis, required.basis);
  }
  if (existing.type !== required.type) return false;
  if (existing.type === "source_content" && required.type === "source_content") return existing.kind === required.kind && basisCovers(existing.basis, required.basis);
  if (existing.type === "fact" && required.type === "fact") return existing.fact_kind === required.fact_kind
    && required.evidence.every(basis => existing.evidence.some(candidate => basisCovers(candidate, basis)));
  if (existing.type === "procedure_guidance" && required.type === "procedure_guidance") {
    const existingIds = procedureStepValues(existing, context).map(step => step.blockId);
    const requiredIds = procedureStepValues(required, context).map(step => step.blockId);
    return existing.basis.result_id === required.basis.result_id && basisCovers(existing.basis, required.basis)
      && requiredIds.length > 0 && requiredIds.every(id => existingIds.includes(id));
  }
  if (existing.type === "source_comparison" && required.type === "source_comparison") return basisCovers(existing.order, required.order) && basisCovers(existing.policy, required.policy);
  if (existing.type === "evidence_limitation" && required.type === "evidence_limitation") return existing.kind === required.kind
    && existing.property_key === required.property_key && existing.basis.result_id === required.basis.result_id;
  return JSON.stringify(existing) === JSON.stringify(required);
}

function preciseRequests(context: ResponseValidationContext): PreciseAnswerRequest[] {
  return context.preciseRequests ?? compilePreciseAnswerRequests(context.turnIR?.answerRequests ?? []);
}
function requestedProductMatches(title: string, context: ResponseValidationContext): boolean {
  const first = normalizedPhrase(title).split(" ")[0];
  return Boolean(first?.length > 2 && normalizedPhrase(`${context.customerMessage ?? ""} ${context.customerProvidedContext?.product ?? ""}`).split(" ").includes(first));
}
export function verifiedAnswerSubject(context: ResponseValidationContext, request?: PreciseAnswerRequest): { id: string; title: string; handle?: string } | null {
  const subjects = (context.getResults?.() ?? []).filter(record => record.toolName === "get_product" && record.result.status === "ok" && (!request || !context.preciseReadResults?.[request.id] || context.preciseReadResults[request.id].includes(record.resultId)) && !evidenceScopeIssues(record, context, -1).length).flatMap(record => {
    const data = objectValue(record.result.data);
    const products = Array.isArray(data?.products) ? data.products.map(objectValue) : [data];
    // Both supported catalog envelopes are normalized here; never select one of multiple returned products.
    if (products.length !== 1) return [];
    return products.flatMap(product => meaningful(product?.id) && typeof product?.title === "string" && requestedProductMatches(product.title, context) && (!request || requestSubjectMatches(request, product.title)) ? [{ id: String(product.id), title: product.title, ...(typeof product.handle === "string" ? { handle: product.handle } : {}) }] : []);
  });
  const ids = new Set(subjects.map(subject => subject.id));
  return ids.size === 1 ? subjects[0] : null;
}
function requestSubjectMatches(request: PreciseAnswerRequest, title: string): boolean {
  if (!request.subject) return true;
  const tokens = normalizedPhrase(request.subject).split(" ").filter(token => token.length > 2);
  const titleTokens = normalizedPhrase(title).split(" ");
  return tokens.length > 0 && tokens.every(token => titleTokens.includes(token));
}
function sourceMatchesRequest(record: JsonObject, request: PreciseAnswerRequest, context: ResponseValidationContext): boolean {
  const subject = verifiedAnswerSubject(context, request);
  const ids = objectValue(objectValue(record.structured_data)?.applicability)?.product_ids;
  if (subject) return Array.isArray(ids) && ids.length === 1 && String(ids[0]) === subject.id;
  // Once a subject-specific catalog read was attempted, an unresolved identity cannot
  // be supplied by a different product's knowledge or a coincidental title match.
  if (context.preciseReadResults?.[request.id]?.some(id => context.getResult(id)?.toolName === "get_product")) return false;
  return requestSubjectMatches(request, careSubject(record)) && productScopeSupported(record, context);
}
function facetCandidates(request: PreciseAnswerRequest, context: ResponseValidationContext): ResponseSegment[] {
  return (context.getResults?.() ?? []).filter(record => record.result.status === "ok" && !evidenceScopeIssues(record, context, -1).length).flatMap(evidence => {
    const results = objectValue(evidence.result.data)?.results;
    return Array.isArray(results) ? results.flatMap((value, index) => {
      const record = objectValue(value);
      if (!record || !sourceMatchesRequest(record, request, context) || !productScopeSupported(record, context) || !Array.isArray(record.evidence_sections)) return [];
      return record.evidence_sections.flatMap((value, sectionIndex) => {
        const section = objectValue(value); const field = typeof section?.content === "string" ? "content" : "text";
        return typeof section?.[field] === "string" && sourceSupportsFacet(String(section[field]), request.facet)
          ? [{ type: "source_content" as const, kind: "product_constraint" as const, facet: request.facet,
            basis: { result_id: evidence.resultId, field_paths: [`results[${index}].evidence_sections[${sectionIndex}].${field}`] } }] : [];
      });
    }) : [];
  });
}
function facetSourceText(segment: ResponseSegment, context: ResponseValidationContext): string[] {
  return segment.type === "source_content" ? sourceSections(segment.basis, context).map(section => section.text) : [];
}
function facetEvidenceIsUnknown(segment: ResponseSegment, context: ResponseValidationContext): boolean {
  return segment.type === "facet_limit" || (segment.type !== "source_content" || !["qualified_next_step", "cleaning_alternative"].includes(segment.facet ?? "")) && facetSourceText(segment, context).some(documentedUnknown);
}
function validateFacetLimit(segment: Extract<ResponseSegment, { type: "facet_limit" }>, context: ResponseValidationContext, index: number): ResponseValidationIssue[] {
  const issues = validateBasis(segment.basis, context, { requireOk: false, requireMeaningfulFields: false, scope: "result" }, index);
  if (issues.length) return issues;
  const request = preciseRequests(context).find(request => request.facet === segment.facet && request.requestIndex === segment.request_index);
  if (!request) return [{ index, code: "answer_facet_not_requested", message: "The bounded limitation is not a registered request." }];
  const evidence = resultFor(segment.basis, context)!;
  const explicitlyRead = context.preciseReadResults?.[request.id]?.includes(evidence.resultId);
  const subject = verifiedAnswerSubject(context, request);
  const matchingSource = objectValue(evidence.result.data)?.results;
  const scopedSource = Array.isArray(matchingSource) && matchingSource.some(value => { const record = objectValue(value); return record && sourceMatchesRequest(record, request, context) && productScopeSupported(record, context); });
  const matchingCatalog = subject && evidence.toolName === "get_product" && verifiedAnswerSubject({ ...context, getResults: () => [evidence] }, request)?.id === subject.id;
  // An unsuccessful identity lookup supports only that requested subject's uncertainty.
  // Only server-recorded reads can establish this case; model labels are not authority.
  const identityRead = explicitlyRead && evidence.toolName === "get_product";
  const scopedEmptyRead = explicitlyRead && subject && evidence.toolName === "search_product_knowledge";
  if (!identityRead && !scopedEmptyRead && !matchingCatalog && !scopedSource) {
    return [{ index, code: "answer_facet_scope_unverified", message: "A specific uncertainty requires a current subject-scoped read." }];
  }
  const checked = facetCandidates(request, context).flatMap(candidate => validateStructuredResponse({ segments: [candidate] }, context).approvedSegments);
  if (checked.length) return [{ index, code: "answer_facet_available", message: "A verified source already establishes this facet." }];
  return [];
}
function renderFacetLimit(segment: Extract<ResponseSegment, { type: "facet_limit" }>, context: ResponseValidationContext): string {
  const da = localeFor(context) === "da";
  const copy: Record<CoveredAnswerFacet, string> = {
    material_composition: "The current scoped evidence does not establish the requested material composition.",
    load_capacity: "I cannot verify an approved load capacity from the current documentation; do not assume the proposed load is safe.",
    weight_limit: "I cannot verify the supported weight limit from the current documentation.",
    electrical_safety: "The available evidence does not establish safe electrical repair or continued use when electrical parts are damaged.",
    repair_boundary: "I cannot verify an approved customer repair or replacement procedure from the current documentation.",
    certification: "I cannot verify the requested safety certification from the current evidence; do not assume the product is certified.",
    placement: "I cannot verify safe placement near heat or the requested placement conditions; no safe distance is established here.",
    cleaning_method: "The current evidence does not establish that the requested cleaning method is safe.",
    prohibited_method: "I cannot verify all applicable cleaning restrictions from the current documentation.",
    cleaning_alternative: "No approved alternative cleaning method was found in the current scoped evidence; use only a method verified for this product.",
    dimension_width: "The available dimensional values do not establish a labeled width; an unlabeled tuple is not an axis mapping.",
    dimension_depth: "The available dimensional values do not establish a labeled depth; an unlabeled tuple is not an axis mapping.",
    dimension_height: "The available dimensional values do not establish a labeled height; an unlabeled tuple is not an axis mapping.",
    dimension_values: "I cannot verify documented dimensional values for this product.",
    qualified_next_step: "Get verified guidance from the store or a qualified professional before relying on an unverified safety property or attempting a repair.",
  };
  const danish: Record<CoveredAnswerFacet, string> = {
    material_composition: "De tilgængelige oplysninger dokumenterer ikke den ønskede materialesammensætning.",
    load_capacity: "Jeg kan ikke bekræfte en godkendt bæreevne ud fra dokumentationen; antag ikke, at den foreslåede belastning er sikker.",
    weight_limit: "Jeg kan ikke bekræfte den tilladte vægtgrænse ud fra dokumentationen.",
    electrical_safety: "De tilgængelige oplysninger dokumenterer ikke sikker reparation eller fortsat brug, når elektriske dele er beskadigede.",
    repair_boundary: "Jeg kan ikke bekræfte en godkendt fremgangsmåde til reparation eller udskiftning, som kunden selv kan udføre.",
    certification: "Jeg kan ikke bekræfte den ønskede sikkerhedscertificering; antag ikke, at produktet er certificeret.",
    placement: "Jeg kan ikke bekræfte sikker placering nær varme eller de ønskede placeringsforhold; en sikker afstand er ikke dokumenteret her.",
    cleaning_method: "De tilgængelige oplysninger dokumenterer ikke, at den ønskede rengøringsmetode er sikker.",
    prohibited_method: "Jeg kan ikke bekræfte alle relevante begrænsninger for rengøring ud fra dokumentationen.",
    cleaning_alternative: "Der er ikke fundet en godkendt alternativ rengøringsmetode; brug kun en metode, der er bekræftet for dette produkt.",
    dimension_width: "De tilgængelige mål angiver ikke en entydig bredde; mål uden aksebetegnelser fastlægger ikke bredden.",
    dimension_depth: "De tilgængelige mål angiver ikke en entydig dybde; mål uden aksebetegnelser fastlægger ikke dybden.",
    dimension_height: "De tilgængelige mål angiver ikke en entydig højde; mål uden aksebetegnelser fastlægger ikke højden.",
    dimension_values: "Jeg kan ikke bekræfte dokumenterede mål for dette produkt.",
    qualified_next_step: "Få bekræftet vejledning fra butikken eller en kvalificeret fagperson, før du stoler på en ubekræftet sikkerhedsegenskab eller forsøger en reparation.",
  };
  const request = preciseRequests(context).find(request => request.facet === segment.facet && request.requestIndex === segment.request_index);
  const multipleSubjects = new Set(preciseRequests(context).map(request => request.subject).filter(Boolean)).size > 1;
  const prefix = multipleSubjects && request?.subject ? `${request.subject}: ` : "";
  if (request && !verifiedAnswerSubject(context, request) && context.preciseReadResults?.[request.id]?.some(id => context.getResult(id)?.toolName === "get_product")) {
    return prefix + (da ? "Jeg kan ikke bekræfte produktets identitet ud fra de tilgængelige oplysninger. Butikken kan hjælpe med at identificere det, før produktets egenskaber eller sikkerhed vurderes." : "I cannot verify this product's identity from the available information. The store can help identify it before its properties or safety are assessed.");
  }
  let text = da ? danish[segment.facet] : copy[segment.facet];
  if (segment.facet === "qualified_next_step") {
    const dependencies = preciseRequests(context).find(request => request.facet === segment.facet && request.requestIndex === segment.request_index)?.requiredFor ?? [];
    if (dependencies.some(facet => ["electrical_safety", "repair_boundary"].includes(facet))) text = da ? "Kontakt butikken eller en kvalificeret fagperson for bekræftet vejledning om den beskadigede elektriske del; en godkendt reparationsmetode for kunden er ikke dokumenteret." : "Contact the store or a qualified professional for verified guidance about the damaged electrical part; an approved customer repair method is not established.";
    else if (dependencies.some(facet => ["certification", "placement"].includes(facet))) text = da ? "Bed butikken eller producenten om bekræftet vejledning om certificering og placering, før du stoler på produktet nær varme." : "Ask the store or manufacturer for verified certification and placement guidance before relying on the product near heat.";
    else if (dependencies.some(facet => ["load_capacity", "weight_limit"].includes(facet))) text = da ? "Bed butikken eller producenten om at bekræfte bæreevnen og de relevante monteringsforhold, før du belaster eller monterer produktet." : "Ask the store or manufacturer to verify the load rating and applicable installation conditions before loading or installing it.";
  }
  return prefix + text;
}
function preciseFacetSegments(request: PreciseAnswerRequest, validation: ResponseValidationResult, context: ResponseValidationContext): ResponseSegment[] {
  return validation.approvedSegments.filter(segment => segment.type === "facet_limit" ? segment.facet === request.facet && segment.request_index === request.requestIndex
    : segment.type === "source_content" && segment.facet === request.facet && sourceSections(segment.basis, context).every(section => sourceMatchesRequest(section.record, request, context)) && facetSourceText(segment, context).every(text => sourceSupportsFacet(text, request.facet)));
}
function preservePreciseAnswers(validation: ResponseValidationResult, context: ResponseValidationContext): ResponseValidationResult {
  const requests = preciseRequests(context);
  if (!requests.length) return validation;
  let result = { ...validation, approvedSegments: [...validation.approvedSegments], rejectedSegments: [...validation.rejectedSegments], issues: [...validation.issues] };
  const obligations: AnswerObligation[] = [];
  for (const request of requests) {
    const priorCount = result.approvedSegments.length;
    const candidates = facetCandidates(request, context);
    const checked = candidates.map(candidate => validateStructuredResponse({ segments: [candidate] }, context));
    const accepted = checked.flatMap(value => value.approvedSegments);
    const obligation: AnswerObligation = { id: request.id, kind: request.facet, facet: request.facet, status: "missing", satisfied: false,
      subjectIds: verifiedAnswerSubject(context, request) ? [verifiedAnswerSubject(context, request)!.id] : [], resultIds: [], sourceIds: [], rejectionCodes: checked.flatMap(value => value.issues.map(issue => issue.code)), recovery: "not_needed" };
    // A qualified next step is conditional on unresolved safety, not an extra ask for known limits.
    const unknownSafety = obligations.some(obligation => obligation.id.startsWith(`answer.${request.requestIndex}.`) && request.requiredFor.includes(obligation.facet as any) && obligation.status !== "supported");
    if (request.facet === "qualified_next_step" && !unknownSafety) { obligation.status = "supported"; obligation.satisfied = true; obligations.push(obligation); continue; }
    for (const segment of accepted) {
      if (!result.approvedSegments.some(existing => JSON.stringify(existing) === JSON.stringify(segment))) result.approvedSegments.push(segment);
    }
    if (!accepted.length) {
      const records = (context.getResults?.() ?? []).filter(record => context.preciseReadResults?.[request.id]?.includes(record.resultId) || record.toolName === "get_product" || Array.isArray(objectValue(record.result.data)?.results));
      for (const record of records) {
        const candidate: ResponseSegment = { type: "facet_limit", facet: request.facet, request_index: request.requestIndex, basis: { result_id: record.resultId, field_paths: ["status"] } };
        const checked = validateStructuredResponse({ segments: [candidate] }, context);
        if (!checked.approvedSegments.length) continue;
        if (!result.approvedSegments.some(existing => JSON.stringify(existing) === JSON.stringify(candidate))) result.approvedSegments.push(candidate);
        break;
      }
    }
    const segments = preciseFacetSegments(request, result, context);
    obligation.satisfied = segments.length > 0;
    obligation.status = segments.length ? segments.some(segment => facetEvidenceIsUnknown(segment, context)) ? "unknown" : "supported" : "missing";
    obligation.recovery = segments.length ? result.approvedSegments.length > priorCount ? "recovered" : "not_needed" : "unavailable";
    for (const segment of segments) if ("basis" in segment && segment.basis) {
      obligation.resultIds.push(segment.basis.result_id);
      const source = segmentBoundaryDiagnostic(segment, context, -1, []); obligation.sourceIds.push(...source.sourceIds);
    }
    obligation.resultIds = [...new Set(obligation.resultIds)]; obligation.sourceIds = [...new Set(obligation.sourceIds)];
    obligations.push(obligation);
  }
  const all = [...(validation.coverage?.obligations ?? []), ...obligations];
  result.coverage = { requested: all.map(value => value.id), supported: all.filter(value => value.status === "supported").map(value => value.id), satisfied: all.filter(value => value.satisfied).map(value => value.id),
    missing: all.filter(value => !value.satisfied).map(value => value.id), unknown: all.filter(value => ["unknown", "unavailable"].includes(value.status)).map(value => value.id), obligations: all };
  return result;
}
/** Checks actual rendered content, and restores only validator-approved source projections.
 * It does not change an eligibility result or generate a model answer pass. */
export function renderWithAnswerCoverage(validation: ResponseValidationResult, context: ResponseValidationContext): { response: string; validation: ResponseValidationResult } {
  let response = renderResponseSegments(validation.approvedSegments, context);
  const obligations = validation.coverage?.obligations.map(value => ({ ...value })) ?? [];
  for (const request of preciseRequests(context)) {
    const obligation = obligations.find(value => value.id === request.id);
    if (!obligation || !obligation.satisfied) continue;
    const segments = preciseFacetSegments(request, validation, context);
    if (!segments.length) { obligation.rendered = request.facet === "qualified_next_step" && obligation.status === "supported"; continue; }
    const pieces = segments.map(segment => renderResponseSegments([segment], { ...context, firstResponse: false }));
    const missing = pieces.filter(piece => !normalizedPhrase(response).includes(normalizedPhrase(piece)));
    if (missing.length) response = [response, ...missing].filter(Boolean).join("\n\n");
    obligation.rendered = pieces.every(piece => normalizedPhrase(response).includes(normalizedPhrase(piece)));
    if (!obligation.rendered) obligation.satisfied = false;
  }
  if (!validation.coverage) return { response, validation };
  const coverage = { ...validation.coverage, obligations, satisfied: obligations.filter(value => value.satisfied).map(value => value.id), missing: obligations.filter(value => !value.satisfied).map(value => value.id) };
  return { response, validation: { ...validation, coverage } };
}

export function missingPreciseEvidence(context: ResponseValidationContext): PreciseAnswerRequest[] {
  const requests = preciseRequests(context);
  return requests.filter(request => {
    if (request.facet === "qualified_next_step" && !requests.some(primary => primary.requestIndex === request.requestIndex && request.requiredFor.includes(primary.facet as any)
      && !facetCandidates(primary, context).some(candidate => {
        const accepted = validateStructuredResponse({ segments: [candidate] }, context).approvedSegments;
        return accepted.length && !accepted.some(segment => facetEvidenceIsUnknown(segment, context));
      }))) return false;
    return !facetCandidates(request, context).some(candidate => validateStructuredResponse({ segments: [candidate] }, context).approvedSegments.length > 0);
  });
}
