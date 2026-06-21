// apps/web/lib/server/commerce/product-spec-suggest.ts
//
// Stage 4B-3-2f — pure write-guard planner for the admin "Generate suggested
// specs" action. Decides which extracted (suggested) specs are safe to upsert
// into shop_product_specs, NEVER touching confirmed or metafield-sourced rows.
//
// PURE: no DB. The route fetches existing specs + runs the extractor, then asks
// this planner what to write. The route only ever writes the returned
// `toWrite` rows (source='product_page_extraction', confidence='suggested').

/**
 * @param shopRefId  tenant shop id (-> shops.id)
 * @param workspaceId tenant workspace id
 * @param products   [{ productId, specs: ExtractedSpec[] }] from the extractor
 * @param existing   all current shop_product_specs rows for the shop
 *                   ({ product_id, spec_key, confidence, source })
 */
export function planSuggestedSpecWrites({
  shopRefId,
  workspaceId,
  products,
  existing,
}) {
  // Index existing rows by "product_id::spec_key".
  const existingByKey = new Map();
  for (const e of Array.isArray(existing) ? existing : []) {
    const k = `${e.product_id}::${e.spec_key}`;
    const arr = existingByKey.get(k) ?? [];
    arr.push(e);
    existingByKey.set(k, arr);
  }

  const toWrite = [];
  const skipped = [];

  for (const product of Array.isArray(products) ? products : []) {
    const productId = product.productId;
    for (const spec of product.specs ?? []) {
      const rows = existingByKey.get(`${productId}::${spec.spec_key}`) ?? [];

      // Never overwrite a human/authoritative confirmed fact.
      if (rows.some((r) => r.confidence === "confirmed")) {
        skipped.push({ product_id: productId, spec_key: spec.spec_key, reason: "confirmed_exists" });
        continue;
      }
      // Never overwrite a metafield-sourced spec (Shopify is source of truth).
      if (rows.some((r) => r.source === "metafield")) {
        skipped.push({ product_id: productId, spec_key: spec.spec_key, reason: "metafield_exists" });
        continue;
      }

      // Safe: brand-new suggestion, or refreshing our own prior extraction.
      toWrite.push({
        shop_ref_id: shopRefId,
        workspace_id: workspaceId,
        product_id: productId,
        spec_key: spec.spec_key,
        spec_group: spec.spec_group,
        spec_value: spec.spec_value,
        value_bool: spec.value_bool ?? null,
        value_num: spec.value_num ?? null,
        unit: spec.unit ?? null,
        comparable: spec.comparable ?? true,
        confidence: "suggested",
        source: "product_page_extraction",
        evidence_text: spec.evidence_text ?? null,
        source_url: spec.source_url ?? null,
        extracted_at: spec.extracted_at ?? null,
        needs_review: spec.needs_review ?? false,
      });
    }
  }

  return { toWrite, skipped };
}
