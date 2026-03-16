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
const SOURCE_PROVIDER = "shopify_metafield";
const MAX_CHUNKS_PER_METAFIELD = 8;
const MAX_UPDATED_CHUNKS_PER_RUN = 500;
const DEFAULT_ALLOWED_NAMESPACES = [
  "specs",
  "compatibility",
  "faq",
  "support",
  "manual",
  "technical",
  "tech",
  "features",
  "product_facts",
];

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function hashText(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

function parseAllowList(value, fallback = []) {
  const raw = String(value || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return raw.length ? raw : fallback;
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
    if (chunks.length >= MAX_CHUNKS_PER_METAFIELD) break;
  }
  return chunks.filter(Boolean);
}

function normalizeMetafieldValue(metafield) {
  const rawValue = metafield?.value;
  if (typeof rawValue !== "string") return String(rawValue ?? "").trim();
  const value = rawValue.trim();
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") return parsed.trim();
    return JSON.stringify(parsed);
  } catch {
    return value;
  }
}

function isRelevantMetafield(metafield) {
  const namespace = String(metafield?.namespace || "").trim().toLowerCase();
  const key = String(metafield?.key || "").trim().toLowerCase();
  const value = normalizeMetafieldValue(metafield);
  if (!namespace || !key || !value) return false;

  const allowedNamespaces = parseAllowList(
    process.env.SHOPIFY_METAFIELD_NAMESPACE_ALLOWLIST,
    DEFAULT_ALLOWED_NAMESPACES
  );
  const blockedNamespaces = parseAllowList(process.env.SHOPIFY_METAFIELD_NAMESPACE_BLOCKLIST, [
    "reviews",
    "judge_me",
    "yotpo",
    "stamped",
    "search",
    "recommendations",
  ]);
  const blockedKeyTerms = parseAllowList(process.env.SHOPIFY_METAFIELD_KEY_BLOCKLIST, [
    "seo",
    "rating",
    "review",
  ]);

  if (blockedNamespaces.includes(namespace)) return false;
  if (blockedKeyTerms.some((term) => key.includes(term))) return false;
  if (allowedNamespaces.length && !allowedNamespaces.includes(namespace)) return false;
  return true;
}

async function embedTexts(texts) {
  const inputs = Array.isArray(texts) ? texts.map((item) => String(item || "").trim()).filter(Boolean) : [];
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
    const message = json?.error?.message || `OpenAI embeddings returned ${res.status}`;
    throw new Error(message);
  }

  const data = Array.isArray(json?.data) ? json.data : [];
  const vectors = data
    .sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0))
    .map((item) => item?.embedding)
    .filter((embedding) => Array.isArray(embedding));

  if (vectors.length !== inputs.length) {
    throw new Error(`Embedding count mismatch: expected ${inputs.length}, got ${vectors.length}`);
  }
  return vectors;
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

async function fetchShopifyProductsLite({ domain, accessToken }) {
  const products = [];
  let sinceId = null;
  for (let i = 0; i < 25; i += 1) {
    const url = new URL(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
    url.searchParams.set("limit", "250");
    url.searchParams.set("fields", "id,title,handle");
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
    if (items.length < 250) break;
  }
  return products;
}

async function fetchShopifyProductMetafields({ domain, accessToken }) {
  const metafields = [];
  let sinceId = null;
  for (let i = 0; i < 25; i += 1) {
    const url = new URL(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/metafields.json`);
    url.searchParams.set("limit", "250");
    url.searchParams.set("owner_resource", "product");
    if (sinceId) url.searchParams.set("since_id", String(sinceId));
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Shopify metafields returned ${res.status}`);
    }
    const payload = await res.json().catch(() => null);
    const items = Array.isArray(payload?.metafields) ? payload.metafields : [];
    if (!items.length) break;
    metafields.push(...items);
    sinceId = items[items.length - 1]?.id;
    if (items.length < 250) break;
  }
  return metafields;
}

function buildMetafieldContext(metafield, product) {
  const namespace = String(metafield?.namespace || "").trim();
  const key = String(metafield?.key || "").trim();
  const type = String(metafield?.type || "").trim();
  const description = String(metafield?.description || "").trim();
  const ownerId = String(metafield?.owner_id || "").trim();
  const ownerResource = String(metafield?.owner_resource || "").trim();
  const value = normalizeMetafieldValue(metafield);
  const parts = [
    product?.title ? `Product: ${product.title}` : "",
    namespace && key ? `Metafield: ${namespace}.${key}` : "",
    type ? `Type: ${type}` : "",
    ownerResource ? `Owner resource: ${ownerResource}` : "",
    ownerId ? `Owner ID: ${ownerId}` : "",
    description ? `Description: ${description}` : "",
    value ? `Value:\n${value}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

function getSourceIdFromRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const sourceId = String(row?.source_id || "").trim();
  if (sourceId) return sourceId;
  const metafieldId = String(metadata?.metafield_id || "").trim();
  return metafieldId ? `shopify:metafield:${metafieldId}` : "";
}

function getChunkIndexFromRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const columnIndex = Number(row?.chunk_index);
  if (Number.isInteger(columnIndex) && columnIndex >= 0) return columnIndex;
  const metaIndex = Number(metadata?.chunk_index);
  if (Number.isInteger(metaIndex) && metaIndex >= 0) return metaIndex;
  return null;
}

async function loadExistingMetafieldChunks(serviceClient, creds) {
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
    const entityHash = String(metadata?.entity_hash || metadata?.page_hash || metadata?.content_hash || "").trim() || null;
    const chunkHash = String(metadata?.chunk_hash || "").trim() || null;
    byChunk.set(`${sourceId}:${chunkIndex}`, { entity_hash: entityHash, chunk_hash: chunkHash });
    const previous = bySource.get(sourceId) || { entity_hash: null, chunk_count: 0 };
    bySource.set(sourceId, {
      entity_hash: previous.entity_hash || entityHash || null,
      chunk_count: Math.max(previous.chunk_count, chunkIndex + 1),
    });
  }
  return { byChunk, bySource };
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

async function syncShopifyMetafields({ serviceClient, creds }) {
  const domain = creds.shop_domain.replace(/^https?:\/\//, "");
  const [products, metafieldsRaw] = await Promise.all([
    fetchShopifyProductsLite({ domain, accessToken: creds.access_token }),
    fetchShopifyProductMetafields({ domain, accessToken: creds.access_token }),
  ]);

  const productMap = new Map(
    (products || []).map((product) => [String(product?.id || ""), { title: product?.title, handle: product?.handle }])
  );
  const metafields = (metafieldsRaw || []).filter(isRelevantMetafield);
  const existing = await loadExistingMetafieldChunks(serviceClient, creds);

  let synced = 0;
  let indexed = 0;
  let unchanged = 0;
  let updatedChunks = 0;
  let skippedChunks = 0;
  let budgetLimited = false;
  const seenSourceIds = new Set();

  for (const metafield of metafields) {
    const metafieldId = String(metafield?.id || "").trim();
    if (!metafieldId) continue;
    synced += 1;

    const ownerId = String(metafield?.owner_id || "").trim();
    const product = productMap.get(ownerId) || null;
    const sourceId = `shopify:metafield:${metafieldId}`;
    seenSourceIds.add(sourceId);

    const context = buildMetafieldContext(metafield, product);
    const chunks = chunkText(context);
    const entityHash = hashText(
      JSON.stringify({
        id: metafieldId,
        updated_at: String(metafield?.updated_at || ""),
        context,
      })
    );

    if (!chunks.length) {
      const previousCount = existing.bySource.get(sourceId)?.chunk_count || 0;
      if (previousCount > 0) {
        await deleteStaleChunks(serviceClient, creds, sourceId, 0);
      }
      unchanged += 1;
      continue;
    }

    const previousSource = existing.bySource.get(sourceId);
    if (
      previousSource?.entity_hash &&
      previousSource.entity_hash === entityHash &&
      previousSource.chunk_count === chunks.length
    ) {
      unchanged += 1;
      skippedChunks += chunks.length;
      continue;
    }

    const changed = [];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      const chunkHash = hashText(chunk);
      const existingChunk = existing.byChunk.get(`${sourceId}:${chunkIndex}`);
      if (existingChunk?.chunk_hash && existingChunk.chunk_hash === chunkHash) {
        skippedChunks += 1;
        continue;
      }
      changed.push({ chunk, chunkIndex, chunkHash });
    }

    if (!changed.length) {
      const previousCount = previousSource?.chunk_count || 0;
      if (previousCount > chunks.length) {
        await deleteStaleChunks(serviceClient, creds, sourceId, chunks.length);
      }
      unchanged += 1;
      continue;
    }

    const budgetLeft = MAX_UPDATED_CHUNKS_PER_RUN - updatedChunks;
    if (budgetLeft <= 0) {
      budgetLimited = true;
      break;
    }
    const changedCapped = changed.slice(0, budgetLeft);
    if (changedCapped.length < changed.length) budgetLimited = true;

    const embeddings = await embedTexts(changedCapped.map((item) => item.chunk));
    for (let i = 0; i < changedCapped.length; i += 1) {
      const item = changedCapped[i];
      const metadata = {
        metafield_id: metafieldId,
        namespace: String(metafield?.namespace || "").trim() || null,
        key: String(metafield?.key || "").trim() || null,
        type: String(metafield?.type || "").trim() || null,
        owner_resource: String(metafield?.owner_resource || "").trim() || null,
        owner_id: ownerId || null,
        owner_title: String(product?.title || "").trim() || null,
        owner_handle: String(product?.handle || "").trim() || null,
        owner_admin_url: ownerId ? `https://${domain}/admin/products/${ownerId}` : null,
        page_updated_at: metafield?.updated_at || null,
        value_preview: normalizeMetafieldValue(metafield).slice(0, 500),
        entity_hash: entityHash,
        chunk_hash: item.chunkHash,
        chunk_count: chunks.length,
        chunk_index: item.chunkIndex,
      };

      await upsertChunk(serviceClient, {
        workspace_id: creds.workspace_id,
        shop_id: creds.shop_id,
        source_id: sourceId,
        chunk_index: item.chunkIndex,
        content: item.chunk,
        source_type: "document",
        source_provider: SOURCE_PROVIDER,
        metadata,
        embedding: embeddings[i],
      });

      updatedChunks += 1;
      existing.byChunk.set(`${sourceId}:${item.chunkIndex}`, {
        entity_hash: entityHash,
        chunk_hash: item.chunkHash,
      });
    }

    const previousCount = previousSource?.chunk_count || 0;
    if (previousCount > chunks.length) {
      await deleteStaleChunks(serviceClient, creds, sourceId, chunks.length);
    }

    existing.bySource.set(sourceId, { entity_hash: entityHash, chunk_count: chunks.length });
    indexed += 1;

    if (budgetLimited) break;
  }

  const staleSources = Array.from(existing.bySource.keys()).filter((sourceId) => !seenSourceIds.has(sourceId));
  if (staleSources.length) {
    await deleteMissingSources(serviceClient, creds, staleSources);
  }

  return {
    synced,
    indexed,
    unchanged,
    updated_chunks: updatedChunks,
    skipped_chunks: skippedChunks,
    budget_limited: budgetLimited,
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

async function countIndexedMetafields(serviceClient, shopIds) {
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
    const metafieldId = String(metadata?.metafield_id || "").trim();
    if (metafieldId) ids.add(`shopify:metafield:${metafieldId}`);
  }
  return ids.size;
}

async function fetchMetafieldsPreview(serviceClient, shopIds, limit = 150) {
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
    const fallbackId = String(metadata?.metafield_id || "").trim();
    const key = sourceId || (fallbackId ? `shopify:metafield:${fallbackId}` : "");
    if (!key || bySource.has(key)) continue;
    bySource.set(key, {
      external_id: String(metadata?.metafield_id || "").trim() || fallbackId || null,
      namespace: String(metadata?.namespace || "").trim() || null,
      key: String(metadata?.key || "").trim() || null,
      owner_resource: String(metadata?.owner_resource || "").trim() || null,
      owner_id: String(metadata?.owner_id || "").trim() || null,
      owner_title: String(metadata?.owner_title || "").trim() || null,
      owner_admin_url: String(metadata?.owner_admin_url || "").trim() || null,
      value_preview: String(metadata?.value_preview || "").trim() || null,
      updated_at: metadata?.page_updated_at || row?.created_at || null,
    });
    if (bySource.size >= normalizedLimit) break;
  }
  return Array.from(bySource.values());
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

    const count = await countIndexedMetafields(serviceClient, shopIds);
    const includeMetafields = String(request?.nextUrl?.searchParams?.get("include_metafields") || "") === "1";
    if (!includeMetafields) {
      return NextResponse.json({ success: true, count }, { status: 200 });
    }

    const metafields = await fetchMetafieldsPreview(serviceClient, shopIds, 150);
    return NextResponse.json({ success: true, count, metafields }, { status: 200 });
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

    console.info(JSON.stringify({ event: "knowledge.sync.start", provider: "shopify_metafield", requested_shop_id: requestedShopId || null, resolved_shop_id: shop.shop_id, workspace_id: shop.workspace_id ?? null }));
    const result = await syncShopifyMetafields({ serviceClient, creds: shop });
    console.info(JSON.stringify({ event: "knowledge.sync.wrote", provider: "shopify_metafield", source_provider: "shopify_metafield", resolved_shop_id: shop.shop_id, workspace_id: shop.workspace_id ?? null, fetched_count: Number(result?.synced ?? 0), rows_written: Number(result?.updated_chunks ?? 0), rows_updated: Number(result?.updated_chunks ?? 0), rows_deleted: 0 }));
    return NextResponse.json({ success: true, platform: "shopify", ...result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    console.error(JSON.stringify({ event: "knowledge.sync.error", provider: "shopify_metafield", error: message }));
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
