import { it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), production: false, devDiagnostics: false, devTarget: true }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/server/shopify-oauth", () => ({
  createServiceSupabase: mocks.client,
}));
vi.mock("@/lib/server/greenfield-playground", () => ({
  isGreenfieldPlaygroundEnabled: () => true,
  isGreenfieldPlaygroundProduction: () => mocks.production,
  isGreenfieldPlaygroundDevDiagnosticsEnabled: () => mocks.devDiagnostics,
  isGreenfieldPlaygroundDevTarget: () => mocks.devTarget,
}));
vi.mock("@/lib/server/workspace-auth", () => ({
  resolveAuthScope: async () => ({ workspaceId: "tenant-a" }),
  resolveScopedShop: async () => ({ id: "shop-a" }),
}));
vi.mock("@/lib/server/knowledge-v2/authz", () => ({
  resolveKnowledgeContext: async () => ({
    workspaceId: "tenant-a",
    shopId: "shop-a",
  }),
  KnowledgeAuthzError: class extends Error {},
}));
import { GET } from "../route";
it("normal KN2 read API preserves canonical semantic types, source text and product applicability", async () => {
  mocks.auth.mockResolvedValue({ userId: "user-a" });
  const payload = {
    contract: "merchant_support/v1",
    semantic_type: "FACT",
    title: "Compatibility guide",
    text: "Compatible with 11–16 inch devices.",
    applicability: { kind: "products", product_ids: ["123"] },
    product_bindings: [{ id: "123", title: "Catalog stand" }],
    provenance: [{ source_id: "source-a" }],
  };
  const tables = {
    kn2_releases: {
      seq: 1,
      platform_version: "sona-0.6.0",
      platform_hash: "hash",
      sealed_at: "now",
      activated_at: "now",
    },
    kn2_unit_versions: [
      {
        id: "unit-version",
        unit_id: "unit-a",
        kind: "value",
        domain_key: "compatibility",
        from_seq: 1,
        to_seq: null,
        payload,
        scope: payload.applicability,
        origin_policy_id: "policy-a",
        audience: "customer",
      },
    ],
    kn2_policies: [
      {
        id: "policy-a",
        domain_key: "general",
        title: "Document",
        drafts: {
          merchant_document: {
            contract: "merchant_support/v1",
            title: "Document",
            content: "Original source",
            units: [],
          },
        },
      },
    ],
    kn2_sources: [],
    kn2_review_items: [],
    shop_products: [],
  };
  mocks.client.mockReturnValue({
    from(table) {
      const r = { data: tables[table], error: null };
      const b = {};
      for (const method of [
        "select",
        "eq",
        "not",
        "order",
        "limit",
        "lte",
        "or",
      ])
        b[method] = () => b;
      b.maybeSingle = async () => r;
      b.then = (a, z) => Promise.resolve(r).then(a, z);
      return b;
    },
  });
  const response = await GET();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.knowledge[0]).toMatchObject({
    title: "Compatibility guide",
    summary: payload.text,
    knowledgeType: "FACT",
    applicability: ["Catalog stand"],
  });
  expect(body.merchantDocuments).toHaveLength(1);
  expect(body.release).toMatchObject({ seq: 1, platformVersion: "sona-0.6.0" });
});

it("allows an explicitly configured DEV deployment using a production build", async () => {
  mocks.production = true;
  mocks.devDiagnostics = true;
  mocks.devTarget = true;
  mocks.auth.mockResolvedValue({ userId: null });
  const response = await GET(new Request("http://localhost/api/knowledge-v2"));
  expect(response.status).toBe(401);
});
it("keeps other production targets disabled", async () => {
  mocks.production = true;
  mocks.devDiagnostics = false;
  expect((await GET(new Request("http://localhost/api/knowledge-v2"))).status).toBe(404);
  mocks.devDiagnostics = true;
  mocks.devTarget = false;
  expect((await GET(new Request("http://localhost/api/knowledge-v2"))).status).toBe(404);
});
