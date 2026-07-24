import type { ResolvedFact } from "./fact-resolver.ts";

export type KnowledgeGapType =
  | "missing_procedure"
  | "missing_policy"
  | "low_kb_coverage"
  | "low_grounding"
  | "missing_live_data";

export interface KnowledgeGap {
  gap_type: KnowledgeGapType;
  intent: string;
  suggested_title: string;
  suggested_content_hint: string;
  tickets_affected?: number;
  fact_type?: "inventory";
  product?: string;
  variant?: string;
  source?: string;
  reason?: string;
  recommended_action?: string;
  internal_only?: boolean;
}

function factValueField(value: string, key: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${key}=([^;]+)`).exec(
    String(value ?? ""),
  );
  return match?.[1]?.trim() || null;
}

function inventoryGapGuidance(reason: string): string {
  if (reason === "not_found") {
    return "Check that the product name maps to the correct store product and that the inventory source contains it.";
  }
  if (reason === "ambiguous_product") {
    return "Add a product alias or adjust the product names so Sona can identify the exact item without guessing.";
  }
  return "Check the connected inventory source and confirm that inventory tracking is available for this product.";
}

export function detectMissingLiveDataGaps(input: {
  intent: string;
  facts: ResolvedFact[];
}): KnowledgeGap[] {
  const stockFacts = (Array.isArray(input.facts) ? input.facts : []).filter(
    (fact) => fact.label === "Live stock availability",
  );
  const gaps: KnowledgeGap[] = [];

  for (const fact of stockFacts) {
    const state = factValueField(fact.value, "state") ?? "unknown";
    if (state !== "unknown") continue;

    const product = factValueField(fact.value, "product") ??
      factValueField(fact.value, "product_query") ?? "the requested product";
    const variant = factValueField(fact.value, "variant");
    const source = factValueField(fact.value, "source") ?? "inventory";
    const reason = factValueField(fact.value, "reason") ??
      "inventory_unavailable";
    const recommendedAction = inventoryGapGuidance(reason);

    gaps.push({
      gap_type: "missing_live_data",
      intent: input.intent,
      suggested_title: `Inventory data needed: ${product}`,
      suggested_content_hint:
        `Sona could not determine the current stock status for ${product}${
          variant && variant !== "default" && variant !== "all_variants"
            ? ` (${variant})`
            : ""
        }. ${recommendedAction}`,
      fact_type: "inventory",
      product,
      ...(variant ? { variant } : {}),
      source,
      reason,
      recommended_action: recommendedAction,
      internal_only: true,
    });
  }

  return gaps;
}
