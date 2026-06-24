import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildManualCheckoutLinkDirective,
  buildPurchaseLinkDirective,
  containsLinkPlaceholder,
  detectOrdinaryProductLinkCheckoutViolation,
  isAccessoryReplacementRequest,
  isCheckoutLinkRequest,
  buildStockUnknownLinkFallbackDirective,
  buildTrustedProductUrl,
  derivePurchaseProductCandidate,
  detectManualCheckoutLinkFlow,
  threadMentionsManualCheckoutContext,
  isAmbiguousProductRequest,
  isPurchaseLinkRequest,
  type ProductSourceChunk,
  resolvePublicStorefrontDomain,
  selectGroundedProductLink,
  selectGroundedProductLinkFromChunks,
  selectGroundedProductLinkFromProducts,
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

Deno.test("lost/missing accessory replacement requests are not ordinary purchase-link requests", () => {
  const message =
    "Jeg har smidt min adapter væk til min model X200 stol. Er der mulighed for at købe en ny?";
  assert(isAccessoryReplacementRequest(message));
  assertEquals(isPurchaseLinkRequest(message), false);
  assertEquals(
    buildPurchaseLinkDirective({
      isPurchaseLinkRequest: isPurchaseLinkRequest(message),
      groundedProductUrl: "https://example-shop.test/products/x200-chair",
      ambiguousProduct: false,
      threadMentionsCheckoutLink: false,
    }),
    "",
  );
});

Deno.test("generic replacement-part wording is not ordinary purchase-link behavior", () => {
  for (const message of [
    "I lost the remote for my X200 chair. Can I buy a new one?",
    "Can I buy a replacement part for my X200?",
    "Mit tilbehør mangler til min model X200. Kan jeg købe et nyt?",
  ]) {
    assert(isAccessoryReplacementRequest(message), message);
    assertEquals(isPurchaseLinkRequest(message), false, message);
  }
});

Deno.test("normal product purchase questions still use ordinary purchase-link behavior", () => {
  const message = "Where can I buy the X200 keyboard?";
  assertEquals(isAccessoryReplacementRequest(message), false);
  assert(isPurchaseLinkRequest(message));
  const d = buildPurchaseLinkDirective({
    isPurchaseLinkRequest: isPurchaseLinkRequest(message),
    isCheckoutLinkRequest: false,
    groundedProductUrl: "https://example-shop.test/products/x200-keyboard",
    ambiguousProduct: false,
    threadMentionsCheckoutLink: false,
  });
  assert(d.includes("https://example-shop.test/products/x200-keyboard"));
  assert(/Product-page link request/i.test(d));
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

Deno.test("ordinary product-link (grounded): includes exact URL, NO checkout wording, no placeholder", () => {
  const d = buildPurchaseLinkDirective({
    isPurchaseLinkRequest: true,
    isCheckoutLinkRequest: false,
    groundedProductUrl: "https://www.acezone.io/products/a-rise",
    ambiguousProduct: false,
    threadMentionsCheckoutLink: false,
  });
  assert(d.includes("https://www.acezone.io/products/a-rise"));
  assert(/Include the EXACT URL above verbatim/i.test(d));
  // Ordinary product-link path must forbid checkout wording + placeholders.
  assert(/ORDINARY product-page link request, NOT a checkout-link request/i.test(d));
  assert(/NEVER write a placeholder/i.test(d));
  assert(/Do NOT invent.*checkout/i.test(d));
  // Even when threadMentionsCheckoutLink is incidentally true, an ordinary
  // request must NOT get the "offer a checkout-link" line.
  const d2 = buildPurchaseLinkDirective({
    isPurchaseLinkRequest: true,
    isCheckoutLinkRequest: false,
    groundedProductUrl: "https://www.acezone.io/products/a-rise",
    ambiguousProduct: false,
    threadMentionsCheckoutLink: true,
  });
  assert(!/help send a direct checkout-link/i.test(d2));
});

Deno.test("ordinary product-link (no stock question): directive forbids stock wording", () => {
  const d = buildPurchaseLinkDirective({
    isPurchaseLinkRequest: true,
    isCheckoutLinkRequest: false,
    isStockQuestion: false,
    groundedProductUrl: "https://www.acezone.io/products/a-rise",
    ambiguousProduct: false,
    threadMentionsCheckoutLink: false,
  });
  assert(d.includes("https://www.acezone.io/products/a-rise"));
  assert(/Do NOT mention stock or availability at all/i.test(d));
  assert(/på lager/i.test(d)); // the forbidden word is listed in the rule
  assert(!/MAY state availability/i.test(d));
});

Deno.test("product-link WITH explicit stock question: availability allowed if grounded", () => {
  const d = buildPurchaseLinkDirective({
    isPurchaseLinkRequest: true,
    isCheckoutLinkRequest: false,
    isStockQuestion: true,
    groundedProductUrl: "https://www.acezone.io/products/a-rise",
    ambiguousProduct: false,
    threadMentionsCheckoutLink: false,
  });
  assert(d.includes("https://www.acezone.io/products/a-rise"));
  assert(/MAY state availability ONLY if a live stock fact/i.test(d));
  assert(!/Do NOT mention stock or availability at all/i.test(d));
});

Deno.test("explicit checkout-link request: may offer checkout help, never fabricates", () => {
  const d = buildPurchaseLinkDirective({
    isPurchaseLinkRequest: true,
    isCheckoutLinkRequest: true,
    groundedProductUrl: "https://www.acezone.io/products/a-rise",
    ambiguousProduct: false,
    threadMentionsCheckoutLink: true,
  });
  assert(/checkout-link/i.test(d));
  assert(/MUST NOT invent/i.test(d));
  // Checkout request must NOT carry the ordinary "no checkout wording" rule.
  assert(!/ORDINARY product-page link request/i.test(d));
});

Deno.test("directive (no ground): safe fallback, no placeholder, no 'send the link' promise", () => {
  const d = buildPurchaseLinkDirective({
    isPurchaseLinkRequest: true,
    groundedProductUrl: null,
    ambiguousProduct: false,
    threadMentionsCheckoutLink: false,
  });
  assert(/cannot find a secure product link right now/i.test(d));
  assert(/NEVER write a placeholder/i.test(d));
  assert(/NEVER show a myshopify\.com URL/i.test(d));
});

Deno.test("isCheckoutLinkRequest distinguishes checkout from ordinary product link", () => {
  assert(isCheckoutLinkRequest("Kan du sende et checkout-link til A-Rise?"));
  assert(isCheckoutLinkRequest("Kan du sende et betalingslink?"));
  assert(isCheckoutLinkRequest("send a payment link"));
  // Ordinary product-link requests are NOT checkout-link requests.
  assertEquals(isCheckoutLinkRequest("Kan du sende link til A-Rise?"), false);
  assertEquals(isCheckoutLinkRequest("Hvor kan jeg købe A-Rise?"), false);
  assertEquals(isCheckoutLinkRequest("Har du et produktlink?"), false);
});

Deno.test("containsLinkPlaceholder catches forbidden placeholders", () => {
  for (const s of ["[indsæt link her]", "[link]", "[produktlink]", "[product link]", "[checkout link]", "insert link here", "indsæt produktlink her"]) {
    assert(containsLinkPlaceholder(`Her er linket: ${s}`), `should flag "${s}"`);
  }
  assertEquals(containsLinkPlaceholder("Du kan finde A-Rise her: https://www.acezone.io/products/a-rise"), false);
});

Deno.test("verifier guard: ordinary product-link draft using checkout wording is flagged", () => {
  const draft = "Hej, A-Rise er på lager. Jeg kan sende dig et direkte checkout-link, så du kan gennemføre købet.";
  assert(detectOrdinaryProductLinkCheckoutViolation(draft, {
    customerMessage: "Kan du sende link til A-Rise?",
    conversationHistory: [],
  }));
});

Deno.test("verifier guard: ordinary product-link draft with the real URL is NOT flagged", () => {
  const draft = "Hej, Du kan finde A-Rise her: https://www.acezone.io/products/a-rise";
  assertEquals(
    detectOrdinaryProductLinkCheckoutViolation(draft, {
      customerMessage: "Kan du sende link til A-Rise?",
      conversationHistory: [],
    }),
    false,
  );
});

Deno.test("verifier guard: explicit checkout-link request may use checkout wording", () => {
  const draft = "Hej, Jeg kan sende dig et checkout-link til A-Rise.";
  assertEquals(
    detectOrdinaryProductLinkCheckoutViolation(draft, {
      customerMessage: "Kan du sende et checkout-link til A-Rise?",
      conversationHistory: [],
    }),
    false,
  );
});

Deno.test("verifier guard: manual checkout flow may use checkout wording", () => {
  const draft = "Hej Daniel, Jeg sørger for at arrangere et checkout-link til dig.";
  assertEquals(
    detectOrdinaryProductLinkCheckoutViolation(draft, {
      customerMessage: "Send gerne link til at jeg kan købe A-Rise",
      conversationHistory: [
        { role: "agent", text: "Vi har et par stykker liggende på kontoret… kan sende dig et check-out link" },
      ],
    }),
    false,
  );
});

Deno.test("verifier guard: non-product-link message is never flagged", () => {
  assertEquals(
    detectOrdinaryProductLinkCheckoutViolation("Vi sender dig et checkout-link.", {
      customerMessage: "Hvor er min pakke?",
      conversationHistory: [],
    }),
    false,
  );
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

// --- Manual checkout-link flow (T-050832) -------------------------------

Deno.test("threadMentionsManualCheckoutContext detects checkout-link & office-stock offers", () => {
  assert(threadMentionsManualCheckoutContext(["Jeg kan sende dig et check-out link"]));
  assert(threadMentionsManualCheckoutContext(["jeg sender dig et checkout link"]));
  assert(threadMentionsManualCheckoutContext(["send dig et link til betaling"]));
  assert(threadMentionsManualCheckoutContext(["Vi har et par stykker liggende her på kontoret"]));
  assert(threadMentionsManualCheckoutContext(["We have a few units at the office"]));
  assert(threadMentionsManualCheckoutContext(["I can send you a checkout link"]));
  assertEquals(threadMentionsManualCheckoutContext(["Tak for din besked"]), false);
});

Deno.test("detectManualCheckoutLinkFlow: purchase-link + prior manual-stock offer", () => {
  const history = [
    { role: "agent", text: "Vi har et par stykker liggende her på kontoret, så hvis du ønsker, kan jeg sende dig et check-out link…" },
  ];
  assert(detectManualCheckoutLinkFlow({
    latestCustomerMessage: "Hej Send gerne link til at jeg kan købe A-rise headset :)",
    conversationHistory: history,
  }));
  // No prior manual/checkout context → not the manual flow.
  assertEquals(
    detectManualCheckoutLinkFlow({
      latestCustomerMessage: "Hej Send gerne link til at jeg kan købe A-rise headset :)",
      conversationHistory: [{ role: "agent", text: "Tak for din besked" }],
    }),
    false,
  );
  // Latest message is not a purchase-link request → not the manual flow.
  assertEquals(
    detectManualCheckoutLinkFlow({
      latestCustomerMessage: "Har I A-Rise på lager?",
      conversationHistory: history,
    }),
    false,
  );
});

Deno.test("manual checkout-link directive overrides stock & forbids out-of-stock wording", () => {
  const d = buildManualCheckoutLinkDirective({ active: true, productHint: "A-Rise" });
  assert(/checkout/i.test(d));
  assert(/A-Rise/.test(d));
  // Forbidden online-stock / restock phrasings are explicitly listed.
  for (const phrase of ["udsolgt", "ikke på lager", "ingen bekræftet dato", "tilbage på lager", "out of stock", "back in stock"]) {
    assert(d.includes(phrase), `directive should forbid "${phrase}"`);
  }
  // Must not claim a link already exists.
  assert(/Do NOT claim a checkout link has already been created/i.test(d));
  assert(/Do NOT create or fabricate/i.test(d));
  assertEquals(buildManualCheckoutLinkDirective({ active: false }), "");
});

// --- Public storefront domain support (shops.public_storefront_domain) ------

// Helper mirroring the runtime path: resolve a shop's public domain, then build
// the product page URL from the trusted domain + a trusted Shopify handle.
function productUrlForShop(shop: Record<string, unknown>, handle: string): string | null {
  const { domain } = resolvePublicStorefrontDomain(shop);
  return buildTrustedProductUrl(domain, handle);
}

Deno.test("public domain configured → builds public product URL", () => {
  assertEquals(
    productUrlForShop({ public_storefront_domain: "www.acezone.io", shop_domain: "shop-acezone.myshopify.com" }, "a-rise"),
    "https://www.acezone.io/products/a-rise",
  );
});

Deno.test("only myshopify shop_domain → no public product URL", () => {
  const shop = { shop_domain: "shop-acezone.myshopify.com" };
  assertEquals(resolvePublicStorefrontDomain(shop), { domain: null, reason: "missing_public_storefront_domain" });
  assertEquals(productUrlForShop(shop, "a-rise"), null);
});

Deno.test("public domain with protocol is normalized", () => {
  assertEquals(
    productUrlForShop({ public_storefront_domain: "https://www.acezone.io" }, "a-rise"),
    "https://www.acezone.io/products/a-rise",
  );
});

Deno.test("public domain with trailing slash is normalized", () => {
  assertEquals(
    productUrlForShop({ public_storefront_domain: "www.acezone.io/" }, "a-rise"),
    "https://www.acezone.io/products/a-rise",
  );
});

Deno.test("public_storefront_domain set to a myshopify host is rejected", () => {
  const shop = { public_storefront_domain: "shop-acezone.myshopify.com" };
  assertEquals(resolvePublicStorefrontDomain(shop), { domain: null, reason: "missing_public_storefront_domain" });
  assertEquals(productUrlForShop(shop, "a-rise"), null);
});

Deno.test("synced metadata URL is myshopify but public domain set → rebuild on public domain", () => {
  const result = selectGroundedProductLinkFromChunks({
    requestedProduct: "A-Rise",
    chunks: [{
      source_provider: "shopify_product",
      source_title: "A-Rise",
      product_handle: "a-rise",
      product_url: "https://shop-acezone.myshopify.com/products/a-rise",
    }],
    publicStorefrontDomain: resolvePublicStorefrontDomain({ public_storefront_domain: "www.acezone.io" }).domain,
  });
  assertEquals(result?.url, "https://www.acezone.io/products/a-rise");
});

Deno.test("customer-text URL is ignored — only trusted domain + handle builds a link", () => {
  // No public domain configured: a URL pasted by the customer must NOT surface.
  assertEquals(
    selectGroundedProductLinkFromChunks({
      requestedProduct: "A-Rise",
      chunks: [{ source_provider: "shopify_product", source_title: "A-Rise", product_url: "https://evil.example/products/a-rise" }],
      publicStorefrontDomain: resolvePublicStorefrontDomain({ shop_domain: "shop-acezone.myshopify.com" }).domain,
    }),
    null,
  );
});

Deno.test("invalid / malicious public_storefront_domain values are rejected", () => {
  for (const bad of ["javascript:alert(1)", "www.acezone.io/products/a-rise", "https://evil.com/path", "not a domain", ""]) {
    assertEquals(
      resolvePublicStorefrontDomain({ public_storefront_domain: bad }).domain,
      null,
      `should reject "${bad}"`,
    );
    assertEquals(productUrlForShop({ public_storefront_domain: bad }, "a-rise"), null);
  }
});

Deno.test("TRUSTED_PRODUCT_LINK_LABEL is stable", () => {
  assertEquals(TRUSTED_PRODUCT_LINK_LABEL, "Trusted product page link");
});

// --- Stage 4B-1: shop_products normalized-row fallback ---------------------

Deno.test("selectGroundedProductLinkFromProducts builds a trusted URL from a matching normalized product row", () => {
  const result = selectGroundedProductLinkFromProducts({
    requestedProduct: "A-Spire Wireless",
    products: [
      { title: "A-Spire", handle: "a-spire", product_url: null },
      {
        title: "A-Spire Wireless",
        handle: "a-spire-wireless",
        product_url: "https://www.acezone.io/products/a-spire-wireless",
      },
    ],
    publicStorefrontDomain: "www.acezone.io",
  });
  assertEquals(result, {
    url: "https://www.acezone.io/products/a-spire-wireless",
    productTitle: "A-Spire Wireless",
  });
});

Deno.test("selectGroundedProductLinkFromProducts returns null on ambiguous product match (no guessing)", () => {
  const result = selectGroundedProductLinkFromProducts({
    requestedProduct: "A-Spire",
    products: [
      { title: "A-Spire", handle: "a-spire", product_url: null },
      { title: "A-Spire Wireless", handle: "a-spire-wireless", product_url: null },
    ],
    publicStorefrontDomain: "www.acezone.io",
  });
  // "A-Spire" tokens are a subset of both titles → two distinct products → null.
  assertEquals(result, null);
});

Deno.test("selectGroundedProductLinkFromProducts never emits a myshopify link", () => {
  const result = selectGroundedProductLinkFromProducts({
    requestedProduct: "A-Rise",
    products: [
      {
        title: "A-Rise",
        handle: "a-rise",
        product_url: "https://shop-acezone.myshopify.com/products/a-rise",
      },
    ],
    publicStorefrontDomain: "shop-acezone.myshopify.com",
  });
  assertEquals(result, null);
});

Deno.test("selectGroundedProductLinkFromProducts returns null when no public domain and only a myshopify product_url exists", () => {
  const result = selectGroundedProductLinkFromProducts({
    requestedProduct: "A-Rise",
    products: [{ title: "A-Rise", handle: null, product_url: null }],
    publicStorefrontDomain: null,
  });
  assertEquals(result, null);
});
