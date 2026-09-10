import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createServiceSupabase: vi.fn(),
  resolveAuthScope: vi.fn(),
  resolveScopedShop: vi.fn(),
  decryptString: vi.fn(),
  fetchShopifyKnowledge: vi.fn(),
  ingestSource: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/server/shopify-oauth", () => ({ createServiceSupabase: mocks.createServiceSupabase, decryptString: mocks.decryptString }));
vi.mock("@/lib/server/workspace-auth", () => ({ resolveAuthScope: mocks.resolveAuthScope, resolveScopedShop: mocks.resolveScopedShop }));
vi.mock("@/lib/server/greenfield-shopify-source", () => ({ fetchShopifyKnowledge: mocks.fetchShopifyKnowledge }));
vi.mock("@/lib/greenfield-support", () => ({
  SupabaseKnowledgeStore: class {
    ingestSource(...args) { return mocks.ingestSource(...args); }
  },
}));

const { GET, POST } = await import("../route");

function chain({ maybeSingle = { data: null, error: null }, rows = [] } = {}) {
  const builder = {
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => maybeSingle,
    then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
  };
  return builder;
}

function makeSupabase({ source = null, records = [] } = {}) {
  return {
    from(table) {
      return table === "greenfield_knowledge_sources"
        ? chain({ maybeSingle: { data: source, error: null } })
        : chain({ rows: records });
    },
  };
}

const shop = {
  id: "shop-a",
  workspace_id: "workspace-a",
  platform: "shopify",
  shop_domain: "store.example",
  public_storefront_domain: "www.store.example",
  access_token_encrypted: "encrypted-token",
};

const source = {
  sourceKind: "shopify",
  sourceId: "shopify:shop-a",
  title: "Shopify",
  content: "## Returns\n\nReturns within 30 days.",
  sourceLabel: "Shopify",
  candidates: [{ recordKey: "policy:1", title: "Returns", content: "Returns within 30 days.", knowledgeType: "policy", authority: "authoritative" }],
};

describe("Greenfield Shopify knowledge API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "clerk-user-a", orgId: "org-a", sessionClaims: {} });
    mocks.resolveAuthScope.mockResolvedValue({ workspaceId: "workspace-a", supabaseUserId: "user-a" });
    mocks.resolveScopedShop.mockResolvedValue(shop);
    mocks.decryptString.mockReturnValue("server-token");
    mocks.fetchShopifyKnowledge.mockResolvedValue({ policies: [{ id: 1 }], products: [{ id: 2 }], source });
    mocks.ingestSource.mockResolvedValue({ sourceId: "source-uuid", sourceVersion: 1, records: source.candidates });
  });

  it("requires authentication and a single scoped Shopify store", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const unauthenticated = await GET();
    expect(unauthenticated.status).toBe(401);

    mocks.auth.mockResolvedValue({ userId: "clerk-user-a" });
    mocks.createServiceSupabase.mockReturnValue(makeSupabase());
    mocks.resolveScopedShop.mockRejectedValue(new Error("shop_id is required when multiple shops are available."));
    const ambiguous = await POST();
    expect(ambiguous.status).toBe(409);
    expect(mocks.fetchShopifyKnowledge).not.toHaveBeenCalled();
  });

  it("resolves server-side credentials and ingests only into Knowledge V1", async () => {
    const client = makeSupabase({ source: { id: "source-uuid", title: "Shopify", source_version: 1, status: "draft", source_label: "Shopify", updated_at: "2026-09-10T12:00:00.000Z" }, records: [{ id: "record-1", knowledge_type: "policy", metadata: { lifecycle_status: "draft" } }] });
    mocks.createServiceSupabase.mockReturnValue(client);
    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.resolveScopedShop).toHaveBeenCalledWith(client, expect.objectContaining({ workspaceId: "workspace-a" }), "", expect.objectContaining({ platform: "shopify", allowSingleScopedFallback: true }));
    expect(mocks.decryptString).toHaveBeenCalledWith("encrypted-token");
    expect(mocks.fetchShopifyKnowledge).toHaveBeenCalledWith({ shopId: "shop-a", shopDomain: "store.example", publicStorefrontDomain: "www.store.example", accessToken: "server-token" });
    expect(mocks.ingestSource).toHaveBeenCalledWith("workspace-a", source);
    await expect(response.json()).resolves.toMatchObject({ connected: true, imported: true, candidate_count: 1, source: { label: "Shopify", counts: { total: 1, draft: 1 } } });
  });

  it("leaves existing V1 knowledge unchanged when Shopify returns no usable content", async () => {
    mocks.createServiceSupabase.mockReturnValue(makeSupabase());
    mocks.fetchShopifyKnowledge.mockResolvedValue({ policies: [], products: [], source: { ...source, candidates: [], content: "" } });
    const response = await POST();
    expect(response.status).toBe(200);
    expect(mocks.ingestSource).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ imported: false, fetched: { policies: 0, products: 0 } });
  });
});
