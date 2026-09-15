import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createServiceSupabase: vi.fn(),
  resolveAuthScope: vi.fn(),
  resolveScopedShop: vi.fn(),
  ingest: vi.fn(),
  replaceSource: vi.fn(),
  ensureEmbeddings: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/server/shopify-oauth", () => ({ createServiceSupabase: mocks.createServiceSupabase }));
vi.mock("@/lib/server/workspace-auth", () => ({
  resolveAuthScope: mocks.resolveAuthScope,
  resolveScopedShop: mocks.resolveScopedShop,
}));
vi.mock("@/lib/greenfield-support", () => ({
  SupabaseKnowledgeStore: class {
    ingest(...args) { return mocks.ingest(...args); }
    replaceSource(...args) { return mocks.replaceSource(...args); }
    ensureEmbeddings(...args) { return mocks.ensureEmbeddings(...args); }
  },
}));

function queryBuilder(resolveRows) {
  const filters = {};
  const query = {
    select() { return this; },
    eq(key, value) { filters[key] = value; return this; },
    in(key, value) { filters[key] = value; return this; },
    update() { return this; },
    ilike() { return this; },
    is() { return this; },
    order() { return this; },
    limit() { return this; },
    maybeSingle() { return Promise.resolve({ data: resolveRows(filters, true), error: null }); },
    single() { return Promise.resolve({ data: resolveRows(filters, true), error: null }); },
    then(resolve, reject) { return Promise.resolve({ data: resolveRows(filters, false), error: null }).then(resolve, reject); },
  };
  return query;
}

function makeSupabase({ records = [], products = [] } = {}) {
  const calls = [];
  const service = {
    calls,
    from(table) {
      calls.push(table);
      if (table === "shop_products") return queryBuilder(() => products);
      return queryBuilder((filters, single) => {
        const scoped = records.filter((row) => !filters.workspace_id || row.workspace_id === filters.workspace_id);
        if (single) return scoped.find((row) => !filters.id || row.id === filters.id) || null;
        return scoped;
      });
    },
  };
  return service;
}

const merchantRecord = {
  id: "record-a",
  workspace_id: "workspace-a",
  knowledge_type: "procedural",
  authority: "authoritative",
  title: "Connection steps",
  content: "Restart the receiver.",
  structured_data: {},
  source_kind: "merchant_authored",
  source_id: "merchant-ui:one",
  source_label: "Merchant",
  published_at: null,
  observed_at: "2026-09-06T12:00:00.000Z",
  expires_at: "2026-09-06T12:00:00.000Z",
  metadata: { lifecycle_status: "draft", applies_to: { kind: "all", product_ids: [] } },
  created_at: "2026-09-06T12:00:00.000Z",
  updated_at: "2026-09-06T12:00:00.000Z",
};

const { GET, POST } = await import("../route");
const { PATCH } = await import("../[id]/route");

describe("greenfield knowledge API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "clerk-user-a", orgId: "org-a", sessionClaims: {} });
    mocks.resolveAuthScope.mockResolvedValue({ workspaceId: "workspace-a", supabaseUserId: "user-a" });
    mocks.resolveScopedShop.mockResolvedValue({ id: "shop-a", workspace_id: "workspace-a" });
    mocks.ingest.mockResolvedValue({ id: "record-a" });
    mocks.replaceSource.mockResolvedValue({ id: "record-a" });
  });

  it("A/B/C: lists only the authenticated workspace and creates a draft through greenfield tables", async () => {
    const service = makeSupabase({ records: [merchantRecord] });
    mocks.createServiceSupabase.mockReturnValue(service);

    const listResponse = await GET(new Request("http://localhost/api/greenfield-knowledge"));
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({ records: [{ id: "record-a", status: "draft" }] });

    const createResponse = await POST(new Request("http://localhost/api/greenfield-knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspace_id: "workspace-b",
        title: "New guide",
        type: "procedure",
        status: "draft",
        content: "Disconnect the receiver before restarting it.",
        applies_to: { kind: "all", product_ids: [] },
      }),
    }));

    expect(createResponse.status).toBe(201);
    expect(mocks.ingest).toHaveBeenCalledWith("workspace-a", expect.objectContaining({ sourceKind: "merchant_authored" }));
    expect(mocks.ingest.mock.calls[0][0]).not.toBe("workspace-b");
    expect(service.calls).not.toContain("agent_knowledge");
    expect(service.calls).not.toContain("v3_knowledge_sources");
  });

  it("D/E/F: publishes, updates, and archives only an owned merchant record", async () => {
    const published = { ...merchantRecord, metadata: { lifecycle_status: "published", applies_to: { kind: "all", product_ids: [] } }, published_at: "2026-09-06T12:00:00.000Z", expires_at: null };
    const service = makeSupabase({ records: [published] });
    mocks.createServiceSupabase.mockReturnValue(service);

    const response = await PATCH(new Request("http://localhost/api/greenfield-knowledge/record-a", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Connection steps v2", type: "procedure", status: "archived", content: "Use the reset button.", applies_to: { kind: "all", product_ids: [] } }),
    }), { params: { id: "record-a" } });

    expect(response.status).toBe(200);
    expect(mocks.replaceSource).toHaveBeenCalledWith("workspace-a", "merchant-ui:one", expect.objectContaining({ metadata: expect.objectContaining({ lifecycle_status: "archived" }) }));
  });

  it("supports published create and lifecycle transitions for every knowledge type", async () => {
    const published = { ...merchantRecord, metadata: { lifecycle_status: "published", applies_to: { kind: "all", product_ids: [] } }, published_at: "2026-09-06T12:00:00.000Z", expires_at: null };
    const service = makeSupabase({ records: [published] });
    mocks.createServiceSupabase.mockReturnValue(service);

    for (const type of ["policy", "product", "brand", "procedure"]) {
      mocks.ingest.mockResolvedValueOnce({ id: "record-a" });
      const response = await POST(new Request("http://localhost/api/greenfield-knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: `${type} guide`, type, status: "published", content: `Published ${type} guidance.`, applies_to: { kind: "all", product_ids: [] } }),
      }));
      expect(response.status).toBe(201);
      expect(mocks.ingest).toHaveBeenLastCalledWith("workspace-a", expect.objectContaining({ knowledgeType: type === "procedure" ? "procedural" : type, metadata: expect.objectContaining({ lifecycle_status: "published" }) }));
    }

    const transition = await PATCH(new Request("http://localhost/api/greenfield-knowledge/record-a", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Connection steps", type: "procedure", status: "unpublished", content: "Use the reset button.", applies_to: { kind: "all", product_ids: [] } }),
    }), { params: { id: "record-a" } });

    expect(transition.status).toBe(200);
    expect(mocks.replaceSource).toHaveBeenLastCalledWith("workspace-a", "merchant-ui:one", expect.objectContaining({ metadata: expect.objectContaining({ lifecycle_status: "unpublished" }) }));
  });

  it("G/H: rejects product IDs outside the current Shopify store scope", async () => {
    const service = makeSupabase({ records: [], products: [] });
    mocks.createServiceSupabase.mockReturnValue(service);
    const response = await POST(new Request("http://localhost/api/greenfield-knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Product guide", type: "product", status: "draft", content: "Scoped product guidance.", applies_to: { kind: "products", product_ids: ["999"] } }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it("I: keeps imported content read-only while allowing lifecycle review", async () => {
    const imported = { ...merchantRecord, source_kind: "website", source_id: "website:returns", metadata: {} };
    const service = makeSupabase({ records: [imported] });
    mocks.createServiceSupabase.mockReturnValue(service);
    const response = await PATCH(new Request("http://localhost/api/greenfield-knowledge/record-a", { method: "PATCH", body: JSON.stringify({ status: "published", content: "Attempted overwrite" }) }), { params: { id: "record-a" } });
    expect(response.status).toBe(403);
    expect(mocks.replaceSource).not.toHaveBeenCalled();
  });

  it("re-indexes imported chunks when lifecycle moves to published", async () => {
    const imported = { ...merchantRecord, source_kind: "shopify", source_id: "shopify:shop-a", metadata: { lifecycle_status: "draft" } };
    const service = makeSupabase({ records: [imported] });
    mocks.createServiceSupabase.mockReturnValue(service);

    const response = await PATCH(new Request("http://localhost/api/greenfield-knowledge/record-a", {
      method: "PATCH",
      body: JSON.stringify({ status: "published" }),
    }), { params: { id: "record-a" } });

    expect(response.status).toBe(200);
    expect(mocks.ensureEmbeddings).toHaveBeenCalledWith("workspace-a", "record-a");
  });
});
