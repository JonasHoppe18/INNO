import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

export const runtime = "nodejs";

const SUPABASE_BASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 15000);
const OPENAI_OCR_MODEL = process.env.OPENAI_OCR_MODEL || "gpt-4.1-mini";

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

function truncate(input: string, max = 4000) {
  return input.length <= max ? input : `${input.slice(0, max)}...`;
}

function normalizeWhitespace(value: string) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoChunks(text: string, size = 1200, overlap = 200) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + size);
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks.filter(Boolean);
}

function makeSnippetId() {
  try {
    return crypto.randomUUID();
  } catch (_error) {
    return `snippet_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function decodePdfString(input: string) {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = input[i + 1] || "";
    if (next === "n") {
      out += "\n";
      i += 1;
    } else if (next === "r") {
      out += "\r";
      i += 1;
    } else if (next === "t") {
      out += "\t";
      i += 1;
    } else if (next === "b") {
      out += "\b";
      i += 1;
    } else if (next === "f") {
      out += "\f";
      i += 1;
    } else if (next === "\\" || next === "(" || next === ")") {
      out += next;
      i += 1;
    } else if (/[0-7]/.test(next)) {
      const octal = input.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] || next;
      out += String.fromCharCode(parseInt(octal, 8));
      i += octal.length;
    } else {
      out += next;
      i += 1;
    }
  }
  return out;
}

function extractPdfText(buffer: Buffer) {
  const raw = buffer.toString("latin1").slice(0, 4_000_000);
  const blocks = raw.match(/BT[\s\S]*?ET/g) || [];
  const segments: string[] = [];

  for (const block of blocks) {
    const textRuns = block.match(/\((?:\\.|[^\\)])*\)\s*Tj/g) || [];
    for (const run of textRuns) {
      const content = run.match(/\(([\s\S]*)\)\s*Tj/)?.[1] || "";
      if (content) segments.push(decodePdfString(content));
    }

    const arrays = block.match(/\[(?:[\s\S]*?)\]\s*TJ/g) || [];
    for (const arr of arrays) {
      const inner = arr.match(/\[(.*)\]\s*TJ/)?.[1] || "";
      const pieces = inner.match(/\((?:\\.|[^\\)])*\)/g) || [];
      for (const piece of pieces) {
        const content = piece.slice(1, -1);
        if (content) segments.push(decodePdfString(content));
      }
    }
  }

  return normalizeWhitespace(segments.join("\n"));
}

async function embedText(input: string): Promise<number[]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input: truncate(input, 4000),
      }),
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("Embedding request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Embedding request failed (${response.status}).`);
  }
  const vector = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("Embedding vector was not returned.");
  return vector;
}

function parseResponsesText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks: string[] = [];
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

async function extractPdfTextWithOpenAI(fileName: string, buffer: Buffer): Promise<string> {
  if (!OPENAI_API_KEY) return "";
  const base64 = buffer.toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
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
                text: "Extract all readable text from this PDF. Return plain text only, keep headings and bullet points when possible.",
              },
              {
                type: "input_file",
                filename: fileName || "document.pdf",
                file_data: `data:application/pdf;base64,${base64}`,
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError") return "";
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) return "";
  return normalizeWhitespace(parseResponsesText(payload));
}

async function extractImageTextWithOpenAI(fileName: string, mimeType: string, buffer: Buffer): Promise<string> {
  if (!OPENAI_API_KEY) return "";
  const base64 = buffer.toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
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
                text: "Extract all readable text from this image. Return plain text only, keep headings and bullet points when possible.",
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
  } catch (error: any) {
    if (error?.name === "AbortError") return "";
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) return "";
  return normalizeWhitespace(parseResponsesText(payload));
}

async function resolveShopId(
  serviceClient: any,
  scope: { workspaceId: string | null; supabaseUserId: string | null },
  requestedShopId?: string
) {
  const shop = (await resolveScopedShop(serviceClient, scope, requestedShopId, {
    fields: "id, workspace_id",
    missingShopMessage: "shop_id is required for knowledge writes.",
  })) as { id?: string } | null;
  if (!shop?.id) throw new Error("Shop not found in your workspace scope.");
  return shop.id;
}

async function insertKnowledgeChunks(options: {
  serviceClient: any;
  shopId: string;
  content: string;
  sourceType: "snippet" | "document";
  sourceProvider: string;
  metadata: Record<string, unknown>;
  maxChunks?: number;
}) {
  const limit = Number(options.maxChunks || 10);
  const chunks = splitIntoChunks(options.content, 1200, 200).slice(0, Math.max(1, limit));
  console.info(
    JSON.stringify({
      event: "knowledge.snippet.embedded",
      shop_id: options.shopId,
      chunk_count: chunks.length,
      source_provider: options.sourceProvider,
      workspace_id: options.metadata?.workspace_id ?? null,
    })
  );
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const embedding = await embedText(chunk);
    const { error } = await options.serviceClient.from("agent_knowledge").insert({
      shop_id: options.shopId,
      content: chunk,
      source_type: options.sourceType,
      source_provider: options.sourceProvider,
      metadata: {
        ...options.metadata,
        chunk_index: index,
        chunk_count: chunks.length,
      },
      embedding,
    });
    if (error) throw new Error(`Could not insert knowledge chunk: ${error.message}`);
  }
  return chunks.length;
}

export async function POST(request: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not resolve workspace scope." }, { status: 500 });
  }

  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const requestedShopId = String(formData.get("shop_id") || "").trim();
      const titleFromForm = String(formData.get("title") || "").trim();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file." }, { status: 400 });
      }
      const isPdf = file.type === "application/pdf";
      const isImage = file.type.startsWith("image/");
      if (!isPdf && !isImage) {
        return NextResponse.json({ error: "Only PDF and image files are supported." }, { status: 400 });
      }
      if (file.size > 15 * 1024 * 1024) {
        return NextResponse.json({ error: "File is too large. Max 15MB." }, { status: 400 });
      }

      const shopId = await resolveShopId(serviceClient, scope, requestedShopId || undefined);
      console.info(
        JSON.stringify({
          event: "knowledge.snippet.request",
          requested_shop_id: requestedShopId || null,
          resolved_shop_id: shopId,
          workspace_id: scope.workspaceId,
          filename: file.name,
        })
      );
      const bytes = Buffer.from(await file.arrayBuffer());
      let extractedText = "";
      console.info(
        JSON.stringify({
          event: "file.parse.started",
          requested_shop_id: requestedShopId || null,
          resolved_shop_id: shopId,
          workspace_id: scope.workspaceId,
          filename: file.name,
          mime_type: file.type,
        })
      );
      if (isPdf) {
        extractedText = extractPdfText(bytes);
        if (!extractedText || extractedText.length < 120) {
          extractedText = await extractPdfTextWithOpenAI(file.name, bytes);
        }
      } else {
        extractedText = await extractImageTextWithOpenAI(file.name, file.type, bytes);
      }
      if (!extractedText || extractedText.length < 120) {
        console.warn(
          JSON.stringify({
            event: "file.parse.failed",
            resolved_shop_id: shopId,
            workspace_id: scope.workspaceId,
            filename: file.name,
            reason: "insufficient_text",
          })
        );
        return NextResponse.json(
          { error: "Could not extract enough text from this file. Try copy/paste text instead." },
          { status: 400 }
        );
      }
      const normalizedPdfText = extractedText.slice(0, 7000);
      console.info(
        JSON.stringify({
          event: "file.parse.succeeded",
          resolved_shop_id: shopId,
          workspace_id: scope.workspaceId,
          filename: file.name,
          extracted_chars: normalizedPdfText.length,
        })
      );

      const title = titleFromForm || file.name || "Uploaded File";
      const snippetId = makeSnippetId();

      const insertedChunks = await insertKnowledgeChunks({
        serviceClient,
        shopId,
        content: normalizedPdfText,
        sourceType: "document",
        sourceProvider: isPdf ? "pdf_upload" : "image_upload",
        maxChunks: 2,
        metadata: {
          workspace_id: scope.workspaceId,
          snippet_id: snippetId,
          title,
          file_name: file.name,
          file_size: file.size,
          file_mime: file.type,
        },
      });
      console.info(
        JSON.stringify({
          event: "knowledge.snippet.inserted",
          resolved_shop_id: shopId,
          workspace_id: scope.workspaceId,
          inserted_rows: insertedChunks,
          source_provider: isPdf ? "pdf_upload" : "image_upload",
          snippet_id: snippetId,
        })
      );

      return NextResponse.json({
        success: true,
        source_type: "document",
        source_provider: isPdf ? "pdf_upload" : "image_upload",
        snippet_id: snippetId,
        chunks: insertedChunks,
      });
    }

    const payload = await request.json().catch(() => null);
    const requestedShopId = String(payload?.shop_id || "").trim();
    const title = String(payload?.title || "").trim();
    const content = normalizeWhitespace(String(payload?.content || ""));
    if (!title || !content) {
      return NextResponse.json({ error: "title and content are required." }, { status: 400 });
    }

    const shopId = await resolveShopId(serviceClient, scope, requestedShopId || undefined);
    console.info(
      JSON.stringify({
        event: "knowledge.snippet.request",
        requested_shop_id: requestedShopId || null,
        resolved_shop_id: shopId,
        workspace_id: scope.workspaceId,
        title,
      })
    );
    const snippetId = makeSnippetId();

    const insertedChunks = await insertKnowledgeChunks({
      serviceClient,
      shopId,
      content,
      sourceType: "snippet",
      sourceProvider: "manual_text",
      maxChunks: 12,
      metadata: {
        workspace_id: scope.workspaceId,
        snippet_id: snippetId,
        title,
      },
    });
    console.info(
      JSON.stringify({
        event: "knowledge.snippet.inserted",
        resolved_shop_id: shopId,
        workspace_id: scope.workspaceId,
        inserted_rows: insertedChunks,
        source_provider: "manual_text",
        snippet_id: snippetId,
      })
    );

    return NextResponse.json({
      success: true,
      source_type: "snippet",
      snippet_id: snippetId,
      chunks: insertedChunks,
    });
  } catch (error: any) {
    console.error(
      JSON.stringify({
        event: "knowledge.snippet.error",
        workspace_id: scope?.workspaceId ?? null,
        error: error?.message || "Could not save knowledge snippet.",
      })
    );
    return NextResponse.json({ error: error?.message || "Could not save knowledge snippet." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not resolve workspace scope." }, { status: 500 });
  }

  try {
    const payload = await request.json().catch(() => null);
    const snippetId = String(payload?.id || "").trim();
    const requestedShopId = String(payload?.shop_id || "").trim();
    const title = String(payload?.title || "").trim();
    const content = normalizeWhitespace(String(payload?.content || ""));

    if (!snippetId || !title || !content) {
      return NextResponse.json({ error: "id, title and content are required." }, { status: 400 });
    }

    const shopId = await resolveShopId(serviceClient, scope, requestedShopId || undefined);

    const { data: existingRows, error: existingError } = await serviceClient
      .from("agent_knowledge")
      .select("id")
      .eq("shop_id", shopId)
      .eq("source_provider", "manual_text")
      .eq("metadata->>snippet_id", snippetId)
      .limit(1);
    if (existingError) {
      throw new Error(existingError.message);
    }
    if (!Array.isArray(existingRows) || !existingRows.length) {
      return NextResponse.json({ error: "Manual snippet not found." }, { status: 404 });
    }

    const { error: deleteError } = await serviceClient
      .from("agent_knowledge")
      .delete()
      .eq("shop_id", shopId)
      .eq("source_provider", "manual_text")
      .eq("metadata->>snippet_id", snippetId);
    if (deleteError) {
      throw new Error(`Could not replace snippet: ${deleteError.message}`);
    }

    const insertedChunks = await insertKnowledgeChunks({
      serviceClient,
      shopId,
      content,
      sourceType: "snippet",
      sourceProvider: "manual_text",
      maxChunks: 12,
      metadata: {
        snippet_id: snippetId,
        title,
      },
    });

    return NextResponse.json({
      success: true,
      source_type: "snippet",
      source_provider: "manual_text",
      snippet_id: snippetId,
      chunks: insertedChunks,
      updated: true,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not update knowledge snippet." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, { requireExplicitWorkspace: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not resolve workspace scope." }, { status: 500 });
  }

  try {
    const payload = await request.json().catch(() => null);
    const snippetId = String(payload?.id || "").trim();
    if (!snippetId) return NextResponse.json({ error: "id is required." }, { status: 400 });

    const shopId = await resolveShopId(serviceClient, scope, undefined);

    await serviceClient
      .from("agent_knowledge")
      .delete()
      .eq("shop_id", shopId)
      .or("source_provider.eq.manual_text,source_provider.eq.pdf_upload,source_provider.eq.image_upload")
      .eq("metadata->>snippet_id", snippetId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not delete snippet." }, { status: 500 });
  }
}
