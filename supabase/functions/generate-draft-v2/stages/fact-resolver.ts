// supabase/functions/generate-draft-v2/stages/fact-resolver.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { Plan } from "./planner.ts";
import { CaseState } from "./case-state-updater.ts";
import {
  createCommerceProvider,
} from "../../_shared/integrations/commerce/index.ts";
import type { Order, StockAvailabilityFact, StockState } from "../../_shared/integrations/commerce/types.ts";
import type { ShopifyProductInventoryLookupDiagnostics } from "../../_shared/integrations/commerce/shopify-provider.ts";
import { fetchTrackingDetailsForOrders, resolveOutboundTrackingFacts } from "../../_shared/tracking.ts";
import type { TrackingFact } from "../../_shared/tracking/normalized-tracking.ts";
import { decryptShopifyToken } from "../../_shared/shopify-credentials.ts";
import {
  derivePurchaseProductCandidate,
  isPurchaseLinkRequest,
  resolvePublicStorefrontDomain,
  selectGroundedProductLink,
  TRUSTED_PRODUCT_LINK_LABEL,
} from "./purchase-link.ts";

export interface ResolvedFact {
  label: string;
  value: string;
}

const STOCK_FACT_LABEL = "Live stock availability";

function normalizeStockMatchText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isStockAvailabilityQuestion(message: string | null | undefined): boolean {
  const text = String(message ?? "").toLowerCase();
  // Note: "can i buy" / "kan jeg købe" are intentionally NOT stock signals —
  // they are purchase-link / where-to-buy intent (see purchase-link.ts) and
  // must not fall through to the "cannot confirm stock" fallback.
  return /\b(?:in stock|available|availability|do you have|back in stock|restock|preorder|pre-order|på lager|tilgængelig|har i|forudbestil)\b/i
    .test(text);
}

function cleanStockProductCandidate(value: string): string {
  return value
    .replace(/[?.!,;:]+$/g, "")
    .replace(/^(?:the|a|an|this|that)\s+/i, "")
    .replace(/\s+(?:right now|now|today|currently)$/i, "")
    .trim();
}

export function deriveStockProductCandidate(
  latestCustomerMessage: string | null | undefined,
): string | null {
  const message = String(latestCustomerMessage ?? "").trim();
  if (!isStockAvailabilityQuestion(message)) return null;

  const variantOnly =
    /\b(?:black|white|red|blue|green|grey|gray|version|variant|color|colour|farve|sort|hvid)\b/i
      .test(message) &&
    !/\b(?:a-spire|aspire|a-blaze|ablaze|a-rise|arise|ear pads?|dongle|sound card|iem|a-live|alive)\b/i
      .test(message);
  if (variantOnly) return null;

  const patterns = [
    /\b(?:is|are)\s+(.+?)\s+(?:in stock|available)\b/i,
    /\bdo you have\s+(.+?)(?:\s+(?:available|in stock))?\??$/i,
    /\bwhen will\s+(.+?)\s+be\s+back\s+in\s+stock\b/i,
    /\bcan i buy\s+(.+?)\??$/i,
    /\bhar i\s+(.+?)(?:\s+(?:på lager|tilgængelig))?\??$/i,
    /\b(?:er|findes)\s+(.+?)\s+(?:på lager|tilgængelig)\b/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    const candidate = cleanStockProductCandidate(match?.[1] ?? "");
    if (candidate && normalizeStockMatchText(candidate).split(" ").length <= 8) {
      return candidate;
    }
  }
  return null;
}

export function stockProductQueriesForFactResolver(input: {
  plan: Plan;
  caseState: CaseState;
  latestCustomerMessage?: string | null;
}): string[] {
  if (input.plan.primary_intent !== "product_question") return [];
  const latestCustomerMessage = String(input.latestCustomerMessage ?? "");
  if (
    !isStockAvailabilityQuestion(latestCustomerMessage) &&
    !isPurchaseLinkRequest(latestCustomerMessage)
  ) {
    return [];
  }
  if (input.caseState.entities.products_mentioned.length > 0) {
    return [...new Set(input.caseState.entities.products_mentioned.map((p) => p.trim()).filter(Boolean))];
  }
  const stockFallback = deriveStockProductCandidate(latestCustomerMessage);
  if (stockFallback) return [stockFallback];
  // Purchase-link / where-to-buy intent still needs a product lookup so we can
  // ground a trusted product-page URL from the matched product's handle.
  const purchaseFallback = derivePurchaseProductCandidate(
    latestCustomerMessage,
  );
  return purchaseFallback ? [purchaseFallback] : [];
}

export async function resolveStockAvailabilityFactsForQueries(
  queries: string[],
  lookup: (query: string) => Promise<StockAvailabilityFact[]>,
): Promise<ResolvedFact[]> {
  const facts: ResolvedFact[] = [];
  for (const product of queries.slice(0, 3)) {
    const results = await lookup(product);
    facts.push(...summarizeStockAvailability(product, results));
  }
  return facts;
}

export interface StockLookupDebug {
  stock_lookup_intent: {
    primary_intent: string;
    considered_stock_question: boolean;
  };
  stock_lookup_entities: {
    products_mentioned: string[];
    fallback_product_candidate: string | null;
    latest_body_used: string;
  };
  attempts: Array<{
    stock_lookup_attempt: {
      attempted: boolean;
      query: string;
    };
    shopify_lookup_result?: ShopifyProductInventoryLookupDiagnostics;
    stock_mapping_result?: {
      product_statuses: string[];
      published_at_present: boolean;
      variant_count: number;
      mixed_variants: boolean;
      inventory_management_summary: string[];
      inventory_policy_summary: string[];
      mapped_states: string[];
      clarification_required: boolean;
      unknown_reasons: string[];
    };
    stock_fact_result: {
      emitted: boolean;
      fact_label: string | null;
      stock_state: string | null;
      writer_received: boolean;
    };
  }>;
  // Shop-resolution diagnostics: which shop the live lookup actually ran
  // against, and whether the read-only workspace-scoped Shopify fallback (the
  // same selection strategy Knowledge product-sync uses) had to be attempted
  // because the mailbox-bound shop was missing/non-Shopify/tokenless or
  // returned zero products. Present only on the inventory path.
  shop_resolution?: {
    primary_shop_id: string | null;
    primary_shop_domain: string | null;
    fallback_shop_attempted: boolean;
    fallback_shop_id: string | null;
    fallback_shop_domain: string | null;
    fallback_reason: string | null;
    fallback_lookup_result: "products_found" | "zero_products" | "no_shop_found" | "error" | null;
    primary_and_fallback_differ: boolean;
  };
}

type StockInventoryLookupWithDiagnostics = {
  searchProductInventoryWithDiagnostics(
    query: string,
  ): Promise<{
    facts: StockAvailabilityFact[];
    diagnostics?: ShopifyProductInventoryLookupDiagnostics;
  }>;
};

function hasStockInventoryLookupDiagnostics(
  provider: unknown,
): provider is StockInventoryLookupWithDiagnostics {
  return Boolean(
    provider &&
      typeof provider === "object" &&
      "searchProductInventoryWithDiagnostics" in provider &&
      typeof (provider as Record<string, unknown>).searchProductInventoryWithDiagnostics ===
        "function",
  );
}

function stockStateFromResolvedFact(fact: ResolvedFact | undefined): string | null {
  if (!fact) return null;
  return /(?:^|;\s*)state=([^;]+)/.exec(fact.value)?.[1] ?? null;
}

function stockMappingDiagnostics(
  rawFacts: StockAvailabilityFact[],
  resolvedFacts: ResolvedFact[],
): StockLookupDebug["attempts"][number]["stock_mapping_result"] {
  const states = [...new Set(rawFacts.map((fact) => fact.state).filter(Boolean))];
  const productStatuses = [...new Set(rawFacts.map((fact) => fact.product_status ?? "null"))];
  const inventoryManagement = [
    ...new Set(rawFacts.map((fact) => fact.inventory_management ?? "null")),
  ];
  const inventoryPolicies = [
    ...new Set(rawFacts.map((fact) => fact.inventory_policy ?? "null")),
  ];
  const resolvedState = stockStateFromResolvedFact(resolvedFacts[0]);
  const unknownReasons = resolvedFacts
    .map((fact) => /(?:^|;\s*)reason=([^;]+)/.exec(fact.value)?.[1] ?? null)
    .filter((reason): reason is string => Boolean(reason));
  return {
    product_statuses: productStatuses,
    published_at_present: rawFacts.some((fact) => Boolean(fact.published_at)),
    variant_count: rawFacts.length,
    mixed_variants: states.length > 1,
    inventory_management_summary: inventoryManagement,
    inventory_policy_summary: inventoryPolicies,
    mapped_states: resolvedState ? [resolvedState] : states,
    clarification_required: resolvedState === "variant_clarification_required",
    unknown_reasons: unknownReasons,
  };
}

export async function resolveStockAvailabilityFactsWithDiagnostics(
  input: {
    plan: Plan;
    caseState: CaseState;
    latestCustomerMessage?: string | null;
    queries: string[];
    lookup: (query: string) => Promise<
      | StockAvailabilityFact[]
      | {
        facts: StockAvailabilityFact[];
        diagnostics?: ShopifyProductInventoryLookupDiagnostics;
      }
    >;
  },
): Promise<{ facts: ResolvedFact[]; diagnostics: StockLookupDebug }> {
  const latestBody = String(input.latestCustomerMessage ?? "");
  const fallbackProductCandidate =
    input.caseState.entities.products_mentioned.length > 0
      ? null
      : deriveStockProductCandidate(latestBody);
  const diagnostics: StockLookupDebug = {
    stock_lookup_intent: {
      primary_intent: input.plan.primary_intent,
      considered_stock_question: isStockAvailabilityQuestion(latestBody),
    },
    stock_lookup_entities: {
      products_mentioned: [...input.caseState.entities.products_mentioned],
      fallback_product_candidate: fallbackProductCandidate,
      latest_body_used: latestBody,
    },
    attempts: [],
  };
  const facts: ResolvedFact[] = [];

  for (const query of input.queries.slice(0, 3)) {
    const lookupResult = await input.lookup(query);
    const rawFacts = Array.isArray(lookupResult) ? lookupResult : lookupResult.facts;
    const resolvedFacts = summarizeStockAvailability(query, rawFacts);
    facts.push(...resolvedFacts);
    diagnostics.attempts.push({
      stock_lookup_attempt: {
        attempted: true,
        query,
      },
      ...(Array.isArray(lookupResult) || !lookupResult.diagnostics
        ? {}
        : { shopify_lookup_result: lookupResult.diagnostics }),
      stock_mapping_result: stockMappingDiagnostics(rawFacts, resolvedFacts),
      stock_fact_result: {
        emitted: resolvedFacts.some((fact) => fact.label === STOCK_FACT_LABEL),
        fact_label: resolvedFacts[0]?.label ?? null,
        stock_state: stockStateFromResolvedFact(resolvedFacts[0]),
        writer_received: resolvedFacts.some((fact) => fact.label === STOCK_FACT_LABEL),
      },
    });
  }

  return { facts, diagnostics };
}

function isDefaultVariantTitle(title: string | null | undefined): boolean {
  return normalizeStockMatchText(title) === "default title";
}

function stockFactValue(fields: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value).replace(/[;\n]/g, " ").trim()}`)
    .join("; ");
}

function pickProductFacts(
  query: string,
  facts: StockAvailabilityFact[],
): { selected: StockAvailabilityFact[]; reason: string | null } {
  const byProduct = new Map<string, StockAvailabilityFact[]>();
  for (const fact of facts) {
    if (!fact.product_id) continue;
    const current = byProduct.get(fact.product_id) ?? [];
    current.push(fact);
    byProduct.set(fact.product_id, current);
  }
  const products = [...byProduct.values()];
  if (products.length === 0) return { selected: [], reason: "not_found" };
  if (products.length === 1) return { selected: products[0], reason: null };

  const normalizedQuery = normalizeStockMatchText(query);
  const exact = products.filter((group) =>
    normalizeStockMatchText(group[0]?.product_title) === normalizedQuery
  );
  if (exact.length === 1) return { selected: exact[0], reason: null };
  return { selected: [], reason: "ambiguous_product" };
}

function statePriority(state: StockState): number {
  switch (state) {
    case "in_stock":
      return 1;
    case "out_of_stock":
      return 2;
    case "unavailable":
      return 3;
    case "discontinued":
      return 4;
    case "low_stock":
      return 5;
    case "preorder":
      return 6;
    case "unknown":
    default:
      return 7;
  }
}

export function summarizeStockAvailability(
  query: string,
  rawFacts: StockAvailabilityFact[],
): ResolvedFact[] {
  const { selected, reason } = pickProductFacts(query, rawFacts);
  if (reason || selected.length === 0) {
    return [{
      label: STOCK_FACT_LABEL,
      value: stockFactValue({
        state: "unknown",
        product_query: query,
        reason: reason ?? "not_found",
        source: "shopify_live",
      }),
    }];
  }

  const product = selected[0];
  const normalizedQuery = normalizeStockMatchText(query);
  const variantMatches = selected.filter((fact) =>
    fact.variant_title &&
    !isDefaultVariantTitle(fact.variant_title) &&
    normalizedQuery.includes(normalizeStockMatchText(fact.variant_title))
  );
  const factsForSummary = variantMatches.length > 0 ? variantMatches : selected;
  if (factsForSummary.length === 1) {
    const fact = factsForSummary[0];
    return [{
      label: STOCK_FACT_LABEL,
      value: stockFactValue({
        state: fact.state,
        product_id: fact.product_id,
        product: fact.product_title,
        handle: fact.product_handle ?? null,
        variant_id: fact.variant_id,
        variant: isDefaultVariantTitle(fact.variant_title) ? "default" : fact.variant_title,
        inventory_policy: fact.inventory_policy,
        inventory_management: fact.inventory_management,
        product_status: fact.product_status,
        published: Boolean(fact.published_at),
        source: fact.source,
        checked_at: fact.checked_at,
        exact_quantity_hidden: true,
      }),
    }];
  }

  const states = new Set(factsForSummary.map((fact) => fact.state));
  if (states.size === 1) {
    const state = factsForSummary[0].state;
    return [{
      label: STOCK_FACT_LABEL,
      value: stockFactValue({
        state,
        product_id: product.product_id,
        product: product.product_title,
        handle: product.product_handle ?? null,
        variant: "all_variants",
        source: product.source,
        checked_at: product.checked_at,
        exact_quantity_hidden: true,
      }),
    }];
  }

  const visibleStates = [...states].sort((a, b) => statePriority(a) - statePriority(b));
  return [{
    label: STOCK_FACT_LABEL,
    value: stockFactValue({
      state: "variant_clarification_required",
      product_id: product.product_id,
      product: product.product_title,
      variants: factsForSummary
        .map((fact) => fact.variant_title)
        .filter((title) => title && !isDefaultVariantTitle(title))
        .join("|"),
      variant_states: visibleStates.join("|"),
      reason: "mixed_variant_availability",
      source: product.source,
      checked_at: product.checked_at,
    }),
  }];
}

// Order-match confidence — additive, read-only. Lets the writer and the action
// layer reason about HOW the order was identified without re-parsing prose.
export type OrderMatchState =
  | "exact_order_number" // getOrderByName returned a confirmed order
  | "single_email_match" // no #, email fallback returned exactly one order
  | "multiple_email_matches" // no #, email fallback returned >1 (never auto-pick)
  | "order_not_found" // lookup SUCCEEDED, zero matches
  | "integration_error" // a lookup threw / timed out / creds missing / decrypt failed
  | "missing_identifiers"; // no order number AND no usable email to look up

export interface OrderMatch {
  state: OrderMatchState;
  candidate_count: number;
  had_order_number: boolean;
  had_email: boolean;
  // Set ONLY for exact_order_number / single_email_match; null otherwise.
  // Never the full candidate list — avoids exposing unrelated orders.
  selected_order_name: string | null;
}

// Refund-status — derived deterministically from the order's mapped refunds[]
// (already present in the live Shopify payload). Read-only; never asserts
// timing/return-receipt the data does not support.
export type RefundStatusState =
  | "no_refund_issued"
  | "full_refund_issued"
  | "partial_refund_issued"
  | "refund_pending_or_unclear";

export interface RefundStatus {
  state: RefundStatusState;
  total_refunded: string | null;
  currency: string | null;
  last_refund_at: string | null;
  order_total: string | null;
  refund_count: number;
}

function isSuccessfulRefundTxn(t: {
  kind?: string;
  status?: string;
  processed_at?: string | null;
}): boolean {
  const kind = String(t.kind ?? "refund").toLowerCase();
  if (kind !== "refund") return false; // ignore non-refund txns (e.g. "sale")
  const status = String(t.status ?? "").toLowerCase();
  // Explicitly exclude not-yet-issued / failed states.
  if (["pending", "failure", "error", "voided"].includes(status)) return false;
  if (status === "success") return true;
  // Unknown/empty status only counts if Shopify marked it processed.
  return Boolean(t.processed_at);
}

// Derives a safe refund-status from a FOUND order. Never called on
// integration_error / not-found paths, so a lookup failure can never become
// "no_refund_issued".
export function deriveRefundStatus(order: Order): RefundStatus {
  const orderCurrency = String(order.currency ?? "").trim() || null;
  const orderTotal = String(order.total_price ?? "").trim() || null;
  const base = {
    currency: orderCurrency,
    order_total: orderTotal,
  };

  // Distinguish "looked up, none present" ([]) from "unknown" (undefined).
  if (order.refunds === undefined) {
    return {
      ...base,
      state: "refund_pending_or_unclear",
      total_refunded: null,
      last_refund_at: null,
      refund_count: 0,
    };
  }
  const refunds = order.refunds;
  if (refunds.length === 0) {
    return {
      ...base,
      state: "no_refund_issued",
      total_refunded: "0.00",
      last_refund_at: null,
      refund_count: 0,
    };
  }

  const txns = refunds.flatMap((r) => r.transactions ?? []);
  const successful = txns.filter(isSuccessfulRefundTxn);
  if (successful.length === 0) {
    // Objects exist but nothing successfully issued (pending/failed/malformed).
    return {
      ...base,
      state: "refund_pending_or_unclear",
      total_refunded: null,
      last_refund_at: null,
      refund_count: refunds.length,
    };
  }

  // Currency safety: every successful txn must share the order's currency.
  const currencies = new Set(
    successful.map((t) => String(t.currency ?? orderCurrency ?? "").trim().toUpperCase()).filter(Boolean),
  );
  const unsafeCurrency = currencies.size !== 1 ||
    (orderCurrency ? !currencies.has(orderCurrency.toUpperCase()) : true);

  // Amount safety: every successful amount must parse.
  const amounts = successful.map((t) => Number(t.amount));
  const amountsValid = amounts.every((n) => Number.isFinite(n));
  const total = amountsValid ? amounts.reduce((a, b) => a + b, 0) : NaN;
  const orderTotalNum = Number(orderTotal);

  const lastRefundAt = pickLastTimestamp(refunds, successful);

  if (unsafeCurrency || !amountsValid || !Number.isFinite(orderTotalNum) || total <= 0) {
    return {
      ...base,
      state: "refund_pending_or_unclear",
      total_refunded: null,
      last_refund_at: lastRefundAt,
      refund_count: refunds.length,
    };
  }

  const totalStr = total.toFixed(2);
  const EPS = 0.01;
  const state: RefundStatusState = total >= orderTotalNum - EPS
    ? "full_refund_issued"
    : "partial_refund_issued";
  return {
    ...base,
    state,
    total_refunded: totalStr,
    last_refund_at: lastRefundAt,
    refund_count: refunds.length,
  };
}

// Builds the deterministic, writer-facing refund instruction fact. Carries the
// verified amount/timestamp only for issued states; never fabricates timing or
// return-receipt.
function buildRefundStatusFact(s: RefundStatus): ResolvedFact {
  const amount = s.total_refunded && s.currency
    ? `${s.total_refunded} ${s.currency}`
    : s.total_refunded ?? "";
  const when = s.last_refund_at
    ? formatRefundDate(s.last_refund_at)
    : "";
  switch (s.state) {
    case "no_refund_issued":
      return {
        label: "Refunderingsstatus: ingen refundering udstedt",
        value:
          `Der er IKKE registreret en refundering på ordren. Sig ikke at en refundering er udstedt, og opfind ikke en returstatus. ` +
          `Hvis kunden siger de allerede har returneret varen, så antag ikke at returneringen er modtaget — bed om bekræftelse eller rut til gennemgang.`,
      };
    case "full_refund_issued":
      return {
        label: "Refunderingsstatus: fuld refundering udstedt",
        value:
          `Hele beløbet ER refunderet${amount ? ` (${amount})` : ""}${when ? ` den ${when}` : ""} til den oprindelige betalingsmetode. ` +
          `Lov IKKE en konkret bankbehandlingstid (fx antal dage) medmindre verificeret politik angiver den; brug i stedet: ` +
          `"Refunderingen er udstedt. Hvor lang tid det tager før beløbet vises på din konto kan afhænge af din betalingsudbyder."`,
      };
    case "partial_refund_issued":
      return {
        label: "Refunderingsstatus: delvis refundering udstedt",
        value:
          `En DELVIS refundering ER udstedt${amount ? ` (${amount})` : ""}${when ? ` den ${when}` : ""}${s.order_total ? ` af ordretotalen ${s.order_total} ${s.currency ?? ""}`.trimEnd() : ""}. ` +
          `Antyd IKKE at restbeløbet automatisk bliver refunderet. ` +
          `Lov ikke en konkret bankbehandlingstid medmindre verificeret politik angiver den; sig at tiden før beløbet vises kan afhænge af kundens betalingsudbyder.`,
      };
    case "refund_pending_or_unclear":
    default:
      return {
        label: "Refunderingsstatus: skal gennemgås",
        value:
          `Refunderingsstatus kan ikke fastslås sikkert og skal gennemgås nærmere. ` +
          `Opfind ikke et beløb eller en dato, claim ikke at returneringen er modtaget, og lov ikke hvornår pengene ankommer.`,
      };
  }
}

function formatRefundDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("da-DK", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Copenhagen",
  });
}

function pickLastTimestamp(
  refunds: Array<{ processed_at?: string | null; created_at?: string | null }>,
  txns: Array<{ processed_at?: string | null; created_at?: string | null }>,
): string | null {
  const candidates = [
    ...txns.map((t) => t.processed_at ?? t.created_at),
    ...refunds.map((r) => r.processed_at ?? r.created_at),
  ].filter((x): x is string => Boolean(x));
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (new Date(b) > new Date(a) ? b : a));
}

export interface FactResolverResult {
  facts: ResolvedFact[];
  order?: Order | null;
  stock_lookup_debug?: StockLookupDebug;
  // Always populated by runFactResolver. Optional in the type so legacy callers
  // / fixtures that omit it still typecheck; consumers default to a safe state.
  match?: OrderMatch;
  // Normalized read-only tracking facts (outbound by default; the pipeline may
  // replace with a customer-provided return fact). Optional/additive.
  tracking_facts?: TrackingFact[];
}

// Minimal provider surface the order-match resolver needs — a subset of
// CommerceProvider so it stays unit-testable with a fake (no network).
export interface OrderLookupProvider {
  getOrderByName(name: string): Promise<Order | null>;
  listOrdersByEmail(email: string, limit?: number): Promise<Order[]>;
}

export interface OrderResolution {
  order: Order | null;
  match: OrderMatch;
}

// Pure orchestration of the order-match state machine. Safety rules:
//  - An explicit order number takes precedence and NEVER silently falls back to
//    email (a wrong-order email match would be unsafe).
//  - A thrown/failed lookup yields integration_error, never order_not_found.
//  - Multiple email matches are never auto-selected.
export async function resolveOrderMatch(opts: {
  provider: OrderLookupProvider;
  orderNumbers: string[];
  customerEmail: string;
  emailMatchLimit?: number;
}): Promise<OrderResolution> {
  const orderNumbers = Array.isArray(opts.orderNumbers) ? opts.orderNumbers : [];
  const customerEmail = String(opts.customerEmail || "").trim();
  const hadOrderNumber = orderNumbers.length > 0;
  const hadEmail = customerEmail.length > 0;

  const base = {
    had_order_number: hadOrderNumber,
    had_email: hadEmail,
  };

  if (!hadOrderNumber && !hadEmail) {
    return {
      order: null,
      match: {
        ...base,
        state: "missing_identifiers",
        candidate_count: 0,
        selected_order_name: null,
      },
    };
  }

  // 1. Explicit order number takes precedence — no email fallback on failure.
  if (hadOrderNumber) {
    let threw = false;
    for (const raw of orderNumbers) {
      try {
        const found = await opts.provider.getOrderByName(raw);
        if (found) {
          return {
            order: found,
            match: {
              ...base,
              state: "exact_order_number",
              candidate_count: 1,
              selected_order_name: found.name,
            },
          };
        }
      } catch (_err) {
        threw = true;
      }
    }
    return {
      order: null,
      match: {
        ...base,
        state: threw ? "integration_error" : "order_not_found",
        candidate_count: 0,
        selected_order_name: null,
      },
    };
  }

  // 2. Email fallback — only when no explicit order number was provided.
  try {
    const orders = await opts.provider.listOrdersByEmail(
      customerEmail,
      opts.emailMatchLimit ?? 5,
    );
    if (!Array.isArray(orders) || orders.length === 0) {
      return {
        order: null,
        match: {
          ...base,
          state: "order_not_found",
          candidate_count: 0,
          selected_order_name: null,
        },
      };
    }
    if (orders.length === 1) {
      return {
        order: orders[0],
        match: {
          ...base,
          state: "single_email_match",
          candidate_count: 1,
          selected_order_name: orders[0].name,
        },
      };
    }
    // >1 — never silently select; expose only the count.
    return {
      order: null,
      match: {
        ...base,
        state: "multiple_email_matches",
        candidate_count: orders.length,
        selected_order_name: null,
      },
    };
  } catch (_err) {
    return {
      order: null,
      match: {
        ...base,
        state: "integration_error",
        candidate_count: 0,
        selected_order_name: null,
      },
    };
  }
}

function integrationErrorMatch(
  hadOrderNumber: boolean,
  hadEmail: boolean,
): OrderMatch {
  return {
    state: "integration_error",
    candidate_count: 0,
    had_order_number: hadOrderNumber,
    had_email: hadEmail,
    selected_order_name: null,
  };
}

export interface FactResolverInput {
  plan: Plan;
  caseState: CaseState;
  thread: Record<string, unknown>;
  shop: Record<string, unknown>;
  supabase: SupabaseClient;
  customerContext?: Record<string, unknown> | null;
  latestCustomerMessage?: string | null;
}

// Resolve the shipping country from a Shopify address, tolerating both the full
// country name and the ISO code field (REST `country_code`, GraphQL
// `countryCode`/`countryCodeV2`). Prefer the full name; fall back to the code so
// the return-address selector still has a country signal when Shopify omits the
// name. Pure; the selector normalises "US"/"United States" equivalently.
export function shippingCountrySignal(
  shipping: Record<string, unknown> | null | undefined,
): string {
  const s = (shipping ?? {}) as Record<string, unknown>;
  for (const key of ["country", "countryCode", "country_code", "countryCodeV2"]) {
    const v = String(s[key] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function orderFromCustomerContext(
  customerContext?: Record<string, unknown> | null,
): Order | null {
  const orders = customerContext?.orders;
  if (!Array.isArray(orders) || orders.length === 0) return null;

  const raw = orders[0] as Record<string, unknown>;
  const displayId = String(raw.id ?? raw.order_number ?? raw.name ?? "").trim();
  if (!displayId) return null;

  const shipping =
    (raw.shippingAddress ?? raw.shipping_address ?? {}) as Record<
      string,
      unknown
    >;
  const tracking = (raw.tracking ?? {}) as Record<string, unknown>;
  const items = Array.isArray(raw.items) ? raw.items : [];
  const financialStatus = String(
    raw.financialStatus ?? raw.financial_status ?? "",
  )
    .toLowerCase();
  const fulfillmentStatus = String(
    raw.fulfillmentStatus ?? raw.fulfillment_status ?? "",
  ).toLowerCase();

  return {
    id: String(raw.adminId ?? raw.id ?? displayId),
    order_number: displayId.replace(/^#/, ""),
    name: displayId.startsWith("#") ? displayId : `#${displayId}`,
    email: String(
      (customerContext?.customer as Record<string, unknown>)?.email ?? "",
    ),
    financial_status: financialStatus.includes("refund")
      ? "refunded"
      : financialStatus || "paid",
    fulfillment_status: fulfillmentStatus === "fulfilled"
      ? "fulfilled"
      : fulfillmentStatus || null,
    cancelled_at: null,
    closed_at: null,
    created_at: String(
      raw.placedAt ?? raw.created_at ?? new Date().toISOString(),
    ),
    updated_at: String(
      raw.updated_at ?? raw.placedAt ?? new Date().toISOString(),
    ),
    total_price: String(raw.total ?? ""),
    currency: String(raw.currency ?? ""),
    shipping_address: {
      address1: String(shipping.address1 ?? ""),
      address2: String(shipping.address2 ?? ""),
      city: String(shipping.city ?? ""),
      zip: String(shipping.zip ?? ""),
      country: shippingCountrySignal(shipping),
      first_name: String(shipping.name ?? "").split(/\s+/)[0] || undefined,
      last_name: String(shipping.name ?? "").split(/\s+/).slice(1).join(" ") ||
        undefined,
    },
    line_items: items.map((item, index) => ({
      id: String(index),
      title: String(item).replace(/^\d+x\s*/i, ""),
      quantity: Number(String(item).match(/^(\d+)x/i)?.[1] ?? 1),
      price: "",
    })),
    fulfillments: tracking.number
      ? [{
        id: "customer-context-tracking",
        status: "success",
        tracking_number: String(tracking.number),
        tracking_url: tracking.url ? String(tracking.url) : undefined,
        tracking_company: tracking.company
          ? String(tracking.company)
          : undefined,
      }]
      : [],
  };
}

// True when a live lookup actually matched at least one product. Drives the
// read-only fallback: a mailbox-bound shop that returns zero products (or
// errors) is treated as "no usable result" so we can retry against the
// workspace's Shopify shop — but a matched product with unknown stock (e.g.
// missing read_inventory) is NOT re-tried, since the fallback would hit the
// same scope limitation.
export function inventoryLookupHadProductMatch(diagnostics: StockLookupDebug): boolean {
  return diagnostics.attempts.some(
    (attempt) => (attempt.shopify_lookup_result?.matched_products?.length ?? 0) > 0,
  );
}

// Pure decision: should the read-only workspace-scoped Shopify fallback be
// attempted, and why? Fallback fires when the mailbox-bound (primary) shop is
// not Shopify, has no token, errored, or returned zero products. A primary that
// matched a product (even with unknown stock) does NOT trigger fallback.
export function decideInventoryFallbackReason(input: {
  primaryIsShopify: boolean;
  primaryHasToken: boolean;
  primaryRan: boolean;
  primaryHadMatch: boolean;
}): string | null {
  if (!input.primaryIsShopify) return "primary_shop_not_shopify";
  if (!input.primaryHasToken) return "primary_shop_missing_token";
  if (!input.primaryRan) return "primary_lookup_error";
  if (!input.primaryHadMatch) return "primary_shopify_returned_zero_products";
  return null;
}

// Read-only resolution of the workspace/owner-scoped, newest active Shopify
// shop — the SAME selection strategy the Knowledge product-sync uses
// (resolveScopedShop platform=shopify) and postmark-inbound's auto-bind. No DB
// writes. Returns a shop row distinct from the primary (by id) that has a
// usable domain + token, or null.
export async function resolveFallbackShopifyShop(
  supabase: SupabaseClient,
  primaryShop: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const workspaceId = (primaryShop.workspace_id as string | null) ?? null;
  const ownerUserId = (primaryShop.owner_user_id as string | null) ?? null;
  const primaryId = (primaryShop.id as string | null) ?? null;
  if (!workspaceId && !ownerUserId) return null;
  try {
    let query = supabase
      .from("shops")
      .select("*")
      .is("uninstalled_at", null)
      .eq("platform", "shopify")
      .order("created_at", { ascending: false })
      .limit(5);
    query = workspaceId
      ? query.eq("workspace_id", workspaceId)
      : query.eq("owner_user_id", ownerUserId);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return null;
    for (const row of data as Array<Record<string, unknown>>) {
      if (primaryId && row.id === primaryId) continue;
      if (row.shop_domain && row.access_token_encrypted) return row;
    }
  } catch (err) {
    console.warn("[fact-resolver] fallback shop resolution failed:", err);
  }
  return null;
}

// Run the live inventory lookup against ONE shop row. Returns the resolved
// facts + diagnostics, whether a product was matched, and a coarse outcome.
// Never writes to the DB. Returns null when the shop is not usable for a live
// Shopify lookup (non-Shopify / tokenless / decrypt failure).
async function runInventoryLookupForShop(
  shopRow: Record<string, unknown>,
  ctx: {
    plan: Plan;
    caseState: CaseState;
    latestCustomerMessage?: string | null;
    queries: string[];
  },
): Promise<
  | {
    facts: ResolvedFact[];
    diagnostics: StockLookupDebug;
    hadMatch: boolean;
    outcome: "products_found" | "zero_products" | "error";
  }
  | null
> {
  const shopDomain = (shopRow.shop_domain as string) ?? null;
  const encryptedToken = (shopRow.access_token_encrypted as string) ?? null;
  if (!shopDomain || !encryptedToken) return null;
  if (shopRow.platform != null && String(shopRow.platform) !== "shopify") return null;
  try {
    const shopifyToken = await decryptShopifyToken(encryptedToken);
    const provider = createCommerceProvider({
      provider_type: "shopify",
      shop_domain: shopDomain,
      access_token: shopifyToken,
      // Match the Knowledge product-sync path (SHOPIFY_API_VERSION default
      // 2024-07) for the product/inventory listing. Order flows are untouched.
      api_version: "2024-07",
    });
    if (typeof provider.searchProductInventory !== "function") return null;
    const lookupWithDiagnostics = hasStockInventoryLookupDiagnostics(provider)
      ? (product: string) => provider.searchProductInventoryWithDiagnostics(product)
      : (product: string) => provider.searchProductInventory(product);
    const resolved = await resolveStockAvailabilityFactsWithDiagnostics({
      plan: ctx.plan,
      caseState: ctx.caseState,
      latestCustomerMessage: ctx.latestCustomerMessage,
      queries: ctx.queries,
      lookup: lookupWithDiagnostics,
    });
    const hadMatch = inventoryLookupHadProductMatch(resolved.diagnostics);
    return {
      facts: resolved.facts,
      diagnostics: resolved.diagnostics,
      hadMatch,
      outcome: hadMatch ? "products_found" : "zero_products",
    };
  } catch (err) {
    console.warn("[fact-resolver] Inventory lookup failed:", err);
    return null;
  }
}

export async function runFactResolver(
  { plan, caseState, thread, shop, supabase, customerContext, latestCustomerMessage }:
    FactResolverInput,
): Promise<FactResolverResult> {
  const facts: ResolvedFact[] = [];

  // Inventory lookup for product_question intent when products are mentioned
  const stockProductQueries = stockProductQueriesForFactResolver({
    plan,
    caseState,
    latestCustomerMessage,
  });
  const stockLookupDebugBase: StockLookupDebug = {
    stock_lookup_intent: {
      primary_intent: plan.primary_intent,
      considered_stock_question: isStockAvailabilityQuestion(latestCustomerMessage),
    },
    stock_lookup_entities: {
      products_mentioned: [...caseState.entities.products_mentioned],
      fallback_product_candidate: caseState.entities.products_mentioned.length > 0
        ? null
        : deriveStockProductCandidate(latestCustomerMessage),
      latest_body_used: String(latestCustomerMessage ?? ""),
    },
    attempts: stockProductQueries.map((query) => ({
      stock_lookup_attempt: {
        attempted: false,
        query,
      },
      stock_fact_result: {
        emitted: false,
        fact_label: null,
        stock_state: null,
        writer_received: false,
      },
    })),
  };
  const needsInventory = plan.primary_intent === "product_question" &&
    stockProductQueries.length > 0;

  const orderRelevantIntents = new Set([
    "tracking",
    "return",
    "refund",
    "exchange",
    "complaint",
    "address_change",
    "cancel",
  ]);
  const needsOrder = orderRelevantIntents.has(plan.primary_intent) ||
    plan.required_facts.some((f) =>
      f === "order_state" || f === "tracking" || f === "return_eligibility"
    );
  if (!needsOrder && !needsInventory) {
    return plan.primary_intent === "product_question"
      ? { facts, order: null, stock_lookup_debug: stockLookupDebugBase }
      : { facts, order: null };
  }

  // --- Inventory lookup (product_question intent) ---
  if (needsInventory && !needsOrder) {
    const s2 = shop as Record<string, unknown>;
    const primaryShopId = (s2.id as string | null) ?? null;
    const primaryShopDomain = (s2.shop_domain as string | null) ?? null;
    const primaryIsShopify = s2.platform == null || String(s2.platform) === "shopify";
    const primaryHasToken = Boolean(s2.access_token_encrypted);

    const lookupCtx = {
      plan,
      caseState,
      latestCustomerMessage,
      queries: stockProductQueries,
    };

    // Primary lookup against the mailbox-bound shop row (unchanged when it works).
    const primary = primaryIsShopify && primaryHasToken
      ? await runInventoryLookupForShop(s2, lookupCtx)
      : null;

    // Decide whether to attempt the read-only workspace-scoped Shopify fallback:
    // primary missing/non-Shopify/tokenless, or it returned zero products.
    const fallbackReason = decideInventoryFallbackReason({
      primaryIsShopify,
      primaryHasToken,
      primaryRan: Boolean(primary),
      primaryHadMatch: Boolean(primary?.hadMatch),
    });

    let chosen = primary;
    const shopResolution: NonNullable<StockLookupDebug["shop_resolution"]> = {
      primary_shop_id: primaryShopId,
      primary_shop_domain: primaryShopDomain,
      fallback_shop_attempted: false,
      fallback_shop_id: null,
      fallback_shop_domain: null,
      fallback_reason: null,
      fallback_lookup_result: null,
      primary_and_fallback_differ: false,
    };
    let publicDomainShop: Record<string, unknown> = s2;

    if (fallbackReason && !(primary?.hadMatch)) {
      shopResolution.fallback_shop_attempted = true;
      shopResolution.fallback_reason = fallbackReason;
      const fallbackShop = await resolveFallbackShopifyShop(supabase, s2);
      if (!fallbackShop) {
        shopResolution.fallback_lookup_result = "no_shop_found";
      } else {
        shopResolution.fallback_shop_id = (fallbackShop.id as string | null) ?? null;
        shopResolution.fallback_shop_domain = (fallbackShop.shop_domain as string | null) ?? null;
        shopResolution.primary_and_fallback_differ = fallbackShop.id !== primaryShopId;
        const fallback = await runInventoryLookupForShop(fallbackShop, lookupCtx);
        if (!fallback) {
          shopResolution.fallback_lookup_result = "error";
        } else {
          shopResolution.fallback_lookup_result = fallback.hadMatch
            ? "products_found"
            : "zero_products";
          // Prefer the fallback result only when it actually matched a product;
          // otherwise keep the primary diagnostics (honest "unknown").
          if (fallback.hadMatch || !primary) {
            chosen = fallback;
            publicDomainShop = fallbackShop;
          }
        }
      }
    }

    const diagnostics: StockLookupDebug = chosen
      ? { ...chosen.diagnostics, shop_resolution: shopResolution }
      : { ...stockLookupDebugBase, shop_resolution: shopResolution };

    if (chosen) {
      facts.push(...chosen.facts);
      // Purchase-link / where-to-buy intent: ground a trusted product-page URL
      // from the matched product's handle + the PUBLIC storefront domain of the
      // shop the lookup actually ran against (never the myshopify Admin host).
      if (isPurchaseLinkRequest(latestCustomerMessage)) {
        const requestedProduct = derivePurchaseProductCandidate(latestCustomerMessage) ??
          stockProductQueries[0] ?? null;
        const grounded = selectGroundedProductLink({
          requestedProduct,
          facts: chosen.facts,
          publicStorefrontDomain: resolvePublicStorefrontDomain(publicDomainShop).domain,
        });
        if (grounded) {
          facts.push({ label: TRUSTED_PRODUCT_LINK_LABEL, value: grounded.url });
        }
      }
    }
    return { facts, order: null, stock_lookup_debug: diagnostics };
  }

  const contextOrder = orderFromCustomerContext(customerContext);
  if (contextOrder) {
    console.log(
      `[fact-resolver] Using customer_context order: ${contextOrder.name}`,
    );
    return buildFactsFromOrder(contextOrder, facts, plan, {
      state: "exact_order_number",
      candidate_count: 1,
      had_order_number: caseState.entities.order_numbers.length > 0,
      had_email: Boolean(caseState.entities.customer_email),
      selected_order_name: contextOrder.name,
    });
  }

  const s = shop as Record<string, unknown>;
  // shops table: shop_domain (plain) + access_token_encrypted (AES-GCM)
  const shopDomain = (s.shop_domain as string) ?? null;
  const encryptedToken = (s.access_token_encrypted as string) ?? null;

  const thread0 = thread as Record<string, unknown>;
  const hadOrderNumberEarly = caseState.entities.order_numbers.length > 0;
  const hadEmailEarly = Boolean(
    caseState.entities.customer_email ||
      (thread0.customer_email as string) ||
      (thread0.from_email as string),
  );

  if (!shopDomain || !encryptedToken) {
    // We cannot verify against Shopify → integration_error (NOT "not found"),
    // so the writer uses safe "unable to verify right now" wording.
    console.warn(
      "[fact-resolver] Missing Shopify credentials (shop_domain or access_token_encrypted) — cannot verify order",
    );
    facts.push(integrationErrorFact());
    return {
      facts,
      order: null,
      match: integrationErrorMatch(hadOrderNumberEarly, hadEmailEarly),
    };
  }

  let shopifyToken: string;
  try {
    shopifyToken = await decryptShopifyToken(encryptedToken);
  } catch (err) {
    console.warn("[fact-resolver] Failed to decrypt Shopify token:", err);
    facts.push(integrationErrorFact());
    return {
      facts,
      order: null,
      match: integrationErrorMatch(hadOrderNumberEarly, hadEmailEarly),
    };
  }

  const provider = createCommerceProvider({
    provider_type: "shopify",
    shop_domain: shopDomain,
    access_token: shopifyToken,
    api_version: "2024-04",
  });

  // Løs kundens email — prioritér fra case_state, thread, besked-afsender
  const thread_ = thread as Record<string, unknown>;
  const customerEmail = caseState.entities.customer_email ||
    (thread_.customer_email as string) ||
    (thread_.from_email as string) ||
    "";

  const orderNumbers = caseState.entities.order_numbers;
  console.log(
    `[fact-resolver] order_numbers=${
      JSON.stringify(orderNumbers)
    } customer_email=${customerEmail} required_facts=${
      JSON.stringify(plan.required_facts)
    }`,
  );

  // Order-match state machine — explicit order number takes precedence and
  // never silently falls back to email; failures become integration_error.
  const { order, match } = await resolveOrderMatch({
    provider,
    orderNumbers,
    customerEmail,
  });

  console.log(
    `[fact-resolver] order_match=${match.state} order=${order?.name ?? "none"} candidates=${match.candidate_count}`,
  );

  if (order) {
    // exact_order_number or single_email_match → safe verified read facts.
    if (match.state === "single_email_match") {
      facts.push({
        label: "Ordre-match (email-fallback)",
        value:
          `Ordren er fundet ud fra kundens email (IKKE et oplyst ordrenummer). ` +
          `Verificerede ordre-/leverings-/tracking-fakta er sikre at oplyse. ` +
          `Foreslå/lov dog ALDRIG refundering, annullering, adresseændring, ombytning eller genfremsendelse, før kunden har bekræftet at det er den rigtige ordre (fx ved ordrenummer).`,
      });
    }
    return buildFactsFromOrder(order, facts, plan, match);
  }

  // No verified order — emit an explicit, state-specific instruction fact so the
  // writer asks/clarifies on a positive signal instead of guessing.
  switch (match.state) {
    case "multiple_email_matches":
      // Expose ONLY a safe count — never line items, addresses or per-order details.
      facts.push({
        label: "Flere ordrer fundet",
        value:
          `Vi fandt ${match.candidate_count} ordrer på kundens email. ` +
          `Vælg ALDRIG en ordre på må og få og gengiv ingen ordre-detaljer. ` +
          `Bed kunden bekræfte det relevante ordrenummer (#xxxx), før du oplyser status eller foreslår handlinger.`,
      });
      break;
    case "integration_error":
      facts.push(integrationErrorFact());
      break;
    case "missing_identifiers":
      facts.push({
        label: "Ingen identifikatorer",
        value:
          `Vi har hverken ordrenummer eller email at slå op på. ` +
          `Bed FØRST om ordrenummer (#xxxx); hvis det ikke haves, bed om den email der blev brugt ved købet. ` +
          `Bekræft intet og lov ingen handling, før en ordre er verificeret.`,
      });
      break;
    case "order_not_found":
    default:
      if (orderNumbers.length > 0) {
        facts.push({
          label: "Ordre IKKE fundet",
          value:
            `Ordrenummer ${orderNumbers.join(", ")} kunne IKKE findes. ` +
            `Bekræft aldrig ordren som eksisterende, og udfør/lov ingen handlinger på den. ` +
            `Forklar venligt at vi ikke kan finde et ordrenummer i det format, og spørg hvor produktet er købt (vores website eller en forhandler/platform) — antag ikke website.`,
        });
      } else {
        facts.push({
          label: "Ingen ordre fundet",
          value:
            `Vi kunne ikke finde en ordre på kundens oplysninger. ` +
            `Bed om ordrenummer (#xxxx), og — ved garanti/defekt/retur — spørg hvor produktet er købt, før du bekræfter noget eller lover en handling.`,
        });
      }
      break;
  }
  return { facts, order: null, match };
}

// Safe, customer-facing-neutral instruction for an integration failure: the
// writer must NOT tell the customer the order cannot be found.
function integrationErrorFact(): ResolvedFact {
  return {
    label: "Ordreopslag midlertidigt utilgængeligt",
    value:
      `Vi kunne IKKE verificere ordren netop nu (teknisk fejl/timeout mod systemet — IKKE bevis for at ordren ikke findes). ` +
      `Sig ALDRIG at ordren ikke kan findes. Brug sikker formulering som "Jeg kan desværre ikke verificere ordredetaljerne i øjeblikket" og at vi vender tilbage/prøver igen. ` +
      `Oplys ingen ordre-/tracking-/refunderings-status og foreslå ingen handlinger.`,
  };
}

// Exported for unit testing (return-eligibility.test.ts).
export async function buildFactsFromOrder(
  order: Order,
  facts: ResolvedFact[],
  plan: Plan,
  match?: OrderMatch,
): Promise<FactResolverResult> {
  let trackingFacts: TrackingFact[] | undefined;
  const fulfillmentStatusDa: Record<string, string> = {
    fulfilled: "Afsendt (alle varer er afsendt)",
    partial: "Delvist afsendt",
    unfulfilled: "Ikke afsendt endnu",
    restocked: "Returneret til lager",
  };
  facts.push({
    label: "Ordre fundet",
    value: `${order.name} — Status: ${
      fulfillmentStatusDa[order.fulfillment_status ?? ""] ??
        order.fulfillment_status ?? "Ukendt"
    }, Betaling: ${order.financial_status}`,
  });
  if (order.email) {
    facts.push({ label: "Kunde-email kendt", value: order.email });
  }

  // Refund-status — surface verified live refund facts when the customer is
  // asking about a refund/return, or when refunds exist on the order.
  const refundRelevant = plan.primary_intent === "refund" ||
    plan.primary_intent === "return" ||
    (Array.isArray(order.refunds) && order.refunds.length > 0);
  if (refundRelevant) {
    const refundStatus = deriveRefundStatus(order);
    facts.push(buildRefundStatusFact(refundStatus));
  }

  if (order.shipping_address) {
    const a = order.shipping_address;
    const fullName = [a.first_name, a.last_name].filter(Boolean).join(" ");
    if (fullName) {
      facts.push({ label: "Kundenavn", value: fullName });
    }
    if (a.address1 || a.zip || a.city || a.country) {
      facts.push({
        label: "Leveringsadresse kendt",
        value:
          "Ja — må kun gengives ved adresse-, tracking- eller leveringsspørgsmål",
      });
    }
    if (
      plan.primary_intent === "address_change" ||
      plan.primary_intent === "tracking"
    ) {
      facts.push({
        label: "Leveringsadresse",
        value: `${a.address1}, ${a.zip} ${a.city}, ${a.country}`,
      });
    }
  }

  if (order.line_items?.length) {
    facts.push({
      label: "Produkter i ordre",
      value: order.line_items.map((li) => `${li.title} ×${li.quantity}`)
        .join(", "),
    });
  }

  // Inject static tracking info from fulfillments as baseline (always available)
  const firstFulfillment = order.fulfillments?.[0];
  if (firstFulfillment?.tracking_number) {
    const shipmentStatusDa: Record<string, string> = {
      delivered: "Leveret",
      // GLS carrier-specific delivered codes
      "delivd.no pod": "Leveret",
      "delivd.pod": "Leveret",
      delivd: "Leveret",
      in_transit: "Undervejs",
      out_for_delivery: "Til levering i dag",
      attempted_delivery: "Leveringsforsøg fejlede",
      ready_for_pickup: "Klar til afhentning",
      confirmed: "Bekræftet af fragtmand",
      label_printed: "Afhentet af fragtmand",
    };
    const staticStatus = firstFulfillment.shipment_status
      ? shipmentStatusDa[
        String(firstFulfillment.shipment_status).toLowerCase()
      ] ?? firstFulfillment.shipment_status
      : null;

    facts.push({
      label: "Tracking (fragtmand)",
      value: [
        firstFulfillment.tracking_company,
        `Sporingsnummer: ${firstFulfillment.tracking_number}`,
        staticStatus ? `Pakke-status fra Shopify: ${staticStatus}` : null,
      ].filter(Boolean).join(" — "),
    });
    if (firstFulfillment.tracking_url) {
      facts.push({
        label: "Tracking URL",
        value: firstFulfillment.tracking_url,
      });
    }
  }

  // Live carrier lookup — enriches with precise delivery time/location if available
  if (order.fulfillment_status && order.fulfillment_status !== "unfulfilled") {
    try {
      const trackingResults = await fetchTrackingDetailsForOrders([order]);
      const orderKey = String(order.id || order.name || "");
      const tracking = orderKey ? trackingResults[orderKey] : null;
      console.log(
        `[fact-resolver] Tracking lookup result for ${orderKey}: carrier=${tracking?.carrier} statusText=${tracking?.statusText}`,
      );

      if (tracking?.statusText) {
        // Overwrite static tracking fact with live status
        const existingIdx = facts.findIndex((f) =>
          f.label === "Tracking (fragtmand)"
        );
        const liveValue = `${tracking.carrier}: ${tracking.statusText}`;
        if (existingIdx >= 0) {
          facts[existingIdx] = {
            label: "Tracking (fragtmand)",
            value: liveValue,
          };
        } else {
          facts.push({ label: "Tracking (fragtmand)", value: liveValue });
        }
        if (tracking.trackingUrl) {
          const urlIdx = facts.findIndex((f) => f.label === "Tracking URL");
          if (urlIdx >= 0) {
            facts[urlIdx] = {
              label: "Tracking URL",
              value: tracking.trackingUrl,
            };
          } else {facts.push({
              label: "Tracking URL",
              value: tracking.trackingUrl,
            });}
        }
        // Precise delivery timestamp — use this in the reply if available
        if (tracking.snapshot?.deliveredAt) {
          const d = new Date(tracking.snapshot.deliveredAt);
          facts.push({
            label: "Leveret tidspunkt",
            value: d.toLocaleString("da-DK", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Europe/Copenhagen",
            }),
          });
        }
        if (tracking.snapshot?.expectedDeliveryAt) {
          const eta = new Date(tracking.snapshot.expectedDeliveryAt);
          facts.push({
            label: "Forventet levering",
            value: eta.toLocaleDateString("da-DK", {
              day: "numeric",
              month: "long",
            }),
          });
        }
        if (tracking.snapshot?.pickupPoint?.name) {
          const pp = tracking.snapshot.pickupPoint;
          facts.push({
            label: "Pakkeshop",
            value: [pp.name, pp.address, pp.city].filter(Boolean).join(", "),
          });
        }
      }
    } catch (err) {
      console.warn("[fact-resolver] Live tracking lookup failed:", err);
    }
    // Normalized read-only outbound tracking facts (all parcels, safe states).
    try {
      trackingFacts = await resolveOutboundTrackingFacts(order);
    } catch (err) {
      console.warn("[fact-resolver] Normalized outbound tracking failed:", err);
    }
  } else if (!firstFulfillment) {
    facts.push({ label: "Tracking", value: "Ordren er endnu ikke afsendt" });
  }

  // Return eligibility — ALDRIG for complaint/exchange/manglende/defekte varer
  const NON_RETURN_INTENTS = [
    "complaint",
    "exchange",
    "thanks",
    "update",
    "product_question",
  ];
  const isNonReturnCase = NON_RETURN_INTENTS.includes(plan.primary_intent);

  // Return eligibility: the resolver documents the order age but NEVER
  // passes a verdict — return windows differ per shop and are only known
  // from the shop's retrieved return policy. An invented "standard" window
  // is an undocumented factual claim.
  if (
    plan.required_facts.includes("return_eligibility") && !isNonReturnCase &&
    order.created_at
  ) {
    const orderDate = new Date(order.created_at);
    const daysSince = Math.floor(
      (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    facts.push({
      label: "Returret",
      value:
        `Ordren er ${daysSince} dage gammel (ordredato ${
          orderDate.toISOString().slice(0, 10)
        }). Om den kan returneres afgøres UDELUKKENDE af butikkens dokumenterede returpolitik i den valgte viden — antag aldrig et standard-returvindue. Findes ingen dokumenteret returpolitik, så lov ikke returret.`,
    });
  }

  return { facts, order, match, tracking_facts: trackingFacts };
}
