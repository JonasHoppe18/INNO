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
const SOURCE_PROVIDER = "shopify_variant";
const MAX_VARIANT_CHUNKS = 8;
const MAX_DESCRIPTION_CHARS = 2200;

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function hashText(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

function chunkText(text, size = 900, overlap = 150) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];
  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + size);
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
    if (chunks.length >= MAX_VARIANT_CHUNKS) break;
  }
  return chunks.filter(Boolean);
}

function stripHtml(input) {
  const raw = String(input || "");
  if (!raw) return "";
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function embedTexts(texts) {
  const inputs = Array.isArray(texts) ? texts.map((v) => String(v || "").trim()).filter(Boolean) : [];
  if (!inputs.length) return [];
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing.");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: inputs,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message || `OpenAI embeddings returned ${res.status}`);
  }
  const data = Array.isArray(json?.data) ? json.data : [];
  const embeddings = data
    .sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0))
    .map((item) => item?.embedding)
    .filter((embedding) => Array.isArray(embedding));
  if (embeddings.length !== inputs.length) {
    throw new Error(`Embedding count mismatch: expected ${inputs.length}, got ${embeddings.length}`);
  }
  return embeddings;
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

async function fetchProductsWithVariants({ domain, accessToken }) {
  const products = [];
  let sinceId = null;
  for (let i = 0; i < 25; i += 1) {
    const url = new URL(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
    url.searchParams.set("limit", "100");
    url.searchParams.set(
      "fields",
      "id,title,handle,body_html,vendor,product_type,tags,status,published_at,updated_at,variants,options"
    );
    if (sinceId) url.searchParams.set("since_id", String(sinceId));
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
    if (!items.length) break;
    products.push(...items);
    sinceId = items[items.length - 1]?.id;
    if (items.length < 100) break;
  }
  return products;
}

function getSourceIdFromRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const sourceId = String(row?.source_id || "").trim();
  if (sourceId) return sourceId;
  const variantId = String(metadata?.variant_id || "").trim();
  return variantId ? `shopify:variant:${variantId}` : "";
}

function getChunkIndexFromRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const columnValue = Number(row?.chunk_index);
  if (Number.isInteger(columnValue) && columnValue >= 0) return columnValue;
  const metaValue = Number(metadata?.chunk_index);
  if (Number.isInteger(metaValue) && metaValue >= 0) return metaValue;
  return null;
}

async function loadExistingChunks(serviceClient, creds) {
  let query = serviceClient
    .from("agent_knowledge")
    .select("source_id, chunk_index, metadata")
    .eq("shop_id", creds.shop_id)
    .eq("source_provider", SOURCE_PROVIDER);
  if (creds.workspace_id) query = query.eq("workspace_id", creds.workspace_id);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const byChunk = new Map();
  const bySource = new Map();
  for (const row of data || []) {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const sourceId = getSourceIdFromRow(row);
    const chunkIndex = getChunkIndexFromRow(row);
    if (!sourceId || chunkIndex === null) continue;
    const pageHash = String(metadata?.page_hash || metadata?.content_hash || "").trim() || null;
    const chunkHash = String(metadata?.chunk_hash || "").trim() || null;
    byChunk.set(`${sourceId}:${chunkIndex}`, { page_hash: pageHash, chunk_hash: chunkHash });
    const previous = bySource.get(sourceId) || { page_hash: null, chunk_count: 0 };
    bySource.set(sourceId, {
      page_hash: previous.page_hash || pageHash || null,
      chunk_count: Math.max(previous.chunk_count, chunkIndex + 1),
    });
  }
  return { byChunk, bySource };
}

function buildVariantContext(product, variant) {
  const productTitle = String(product?.title || "").trim();
  const productHandle = String(product?.handle || "").trim();
  const vendor = String(product?.vendor || "").trim();
  const productType = String(product?.product_type || "").trim();
  const tags = String(product?.tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(", ");
  const variantTitle = String(variant?.title || "").trim();
  const sku = String(variant?.sku || "").trim();
  const barcode = String(variant?.barcode || "").trim();
  const price = String(variant?.price ?? "").trim();
  const compareAt = String(variant?.compare_at_price ?? "").trim();
  const inventory = Number.isFinite(variant?.inventory_quantity) ? String(variant.inventory_quantity) : "";
  const weight = Number.isFinite(variant?.weight) ? `${variant.weight} ${variant?.weight_unit || ""}`.trim() : "";
  const requiresShipping = typeof variant?.requires_shipping === "boolean" ? String(variant.requires_shipping) : "";
  const taxable = typeof variant?.taxable === "boolean" ? String(variant.taxable) : "";
  const options = [variant?.option1, variant?.option2, variant?.option3]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(" / ");
  const description = stripHtml(product?.body_html).slice(0, MAX_DESCRIPTION_CHARS);
  const status = String(product?.status || "").trim();
  const publishedAt = String(product?.published_at || "").trim();
  const optionNames = Array.isArray(product?.options)
    ? product.options
        .map((option) => String(option?.name || "").trim())
        .filter(Boolean)
        .join(", ")
    : "";

  const parts = [
    productTitle ? `Product: ${productTitle}` : "",
    variantTitle ? `Variant: ${variantTitle}` : "",
    description ? `Description: ${description}` : "",
    options ? `Options: ${options}` : "",
    optionNames ? `Option names: ${optionNames}` : "",
    sku ? `SKU: ${sku}` : "",
    barcode ? `Barcode: ${barcode}` : "",
    price ? `Price: ${price}` : "",
    compareAt ? `Compare at: ${compareAt}` : "",
    inventory ? `Inventory: ${inventory}` : "",
    weight ? `Weight: ${weight}` : "",
    requiresShipping ? `Requires shipping: ${requiresShipping}` : "",
    taxable ? `Taxable: ${taxable}` : "",
    vendor ? `Vendor: ${vendor}` : "",
    productType ? `Type: ${productType}` : "",
    tags ? `Tags: ${tags}` : "",
    status ? `Status: ${status}` : "",
    publishedAt ? `Published at: ${publishedAt}` : "",
    productHandle ? `Product URL: /products/${productHandle}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

async function upsertChunk(serviceClient, row) {
  const { error } = await serviceClient.from("agent_knowledge").upsert(row, {
    onConflict: "workspace_id,shop_id,source_provider,source_id,chunk_index",
  });
  if (error) throw new Error(error.message);
}

async function deleteStaleChunks(serviceClient, creds, sourceId, chunkCount) {
  let query = serviceClient
    .from("agent_knowledge")
    .delete()
    .eq("shop_id", creds.shop_id)
    .eq("source_provider", SOURCE_PROVIDER)
    .eq("source_id", sourceId)
    .gte("chunk_index", chunkCount);
  if (creds.workspace_id) query = query.eq("workspace_id", creds.workspace_id);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

async function deleteMissingSources(serviceClient, creds, staleSourceIds) {
  const ids = Array.isArray(staleSourceIds) ? staleSourceIds.filter(Boolean) : [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    let query = serviceClient
      .from("agent_knowledge")
      .delete()
      .eq("shop_id", creds.shop_id)
      .eq("source_provider", SOURCE_PROVIDER)
      .in("source_id", batch);
    if (creds.workspace_id) query = query.eq("workspace_id", creds.workspace_id);
    const { error } = await query;
    if (error) throw new Error(error.message);
  }
}

async function deleteAllVariantChunks(serviceClient, creds) {
  let query = serviceClient
    .from("agent_knowledge")
    .delete()
    .eq("shop_id", creds.shop_id)
    .eq("source_provider", SOURCE_PROVIDER);
  if (creds.workspace_id) query = query.eq("workspace_id", creds.workspace_id);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

async function syncVariants({ serviceClient, creds }) {
  // Variant data (SKU/price/inventory) is too granular for support retrieval.
  // Product-level knowledge (sync-products) already covers what agents need.
  await deleteAllVariantChunks(serviceClient, creds);
  return { synced: 0, indexed: 0, unchanged: 0, updated_chunks: 0, skipped_chunks: 0 };
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

async function countIndexedVariants(serviceClient, shopIds) {
  if (!shopIds.length) return 0;
  const { data, error } = await serviceClient
    .from("agent_knowledge")
    .select("source_id, metadata")
    .in("shop_id", shopIds)
    .eq("source_provider", SOURCE_PROVIDER);
  if (error) throw new Error(error.message);
  const ids = new Set();
  for (const row of data || []) {
    const sourceId = String(row?.source_id || "").trim();
    if (sourceId) {
      ids.add(sourceId);
      continue;
    }
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const variantId = String(metadata?.variant_id || "").trim();
    if (variantId) ids.add(`shopify:variant:${variantId}`);
  }
  return ids.size;
}

async function fetchVariantsPreview(serviceClient, shopIds, limit = 150) {
  if (!shopIds.length) return [];
  const normalizedLimit = Math.max(1, Math.min(limit, 300));
  const { data, error } = await serviceClient
    .from("agent_knowledge")
    .select("source_id, metadata, created_at")
    .in("shop_id", shopIds)
    .eq("source_provider", SOURCE_PROVIDER)
    .order("created_at", { ascending: false })
    .limit(normalizedLimit * 8);
  if (error) throw new Error(error.message);

  const bySource = new Map();
  for (const row of data || []) {
    const sourceId = String(row?.source_id || "").trim();
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const variantId = String(metadata?.variant_id || "").trim();
    const key = sourceId || (variantId ? `shopify:variant:${variantId}` : "");
    if (!key || bySource.has(key)) continue;
    bySource.set(key, {
      external_id: variantId || key.replace(/^shopify:variant:/, ""),
      product_title: String(metadata?.product_title || "").trim() || null,
      variant_title: String(metadata?.variant_title || "").trim() || null,
      sku: String(metadata?.sku || "").trim() || null,
      price: metadata?.price ?? null,
      updated_at: metadata?.page_updated_at || row?.created_at || null,
    });
    if (bySource.size >= normalizedLimit) break;
  }
  return Array.from(bySource.values());
}

export async function GET(request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
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
    const count = await countIndexedVariants(serviceClient, shopIds);
    const includeVariants = String(request?.nextUrl?.searchParams?.get("include_variants") || "") === "1";
    if (!includeVariants) return NextResponse.json({ success: true, count }, { status: 200 });
    const variants = await fetchVariantsPreview(serviceClient, shopIds, 150);
    return NextResponse.json({ success: true, count, variants }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Count failed" },
      { status: 400 }
    );
  }
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
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
    console.info(JSON.stringify({ event: "knowledge.sync.start", provider: "shopify_variant", requested_shop_id: requestedShopId || null, resolved_shop_id: shop.shop_id, workspace_id: shop.workspace_id ?? null }));
    const result = await syncVariants({ serviceClient, creds: shop });
    console.info(JSON.stringify({ event: "knowledge.sync.wrote", provider: "shopify_variant", source_provider: "shopify_variant", resolved_shop_id: shop.shop_id, workspace_id: shop.workspace_id ?? null, fetched_count: Number(result?.synced ?? 0), rows_written: Number(result?.updated_chunks ?? 0), rows_updated: Number(result?.updated_chunks ?? 0), rows_deleted: 0 }));
    return NextResponse.json({ success: true, platform: "shopify", ...result }, { status: 200 });
  } catch (error) {
    console.error(JSON.stringify({ event: "knowledge.sync.error", provider: "shopify_variant", error: error instanceof Error ? error.message : "Sync failed" }));
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 400 }
    );
  }
}
