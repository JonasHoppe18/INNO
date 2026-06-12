// Product Support PREVIEW only: scope legacy retrieved knowledge to the selected
// product so cross-product snippets (e.g. an A-Blaze-only guide) cannot
// contaminate a draft generated for a different product's support document.
//
// Rule per retrieved chunk (data-driven — no shop/product names hardcoded):
//  - no product_id (shared/general, incl. applies_to_all_products) → KEEP
//  - product_id === the selected product's external id                → KEEP
//  - the chunk text clearly names the selected product (legacy numeric
//    product ids that no longer resolve, but the row is about the selected
//    product) → KEEP
//  - otherwise the chunk is scoped to a DIFFERENT product             → EXCLUDE

export type LegacyScopeChunk = {
  id: string;
  product_id?: string | null;
  content?: string | null;
  source_title?: string | null;
};

export type LegacyScopeResult = {
  product_scope: string;
  included_row_ids: string[];
  excluded_cross_product_row_ids: string[];
};

function normalize(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "product-9114609942851" -> "9114609942851". Any stable slug form is accepted;
// only the trailing identifier after the last "product-"/"-" boundary is used.
export function externalIdFromProductScope(productScope: string): string {
  const scope = String(productScope || "").trim();
  return scope.replace(/^product[-_]/i, "").trim();
}

export function scopeLegacyChunksToProduct(options: {
  productScope: string;
  selectedProductTitle?: string | null;
  chunks: LegacyScopeChunk[];
}): {
  kept: LegacyScopeChunk[];
  diagnostics: LegacyScopeResult;
} {
  const productScope = String(options.productScope || "").trim();
  const selectedExternalId = externalIdFromProductScope(productScope);
  const selectedTitleNorm = normalize(options.selectedProductTitle || "");
  const chunks = Array.isArray(options.chunks) ? options.chunks : [];

  const kept: LegacyScopeChunk[] = [];
  const included: string[] = [];
  const excluded: string[] = [];

  for (const chunk of chunks) {
    const pid = String(chunk.product_id || "").trim();
    let keep: boolean;
    if (!pid) {
      keep = true; // shared / general / not product-scoped
    } else if (selectedExternalId && pid === selectedExternalId) {
      keep = true; // same product (canonical external id)
    } else if (
      selectedTitleNorm &&
      normalize(`${chunk.source_title || ""} ${chunk.content || ""}`)
        .includes(selectedTitleNorm)
    ) {
      // Legacy numeric product id that no longer resolves, but the row clearly
      // names the selected product → keep it as selected-product knowledge.
      keep = true;
    } else {
      keep = false; // scoped to a different product
    }

    if (keep) {
      kept.push(chunk);
      included.push(chunk.id);
    } else {
      excluded.push(chunk.id);
    }
  }

  return {
    kept,
    diagnostics: {
      product_scope: productScope,
      included_row_ids: included,
      excluded_cross_product_row_ids: excluded,
    },
  };
}
