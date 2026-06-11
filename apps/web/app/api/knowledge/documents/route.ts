import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
import {
  getKnowledgeDocument,
  publishKnowledgeDocument,
  saveKnowledgeDocumentDraft,
} from "@/lib/server/knowledge-doc-service";

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

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

function truncate(input: string, max = 4000) {
  return input.length <= max ? input : `${input.slice(0, max)}...`;
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
    if (error?.name === "AbortError") throw new Error("Embedding request timed out.");
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

async function resolveRequestScope(request: Request, requestedShopId?: string) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return { error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return { error: NextResponse.json({ error: "Supabase configuration is missing." }, { status: 500 }) };
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }, {
      requireExplicitWorkspace: true,
    });
    const queryShopId = new URL(request.url).searchParams.get("shop_id") || undefined;
    const shop = await resolveScopedShop(serviceClient, scope, requestedShopId || queryShopId, {
      fields: "id, workspace_id",
      allowSingleScopedFallback: true,
      missingShopMessage: "shop_id is required for knowledge document operations.",
    }) as { id?: string } | null;
    if (!shop?.id) {
      return { error: NextResponse.json({ error: "Shop not found in your workspace scope." }, { status: 404 }) };
    }
    return { serviceClient, shopId: shop.id };
  } catch (error: any) {
    return { error: NextResponse.json({ error: error?.message || "Could not resolve workspace scope." }, { status: 500 }) };
  }
}

function parseDocIdentity(searchParams: URLSearchParams) {
  return {
    category: String(searchParams.get("category") || "returns").trim(),
    documentType: String(searchParams.get("document_type") || "returns_refunds").trim(),
  };
}

export async function GET(request: Request) {
  const scoped = await resolveRequestScope(request);
  if (scoped.error) return scoped.error;

  try {
    const { searchParams } = new URL(request.url);
    const { category, documentType } = parseDocIdentity(searchParams);
    const result = await getKnowledgeDocument({
      serviceClient: scoped.serviceClient,
      shopId: scoped.shopId,
      category,
      documentType,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not fetch knowledge document." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    const scoped = await resolveRequestScope(request, String(payload?.shop_id || "").trim() || undefined);
    if (scoped.error) return scoped.error;
    const category = String(payload?.category || "returns").trim();
    const documentType = String(payload?.document_type || "returns_refunds").trim();
    const title = String(payload?.title || "").trim();
    const draftMarkdown = String(payload?.draft_markdown || "");
    if (!category || !documentType || !title) {
      return NextResponse.json({ error: "category, document_type and title are required." }, { status: 400 });
    }
    const result = await saveKnowledgeDocumentDraft({
      serviceClient: scoped.serviceClient,
      embedder: embedText,
      shopId: scoped.shopId,
      category,
      documentType,
      title,
      draftMarkdown,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not save knowledge document." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    const scoped = await resolveRequestScope(request, String(payload?.shop_id || "").trim() || undefined);
    if (scoped.error) return scoped.error;
    const action = String(payload?.action || "publish").trim();
    if (action !== "publish") {
      return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
    }
    const category = String(payload?.category || "returns").trim();
    const documentType = String(payload?.document_type || "returns_refunds").trim();
    const result = await publishKnowledgeDocument({
      serviceClient: scoped.serviceClient,
      embedder: embedText,
      shopId: scoped.shopId,
      category,
      documentType,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not publish knowledge document." }, { status: 500 });
  }
}
