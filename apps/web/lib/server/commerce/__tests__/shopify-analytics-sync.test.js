import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchShopifyAnalyticsOrders, fetchShopifyAnalyticsReturns } from "../shopify-analytics-sync.js";

describe("fetchShopifyAnalyticsOrders", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merges created and updated windows without duplicating orders", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({ orders: [{ id: 101, created_at: "2026-07-20T10:00:00Z" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => ({
          orders: [
            { id: 101, created_at: "2026-07-20T10:00:00Z" },
            { id: 202, created_at: "2026-07-01T10:00:00Z" },
          ],
        }),
      });

    const orders = await fetchShopifyAnalyticsOrders({
      domain: "example.myshopify.com",
      accessToken: "token",
      apiVersion: "2024-07",
      since: "2026-07-01T00:00:00.000Z",
      until: "2026-08-01T00:00:00.000Z",
    });

    expect(orders.map((order) => String(order.id))).toEqual(["101", "202"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("created_at_min");
    expect(String(fetchMock.mock.calls[1][0])).toContain("updated_at_min");
  });
});

describe("fetchShopifyAnalyticsReturns", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deduplicates returns found through created and updated order windows", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { orders: {
          edges: [{ node: { id: "gid://shopify/Order/42", returns: { edges: [{ node: {
            id: "gid://shopify/Return/9", createdAt: "2026-07-20T10:00:00Z", status: "OPEN",
            returnLineItems: { edges: [] },
          } }] } } }],
          pageInfo: { hasNextPage: false, endCursor: null },
        } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { orders: {
          edges: [{ node: { id: "gid://shopify/Order/42", returns: { edges: [{ node: {
            id: "gid://shopify/Return/9", createdAt: "2026-07-20T10:00:00Z", status: "CLOSED",
            returnLineItems: { edges: [] },
          } }] } } }],
          pageInfo: { hasNextPage: false, endCursor: null },
        } } }),
      });

    const result = await fetchShopifyAnalyticsReturns({
      domain: "example.myshopify.com",
      accessToken: "token",
      apiVersion: "2024-07",
      since: "2026-07-01T00:00:00.000Z",
      until: "2026-08-01T00:00:00.000Z",
    });

    expect(result.available).toBe(true);
    expect(result.returns).toHaveLength(1);
    expect(result.returns[0].orderId).toBe("42");
    expect(result.returns[0].status).toBe("CLOSED");
  });

  it("treats a missing read_returns scope as an unavailable optional source", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ message: "Access denied for read_returns" }] }),
    });

    const result = await fetchShopifyAnalyticsReturns({
      domain: "example.myshopify.com",
      accessToken: "token",
      since: "2026-07-01T00:00:00.000Z",
      until: "2026-08-01T00:00:00.000Z",
    });

    expect(result).toEqual({
      returns: [],
      available: false,
      error: "Shopify read_returns access is not granted.",
    });
  });
});
