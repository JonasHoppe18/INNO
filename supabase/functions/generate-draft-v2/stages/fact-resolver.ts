// supabase/functions/generate-draft-v2/stages/fact-resolver.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { Plan } from "./planner.ts";
import { CaseState } from "./case-state-updater.ts";
import {
  createCommerceProvider,
} from "../../_shared/integrations/commerce/index.ts";
import type { Order } from "../../_shared/integrations/commerce/types.ts";
import { fetchTrackingDetailsForOrders } from "../../_shared/tracking.ts";
import { decryptShopifyToken } from "../../_shared/shopify-credentials.ts";

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
  // shops table: shop_domain (plain) + access_token_encrypted (AES-GCM)
  const shopDomain = (s.shop_domain as string) ?? null;
  const encryptedToken = (s.access_token_encrypted as string) ?? null;

  if (!shopDomain || !encryptedToken) {
    console.warn("[fact-resolver] Missing Shopify credentials (shop_domain or access_token_encrypted) — skipping order lookup");
    return { facts, order: null };
  }

  let shopifyToken: string;
  try {
    shopifyToken = await decryptShopifyToken(encryptedToken);
  } catch (err) {
    console.warn("[fact-resolver] Failed to decrypt Shopify token:", err);
    return { facts, order: null };
  }

  const provider = createCommerceProvider({
    provider_type: "shopify",
    shop_domain: shopDomain,
    access_token: shopifyToken,
    api_version: "2024-04",
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

  const fulfillmentStatusDa: Record<string, string> = {
    fulfilled: "Afsendt (alle varer er afsendt)",
    partial: "Delvist afsendt",
    unfulfilled: "Ikke afsendt endnu",
    restocked: "Returneret til lager",
  };
  facts.push({
    label: "Ordre",
    value: `${order.name} — Status: ${fulfillmentStatusDa[order.fulfillment_status ?? ""] ?? order.fulfillment_status ?? "Ukendt"}, Betaling: ${order.financial_status}`,
  });

  if (order.shipping_address) {
    const a = order.shipping_address;
    const fullName = [a.first_name, a.last_name].filter(Boolean).join(" ");
    if (fullName) {
      facts.push({ label: "Kundenavn", value: fullName });
    }
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
      ? shipmentStatusDa[String(firstFulfillment.shipment_status).toLowerCase()] ?? firstFulfillment.shipment_status
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
      facts.push({ label: "Tracking URL", value: firstFulfillment.tracking_url });
    }
  }

  // Live carrier lookup — enriches with precise delivery time/location if available
  if (order.fulfillment_status && order.fulfillment_status !== "unfulfilled") {
    try {
      const trackingResults = await fetchTrackingDetailsForOrders([order]);
      const orderKey = String(order.id || order.name || "");
      const tracking = orderKey ? trackingResults[orderKey] : null;
      console.log(`[fact-resolver] Tracking lookup result for ${orderKey}: carrier=${tracking?.carrier} statusText=${tracking?.statusText}`);

      if (tracking?.statusText) {
        // Overwrite static tracking fact with live status
        const existingIdx = facts.findIndex((f) => f.label === "Tracking (fragtmand)");
        const liveValue = `${tracking.carrier}: ${tracking.statusText}`;
        if (existingIdx >= 0) {
          facts[existingIdx] = { label: "Tracking (fragtmand)", value: liveValue };
        } else {
          facts.push({ label: "Tracking (fragtmand)", value: liveValue });
        }
        if (tracking.trackingUrl) {
          const urlIdx = facts.findIndex((f) => f.label === "Tracking URL");
          if (urlIdx >= 0) facts[urlIdx] = { label: "Tracking URL", value: tracking.trackingUrl };
          else facts.push({ label: "Tracking URL", value: tracking.trackingUrl });
        }
        // Precise delivery timestamp — use this in the reply if available
        if (tracking.snapshot?.deliveredAt) {
          const d = new Date(tracking.snapshot.deliveredAt);
          facts.push({
            label: "Leveret tidspunkt",
            value: d.toLocaleString("da-DK", {
              day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
              timeZone: "Europe/Copenhagen",
            }),
          });
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
      console.warn("[fact-resolver] Live tracking lookup failed:", err);
    }
  } else if (!firstFulfillment) {
    facts.push({ label: "Tracking", value: "Ordren er endnu ikke afsendt" });
  }

  // Return eligibility — ALDRIG for complaint/exchange/manglende/defekte varer
  const NON_RETURN_INTENTS = ["complaint", "exchange", "thanks", "product_question"];
  const isNonReturnCase = NON_RETURN_INTENTS.includes(plan.primary_intent);

  // Return eligibility (simpel 30-dages policy-check)
  if (plan.required_facts.includes("return_eligibility") && !isNonReturnCase && order.created_at) {
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
