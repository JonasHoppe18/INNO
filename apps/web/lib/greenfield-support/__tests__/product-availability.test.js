import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../capabilities";
import { GREENFIELD_TOOL_DEFINITIONS, parseToolArguments } from "../tool-contracts";
import { validateStructuredResponse } from "../response-contract";
import { ShopifyReadOnlyProvider, shopifyAvailabilityState } from "../shopify-read-only";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

const tenant = { workspaceId: "workspace-a", customerEmail: "customer@example.test" };
const emptyKnowledge = { search: async () => [] };

function productPayload(products) {
  return { products };
}

function locationPayload(locations = [{ id: 1, name: "Shop location", active: true }]) {
  return { locations };
}

function providerFor(products, calls = []) {
  return new ShopifyReadOnlyProvider({
    shopDomain: "test.myshopify.com",
    accessToken: "server-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/locations.json")) return jsonResponse(locationPayload());
      if (parsed.pathname.endsWith("/products.json")) {
        const title = parsed.searchParams.get("title");
        return jsonResponse(productPayload(title ? products : []));
      }
      throw new Error(`unexpected test request: ${url}`);
    },
  });
}

function variant(overrides = {}) {
  return {
    id: 11,
    title: "Default Title",
    sku: "AURORA-DEFAULT",
    inventory_management: "shopify",
    inventory_policy: "deny",
    inventory_quantity: 4,
    ...overrides,
  };
}

function product(overrides = {}) {
  return {
    id: 101,
    title: "Aurora Headset",
    handle: "aurora-headset",
    status: "active",
    variants: [variant()],
    ...overrides,
  };
}

describe("greenfield product availability", () => {
  it("A: maps an exact tracked variant to AVAILABLE", async () => {
    expect(shopifyAvailabilityState(variant({ availableForSale: true, inventory_quantity: 2 }))).toBe("AVAILABLE");
    const provider = providerFor([product({ variants: [variant({ title: "White", inventory_quantity: 2 })] })]);
    await expect(provider.getProductAvailability("Aurora Headset White")).resolves.toMatchObject({
      status: "ok",
      selection: "exact_variant",
      products: [{ variants: [{ title: "White", availability_state: "AVAILABLE" }] }],
    });
  });

  it("B: maps an exact tracked variant with DENY inventory to OUT_OF_STOCK", async () => {
    expect(shopifyAvailabilityState(variant({ inventory_quantity: 0, inventory_policy: "deny" }))).toBe("OUT_OF_STOCK");
    const provider = providerFor([product({ variants: [variant({ title: "White", inventory_quantity: 0 })] })]);
    await expect(provider.getProductAvailability("Aurora Headset White")).resolves.toMatchObject({
      status: "ok",
      selection: "exact_variant",
      products: [{ variants: [{ title: "White", availability_state: "OUT_OF_STOCK" }] }],
    });
  });

  it("C: maps depleted inventory with CONTINUE to AVAILABLE_TO_ORDER", () => {
    expect(shopifyAvailabilityState(variant({ inventory_quantity: 0, inventory_policy: "continue" }))).toBe("AVAILABLE_TO_ORDER");
  });

  it("D: maps an explicitly untracked variant to NOT_TRACKED", () => {
    expect(shopifyAvailabilityState(variant({ inventory_management: null, inventory_quantity: 8 }))).toBe("NOT_TRACKED");
    expect(shopifyAvailabilityState({ tracked: false, inventory_quantity: 8, inventory_policy: "deny" })).toBe("NOT_TRACKED");
  });

  it("E: maps missing relevant signals to UNKNOWN", () => {
    expect(shopifyAvailabilityState({})).toBe("UNKNOWN");
    expect(shopifyAvailabilityState({ inventory_management: "shopify", inventory_policy: "deny" })).toBe("UNKNOWN");
  });

  it("F: keeps product identity separate from unknown availability", async () => {
    const provider = providerFor([product({ variants: [variant({ inventory_quantity: null })] })]);
    const result = await provider.getProductAvailability("Aurora Headset");
    expect(result).toMatchObject({ status: "ok", products: [{ title: "Aurora Headset", variants: [{ availability_state: "UNKNOWN" }] }] });
  });

  it("G: preserves different states for different variants", async () => {
    const provider = providerFor([product({ variants: [
      variant({ id: 11, title: "Black", inventory_quantity: 4 }),
      variant({ id: 12, title: "White", inventory_quantity: 0 }),
    ] })]);
    const result = await provider.getProductAvailability("Aurora Headset");
    expect(result).toMatchObject({ status: "ambiguous", products: [{ variants: [
      { title: "Black", availability_state: "AVAILABLE" },
      { title: "White", availability_state: "OUT_OF_STOCK" },
    ] }] });
  });

  it("H: does not silently select a variant", async () => {
    const provider = providerFor([product({ variants: [variant({ title: "Black" }), variant({ id: 12, title: "White" })] })]);
    const result = await provider.getProductAvailability("Aurora Headset");
    expect(result.status).toBe("ambiguous");
    expect(result.selection).toBe("ambiguous");

    const registry = createCapabilityRegistry({ tenant, knowledge: emptyKnowledge, commerce: provider });
    const toolResult = await registry.execute("get_product_availability", JSON.stringify({ query: "Aurora Headset" }));
    expect(toolResult.status).toBe("invalid_request");
  });

  it("H2: rejects a variant reference belonging to another product", async () => {
    const provider = providerFor([product({ variants: [variant({ title: "Black", sku: "AURORA-BLACK" })] })]);
    await expect(provider.getProductAvailability("Aurora Headset White")).resolves.toMatchObject({ status: "not_found", products: [] });
  });

  it("I: returns a safe not-found result for an unknown product", async () => {
    const provider = providerFor([]);
    await expect(provider.getProductAvailability("No Such Product")).resolves.toMatchObject({ status: "not_found", products: [] });
  });

  it("J: keeps shop and credential scope out of the model-facing schema", () => {
    expect(parseToolArguments("get_product_availability", JSON.stringify({ query: "Aurora", shop_id: "other-shop" }))).toMatchObject({ ok: false, result: { status: "invalid_arguments" } });
    expect(parseToolArguments("get_product_availability", JSON.stringify({ query: "Aurora", access_token: "secret" }))).toMatchObject({ ok: false, result: { status: "invalid_arguments" } });
    const definition = GREENFIELD_TOOL_DEFINITIONS.find((entry) => entry.name === "get_product_availability");
    expect(definition.parameters.required).toEqual(["query"]);
    expect(definition.parameters.properties).not.toHaveProperty("shop_id");
  });

  it("K: uses GET-only Shopify requests and exposes no write method", async () => {
    const calls = [];
    const provider = providerFor([product()], calls);
    await provider.getProductAvailability("Aurora Headset");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(({ init }) => init.method === "GET")).toBe(true);
    expect(provider).not.toHaveProperty("updateProduct");
    expect(provider).not.toHaveProperty("setInventory");
  });

  it("L: binds availability facts to the normalized returned state", () => {
    const data = {
      status: "ok",
      products: [{ title: "Aurora Headset", variants: [{ title: "Black", availability_state: "AVAILABLE" }] }],
    };
    const context = {
      manifest: { readTools: ["get_product_availability"], proposalOnlyTools: [], configured: { knowledge: true, commerce: true, tracking: false } },
      definitions: GREENFIELD_TOOL_DEFINITIONS,
      getResult: () => ({ resultId: "availability-1", toolName: "get_product_availability", result: { status: "ok", data } }),
    };
    const valid = validateStructuredResponse(JSON.stringify({ segments: [{ type: "fact", fact_kind: "product_availability", evidence: [{ result_id: "availability-1", field_paths: ["products[0].variants[0].availability_state"] }] }] }), context);
    expect(valid.allValid).toBe(true);

    const fabricatedPath = validateStructuredResponse(JSON.stringify({ segments: [{ type: "fact", fact_kind: "product_availability", evidence: [{ result_id: "availability-1", field_paths: ["products[0].variants[0].title"] }] }] }), context);
    expect(fabricatedPath.allValid).toBe(false);

    const fabricatedState = validateStructuredResponse(JSON.stringify({ segments: [{ type: "fact", fact_kind: "product_availability", evidence: [{ result_id: "availability-1", field_paths: ["products[0].variants[0].availability_state"] }] }] }), {
      ...context,
      getResult: () => ({ resultId: "availability-1", toolName: "get_product_availability", result: { status: "ok", data: { ...data, products: [{ ...data.products[0], variants: [{ ...data.products[0].variants[0], availability_state: "IN_STOCK" }] }] } } }),
    });
    expect(fabricatedState.allValid).toBe(false);
  });

  it("M: preserves exact product and variant arguments through the capability boundary", async () => {
    const calls = [];
    const provider = providerFor([product({ variants: [variant({ title: "White / L", inventory_quantity: 0 })] })], calls);
    const registry = createCapabilityRegistry({
      tenant: { ...tenant, shopId: "shop-a" },
      knowledge: emptyKnowledge,
      commerce: provider,
      conversationContext: { turn: 1, customerProvided: { product: "Aurora Headset", variant: "White / L" } },
    });

    const result = await registry.execute("get_product_availability", JSON.stringify({ query: "Aurora Headset White / L" }));
    const productRequest = calls.find(({ url }) => new URL(url).pathname.endsWith("/products.json"));
    expect(new URL(productRequest.url).searchParams.get("title")).toBe("Aurora Headset White / L");
    expect(result).toMatchObject({ status: "ok", data: { query: "Aurora Headset White / L", products: [{ variants: [{ title: "White / L", availability_state: "OUT_OF_STOCK" }] }] } });
  });

  it("N: preserves an UNKNOWN state instead of converting it to OUT_OF_STOCK", async () => {
    const provider = providerFor([product({ variants: [variant({ title: "White", inventory_quantity: null })] })]);
    const result = await provider.getProductAvailability("Aurora Headset White");
    expect(result).toMatchObject({ status: "ok", products: [{ variants: [{ title: "White", availability_state: "UNKNOWN" }] }] });
    expect(result.products[0].variants[0].availability_state).not.toBe("OUT_OF_STOCK");
  });

  it("O: does not accept a product result from a provider bound to another store scope", async () => {
    const scopeMismatchProvider = {
      providerName: "shopify_read_only",
      async getOrder() { return null; },
      async getOrderHistory() { return []; },
      async getCustomer() { return null; },
      async getProduct() { return { status: "not_found" }; },
      async getProductAvailability() { return { status: "not_found", products: [], reason: "store_scope_mismatch" }; },
      async inspectFulfillment() { return { status: "not_found" }; },
    };
    const registry = createCapabilityRegistry({
      tenant: { ...tenant, workspaceId: "workspace-b", shopId: "shop-b" },
      knowledge: emptyKnowledge,
      commerce: scopeMismatchProvider,
    });
    await expect(registry.execute("get_product_availability", JSON.stringify({ query: "Aurora Headset White" }))).resolves.toMatchObject({ status: "not_found", data: { products: [] } });
  });
});
