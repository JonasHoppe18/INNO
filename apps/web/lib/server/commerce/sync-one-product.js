import { createHash } from "node:crypto";

export function stripHtml(value = "") {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildProductContext(product, { currency } = {}) {
  // Prices are in the shop's base currency; label them so the writer never
  // quotes a bare number that the reader (or the writer) assumes is DKK.
  const cur = currency ? `${String(currency).trim().toUpperCase()} ` : "";
  const title = String(product?.title || "Untitled product").trim();
  const descriptionRaw =
    product?.body_html || product?.body || product?.description || product?.body_text || "";
  const description = stripHtml(descriptionRaw);
  const vendor = String(product?.vendor || "").trim();
  const productType = String(product?.product_type || "").trim();
  const tags = Array.isArray(product?.tags)
    ? product.tags.join(", ")
    : String(product?.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .join(", ");
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variantLines = variants
    .slice(0, 8)
    .map((variant) => {
      const name = String(variant?.title || "Default");
      const sku = String(variant?.sku || "").trim();
      const price = String(variant?.price ?? variant?.compare_at_price ?? "").trim();
      const stock = variant?.inventory_quantity;
      return `- Variant: ${name}${sku ? ` | SKU: ${sku}` : ""}${price ? ` | Price: ${cur}${price}` : ""}${
        Number.isFinite(stock) ? ` | Inventory: ${stock}` : ""
      }`;
    })
    .join("\n");

  const firstVariantPrice = String(
    variants[0]?.price ?? variants[0]?.compare_at_price ?? "",
  ).trim();

  const parts = [
    `Product: ${title}`,
    vendor ? `Vendor: ${vendor}` : "",
    firstVariantPrice ? `Price: ${cur}${firstVariantPrice}` : "",
    productType ? `Type: ${productType}` : "",
    tags ? `Tags: ${tags}` : "",
    description ? `Description:\n${description}` : "",
    variantLines ? `Variants:\n${variantLines}` : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}

export function chunkText(text, size = 1200, overlap = 200) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];
  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + size);
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks.filter(Boolean).slice(0, 6);
}

export function buildKnowledgeHash(product, context) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: product?.id ?? null,
        updated_at: product?.updated_at ?? null,
        context,
      })
    )
    .digest("hex");
}

/**
 * Sync ONE product's knowledge chunks. Deletes prior chunks for the product
 * then inserts fresh embedded chunks. Shared by the bulk sync route and the
 * Shopify product webhook. `embedText` is injected so callers control the
 * OpenAI dependency (and tests can stub it).
 */
export async function upsertProductKnowledge({
  serviceClient,
  creds,
  product,
  normalized,
  currency,
  embedText,
}) {
  const productId = String(product?.id ?? "").trim();
  if (!productId) return { indexed: false };

  const context = buildProductContext(product, { currency });
  const chunks = chunkText(context);
  if (!chunks.length) return { indexed: false };

  await serviceClient
    .from("agent_knowledge")
    .delete()
    .eq("shop_id", creds.shop_id)
    .eq("source_provider", "shopify_product")
    .eq("metadata->>product_id", productId);

  const contentHash = buildKnowledgeHash(product, context);
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const embedding = await embedText(chunk);
    const { error } = await serviceClient.from("agent_knowledge").insert({
      workspace_id: creds.workspace_id,
      shop_id: creds.shop_id,
      content: chunk,
      source_type: "document",
      source_provider: "shopify_product",
      metadata: {
        product_id: productId,
        title: String(product?.title || "").trim(),
        price: normalized?.price_display || null,
        currency: currency || null,
        handle: normalized?.handle ?? null,
        product_updated_at: normalized?.product_updated_at ?? null,
        url: normalized?.product_url ?? null,
        status: normalized?.status ?? null,
        is_placeholder_price: normalized?.is_placeholder_price ?? false,
        content_hash: contentHash,
        chunk_index: chunkIndex,
        chunk_count: chunks.length,
        issue_types: ["product_specs"],
      },
      embedding,
    });
    if (error) throw new Error(error.message);
  }
  return { indexed: true };
}
