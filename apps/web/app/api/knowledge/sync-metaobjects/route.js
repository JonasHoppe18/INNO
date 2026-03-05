import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/server/shopify-oauth";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

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
const SOURCE_PROVIDER = "shopify_metaobject";
const MAX_METAOBJECT_CHUNKS = 30;
const DEFAULT_TYPE_ALLOWLIST = ["faq", "support", "manual", "guide", "compatibility", "spec", "specification"];

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function hashText(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
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

function parseAllowList(value, fallback = []) {
  const parsed = String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
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
    if (chunks.length >= MAX_METAOBJECT_CHUNKS) break;
  }
  return chunks.filter(Boolean);
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

async function fetchShopifyCredentials(serviceClient, scope) {
  let query = serviceClient
    .from("shops")
    .select("id, shop_domain, access_token_encrypted, platform, workspace_id")
    .eq("platform", "shopify")
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  query = applyScope(query, scope, { workspaceColumn: "workspace_id", userColumn: "owner_user_id" });
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
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

async function fetchMetaobjects({ domain, accessToken }) {
  const rows = [];
  let sinceId = null;
  for (let i = 0; i < 20; i += 1) {
    const url = new URL(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/metaobjects.json`);
    url.searchParams.set("limit", "250");
    if (sinceId) url.searchParams.set("since_id", String(sinceId));
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Shopify metaobjects returned ${res.status}`);
    }
    const payload = await res.json().catch(() => null);
    const items = Array.isArray(payload?.metaobjects) ? payload.metaobjects : [];
    if (!items.length) break;
    rows.push(...items);
    sinceId = items[items.length - 1]?.id;
    if (items.length < 250) break;
  }
  return rows;
}

function isAllowedMetaobject(metaobject) {
  const type = String(metaobject?.type || "").trim().toLowerCase();
  if (!type) return false;
  const allowlist = parseAllowList(process.env.SHOPIFY_METAOBJECT_TYPE_ALLOWLIST, DEFAULT_TYPE_ALLOWLIST);
  if (!allowlist.length) return true;
  return allowlist.some((allowed) => type.includes(allowed));
}

function normalizeFieldValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed.trim();
    return JSON.stringify(parsed);
  } catch {
    return stripHtml(raw);
  }
}

function getSourceIdFromRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const sourceId = String(row?.source_id || "").trim();
  if (sourceId) return sourceId;
  const objectId = String(metadata?.metaobject_id || "").trim();
  return objectId ? `shopify:metaobject:${objectId}` : "";
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

function buildMetaobjectContext(metaobject) {
  const type = String(metaobject?.type || "").trim();
  const handle = String(metaobject?.handle || "").trim();
  const displayName = String(metaobject?.display_name || "").trim();
  const status = String(metaobject?.status || "").trim();
  const fields = Array.isArray(metaobject?.fields)
    ? metaobject.fields
        .map((field) => {
          const key = String(field?.key || "").trim();
          const value = normalizeFieldValue(field?.value);
          if (!key || !value) return "";
          return `${key}: ${value}`;
        })
        .filter(Boolean)
    : [];
  const parts = [
    type ? `Type: ${type}` : "",
    displayName ? `Name: ${displayName}` : "",
    handle ? `Handle: ${handle}` : "",
    status ? `Status: ${status}` : "",
    fields.length ? `Fields:\n${fields.join("\n")}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
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

async function syncMetaobjects({ serviceClient, creds }) {
  const rows = (await fetchMetaobjects({
    domain: creds.shop_domain.replace(/^https?:\/\//, ""),
    accessToken: creds.access_token,
  })).filter(isAllowedMetaobject);
  const existing = await loadExistingChunks(serviceClient, creds);
  const seenSourceIds = new Set();

  let synced = 0;
  let indexed = 0;
  let unchanged = 0;
  let updatedChunks = 0;
  let skippedChunks = 0;

  for (const metaobject of rows) {
    const objectId = String(metaobject?.id || "").trim();
    if (!objectId) continue;
    synced += 1;
    const sourceId = `shopify:metaobject:${objectId}`;
    seenSourceIds.add(sourceId);

    const context = buildMetaobjectContext(metaobject);
    const chunks = chunkText(context);
    const pageHash = hashText(
      JSON.stringify({
        id: objectId,
        updated_at: String(metaobject?.updated_at || ""),
        context,
      })
    );

    if (!chunks.length) {
      const previousCount = existing.bySource.get(sourceId)?.chunk_count || 0;
      if (previousCount > 0) await deleteStaleChunks(serviceClient, creds, sourceId, 0);
      unchanged += 1;
      continue;
    }

    const previousSource = existing.bySource.get(sourceId);
    if (
      previousSource?.page_hash &&
      previousSource.page_hash === pageHash &&
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
      const previous = existing.byChunk.get(`${sourceId}:${chunkIndex}`);
      if (previous?.chunk_hash && previous.chunk_hash === chunkHash) {
        skippedChunks += 1;
        continue;
      }
      changed.push({ chunk, chunkIndex, chunkHash });
    }

    if (!changed.length) {
      const previousCount = previousSource?.chunk_count || 0;
      if (previousCount > chunks.length) await deleteStaleChunks(serviceClient, creds, sourceId, chunks.length);
      unchanged += 1;
      continue;
    }

    const embeddings = await embedTexts(changed.map((item) => item.chunk));
    for (let i = 0; i < changed.length; i += 1) {
      const item = changed[i];
      const metadata = {
        metaobject_id: objectId,
        type: String(metaobject?.type || "").trim() || null,
        handle: String(metaobject?.handle || "").trim() || null,
        display_name: String(metaobject?.display_name || "").trim() || null,
        status: String(metaobject?.status || "").trim() || null,
        page_updated_at: metaobject?.updated_at || null,
        page_hash: pageHash,
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
        page_hash: pageHash,
        chunk_hash: item.chunkHash,
      });
    }

    const previousCount = previousSource?.chunk_count || 0;
    if (previousCount > chunks.length) await deleteStaleChunks(serviceClient, creds, sourceId, chunks.length);
    existing.bySource.set(sourceId, { page_hash: pageHash, chunk_count: chunks.length });
    indexed += 1;
  }

  const staleSources = Array.from(existing.bySource.keys()).filter((sourceId) => !seenSourceIds.has(sourceId));
  if (staleSources.length) await deleteMissingSources(serviceClient, creds, staleSources);

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

async function countIndexedMetaobjects(serviceClient, shopIds) {
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
    const objectId = String(metadata?.metaobject_id || "").trim();
    if (objectId) ids.add(`shopify:metaobject:${objectId}`);
  }
  return ids.size;
}

async function fetchMetaobjectsPreview(serviceClient, shopIds, limit = 150) {
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
    const objectId = String(metadata?.metaobject_id || "").trim();
    const key = sourceId || (objectId ? `shopify:metaobject:${objectId}` : "");
    if (!key || bySource.has(key)) continue;
    bySource.set(key, {
      external_id: objectId || key.replace(/^shopify:metaobject:/, ""),
      type: String(metadata?.type || "").trim() || null,
      display_name: String(metadata?.display_name || "").trim() || null,
      handle: String(metadata?.handle || "").trim() || null,
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
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId && !scope?.supabaseUserId) throw new Error("Could not resolve workspace/user scope.");
    const shopIds = await fetchActiveShopIds(serviceClient, scope);
    if (!shopIds.length) return NextResponse.json({ success: true, count: 0, metaobjects: [] }, { status: 200 });
    const count = await countIndexedMetaobjects(serviceClient, shopIds);
    const includeMetaobjects = String(request?.nextUrl?.searchParams?.get("include_metaobjects") || "") === "1";
    if (!includeMetaobjects) return NextResponse.json({ success: true, count }, { status: 200 });
    const metaobjects = await fetchMetaobjectsPreview(serviceClient, shopIds, 150);
    return NextResponse.json({ success: true, count, metaobjects }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Count failed" },
      { status: 400 }
    );
  }
}

export async function POST() {
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase service key missing" }, { status: 500 });
  }
  const serviceClient = createServiceClient();
  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId && !scope?.supabaseUserId) throw new Error("Could not resolve workspace/user scope.");
    const shop = await fetchShopifyCredentials(serviceClient, scope);
    if (shop.platform && shop.platform !== "shopify") throw new Error("Platform not supported yet");
    const result = await syncMetaobjects({ serviceClient, creds: shop });
    return NextResponse.json({ success: true, platform: "shopify", ...result }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 400 }
    );
  }
}
