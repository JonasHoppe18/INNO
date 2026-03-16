
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/server/shopify-oauth";
import { applyScope, resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

function stripHtml(value = "") {
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

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function fetchShopifyCredentials(serviceClient, scope, requestedShopId) {
  const data = await resolveScopedShop(serviceClient, scope, requestedShopId, {
    platform: "shopify",
    fields: "id, shop_domain, access_token_encrypted, platform, workspace_id",
    missingShopMessage: "shop_id is required for Shopify knowledge sync.",
  });
  if (!data?.id || !data?.shop_domain || !data?.access_token_encrypted) {
    throw new Error("Missing Shopify credentials.");
  }
  return {
    shop_id: data.id,
    workspace_id: data.workspace_id ?? null,
    platform: data.platform,
    shop_domain: data.shop_domain,
    access_token: decryptString(data.access_token_encrypted),
  };
}

async function fetchShopifyProducts({ domain, accessToken }) {
  const products = [];
  let pageInfo = null;
  const limit = 50;
  for (let i = 0; i < 5; i++) {
    const url = new URL(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
    url.searchParams.set("status", "active");
    url.searchParams.set("limit", String(limit));
    if (pageInfo) url.searchParams.set("page_info", pageInfo);
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Shopify products returned ${res.status}`);
    }
    const payload = await res.json().catch(() => null);
    const items = Array.isArray(payload?.products) ? payload.products : [];
    products.push(...items);
    const linkHeader = res.headers.get("link") ?? "";
    const next = extractNextPageInfo(linkHeader);
    if (!next) break;
    pageInfo = next;
  }
  return products;
}

function extractNextPageInfo(linkHeader = "") {
  const parts = linkHeader.split(",");
  for (const part of parts) {
    if (part.includes('rel="next"')) {
      const match = part.match(/<([^>]+)>/);
      if (!match?.[1]) continue;
      try {
        const url = new URL(match[1]);
        return url.searchParams.get("page_info");
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function embedText(text) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing.");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      model: OPENAI_EMBEDDING_MODEL,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.error?.message || `OpenAI returned ${res.status}`;
    throw new Error(message);
  }
  const vector = json?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("Embedding not returned.");
  return vector;
}

function buildProductContext(product) {
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
      return `- Variant: ${name}${sku ? ` | SKU: ${sku}` : ""}${price ? ` | Price: ${price}` : ""}${
        Number.isFinite(stock) ? ` | Inventory: ${stock}` : ""
      }`;
    })
    .join("\n");

  const parts = [
    `Product: ${title}`,
    vendor ? `Vendor: ${vendor}` : "",
    productType ? `Type: ${productType}` : "",
    tags ? `Tags: ${tags}` : "",
    description ? `Description:\n${description}` : "",
    variantLines ? `Variants:\n${variantLines}` : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}

function chunkText(text, size = 1200, overlap = 200) {
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

function buildKnowledgeHash(product, context) {
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

async function loadExistingProductHashes(serviceClient, shopId) {
  const { data, error } = await serviceClient
    .from("agent_knowledge")
    .select("metadata")
    .eq("shop_id", shopId)
    .eq("source_provider", "shopify_product");
  if (error) throw new Error(error.message);

  const byProduct = new Map();
  for (const row of data || []) {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const productId = String(metadata?.product_id || "").trim();
    const hash = String(metadata?.content_hash || "").trim();
    if (productId && hash && !byProduct.has(productId)) {
      byProduct.set(productId, hash);
    }
  }
  return byProduct;
}

async function syncShopify({ serviceClient, creds }) {
  const domain = creds.shop_domain.replace(/^https?:\/\//, "");
  const products = await fetchShopifyProducts({ domain, accessToken: creds.access_token });
  const existingHashes = await loadExistingProductHashes(serviceClient, creds.shop_id);

  const rows = [];
  let indexed = 0;
  let unchanged = 0;

  for (const product of products) {
    const productId = String(product?.id ?? "").trim();
    if (!productId) continue;
    const title = product?.title ?? "Untitled product";
    const description = stripHtml(
      product?.body_html || product?.body || product?.description || product?.body_text || ""
    );
    const variant = Array.isArray(product?.variants) ? product.variants[0] : null;
    const price = variant?.price ?? variant?.compare_at_price ?? "";
    const context = buildProductContext(product);
    const contentHash = buildKnowledgeHash(product, context);

    rows.push({
      shop_ref_id: creds.shop_id,
      external_id: productId,
      platform: "shopify",
      title,
      description,
      price: price || null,
    });

    const previousHash = existingHashes.get(productId);
    if (previousHash && previousHash === contentHash) {
      unchanged += 1;
      continue;
    }

    const chunks = chunkText(context);
    if (!chunks.length) {
      unchanged += 1;
      continue;
    }

    // Replace prior product chunks to avoid duplicates across resyncs.
    await serviceClient
      .from("agent_knowledge")
      .delete()
      .eq("shop_id", creds.shop_id)
      .eq("source_provider", "shopify_product")
      .eq("metadata->>product_id", productId);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      const embedding = await embedText(chunk);
      const { error: insertError } = await serviceClient.from("agent_knowledge").insert({
        workspace_id: creds.workspace_id,
        shop_id: creds.shop_id,
        content: chunk,
        source_type: "document",
        source_provider: "shopify_product",
        metadata: {
          product_id: productId,
          title: String(title || "").trim(),
          price: price || null,
          handle: String(product?.handle || "").trim() || null,
          product_updated_at: product?.updated_at || null,
          url: product?.handle ? `https://${domain}/products/${product.handle}` : null,
          content_hash: contentHash,
          chunk_index: chunkIndex,
          chunk_count: chunks.length,
        },
        embedding,
      });
      if (insertError) throw new Error(insertError.message);
    }
    indexed += 1;
  }

  if (rows.length) {
    const rowsWithEmbedding = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        embedding: await embedText(
          `Product: ${row.title}. Price: ${row.price || "N/A"}. Details: ${row.description || "No details."}`
        ),
      }))
    );
    const { error } = await serviceClient.from("shop_products").upsert(rowsWithEmbedding, {
      onConflict: "shop_ref_id,external_id,platform",
    });
    if (error) {
      const noConstraint = /no unique|on conflict/i.test(String(error.message || ""));
      if (!noConstraint) throw new Error(error.message);
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const rowWithEmbedding = rowsWithEmbedding[i];
        const { data: existing, error: existingError } = await serviceClient
          .from("shop_products")
          .select("id")
          .eq("shop_ref_id", row.shop_ref_id)
          .eq("external_id", row.external_id)
          .eq("platform", row.platform)
          .maybeSingle();
        if (existingError) throw new Error(existingError.message);
        if (existing?.id) {
          const { error: updateError } = await serviceClient
            .from("shop_products")
            .update(rowWithEmbedding)
            .eq("id", existing.id);
          if (updateError) throw new Error(updateError.message);
        } else {
          const { error: insertError } = await serviceClient.from("shop_products").insert(rowWithEmbedding);
          if (insertError) throw new Error(insertError.message);
        }
      }
    }
  }

  return {
    synced: rows.length,
    indexed,
    unchanged,
  };
}

async function fetchActiveShopIds(serviceClient, scope) {
  let query = serviceClient
    .from("shops")
    .select("id")
    .eq("platform", "shopify")
    .is("uninstalled_at", null);
  query = applyScope(query, scope, { workspaceColumn: "workspace_id", userColumn: "owner_user_id" });
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map((row) => row?.id).filter(Boolean);
}

async function countIndexedKnowledgeProducts(serviceClient, shopIds) {
  if (!shopIds.length) return 0;
  const { data, error } = await serviceClient
    .from("agent_knowledge")
    .select("metadata")
    .in("shop_id", shopIds)
    .eq("source_provider", "shopify_product");
  if (error) throw new Error(error.message);

  const productIds = new Set();
  for (const row of data || []) {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const productId = String(metadata?.product_id || "").trim();
    if (productId) productIds.add(productId);
  }
  return productIds.size;
}

async function fetchProductsPreview(serviceClient, shopIds, limit = 100) {
  if (!shopIds.length) return [];
  const normalizedLimit = Math.max(1, Math.min(limit, 300));

  // Primary source: structured shop_products table.
  const { data, error } = await serviceClient
    .from("shop_products")
    .select("external_id, title, price")
    .in("shop_ref_id", shopIds)
    .limit(normalizedLimit);

  if (!error && Array.isArray(data) && data.length) {
    const productIds = data
      .map((row) => String(row?.external_id || "").trim())
      .filter(Boolean);

    const { data: knowledgeRows } = await serviceClient
      .from("agent_knowledge")
      .select("metadata, created_at")
      .in("shop_id", shopIds)
      .eq("source_provider", "shopify_product")
      .in("metadata->>product_id", productIds)
      .order("created_at", { ascending: false })
      .limit(normalizedLimit * 8);

    const metaByProduct = new Map();
    for (const row of knowledgeRows || []) {
      const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const productId = String(metadata?.product_id || "").trim();
      if (!productId || metaByProduct.has(productId)) continue;
      metaByProduct.set(productId, {
        updated_at: metadata?.product_updated_at || row?.created_at || null,
        price: metadata?.price ?? null,
      });
    }

    return data.map((row) => {
      const productId = String(row?.external_id || "").trim();
      const meta = metaByProduct.get(productId);
      return {
        external_id: row?.external_id || productId,
        title: row?.title || meta?.title || "Untitled product",
        price: row?.price ?? meta?.price ?? null,
        updated_at: meta?.updated_at || null,
      };
    });
  }

  // Fallback: derive preview from agent_knowledge metadata.
  const { data: knowledgeRows, error: knowledgeError } = await serviceClient
    .from("agent_knowledge")
    .select("metadata, created_at")
    .in("shop_id", shopIds)
    .eq("source_provider", "shopify_product")
    .order("created_at", { ascending: false })
    .limit(normalizedLimit * 8);

  if (knowledgeError) {
    throw new Error(knowledgeError.message || error?.message || "Could not load products preview.");
  }

  const byProduct = new Map();
  for (const row of knowledgeRows || []) {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const productId = String(metadata?.product_id || "").trim();
    if (!productId || byProduct.has(productId)) continue;
    byProduct.set(productId, {
      external_id: productId,
      title: String(metadata?.title || "Untitled product"),
      price: metadata?.price ?? null,
      updated_at: metadata?.product_updated_at || row?.created_at || null,
    });
    if (byProduct.size >= normalizedLimit) break;
  }

  return Array.from(byProduct.values());
}

export async function GET(request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase service key missing" }, { status: 500 });
  }

  const serviceClient = createServiceClient();
  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
    if (!scope?.workspaceId && !scope?.supabaseUserId) {
      throw new Error("Could not resolve workspace/user scope.");
    }
    const requestedShopId = String(request?.nextUrl?.searchParams?.get("shop_id") || "").trim();
    const shop = await fetchShopifyCredentials(serviceClient, scope, requestedShopId);
    const shopIds = [shop.shop_id];
    const count = await countIndexedKnowledgeProducts(serviceClient, shopIds);
    const includeProducts = String(request?.nextUrl?.searchParams?.get("include_products") || "") === "1";
    if (!includeProducts) {
      return NextResponse.json({ success: true, count }, { status: 200 });
    }

    const products = await fetchProductsPreview(serviceClient, shopIds, 150);
    return NextResponse.json({ success: true, count, products }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Count failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase service key missing" }, { status: 500 });
  }

  const serviceClient = createServiceClient();
  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
    if (!scope?.workspaceId && !scope?.supabaseUserId) {
      throw new Error("Could not resolve workspace/user scope.");
    }
    const body = await request.json().catch(() => ({}));
    const requestedShopId = String(body?.shop_id || "").trim();
    const shop = await fetchShopifyCredentials(serviceClient, scope, requestedShopId);
    if (shop.platform && shop.platform !== "shopify") {
      throw new Error("Platform not supported yet");
    }
    console.info(JSON.stringify({
      event: "knowledge.sync.start",
      provider: "shopify_product",
      requested_shop_id: requestedShopId || null,
      resolved_shop_id: shop.shop_id,
      workspace_id: shop.workspace_id ?? null,
    }));
    const result = await syncShopify({ serviceClient, creds: shop });
    console.info(JSON.stringify({
      event: "knowledge.sync.wrote",
      provider: "shopify_product",
      source_provider: "shopify_product",
      resolved_shop_id: shop.shop_id,
      workspace_id: shop.workspace_id ?? null,
      fetched_count: Number(result?.synced ?? 0),
      rows_written: Number(result?.indexed ?? 0),
      rows_updated: Number(result?.indexed ?? 0),
      rows_deleted: 0,
    }));
    return NextResponse.json({ success: true, platform: "shopify", ...result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    console.error(JSON.stringify({ event: "knowledge.sync.error", provider: "shopify_product", error: message }));
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
