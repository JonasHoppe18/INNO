import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createClient: vi.fn(),
  applyScope: vi.fn(),
  resolveAuthScope: vi.fn(),
  resolveShopifyCredentialsWithDiagnostics: vi.fn(),
  isExternalCustomerEmail: vi.fn(),
  loadWorkspaceInternalEmails: vi.fn(),
  normalizeCustomerEmail: vi.fn(),
  resolveWorkspaceCustomer: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/server/workspace-auth", () => ({
  applyScope: mocks.applyScope,
  resolveAuthScope: mocks.resolveAuthScope,
}));
vi.mock("@/lib/server/shopify-credentials", () => ({
  resolveShopifyCredentialsWithDiagnostics: mocks.resolveShopifyCredentialsWithDiagnostics,
}));
vi.mock("@/lib/server/customer-identity", () => ({
  isExternalCustomerEmail: mocks.isExternalCustomerEmail,
  loadWorkspaceInternalEmails: mocks.loadWorkspaceInternalEmails,
  normalizeCustomerEmail: mocks.normalizeCustomerEmail,
  resolveWorkspaceCustomer: mocks.resolveWorkspaceCustomer,
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://development.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const { POST } = await import("../route.js");

function chain(result = { data: [], error: null }) {
  const builder = {};
  for (const method of [
    "select", "eq", "in", "ilike", "or", "not", "order", "limit", "neq", "is", "upsert", "insert",
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ userId: "clerk-user-a", orgId: "clerk-org-a" });
  mocks.resolveAuthScope.mockResolvedValue({ workspaceId: "workspace-a", supabaseUserId: null });
  mocks.applyScope.mockImplementation((query, scope) => query.eq("workspace_id", scope.workspaceId));
  mocks.normalizeCustomerEmail.mockImplementation((value) => String(value || "").trim().toLowerCase());
  mocks.isExternalCustomerEmail.mockReturnValue(true);
  mocks.loadWorkspaceInternalEmails.mockResolvedValue([]);
  mocks.resolveWorkspaceCustomer.mockResolvedValue({
    id: "customer-a",
    workspace_id: "workspace-a",
    normalized_email: "customer@example.com",
    name: null,
    phone: null,
  });
});

function buildClient({ sourceMessage, previousTickets, shops, existingCustomer } = {}) {
  const source = chain({
    data: sourceMessage || {
      id: "message-a",
      from_email: "customer@example.com",
      extracted_customer_email: null,
      from_me: false,
    },
    error: null,
  });
  const tickets = chain({ data: previousTickets || [], error: null });
  const shopRows = chain({ data: shops || { shop_domain: "shop.example.com" }, error: null });
  const customerRows = chain({ data: existingCustomer || null, error: null });
  const logs = chain();
  return {
    client: {
      from: vi.fn((table) => {
        if (table === "mail_messages") return source;
        if (table === "mail_threads") return tickets;
        if (table === "shops") return shopRows;
        if (table === "workspace_customers") return customerRows;
        if (table === "agent_logs") return logs;
        throw new Error(`Unexpected table ${table}`);
      }),
    },
    tickets,
  };
}

describe("POST /api/inbox/customer-lookup Sona identity", () => {
  it("returns a profile and history when Shopify is disconnected", async () => {
    mocks.resolveShopifyCredentialsWithDiagnostics.mockRejectedValue(new Error("No Shopify connection"));
    const { client, tickets } = buildClient({
      previousTickets: [{
        id: "thread-old",
        ticket_number: 50001,
        subject: "Earlier question",
        status: "resolved",
        last_message_at: "2026-09-09T10:00:00.000Z",
      }],
    });
    mocks.createClient.mockReturnValue(client);

    const response = await POST(new Request("http://localhost/api/inbox/customer-lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "Customer@Example.com",
        threadId: "thread-current",
        sourceMessageId: "message-a",
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.customer).toMatchObject({ id: "customer-a", email: "customer@example.com" });
    expect(payload.sonaCustomer).toMatchObject({ id: "customer-a" });
    expect(payload.orders).toEqual([]);
    expect(payload.previousTickets).toEqual([expect.objectContaining({ thread_id: "thread-old" })]);
    expect(payload.shopify).toMatchObject({ available: false, error: "Shopify enrichment unavailable." });
    expect(tickets.ilike).toHaveBeenCalledWith("customer_email", "customer@example.com");
  });

  it("keeps the Sona profile when Shopify returns no orders", async () => {
    mocks.resolveShopifyCredentialsWithDiagnostics.mockResolvedValue({
      shop_domain: "shop.example.com",
      access_token: "server-only-token",
      shop_id: "shop-a",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ orders: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    try {
      const { client } = buildClient();
      mocks.createClient.mockReturnValue(client);
      const response = await POST(new Request("http://localhost/api/inbox/customer-lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "customer@example.com",
          threadId: "thread-current",
          sourceMessageId: "message-a",
        }),
      }));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.customer).toMatchObject({ id: "customer-a", email: "customer@example.com" });
      expect(payload.orders).toEqual([]);
      expect(payload.shopify).toMatchObject({ available: true, error: null });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps legacy raw-email history when no Sona row exists", async () => {
    mocks.resolveShopifyCredentialsWithDiagnostics.mockRejectedValue(new Error("No Shopify connection"));
    const { client, tickets } = buildClient({
      previousTickets: [{
        id: "legacy-thread",
        ticket_number: 50002,
        subject: "Legacy ticket",
        status: "open",
        last_message_at: "2026-09-08T10:00:00.000Z",
      }],
    });
    mocks.createClient.mockReturnValue(client);

    const response = await POST(new Request("http://localhost/api/inbox/customer-lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "customer@example.com" }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.customer).toBeNull();
    expect(payload.previousTickets).toEqual([expect.objectContaining({ thread_id: "legacy-thread" })]);
    expect(tickets.ilike).toHaveBeenCalledWith("customer_email", "customer@example.com");
  });
});
