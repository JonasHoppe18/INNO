import { assert, assertEquals } from "jsr:@std/assert@1";
import { resolveEcommerceLinks } from "./ecommerce-link-resolver.ts";
import { TRUSTED_PRODUCT_LINK_LABEL } from "./purchase-link.ts";
import type { ResolvedFact } from "./fact-resolver.ts";

const linkFact = (url: string): ResolvedFact => ({ label: TRUSTED_PRODUCT_LINK_LABEL, value: url });
const stockFact = (state: string): ResolvedFact => ({
  label: "Live stock availability",
  value: `state=${state}; product=A-Rise; handle=a-rise; source=shopify_live`,
});
const productChunk = (title: string, handle: string) => ({
  source_provider: "shopify_product",
  source_title: title,
  product_handle: handle,
  product_url: `https://www.acezone.io/products/${handle}`,
});

Deno.test("1. purchase-link + grounded URL → direct product_page link", () => {
  const r = resolveEcommerceLinks({
    latestCustomerMessage: "Send link til A-Rise",
    facts: [linkFact("https://www.acezone.io/products/a-rise")],
    requestedProduct: "A-Rise",
  });
  assertEquals(r.primary_strategy, "send_public_product_link");
  const d = r.decisions[0];
  assert(d.kind === "direct_link" && d.link_type === "product_page");
  assert(d.kind === "direct_link" && d.safe_to_insert === true);
  assert(d.kind === "direct_link" && d.source === "live_shopify");
});

Deno.test("2. where-to-buy + grounded chunk + in_stock → direct product_page link", () => {
  const r = resolveEcommerceLinks({
    latestCustomerMessage: "Hvor kan jeg købe A-Rise?",
    facts: [stockFact("in_stock")],
    productChunks: [productChunk("A-Rise", "a-rise")],
    publicStorefrontDomain: "www.acezone.io",
    requestedProduct: "A-Rise",
  });
  assertEquals(r.primary_strategy, "send_public_product_link");
  const d = r.decisions[0];
  assert(d.kind === "direct_link" && d.link_type === "product_page");
  assert(d.kind === "direct_link" && d.source === "synced_product_metadata");
  assert(d.kind === "direct_link" && d.url === "https://www.acezone.io/products/a-rise");
});

Deno.test("3. stock question + out_of_stock → answer_stock_status, no checkout action", () => {
  const r = resolveEcommerceLinks({
    latestCustomerMessage: "Har I A-Rise på lager?",
    facts: [stockFact("out_of_stock")],
  });
  assertEquals(r.primary_strategy, "answer_stock_status");
  assert(!r.decisions.some((d) => d.kind === "proposed_action"));
});

Deno.test("4. checkout-link + prior office stock + out_of_stock → proposed create_checkout_link", () => {
  const r = resolveEcommerceLinks({
    latestCustomerMessage: "Hej Send gerne link til at jeg kan købe A-rise headset :)",
    conversationHistory: [{
      role: "agent",
      text: "Vi har et par stykker liggende her på kontoret, så hvis du ønsker, kan jeg sende dig et check-out link…",
    }],
    facts: [stockFact("out_of_stock")],
    requestedProduct: "A-Rise",
  });
  assertEquals(r.primary_strategy, "continue_manual_checkout_link_flow");
  const action = r.decisions.find((d) => d.kind === "proposed_action");
  assert(action && action.kind === "proposed_action");
  assertEquals(action.action_type, "create_checkout_link");
  assertEquals(action.requires_approval, true);
  assert(action.risk_flags.includes("manual_stock_context"));
  assert(action.risk_flags.includes("shopify_online_out_of_stock"));
});

Deno.test("5. checkout-link + out_of_stock + NO manual context → no create_checkout_link", () => {
  const r = resolveEcommerceLinks({
    latestCustomerMessage: "Kan du sende link til A-Rise?",
    facts: [stockFact("out_of_stock")],
    requestedProduct: "A-Rise",
  });
  assert(!r.decisions.some((d) => d.kind === "proposed_action"));
  assertEquals(r.primary_strategy, "send_public_product_link");
});

Deno.test("6. ambiguous product → ask_missing_info", () => {
  const r = resolveEcommerceLinks({
    latestCustomerMessage: "Send link til headset",
    facts: [],
  });
  const d = r.decisions[0];
  assert(d.kind === "ask_missing_info");
  assert(d.kind === "ask_missing_info" && d.missing === "product");
});

Deno.test("7. no grounded URL → no_safe_action, never a direct_link", () => {
  // No trusted link fact and no chunks → resolver never invents a URL.
  const r = resolveEcommerceLinks({
    latestCustomerMessage: "Send link til A-Rise",
    facts: [],
    productChunks: [],
    publicStorefrontDomain: null,
    requestedProduct: "A-Rise",
  });
  assert(!r.decisions.some((d) => d.kind === "direct_link"));
  const d = r.decisions[0];
  assert(d.kind === "no_safe_action" && d.reason === "no_grounded_public_product_url");
});

Deno.test("8. URL only in customer text / myshopify is NEVER turned into a direct_link", () => {
  // The resolver only reads URLs from the trusted link fact or synced chunks —
  // never from the customer message. A myshopify URL pasted by the customer
  // (and a myshopify-only chunk) must not produce a customer-facing link.
  const r = resolveEcommerceLinks({
    latestCustomerMessage: "køb A-Rise her https://shop-acezone.myshopify.com/products/a-rise",
    facts: [],
    productChunks: [{
      source_provider: "shopify_product",
      source_title: "A-Rise",
      product_url: "https://shop-acezone.myshopify.com/products/a-rise",
    }],
    publicStorefrontDomain: null, // no public domain → cannot rebuild
    requestedProduct: "A-Rise",
  });
  assert(!r.decisions.some((d) => d.kind === "direct_link"));
});

Deno.test("9. non-ecommerce message → primary_strategy none, no decisions", () => {
  const r = resolveEcommerceLinks({
    latestCustomerMessage: "Tak for hjælpen!",
    facts: [],
  });
  assertEquals(r.primary_strategy, "none");
  assertEquals(r.decisions.length, 0);
});

// FUTURE (not yet supported — documented, not faked):
// - return_portal / tracking / policy / support_article / size_guide / warranty
//   direct links require store-config fields and tracking-fact plumbing that do
//   not exist yet. They are intentionally NOT emitted in Phase 0.
Deno.test("future: return_portal/tracking/policy links are not emitted yet", () => {
  const r = resolveEcommerceLinks({
    latestCustomerMessage: "Send link til retur",
    facts: [],
  });
  assert(!r.decisions.some((d) =>
    d.kind === "direct_link" &&
    (d.link_type === "return_portal" || d.link_type === "tracking" ||
      d.link_type === "policy")
  ));
});
