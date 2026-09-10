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
});
