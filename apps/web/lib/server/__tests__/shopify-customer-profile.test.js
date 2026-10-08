import { describe, expect, it, vi } from "vitest";
import { fetchShopifyCustomerProfile } from "../shopify-customer-profile";

const credentials = { shop_domain: "https://demo.myshopify.com/", access_token: "test" };

const customerNode = (email, overrides = {}) => ({
  legacyResourceId: "7001",
  displayName: "Mikkel Holm",
  createdAt: "2025-03-14T10:00:00Z",
  numberOfOrders: "2",
  amountSpent: { amount: "1096.00", currencyCode: "DKK" },
  defaultEmailAddress: { emailAddress: email },
  defaultAddress: { city: "København N", country: "Denmark" },
  orders: {
    nodes: [
      {
        legacyResourceId: "5001",
        name: "#1065",
        createdAt: "2026-10-06T07:34:00Z",
        displayFulfillmentStatus: "FULFILLED",
        displayFinancialStatus: "PAID",
        currentTotalPriceSet: { shopMoney: { amount: "548.00", currencyCode: "DKK" } },
      },
    ],
  },
  ...overrides,
});

function respondWith(nodes) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: { customers: { nodes } } })),
  );
}

describe("fetchShopifyCustomerProfile", () => {
  it("maps the exact email match to a lifetime profile with recent orders", async () => {
    const fetchImpl = respondWith([
      customerNode("someone@else.com", { legacyResourceId: "1" }),
      customerNode("Mikkel@Example.com"),
    ]);
    const profile = await fetchShopifyCustomerProfile(credentials, "mikkel@example.com", fetchImpl);
    expect(profile).toEqual({
      shopifyId: "7001",
      name: "Mikkel Holm",
      createdAt: "2025-03-14T10:00:00Z",
      lifetimeOrders: 2,
      amountSpent: { amount: 1096, currency: "DKK" },
      city: "København N",
      country: "Denmark",
      recentOrders: [
        {
          id: "1065",
          adminId: "5001",
          placedAt: "2026-10-06T07:34:00Z",
          fulfillmentStatus: "fulfilled",
          financialStatus: "paid",
          total: "548.00",
          currency: "DKK",
        },
      ],
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/^https:\/\/demo\.myshopify\.com\/admin\/api\/[^/]+\/graphql\.json$/);
    expect(JSON.parse(init.body).variables.query).toBe('email:"mikkel@example.com"');
  });

  it("returns null without an exact match or with an ambiguous one", async () => {
    expect(
      await fetchShopifyCustomerProfile(credentials, "a@b.dk", respondWith([customerNode("x@b.dk")])),
    ).toBeNull();
    expect(
      await fetchShopifyCustomerProfile(
        credentials,
        "a@b.dk",
        respondWith([customerNode("a@b.dk"), customerNode("A@b.dk", { legacyResourceId: "2" })]),
      ),
    ).toBeNull();
  });

  it("drops an unparseable lifetime count instead of guessing", async () => {
    const profile = await fetchShopifyCustomerProfile(
      credentials,
      "a@b.dk",
      respondWith([customerNode("a@b.dk", { numberOfOrders: "bad", amountSpent: null })]),
    );
    expect(profile.lifetimeOrders).toBeNull();
    expect(profile.amountSpent).toBeNull();
  });

  it("throws on GraphQL errors so callers can omit the profile", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: "Access denied" }] })));
    await expect(fetchShopifyCustomerProfile(credentials, "a@b.dk", fetchImpl)).rejects.toThrow();
  });
});
