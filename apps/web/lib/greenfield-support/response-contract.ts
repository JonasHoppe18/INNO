import { z } from "zod";
import type { CapabilityManifest, JsonObject, ToolExecutionResult } from "./types";

const BasisSchema = z.object({
  result_id: z.string().min(1),
  field_paths: z.array(z.string()).max(32),
}).strict();

const FactSchema = z.object({
  type: z.literal("fact"),
  text: z.string().min(1),
  basis: BasisSchema,
}).strict();

const QuestionSchema = z.object({
  type: z.literal("question"),
  text: z.string().min(1),
  follow_up_capability: z.string().nullable(),
  follow_up_fields: z.array(z.string()),
}).strict();

const LimitationSchema = z.object({
  type: z.literal("limitation"),
  text: z.string().min(1),
  basis: BasisSchema,
}).strict();

const ActionOfferSchema = z.object({
  type: z.literal("action_offer"),
  text: z.string().min(1),
  capability: z.string().min(1),
  mode: z.literal("proposal"),
}).strict();

const KnowledgeGuidanceSchema = z.object({
  type: z.literal("knowledge_guidance"),
  text: z.string().min(1),
  basis: BasisSchema,
}).strict();

export const ResponseSegmentSchema = z.discriminatedUnion("type", [
  FactSchema,
  QuestionSchema,
  LimitationSchema,
  ActionOfferSchema,
  KnowledgeGuidanceSchema,
]);

export const StructuredResponseSchema = z.object({
  segments: z.array(ResponseSegmentSchema).min(1).max(12),
}).strict();

export type ResponseSegment = z.infer<typeof ResponseSegmentSchema>;
export type StructuredResponse = z.infer<typeof StructuredResponseSchema>;

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

export interface ResponseValidationResult {
  schemaValid: boolean;
  allValid: boolean;
  approvedSegments: ResponseSegment[];
  rejectedSegments: Array<{ index: number; type?: string; issues: ResponseValidationIssue[] }>;
  issues: ResponseValidationIssue[];
  parsed: StructuredResponse | null;
}

export interface ResponseValidationContext {
  manifest: CapabilityManifest;
  getResult: (resultId: string) => ResponseEvidenceRecord | undefined;
}

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
  const authoritative = results.some((item) => {
    const record = objectValue(item);
    return record && ["authoritative", "operational", "guidance"].includes(String(record.authority ?? ""));
  });
  if (!authoritative) {
    return [{ index, code: "knowledge_authority_insufficient", message: "Historical/example knowledge cannot authorize guidance." }];
  }
  return [];
}

function validateQuestion(segment: Extract<ResponseSegment, { type: "question" }>, context: ResponseValidationContext, index: number) {
  if (!segment.follow_up_capability) return [];
  const known = [...context.manifest.readTools, ...context.manifest.proposalOnlyTools].includes(segment.follow_up_capability);
  return known
    ? []
    : [{ index, code: "unknown_follow_up_capability", message: "The question promises a follow-up capability that is not available in this run." }];
}

function validateSegment(segment: ResponseSegment, context: ResponseValidationContext, index: number): ResponseValidationIssue[] {
  switch (segment.type) {
    case "fact":
      return validateBasis(segment.basis, context, { requireOk: true, requireMeaningfulFields: true, scope: "data" }, index);
    case "knowledge_guidance":
      return validateKnowledgeBasis(segment.basis, context, index);
    case "limitation": {
      const evidence = resultFor(segment.basis, context);
      if (!evidence) return [{ index, code: "unknown_result_id", message: "The limitation references a tool result from outside this run." }];
      return validateBasis(segment.basis, context, { requireOk: false, requireMeaningfulFields: false, scope: "result" }, index);
    }
    case "action_offer":
      return context.manifest.proposalOnlyTools.includes(segment.capability)
        ? []
        : [{ index, code: "unknown_action_capability", message: "The offered action is not a current proposal-only capability." }];
    case "question":
      return validateQuestion(segment, context, index);
    default:
      return [{ index, code: "unknown_segment_type", message: "The response segment type is not supported." }];
  }
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

export function summarizeResponseValidation(result: ResponseValidationResult) {
  return {
    schema_valid: result.schemaValid,
    all_valid: result.allValid,
    approved_count: result.approvedSegments.length,
    rejected_segments: result.rejectedSegments.map(({ index, type, issues }) => ({
      index,
      type: type ?? null,
      issues: issues.map(({ code, message }) => ({ code, message })),
    })),
  };
}

/** Renders only segments accepted by the deterministic validator. */
export function renderResponseSegments(segments: ResponseSegment[]): string {
  return segments.map((segment) => segment.text.trim()).filter(Boolean).join("\n\n");
}
