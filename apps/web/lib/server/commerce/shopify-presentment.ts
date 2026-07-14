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

export async function fetchShopCurrency(args: {
  domain: string;
  accessToken: string;
  apiVersion: string;
}): Promise<string | null> {
  const { domain, accessToken, apiVersion } = args;
  try {
    const res = await fetch(
      `https://${domain}/admin/api/${apiVersion}/shop.json?fields=currency`,
      { headers: { Accept: "application/json", "X-Shopify-Access-Token": accessToken } },
    );
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const currency = (json as any)?.shop?.currency;
    return currency ? String(currency).trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the shop's primary-market currency from a combined
 * markets + shop GraphQL response. A market can return
 * `currencySettings: null` (observed on AceZone's primary "Germany" market
 * 2026-07-14) — Shopify implies the shop's base currency for such markets,
 * so we fall back to `shop.currencyCode` instead of returning null.
 */
export function parsePrimaryMarketCurrency(graphqlJson: unknown): string | null {
  const data = (graphqlJson as any)?.data;
  const edges = data?.markets?.edges ?? [];
  const primary = Array.isArray(edges)
    ? (edges.find((e: any) => e?.node?.primary)?.node ?? edges[0]?.node)
    : null;
  const marketCode = primary?.currencySettings?.baseCurrency?.currencyCode;
  if (marketCode) return String(marketCode).trim().toUpperCase();
  const shopCode = data?.shop?.currencyCode;
  return shopCode ? String(shopCode).trim().toUpperCase() : null;
}

export async function fetchPrimaryMarketCurrency(args: {
  domain: string;
  accessToken: string;
  apiVersion: string;
}): Promise<string | null> {
  const { domain, accessToken, apiVersion } = args;
  const query = `query {
    shop { currencyCode }
    markets(first: 20) { edges { node {
      primary
      currencySettings { baseCurrency { currencyCode } }
    } } }
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
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return parsePrimaryMarketCurrency(json);
  } catch {
    return null;
  }
}
