// supabase/functions/generate-draft-v2/stages/fact-resolver.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { Plan } from "./planner.ts";
import { CaseState } from "./case-state-updater.ts";
import {
  createCommerceProvider,
} from "../../_shared/integrations/commerce/index.ts";
import type { Order } from "../../_shared/integrations/commerce/types.ts";
import { fetchTrackingDetailsForOrders } from "../../_shared/tracking.ts";

export interface ResolvedFact {
  label: string;
  value: string;
}

export interface FactResolverResult {
  facts: ResolvedFact[];
  order?: Order | null;
}

export interface FactResolverInput {
  plan: Plan;
  caseState: CaseState;
  thread: Record<string, unknown>;
  shop: Record<string, unknown>;
  supabase: SupabaseClient;
}

export async function runFactResolver(
  { plan, caseState, thread, shop, supabase }: FactResolverInput,
): Promise<FactResolverResult> {
  const facts: ResolvedFact[] = [];

  const needsOrder = plan.required_facts.some((f) =>
    f === "order_state" || f === "tracking" || f === "return_eligibility"
  );
  if (!needsOrder) return { facts, order: null };

  const s = shop as Record<string, unknown>;
  // Use already-loaded shop credentials — no redundant DB query
  const shopifyDomain = (s.shopify_domain as string) ?? null;
  const shopifyToken = (s.shopify_access_token as string) ?? null;
  const shopifyApiVersion = (s.shopify_api_version as string) ?? "2024-04";

  if (!shopifyDomain || !shopifyToken) {
    console.warn("[fact-resolver] Missing Shopify credentials — skipping order lookup");
    return { facts, order: null };
  }

  const provider = createCommerceProvider({
    provider_type: "shopify",
    shop_domain: shopifyDomain,
    access_token: shopifyToken,
    api_version: shopifyApiVersion,
  });

  // Løs kundens email — prioritér fra case_state, thread, besked-afsender
  const thread_ = thread as Record<string, unknown>;
  const customerEmail =
    caseState.entities.customer_email ||
    (thread_.customer_email as string) ||
    (thread_.from_email as string) ||
    "";

  const orderNumbers = caseState.entities.order_numbers;
  console.log(`[fact-resolver] order_numbers=${JSON.stringify(orderNumbers)} customer_email=${customerEmail} required_facts=${JSON.stringify(plan.required_facts)}`);

  let order: Order | null = null;

  // 1. Direkte opslag på ordrenummer hvis kunden har nævnt det
  if (orderNumbers.length > 0) {
    for (const raw of orderNumbers) {
      try {
        console.log(`[fact-resolver] Looking up order by name: ${raw}`);
        const found = await provider.getOrderByName(raw);
        if (found) {
          order = found;
          console.log(`[fact-resolver] Found order: ${order.name} fulfillment=${order.fulfillment_status}`);
          break;
        } else {
          console.warn(`[fact-resolver] Order not found by name: ${raw}`);
        }
      } catch (err) {
        console.warn("[fact-resolver] Order name lookup failed:", err);
      }
    }
  }

  // 2. Fallback: hent seneste ordre på kundens email
  if (!order && customerEmail) {
    try {
      console.log(`[fact-resolver] Falling back to email lookup: ${customerEmail}`);
      const orders = await provider.listOrdersByEmail(customerEmail, 3);
      if (orders.length > 0) {
        order = orders[0];
        console.log(`[fact-resolver] Found order by email: ${order.name}`);
      }
    } catch (err) {
      console.warn("[fact-resolver] Order lookup by email failed:", err);
    }
  }

  if (!order) {
    console.warn("[fact-resolver] No order found — returning empty facts");
    return { facts, order: null };
  }

  facts.push({
    label: "Ordre",
    value:
      `${order.name} — Levering: ${order.fulfillment_status ?? "unfulfilled"}, Betaling: ${order.financial_status}`,
  });

  if (order.shipping_address) {
    const a = order.shipping_address;
    facts.push({
      label: "Leveringsadresse",
      value: `${a.address1}, ${a.zip} ${a.city}, ${a.country}`,
    });
  }

  if (order.line_items?.length) {
    facts.push({
      label: "Produkter i ordre",
      value: order.line_items.map((li) => `${li.title} ×${li.quantity}`)
        .join(", "),
    });
  }

  // Tracking — brug eksisterende carrier-integration (PostNord, GLS, DAO, Bring, DHL, UPS)
  if (order.fulfillment_status && order.fulfillment_status !== "unfulfilled") {
    try {
      const trackingResults = await fetchTrackingDetailsForOrders([order]);
      const orderKey = String(order.id || order.name || "");
      const tracking = orderKey ? trackingResults[orderKey] : null;

      if (tracking?.statusText) {
        facts.push({
          label: "Tracking",
          value: `${tracking.carrier}: ${tracking.statusText}`,
        });
        if (tracking.trackingUrl) {
          facts.push({ label: "Tracking URL", value: tracking.trackingUrl });
        }
        if (tracking.snapshot?.expectedDeliveryAt) {
          const eta = new Date(tracking.snapshot.expectedDeliveryAt);
          facts.push({
            label: "Forventet levering",
            value: eta.toLocaleDateString("da-DK", { day: "numeric", month: "long" }),
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
      console.warn("[fact-resolver] Tracking lookup failed:", err);
    }
  } else {
    facts.push({ label: "Tracking", value: "Ordren er endnu ikke afsendt" });
  }

  // Return eligibility (simpel 30-dages policy-check)
  if (plan.required_facts.includes("return_eligibility") && order.created_at) {
    const orderDate = new Date(order.created_at);
    const daysSince = Math.floor(
      (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    facts.push({
      label: "Returret",
      value: daysSince <= 30
        ? `Ja — ordre er ${daysSince} dage gammel (inden for 30-dages returvindue)`
        : `Nej — ordre er ${daysSince} dage gammel (uden for standard 30-dages returvindue)`,
    });
  }

  return { facts, order };
}
