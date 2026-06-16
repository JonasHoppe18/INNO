// supabase/functions/generate-draft-v2/stages/purchase-link.ts
//
// Purchase-link / where-to-buy intent handling.
//
// A "send me the link to buy X" request is NOT a stock-availability question.
// Previously both were collapsed into isStockAvailabilityQuestion(), so a
// purchase-link request fell through to the "cannot confirm live availability"
// fallback. This module separates the two intents and grounds a trusted
// product-page URL (shop domain + Shopify product handle) so the writer can
// answer with a real link instead of stock uncertainty.
//
// Hard safety rules baked in here:
// - URLs are ONLY ever built from a trusted shop domain + a Shopify product
//   handle. Never from free text in the customer message.
// - We build the product PAGE url (/products/<handle>) only — never a
//   checkout/cart URL. Checkout links are never fabricated.
// - Wrong-product links are prevented: a grounded link is only returned when
//   the matched product title actually corresponds to the requested product.
import type { ResolvedFact } from "./fact-resolver.ts";

export const TRUSTED_PRODUCT_LINK_LABEL = "Trusted product page link";

// Generic category nouns (multi-language). A purchase request that mentions
// ONLY one of these — with no model-specific token — is ambiguous and must be
// clarified rather than guessed. Generic by design (not shop-specific).
const GENERIC_PRODUCT_WORDS = new Set([
  "headset",
  "headsettet",
  "headsets",
  "headphone",
  "headphones",
  "hovedtelefoner",
  "høretelefoner",
  "horetelefoner",
  "earbuds",
  "earphones",
  "mouse",
  "mus",
  "musen",
  "keyboard",
  "tastatur",
  "tastaturet",
  "cable",
  "kabel",
  "kablet",
  "dongle",
  "product",
  "produkt",
  "produktet",
  "vare",
  "varen",
  "item",
  "model",
  "version",
  "variant",
  "the",
  "a",
  "an",
  "den",
  "det",
  "en",
  "et",
]);

function lower(message: string | null | undefined): string {
  return String(message ?? "").toLowerCase();
}

export function normalizeProductText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// A token is "model-specific" (not a generic category word) when it carries a
// digit or hyphen (model/SKU-like, e.g. "A-Rise", "X200") — this generalizes
// across shops without hardcoding any product name.
function hasModelSpecificToken(message: string | null | undefined): boolean {
  const raw = String(message ?? "");
  // Hyphenated alphanumeric model tokens (A-Rise, A-Spire) or tokens with a digit.
  return /[a-z]+-[a-z0-9]+/i.test(raw) || /\b[a-z]*\d[a-z0-9]*\b/i.test(raw);
}

// Purchase-link / where-to-buy intent. Deliberately separate from
// isStockAvailabilityQuestion — "kan jeg købe" / "can I buy" are buy intents,
// not stock questions.
export function isPurchaseLinkRequest(message: string | null | undefined): boolean {
  const text = lower(message);
  if (!text) return false;
  const patterns: RegExp[] = [
    // where to buy
    /\bhvor\s+(?:kan\s+jeg\s+)?køb/i,
    /\bwhere\s+(?:can|do|could)\s+i\s+(?:buy|purchase|get|order)\b/i,
    /\bwhere\s+to\s+buy\b/i,
    // link + buy
    /\blink\b[^.?!]{0,40}\b(?:køb|buy|purchase|bestil)/i,
    /\b(?:køb|buy|purchase|bestil)[^.?!]{0,40}\blink\b/i,
    /\blink\s+til\s+at\b/i,
    /(?:produkt|product|køb|purchase|checkout|check-out|kurv|cart|betaling)s?-?link/i,
    // send the link
    /\bsend\w*\b[^.?!]{0,40}\blink\b/i,
    /\bcan\s+you\s+send\b[^.?!]{0,40}\blink\b/i,
    // want to buy
    /\bi\s+want\s+to\s+(?:buy|purchase|order)\b/i,
    /\bi'?d\s+like\s+to\s+(?:buy|purchase|order)\b/i,
    /\bjeg\s+vil\s+(?:gerne\s+)?(?:køb|bestil)/i,
    /\bkan\s+jeg\s+køb/i,
    /\bcan\s+i\s+(?:buy|purchase|order)\b/i,
  ];
  return patterns.some((p) => p.test(text));
}

// Thread mentions a direct checkout link (e.g. support previously offered to
// send one). We may acknowledge this, but must never fabricate the URL.
export function threadMentionsCheckoutLink(
  texts: Array<string | null | undefined> | string | null | undefined,
): boolean {
  const all = Array.isArray(texts) ? texts : [texts];
  const joined = all.map((t) => lower(t)).join("\n");
  return /\bcheck\s*-?\s*out\s*-?\s*link\b|\bcheckout\b[^.?!]{0,20}\blink\b|\bkurv-?link\b|\bcart\s+link\b|\bbetalingslink\b/i
    .test(joined);
}

// Prior support context offering a MANUAL checkout link / office-or-manual
// stock — distinct from threadMentionsCheckoutLink (which only matches the word
// "checkout link"). This also catches the "we have a few units at the office"
// style promise, which means online Shopify stock is irrelevant to the answer.
export function threadMentionsManualCheckoutContext(
  texts: Array<string | null | undefined> | string | null | undefined,
): boolean {
  const all = Array.isArray(texts) ? texts : [texts];
  const joined = all.map((t) => lower(t)).join("\n");
  return (
    // checkout / check-out link offers
    /\bcheck\s*-?\s*out[\s-]*link\b|\bcheckout[\s-]*link\b/i.test(joined) ||
    /\bsend\w*\s+(?:dig|jer|you)\b[^.?!]{0,30}\blink\b/i.test(joined) ||
    /\b(?:send|sende)\s+dig\s+et\s+link\b/i.test(joined) ||
    // office / manual / warehouse stock kept aside
    /\bet\s+par\s+stykker\b[^.?!]{0,40}\b(?:kontor|kontoret|lager|liggende)\b/i.test(joined) ||
    /\bliggende\b[^.?!]{0,20}\b(?:her\s+)?(?:på\s+)?kontor\w*/i.test(joined) ||
    /\boffice\s+stock\b|\bmanual\s+stock\b/i.test(joined) ||
    /\ba\s+few\s+(?:units?|pieces?)\b[^.?!]{0,30}\b(?:office|warehouse|in stock|here)\b/i.test(joined)
  );
}

// Manual checkout-link sales flow: the customer is accepting/requesting a
// purchase/checkout link AND support has already offered a manual checkout link
// or set aside office/manual stock. In this context the ordinary online
// stock-status answer is the WRONG headline — continue the promised manual
// checkout-link flow instead.
export function detectManualCheckoutLinkFlow(input: {
  latestCustomerMessage: string | null | undefined;
  conversationHistory?: Array<{ role?: string; text?: string | null }> | null;
}): boolean {
  if (!isPurchaseLinkRequest(input.latestCustomerMessage)) return false;
  const historyTexts = (Array.isArray(input.conversationHistory)
    ? input.conversationHistory
    : []).map((m) => m?.text ?? "");
  return threadMentionsManualCheckoutContext(historyTexts);
}

// Strong directive that drives the manual checkout-link flow and forbids the
// ordinary online out-of-stock / restock framing. Never claims a link was
// already created (no action creates one in this pipeline).
export function buildManualCheckoutLinkDirective(opts: {
  active: boolean;
  productHint?: string | null;
}): string {
  if (!opts.active) return "";
  const product = (opts.productHint && opts.productHint.trim()) || "produktet";
  return [
    "# Manual checkout-link flow (STRATEGY — overrides stock-status answering)",
    "- Context: support has already offered to send a manual/office checkout link, and the customer is accepting/requesting that link. This is a manual sales flow, NOT an online stock-status question.",
    `- Continue the promised flow: confirm warmly that we will arrange a checkout link for ${product} and that we will get back with the link shortly.`,
    "- FORBIDDEN (do not write these or equivalents, in any language): \"udsolgt\", \"ikke på lager\", \"ingen bekræftet dato\", \"tilbage på lager\", \"out of stock\", \"back in stock\", \"sold out\", \"no confirmed restock date\". Online Shopify stock is irrelevant here — do NOT mention it.",
    "- Do NOT claim a checkout link has already been created or sent — no link exists yet; say we will send/arrange it shortly.",
    "- Do NOT create or fabricate a checkout/cart URL, and do NOT ask the customer to provide a product link.",
    "- Keep it short and friendly; end with the shop's normal sign-off, no generic \"I look forward to hearing from you\" filler.",
  ].join("\n");
}

// The customer asked for a purchase link but named only a generic category
// ("send link til headset") with no model-specific token → ambiguous.
export function isAmbiguousProductRequest(message: string | null | undefined): boolean {
  if (!isPurchaseLinkRequest(message)) return false;
  const candidate = derivePurchaseProductCandidate(message);
  if (!candidate) return true;
  return !hasModelSpecificToken(candidate);
}

const PURCHASE_PRODUCT_PATTERNS: RegExp[] = [
  /\b(?:køb|buy|purchase|bestil(?:le)?)\s+(?:af\s+)?(.+?)(?:\s+(?:headset\w*|nu|today|now|online|her|here))?[?.!]*$/i,
  /\bkan\s+jeg\s+køb\w*\s+(.+?)[?.!]*$/i,
  /\bcan\s+i\s+(?:buy|purchase|order)\s+(.+?)[?.!]*$/i,
  /\bi\s+want\s+to\s+(?:buy|purchase|order)\s+(.+?)[?.!]*$/i,
  /\bwhere\s+(?:can|do|could)\s+i\s+(?:buy|purchase|get|order)\s+(.+?)[?.!]*$/i,
  /\blink\s+til\s+(?:at\s+)?(?:jeg\s+kan\s+)?(?:køb\w*\s+)?(.+?)[?.!]*$/i,
  /\blink\s+(?:to|for)\s+(?:buy(?:ing)?\s+)?(.+?)[?.!]*$/i,
];

function cleanCandidate(value: string): string {
  return value
    .replace(/[?.!,;:]+$/g, "")
    .replace(/^(?:the|a|an|this|that|den|det|en|et)\s+/i, "")
    .replace(/\s+(?:right now|now|today|currently|online|her|here|nu|tak|please)$/i, "")
    .replace(/\s+headset\w*$/i, "")
    .trim();
}

// Extract the product the customer wants to buy. Returns null when nothing
// usable can be extracted. Note: ambiguity (generic-only) is decided separately
// by isAmbiguousProductRequest — this returns the raw candidate phrase.
export function derivePurchaseProductCandidate(
  message: string | null | undefined,
): string | null {
  const text = String(message ?? "").trim();
  if (!text || !isPurchaseLinkRequest(text)) return null;
  for (const pattern of PURCHASE_PRODUCT_PATTERNS) {
    const match = text.match(pattern);
    const candidate = cleanCandidate(match?.[1] ?? "");
    const normalized = normalizeProductText(candidate);
    if (normalized && normalized.split(" ").length <= 8) {
      // Strip a trailing generic-only tail but keep model tokens.
      return candidate;
    }
  }
  return null;
}

function normalizeDomain(domain: string | null | undefined): string | null {
  let d = String(domain ?? "").trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "").replace(/\/+$/, "").trim();
  // Must look like a bare domain — no spaces, at least one dot, no path.
  if (/\s/.test(d) || d.includes("/") || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
    return null;
  }
  return d;
}

// A myshopify.com host is the Admin/internal domain, NOT the public
// customer-facing storefront. It must never appear in a customer draft.
export function isMyshopifyDomain(domain: string | null | undefined): boolean {
  const d = normalizeDomain(domain);
  return Boolean(d && /\.myshopify\.com$/.test(d));
}

// Resolve the PUBLIC, customer-facing storefront domain for a shop, in
// preference order:
//   1. an explicitly configured public storefront domain on the shop row
//      (public_storefront_domain / storefront_domain / public_domain), or the
//      Shopify-synced primary `domain` when it is not a myshopify host;
//   2. otherwise none.
// A *.myshopify.com value is always rejected. Returns the domain plus a debug
// reason when no public domain is available (so callers can surface
// `missing_public_storefront_domain` without exposing the myshopify host).
export function resolvePublicStorefrontDomain(
  shop: Record<string, unknown> | null | undefined,
): { domain: string | null; reason: string | null } {
  const s = (shop ?? {}) as Record<string, unknown>;
  const candidates = [
    s.public_storefront_domain,
    s.storefront_domain,
    s.public_domain,
    s.primary_domain,
    s.domain,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDomain(candidate as string | null | undefined);
    if (normalized && !isMyshopifyDomain(normalized)) {
      return { domain: normalized, reason: null };
    }
  }
  return { domain: null, reason: "missing_public_storefront_domain" };
}

function normalizeHandle(handle: string | null | undefined): string | null {
  const h = String(handle ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return h || null;
}

// Build a trusted product PAGE url for a CUSTOMER. Only ever produced from a
// trusted PUBLIC storefront domain + a Shopify product handle — never from
// customer free text, the Admin domain, or a myshopify.com host. Returns null
// if the domain is missing/untrusted/myshopify or the handle is missing. Never
// builds a checkout/cart URL.
export function buildTrustedProductUrl(
  publicStorefrontDomain: string | null | undefined,
  handle: string | null | undefined,
): string | null {
  const domain = normalizeDomain(publicStorefrontDomain);
  const h = normalizeHandle(handle);
  if (!domain || !h) return null;
  // Never expose the internal myshopify host to customers.
  if (isMyshopifyDomain(domain)) return null;
  return `https://${domain}/products/${h}`;
}

function factField(value: string, key: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${key}=([^;]+)`).exec(value);
  return match?.[1]?.trim() || null;
}

// Pick a grounded product-page URL for the requested product from the live
// stock facts (which now carry product title + handle) and the trusted shop
// domain. Wrong-product safety: the matched product title must actually
// correspond to the requested product. Ambiguity (>1 distinct matching
// product) returns null rather than guessing.
export function selectGroundedProductLink(opts: {
  requestedProduct: string | null | undefined;
  facts: ResolvedFact[];
  publicStorefrontDomain: string | null | undefined;
}): { url: string; productTitle: string } | null {
  const requested = normalizeProductText(opts.requestedProduct);
  if (!requested) return null;
  const requestedTokens = requested.split(" ").filter(Boolean);

  const candidates: Array<{ title: string; handle: string }> = [];
  for (const fact of opts.facts) {
    if (fact.label !== "Live stock availability") continue;
    const handle = factField(fact.value, "handle");
    const title = factField(fact.value, "product");
    if (!handle || !title) continue;
    candidates.push({ title, handle });
  }
  if (candidates.length === 0) return null;

  // Match: the product title must contain the full requested phrase, OR every
  // requested token must appear in the title (handles "A-Rise headset" → title
  // "A-Rise"). This blocks A-Rise → A-Blaze / A-Spire cross-matches.
  const matches = candidates.filter(({ title }) => {
    const normTitle = normalizeProductText(title);
    if (!normTitle) return false;
    if (normTitle.includes(requested)) return true;
    const titleTokens = new Set(normTitle.split(" "));
    return requestedTokens.every((t) =>
      GENERIC_PRODUCT_WORDS.has(t) || titleTokens.has(t)
    );
  });

  const distinctTitles = new Set(matches.map((m) => normalizeProductText(m.title)));
  if (matches.length === 0 || distinctTitles.size !== 1) return null;

  const chosen = matches[0];
  const url = buildTrustedProductUrl(opts.publicStorefrontDomain, chosen.handle);
  if (!url) return null;
  return { url, productTitle: chosen.title };
}

// Minimal shape of a retrieved knowledge chunk needed for product-link
// grounding (avoids a hard dependency on the retriever module's full type).
export interface ProductSourceChunk {
  source_provider?: string | null;
  source_title?: string | null;
  products?: string[];
  product_handle?: string | null;
  product_url?: string | null;
}

function chunkMatchesRequestedProduct(
  chunk: ProductSourceChunk,
  requested: string,
  requestedTokens: string[],
): boolean {
  const candidates = [
    chunk.source_title ?? "",
    ...(Array.isArray(chunk.products) ? chunk.products : []),
  ];
  for (const candidate of candidates) {
    const norm = normalizeProductText(candidate);
    if (!norm) continue;
    if (norm.includes(requested)) return true;
    const tokens = new Set(norm.split(" "));
    if (requestedTokens.every((t) => GENERIC_PRODUCT_WORDS.has(t) || tokens.has(t))) {
      return true;
    }
  }
  return false;
}

// Ground a trusted product-page URL from RETRIEVED `shopify_product` knowledge
// when the live Shopify stock lookup found nothing. Uses the synced trusted
// metadata.url, or rebuilds it from the trusted shop domain + synced handle.
// Wrong-product safety: only the chunk(s) actually matching the requested
// product are considered; >1 distinct product → null (no guessing).
export function selectGroundedProductLinkFromChunks(opts: {
  requestedProduct: string | null | undefined;
  chunks: ProductSourceChunk[] | null | undefined;
  publicStorefrontDomain: string | null | undefined;
}): { url: string; productTitle: string } | null {
  const requested = normalizeProductText(opts.requestedProduct);
  if (!requested) return null;
  const requestedTokens = requested.split(" ").filter(Boolean);
  const chunks = Array.isArray(opts.chunks) ? opts.chunks : [];

  const matches = chunks
    .filter((c) => String(c.source_provider || "").toLowerCase() === "shopify_product")
    .filter((c) => c.product_handle || c.product_url)
    .filter((c) => chunkMatchesRequestedProduct(c, requested, requestedTokens));
  if (matches.length === 0) return null;

  const distinct = new Set(
    matches.map((c) => normalizeProductText(c.source_title || c.product_handle || "")),
  );
  if (distinct.size !== 1) return null;

  const chosen = matches[0];
  const title = chosen.source_title || opts.requestedProduct || "the product";
  // Prefer rebuilding from the PUBLIC storefront domain + handle so the host is
  // always the customer-facing store (never myshopify). Only fall back to the
  // synced metadata url when it is itself on the public storefront domain.
  const fromHandle = buildTrustedProductUrl(
    opts.publicStorefrontDomain,
    chosen.product_handle,
  );
  if (fromHandle) return { url: fromHandle, productTitle: String(title) };
  if (
    chosen.product_url &&
    isTrustedHttpsUrl(chosen.product_url, opts.publicStorefrontDomain)
  ) {
    return { url: chosen.product_url.trim(), productTitle: String(title) };
  }
  return null;
}

function isTrustedHttpsUrl(
  url: string | null | undefined,
  publicStorefrontDomain: string | null | undefined,
): boolean {
  const u = String(url ?? "").trim();
  if (!/^https:\/\//i.test(u)) return false;
  const domain = normalizeDomain(publicStorefrontDomain);
  if (!domain || isMyshopifyDomain(domain)) return false;
  try {
    const host = new URL(u).hostname.toLowerCase();
    // Never accept a myshopify host even if it somehow matched the domain.
    if (isMyshopifyDomain(host)) return false;
    return host === domain || host.endsWith(`.${domain}`) ||
      domain.endsWith(`.${host}`) || domain === host;
  } catch {
    return false;
  }
}

export function firstTrustedProductLink(facts: ResolvedFact[]): string | null {
  const fact = facts.find((f) => f.label === TRUSTED_PRODUCT_LINK_LABEL);
  return fact?.value?.trim() || null;
}

const NO_GENERIC_CLOSING_RULE =
  "- Do NOT end with a generic closing such as \"Jeg ser frem til at høre fra dig\", \"I look forward to hearing from you\", \"Feel free to reach out\" or \"Hvis du har et specifikt produktlink...\". Keep the answer direct.";

const NO_MYSHOPIFY_RULE =
  "- NEVER show a myshopify.com URL to the customer. Only ever use the public storefront URL provided above; if none is provided, do not output any URL.";

// Writer directive for purchase-link requests.
export function buildPurchaseLinkDirective(opts: {
  isPurchaseLinkRequest: boolean;
  groundedProductUrl: string | null;
  ambiguousProduct: boolean;
  threadMentionsCheckoutLink: boolean;
  noPublicStorefrontDomain?: boolean;
}): string {
  if (!opts.isPurchaseLinkRequest) return "";
  const lines = ["# Purchase-link request (where-to-buy / send a link to buy)"];
  if (opts.groundedProductUrl) {
    lines.push(
      `- The customer wants a link to BUY the product. A TRUSTED public storefront product page URL is grounded: ${opts.groundedProductUrl}`,
    );
    lines.push(
      "- LEAD with this product page link as the answer and include the exact URL above verbatim.",
    );
    lines.push(
      "- Do NOT lead with or focus on stock/availability uncertainty. Do NOT say you cannot confirm stock as the main answer. Do NOT apologise for unknown stock.",
    );
    lines.push(
      "- Do NOT ask the customer to provide a product link, product name or variant — you already have the correct product page link.",
    );
    lines.push(
      "- Do NOT invent, guess or fabricate any checkout/cart URL. Only the product page URL above is allowed.",
    );
  } else if (opts.ambiguousProduct) {
    lines.push(
      "- The customer asked for a purchase link but the specific product/model is ambiguous. Ask EXACTLY ONE short clarification about which product or model they mean.",
    );
    lines.push("- Do NOT guess a product. Do NOT provide any product URL.");
    lines.push("- Do NOT lead with stock/availability uncertainty.");
  } else {
    lines.push(
      "- The customer wants a link to buy the product, but no trusted PUBLIC storefront product page URL is available right now" +
        (opts.noPublicStorefrontDomain
          ? " (no public storefront domain is configured — debug: missing_public_storefront_domain)."
          : "."),
    );
    lines.push(
      "- Do NOT claim that stock/availability is unknown as the main answer. Instead say that we can send the correct product link.",
    );
    lines.push(
      "- Do NOT invent, guess or fabricate any product URL or checkout/cart URL, and do NOT output a myshopify.com URL.",
    );
  }
  if (opts.threadMentionsCheckoutLink) {
    lines.push(
      "- The thread mentions a direct checkout link. You MAY say that we can help send a direct checkout-link (e.g. \"vi kan hjælpe med at sende et direkte checkout-link\"), but you MUST NOT invent, guess or fabricate any checkout/cart URL.",
    );
  }
  lines.push(NO_MYSHOPIFY_RULE);
  lines.push(NO_GENERIC_CLOSING_RULE);
  return lines.join("\n");
}

// Stock-question fallback: live stock could NOT be confirmed, but a trusted
// product page URL is grounded (from retrieval / synced product context). Stock
// stays the primary answer; the link is offered as a secondary pointer and we
// must NOT ask the customer for a product link. Only relevant for stock-intent
// messages (purchase-link intent is handled by buildPurchaseLinkDirective).
export function buildStockUnknownLinkFallbackDirective(opts: {
  isStockQuestion: boolean;
  stockConfirmed: boolean;
  groundedProductUrl: string | null;
  threadMentionsCheckoutLink: boolean;
  noPublicStorefrontDomain?: boolean;
}): string {
  // Fires whenever it is a stock question and live stock is NOT confirmed —
  // regardless of whether a public URL is available — so the reply stays honest
  // and clean (no "send me a product link", no generic closing, no myshopify).
  if (!opts.isStockQuestion || opts.stockConfirmed) {
    return "";
  }
  const lines = [
    "# Stock unknown — keep the answer honest and clean",
    "- Live stock/availability could NOT be confirmed. Use exactly this kind of wording: \"Jeg kan desværre ikke se den aktuelle lagerstatus for [produkt] lige nu.\" (adapt to the reply language).",
    "- FORBIDDEN unless live stock state is actually out_of_stock: \"ikke på lager\", \"udsolgt\", \"out of stock\", \"sold out\".",
    "- FORBIDDEN in all unknown cases (these imply a restock you cannot promise): \"når det er tilgængeligt igen\", \"back in stock\", \"tilbage på lager\", \"kommer på lager igen\", \"restock\".",
    "- Do NOT claim it is in stock, on preorder, reserved, or coming back on a date.",
    "- Do NOT ask the customer to provide a product link, product name or variant.",
  ];
  if (opts.groundedProductUrl) {
    lines.push(
      `- We have the correct PUBLIC storefront product page link: ${opts.groundedProductUrl}`,
    );
    lines.push(
      `- Provide that product page URL verbatim as a helpful pointer (e.g. "du kan finde produktet her: ${opts.groundedProductUrl}").`,
    );
  } else {
    lines.push(
      "- No public storefront product page URL is available right now" +
        (opts.noPublicStorefrontDomain
          ? " (no public storefront domain is configured — debug: missing_public_storefront_domain)."
          : ".") +
        " Do NOT output any URL; instead say we can send the correct product link if the customer wants it.",
    );
  }
  lines.push("- Do NOT invent, guess or fabricate any checkout/cart URL.");
  if (opts.threadMentionsCheckoutLink) {
    lines.push(
      "- The thread mentions a direct checkout link. You MAY say that we can help send a direct checkout-link, but you MUST NOT invent, guess or fabricate any checkout/cart URL.",
    );
  }
  lines.push(NO_MYSHOPIFY_RULE);
  lines.push(NO_GENERIC_CLOSING_RULE);
  return lines.join("\n");
}
