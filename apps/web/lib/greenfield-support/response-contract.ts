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
}

export interface ResponseValidationResult {
  schemaValid: boolean;
  allValid: boolean;
  approvedSegments: ResponseSegment[];
  rejectedSegments: Array<{ index: number; type?: string; issues: ResponseValidationIssue[] }>;
  issues: ResponseValidationIssue[];
  parsed: StructuredResponse | null;
  completenessDiagnostics?: ResponseCompletenessDiagnostics;
}

export type ResponseFailureClass =
  | "system_tool_failure"
  | "insufficient_knowledge"
  | "insufficient_specificity"
  | "valid_not_found"
  | "model_response_invalid";

export interface ResponseValidationContext {
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
  const issues: ResponseValidationIssue[] = [];
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
    return evidence?.toolName === "search_product_knowledge"
      && record.knowledge_type === "product"
      && authority === "reference";
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
  if (!evidence || evidence.toolName !== "search_procedures") {
    issues.push({ index, code: "procedure_source_required", message: "Procedure guidance must cite a successful search_procedures result." });
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
  if (citedRecord?.knowledge_type !== "procedural") {
    issues.push({ index, code: "procedure_source_required", message: "Procedure guidance must cite a procedural knowledge record." });
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
  if (!evidence || evidence.toolName !== "search_procedures") return false;
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
  return path.startsWith("data.") ? path.slice("data.".length) : path;
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

function validateFact(segment: Extract<ResponseSegment, { type: "fact" }>, context: ResponseValidationContext, index: number) {
  const issues = segment.evidence.flatMap((basis) => validateBasis(
    basis,
    context,
    { requireOk: true, requireMeaningfulFields: true, scope: "data" },
    index,
  ));
  if (issues.length) return issues;

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
    if (itemEvidence?.toolName !== "inspect_fulfillment") {
      return [{ index, code: "shipment_item_source_required", message: "A shipment item fact must cite an inspect_fulfillment result." }];
    }
    const fulfillmentId = dataFieldValue(itemEvidence.result, `fulfillments[${firstBinding.fulfillmentIndex}].id`).value;
    if (!meaningful(fulfillmentId)) {
      return [{ index, code: "shipment_item_fulfillment_id_required", message: "A shipment item fact must bind to a returned fulfillment ID." }];
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
  const contextOnlyClarification = canClarifyMissingCustomerContext(segment, context);
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
    && !isExplicitAddressChangeRequest(context.customerMessage)) {
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
    case "fact":
      return validateFact(segment, context, index);
    case "knowledge_guidance": {
      const issues = validateKnowledgeBasis(segment.basis, context, index);
      if (!issues.length) issues.push(...validatePolicyTruth(segment, context, index));
      if (!issues.length && citesProceduralKnowledge(segment.basis, context)) {
        issues.push({ index, code: "procedure_binding_required", message: "Procedural guidance must cite source-bound procedure steps." });
      }
      if (!issues.length && containsUnvalidatedOperationalCommitment(segment.text)) {
        issues.push({ index, code: "unsupported_operational_commitment", message: "Operational commitments must use a validated proposal-only capability." });
      }
      return issues;
    }
    case "procedure_guidance":
      return validateProcedureGuidance(segment, context, index);
    case "limitation": {
      const evidence = resultFor(segment.basis, context);
      if (!evidence) return [{ index, code: "unknown_result_id", message: "The limitation references a tool result from outside this run." }];
      const issues = validateBasis(segment.basis, context, { requireOk: false, requireMeaningfulFields: false, scope: "result" }, index);
      if (!issues.length && containsUnvalidatedOperationalCommitment(segment.text)) {
        issues.push({ index, code: "unsupported_operational_commitment", message: "Operational commitments must use a validated proposal-only capability." });
      }
      return issues;
    }
    case "action_offer": {
      if (segment.capability === "update_address"
        && context.customerMessage?.trim()
        && !isExplicitAddressChangeRequest(context.customerMessage)) {
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

export function validateStructuredResponse(input: unknown, context: ResponseValidationContext): ResponseValidationResult {
  const parsed = StructuredResponseSchema.safeParse(parseInput(input));
  if (!parsed.success) {
    const issue: ResponseValidationIssue = { index: null, code: "schema_invalid", message: "The model did not return the required structured response contract." };
    return { schemaValid: false, allValid: false, approvedSegments: [], rejectedSegments: [], issues: [issue], parsed: null };
  }

  const approvedSegments: ResponseSegment[] = [];
  const rejectedSegments: Array<{ index: number; type?: string; issues: ResponseValidationIssue[] }> = [];
  for (let index = 0; index < parsed.data.segments.length; index += 1) {
    const segment = parsed.data.segments[index];
    const issues = validateSegment(segment, context, index);
    if (issues.length) rejectedSegments.push({ index, type: segment.type, issues });
    else approvedSegments.push(segment);
  }
  return {
    schemaValid: true,
    allValid: rejectedSegments.length === 0,
    approvedSegments,
    rejectedSegments,
    issues: rejectedSegments.flatMap((item) => item.issues),
    parsed: parsed.data,
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
              cues: result.completenessDiagnostics.cues,
              recovery: result.completenessDiagnostics.recovery,
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

function factEvidenceValues(segment: Extract<ResponseSegment, { type: "fact" }>, context: ResponseValidationContext) {
  return segment.evidence.flatMap((basis) => {
    const evidence = resultFor(basis, context);
    if (!evidence) return [];
    return basis.field_paths.flatMap((path) => {
      const field = dataFieldValue(evidence.result, path);
      if (!field.exists || !meaningful(field.value)) return [];
      return [{ path, value: field.value, evidence }];
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
  const duplicateEvent = Boolean(normalizedEvent && normalizedStatus && normalizedEvent.includes(normalizedStatus));
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
    case "product_value": {
      const item = values.find((candidate) => safeLiveProductFieldPath(candidate.path));
      if (!item) return "";
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

function hasKnownOrderReference(context: ResponseValidationContext) {
  return Boolean(context.activeOrder?.requestedOrderId);
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
  const match = String(value ?? "").match(/\b(?:with|provide|share|send|include)\s+(.+?)(?:[.!?]|$)/i);
  if (!match?.[1]) return null;
  const items = match[1]
    .split(/,\s*|\s+(?:and|or)\s+/i)
    .map((item) => item.trim().replace(/^(?:the|your|an?|any)\s+/i, "").trim())
    .filter(Boolean);
  return items.length ? items : null;
}

function requirementAlreadyKnown(value: string, context: ResponseValidationContext) {
  if (/\border\s+(?:number|no\.?|id|identifier)\b/i.test(value)) return hasKnownOrderReference(context);
  if (/\bname\s+(?:used\s+(?:at|when)\s+(?:purchase|checkout|ordering)|on\s+the\s+order)\b/i.test(value)) {
    return Boolean(context.trustedCustomerIdentity?.verified);
  }
  if (/\bemail(?:\s+address)?\s+(?:used\s+(?:at|when)\s+(?:purchase|checkout|ordering)|on\s+the\s+order)\b/i.test(value)) {
    return Boolean(context.trustedCustomerIdentity?.verified);
  }
  return false;
}

function naturalMissingRequirementQuestion(items: string[], context: ResponseValidationContext) {
  const locale = localeFor(context);
  if (items.length === 1) {
    return locale === "da" ? `Hvad er ${items[0]}?` : `What’s the ${items[0]}?`;
  }
  const information = joinList(items, locale);
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
  if (!items?.some((item) => requirementAlreadyKnown(item, context))) return undefined;
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
  const mentionsShipping = /\b(?:shipping|returfragt|fragt|levering|versand|rückversand)\b/i.test(message);
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
  return /\b(?:return\s+)?(?:shipping|shipment)\b|\breturfragt\w*\b|\breturporto\w*\b|\bfragt\w*\b|\bpostage\b|\bversand\w*\b|\brücksendekosten\w*\b/i.test(value)
    && /\b(?:responsib|covered|cover|cost|pay|expense|ansvar|omkostning|udgift|betal|zahlt|kosten|verantwort)\w*\b/i.test(value);
}

function isRefundTiming(value: string) {
  const hasRefundTiming = /\b(?:after|within|process\w*|receipt|bank|payment|display|business\s+days?|tim(?:e|ing)|normally|efter|inden\s+for|indenfor|behandl\w*|modtag\w*|betaling|dage|normalt|igangsæt\w*|tid)\b/i.test(value);
  const hasConcreteTiming = /\b(?:after|once|when|within|received|receipt|processed|initiated|business\s+days?|bank|payment\s+provider|display|funds?|efter|når|modtaget|behandlet|igangsat|dage|bank|betalingsudbyder|wann|nach|erhalten|bearbeitet|ausgezahlt|bank)\b/i.test(value);
  return hasRefundTiming && hasConcreteTiming && (
    /\brefund\w*\b|\brefunder\w*\b|\btilbagebetaling\w*\b|\bpengene\s+tilbage\b|\berstatt\w*\b|\brückerstatt\w*\b/i.test(value)
    || /\b(?:bank|payment\s+provider|bank|betalingsudbyder)\b[\s\S]{0,50}\b(?:display|post|funds?|vise|beløb)\b/i.test(value)
  );
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

function isReturnProcessInstruction(value: string) {
  if (isRefundTiming(value)) return false;
  return /\b(?:start|initiate|request\s+(?:a\s+)?(?:return|refund|claim)|send|ship|portal|label|address|contact|email|next\s+steps?|follow\s+(?:the\s+)?instructions?|procedure|instructions?|anmod\w*|sende|returlabel|adresse|kontakt|kontaktformular\w*|formular|udfyld|næste\s+trin|beantrag\w*|schritt\w*|vorgehen)\b/i.test(value);
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
  if (focus.asksRefundTiming) cues.push("timing");
  if (focus.asksShippingResponsibility) cues.push("cost");
  if (focus.asksEligibility) cues.push("eligibility");
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
  return /\b(?:street|st\.?|road|avenue|lane|boulevard|vej|gade|strasse|straße|postcode|postal|city|by)\b|\b\d{4,6}\s+[\p{L}][\p{L}'’-]*/iu.test(value);
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

function answerCompletenessCandidates(cue: AnswerBearingCue, evidenceTexts: string[], customerMessage: string) {
  const candidates: AnswerCompletenessCandidate[] = [];
  const pushUrls = (text: string) => {
    for (const match of text.match(/https?:\/\/[^\s<>)]+/gi) ?? []) pushAnswerCompletenessCandidate(candidates, match);
  };
  const pushEmails = (text: string) => {
    for (const match of text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? []) pushAnswerCompletenessCandidate(candidates, match);
  };

  for (const evidenceText of evidenceTexts) {
    if (cue === "destination") {
      pushUrls(evidenceText);
      const lines = evidenceText.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line || !isReturnDestinationInstruction(line)) continue;
        const inline = line.match(/https?:\/\/[^\s<>)]+/i)?.[0];
        if (inline) pushAnswerCompletenessCandidate(candidates, inline);

        const afterCue = line.replace(/^.*?(?::|\bto\b|\btil\b|\ban\b|\bzu\b)\s*/i, "").trim();
        if (physicalAddressMarker(afterCue)) pushAnswerCompletenessCandidate(candidates, afterCue);

        const block: string[] = [];
        for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
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
      for (const unit of answerEvidenceUnits(evidenceText)) {
        if (isReturnDestinationInstruction(unit) && physicalAddressMarker(unit)) pushAnswerCompletenessCandidate(candidates, unit);
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

    const units = answerEvidenceUnits(evidenceText);
    if (cue === "process") {
      const nextStep = units.find((unit) => isReturnProcessInstruction(unit));
      if (nextStep) pushAnswerCompletenessCandidate(candidates, nextStep);
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

function uniqueAnswerCandidates(candidates: AnswerCompletenessCandidate[]) {
  return candidates.filter((candidate, index) => candidates.findIndex((item) => item.normalized === candidate.normalized) === index);
}

function recoveryCandidatesForRecord(
  cue: AnswerBearingCue,
  record: JsonObject,
  customerMessage: string,
): AnswerCompletenessCandidate[] {
  const candidates = answerCompletenessCandidates(cue, answerEvidenceSections([record]), customerMessage);
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
      /\b(?:pay|payer|paid|pays|responsib\w*|betaler|ansvar\w*|zahlt|verantwort\w*)\b/i.test(candidate.value)));
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
  context: Pick<ResponseValidationContext, "customerMessage" | "getResults">,
  cue: AnswerBearingCue,
): EvidenceRecovery {
  if (policyAnswerNeedsCustomerSpecificLookup(cue, context.customerMessage ?? "")) return { kind: "none" };
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
    const matches = records.flatMap((item) => {
      const candidates = mergeRecordAnswerCandidates(cue, recoveryCandidatesForRecord(cue, item.record, context.customerMessage ?? ""));
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

/**
 * Returns only propositions that can be resolved from one or more successful,
 * authoritative policy results. This is also used by the transport fallback
 * path when the SDK cannot produce a structured final output.
 */
export function recoverAuthoritativePolicyAnswer(
  context: Pick<ResponseValidationContext, "customerMessage" | "getResults">,
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
  for (const evidence of successfulKnowledgeResults(context, "search_procedures").reverse()) {
    const data = objectValue(evidence.result.data);
    if (data?.task_specificity !== "sufficient" || data?.procedure_evidence_quality !== "usable") continue;
    const results = Array.isArray(data.results) ? data.results : [];
    const matches = results.flatMap((value, resultIndex) => {
      const record = objectValue(value);
      if (!record || String(record.authority ?? "") !== "authoritative" || String(record.knowledge_type ?? "") !== "procedural") return [];
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
  if (cue === "cost") {
    const hasAmount = /(?:€|eur|usd|dkk|gbp|£|\$)\s*\d|\b\d+(?:[.,]\d+)?\s*(?:kr|dkk|eur|euro|euros?)\b/i.test(value);
    const hasNamedPayer = /\b(?:customer|merchant|store|seller|buyer|recipient|sender|you|we|kunden|forhandler|butik|sælger|køber|modtager|afsender|du|vi)\b[\s\S]{0,32}\b(?:pay|pays|paid|cover\w*|responsib\w*|betaler|ansvar\w*|zahlt|verantwort\w*)\b/i.test(value)
      || /\b(?:paid|covered|betalt|dækket|zahlt|übernommen)\s+(?:by|af|von)\s+\b(?:the\s+)?(?:customer|merchant|store|seller|buyer|kunden|forhandler|butik|sælger|køber|du|kunden)\b/i.test(value);
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
export function ensureAnswerCompleteness(
  validation: ResponseValidationResult,
  context: ResponseValidationContext,
): ResponseValidationResult {
  const focus = customerKnowledgeFocus(context.customerMessage);
  const cues = answerCompletenessMessageCues(context.customerMessage ?? "", focus);
  const completenessDiagnostics: ResponseCompletenessDiagnostics = {
    entered: true,
    cues: [...cues],
    recovery: [],
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
      const candidates = answerCompletenessCandidates(cue, answerEvidenceSections(records), context.customerMessage ?? "");
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
      const candidates = answerCompletenessCandidates(cue, answerEvidenceSections(answerEvidenceRecords(segment.basis, context, cue)), context.customerMessage ?? "");
      return candidates.length > 0 && answerCompletenessValuePresent(segment.text, cue, candidates);
    });
    if (hasAnswer) {
      recoveryResult = "skipped";
    } else {
      const segment = recoveredPolicySegment(recovery);
      if (segment && !validateSegment(segment, context, -1).length) {
        recoveredSegments.push(segment);
        recoveredTools.add("search_policy");
        recoveryResult = "recovered";
        changed = true;
      }
    }
    completenessDiagnostics.recovery.push({ type: cue, result: recoveryResult });
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
            ? composed.split(/(?<=[.!?])\s+/).some((sentenceValue) => isReturnProcessInstruction(sentenceValue) || isReturnEligibility(sentenceValue) || isReturnApprovalPrerequisite(sentenceValue))
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
        let current = isActiveSupportChannel(context.interactionChannel)
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
    if (segment.type === "fact") rendered.push(renderSingleFact(segment, context));
    else if (segment.type === "procedure_guidance") rendered.push(renderProcedureGuidance(segment, context));
    else if (segment.type === "knowledge_guidance") rendered.push(adaptCustomerFacingKnowledgeText(
      segment.text,
      context,
      { policy: isPolicyKnowledgeBasis(segment.basis, context), basis: segment.basis },
    ));
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
    else if (segment.type === "question" && segment.purpose === "enable_capability") {
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
  const response = rendered.filter(Boolean).join("\n\n");
  const hasSubstantiveSegment = segments.some((segment) => segment.type !== "acknowledgement");
  const greeting = hasSubstantiveSegment ? greetingFor(context) : null;
  return greeting && response ? `${greeting}\n\n${response}` : response;
}
