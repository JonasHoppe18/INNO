import crypto from "node:crypto";

export const GREENFIELD_KNOWLEDGE_TYPES = Object.freeze({
  policy: { label: "Policy", knowledgeType: "policy", authority: "authoritative" },
  procedure: { label: "Troubleshooting / Procedure", knowledgeType: "procedural", authority: "authoritative" },
  product: { label: "Product information", knowledgeType: "product", authority: "reference" },
  brand: { label: "Brand / Company", knowledgeType: "brand", authority: "guidance" },
});

export const GREENFIELD_KNOWLEDGE_STATUSES = Object.freeze(["draft", "published", "unpublished", "archived"]);
export const GREENFIELD_PROCEDURE_BLOCK_KINDS = Object.freeze([
  "heading",
  "prerequisite",
  "instruction",
  "note",
  "warning",
  "condition",
  "expected_result",
  "alternative",
]);

const MAX_TITLE_LENGTH = 180;
const MAX_CONTENT_LENGTH = 50_000;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clean(value) {
  return String(value ?? "").trim();
}

function procedureTaskKey(value) {
  return clean(value).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
}

function normalizeProcedureBlocks(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const object = objectValue(item);
    const text = clean(object.text ?? item);
    if (!text) return null;
    const kind = GREENFIELD_PROCEDURE_BLOCK_KINDS.includes(clean(object.kind).toLowerCase())
      ? clean(object.kind).toLowerCase()
      : "instruction";
    const listStyle = object.list_style === "ordered" || object.listStyle === "ordered"
      ? "ordered"
      : object.list_style === "unordered" || object.listStyle === "unordered"
        ? "unordered"
        : null;
    return { kind, text, list_style: listStyle };
  }).filter(Boolean).slice(0, 128);
}

export function lifecycleStatus(row) {
  const explicit = clean(objectValue(row?.metadata).lifecycle_status).toLowerCase();
  if (GREENFIELD_KNOWLEDGE_STATUSES.includes(explicit)) return explicit;
  // Existing imported greenfield corpus predates the UI and has no lifecycle
  // marker. Keep that corpus available while new records are explicit.
  return "published";
}

export function isMerchantAuthored(row) {
  return clean(row?.source_kind).toLowerCase() === "merchant_authored";
}

export function sourceLabel(row) {
  if (isMerchantAuthored(row)) return "Merchant";
  const explicit = clean(row?.source_label);
  if (explicit) return explicit;
  const kind = clean(row?.source_kind).toLowerCase();
  if (kind.includes("shopify") || kind === "product") return "Shopify";
  if (kind.includes("website") || kind.includes("web")) return "Website";
  if (kind.includes("document") || kind.includes("file")) return "Document";
  if (kind.includes("historic") || kind.includes("ticket") || kind.includes("zendesk")) return "Historical support";
  return "Imported";
}

function uiTypeForRecord(row) {
  const match = Object.entries(GREENFIELD_KNOWLEDGE_TYPES).find(([, value]) => value.knowledgeType === row?.knowledge_type);
  return match?.[0] || "other";
}

function normalizeApplicability(value) {
  const raw = objectValue(value);
  const kind = raw.kind === "products" ? "products" : "all";
  const productIds = Array.isArray(raw.product_ids)
    ? Array.from(new Set(raw.product_ids.map(clean).filter(Boolean))).slice(0, 50)
    : [];
  return { kind: kind === "products" && productIds.length ? "products" : "all", product_ids: productIds };
}

export function serializeGreenfieldKnowledge(row) {
  const metadata = objectValue(row?.metadata);
  const applicability = normalizeApplicability(metadata.applies_to);
  const structuredData = objectValue(row?.structured_data);
  const procedure = objectValue(structuredData.procedure);
  const procedureBlocks = normalizeProcedureBlocks(structuredData.procedure_blocks ?? structuredData.procedure_steps ?? procedure.blocks);
  const task = objectValue(procedure.task);
  return {
    id: clean(row?.id),
    title: clean(row?.title),
    content: clean(row?.content),
    type: uiTypeForRecord(row),
    type_label: GREENFIELD_KNOWLEDGE_TYPES[uiTypeForRecord(row)]?.label || "Other",
    status: lifecycleStatus(row),
    applies_to: applicability,
    source: {
      label: sourceLabel(row),
      kind: clean(row?.source_kind),
      editable: isMerchantAuthored(row),
      uri: clean(row?.source_uri) || null,
      id: clean(row?.source_uuid) || null,
      version: row?.source_version == null ? null : Number(row.source_version),
      record_key: clean(row?.source_record_key) || null,
      location: objectValue(row?.source_location),
    },
    procedure: row?.knowledge_type === "procedural" ? {
      task_key: clean(row?.task_key || structuredData.task_key || task.key) || null,
      task_title: clean(task.title || row?.title) || null,
      customer_aliases: Array.isArray(row?.customer_aliases) ? row.customer_aliases.map(clean).filter(Boolean) : (Array.isArray(structuredData.customer_language_aliases) ? structuredData.customer_language_aliases.map(clean).filter(Boolean) : []),
      blocks: procedureBlocks,
    } : null,
    updated_at: row?.updated_at || null,
    created_at: row?.created_at || null,
    published_at: row?.published_at || null,
    internal: {
      authority: clean(row?.authority),
      source_label: clean(row?.source_label) || null,
      observed_at: row?.observed_at || null,
      expires_at: row?.expires_at || null,
    },
  };
}

export function validateKnowledgePayload(body, { existing = null } = {}) {
  const input = objectValue(body);
  const title = clean(input.title);
  const content = clean(input.content);
  const type = clean(input.type).toLowerCase() || (existing ? uiTypeForRecord(existing) : "");
  const status = clean(input.status).toLowerCase() || (existing ? lifecycleStatus(existing) : "draft");
  const appliesToInput = input.applies_to ?? input.appliesTo ?? existing?.metadata?.applies_to;
  const appliesTo = normalizeApplicability(appliesToInput);
  const existingStructured = objectValue(existing?.structured_data);
  const procedureInput = objectValue(input.procedure);
  let procedureBlocks = normalizeProcedureBlocks(
    input.procedure_blocks ?? procedureInput.blocks ?? existingStructured.procedure_blocks ?? existingStructured.procedure_steps,
  );
  // Keep the existing API compatible for legacy callers; new native procedure
  // entries use explicit blocks, while old free text remains one instruction
  // block until a merchant edits it.
  if (type === "procedure" && !procedureBlocks.length && content) {
    procedureBlocks = [{ kind: "instruction", text: content, list_style: null }];
  }
  const taskKey = procedureTaskKey(input.task_key ?? procedureInput.task_key ?? existing?.task_key ?? existingStructured.task_key ?? title);
  const customerAliases = Array.from(new Set([
    ...(Array.isArray(input.customer_aliases) ? input.customer_aliases : []),
    ...(Array.isArray(procedureInput.customer_aliases) ? procedureInput.customer_aliases : []),
    ...(Array.isArray(existing?.customer_aliases) ? existing.customer_aliases : []),
  ].map(clean).filter(Boolean))).slice(0, 20);
  const errors = [];

  if (!title) errors.push("Title is required.");
  if (title.length > MAX_TITLE_LENGTH) errors.push(`Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  if (!content) errors.push("Content is required.");
  if (content.length > MAX_CONTENT_LENGTH) errors.push(`Content must be ${MAX_CONTENT_LENGTH} characters or fewer.`);
  if (!GREENFIELD_KNOWLEDGE_TYPES[type]) errors.push("Choose a supported knowledge type.");
  if (!GREENFIELD_KNOWLEDGE_STATUSES.includes(status)) errors.push("Choose a supported knowledge status.");
  if (objectValue(appliesToInput).kind === "products" && appliesTo.kind !== "products") {
    errors.push("Select at least one scoped product, or choose All products.");
  }
  if (type === "procedure" && !procedureBlocks.length) errors.push("Add at least one procedure block.");

  return {
    valid: errors.length === 0,
    errors,
    value: { title, content, type, status, appliesTo, procedureBlocks, taskKey, customerAliases },
  };
}

export function buildMerchantKnowledgeSource({ value, existing = null, products = [], now = new Date() }) {
  const classification = GREENFIELD_KNOWLEDGE_TYPES[value.type];
  const nowIso = now.toISOString();
  const sourceId = clean(existing?.source_id) || `merchant-ui:${crypto.randomUUID()}`;
  const productRows = value.appliesTo.kind === "products"
    ? products.map((product) => ({
        id: clean(product.id),
        title: clean(product.title),
        external_id: clean(product.external_id) || null,
      }))
    : [];
  const metadata = {
    ...objectValue(existing?.metadata),
    lifecycle_status: value.status,
    applies_to: {
      kind: value.appliesTo.kind,
      product_ids: value.appliesTo.product_ids,
      products: productRows,
    },
    managed_by: "greenfield_knowledge_ui",
  };

  const structuredData = objectValue(existing?.structured_data);
  if (value.type === "procedure") {
    structuredData.procedure = {
      ...objectValue(structuredData.procedure),
      task: {
        key: value.taskKey,
        title: value.title,
      },
      aliases: value.customerAliases,
      blocks: value.procedureBlocks,
    };
    structuredData.procedure_blocks = value.procedureBlocks;
    structuredData.procedure_steps = value.procedureBlocks;
    structuredData.task_key = value.taskKey;
    structuredData.customer_language_aliases = value.customerAliases;
  }

  return {
    sourceKind: "merchant_authored",
    sourceId,
    title: value.title,
    content: value.content,
    sourceLabel: "Merchant",
    knowledgeType: classification.knowledgeType,
    authority: classification.authority,
    structuredData,
    publishedAt: value.status === "published" ? (existing?.published_at || nowIso) : null,
    observedAt: nowIso,
    expiresAt: value.status === "published" ? null : nowIso,
    metadata,
    sourceVersion: existing?.source_version ?? null,
    sourceContentHash: existing?.source_content_hash ?? null,
    sourceLocation: existing?.source_location ?? null,
    sourceRecordKey: existing?.source_record_key ?? null,
    taskKey: value.type === "procedure" ? value.taskKey : null,
    customerAliases: value.type === "procedure" ? value.customerAliases : [],
  };
}

export function productIdsFromPayload(value) {
  return value.appliesTo.kind === "products" ? value.appliesTo.product_ids : [];
}

export { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH };
