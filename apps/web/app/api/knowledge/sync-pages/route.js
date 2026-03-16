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
const MAX_PAGE_CHUNKS = 40;

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

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

function extractNextPageInfo(linkHeader = "") {
  const parts = linkHeader.split(",");
  for (const part of parts) {
    if (!part.includes('rel="next"')) continue;
    const match = part.match(/<([^>]+)>/);
    if (!match?.[1]) continue;
    try {
      const url = new URL(match[1]);
      return url.searchParams.get("page_info");
    } catch {
      continue;
    }
  }
  return null;
}

function hashText(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
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
    if (chunks.length >= MAX_PAGE_CHUNKS) break;
  }
  return chunks.filter(Boolean);
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

async function fetchShopifyPages({ domain, accessToken }) {
  const pages = [];
  let pageInfo = null;
  const limit = 50;
  for (let i = 0; i < 5; i += 1) {
    const url = new URL(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/pages.json`);
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
      throw new Error(text || `Shopify pages returned ${res.status}`);
    }
    const payload = await res.json().catch(() => null);
    const items = Array.isArray(payload?.pages) ? payload.pages : [];
    pages.push(...items);
    const next = extractNextPageInfo(res.headers.get("link") ?? "");
    if (!next) break;
    pageInfo = next;
  }
  return pages;
}

function buildPageContext(page) {
  const title = String(page?.title || "Untitled page").trim();
  const body = stripHtml(page?.body_html || page?.body || "");
  const author = String(page?.author || "").trim();
  const handle = String(page?.handle || "").trim();
  const templateSuffix = String(page?.template_suffix || "").trim();
  const publishedAt = String(page?.published_at || "").trim();
  const parts = [
    `Page: ${title}`,
    handle ? `Handle: ${handle}` : "",
    author ? `Author: ${author}` : "",
    publishedAt ? `Published at: ${publishedAt}` : "",
    templateSuffix ? `Template: ${templateSuffix}` : "",
    body ? `Content:\n${body}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

function getSourceIdFromRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const sourceId = String(row?.source_id || "").trim();
  if (sourceId) return sourceId;
  const pageId = String(metadata?.page_id || "").trim();
  return pageId ? `shopify:page:${pageId}` : "";
}

function getChunkIndexFromRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const columnIndex = Number(row?.chunk_index);
  if (Number.isInteger(columnIndex) && columnIndex >= 0) return columnIndex;
  const metaIndex = Number(metadata?.chunk_index);
  if (Number.isInteger(metaIndex) && metaIndex >= 0) return metaIndex;
  return null;
}

async function loadExistingPageChunks(serviceClient, creds) {
  let query = serviceClient
    .from("agent_knowledge")
    .select("source_id, chunk_index, metadata")
    .eq("shop_id", creds.shop_id)
    .eq("source_provider", "shopify_page");
  if (creds.workspace_id) {
    query = query.eq("workspace_id", creds.workspace_id);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const byChunk = new Map();
  const byPage = new Map();

  for (const row of data || []) {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const sourceId = getSourceIdFromRow(row);
    const chunkIndex = getChunkIndexFromRow(row);
    if (!sourceId || chunkIndex === null) continue;

    const key = `${sourceId}:${chunkIndex}`;
    const pageHash = String(metadata?.page_hash || metadata?.content_hash || "").trim() || null;
    const chunkHash = String(metadata?.chunk_hash || "").trim() || null;
    byChunk.set(key, { page_hash: pageHash, chunk_hash: chunkHash });

    const existingPage = byPage.get(sourceId) || { page_hash: null, chunk_count: 0 };
    byPage.set(sourceId, {
      page_hash: existingPage.page_hash || pageHash || null,
      chunk_count: Math.max(existingPage.chunk_count, chunkIndex + 1),
    });
  }

  return { byChunk, byPage };
}

async function upsertKnowledgeChunk(serviceClient, row) {
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
    .eq("source_provider", "shopify_page")
    .eq("source_id", sourceId)
    .gte("chunk_index", chunkCount);
  if (creds.workspace_id) {
    query = query.eq("workspace_id", creds.workspace_id);
  }
  const { error } = await query;
  if (error) throw new Error(error.message);
}

async function syncShopifyPages({ serviceClient, creds }) {
  const domain = creds.shop_domain.replace(/^https?:\/\//, "");
  const pages = await fetchShopifyPages({ domain, accessToken: creds.access_token });
  const existing = await loadExistingPageChunks(serviceClient, creds);

  let indexed = 0;
  let unchanged = 0;
  let synced = 0;
  let updatedChunks = 0;
  let skippedChunks = 0;

  for (const page of pages) {
    const pageId = String(page?.id ?? "").trim();
    if (!pageId) continue;
    synced += 1;

    const sourceId = `shopify:page:${pageId}`;
    const context = buildPageContext(page);
    const chunks = chunkText(context);
    const pageHash = hashText(
      JSON.stringify({
        id: pageId,
        updated_at: String(page?.updated_at || ""),
        context,
      })
    );

    if (!chunks.length) {
      const previousChunkCount = existing.byPage.get(sourceId)?.chunk_count || 0;
      if (previousChunkCount > 0) {
        await deleteStaleChunks(serviceClient, creds, sourceId, 0);
      }
      unchanged += 1;
      continue;
    }

    const previousPage = existing.byPage.get(sourceId);
    if (previousPage?.page_hash && previousPage.page_hash === pageHash && previousPage.chunk_count === chunks.length) {
      unchanged += 1;
      skippedChunks += chunks.length;
      continue;
    }

    const changed = [];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      const chunkHash = hashText(chunk);
      const key = `${sourceId}:${chunkIndex}`;
      const existingChunk = existing.byChunk.get(key);
      if (existingChunk?.chunk_hash && existingChunk.chunk_hash === chunkHash) {
        skippedChunks += 1;
        continue;
      }
      changed.push({ chunk, chunkIndex, chunkHash });
    }

    if (!changed.length) {
      const previousChunkCount = previousPage?.chunk_count || 0;
      if (previousChunkCount > chunks.length) {
        await deleteStaleChunks(serviceClient, creds, sourceId, chunks.length);
      }
      unchanged += 1;
      continue;
    }

    const embeddings = await embedTexts(changed.map((item) => item.chunk));
    for (let i = 0; i < changed.length; i += 1) {
      const item = changed[i];
      const metadata = {
        page_id: pageId,
        title: String(page?.title || "").trim() || "Untitled page",
        handle: String(page?.handle || "").trim() || null,
        url: page?.handle ? `https://${domain}/pages/${page.handle}` : null,
        page_updated_at: page?.updated_at || null,
        page_hash: pageHash,
        chunk_hash: item.chunkHash,
        chunk_count: chunks.length,
        chunk_index: item.chunkIndex,
      };
      await upsertKnowledgeChunk(serviceClient, {
        workspace_id: creds.workspace_id,
        shop_id: creds.shop_id,
        source_id: sourceId,
        chunk_index: item.chunkIndex,
        content: item.chunk,
        source_type: "document",
        source_provider: "shopify_page",
        metadata,
        embedding: embeddings[i],
      });
      updatedChunks += 1;
      existing.byChunk.set(`${sourceId}:${item.chunkIndex}`, {
        page_hash: pageHash,
        chunk_hash: item.chunkHash,
      });
    }

    const previousChunkCount = previousPage?.chunk_count || 0;
    if (previousChunkCount > chunks.length) {
      await deleteStaleChunks(serviceClient, creds, sourceId, chunks.length);
    }

    existing.byPage.set(sourceId, { page_hash: pageHash, chunk_count: chunks.length });
    indexed += 1;
  }

  return {
    synced,
    indexed,
    unchanged,
    updated_chunks: updatedChunks,
    skipped_chunks: skippedChunks,
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

async function countIndexedPages(serviceClient, shopIds) {
  if (!shopIds.length) return 0;
  const { data, error } = await serviceClient
    .from("agent_knowledge")
    .select("source_id, metadata")
    .in("shop_id", shopIds)
    .eq("source_provider", "shopify_page");
  if (error) throw new Error(error.message);

  const pageIds = new Set();
  for (const row of data || []) {
    const sourceId = String(row?.source_id || "").trim();
    if (sourceId) {
      pageIds.add(sourceId);
      continue;
    }
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const pageId = String(metadata?.page_id || "").trim();
    if (pageId) pageIds.add(`shopify:page:${pageId}`);
  }
  return pageIds.size;
}

async function fetchPagesPreview(serviceClient, shopIds, limit = 150) {
  if (!shopIds.length) return [];
  const normalizedLimit = Math.max(1, Math.min(limit, 300));

  const { data, error } = await serviceClient
    .from("agent_knowledge")
    .select("source_id, metadata, created_at")
    .in("shop_id", shopIds)
    .eq("source_provider", "shopify_page")
    .order("created_at", { ascending: false })
    .limit(normalizedLimit * 8);
  if (error) throw new Error(error.message);

  const byPage = new Map();
  for (const row of data || []) {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const sourceId = String(row?.source_id || "").trim();
    const pageId = String(metadata?.page_id || sourceId.replace(/^shopify:page:/, "") || "").trim();
    if (!pageId || byPage.has(pageId)) continue;
    byPage.set(pageId, {
      external_id: pageId,
      title: String(metadata?.title || "Untitled page"),
      handle: String(metadata?.handle || "").trim() || null,
      url: String(metadata?.url || "").trim() || null,
      updated_at: metadata?.page_updated_at || row?.created_at || null,
    });
    if (byPage.size >= normalizedLimit) break;
  }
  return Array.from(byPage.values());
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

    const count = await countIndexedPages(serviceClient, shopIds);
    const includePages = String(request?.nextUrl?.searchParams?.get("include_pages") || "") === "1";
    if (!includePages) {
      return NextResponse.json({ success: true, count }, { status: 200 });
    }

    const pages = await fetchPagesPreview(serviceClient, shopIds);
    return NextResponse.json({ success: true, count, pages }, { status: 200 });
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

    console.info(JSON.stringify({ event: "knowledge.sync.start", provider: "shopify_page", requested_shop_id: requestedShopId || null, resolved_shop_id: shop.shop_id, workspace_id: shop.workspace_id ?? null }));
    const result = await syncShopifyPages({ serviceClient, creds: shop });
    console.info(JSON.stringify({ event: "knowledge.sync.wrote", provider: "shopify_page", source_provider: "shopify_page", resolved_shop_id: shop.shop_id, workspace_id: shop.workspace_id ?? null, fetched_count: Number(result?.synced ?? 0), rows_written: Number(result?.updated_chunks ?? 0), rows_updated: Number(result?.updated_chunks ?? 0), rows_deleted: 0 }));
    return NextResponse.json({ success: true, platform: "shopify", ...result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    console.error(JSON.stringify({ event: "knowledge.sync.error", provider: "shopify_page", error: message }));
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
