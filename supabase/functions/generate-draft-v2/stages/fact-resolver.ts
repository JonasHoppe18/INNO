// supabase/functions/generate-draft-v2/stages/fact-resolver.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { Plan } from "./planner.ts";
import { CaseState } from "./case-state-updater.ts";
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

  // Løs kundens email — prioritér fra case_state, thread, besked-afsender
  const customerEmail =
    caseState.entities.customer_email ||
    (thread as { customer_email?: string }).customer_email ||
    "";

  let order: Order | null = null;

  // 1. Direkte opslag på ordrenummer hvis kunden har nævnt det
  const orderNumbers = caseState.entities.order_numbers;
  if (orderNumbers.length > 0) {
    for (const raw of orderNumbers) {
      try {
        const found = await provider.getOrderByName(raw);
        if (found) {
          order = found;
          break;
        }
      } catch (err) {
        console.warn("[fact-resolver] Order name lookup failed:", err);
      }
    }
  }

  // 2. Fallback: hent seneste ordre på kundens email
  if (!order && customerEmail) {
    try {
      const orders = await provider.listOrdersByEmail(customerEmail, 3);
      if (orders.length > 0) {
        order = orders[0];
      }
    } catch (err) {
      console.warn("[fact-resolver] Order lookup by email failed:", err);
    }
  }

  if (!order) {
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

  // Tracking
  if (plan.required_facts.includes("tracking")) {
    try {
      const tracking = await provider.getTracking(order.id);
      if (tracking.length > 0 && tracking[0].status_text) {
        facts.push({
          label: "Tracking",
          value:
            `${tracking[0].carrier ?? ""}: ${tracking[0].status_text}`.trim(),
        });
        if (tracking[0].tracking_url) {
          facts.push({
            label: "Tracking URL",
            value: tracking[0].tracking_url,
          });
        }
      }
    } catch {
      // Tracking utilgængelig — ikke en blokerende fejl
    }
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
