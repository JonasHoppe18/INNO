// apps/web/lib/server/commerce/product-compatibility-promote.ts
//
// Slice I — pure planner + helpers for the admin "Promote suggested
// compatibility" action (POST /api/knowledge/product-compatibility/promote).
//
// PURE: no DB, no network. The route fetches the shop-scoped rows for the
// requested ids, asks this planner which are eligible, then (only when
// dryRun=false AND apply=true) updates those rows to confidence='confirmed'.
//
// Safety contract:
//   - Promotes ONLY confidence='suggested', source='website_compatibility_extraction'.
//   - Never promotes confirmed rows; never re-promotes.
//   - Conflict rows (review_note present) and source_type='ocr_chart' rows are
//     NOT promoted unless force=true.
//   - The update sets confidence + reviewed_at/by + (optional) review_note ONLY;
//     it never touches evidence_text/source_url/source_type/condition/target/…
//   - Out-of-scope ids (not in the fetched, shop-scoped set) are skipped.

export const PROMOTE_SOURCE = "website_compatibility_extraction";

/** dryRun defaults true, apply defaults false. Only apply && !dryRun writes. */
export function resolvePromoteIntent(
  { dryRun, apply }: { dryRun?: boolean; apply?: boolean } = {},
) {
  const isDryRun = dryRun !== false; // default true
  const isApply = apply === true; // default false
  return { dryRun: isDryRun, apply: isApply, willWrite: isApply && !isDryRun };
}

/**
 * @param ids   requested row ids to promote
 * @param rows  the shop-scoped rows the route fetched for those ids
 *              ({ id, confidence, source, source_type, review_note })
 * @param force when true, allow promoting conflict (review_note) / ocr_chart rows
 * @returns { toPromote: number[], skipped: { id, reason }[] }
 */
export function planCompatibilityPromotion({ ids, rows, force }) {
  const requested = (Array.isArray(ids) ? ids : [])
    .map((x) => Number(x))
    .filter(Number.isFinite);
  const byId = new Map(
    (Array.isArray(rows) ? rows : []).map((r) => [Number(r.id), r]),
  );

  const toPromote = [];
  const skipped = [];
  const seen = new Set();

  for (const id of requested) {
    if (seen.has(id)) continue;
    seen.add(id);

    const r = byId.get(id);
    if (!r) {
      skipped.push({ id, reason: "not_found_or_out_of_scope" });
      continue;
    }
    if (r.source !== PROMOTE_SOURCE) {
      skipped.push({ id, reason: "wrong_source" });
      continue;
    }
    if (r.confidence === "confirmed") {
      skipped.push({ id, reason: "already_confirmed" });
      continue;
    }
    if (r.confidence !== "suggested") {
      skipped.push({ id, reason: "not_suggested" });
      continue;
    }
    const hasReview = r.review_note != null && String(r.review_note).trim() !== "";
    if (hasReview && !force) {
      skipped.push({ id, reason: "review_note_requires_force" });
      continue;
    }
    if (r.source_type === "ocr_chart" && !force) {
      skipped.push({ id, reason: "ocr_chart_requires_force" });
      continue;
    }
    toPromote.push(id);
  }

  return { toPromote, skipped };
}

/**
 * The exact column patch applied to a promoted row. Deliberately minimal: it
 * NEVER includes evidence_text/source_url/source_type/condition/target/…, so the
 * extraction provenance is preserved. review_note is set only when provided.
 */
export function buildPromotionUpdate(
  { reviewedBy, reviewNote, now }:
    { reviewedBy?: string | null; reviewNote?: string | null; now?: string } = {},
) {
  const update: Record<string, unknown> = {
    confidence: "confirmed",
    reviewed_at: now ?? new Date().toISOString(),
    reviewed_by: reviewedBy ?? "system",
  };
  if (reviewNote != null) update.review_note = reviewNote;
  return update;
}
