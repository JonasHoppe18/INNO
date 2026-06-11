// Shared identity helpers for product-support knowledge documents.
// A product-support document is one knowledge_documents row per shop + product,
// keyed by category "product_support" and a product-scoped document_type
// ("product_support:<product_scope>") so the existing
// (shop_id, category, document_type) unique constraint enforces uniqueness
// without a migration.

export const PRODUCT_SUPPORT_CATEGORY = "product_support";
export const PRODUCT_SUPPORT_DOCUMENT_TYPE = "product_support";
const PRODUCT_SUPPORT_TYPE_PREFIX = `${PRODUCT_SUPPORT_DOCUMENT_TYPE}:`;

export function normalizeProductScope(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function productScopeForProduct({ externalId, title } = {}) {
  const external = normalizeProductScope(externalId);
  if (external) return `product-${external}`;
  const slug = normalizeProductScope(title);
  if (!slug) {
    throw new Error("A product-support document requires a product id or title.");
  }
  return slug;
}

export function productSupportDocumentTypeForScope(productScope) {
  const scope = normalizeProductScope(productScope);
  if (!scope) {
    throw new Error("product_scope is required for product-support documents.");
  }
  return `${PRODUCT_SUPPORT_TYPE_PREFIX}${scope}`;
}

export function productScopeFromDocumentType(documentType) {
  const type = String(documentType || "").trim();
  if (!type.startsWith(PRODUCT_SUPPORT_TYPE_PREFIX)) return "";
  const scope = normalizeProductScope(type.slice(PRODUCT_SUPPORT_TYPE_PREFIX.length));
  return scope;
}

export function isProductSupportDocument({ category, documentType } = {}) {
  return (
    String(category || "").trim() === PRODUCT_SUPPORT_CATEGORY &&
    Boolean(productScopeFromDocumentType(documentType))
  );
}
