const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

function extractNextPageInfo(linkHeader = "") {
  for (const part of String(linkHeader).split(",")) {
    if (!part.includes('rel="next"')) continue;
    const match = part.match(/<([^>]+)>/);
    if (!match?.[1]) continue;
    try {
      return new URL(match[1]).searchParams.get("page_info");
    } catch {
      // Ignore malformed pagination links and keep the successfully fetched page.
    }
  }
  return null;
}

/**
 * Fetch the same active Shopify product pages as the legacy importer. This is
 * deliberately read-only; persistence and embeddings stay with the caller.
 */
export async function fetchShopifyProducts({ domain, accessToken }) {
  const products = [];
  let pageInfo = null;
  const limit = 50;
  const cleanDomain = String(domain || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!cleanDomain || !accessToken) throw new Error("Shopify product fetch requires a domain and access token.");

  for (let page = 0; page < 5; page += 1) {
    const url = new URL(`https://${cleanDomain}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
    url.searchParams.set("status", "active");
    url.searchParams.set("limit", String(limit));
    if (pageInfo) url.searchParams.set("page_info", pageInfo);
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Shopify products returned ${response.status}`);
    }
    const payload = await response.json().catch(() => null);
    const pageProducts = Array.isArray(payload?.products) ? payload.products : [];
    products.push(...pageProducts);
    pageInfo = extractNextPageInfo(response.headers.get("link") || "");
    if (!pageInfo) break;
  }
  return products;
}

export { SHOPIFY_API_VERSION, extractNextPageInfo };
