// Shopify Markets presentment-price fetcher. Admin REST returns only the base
// currency; the shop's per-market (e.g. DKK) prices live behind GraphQL. We
// read the FIRST variant's presentment prices as the product's price map.

/** Extract { currencyCode: amount } from a Shopify GraphQL product response. */
export function parsePresentmentPrices(graphqlJson: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const product = (graphqlJson as any)?.data?.product;
  const firstVariant = product?.variants?.edges?.[0]?.node;
  const edges = firstVariant?.presentmentPrices?.edges;
  if (!Array.isArray(edges)) return out;
  for (const edge of edges) {
    const price = edge?.node?.price;
    const code = String(price?.currencyCode ?? "").trim().toUpperCase();
    const amount = String(price?.amount ?? "").trim();
    if (code && amount) out[code] = amount;
  }
  return out;
}

export async function fetchPresentmentPrices(args: {
  domain: string;
  accessToken: string;
  productId: string;
  apiVersion: string;
}): Promise<Record<string, string>> {
  const { domain, accessToken, productId, apiVersion } = args;
  const numericId = String(productId).replace(/\D/g, "");
  if (!numericId) return {};
  const query = `query {
    product(id: "gid://shopify/Product/${numericId}") {
      variants(first: 1) {
        edges { node { presentmentPrices(first: 20) {
          edges { node { price { amount currencyCode } } }
        } } }
      }
    }
  }`;
  try {
    const res = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return {};
    const json = await res.json().catch(() => null);
    return parsePresentmentPrices(json);
  } catch {
    return {};
  }
}

export async function fetchPrimaryMarketCurrency(args: {
  domain: string;
  accessToken: string;
  apiVersion: string;
}): Promise<string | null> {
  const { domain, accessToken, apiVersion } = args;
  const query = `query { markets(first: 20) { edges { node {
    primary
    currencySettings { baseCurrency { currencyCode } }
  } } } }`;
  try {
    const res = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const edges = (json as any)?.data?.markets?.edges ?? [];
    const primary = edges.find((e: any) => e?.node?.primary)?.node
      ?? edges[0]?.node;
    const code = primary?.currencySettings?.baseCurrency?.currencyCode;
    return code ? String(code).trim().toUpperCase() : null;
  } catch {
    return null;
  }
}
