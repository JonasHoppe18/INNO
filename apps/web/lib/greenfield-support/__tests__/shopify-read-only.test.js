import { describe, expect, it } from "vitest";
import { ShopifyReadOnlyProvider } from "../shopify-read-only";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

describe("Shopify read-only provider", () => {
  it("uses a customer-scoped GET lookup for an order number", async () => {
    const calls = [];
    const provider = new ShopifyReadOnlyProvider({
      shopDomain: "demo.myshopify.com",
      accessToken: "server-token",
      customer: { email: "Customer@Example.test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ orders: [{ id: 501, order_number: 10231, email: "customer@example.test", fulfillment_status: "fulfilled", line_items: [], fulfillments: [] }] });
      },
    });

    const order = await provider.getOrder("#10231");
    const requestUrl = new URL(calls[0].url);
    expect(order.orderNumber).toBe("10231");
    expect(requestUrl.pathname).toContain("/orders.json");
    expect(requestUrl.searchParams.get("name")).toBe("#10231");
    expect(requestUrl.searchParams.get("email")).toBe("customer@example.test");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers["X-Shopify-Access-Token"]).toBe("server-token");
  });

  it("does not return a numeric-ID order belonging to another customer", async () => {
    const calls = [];
    const provider = new ShopifyReadOnlyProvider({
      shopDomain: "demo.myshopify.com",
      accessToken: "server-token",
      customer: { email: "customer@example.test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (String(url).includes("orders.json")) return jsonResponse({ orders: [] });
        return jsonResponse({ order: { id: 501, order_number: 10231, email: "other@example.test" } });
      },
    });

    expect(await provider.getOrder("501")).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.init.method === "GET")).toBe(true);
  });

  it("does not call Shopify without verified customer context", async () => {
    let callCount = 0;
    const provider = new ShopifyReadOnlyProvider({
      shopDomain: "demo.myshopify.com",
      accessToken: "server-token",
      fetchImpl: async () => {
        callCount += 1;
        return jsonResponse({ orders: [] });
      },
    });

    expect(await provider.getOrder("10231")).toBeNull();
    expect(callCount).toBe(0);
  });

  it("resolves a customer display name only from an exact verified email match", async () => {
    const calls = [];
    const provider = new ShopifyReadOnlyProvider({
      shopDomain: "demo.myshopify.com",
      accessToken: "server-token",
      customer: { email: "Customer@Example.test", name: null },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ customers: [
          { email: "other@example.test", first_name: "Other", last_name: "Customer" },
          { email: "customer@example.test", first_name: "Jonas", last_name: "Hoppe" },
        ] });
      },
    });

    await expect(provider.getCustomer()).resolves.toEqual({ email: "customer@example.test", name: "Jonas Hoppe" });
    expect(new URL(calls[0].url).pathname).toContain("/customers/search.json");
    expect(new URL(calls[0].url).searchParams.get("query")).toBe("email:customer@example.test");
    expect(calls[0].init.method).toBe("GET");
  });

  it("does not use a different customer's name when the exact email is absent", async () => {
    const provider = new ShopifyReadOnlyProvider({
      shopDomain: "demo.myshopify.com",
      accessToken: "server-token",
      customer: { email: "customer@example.test", name: null },
      fetchImpl: async () => jsonResponse({ customers: [{ email: "other@example.test", name: "Other Customer" }] }),
    });

    await expect(provider.getCustomer()).resolves.toEqual({ email: "customer@example.test", name: null });
  });
});
