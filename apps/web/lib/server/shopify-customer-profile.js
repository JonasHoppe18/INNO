// Lifetime Shopify profile for one customer email: totals, customer-since and
// the latest orders. Independent of which orders a ticket lookup happened to
// fetch, so the profile never mixes "this order" numbers with lifetime ones.
const PROFILE_QUERY = `query CustomerProfile($query: String!) {
  customers(first: 5, query: $query) {
    nodes {
      legacyResourceId
      displayName
      createdAt
      numberOfOrders
      amountSpent { amount currencyCode }
      defaultEmailAddress { emailAddress }
      defaultAddress { city country }
      orders(first: 5, sortKey: CREATED_AT, reverse: true) {
        nodes {
          legacyResourceId
          name
          createdAt
          displayFulfillmentStatus
          displayFinancialStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
}`;

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const parseCount = (value) => {
  if (!/^\d+$/.test(String(value ?? ""))) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : null;
};

const parseMoney = (money) => {
  const amount = Number(money?.amount);
  if (!money || !Number.isFinite(amount)) return null;
  return { amount, currency: money.currencyCode || null };
};

const mapOrder = (order) => ({
  id: String(order?.name || "").replace(/^#/, "") || String(order?.legacyResourceId || ""),
  adminId: order?.legacyResourceId ? String(order.legacyResourceId) : null,
  placedAt: order?.createdAt || null,
  fulfillmentStatus: String(order?.displayFulfillmentStatus || "").toLowerCase() || null,
  financialStatus: String(order?.displayFinancialStatus || "").toLowerCase() || null,
  total: order?.currentTotalPriceSet?.shopMoney?.amount ?? null,
  currency: order?.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
});

export async function fetchShopifyCustomerProfile(credentials, email, fetchImpl = fetch) {
  const target = normalizeEmail(email);
  if (!target) return null;
  const domain = String(credentials?.shop_domain || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const response = await fetchImpl(
    `https://${domain}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-07"}/graphql.json`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": credentials.access_token,
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        query: PROFILE_QUERY,
        variables: { query: `email:"${target.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` },
      }),
    },
  );
  if (!response.ok) throw new Error("Shopify customer profile lookup failed");
  const payload = await response.json();
  if (payload?.errors?.length) throw new Error("Shopify customer profile lookup failed");

  const nodes = Array.isArray(payload?.data?.customers?.nodes) ? payload.data.customers.nodes : [];
  // Shopify's email search is fuzzy; only a single exact match is this customer.
  const matches = nodes.filter(
    (node) => normalizeEmail(node?.defaultEmailAddress?.emailAddress) === target,
  );
  if (matches.length !== 1) return null;
  const customer = matches[0];

  return {
    shopifyId: customer.legacyResourceId ? String(customer.legacyResourceId) : null,
    name: String(customer.displayName || "").trim() || null,
    createdAt: customer.createdAt || null,
    lifetimeOrders: parseCount(customer.numberOfOrders),
    amountSpent: parseMoney(customer.amountSpent),
    city: customer.defaultAddress?.city || null,
    country: customer.defaultAddress?.country || null,
    recentOrders: (customer.orders?.nodes || []).map(mapOrder),
  };
}
