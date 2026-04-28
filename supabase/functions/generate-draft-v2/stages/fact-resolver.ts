// supabase/functions/generate-draft-v2/stages/fact-resolver.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { Plan } from "./planner.ts";
import {
  createCommerceProvider,
} from "../../_shared/integrations/commerce/index.ts";
import type { Order } from "../../_shared/integrations/commerce/types.ts";

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
  shop: Record<string, unknown>;
  supabase: SupabaseClient;
}

export async function runFactResolver(
  { plan, shop, supabase }: FactResolverInput,
): Promise<FactResolverResult> {
  const facts: ResolvedFact[] = [];

  const needsOrder = plan.required_facts.some((f) =>
    f === "order_state" || f === "tracking" || f === "return_eligibility"
  );
  if (!needsOrder) return { facts, order: null };

  const shopId = (shop as { id: string }).id;
  const { data: creds } = await supabase
    .from("shops")
    .select("shopify_domain, shopify_access_token, shopify_api_version")
    .eq("id", shopId)
    .single();

  if (!creds?.shopify_domain || !creds?.shopify_access_token) {
    return { facts, order: null };
  }

  const provider = createCommerceProvider({
    provider_type: "shopify",
    shop_domain: creds.shopify_domain,
    access_token: creds.shopify_access_token,
    api_version: creds.shopify_api_version ?? "2024-04",
  });

  // Try order lookup by order number if we found one
  let order: Order | null = null;
  const orderNumbers = plan.required_facts.includes("order_state")
    ? []
    : [];

  // Get customer email from shop contact for order lookup
  const shopEmail = (shop as { contact_email?: string }).contact_email;
  if (shopEmail) {
    try {
      const orders = await provider.listOrdersByEmail(shopEmail, 3);
      if (orders.length > 0) {
        order = orders[0];
      }
    } catch (err) {
      console.warn("[fact-resolver] Order lookup failed:", err);
    }
  }

  if (order) {
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
        label: "Produkter",
        value: order.line_items.map((li) => `${li.title} ×${li.quantity}`)
          .join(", "),
      });
    }

    // Tracking facts
    if (plan.required_facts.includes("tracking")) {
      try {
        const tracking = await provider.getTracking(order.id);
        if (tracking.length > 0 && tracking[0].status_text) {
          facts.push({
            label: "Tracking",
            value:
              `${tracking[0].carrier ?? ""}: ${tracking[0].status_text}`.trim(),
          });
        }
      } catch {
        // Tracking unavailable — not a blocking error
      }
    }
  }

  // Suppress unused variable warning
  void orderNumbers;

  return { facts, order };
}
