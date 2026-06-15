import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildPurchaseLinkDirective,
  buildStockUnknownLinkFallbackDirective,
  buildTrustedProductUrl,
  derivePurchaseProductCandidate,
  isAmbiguousProductRequest,
  isPurchaseLinkRequest,
  type ProductSourceChunk,
  resolvePublicStorefrontDomain,
  selectGroundedProductLink,
  selectGroundedProductLinkFromChunks,
  threadMentionsCheckoutLink,
  TRUSTED_PRODUCT_LINK_LABEL,
} from "./purchase-link.ts";
import type { ResolvedFact } from "./fact-resolver.ts";

const stockFact = (product: string, handle: string, state = "in_stock"): ResolvedFact => ({
  label: "Live stock availability",
  value: `state=${state}; product=${product}; handle=${handle}; source=shopify_live`,
});

Deno.test("isPurchaseLinkRequest detects Danish + English buy-link intents", () => {
  assert(isPurchaseLinkRequest("Send gerne link til at jeg kan købe A-Rise headset :)"));
  assert(isPurchaseLinkRequest("Hvor kan jeg købe A-Rise?"));
  assert(isPurchaseLinkRequest("Can you send me the link to buy A-Rise?"));
  assert(isPurchaseLinkRequest("Where can I buy the A-Rise headset?"));
  assert(isPurchaseLinkRequest("I want to buy A-Rise"));
  assert(isPurchaseLinkRequest("Jeg vil gerne købe A-Rise"));
});

Deno.test("isPurchaseLinkRequest does NOT fire on pure stock questions", () => {
  assertEquals(isPurchaseLinkRequest("Er A-Rise på lager?"), false);
  assertEquals(isPurchaseLinkRequest("Is A-Rise in stock?"), false);
  assertEquals(isPurchaseLinkRequest("Har I A-Rise på lager?"), false);
});

Deno.test("derivePurchaseProductCandidate extracts the product", () => {
  assertEquals(
    isAmbiguousProductRequest("Send gerne link til at jeg kan købe A-Rise headset"),
    false,
  );
  const c = derivePurchaseProductCandidate("Hvor kan jeg købe A-Rise?");
  assert(c && /a-rise/i.test(c));
});

Deno.test("ambiguous when only a generic category is named", () => {
  assert(isAmbiguousProductRequest("Send link til headset"));
  assertEquals(isAmbiguousProductRequest("Send link til at købe A-Rise"), false);
});

Deno.test("buildTrustedProductUrl only builds product page urls from trusted inputs", () => {
  assertEquals(
    buildTrustedProductUrl("acezone.dk", "a-rise"),
    "https://acezone.dk/products/a-rise",
  );
  assertEquals(
    buildTrustedProductUrl("www.acezone.io", "A-Rise"),
    "https://www.acezone.io/products/a-rise",
  );
  // myshopify.com is the internal Admin host — never a customer-facing URL.
  assertEquals(buildTrustedProductUrl("https://shop-acezone.myshopify.com/", "A-Rise"), null);
  assertEquals(buildTrustedProductUrl("shop.myshopify.com", "a-rise"), null);
  // Untrusted / missing inputs → null (never fabricate).
  assertEquals(buildTrustedProductUrl("", "a-rise"), null);
  assertEquals(buildTrustedProductUrl("acezone.dk", ""), null);
  assertEquals(buildTrustedProductUrl("not a domain", "a-rise"), null);
  assertEquals(buildTrustedProductUrl("javascript:alert(1)", "a-rise"), null);
});

Deno.test("resolvePublicStorefrontDomain prefers public domain, rejects myshopify", () => {
  assertEquals(
    resolvePublicStorefrontDomain({ public_storefront_domain: "www.acezone.io", shop_domain: "shop-acezone.myshopify.com" }),
    { domain: "www.acezone.io", reason: null },
  );
  assertEquals(
    resolvePublicStorefrontDomain({ domain: "acezone.io" }),
    { domain: "acezone.io", reason: null },
  );
  assertEquals(
    resolvePublicStorefrontDomain({ shop_domain: "shop-acezone.myshopify.com", domain: "shop-acezone.myshopify.com" }),
    { domain: null, reason: "missing_public_storefront_domain" },
  );
});

Deno.test("metadata URL: public accepted, myshopify rebuilt or suppressed", () => {
  assertEquals(
    selectGroundedProductLinkFromChunks({
      requestedProduct: "A-Rise",
      chunks: [{ source_provider: "shopify_product", source_title: "A-Rise", product_url: "https://www.acezone.io/products/a-rise" }],
      publicStorefrontDomain: "www.acezone.io",
    })?.url,
    "https://www.acezone.io/products/a-rise",
  );
  assertEquals(
    selectGroundedProductLinkFromChunks({
      requestedProduct: "A-Rise",
      chunks: [{ source_provider: "shopify_product", source_title: "A-Rise", product_handle: "a-rise", product_url: "https://shop-acezone.myshopify.com/products/a-rise" }],
      publicStorefrontDomain: "www.acezone.io",
    })?.url,
    "https://www.acezone.io/products/a-rise",
  );
  assertEquals(
    selectGroundedProductLinkFromChunks({
      requestedProduct: "A-Rise",
      chunks: [{ source_provider: "shopify_product", source_title: "A-Rise", product_url: "https://shop-acezone.myshopify.com/products/a-rise" }],
      publicStorefrontDomain: null,
    }),
    null,
  );
});

Deno.test("selectGroundedProductLink grounds the matched product", () => {
  const result = selectGroundedProductLink({
    requestedProduct: "A-Rise headset",
    facts: [stockFact("A-Rise", "a-rise")],
    publicStorefrontDomain: "acezone.dk",
  });
  assertEquals(result, { url: "https://acezone.dk/products/a-rise", productTitle: "A-Rise" });
});

Deno.test("selectGroundedProductLink never returns the wrong product", () => {
  // Only A-Blaze / A-Spire facts present → A-Rise request must NOT match.
  const result = selectGroundedProductLink({
    requestedProduct: "A-Rise",
    facts: [
      stockFact("A-Blaze", "a-blaze"),
      stockFact("A-Spire Wireless", "a-spire-wireless"),
      stockFact("A-Spire", "a-spire"),
    ],
    publicStorefrontDomain: "acezone.dk",
  });
  assertEquals(result, null);
});

Deno.test("selectGroundedProductLink returns null without a handle", () => {
  const result = selectGroundedProductLink({
    requestedProduct: "A-Rise",
    facts: [{ label: "Live stock availability", value: "state=unknown; product_query=A-Rise; reason=not_found" }],
    publicStorefrontDomain: "acezone.dk",
  });
  assertEquals(result, null);
});

Deno.test("threadMentionsCheckoutLink detects prior support offer", () => {
  assert(threadMentionsCheckoutLink([
    "Vi har et par stykker liggende her på kontoret ... jeg kan sende dig et check-out link",
  ]));
  assertEquals(threadMentionsCheckoutLink(["Tak for din besked"]), false);
});

Deno.test("directive (grounded): leads with link, no stock fallback, no fabricated checkout", () => {
  const d = buildPurchaseLinkDirective({
    isPurchaseLinkRequest: true,
    groundedProductUrl: "https://acezone.dk/products/a-rise",
    ambiguousProduct: false,
    threadMentionsCheckoutLink: false,
  });
  assert(d.includes("https://acezone.dk/products/a-rise"));
  assert(/LEAD with this product page link/i.test(d));
  assert(/Do NOT lead with .*stock/i.test(d));
  assert(/Do NOT ask the customer to provide a product link/i.test(d));
  assert(/Do NOT invent.*checkout/i.test(d));
});

Deno.test("directive (checkout context): may offer checkout help, never fabricates", () => {
  const d = buildPurchaseLinkDirective({
    isPurchaseLinkRequest: true,
    groundedProductUrl: "https://acezone.dk/products/a-rise",
    ambiguousProduct: false,
    threadMentionsCheckoutLink: true,
  });
  assert(/checkout-link/i.test(d));
  assert(/MUST NOT invent/i.test(d));
});

Deno.test("directive (no ground): support helps, no stock-unknown lead", () => {
  const d = buildPurchaseLinkDirective({
    isPurchaseLinkRequest: true,
    groundedProductUrl: null,
    ambiguousProduct: false,
    threadMentionsCheckoutLink: false,
  });
  assert(/we can send the correct product link/i.test(d));
  assert(/Do NOT claim that stock\/availability is unknown as the main answer/i.test(d));
  assert(/NEVER show a myshopify\.com URL/i.test(d));
});

Deno.test("directive (ambiguous): one clarification, no guess", () => {
  const d = buildPurchaseLinkDirective({
    isPurchaseLinkRequest: true,
    groundedProductUrl: null,
    ambiguousProduct: true,
    threadMentionsCheckoutLink: false,
  });
  assert(/EXACTLY ONE short clarification/i.test(d));
  assert(/Do NOT guess/i.test(d));
});

Deno.test("directive empty when not a purchase-link request", () => {
  assertEquals(
    buildPurchaseLinkDirective({
      isPurchaseLinkRequest: false,
      groundedProductUrl: null,
      ambiguousProduct: false,
      threadMentionsCheckoutLink: false,
    }),
    "",
  );
});

const productChunk = (
  title: string,
  handle: string,
  extra: Partial<ProductSourceChunk> = {},
): ProductSourceChunk => ({
  source_provider: "shopify_product",
  source_title: title,
  product_handle: handle,
  product_url: `https://acezone.dk/products/${handle}`,
  ...extra,
});

Deno.test("selectGroundedProductLinkFromChunks grounds from synced product source", () => {
  const result = selectGroundedProductLinkFromChunks({
    requestedProduct: "A-rise",
    chunks: [productChunk("A-Rise", "a-rise")],
    publicStorefrontDomain: "acezone.dk",
  });
  assertEquals(result, { url: "https://acezone.dk/products/a-rise", productTitle: "A-Rise" });
});

Deno.test("selectGroundedProductLinkFromChunks rebuilds url on trusted domain when synced url is foreign", () => {
  const result = selectGroundedProductLinkFromChunks({
    requestedProduct: "A-Rise",
    chunks: [productChunk("A-Rise", "a-rise", { product_url: "https://evil.example/products/a-rise" })],
    publicStorefrontDomain: "acezone.dk",
  });
  // Handle present → rebuilt from trusted domain, ignoring the foreign url.
  assertEquals(result?.url, "https://acezone.dk/products/a-rise");
});

Deno.test("selectGroundedProductLinkFromChunks never returns the wrong product", () => {
  const result = selectGroundedProductLinkFromChunks({
    requestedProduct: "A-Rise",
    chunks: [
      productChunk("A-Blaze", "a-blaze"),
      productChunk("A-Spire Wireless", "a-spire-wireless"),
    ],
    publicStorefrontDomain: "acezone.dk",
  });
  assertEquals(result, null);
});

Deno.test("selectGroundedProductLinkFromChunks ignores non-product chunks", () => {
  const result = selectGroundedProductLinkFromChunks({
    requestedProduct: "A-Rise",
    chunks: [{ source_provider: "shopify_policy", source_title: "A-Rise returns", product_handle: "a-rise" }],
    publicStorefrontDomain: "acezone.dk",
  });
  assertEquals(result, null);
});

Deno.test("stock-unknown fallback: link secondary, never asks for product link", () => {
  const d = buildStockUnknownLinkFallbackDirective({
    isStockQuestion: true,
    stockConfirmed: false,
    groundedProductUrl: "https://acezone.dk/products/a-rise",
    threadMentionsCheckoutLink: false,
  });
  assert(/ikke se den aktuelle lagerstatus/i.test(d));
  assert(/Do NOT ask the customer to provide a product link/i.test(d));
  assert(d.includes("https://acezone.dk/products/a-rise"));
  assert(/Do NOT invent.*checkout/i.test(d));
  assert(/NEVER show a myshopify\.com URL/i.test(d));
  assert(/Do NOT end with a generic closing/i.test(d));
  // Forbidden restock / out-of-stock phrasings on unknown stock.
  assert(/når det er tilgængeligt igen/i.test(d));
  assert(/tilbage på lager/i.test(d));
  assert(/udsolgt/i.test(d));
  assert(/ikke på lager/i.test(d));
});

Deno.test("stock-unknown fallback without a URL stays honest, no link, debug reason", () => {
  const d = buildStockUnknownLinkFallbackDirective({
    isStockQuestion: true,
    stockConfirmed: false,
    groundedProductUrl: null,
    threadMentionsCheckoutLink: false,
    noPublicStorefrontDomain: true,
  });
  assert(/ikke se den aktuelle lagerstatus/i.test(d));
  assert(/Do NOT output any URL/i.test(d));
  assert(/missing_public_storefront_domain/i.test(d));
  assert(/Do NOT ask the customer to provide a product link/i.test(d));
});

Deno.test("stock-unknown fallback empty only when confirmed or not a stock question", () => {
  assertEquals(
    buildStockUnknownLinkFallbackDirective({
      isStockQuestion: true,
      stockConfirmed: true,
      groundedProductUrl: "https://www.acezone.io/products/a-rise",
      threadMentionsCheckoutLink: false,
    }),
    "",
  );
  assertEquals(
    buildStockUnknownLinkFallbackDirective({
      isStockQuestion: false,
      stockConfirmed: false,
      groundedProductUrl: "https://www.acezone.io/products/a-rise",
      threadMentionsCheckoutLink: false,
    }),
    "",
  );
});

Deno.test("TRUSTED_PRODUCT_LINK_LABEL is stable", () => {
  assertEquals(TRUSTED_PRODUCT_LINK_LABEL, "Trusted product page link");
});
