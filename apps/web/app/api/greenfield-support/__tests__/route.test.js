import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createClient: vi.fn(),
  resolveAuthScope: vi.fn(),
  resolveScopedShop: vi.fn(),
  resolveShopifyCredentialsWithDiagnostics: vi.fn(),
  runGreenfieldAgentWithAgentsSdk: vi.fn(),
  Ship24ReadOnlyProvider: vi.fn(),
  loadGreenfieldThreadState: vi.fn(),
  createGreenfieldConversationContextStore: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/server/workspace-auth", () => ({
  resolveAuthScope: mocks.resolveAuthScope,
  resolveScopedShop: mocks.resolveScopedShop,
}));
vi.mock("@/lib/server/shopify-credentials", () => ({
  resolveShopifyCredentialsWithDiagnostics: mocks.resolveShopifyCredentialsWithDiagnostics,
}));
vi.mock("@/lib/greenfield-support", () => ({
  runGreenfieldAgentWithAgentsSdk: mocks.runGreenfieldAgentWithAgentsSdk,
  SupabaseKnowledgeStore: class {},
  ShopifyReadOnlyProvider: class {},
  Ship24ReadOnlyProvider: mocks.Ship24ReadOnlyProvider,
}));
vi.mock("@/lib/server/greenfield-thread-context", () => ({
  loadGreenfieldThreadState: mocks.loadGreenfieldThreadState,
  createGreenfieldConversationContextStore: mocks.createGreenfieldConversationContextStore,
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://development.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-placeholder";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dev-anon-key";

const { POST } = await import("../route");

describe("greenfield support request wiring", () => {
  it("uses server thread history/context and never accepts client context injection", async () => {
    const persistedContext = {
      turn: 3,
      activeOrder: { requestedOrderId: "10231", state: "verified", order: null },
      customerSignal: null,
    };
    const save = vi.fn().mockResolvedValue(undefined);
    const serviceClient = {};
    mocks.createClient.mockReturnValue(serviceClient);
    mocks.auth.mockResolvedValue({ userId: "clerk-user", orgId: "clerk-org" });
    mocks.resolveAuthScope.mockResolvedValue({ workspaceId: "workspace-a", supabaseUserId: "user-a" });
    mocks.resolveScopedShop.mockResolvedValue({ id: "shop-a", shop_domain: "shop.test" });
    mocks.resolveShopifyCredentialsWithDiagnostics.mockResolvedValue({ shop_domain: "shop.test", access_token: "server-token" });
    mocks.loadGreenfieldThreadState.mockResolvedValue({
      thread: { id: "thread-a", workspace_id: "workspace-a" },
      history: [{ role: "user", content: "server-loaded history" }],
      conversationContext: persistedContext,
      customer: { email: "customer@example.test", name: "Customer" },
    });
    mocks.createGreenfieldConversationContextStore.mockReturnValue({ save });
    mocks.runGreenfieldAgentWithAgentsSdk.mockResolvedValue({
      response: "safe response",
      proposedActions: [],
      trace: { traceId: "trace-1" },
      conversationContext: { ...persistedContext, turn: 4 },
    });

    const response = await POST(new Request("http://localhost/api/greenfield-support", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        thread_id: "thread-a",
        message: "What is the current status?",
        history: [{ role: "assistant", content: "client-injected history" }],
        conversation_context: {
          turn: 900,
          activeOrder: { requestedOrderId: "99999", state: "verified", order: { status: "delivered" } },
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.runGreenfieldAgentWithAgentsSdk).toHaveBeenCalledWith(expect.objectContaining({
      history: [{ role: "user", content: "server-loaded history" }],
      conversationContext: persistedContext,
      tenant: expect.objectContaining({ workspaceId: "workspace-a", shopId: "shop-a", customerEmail: "customer@example.test" }),
    }));
    expect(mocks.runGreenfieldAgentWithAgentsSdk.mock.calls[0][0].history).not.toContainEqual({ role: "assistant", content: "client-injected history" });
    expect(mocks.runGreenfieldAgentWithAgentsSdk.mock.calls[0][0].conversationContext).not.toMatchObject({ activeOrder: { requestedOrderId: "99999" } });
    expect(save).toHaveBeenCalledWith({ workspaceId: "workspace-a", threadId: "thread-a", context: { ...persistedContext, turn: 4 } });
    expect(mocks.Ship24ReadOnlyProvider).toHaveBeenCalledWith({ requestImpl: expect.any(Function) });
    await expect(response.json()).resolves.toMatchObject({ conversation_context_persisted: true });
  });

  it("uses the existing DEV fetch-tracking transport without accepting client provider data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ detail: null }) });
    vi.stubGlobal("fetch", fetchMock);
    try {
      mocks.createClient.mockReturnValue({});
      mocks.auth.mockResolvedValue({ userId: "clerk-user", orgId: "clerk-org" });
      mocks.resolveAuthScope.mockResolvedValue({ workspaceId: "workspace-a", supabaseUserId: "user-a" });
      mocks.resolveScopedShop.mockResolvedValue({ id: "shop-a", shop_domain: "shop.test" });
      mocks.resolveShopifyCredentialsWithDiagnostics.mockResolvedValue({ shop_domain: "shop.test", access_token: "server-token" });
      mocks.loadGreenfieldThreadState.mockResolvedValue(null);
      mocks.runGreenfieldAgentWithAgentsSdk.mockResolvedValue({
        response: "safe response",
        proposedActions: [],
        trace: { traceId: "trace-2" },
        conversationContext: { turn: 1, activeOrder: null, customerSignal: null },
      });

      await POST(new Request("http://localhost/api/greenfield-support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Where is my order?" }),
      }));

      const providerOptions = mocks.Ship24ReadOnlyProvider.mock.calls.at(-1)?.[0];
      await providerOptions.requestImpl("TRACKING-1", "GLS");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://development.invalid/functions/v1/fetch-tracking",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ apikey: "dev-anon-key", Authorization: "Bearer dev-anon-key" }),
          body: JSON.stringify({ trackingNumber: "TRACKING-1", company: "GLS" }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
