import crypto from "node:crypto";

export const GREENFIELD_KNOWLEDGE_TYPES = Object.freeze({
  policy: { label: "Policy", knowledgeType: "policy", authority: "authoritative" },
  procedure: { label: "Troubleshooting / Procedure", knowledgeType: "procedural", authority: "authoritative" },
  product: { label: "Product information", knowledgeType: "product", authority: "reference" },
  brand: { label: "Brand / Company", knowledgeType: "brand", authority: "guidance" },
});

export const GREENFIELD_KNOWLEDGE_STATUSES = Object.freeze(["draft", "published", "unpublished", "archived"]);

const MAX_TITLE_LENGTH = 180;
const MAX_CONTENT_LENGTH = 50_000;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clean(value) {
  return String(value ?? "").trim();
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
    },
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

  return {
    valid: errors.length === 0,
    errors,
    value: { title, content, type, status, appliesTo },
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

  return {
    sourceKind: "merchant_authored",
    sourceId,
    title: value.title,
    content: value.content,
    sourceLabel: "Merchant",
    knowledgeType: classification.knowledgeType,
    authority: classification.authority,
    structuredData: objectValue(existing?.structured_data),
    publishedAt: value.status === "published" ? (existing?.published_at || nowIso) : null,
    observedAt: nowIso,
    expiresAt: value.status === "published" ? null : nowIso,
    metadata,
  };
}

export function productIdsFromPayload(value) {
  return value.appliesTo.kind === "products" ? value.appliesTo.product_ids : [];
}

export { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH };
