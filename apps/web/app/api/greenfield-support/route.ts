import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";
import { resolveShopifyCredentialsWithDiagnostics } from "@/lib/server/shopify-credentials";
import {
  runGreenfieldAgentWithAgentsSdk,
  ShopifyReadOnlyProvider,
  SupabaseKnowledgeStore,
} from "@/lib/greenfield-support";

export const runtime = "nodejs";

const SUPABASE_URL = String(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "",
).replace(/\/$/, "");
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

function createServiceClient() {
  return SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;
}

function normalizeHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => (item?.role === "user" || item?.role === "assistant") && typeof item?.content === "string")
    .slice(-20)
    .map((item: any) => ({ role: item.role, content: String(item.content).slice(0, 12_000) }));
}

async function resolveCustomerFromThread(serviceClient: any, scope: any, threadId: string) {
  if (!threadId) return { email: null, name: null };
  const { data: thread } = await applyScope(
    serviceClient.from("mail_threads").select("id, customer_email, customer_name").eq("id", threadId).maybeSingle(),
    scope,
  );
  if (thread?.customer_email) return { email: thread.customer_email, name: thread.customer_name ?? null };
  const { data: inbound } = await applyScope(
    serviceClient.from("mail_messages").select("from_email, from_name, extracted_customer_email, extracted_customer_name, received_at, created_at").eq("thread_id", threadId).eq("from_me", false).order("received_at", { ascending: false, nullsLast: true }).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    scope,
  );
  return {
    email: inbound?.extracted_customer_email || inbound?.from_email || null,
    name: inbound?.extracted_customer_name || inbound?.from_name || null,
  };
}

export async function POST(request: Request) {
  try {
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
    const customer = await resolveCustomerFromThread(serviceClient, scope, String(body?.thread_id || "").trim());

    const result = await runGreenfieldAgentWithAgentsSdk({
      tenant: { workspaceId: scope.workspaceId, shopId: shop.id, customerEmail: customer.email, customerName: customer.name },
      message,
      history: normalizeHistory(body?.history),
      capabilities: {
        tenant: { workspaceId: scope.workspaceId, shopId: shop.id, customerEmail: customer.email, customerName: customer.name },
        knowledge: new SupabaseKnowledgeStore(serviceClient),
        commerce: new ShopifyReadOnlyProvider({
          shopDomain: credentials.shop_domain,
          accessToken: credentials.access_token,
          customer: { email: customer.email, name: customer.name },
        }),
      },
    });
    return NextResponse.json({
      response: result.response,
      proposed_actions: result.proposedActions,
      trace: result.trace,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Greenfield support agent failed." }, { status: 500 });
  }
}
