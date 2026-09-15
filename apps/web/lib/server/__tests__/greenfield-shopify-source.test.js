import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchShopifyPolicies: vi.fn(),
  fetchShopifyProducts: vi.fn(),
}));

vi.mock("@/lib/server/shopify-policy-sync", () => ({
  fetchShopifyPolicies: mocks.fetchShopifyPolicies,
  stripHtml: (value) => String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
}));
vi.mock("@/lib/server/shopify-product-fetch", () => ({ fetchShopifyProducts: mocks.fetchShopifyProducts }));

const { buildShopifyKnowledgeSource, fetchShopifyKnowledge } = await import("../greenfield-shopify-source");

describe("Greenfield Shopify source adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps returned policies and products into deterministic V1 candidates", () => {
    const source = buildShopifyKnowledgeSource({
      shopId: "shop-a",
      shopDomain: "https://store.example/",
      publicStorefrontDomain: "www.store.example",
      observedAt: "2026-09-10T12:00:00.000Z",
      policies: [
        { id: 2, title: "Shipping policy", handle: "shipping-policy", body: "<p>Ships in 2 days.</p>", url: "https://store.example/policies/shipping-policy" },
        { id: 1, title: "Returns", handle: "refund-policy", body: "<p>Returns within 30 days.</p>" },
        { id: 3, title: "Privacy", handle: "privacy-policy", body: "" },
      ],
      products: [{ id: 99, title: "Headset", handle: "headset", body_html: "<p>Wireless audio.</p>", vendor: "Acme", product_type: "Audio" }],
    });

    expect(source.sourceKind).toBe("shopify");
    expect(source.sourceId).toBe("shopify:shop-a");
    expect(source.sourceLabel).toBe("Shopify");
    expect(source.candidates.map((candidate) => candidate.recordKey)).toEqual(["policy:1", "policy:2", "product:99"]);
    expect(source.candidates[0]).toMatchObject({ knowledgeType: "policy", authority: "authoritative", metadata: { shopify_policy_type: "refund", lifecycle_status: "draft" } });
    expect(source.candidates[2]).toMatchObject({ knowledgeType: "product", authority: "reference", metadata: { applies_to: { kind: "products", product_ids: ["99"] } } });
    expect(source.candidates[0].content).toBe("Returns within 30 days.");
    expect(source.metadata).toMatchObject({ shop_domain: "store.example", fetched_policy_count: 3, imported_policy_count: 2, imported_product_count: 1 });
  });

  it("keeps the source content stable when Shopify changes response ordering", () => {
    const input = {
      shopId: "shop-a",
      shopDomain: "store.example",
      observedAt: "2026-09-10T12:00:00.000Z",
      policies: [{ id: 2, title: "B", body: "Second" }, { id: 1, title: "A", body: "First" }],
      products: [{ id: 9, title: "P", body: "Product" }],
    };
    const left = buildShopifyKnowledgeSource(input);
    const right = buildShopifyKnowledgeSource({ ...input, policies: [...input.policies].reverse(), products: [...input.products].reverse() });
    expect(left.content).toBe(right.content);
    expect(left.candidates.map((candidate) => candidate.recordKey)).toEqual(right.candidates.map((candidate) => candidate.recordKey));
  });

  it("reuses the existing read-only policy and product fetchers", async () => {
    mocks.fetchShopifyPolicies.mockResolvedValue([{ id: 1, title: "Returns", body: "Returns within 30 days." }]);
    mocks.fetchShopifyProducts.mockResolvedValue([{ id: 2, title: "Headset", body: "Wireless." }]);
    const result = await fetchShopifyKnowledge({ shopId: "shop-a", shopDomain: "store.example", accessToken: "server-token" });

    expect(mocks.fetchShopifyPolicies).toHaveBeenCalledWith({ domain: "store.example", accessToken: "server-token" });
    expect(mocks.fetchShopifyProducts).toHaveBeenCalledWith({ domain: "store.example", accessToken: "server-token" });
    expect(result.source.candidates).toHaveLength(2);
  });
});
