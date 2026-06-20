// Platform-neutral product normalization for Sona's product data foundation.
//
// Architecture: commerce platform → provider adapter → normalized Sona product
// fields → runtime facts → draft generation.
//
// This module owns the SHAPE of a normalized product (`NormalizedProduct`) and
// the mapping of a `shop_products` row. Platform-specific parsing lives in
// dedicated `map<Platform>ProductToNormalizedProduct` functions so that adding
// WooCommerce / Magento / a custom webshop later only adds a new mapper — the
// normalized fields, the DB row shape and all runtime logic stay unchanged.
//
// Pure + dependency-free on purpose: importable from both the Next.js sync
// route and Deno test runner, and trivially unit-testable.

/** Shopify's "out of stock / not for sale" price sentinel. */
const PLACEHOLDER_PRICE_THRESHOLD = 99999;

/** Tags that explicitly hide a product's price from customers. */
const HIDE_PRICE_TAGS = new Set(["hide-price", "hidden-price"]);

/**
 * Tokens marking a product as an accessory / non-primary product that should
 * not surface in "which product should I choose" recommendations. Platform-
 * neutral, matched against title + product type + tags.
 */
const NON_RECOMMENDABLE_PATTERN =
  /\b(ear ?pads?|earpads?|spare|replacement part|cables?|adapters?|accessor\w*|stickers?|mousepads?|merch|gift ?cards?)/i;

export interface NormalizedProduct {
  external_id: string;
  platform: string;
  title: string;
  description: string;
  handle: string | null;
  product_url: string | null;
  status: string | null;
  available: boolean;
  price_amount: number | null;
  currency: string | null;
  min_price: number | null;
  max_price: number | null;
  is_placeholder_price: boolean;
  recommendable: boolean;
  product_updated_at: string | null;
  /**
   * The platform's original primary-variant price string, preserved verbatim
   * for the legacy `price` text column (e.g. "1199.00"). The typed numeric
   * value lives in `price_amount`.
   */
  price_display: string | null;
  raw: unknown;
}

export interface ShopProductRow {
  shop_ref_id: string;
  external_id: string;
  platform: string;
  title: string;
  description: string;
  price: string | null;
  handle: string | null;
  product_url: string | null;
  status: string | null;
  available: boolean;
  price_amount: number | null;
  currency: string | null;
  min_price: number | null;
  max_price: number | null;
  is_placeholder_price: boolean;
  recommendable: boolean;
  product_updated_at: string | null;
  synced_at: string;
  last_seen_at: string;
  raw: unknown;
}

function stripHtml(value: string = ""): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function toAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t).trim()).filter(Boolean);
  }
  return String(tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** A price amount is a placeholder when it is the sentinel value or zero. */
export function isPlaceholderPriceAmount(
  amount: number | null | undefined,
): boolean {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return false;
  }
  return amount >= PLACEHOLDER_PRICE_THRESHOLD || amount === 0;
}

/**
 * A product's price is a placeholder when the amount is a sentinel/zero OR a
 * tag explicitly hides the price. Platform-neutral.
 */
export function detectPlaceholderPrice(input: {
  amount: number | null | undefined;
  tags?: string[] | string | null;
}): boolean {
  if (isPlaceholderPriceAmount(input.amount)) return true;
  for (const tag of normalizeTags(input.tags)) {
    if (HIDE_PRICE_TAGS.has(tag.toLowerCase())) return true;
  }
  return false;
}

/**
 * A product is recommendable unless it has a placeholder price, is unavailable,
 * or is an accessory / non-primary product. Platform-neutral heuristic.
 */
export function computeRecommendable(input: {
  isPlaceholderPrice: boolean;
  available: boolean;
  productType?: string | null;
  tags?: string[] | string | null;
  title?: string | null;
}): boolean {
  if (input.isPlaceholderPrice) return false;
  if (!input.available) return false;
  const haystack = [
    String(input.title ?? ""),
    String(input.productType ?? ""),
    normalizeTags(input.tags).join(" "),
  ].join(" ");
  if (NON_RECOMMENDABLE_PATTERN.test(haystack)) return false;
  return true;
}

function normalizeDomain(domain: string | null | undefined): string | null {
  let d = String(domain ?? "").trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "").replace(/\/+$/, "").trim();
  return d || null;
}

function isMyshopifyDomain(domain: string): boolean {
  return /(^|\.)myshopify\.com$/i.test(domain);
}

function normalizeHandle(handle: string | null | undefined): string | null {
  const h = String(handle ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return h || null;
}

/**
 * Build a trusted, customer-facing product-page URL from a trusted public
 * storefront domain + a trusted product handle. Returns null (never invents a
 * link) when the domain is missing/untrusted (myshopify) or the handle is
 * missing.
 */
export function buildTrustedProductUrl(
  publicStorefrontDomain: string | null | undefined,
  handle: string | null | undefined,
): string | null {
  const domain = normalizeDomain(publicStorefrontDomain);
  const h = normalizeHandle(handle);
  if (!domain || !h) return null;
  if (isMyshopifyDomain(domain)) return null;
  return `https://${domain}/products/${h}`;
}

/**
 * Shopify-specific mapping. ALL Shopify payload knowledge stays inside this
 * function; the returned `NormalizedProduct` is platform-neutral.
 */
export function mapShopifyProductToNormalizedProduct(
  raw: Record<string, unknown>,
  opts: {
    publicStorefrontDomain?: string | null;
    currency?: string | null;
  } = {},
): NormalizedProduct {
  const externalId = String((raw as { id?: unknown })?.id ?? "").trim();
  const title = String((raw as { title?: unknown })?.title ?? "Untitled product")
    .trim();
  const descriptionRaw = (raw as Record<string, unknown>)?.body_html ??
    (raw as Record<string, unknown>)?.body ??
    (raw as Record<string, unknown>)?.description ??
    (raw as Record<string, unknown>)?.body_text ?? "";
  const description = stripHtml(String(descriptionRaw ?? ""));
  const handle = normalizeHandle((raw as { handle?: unknown })?.handle as string);
  const status = ((raw as { status?: unknown })?.status
    ? String((raw as { status?: unknown }).status).trim()
    : null) as string | null;
  const publishedAt = (raw as { published_at?: unknown })?.published_at ?? null;
  const available = status === "active" && Boolean(publishedAt);
  const tags = normalizeTags((raw as { tags?: unknown })?.tags);

  const variants = Array.isArray((raw as { variants?: unknown })?.variants)
    ? (raw as { variants: Array<Record<string, unknown>> }).variants
    : [];
  const amounts = variants
    .map((v) => toAmount(v?.price ?? v?.compare_at_price))
    .filter((n): n is number => n !== null);
  const priceAmount = amounts.length ? amounts[0] : null;
  const minPrice = amounts.length ? Math.min(...amounts) : null;
  const maxPrice = amounts.length ? Math.max(...amounts) : null;
  const firstVariant = variants[0];
  const priceDisplayRaw = firstVariant?.price ?? firstVariant?.compare_at_price;
  const priceDisplay = priceDisplayRaw === null || priceDisplayRaw === undefined ||
      priceDisplayRaw === ""
    ? null
    : String(priceDisplayRaw);

  const isPlaceholderPrice = detectPlaceholderPrice({
    amount: priceAmount,
    tags,
  });
  const recommendable = computeRecommendable({
    isPlaceholderPrice,
    available,
    productType: (raw as { product_type?: unknown })?.product_type as string,
    tags,
    title,
  });

  return {
    external_id: externalId,
    platform: "shopify",
    title,
    description,
    handle,
    product_url: buildTrustedProductUrl(opts.publicStorefrontDomain, handle),
    status,
    available,
    price_amount: priceAmount,
    currency: opts.currency ?? null,
    min_price: minPrice,
    max_price: maxPrice,
    is_placeholder_price: isPlaceholderPrice,
    recommendable,
    product_updated_at: (raw as { updated_at?: unknown })?.updated_at
      ? String((raw as { updated_at?: unknown }).updated_at)
      : null,
    price_display: priceDisplay,
    raw,
  };
}

/**
 * Maps a normalized product onto a `shop_products` row. Tenant scoping uses
 * `shop_ref_id` (→ shops.id) — never the legacy, vestigial `shop_id`
 * (NULL / auth.users FK). Keeps the legacy `price` text column populated for
 * backward compatibility while exposing the typed `price_amount`.
 */
export function toShopProductRow(
  product: NormalizedProduct,
  opts: { shopRefId: string; syncedAt: string; lastSeenAt?: string },
): ShopProductRow {
  return {
    shop_ref_id: opts.shopRefId,
    external_id: product.external_id,
    platform: product.platform,
    title: product.title,
    description: product.description,
    price: product.price_display ??
      (product.price_amount !== null ? String(product.price_amount) : null),
    handle: product.handle,
    product_url: product.product_url,
    status: product.status,
    available: product.available,
    price_amount: product.price_amount,
    currency: product.currency,
    min_price: product.min_price,
    max_price: product.max_price,
    is_placeholder_price: product.is_placeholder_price,
    recommendable: product.recommendable,
    product_updated_at: product.product_updated_at,
    synced_at: opts.syncedAt,
    last_seen_at: opts.lastSeenAt ?? opts.syncedAt,
    raw: product.raw,
  };
}
