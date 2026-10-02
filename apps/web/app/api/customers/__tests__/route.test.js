import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  scope: vi.fn(),
  directory: vi.fn(),
  credentials: vi.fn(),
  history: vi.fn(),
  counts: vi.fn(),
  fetchImpl: null,
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/server/supabase-server-config", () => ({
  resolveSupabaseServerConfig: () => ({
    url: "https://dev.example.com",
    serviceKey: "test",
  }),
}));
vi.mock("@/lib/server/workspace-auth", () => ({
  resolveAuthScope: mocks.scope,
}));
vi.mock("@/lib/server/customers", () => ({
  loadCustomerDirectory: mocks.directory,
}));
vi.mock("@/lib/server/shopify-credentials", () => ({
  resolveShopifyCredentialsWithDiagnostics: mocks.credentials,
}));
vi.mock("@/lib/server/customer-order-counts", () => ({
  fetchCustomerOrderCounts: mocks.counts,
}));
vi.mock("@/lib/greenfield-support/shopify-read-only", () => ({
  ShopifyReadOnlyProvider: class {
    constructor(options) {
      mocks.fetchImpl = options.fetchImpl;
    }
    getOrderHistory(email) {
      return mocks.history(email);
    }
  },
}));
import { GET } from "../route";
const request = (id) =>
  new Request(
    "http://localhost/api/customers" +
      (id ? "?customer=" + encodeURIComponent(id) : ""),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "user", orgId: "org" });
  mocks.scope.mockResolvedValue({ workspaceId: "workspace" });
  mocks.directory.mockResolvedValue({
    customers: [
      { id: "shop:ada@example.com", shopId: "shop", email: "ada@example.com" },
    ],
    shops: [],
  });
  mocks.credentials.mockResolvedValue({
    shop_domain: "demo.myshopify.com",
    access_token: "private",
  });
  mocks.history.mockResolvedValue([{ id: "123", orderNumber: "1001" }]);
});
describe("customers API access", () => {
  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue({});
    expect((await GET(request())).status).toBe(401);
    expect(mocks.directory).not.toHaveBeenCalled();
  });
  it("rejects user-only scope and inaccessible organizations", async () => {
    mocks.scope.mockResolvedValue({ supabaseUserId: "owner" });
    expect((await GET(request())).status).toBe(403);
    mocks.scope.mockRejectedValue(new Error("membership denied"));
    expect((await GET(request())).status).toBe(403);
    expect(mocks.directory).not.toHaveBeenCalled();
  });
  it("does not lookup customers outside the current directory", async () => {
    expect((await GET(request("other-shop:ada@example.com"))).status).toBe(404);
    expect(mocks.credentials).not.toHaveBeenCalled();
  });
  it("looks up the explicit customer shop and email and never returns credentials", async () => {
    const response = await GET(request("shop:ada@example.com"));
    const body = await response.json();
    expect(mocks.credentials).toHaveBeenCalledWith(
      {},
      { workspaceId: "workspace" },
      expect.objectContaining({ requestedShopId: "shop" }),
    );
    expect(mocks.history).toHaveBeenCalledWith("ada@example.com");
    expect(body.orders[0].adminUrl).toBe(
      "https://demo.myshopify.com/admin/orders/123",
    );
    expect(JSON.stringify(body)).not.toContain("private");
  });
  it("filters approximate Shopify matches to the exact customer email", async () => {
    await GET(request("shop:ada@example.com"));
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          orders: [
            { id: 1, email: "ADA@example.com" },
            { id: 2, email: "other@example.com" },
          ],
        }),
      ),
    );
    try {
      const response = await mocks.fetchImpl(
        "https://demo.myshopify.com/admin/api/orders.json",
        {},
      );
      expect((await response.json()).orders.map((order) => order.id)).toEqual([
        1,
      ]);
    } finally {
      mockFetch.mockRestore();
    }
  });
  it("counts only workspace customers using the explicit shop", async () => {
    mocks.counts.mockResolvedValue({
      "shop:ada@example.com": { status: "checked", count: 125 },
    });
    const response = await GET(
      new Request(
        "http://localhost/api/customers?count=shop%3Aada%40example.com",
      ),
    );
    expect(await response.json()).toEqual({
      counts: { "shop:ada@example.com": { status: "checked", count: 125 } },
    });
    expect(mocks.credentials).toHaveBeenCalledWith(
      {},
      { workspaceId: "workspace" },
      expect.objectContaining({ requestedShopId: "shop" }),
    );
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("rejects out-of-workspace count requests before contacting Shopify", async () => {
    expect(
      (await GET(new Request("http://localhost/api/customers?count=other")))
        .status,
    ).toBe(404);
    expect(mocks.counts).not.toHaveBeenCalled();
    expect(mocks.credentials).not.toHaveBeenCalled();
  });
  it("keeps failed counts distinct from zero", async () => {
    mocks.counts.mockRejectedValue(new Error("access denied"));
    const response = await GET(
      new Request(
        "http://localhost/api/customers?count=shop%3Aada%40example.com",
      ),
    );
    expect(await response.json()).toEqual({
      counts: { "shop:ada@example.com": { status: "error" } },
    });
  });
  it("distinguishes unlinked inboxes and failed lookups from zero orders", async () => {
    mocks.directory.mockResolvedValue({
      customers: [{ id: "unlinked", email: "ada@example.com", shopId: null }],
      shops: [],
    });
    expect(await (await GET(request("unlinked"))).json()).toMatchObject({
      status: "not_connected",
    });
    expect(mocks.credentials).not.toHaveBeenCalled();
    mocks.directory.mockRejectedValue(new Error("database unavailable"));
    expect((await GET(request())).status).toBe(502);
  });
});
