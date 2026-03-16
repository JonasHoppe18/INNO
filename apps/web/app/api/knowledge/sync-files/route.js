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
const OPENAI_OCR_MODEL = process.env.OPENAI_OCR_MODEL || "gpt-4.1-mini";
const SOURCE_PROVIDER = "shopify_file";
const MAX_FILE_CHUNKS = Number(process.env.SHOPIFY_FILE_MAX_CHUNKS || 40);
const MAX_FILES_PER_RUN = Number(process.env.SHOPIFY_FILE_MAX_FILES_PER_RUN || 200);
const MAX_GUIDE_IMAGES_PER_RUN = Number(process.env.SHOPIFY_FILE_MAX_GUIDE_IMAGES_PER_RUN || 20);
const MAX_DOC_BYTES = Number(process.env.SHOPIFY_FILE_MAX_DOC_BYTES || 20 * 1024 * 1024);
const MAX_IMAGE_BYTES = Number(process.env.SHOPIFY_FILE_MAX_IMAGE_BYTES || 15 * 1024 * 1024);
const FILE_SYNC_CONCURRENCY = Number(process.env.SHOPIFY_FILE_SYNC_CONCURRENCY || 3);

const DOCUMENT_EXTENSIONS = new Set(["pdf", "txt", "md", "csv", "doc", "docx", "rtf"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "svg", "avif", "bmp", "tif", "tiff"]);
const GUIDE_IMAGE_ALLOWLIST = ["size", "sizing", "guide", "chart", "manual", "spec", "datasheet", "measurement", "fit"];
const IMAGE_BLOCKLIST = ["product", "thumbnail", "thumb", "banner", "hero", "gallery", "swatch", "logo", "icon"];

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function hashText(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

function normalizeWhitespace(value = "") {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkText(text, size = 1200, overlap = 200) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + size);
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
    if (chunks.length >= MAX_FILE_CHUNKS) break;
  }
  return chunks.filter(Boolean);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
  const results = new Array(list.length);
  let cursor = 0;

  async function run() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= list.length) break;
      results[current] = await worker(list[current], current);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()));
  return results;
}

function parseResponsesText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (typeof block?.text === "string" && block.text.trim()) {
        chunks.push(block.text.trim());
      }
    }
  }
  return chunks.join("\n").trim();
}

function getExtension(value = "") {
  const clean = String(value || "").split("?")[0].split("#")[0].trim().toLowerCase();
  const match = clean.match(/\.([a-z0-9]{2,8})$/i);
  return match?.[1] || "";
}

function getFileName(file) {
  const url = String(file?.url || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || "";
    const fromPath = pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(fromPath || "");
  } catch {
    const fallback = url.split("/").pop() || "";
    return decodeURIComponent(fallback);
  }
}

function extractNextCursor(payload) {
  const pageInfo = payload?.data?.files?.pageInfo;
  const hasNextPage = Boolean(pageInfo?.hasNextPage);
  const endCursor = String(pageInfo?.endCursor || "").trim();
  return hasNextPage && endCursor ? endCursor : null;
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

async function shopifyGraphql({ domain, accessToken, query, variables = {} }) {
  const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.errors?.[0]?.message || `Shopify GraphQL returned ${res.status}`);
  }
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(payload.errors[0]?.message || "Shopify GraphQL error");
  }
  return payload;
}

async function fetchShopifyFiles({ domain, accessToken }) {
  const files = [];
  let cursor = null;
  const query = `
    query ListFiles($first: Int!, $after: String) {
      files(first: $first, after: $after, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            __typename
            id
            alt
            createdAt
            updatedAt
            fileStatus
            ... on GenericFile {
              mimeType
              url
            }
            ... on MediaImage {
              mimeType
              image {
                url
                altText
              }
            }
          }
        }
      }
    }
  `;

  for (let i = 0; i < 20; i += 1) {
    const payload = await shopifyGraphql({
      domain,
      accessToken,
      query,
      variables: { first: 50, after: cursor },
    });
    const edges = Array.isArray(payload?.data?.files?.edges) ? payload.data.files.edges : [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node?.id) continue;
      const typename = String(node?.__typename || "").trim();
      const genericUrl = String(node?.url || "").trim();
      const imageUrl = String(node?.image?.url || "").trim();
      const url = genericUrl || imageUrl;
      if (!url) continue;
      files.push({
        id: String(node.id),
        typename,
        alt: String(node?.alt || node?.image?.altText || "").trim() || null,
        mime_type: String(node?.mimeType || "").trim() || null,
        url,
        created_at: node?.createdAt || null,
        updated_at: node?.updatedAt || null,
        status: String(node?.fileStatus || "").trim() || null,
      });
      if (files.length >= MAX_FILES_PER_RUN * 2) break;
    }
    if (files.length >= MAX_FILES_PER_RUN * 2) break;
    cursor = extractNextCursor(payload);
    if (!cursor) break;
  }

  return files;
}

function isImageLike(file) {
  const mime = String(file?.mime_type || "").toLowerCase();
  const ext = getExtension(getFileName(file) || file?.url || "");
  return mime.startsWith("image/") || IMAGE_EXTENSIONS.has(ext);
}

function isDocumentLike(file) {
  const mime = String(file?.mime_type || "").toLowerCase();
  const ext = getExtension(getFileName(file) || file?.url || "");
  if (mime === "application/pdf" || mime.startsWith("text/")) return true;
  if (["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(mime)) {
    return true;
  }
  return DOCUMENT_EXTENSIONS.has(ext);
}

function looksLikeGuideImage(file) {
  const haystack = [file?.alt, getFileName(file), file?.url]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  if (!haystack.trim()) return false;
  const hasGuideSignal = GUIDE_IMAGE_ALLOWLIST.some((term) => haystack.includes(term));
  if (hasGuideSignal) return true;
  if (IMAGE_BLOCKLIST.some((term) => haystack.includes(term))) return false;
  return false;
}

function selectCandidates(files, includeImageGuides) {
  const selected = [];
  let imageGuideCount = 0;
  for (const file of files) {
    if (selected.length >= MAX_FILES_PER_RUN) break;

    if (isDocumentLike(file)) {
      selected.push({ ...file, ingestion_kind: "document" });
      continue;
    }

    if (includeImageGuides && isImageLike(file) && looksLikeGuideImage(file)) {
      if (imageGuideCount >= MAX_GUIDE_IMAGES_PER_RUN) continue;
      imageGuideCount += 1;
      selected.push({ ...file, ingestion_kind: "image_ocr" });
    }
  }
  return selected;
}

async function fetchBuffer(url, maxBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`File fetch failed (${res.status})`);
    const declaredLength = Number(res.headers.get("content-length") || "0");
    if (declaredLength && declaredLength > maxBytes) {
      throw new Error(`File too large (${Math.round(declaredLength / 1024 / 1024)}MB)`);
    }
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error(`File too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB)`);
    }
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

async function extractFileTextWithOpenAI({ fileName, mimeType, buffer }) {
  if (!OPENAI_API_KEY) return "";
  const base64 = buffer.toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_OCR_MODEL,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Extract all readable text from this file. Return plain text only and preserve headings/bullets when possible.",
              },
              {
                type: "input_file",
                filename: fileName || "document",
                file_data: `data:${mimeType || "application/octet-stream"};base64,${base64}`,
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return "";
    return normalizeWhitespace(parseResponsesText(payload));
  } catch (error) {
    if (error?.name === "AbortError") return "";
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

async function extractImageTextWithOpenAI({ mimeType, buffer }) {
  if (!OPENAI_API_KEY) return "";
  const base64 = buffer.toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_OCR_MODEL,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Extract all readable text from this image. Return plain text only and keep table-like layout readable.",
              },
              {
                type: "input_image",
                image_url: `data:${mimeType || "image/png"};base64,${base64}`,
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return "";
    return normalizeWhitespace(parseResponsesText(payload));
  } catch (error) {
    if (error?.name === "AbortError") return "";
    return "";
  } finally {
    clearTimeout(timeout);
  }
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

function getSourceIdFromRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const sourceId = String(row?.source_id || "").trim();
  if (sourceId) return sourceId;
  const fileId = String(metadata?.file_id || "").trim();
  return fileId ? `shopify:file:${fileId}` : "";
}

function getChunkIndexFromRow(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const columnIndex = Number(row?.chunk_index);
  if (Number.isInteger(columnIndex) && columnIndex >= 0) return columnIndex;
  const metaIndex = Number(metadata?.chunk_index);
  if (Number.isInteger(metaIndex) && metaIndex >= 0) return metaIndex;
  return null;
}

async function loadExistingChunks(serviceClient, creds) {
  let query = serviceClient
    .from("agent_knowledge")
    .select("source_id, chunk_index, metadata")
    .eq("shop_id", creds.shop_id)
    .eq("source_provider", SOURCE_PROVIDER);
  if (creds.workspace_id) {
    query = query.eq("workspace_id", creds.workspace_id);
  }

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

    const previous = bySource.get(sourceId) || { page_hash: null, chunk_count: 0, file_fingerprint_hash: null };
    bySource.set(sourceId, {
      page_hash: previous.page_hash || pageHash || null,
      chunk_count: Math.max(previous.chunk_count, chunkIndex + 1),
      file_fingerprint_hash:
        previous.file_fingerprint_hash || String(metadata?.file_fingerprint_hash || "").trim() || null,
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

function buildFileContext(file, extractedText) {
  const filename = getFileName(file);
  const kind = file?.ingestion_kind === "image_ocr" ? "Image Guide (OCR)" : "Document";
  const parts = [
    `File: ${filename || "Untitled file"}`,
    `Kind: ${kind}`,
    file?.alt ? `Label: ${file.alt}` : "",
    file?.mime_type ? `MIME type: ${file.mime_type}` : "",
    file?.updated_at ? `Updated at: ${file.updated_at}` : "",
    extractedText ? `Content:\n${extractedText}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

async function extractTextForCandidate(file) {
  const filename = getFileName(file);
  const maxBytes = file?.ingestion_kind === "image_ocr" ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
  const buffer = await fetchBuffer(file.url, maxBytes);

  if (file.ingestion_kind === "image_ocr") {
    return extractImageTextWithOpenAI({
      mimeType: file?.mime_type || `image/${getExtension(filename) || "png"}`,
      buffer,
    });
  }

  const mime = String(file?.mime_type || "").toLowerCase();
  if (mime.startsWith("text/")) {
    return normalizeWhitespace(buffer.toString("utf8"));
  }

  return extractFileTextWithOpenAI({
    fileName: filename || "document",
    mimeType: file?.mime_type || "application/octet-stream",
    buffer,
  });
}

async function syncShopifyFiles({ serviceClient, creds, includeImageGuides }) {
  const domain = creds.shop_domain.replace(/^https?:\/\//, "");
  const files = await fetchShopifyFiles({ domain, accessToken: creds.access_token });
  const candidates = selectCandidates(files, includeImageGuides);
  const existing = await loadExistingChunks(serviceClient, creds);
  const seenSourceIds = new Set();

  async function processCandidate(file) {
    const fileId = String(file?.id || "").trim();
    if (!fileId) {
      return {
        synced: 0,
        indexed: 0,
        unchanged: 0,
        updatedChunks: 0,
        skippedChunks: 0,
        skippedFiles: 1,
        sourceId: null,
      };
    }

    const sourceId = `shopify:file:${fileId}`;
    seenSourceIds.add(sourceId);
    const fileName = getFileName(file);
    const fileFingerprintHash = hashText(
      JSON.stringify({
        id: fileId,
        updated_at: String(file?.updated_at || ""),
        kind: String(file?.ingestion_kind || ""),
        url: String(file?.url || ""),
        alt: String(file?.alt || ""),
        mime: String(file?.mime_type || ""),
        file_name: fileName,
      })
    );

    const previous = existing.bySource.get(sourceId);
    if (
      previous?.chunk_count > 0 &&
      (previous?.file_fingerprint_hash === fileFingerprintHash || previous?.page_hash === fileFingerprintHash)
    ) {
      return {
        synced: 1,
        indexed: 0,
        unchanged: 1,
        updatedChunks: 0,
        skippedChunks: previous.chunk_count,
        skippedFiles: 0,
        sourceId,
      };
    }

    let extractedText = "";
    try {
      extractedText = await extractTextForCandidate(file);
    } catch {
      return {
        synced: 1,
        indexed: 0,
        unchanged: 0,
        updatedChunks: 0,
        skippedChunks: 0,
        skippedFiles: 1,
        sourceId,
      };
    }

    const context = buildFileContext(file, extractedText);
    const chunks = chunkText(context);
    const pageHash = fileFingerprintHash;

    if (!chunks.length) {
      const previousChunkCount = previous?.chunk_count || 0;
      if (previousChunkCount > 0) {
        await deleteStaleChunks(serviceClient, creds, sourceId, 0);
      }
      return {
        synced: 1,
        indexed: 0,
        unchanged: 1,
        updatedChunks: 0,
        skippedChunks: 0,
        skippedFiles: 0,
        sourceId,
      };
    }

    const changed = [];
    let localSkippedChunks = 0;
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      const chunkHash = hashText(chunk);
      const key = `${sourceId}:${chunkIndex}`;
      const existingChunk = existing.byChunk.get(key);
      if (existingChunk?.chunk_hash && existingChunk.chunk_hash === chunkHash) {
        localSkippedChunks += 1;
        continue;
      }
      changed.push({ chunk, chunkIndex, chunkHash });
    }

    if (!changed.length) {
      const previousChunkCount = previous?.chunk_count || 0;
      if (previousChunkCount > chunks.length) {
        await deleteStaleChunks(serviceClient, creds, sourceId, chunks.length);
      }
      return {
        synced: 1,
        indexed: 0,
        unchanged: 1,
        updatedChunks: 0,
        skippedChunks: localSkippedChunks,
        skippedFiles: 0,
        sourceId,
      };
    }

    const embeddings = await embedTexts(changed.map((item) => item.chunk));
    for (let i = 0; i < changed.length; i += 1) {
      const item = changed[i];
      const metadata = {
        file_id: fileId,
        file_name: fileName || null,
        title: file?.alt || fileName || "Shopify file",
        url: file?.url || null,
        mime_type: file?.mime_type || null,
        file_kind: file?.ingestion_kind || "document",
        file_updated_at: file?.updated_at || null,
        file_fingerprint_hash: fileFingerprintHash,
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

      existing.byChunk.set(`${sourceId}:${item.chunkIndex}`, {
        page_hash: pageHash,
        chunk_hash: item.chunkHash,
      });
    }

    const previousChunkCount = previous?.chunk_count || 0;
    if (previousChunkCount > chunks.length) {
      await deleteStaleChunks(serviceClient, creds, sourceId, chunks.length);
    }

    existing.bySource.set(sourceId, {
      page_hash: pageHash,
      chunk_count: chunks.length,
      file_fingerprint_hash: fileFingerprintHash,
    });

    return {
      synced: 1,
      indexed: 1,
      unchanged: 0,
      updatedChunks: changed.length,
      skippedChunks: localSkippedChunks,
      skippedFiles: 0,
      sourceId,
    };
  }

  const results = await mapWithConcurrency(candidates, FILE_SYNC_CONCURRENCY, processCandidate);
  const totals = results.reduce(
    (acc, item) => {
      acc.synced += Number(item?.synced || 0);
      acc.indexed += Number(item?.indexed || 0);
      acc.unchanged += Number(item?.unchanged || 0);
      acc.updatedChunks += Number(item?.updatedChunks || 0);
      acc.skippedChunks += Number(item?.skippedChunks || 0);
      acc.skippedFiles += Number(item?.skippedFiles || 0);
      return acc;
    },
    {
      synced: 0,
      indexed: 0,
      unchanged: 0,
      updatedChunks: 0,
      skippedChunks: 0,
      skippedFiles: 0,
    }
  );

  const staleSourceIds = Array.from(existing.bySource.keys()).filter((sourceId) => !seenSourceIds.has(sourceId));
  if (staleSourceIds.length) {
    await deleteMissingSources(serviceClient, creds, staleSourceIds);
  }

  return {
    synced: totals.synced,
    indexed: totals.indexed,
    unchanged: totals.unchanged,
    updated_chunks: totals.updatedChunks,
    skipped_chunks: totals.skippedChunks,
    skipped_files: totals.skippedFiles,
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

async function countIndexedFiles(serviceClient, shopIds) {
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
    const fileId = String(metadata?.file_id || "").trim();
    if (fileId) ids.add(`shopify:file:${fileId}`);
  }
  return ids.size;
}

async function fetchFilesPreview(serviceClient, shopIds, limit = 150) {
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

  const byFile = new Map();
  for (const row of data || []) {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const sourceId = String(row?.source_id || "").trim();
    const fileId = String(metadata?.file_id || sourceId.replace(/^shopify:file:/, "") || "").trim();
    if (!fileId || byFile.has(fileId)) continue;
    byFile.set(fileId, {
      external_id: fileId,
      title: String(metadata?.title || metadata?.file_name || "Shopify file"),
      file_name: String(metadata?.file_name || "").trim() || null,
      mime_type: String(metadata?.mime_type || "").trim() || null,
      file_kind: String(metadata?.file_kind || "document").trim() || "document",
      url: String(metadata?.url || "").trim() || null,
      updated_at: metadata?.file_updated_at || row?.created_at || null,
    });
    if (byFile.size >= normalizedLimit) break;
  }

  return Array.from(byFile.values());
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

    const count = await countIndexedFiles(serviceClient, shopIds);
    const includeFiles = String(request?.nextUrl?.searchParams?.get("include_files") || "") === "1";
    if (!includeFiles) {
      return NextResponse.json({ success: true, count }, { status: 200 });
    }

    const files = await fetchFilesPreview(serviceClient, shopIds);
    return NextResponse.json({ success: true, count, files }, { status: 200 });
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

    const url = new URL(request.url);
    const includeImageGuides = String(url.searchParams.get("include_image_guides") || "1") === "1";

    console.info(JSON.stringify({ event: "knowledge.sync.start", provider: "shopify_file", requested_shop_id: requestedShopId || null, resolved_shop_id: shop.shop_id, workspace_id: shop.workspace_id ?? null }));
    const result = await syncShopifyFiles({
      serviceClient,
      creds: shop,
      includeImageGuides,
    });
    console.info(JSON.stringify({ event: "knowledge.sync.wrote", provider: "shopify_file", source_provider: "shopify_file", resolved_shop_id: shop.shop_id, workspace_id: shop.workspace_id ?? null, fetched_count: Number(result?.synced ?? 0), rows_written: Number(result?.updated_chunks ?? result?.indexed ?? 0), rows_updated: Number(result?.updated_chunks ?? result?.indexed ?? 0), rows_deleted: 0 }));

    return NextResponse.json({
      success: true,
      platform: "shopify",
      include_image_guides: includeImageGuides,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    console.error(JSON.stringify({ event: "knowledge.sync.error", provider: "shopify_file", error: message }));
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
