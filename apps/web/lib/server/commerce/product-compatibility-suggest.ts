// apps/web/lib/server/commerce/product-compatibility-suggest.ts
//
// Slice G — pure write-guard planner + helpers for the admin "Generate
// suggested compatibility" action (POST /api/knowledge/product-compatibility/
// suggest). Mirrors product-spec-suggest.ts.
//
// PURE: no DB, no network. The route fetches existing rows + runs the
// extractor, then asks this planner what is safe to write. The route only ever
// writes the returned `toWrite` rows (source='website_compatibility_extraction',
// confidence='suggested'). Confirmed / manual / metafield rows are NEVER
// overwritten, and the runtime (confirmed-only) is unaffected.

/** Columns added by the (additive) Slice F migration that the apply path writes.
 *  If any are missing, apply=true must fail safely until the migration is run. */
export const REQUIRED_EVIDENCE_COLUMNS = [
  "evidence_text",
  "source_url",
  "source_type",
  "condition",
  "extracted_at",
  "review_note",
];

/** Columns present on the table but missing from `present`. */
export function missingEvidenceColumns(present) {
  const have = new Set((Array.isArray(present) ? present : []).map((c) => String(c)));
  return REQUIRED_EVIDENCE_COLUMNS.filter((c) => !have.has(c));
}

/** dryRun defaults true, apply defaults false. Only apply && !dryRun writes. */
export function resolveWriteIntent(
  { dryRun, apply }: { dryRun?: boolean; apply?: boolean } = {},
) {
  const isDryRun = dryRun !== false; // default true
  const isApply = apply === true; // default false
  return { dryRun: isDryRun, apply: isApply, willWrite: isApply && !isDryRun };
}

function keyOf(productId, target, connection) {
  return `${productId}::${target}::${connection}`;
}

/**
 * @param shopRefId   tenant shop id (-> shops.id)
 * @param workspaceId tenant workspace id
 * @param products    [{ productId, candidates: CompatibilityCandidate[] }]
 * @param existing    current shop_product_compatibility rows for the shop
 *                    ({ product_id, target, connection, confidence, source })
 * @returns { toWrite, skipped, byProduct }
 *   - toWrite:  suggested rows safe to upsert (writable schema-wise)
 *   - skipped:  { product_id, target, connection, reason }
 *   - byProduct: ALL proposed candidates grouped by product id (for the dry-run
 *     report), including the un-writable/needs_review ones not in toWrite.
 */
export function planSuggestedCompatibilityWrites({
  shopRefId,
  workspaceId,
  products,
  existing,
}) {
  const existingByKey = new Map();
  for (const e of Array.isArray(existing) ? existing : []) {
    const k = keyOf(e.product_id, e.target, e.connection);
    const arr = existingByKey.get(k) ?? [];
    arr.push(e);
    existingByKey.set(k, arr);
  }

  const toWrite = [];
  const skipped = [];
  const byProduct = {};

  for (const product of Array.isArray(products) ? products : []) {
    const productId = product?.productId ?? null;
    const groupKey = String(productId);
    for (const c of product?.candidates ?? []) {
      // Always surface the proposal in the grouped dry-run view.
      (byProduct[groupKey] ??= []).push({
        target: c.target,
        connection: c.connection,
        compatible: c.compatible,
        condition: c.condition ?? null,
        needs_review: c.needs_review ?? false,
        review_note: c.review_note ?? null,
        evidence_text: c.evidence_text ?? null,
        source_url: c.source_url ?? null,
        source_type: c.source_type ?? null,
      });

      // Un-writable: the table requires non-empty target AND connection.
      if (c.target == null) {
        skipped.push({ product_id: productId, target: c.target, connection: c.connection, reason: "unrecognized_platform" });
        continue;
      }
      if (c.connection == null) {
        skipped.push({ product_id: productId, target: c.target, connection: c.connection, reason: "connection_unspecified" });
        continue;
      }

      const rows = existingByKey.get(keyOf(productId, c.target, c.connection)) ?? [];
      // Never overwrite a human/authoritative confirmed fact.
      if (rows.some((r) => r.confidence === "confirmed")) {
        skipped.push({ product_id: productId, target: c.target, connection: c.connection, reason: "confirmed_exists" });
        continue;
      }
      // Never overwrite a metafield-sourced row (Shopify stays source of truth).
      if (rows.some((r) => r.source === "metafield")) {
        skipped.push({ product_id: productId, target: c.target, connection: c.connection, reason: "metafield_exists" });
        continue;
      }
      // Never overwrite a manually-curated row.
      if (rows.some((r) => r.source === "manual")) {
        skipped.push({ product_id: productId, target: c.target, connection: c.connection, reason: "manual_exists" });
        continue;
      }

      // Safe: brand-new suggestion, or refreshing our own prior extraction.
      toWrite.push({
        shop_ref_id: shopRefId,
        workspace_id: workspaceId,
        product_id: productId,
        target: c.target,
        connection: c.connection,
        compatible: c.compatible,
        condition: c.condition ?? null,
        reason: c.reason ?? null,
        workaround: c.workaround ?? null,
        confidence: "suggested",
        source: "website_compatibility_extraction",
        evidence_text: c.evidence_text ?? null,
        source_url: c.source_url ?? null,
        source_type: c.source_type ?? null,
        extracted_at: c.extracted_at ?? null,
        needs_review: c.needs_review ?? false,
        review_note: c.review_note ?? null,
      });
    }
  }

  return { toWrite, skipped, byProduct };
}
