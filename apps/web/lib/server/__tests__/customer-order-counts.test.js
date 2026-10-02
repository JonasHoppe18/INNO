import { describe, expect, it, vi } from "vitest";
import { fetchCustomerOrderCounts } from "../customer-order-counts";
const credentials = { shop_domain: "demo.myshopify.com", access_token: "test" };
const customers = [{ id: "one", email: "ada@example.com" }];
const node = (email, count) => ({
  defaultEmailAddress: { emailAddress: email },
  numberOfOrders: count,
});
function fetchResponse(nodes, extra = {}) {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: { c0: { nodes, pageInfo: { hasNextPage: false }, ...extra } },
      }),
    ),
  );
}
describe("Shopify lifetime order counts", () => {
  it("uses the lifetime count above the order history page limit and ignores approximate matches", async () => {
    const fetchImpl = fetchResponse([
      node("other@example.com", "999"),
      node("ADA@example.com", "125"),
    ]);
    expect(
      await fetchCustomerOrderCounts(credentials, customers, fetchImpl),
    ).toEqual({ one: { status: "checked", count: 125 } });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.variables.q0).toBe('email:"ada@example.com"');
    expect(body.query).toContain("numberOfOrders");
  });
  it("returns zero only for a successful lookup without an exact match", async () => {
    expect(
      await fetchCustomerOrderCounts(
        credentials,
        customers,
        fetchResponse([node("other@example.com", "3")]),
      ),
    ).toEqual({ one: { status: "checked", count: 0 } });
  });
  it.each([null, "", " ", "1e2", "bad", "-1", "9007199254740992"])(
    "does not turn an invalid count into zero: %s",
    async (count) => {
      expect(
        await fetchCustomerOrderCounts(
          credentials,
          customers,
          fetchResponse([node("ada@example.com", count)]),
        ),
      ).toEqual({ one: { status: "error" } });
    },
  );
  it("does not report zero for an incomplete customer search", async () => {
    expect(
      await fetchCustomerOrderCounts(
        credentials,
        customers,
        fetchResponse([], { pageInfo: { hasNextPage: true } }),
      ),
    ).toEqual({ one: { status: "error" } });
  });
  it("does not report zero when Shopify denies customer access", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ errors: [{ message: "Access denied" }] }),
        ),
      );
    await expect(
      fetchCustomerOrderCounts(credentials, customers, fetchImpl),
    ).rejects.toThrow("lookup failed");
  });
});
