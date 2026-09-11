import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
import { resolveShopifyCredentialsWithDiagnostics } from "@/lib/server/shopify-credentials";
import {
  runGreenfieldAgentWithAgentsSdk,
  Ship24ReadOnlyProvider,
  ShopifyReadOnlyProvider,
  SupabaseKnowledgeStore,
} from "@/lib/greenfield-support";
import {
  createGreenfieldConversationContextStore,
  loadGreenfieldThreadState,
} from "@/lib/server/greenfield-thread-context";
import { isGreenfieldPlaygroundEnabled } from "@/lib/server/greenfield-playground";

export const runtime = "nodejs";

const SUPABASE_URL = String(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "",
).replace(/\/$/, "");
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function createServiceClient() {
  return SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;
}

function createGreenfieldTrackingProvider() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return new Ship24ReadOnlyProvider();
  return new Ship24ReadOnlyProvider({
    requestImpl: async (trackingNumber: string, carrierHint?: string | null) => {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/fetch-tracking`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trackingNumber, company: carrierHint || "" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(`DEV tracking function returned ${response.status}`) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      return body;
    },
  });
}

function normalizeHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => (item?.role === "user" || item?.role === "assistant") && typeof item?.content === "string")
    .slice(-20)
    .map((item: any) => ({ role: item.role, content: String(item.content).slice(0, 12_000) }));
}

export async function POST(request: Request) {
  try {
    if (!isGreenfieldPlaygroundEnabled()) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    const body = await request.json().catch(() => null);
    const message = String(body?.message || "").trim();
    if (!message) return NextResponse.json({ error: "message is required." }, { status: 400 });
    if (message.length > 12_000) return NextResponse.json({ error: "message is too long." }, { status: 400 });

    const authState = await auth();
    if (!authState?.userId) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const serviceClient = createServiceClient();
    if (!serviceClient) return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });

    const scope = await resolveAuthScope(serviceClient, { clerkUserId: authState.userId, orgId: authState.orgId });
    if (!scope?.workspaceId) return NextResponse.json({ error: "A single active workspace is required." }, { status: 404 });

    const threadId = String(body?.thread_id || "").trim();
    const threadState = threadId
      ? await loadGreenfieldThreadState(serviceClient, scope, threadId)
      : null;
    if (threadId && !threadState) {
      return NextResponse.json({ error: "Thread not found in the current workspace." }, { status: 404 });
    }
    const contextStore = threadState ? createGreenfieldConversationContextStore(serviceClient) : null;
    const customer = threadState?.customer || { email: null, name: null };

    // Shop selection is server-side and only allows one unambiguous shop in scope.
    // The client/model cannot provide a shop ID or credentials.
    const shop = await resolveScopedShop(serviceClient, scope, undefined, {
      fields: "id, workspace_id, shop_domain",
      platform: "shopify",
      allowSingleScopedFallback: true,
      missingShopMessage: "Exactly one active Shopify shop is required for the experiment.",
    });
    const credentials = await resolveShopifyCredentialsWithDiagnostics(serviceClient, scope, {
      requestedShopId: shop.id,
      reason: "greenfield_support_read_only",
    });

    const result = await runGreenfieldAgentWithAgentsSdk({
      tenant: { workspaceId: scope.workspaceId, shopId: shop.id, customerEmail: customer.email, customerName: customer.name },
      message,
      interactionChannel: "support_inbox",
      history: threadState?.history || normalizeHistory(body?.history),
      conversationContext: threadState?.conversationContext,
      capabilities: {
        tenant: { workspaceId: scope.workspaceId, shopId: shop.id, customerEmail: customer.email, customerName: customer.name },
        knowledge: new SupabaseKnowledgeStore(serviceClient),
        commerce: new ShopifyReadOnlyProvider({
          shopDomain: credentials.shop_domain,
          accessToken: credentials.access_token,
          customer: { email: customer.email, name: customer.name },
        }),
        tracking: createGreenfieldTrackingProvider(),
      },
    });
    if (contextStore && threadId) {
      await contextStore.save({ workspaceId: scope.workspaceId, threadId, context: result.conversationContext });
    }
    return NextResponse.json({
      response: result.response,
      proposed_actions: result.proposedActions,
      trace: result.trace,
      conversation_context_persisted: Boolean(contextStore && threadId),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Greenfield support agent failed." }, { status: 500 });
  }
}
