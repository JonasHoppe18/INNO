import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createClient: vi.fn(),
  listScopedShops: vi.fn(),
  resolveAuthScope: vi.fn(),
  resolveScopedShop: vi.fn(),
  resolveShopifyCredentialsWithDiagnostics: vi.fn(),
  runGreenfieldAgentWithAgentsSdk: vi.fn(),
  ShopifyReadOnlyProvider: vi.fn(),
  Ship24ReadOnlyProvider: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/server/workspace-auth", () => ({
  listScopedShops: mocks.listScopedShops,
  resolveAuthScope: mocks.resolveAuthScope,
  resolveScopedShop: mocks.resolveScopedShop,
}));
vi.mock("@/lib/server/shopify-credentials", () => ({
  resolveShopifyCredentialsWithDiagnostics: mocks.resolveShopifyCredentialsWithDiagnostics,
}));
vi.mock("@/lib/greenfield-support", () => ({
  runGreenfieldAgentWithAgentsSdk: mocks.runGreenfieldAgentWithAgentsSdk,
  SupabaseKnowledgeStore: class {},
  ShopifyReadOnlyProvider: mocks.ShopifyReadOnlyProvider,
  Ship24ReadOnlyProvider: mocks.Ship24ReadOnlyProvider,
}));
vi.mock("@/lib/server/greenfield-playground", () => ({
  GREENFIELD_PLAYGROUND_HISTORY_LIMIT: 20,
  isGreenfieldPlaygroundEnabled: () => true,
  isOwnedPlaygroundSession: (session, scope) => session?.workspace_id === scope.workspaceId && session?.owner_clerk_user_id === scope.clerkUserId,
  normalizePlaygroundContext: (value) => value || null,
  normalizePlaygroundCustomerEmail: (value) => ({ value: value ? String(value).trim().toLowerCase() : null, error: null }),
  normalizePlaygroundCustomerName: (value) => {
    const firstName = String(value || "").trim().split(/\s+/)[0] || "";
    return /^[A-Za-z][A-Za-z'-]{0,39}$/.test(firstName) ? firstName : null;
  },
  normalizePlaygroundMessage: (value) => ({ value: String(value || "").trim(), error: String(value || "").trim() ? null : "message is required." }),
  historyFromPlaygroundRows: (rows) => rows || [],
  publicPlaygroundSession: (row) => ({ id: row.id, title: row.title, customer_email: row.customer_email || null }),
  publicPlaygroundMessage: (row) => ({ id: row.id, role: row.role, content: row.content, trace: row.trace_json || null, created_at: row.created_at }),
  sanitizeGreenfieldTrace: (trace) => ({ trace_id: trace.traceId, runtime: "@openai/agents", provider_results: [], events: [] }),
}));

process.env.NODE_ENV = "test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://development.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-placeholder";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dev-anon-key";

const { DELETE, GET, POST } = await import("../route");

function chain({ awaitResult = { data: [], error: null }, maybeSingleResult, singleResult, orderResult } = {}) {
  const builder = {};
  for (const method of ["select", "eq", "order", "limit", "insert", "update", "delete"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve, reject) => Promise.resolve(awaitResult).then(resolve, reject);
  builder.maybeSingle = vi.fn(async () => maybeSingleResult || awaitResult);
  builder.single = vi.fn(async () => singleResult || awaitResult);
  if (orderResult) builder.order = vi.fn(async () => orderResult);
  return builder;
}

function authScope() {
  mocks.auth.mockResolvedValue({ userId: "clerk-user-a", orgId: "clerk-org-a" });
  mocks.resolveAuthScope.mockResolvedValue({ workspaceId: "workspace-a", supabaseUserId: "user-a" });
}

beforeEach(() => {
  vi.clearAllMocks();
  authScope();
  mocks.resolveScopedShop.mockResolvedValue({ id: "shop-a", workspace_id: "workspace-a", shop_domain: "test-shop.example" });
  mocks.listScopedShops.mockResolvedValue([{ id: "shop-a", workspace_id: "workspace-a" }]);
  mocks.resolveShopifyCredentialsWithDiagnostics.mockResolvedValue({ shop_domain: "test-shop.example", access_token: "server-only-token" });
});

describe("greenfield agent playground API", () => {
  it("A: rejects unauthenticated access", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const response = await GET(new Request("http://localhost/api/agent-playground"));
    expect(response.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("B/C: lists only sessions owned by the current workspace and user", async () => {
    const list = chain({ awaitResult: { data: [{ id: "session-a", workspace_id: "workspace-a", owner_clerk_user_id: "clerk-user-a", title: "A", customer_email: null }], error: null } });
    const client = { from: vi.fn(() => list) };
    mocks.createClient.mockReturnValue(client);
    const response = await GET(new Request("http://localhost/api/agent-playground"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ sessions: [{ id: "session-a" }] });
    expect(list.eq).toHaveBeenCalledWith("workspace_id", "workspace-a");
    expect(list.eq).toHaveBeenCalledWith("owner_clerk_user_id", "clerk-user-a");

    const listAgain = chain({ awaitResult: { data: [], error: null } });
    const missing = chain({ maybeSingleResult: { data: null, error: null } });
    mocks.createClient.mockReturnValue({ from: vi.fn().mockReturnValueOnce(listAgain).mockReturnValueOnce(missing) });
    const crossSession = await GET(new Request("http://localhost/api/agent-playground?session_id=session-b"));
    expect(crossSession.status).toBe(404);
    expect(missing.eq).toHaveBeenCalledWith("workspace_id", "workspace-a");
    expect(missing.eq).toHaveBeenCalledWith("owner_clerk_user_id", "clerk-user-a");
  });

  it("D: creates isolated storage and never touches normal mail tables", async () => {
    const session = { id: "session-a", workspace_id: "workspace-a", owner_clerk_user_id: "clerk-user-a", title: "New conversation", customer_email: "customer@example.test" };
    const create = chain({ singleResult: { data: session, error: null } });
    const client = { from: vi.fn(() => create) };
    mocks.createClient.mockReturnValue(client);
    const response = await POST(new Request("http://localhost/api/agent-playground", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", customer_email: session.customer_email }),
    }));
    expect(response.status).toBe(200);
    expect(client.from).toHaveBeenCalledWith("greenfield_playground_sessions");
    expect(client.from.mock.calls.map(([table]) => table)).not.toEqual(expect.arrayContaining(["mail_threads", "mail_messages", "drafts", "draft_generations"]));
  });

  it("D2: imports only a scoped raw ticket into dedicated playground storage", async () => {
    const thread = chain({ maybeSingleResult: { data: {
      id: "thread-a",
      subject: "Where is my order?",
      mailbox_id: "mailbox-a",
      customer_email: "customer@example.test",
      customer_name: "Jonas Hoppe",
    }, error: null } });
    const mailbox = chain({ maybeSingleResult: { data: { shop_id: "shop-a" }, error: null } });
    const rawMessages = chain({ awaitResult: { data: [
      { from_me: false, clean_body_text: "Where is order 1055?", body_text: null, snippet: null, created_at: "2026-09-06T10:00:00.000Z" },
      { from_me: true, clean_body_text: "I will check that for you.", body_text: null, snippet: null, created_at: "2026-09-06T10:01:00.000Z" },
    ], error: null } });
    const session = chain({ singleResult: { data: {
      id: "session-imported",
      workspace_id: "workspace-a",
      owner_clerk_user_id: "clerk-user-a",
      title: "Where is my order?",
      customer_email: "customer@example.test",
    }, error: null } });
    const imported = chain({ orderResult: { data: [
      { id: "message-1", role: "user", content: "Where is order 1055?", trace_json: null, created_at: "2026-09-06T10:00:00.000Z" },
      { id: "message-2", role: "assistant", content: "I will check that for you.", trace_json: null, created_at: "2026-09-06T10:01:00.000Z" },
    ], error: null } });
    const client = {
      from: vi.fn()
        .mockReturnValueOnce(thread)
        .mockReturnValueOnce(mailbox)
        .mockReturnValueOnce(rawMessages)
        .mockReturnValueOnce(session)
        .mockReturnValueOnce(imported),
    };
    mocks.createClient.mockReturnValue(client);

    const response = await POST(new Request("http://localhost/api/agent-playground", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "import_ticket", thread_id: "thread-a" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.runGreenfieldAgentWithAgentsSdk).not.toHaveBeenCalled();
    expect(client.from.mock.calls.map(([table]) => table)).toEqual([
      "mail_threads",
      "mail_accounts",
      "mail_messages",
      "greenfield_playground_sessions",
      "greenfield_playground_messages",
    ]);
    expect(imported.insert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "Where is order 1055?", trace_json: null }),
      expect.objectContaining({ role: "assistant", content: "I will check that for you.", trace_json: null }),
    ]));
    expect(session.insert).toHaveBeenCalledWith(expect.objectContaining({
      conversation_context_json: expect.objectContaining({ customerFirstName: "Jonas" }),
    }));
  });

  it("E/G/H/I: runs the existing read-only providers with server credentials and stores a sanitized trace", async () => {
    const session = { id: "session-a", workspace_id: "workspace-a", owner_clerk_user_id: "clerk-user-a", title: "New conversation", customer_email: "customer@example.test", conversation_context_json: { customerFirstName: "Jonas" } };
    const oldMessages = chain({ awaitResult: { data: [], error: null } });
    const loaded = chain({ maybeSingleResult: { data: session, error: null } });
    const inserted = chain({ orderResult: { data: [
      { id: "message-user", role: "user", content: "Where is my order?", trace_json: null, created_at: "now" },
      { id: "message-assistant", role: "assistant", content: "I need your order number.", trace_json: { runtime: "@openai/agents", provider_results: [] }, created_at: "now" },
    ], error: null } });
    const updated = chain({ singleResult: { data: { ...session, title: "Where is my order?", updated_at: "now" }, error: null } });
    const client = {
      from: vi.fn()
        .mockReturnValueOnce(loaded)
        .mockReturnValueOnce(oldMessages)
        .mockReturnValueOnce(inserted)
        .mockReturnValueOnce(updated),
    };
    mocks.createClient.mockReturnValue(client);
    mocks.runGreenfieldAgentWithAgentsSdk.mockResolvedValue({
      response: "I need your order number.",
      proposedActions: [],
      trace: {
        traceId: "trace-a",
        startedAt: "2026-09-06T10:00:00.000Z",
        finishedAt: "2026-09-06T10:00:00.050Z",
        tools: [{ name: "get_order", sensitivity: "read_only" }],
        events: [{ type: "tool_result", at: "now", data: { name: "get_order", result: { status: "not_found", data: { order_focus: { state: "unresolved", requested_order_id: "1055" } }, error: { code: "not_found", message: "server-only-token" } } } }],
      },
      conversationContext: { turn: 1, activeOrder: { requestedOrderId: "1055", state: "unresolved", order: null }, customerSignal: null },
    });
    const response = await POST(new Request("http://localhost/api/agent-playground", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "send", session_id: "session-a", message: "Where is my order?", access_token: "browser-must-not-win" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.runGreenfieldAgentWithAgentsSdk).toHaveBeenCalledWith(expect.objectContaining({
      tenant: expect.objectContaining({ workspaceId: "workspace-a", shopId: "shop-a", customerEmail: "customer@example.test", customerName: "Jonas" }),
    }));
    expect(mocks.ShopifyReadOnlyProvider).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "server-only-token",
      customer: { email: "customer@example.test", name: "Jonas" },
    }));
    expect(mocks.Ship24ReadOnlyProvider).toHaveBeenCalledWith(expect.objectContaining({ requestImpl: expect.any(Function) }));
    expect(client.from.mock.calls.map(([table]) => table)).toEqual([
      "greenfield_playground_sessions",
      "greenfield_playground_messages",
      "greenfield_playground_messages",
      "greenfield_playground_sessions",
    ]);
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toContain("server-only-token");
    expect(JSON.stringify(payload)).not.toContain("browser-must-not-win");
  });

  it("F: deletes only the selected owned session and its dedicated cascade", async () => {
    const session = { id: "session-a", workspace_id: "workspace-a", owner_clerk_user_id: "clerk-user-a" };
    const loaded = chain({ maybeSingleResult: { data: session, error: null } });
    const deleted = chain({ awaitResult: { data: [], error: null } });
    const client = { from: vi.fn().mockReturnValueOnce(loaded).mockReturnValueOnce(deleted) };
    mocks.createClient.mockReturnValue(client);
    const response = await DELETE(new Request("http://localhost/api/agent-playground?session_id=session-a", { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(client.from).toHaveBeenNthCalledWith(2, "greenfield_playground_sessions");
    expect(deleted.eq).toHaveBeenCalledWith("workspace_id", "workspace-a");
    expect(deleted.eq).toHaveBeenCalledWith("owner_clerk_user_id", "clerk-user-a");
  });
});
