// supabase/functions/generate-draft-v2/stages/ecommerce-link-resolver.ts
//
// Phase 0 — ADVISORY ecommerce link/action resolver.
//
// Makes Sona's *implicit* ecommerce strategy explicit as a typed, testable
// decision. PURE and READ-ONLY: it performs NO live Shopify calls, NO Supabase
// queries, NO mutations, and produces NO side effects. It only classifies
// already-resolved inputs (facts, retrieved chunks, prior-support context).
//
// Phase 0 is debug/advisory only: the writer does NOT consume it and
// action-decision does NOT execute anything new from it. It reproduces today's
// product-page-link / stock / manual-checkout-link behavior so we can observe
// the strategy before wiring it into draft generation (Phase 1+).
import type { ResolvedFact } from "./fact-resolver.ts";
import { isStockAvailabilityQuestion } from "./fact-resolver.ts";
import {
  detectManualCheckoutLinkFlow,
  firstTrustedProductLink,
  isAmbiguousProductRequest,
  isPurchaseLinkRequest,
  type ProductSourceChunk,
  selectGroundedProductLinkFromChunks,
} from "./purchase-link.ts";

export type DirectLinkType =
  | "product_page"
  | "return_portal"
  | "tracking"
  | "policy"
  | "support_article"
  | "size_guide"
  | "warranty";

export type LinkActionType =
  | "create_checkout_link"
  | "create_cart_link"
  | "create_draft_order"
  | "create_return_label"
  | "create_replacement_order"
  | "cancel_order"
  | "refund_order"
  | "change_address";

export type MissingInfo =
  | "product"
  | "variant"
  | "order_number"
  | "customer_email"
  | "quantity"
  | "shipping_country";

export type LinkSource =
  | "live_shopify"
  | "synced_product_metadata"
  | "store_config"
  | "tracking_provider"
  | "knowledge";

export type LinkOrActionDecision =
  | {
    kind: "direct_link";
    link_type: DirectLinkType;
    url: string;
    label: string;
    source: LinkSource;
    safe_to_insert: true;
  }
  | {
    kind: "proposed_action";
    action_type: LinkActionType;
    requires_approval: true;
    params: Record<string, unknown>;
    risk_flags: string[];
  }
  | {
    kind: "ask_missing_info";
    missing: MissingInfo;
    question: string;
  }
  | {
    kind: "no_safe_action";
    reason: string;
    forbidden_claims: string[];
  };

export interface EcommerceResolution {
  decisions: LinkOrActionDecision[];
  primary_strategy: string;
}

export interface EcommerceResolverInput {
  latestCustomerMessage: string | null | undefined;
  conversationHistory?: Array<{ role?: string; text?: string | null }> | null;
  primaryIntent?: string | null;
  facts: ResolvedFact[];
  // Retrieved chunks (already resolved upstream) — used only to read synced
  // product identity for a grounded URL fallback. Never customer text.
  productChunks?: ProductSourceChunk[] | null;
  publicStorefrontDomain?: string | null;
  requestedProduct?: string | null;
}

const STOCK_FACT_LABEL = "Live stock availability";

function stockStateFromFacts(facts: ResolvedFact[]): string | null {
  const fact = facts.find((f) => f.label === STOCK_FACT_LABEL);
  if (!fact) return null;
  return /(?:^|;\s*)state=([^;]+)/.exec(fact.value)?.[1]?.trim() ?? null;
}

// Resolve a safe, grounded public product-page URL + its source. ONLY accepts
// URLs produced upstream by the trusted-link fact (live Shopify handle) or the
// synced shopify_product metadata rebuilt on the public storefront domain.
// Never customer text, never myshopify (enforced by buildTrustedProductUrl).
function groundedProductLink(
  input: EcommerceResolverInput,
): { url: string; source: LinkSource } | null {
  const fromFact = firstTrustedProductLink(input.facts);
  if (fromFact) return { url: fromFact, source: "live_shopify" };
  const fromChunks = selectGroundedProductLinkFromChunks({
    requestedProduct: input.requestedProduct,
    chunks: input.productChunks ?? [],
    publicStorefrontDomain: input.publicStorefrontDomain,
  });
  if (fromChunks) return { url: fromChunks.url, source: "synced_product_metadata" };
  return null;
}

const NO_FABRICATION_FORBIDDEN = [
  "fabricated product or checkout URL",
  "myshopify.com customer-facing URL",
  "claiming a checkout link was created without an executed action",
];

// Advisory classification of the ecommerce link/action strategy. Pure.
export function resolveEcommerceLinks(
  input: EcommerceResolverInput,
): EcommerceResolution {
  const message = input.latestCustomerMessage ?? "";
  const purchaseLink = isPurchaseLinkRequest(message);
  const stockQuestion = isStockAvailabilityQuestion(message);
  const ambiguous = isAmbiguousProductRequest(message);
  const manualFlow = detectManualCheckoutLinkFlow({
    latestCustomerMessage: message,
    conversationHistory: input.conversationHistory ?? [],
  });
  const stockState = stockStateFromFacts(input.facts);
  const link = groundedProductLink(input);

  const productLinkDecision = (): LinkOrActionDecision | null =>
    link
      ? {
        kind: "direct_link",
        link_type: "product_page",
        url: link.url,
        label: input.requestedProduct
          ? `Produktside: ${input.requestedProduct}`
          : "Produktside",
        source: link.source,
        safe_to_insert: true,
      }
      : null;

  // 1) Manual checkout-link flow — prior support offered a manual/office-stock
  //    checkout link and the customer is accepting/requesting it. Advisory:
  //    propose create_checkout_link (requires approval); do NOT create one.
  if (manualFlow) {
    const risk_flags = ["manual_stock_context"];
    if (stockState === "out_of_stock") risk_flags.push("shopify_online_out_of_stock");
    const decisions: LinkOrActionDecision[] = [{
      kind: "proposed_action",
      action_type: "create_checkout_link",
      requires_approval: true,
      params: { product: input.requestedProduct ?? null },
      risk_flags,
    }];
    const pld = productLinkDecision();
    if (pld) decisions.push(pld);
    return { decisions, primary_strategy: "continue_manual_checkout_link_flow" };
  }

  // 2) Purchase-link / where-to-buy request (no manual context).
  if (purchaseLink) {
    if (ambiguous) {
      return {
        primary_strategy: "ask_clarifying_question",
        decisions: [{
          kind: "ask_missing_info",
          missing: "product",
          question: "Hvilket produkt/model drejer det sig om?",
        }],
      };
    }
    const pld = productLinkDecision();
    if (pld) {
      return { primary_strategy: "send_public_product_link", decisions: [pld] };
    }
    return {
      primary_strategy: "send_public_product_link",
      decisions: [{
        kind: "no_safe_action",
        reason: "no_grounded_public_product_url",
        forbidden_claims: NO_FABRICATION_FORBIDDEN,
      }],
    };
  }

  // 3) Stock question — stock answer is primary; a grounded product link may be
  //    offered as a secondary pointer. Never a checkout action.
  if (stockQuestion) {
    const decisions: LinkOrActionDecision[] = [];
    const pld = productLinkDecision();
    if (pld) decisions.push(pld);
    return { primary_strategy: "answer_stock_status", decisions };
  }

  // 4) Nothing ecommerce-link/action specific detected.
  return { primary_strategy: "none", decisions: [] };
}
