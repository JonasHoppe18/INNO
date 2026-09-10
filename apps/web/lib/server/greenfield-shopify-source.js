import { fetchShopifyPolicies, stripHtml } from "@/lib/server/shopify-policy-sync";
import { fetchShopifyProducts } from "@/lib/server/shopify-product-fetch";

const SOURCE_KIND = "shopify";
const SOURCE_LABEL = "Shopify";

function clean(value) {
  return String(value ?? "").trim();
}

function cleanDomain(value) {
  return clean(value).replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}

function policyKind(policy) {
  const value = [policy?.policy_type, policy?.handle, policy?.title].map(clean).join(" ").toLowerCase();
  if (value.includes("refund") || value.includes("return")) return "refund";
  if (value.includes("shipping") || value.includes("delivery")) return "shipping";
  if (value.includes("privacy")) return "privacy";
  if (value.includes("term")) return "terms";
  return slug(policy?.policy_type || policy?.handle || "policy") || "policy";
}

function policyContent(policy) {
  return stripHtml(policy?.body || policy?.body_html || policy?.content || "");
}

function policyIdentity(policy) {
  return clean(policy?.id) || clean(policy?.handle) || `${policyKind(policy)}:${slug(policy?.title) || "policy"}`;
}

function productDescription(product) {
  return stripHtml(product?.body_html || product?.body || product?.description || product?.body_text || "");
}

function productUri(domain, publicStorefrontDomain, handle) {
  return handle ? `https://${publicStorefrontDomain || domain}/products/${encodeURIComponent(handle)}` : null;
}

function normalizePolicies(policies, { domain }) {
  const seen = new Set();
  return (Array.isArray(policies) ? policies : [])
    .map((policy) => {
      const identity = policyIdentity(policy);
      const keyBase = `policy:${identity}`;
      let recordKey = keyBase;
      let suffix = 2;
      while (seen.has(recordKey)) recordKey = `${keyBase}:${suffix++}`;
      seen.add(recordKey);
      const content = policyContent(policy);
      const title = clean(policy?.title) || `${policyKind(policy)} policy`;
      const uri = clean(policy?.url || policy?.public_url || policy?.shop_url) || null;
      return {
        recordKey,
        title,
        content,
        sourceUri: uri,
        section: `Policy: ${title}`,
        metadata: {
          source_provider: SOURCE_KIND,
          shop_domain: domain,
          shopify_policy_type: policyKind(policy),
          shopify_object_id: clean(policy?.id) || null,
          shopify_handle: clean(policy?.handle) || null,
          source_url: uri,
        },
        sourceLocation: { kind: "policy", section: title, url: uri },
        eligible: Boolean(content),
      };
    })
    .filter((policy) => policy.eligible)
    .sort((left, right) => left.recordKey.localeCompare(right.recordKey));
}

function normalizeProducts(products, { domain, publicStorefrontDomain }) {
  const seen = new Set();
  return (Array.isArray(products) ? products : [])
    .map((product) => {
      const externalId = clean(product?.id);
      if (!externalId) return null;
      const title = clean(product?.title) || `Product ${externalId}`;
      const handle = clean(product?.handle) || null;
      const description = productDescription(product);
      const content = [title, description, clean(product?.product_type) && `Product type: ${clean(product.product_type)}`, clean(product?.vendor) && `Brand: ${clean(product.vendor)}`]
        .filter(Boolean)
        .join("\n\n");
      const keyBase = `product:${externalId}`;
      let recordKey = keyBase;
      let suffix = 2;
      while (seen.has(recordKey)) recordKey = `${keyBase}:${suffix++}`;
      seen.add(recordKey);
      const uri = productUri(domain, publicStorefrontDomain, handle);
      return {
        recordKey,
        title,
        content,
        sourceUri: uri,
        section: `Product: ${title}`,
        metadata: {
          source_provider: SOURCE_KIND,
          shop_domain: domain,
          shopify_object_id: externalId,
          shopify_handle: handle,
          source_url: uri,
          applies_to: {
            kind: "products",
            product_ids: [externalId],
            product_models: [title, handle].filter(Boolean),
          },
        },
        structuredData: {
          product: {
            external_id: externalId,
            handle,
            vendor: clean(product?.vendor) || null,
            product_type: clean(product?.product_type) || null,
          },
          applies_to: { product_models: [title, handle].filter(Boolean) },
        },
        sourceLocation: { kind: "product", section: title, url: uri },
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.recordKey.localeCompare(right.recordKey));
}

/**
 * Convert the existing Shopify read responses into one deterministic V1
 * source. This function does not call Shopify or write to any persistence
 * model; it only creates source candidates for SupabaseKnowledgeStore.
 */
export function buildShopifyKnowledgeSource({
  shopId,
  shopDomain,
  publicStorefrontDomain = "",
  policies = [],
  products = [],
  observedAt = new Date().toISOString(),
}) {
  const domain = cleanDomain(shopDomain);
  const sourceId = `shopify:${clean(shopId)}`;
  if (!clean(shopId) || !domain) throw new Error("Shopify source requires a verified shop and domain.");
  const policyCandidates = normalizePolicies(policies, { domain });
  const productCandidates = normalizeProducts(products, {
    domain,
    publicStorefrontDomain: cleanDomain(publicStorefrontDomain),
  });
  const candidates = [
    ...policyCandidates.map((candidate) => ({
      recordKey: candidate.recordKey,
      title: candidate.title,
      content: candidate.content,
      knowledgeType: "policy",
      authority: "authoritative",
      metadata: { ...candidate.metadata, lifecycle_status: "draft", observed_at: observedAt },
      sourceLocation: candidate.sourceLocation,
    })),
    ...productCandidates.map((candidate) => ({
      recordKey: candidate.recordKey,
      title: candidate.title,
      content: candidate.content,
      knowledgeType: "product",
      authority: "reference",
      structuredData: candidate.structuredData,
      metadata: { ...candidate.metadata, lifecycle_status: "draft", observed_at: observedAt },
      sourceLocation: candidate.sourceLocation,
    })),
  ].sort((left, right) => left.recordKey.localeCompare(right.recordKey));
  const sourceContent = candidates
    .map((candidate) => `## ${candidate.title}\n\n${candidate.content}`)
    .join("\n\n");
  const storeDomain = cleanDomain(publicStorefrontDomain) || domain;
  return {
    sourceKind: SOURCE_KIND,
    sourceId,
    title: "Shopify",
    content: sourceContent,
    sourceUri: `https://${storeDomain}`,
    sourceLabel: SOURCE_LABEL,
    observedAt,
    metadata: {
      source_provider: SOURCE_KIND,
      shop_domain: domain,
      shopify_shop_id: clean(shopId),
      last_synced_at: observedAt,
      fetched_policy_count: Array.isArray(policies) ? policies.length : 0,
      imported_policy_count: policyCandidates.length,
      fetched_product_count: Array.isArray(products) ? products.length : 0,
      imported_product_count: productCandidates.length,
    },
    candidates,
  };
}

export async function fetchShopifyKnowledge({ shopId, shopDomain, accessToken, publicStorefrontDomain = "" }) {
  const [policies, products] = await Promise.all([
    fetchShopifyPolicies({ domain: shopDomain, accessToken }),
    fetchShopifyProducts({ domain: shopDomain, accessToken }),
  ]);
  return {
    policies,
    products,
    source: buildShopifyKnowledgeSource({
      shopId,
      shopDomain,
      publicStorefrontDomain,
      policies,
      products,
    }),
  };
}

export { SOURCE_KIND, SOURCE_LABEL, policyKind, policyContent };
