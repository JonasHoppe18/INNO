import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/server/shopify-oauth";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import { mapPoliciesFromShopify, summarizePolicies } from "@/lib/server/policy-summary";

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
const SOURCE_PROVIDER = "shopify_policy";
const MAX_POLICY_CHUNKS = 20;

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
    if (chunks.length >= MAX_POLICY_CHUNKS) break;
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

async function fetchPolicies({ domain, accessToken }) {
  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/policies.json`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Shopify policies returned ${res.status}`);
  }
  const payload = await res.json().catch(() => null);
  return Array.isArray(payload?.policies) ? payload.policies : [];
}

function getSourceIdFromRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const sourceId = String(row?.source_id || "").trim();
  if (sourceId) return sourceId;
  const policyId = String(metadata?.policy_id || "").trim();
  return policyId ? `shopify:policy:${policyId}` : "";
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

function buildPolicyContext(policy) {
  const title = String(policy?.title || "Untitled policy").trim();
  const handle = String(policy?.handle || "").trim();
  const body = stripHtml(policy?.body || policy?.body_html || "");
  const url = String(policy?.url || "").trim();
  const parts = [
    `Policy: ${title}`,
    handle ? `Handle: ${handle}` : "",
    url ? `Public URL: ${url}` : "",
    body ? `Content:\n${body}` : "",
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

async function syncPolicies({ serviceClient, creds }) {
  const domain = creds.shop_domain.replace(/^https?:\/\//, "");
  const policies = await fetchPolicies({ domain, accessToken: creds.access_token });
  const mapped = mapPoliciesFromShopify(policies);
  const summaryPayload = await summarizePolicies({
    refundPolicy: mapped.refund || "",
    shippingPolicy: mapped.shipping || "",
    termsPolicy: mapped.terms || "",
    privacyPolicy: mapped.privacy || "",
  });
  const { error: policyPersistError } = await serviceClient
    .from("shops")
    .update({
      policy_refund: mapped.refund || "",
      policy_shipping: mapped.shipping || "",
      policy_terms: mapped.terms || "",
      policy_privacy: mapped.privacy || "",
      policy_summary_json: summaryPayload.summary,
      policy_summary_version: summaryPayload.version,
      policy_summary_updated_at: summaryPayload.updated_at,
    })
    .eq("id", creds.shop_id);
  if (policyPersistError) {
    throw new Error(`Could not persist policy summary: ${policyPersistError.message}`);
  }
  const existing = await loadExistingChunks(serviceClient, creds);
  const seenSourceIds = new Set();

  let synced = 0;
  let indexed = 0;
  let unchanged = 0;
  let updatedChunks = 0;
  let skippedChunks = 0;

  for (const policy of policies) {
    const policyId = String(policy?.id || policy?.handle || "").trim();
    if (!policyId) continue;
    synced += 1;
    const sourceId = `shopify:policy:${policyId}`;
    seenSourceIds.add(sourceId);

    const context = buildPolicyContext(policy);
    const chunks = chunkText(context);
    const pageHash = hashText(
      JSON.stringify({
        id: policyId,
        updated_at: String(policy?.updated_at || ""),
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
        policy_id: policyId,
        title: String(policy?.title || "").trim() || "Untitled policy",
        handle: String(policy?.handle || "").trim() || null,
        url: String(policy?.url || "").trim() || null,
        page_updated_at: policy?.updated_at || null,
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
    policy_summary_version: summaryPayload.version,
    policy_summary_fallback: summaryPayload.used_fallback,
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

async function countIndexedPolicies(serviceClient, shopIds) {
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
    const policyId = String(metadata?.policy_id || "").trim();
    if (policyId) ids.add(`shopify:policy:${policyId}`);
  }
  return ids.size;
}

async function fetchPoliciesPreview(serviceClient, shopIds, limit = 50) {
  if (!shopIds.length) return [];
  const normalizedLimit = Math.max(1, Math.min(limit, 200));
  const { data, error } = await serviceClient
    .from("agent_knowledge")
    .select("source_id, metadata, created_at")
    .in("shop_id", shopIds)
    .eq("source_provider", SOURCE_PROVIDER)
    .order("created_at", { ascending: false })
    .limit(normalizedLimit * 6);
  if (error) throw new Error(error.message);

  const bySource = new Map();
  for (const row of data || []) {
    const sourceId = String(row?.source_id || "").trim();
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const policyId = String(metadata?.policy_id || "").trim();
    const key = sourceId || (policyId ? `shopify:policy:${policyId}` : "");
    if (!key || bySource.has(key)) continue;
    bySource.set(key, {
      external_id: policyId || key.replace(/^shopify:policy:/, ""),
      title: String(metadata?.title || "Untitled policy"),
      handle: String(metadata?.handle || "").trim() || null,
      url: String(metadata?.url || "").trim() || null,
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
    if (!shopIds.length) return NextResponse.json({ success: true, count: 0, policies: [] }, { status: 200 });
    const count = await countIndexedPolicies(serviceClient, shopIds);
    const includePolicies = String(request?.nextUrl?.searchParams?.get("include_policies") || "") === "1";
    if (!includePolicies) return NextResponse.json({ success: true, count }, { status: 200 });
    const policies = await fetchPoliciesPreview(serviceClient, shopIds, 50);
    return NextResponse.json({ success: true, count, policies }, { status: 200 });
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
    const result = await syncPolicies({ serviceClient, creds: shop });
    return NextResponse.json({ success: true, platform: "shopify", ...result }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 400 }
    );
  }
}
