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

export interface ResponseValidationResult {
  schemaValid: boolean;
  allValid: boolean;
  approvedSegments: ResponseSegment[];
  rejectedSegments: Array<{ index: number; type?: string; issues: ResponseValidationIssue[] }>;
  issues: ResponseValidationIssue[];
  parsed: StructuredResponse | null;
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
  /** Trusted server-side customer identity used only for first-response personalization. */
  customerName?: string | null;
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

function procedureStepPath(path: string, defaultResultIndex?: number): { resultIndex: number; stepIndex: number } | null {
  const normalized = normalizedDataPath(path);
  const match = normalized.match(/^results(?:\[(\d+)\]|\.(\d+))\.structured_data\.procedure_steps(?:\[(\d+)\]|\.(\d+))(?:\.text)?$/);
  if (match) return { resultIndex: Number(match[1] ?? match[2]), stepIndex: Number(match[3] ?? match[4]) };
  const relative = normalized.match(/^structured_data\.procedure_steps(?:\[(\d+)\]|\.(\d+))(?:\.text)?$/);
  return relative && defaultResultIndex != null
    ? { resultIndex: defaultResultIndex, stepIndex: Number(relative[1] ?? relative[2]) }
    : null;
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
    const paths = (segment.step_paths ?? []).map((path) => ({ path, parsed: procedureStepPath(path, citedResultIndex) }));
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
  return candidates.at(-1);
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
  const firstName = safeCustomerFirstName(context.customerName);
  if (!firstName) return null;
  return localeFor(context) === "da" ? `Hej ${firstName}!` : `Hi ${firstName}!`;
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
      ? "Jeg kan forberede et forslag, når de nødvendige oplysninger er på plads."
      : "I can prepare a proposal once the required information is available.";
  }
  const operation = firstSentence(definition.description).replace(/^Propose\s+/i, "");
  if (locale === "da") {
    const missing = segment.missing_arguments.length ? `Kan du sende ${listArguments(segment.missing_arguments, locale)} først? ` : "";
    return `${missing}Jeg kan forberede et forslag om ${lowerFirst(operation)}. Det bliver ikke gennemført uden din bekræftelse.`;
  }
  const missing = segment.missing_arguments.length ? `Could you share ${listArguments(segment.missing_arguments, locale)} first? ` : "";
  return `${missing}I can prepare a proposal for ${lowerFirst(operation)}. It will not be completed without your confirmation.`;
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
    .trim();
}

function adaptSupportContactInstruction(value: string) {
  const contactPattern = /\b(?:please\s+)?(?:contact|email|write\s+to|reach\s+out\s+to|send\s+(?:an\s+)?email\s+to)\s+(?:us|our\s+support(?:\s+team)?|the\s+support(?:\s+team)?|support(?:\s+team)?|\[[^\]]+\]|[^\s,.;!?]+@[^\s,.;!?]+)(?:\s+(?:via|by|through|using)\s+(?:e-?mail|the\s+contact\s+form))?(?:\s+(?:on|at)\s+(?:\[[^\]]+\]|[^\s,.;!?]+@[^\s,.;!?]+))?/gi;
  const formPattern = /\b(?:via|through|using)\s+(?:our|the)\s+contact\s+form\b/gi;
  const hasContactInstruction = contactPattern.test(value) || formPattern.test(value);
  contactPattern.lastIndex = 0;
  formPattern.lastIndex = 0;
  if (!hasContactInstruction) return value;

  let adapted = value.replace(contactPattern, "").replace(formPattern, "");
  adapted = adapted.replace(/,\s*(?=(?:with|including)\b)/i, ", please provide ");
  adapted = cleanContextualizedKnowledgeSentence(adapted);
  if (/^(?:to\s+)?(?:start|initiate|request)\s+(?:the\s+)?(?:return|refund|claim)\.?$/i.test(adapted)) return "";
  return adapted;
}

/**
 * Applies only current-conversation semantics to model-written knowledge
 * guidance. The stored source and cited evidence remain unchanged.
 */
export function adaptCustomerFacingKnowledgeText(value: string, context: ResponseValidationContext) {
  const paragraphs = String(value ?? "").split(/\n\s*\n/);
  const adapted = paragraphs.flatMap((paragraph) => {
    const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
    const next = sentences.map((sentence) => {
      let current = isActiveSupportChannel(context.interactionChannel)
        ? adaptSupportContactInstruction(sentence)
        : sentence;
      if (hasKnownOrderReference(context)) {
        current = current.replace(/\b(?:your\s+|the\s+|an?\s+)?order\s+(?:number|no\.?|id|identifier)\b/gi, "");
      }
      if (context.trustedCustomerIdentity?.verified) {
        current = current
          .replace(/\b(?:your\s+|the\s+|an?\s+)?name\s+(?:used\s+(?:at|when)\s+(?:purchase|checkout|ordering))\b/gi, "")
          .replace(/\b(?:your\s+|the\s+|an?\s+)?email(?:\s+address)?\s+(?:used\s+(?:at|when)\s+(?:purchase|checkout|ordering))\b/gi, "");
      }
      return cleanContextualizedKnowledgeSentence(current);
    }).filter(Boolean);
    return next.length ? [next.join(" ")] : [];
  });
  return adapted.join("\n\n");
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
    : (segment.step_paths ?? []).flatMap((path) => {
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

/** Renders only segments accepted by the deterministic validator, then composes related facts. */
export function renderResponseSegments(segments: ResponseSegment[], context: ResponseValidationContext): string {
  const rendered: string[] = [];
  const consumed = new Set<number>();
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
    else if (segment.type === "knowledge_guidance") rendered.push(adaptCustomerFacingKnowledgeText(segment.text, context));
    else if (segment.type === "action_offer") rendered.push(renderActionOffer(segment, context));
    else if (segment.type === "acknowledgement") rendered.push(renderAcknowledgement(segment.kind, context));
    else if (segment.type === "question" && limitedResultQuestionIsRedundant(segment, limitations)) {
      consumed.add(index);
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
