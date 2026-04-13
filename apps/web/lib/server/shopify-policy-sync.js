/**
 * Core Shopify policy sync logic — shared between:
 *  - /api/knowledge/sync-policies (manual sync triggered by user)
 *  - /api/webhooks/shopify (automatic sync on shop/update webhook)
 */

import { createHash } from "node:crypto";
import { decryptString } from "@/lib/server/shopify-oauth";
import { mapPoliciesFromShopify, summarizePolicies } from "@/lib/server/policy-summary";

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
export const SOURCE_PROVIDER = "shopify_policy";
const MAX_POLICY_CHUNKS = 20;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function stripHtml(value = "") {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function hashText(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
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
    if (chunks.length >= MAX_POLICY_CHUNKS) break;
  }
  return chunks.filter(Boolean);
}

export async function embedTexts(texts) {
  const inputs = Array.isArray(texts) ? texts.map((v) => String(v || "").trim()).filter(Boolean) : [];
  if (!inputs.length) return [];
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing.");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: inputs }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI embeddings returned ${res.status}`);
  const data = Array.isArray(json?.data) ? json.data : [];
  const embeddings = data
    .sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0))
    .map((item) => item?.embedding)
    .filter((e) => Array.isArray(e));
  if (embeddings.length !== inputs.length) {
    throw new Error(`Embedding count mismatch: expected ${inputs.length}, got ${embeddings.length}`);
  }
  return embeddings;
}

// ---------------------------------------------------------------------------
// Shopify API
// ---------------------------------------------------------------------------

export async function fetchShopifyPolicies({ domain, accessToken }) {
  const cleanDomain = domain.replace(/^https?:\/\//, "");
  const url = `https://${cleanDomain}/admin/api/${SHOPIFY_API_VERSION}/policies.json`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Shopify-Access-Token": accessToken },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Shopify policies returned ${res.status}`);
  }
  const payload = await res.json().catch(() => null);
  return Array.isArray(payload?.policies) ? payload.policies : [];
}

// ---------------------------------------------------------------------------
// Webhook registration
// ---------------------------------------------------------------------------

/**
 * Registers (or updates) the shop/update webhook for a given Shopify store.
 * Safe to call on every connect — idempotent.
 */
export async function registerShopUpdateWebhook(domain, accessToken) {
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  if (!appUrl) {
    console.warn("[webhook] APP_URL not set — skipping webhook registration");
    return;
  }
  const webhookAddress = `${appUrl}/api/webhooks/shopify`;
  const cleanDomain = domain.replace(/^https?:\/\//, "");
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  };
  const apiBase = `https://${cleanDomain}/admin/api/${SHOPIFY_API_VERSION}`;

  // 1. Try to create
  const createRes = await fetch(`${apiBase}/webhooks.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ webhook: { topic: "shop/update", address: webhookAddress, format: "json" } }),
  });

  if (createRes.ok || createRes.status === 201) {
    console.info(`[webhook] Registered shop/update webhook for ${cleanDomain} → ${webhookAddress}`);
    return;
  }

  if (createRes.status !== 422) {
    const text = await createRes.text();
    console.warn(`[webhook] Could not register webhook for ${cleanDomain}: ${createRes.status} ${text}`);
    return;
  }

  // 422 = likely already exists — find it and update address if needed
  const listRes = await fetch(`${apiBase}/webhooks.json?topic=shop/update`, { headers });
  if (!listRes.ok) return;
  const listData = await listRes.json().catch(() => null);
  const existing = (listData?.webhooks || []).find((w) => w.topic === "shop/update");
  if (!existing) return;

  if (existing.address === webhookAddress) {
    console.info(`[webhook] shop/update webhook already up to date for ${cleanDomain}`);
    return;
  }

  // Update address
  const updateRes = await fetch(`${apiBase}/webhooks/${existing.id}.json`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ webhook: { address: webhookAddress } }),
  });
  if (updateRes.ok) {
    console.info(`[webhook] Updated shop/update webhook for ${cleanDomain} → ${webhookAddress}`);
  } else {
    const text = await updateRes.text();
    console.warn(`[webhook] Could not update webhook for ${cleanDomain}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

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
  return [
    `Policy: ${title}`,
    handle ? `Handle: ${handle}` : "",
    url ? `Public URL: ${url}` : "",
    body ? `Content:\n${body}` : "",
  ].filter(Boolean).join("\n\n");
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

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

/**
 * Fetches policies from Shopify, updates shops table + agent_knowledge embeddings.
 * @param {{ serviceClient: import("@supabase/supabase-js").SupabaseClient, creds: { shop_id: string, workspace_id: string|null, shop_domain: string, access_token: string } }} options
 */
export async function runPolicySyncForCreds({ serviceClient, creds }) {
  const policies = await fetchShopifyPolicies({
    domain: creds.shop_domain,
    accessToken: creds.access_token,
  });

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

  let synced = 0, indexed = 0, unchanged = 0, updatedChunks = 0, skippedChunks = 0;

  for (const policy of policies) {
    const policyId = String(policy?.id || policy?.handle || "").trim();
    if (!policyId) continue;
    synced += 1;
    const sourceId = `shopify:policy:${policyId}`;
    seenSourceIds.add(sourceId);

    const context = buildPolicyContext(policy);
    const chunks = chunkText(context);
    const pageHash = hashText(JSON.stringify({
      id: policyId,
      updated_at: String(policy?.updated_at || ""),
      context,
    }));

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
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
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
    for (let i = 0; i < changed.length; i++) {
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

  const staleSources = Array.from(existing.bySource.keys()).filter((s) => !seenSourceIds.has(s));
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

/**
 * Resolves creds for a shop row from the DB (decrypts token).
 */
export function credsFromShopRow(row) {
  return {
    shop_id: row.id,
    workspace_id: row.workspace_id ?? null,
    shop_domain: row.shop_domain,
    access_token: decryptString(row.access_token_encrypted),
  };
}
