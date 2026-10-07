import { describe, expect, it } from "vitest";
import { resolveCatalogIdentity } from "../catalog-identity";
import { ShopifyReadOnlyProvider } from "../shopify-read-only";

const catalog = [
  { id: 1, title: "Aurora Ceramic Vase", handle: "aurora-ceramic-vase", status: "active", variants: [
    { id: 11, title: "Moss", sku: "VASE-MOSS", price: "45.00" },
    { id: 12, title: "Ivory", sku: "VASE-IVORY", price: "45.00" },
  ] },
  { id: 2, title: "Orbit Lamp", handle: "orbit-lamp", status: "active", variants: [
    { id: 21, title: "Black", sku: "LAMP-BLACK" }, { id: 22, title: "White", sku: "LAMP-WHITE" },
  ] },
  { id: 3, title: "Cedar Table", status: "active", variants: [{ id: 31, title: "Walnut" }] },
  { id: 4, title: "Dune Cushion Cover", status: "active", variants: [{ id: 41, title: "Olive" }] },
  { id: 5, title: "Summit Hooks", status: "active", variants: [{ id: 51, title: "Silver" }] },
];
const identity = (query, products = catalog) => resolveCatalogIdentity(query, products)
  .map(({ product, variants, variantSpecified }) => ({ id: product.id, variants: variants.map((v) => v.id), variantSpecified }));

describe("live catalog identity", () => {
  it.each(["Aurora Ceramic Vase", "Aurora vase", "Aurora", "AURORA, ceramic VASE!", "Auro"])("resolves product %s without selecting an arbitrary variant", (query) => {
    expect(identity(query)).toEqual([{ id: 1, variants: [11, 12], variantSpecified: false }]);
  });
  it.each([
    ["Aurora Moss", 1, 11],
    ["Aurora Ceramic Vase — moss variant (order #1072)", 1, 11],
    ["SKU VASE-MOSS (Aurora Ceramic Vase, Moss; variant 11)", 1, 11],
    ["SKU VASE-MOSS", 1, 11],
    ["Aurora Ceramic Vase, moss variant, variant ID 11", 1, 11], ["Moss Aurora vase", 1, 11],
    ["Har I Aurora vasen i Moss på lager?", 1, 11],
    ["Can I buy a moss Aurora vase right now?", 1, 11],
    ["Cedar Walnut", 3, 31], ["Dune Olive", 4, 41],
    ["black Orbit lamp", 2, 21], ["den sorte Orbit lampe", 2, 21],
    ["Summit Silver", 5, 51], ["VASE-MOSS", 1, 11], ["11", 1, 11],
  ])("resolves %s to canonical variant", (query, id, variant) => {
    expect(identity(query)).toEqual([{ id, variants: [variant], variantSpecified: true }]);
  });
  it("preserves genuine product ambiguity", () => {
    const duplicate = { ...catalog[0], id: 6, title: "Aurora Glass Vase", handle: "aurora-glass-vase" };
    expect(identity("Aurora vase", [...catalog, duplicate]).map((m) => m.id)).toEqual([1, 6]);
  });
  it.each(["Unknown item", "Aurora Olive", "Black Aurora vase", "Moss", "Cedar Walnut Silver", "SKU VASE-MOSS Orbit Lamp", "Aurora Moss variant 999999", "order #1072", "Aurora Moss Ivory"])("never substitutes another product or variant for %s", (query) => {
    expect(identity(query)).toEqual([]);
  });
  it("does not prefer a title prefix over another matching product", () => {
    expect(identity("Orbit", [...catalog, { ...catalog[1], id: 6, title: "Orbital Lamp", handle: "orbital-lamp" }])).toHaveLength(2);
  });
  it("exact title takes precedence over a longer similar title", () => {
    expect(identity("Orbit Lamp", [...catalog, { ...catalog[1], id: 6, title: "Orbit Lamp XL", handle: "orbit-lamp-xl" }])).toEqual([{ id: 2, variants: [21, 22], variantSpecified: false }]);
  });
});

describe("Customer #1 product family separation", () => {
  const products = [
    { id: 101, title: "A-Spire", handle: "a-spire", variants: [{ id: 1011, title: "Black" }] },
    { id: 102, title: "A-Spire Wireless", handle: "a-spire-wireless", variants: [{ id: 1021, title: "Black" }] },
    { id: 103, title: "A-Blaze", handle: "a-blaze", variants: [{ id: 1031, title: "Black" }] },
  ];
  it.each([["A-Spire", 101], ["A-Spire Wireless", 102], ["A-Blaze", 103], ["Black A-Spire Wireless", 102]])("keeps %s in its canonical product family", (query, id) => {
    expect(resolveCatalogIdentity(query, products).map((match) => match.product.id)).toEqual([id]);
  });
  it("never substitutes a different product family", () => {
    expect(resolveCatalogIdentity("A-Blaze Wireless", products)).toEqual([]);
  });
});

function provider(fetchImpl) {
  return new ShopifyReadOnlyProvider({ shopDomain: "catalog.myshopify.com", accessToken: "test-token", fetchImpl });
}
function page(products, link) {
  return new Response(JSON.stringify({ products }), { headers: link ? { link } : {} });
}
describe("complete scoped live catalog", () => {
  it("both operations use the canonical selected variant from later pages", async () => {
    const calls = [];
    const read = provider(async (url, options) => {
      expect(options.method).toBe("GET");
      calls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith("locations.json")) return new Response(JSON.stringify({ locations: [{ id: 1, active: true }] }));
      return u.searchParams.has("page_info") ? page([catalog[0]]) : page([catalog[1]], '<https://catalog.myshopify.com/admin/api/2026-07/products.json?page_info=opaque&limit=250>; rel="next"');
    });
    expect(await read.getProduct("Moss Aurora vase")).toMatchObject({ status: "ok", products: [{ id: 1, variants: [{ id: 11, price: "45.00" }] }] });
    expect(await read.getProductAvailability("11")).toMatchObject({ status: "ok", products: [{ id: "1", variants: [{ id: "11", availability_state: "UNKNOWN" }] }] });
    expect(calls.filter((url) => url.includes("page_info")).every((url) => !url.includes("status=") && !url.includes("fields="))).toBe(true);
  });
  it("ambiguity on a later page prevents a unique match", async () => {
    const read = provider(async (url) => new URL(url).searchParams.has("page_info")
      ? page([{ ...catalog[0], id: 9, title: "Aurora Glass Vase", handle: "aurora-glass-vase" }])
      : page([catalog[0]], '<https://catalog.myshopify.com/admin/api/2026-07/products.json?page_info=next>; rel="next"'));
    expect(await read.getProduct("Aurora vase")).toMatchObject({ status: "ambiguous", products: [{ id: 1 }, { id: 9 }] });
  });
  it("does not return a partial catalog if a later page fails", async () => {
    const read = provider(async (url) => new URL(url).searchParams.has("page_info")
      ? new Response("{}", { status: 503 })
      : page([catalog[0]], '<https://catalog.myshopify.com/admin/api/2026-07/products.json?page_info=next>; rel="next"'));
    await expect(read.getProduct("Aurora Moss")).rejects.toThrow("503");
  });
  it("never sends credentials to a pagination link on another host", async () => {
    let calls = 0;
    const read = provider(async () => { calls++; return page([catalog[0]], '<https://wrong.example/products.json?page_info=next>; rel="next"'); });
    await expect(read.getProduct("Aurora Moss")).rejects.toThrow("scope mismatch");
    expect(calls).toBe(1);
  });
  it("fails closed on malformed next links", async () => {
    const read = provider(async () => page([catalog[0]], 'missing-url; rel="next"'));
    await expect(read.getProduct("Aurora Moss")).rejects.toThrow("malformed link");
  });
  it("fails closed on repeated pagination instead of accepting a partial catalog", async () => {
    const read = provider(async () => page([catalog[0]], '<https://catalog.myshopify.com/admin/api/2026-07/products.json?page_info=next>; rel="next"'));
    await expect(read.getProduct("Aurora Moss")).rejects.toThrow("repeated cursor");
  });
});
