// Product Support PREVIEW only: scope legacy retrieved knowledge to the selected
// product so cross-product snippets (e.g. an A-Blaze-only guide) cannot
// contaminate a draft generated for a different product's support document.
//
// Rule per retrieved chunk (data-driven — no shop/product names hardcoded):
//  - no product_id (shared/general, incl. applies_to_all_products) → KEEP
//  - product_id === the selected product's external id                → KEEP
//  - product_id resolves to a KNOWN OTHER product (its external id is in the
//    shop's product set, but is not the selected one) → EXCLUDE. The row is
//    definitively scoped to a different product, so the legacy title-mention
//    fallback below must NOT be allowed to rescue it (this is what let
//    "A-spire Wireless" rows leak into the wired "A-Spire" preview when sibling
//    titles were unavailable or the body did not spell out the full variant).
//  - the chunk text clearly names the selected product (legacy numeric
//    product ids that no longer resolve, but the row is about the selected
//    product) → KEEP
//  - otherwise the chunk is scoped to a DIFFERENT product             → EXCLUDE

// Word-boundary phrase match on already-normalized (space-separated) text, so a
// shorter product title cannot match as a substring of a longer one
// ("a spire" must NOT match inside "a spire wireless").
function containsPhrase(haystackNorm: string, needleNorm: string): boolean {
  if (!haystackNorm || !needleNorm) return false;
  return ` ${haystackNorm} `.includes(` ${needleNorm} `);
}

export type LegacyScopeChunk = {
  id: string;
  product_id?: string | null;
  products?: string[] | null;
  applies_to_all_products?: boolean | null;
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

function compactProductLabel(text: string): string {
  return normalize(text).replace(/\s+/g, "");
}

function isExplicitlySharedProductLabel(label: string): boolean {
  const normalized = normalize(label);
  return [
    "all",
    "all products",
    "all headsets",
    "all headphones",
    "shared",
    "general",
    "global",
  ].includes(normalized);
}

function explicitProductsMatchSelected(
  explicitProducts: string[],
  selectedProductTitle: string,
): boolean {
  const selected = normalize(selectedProductTitle);
  const selectedCompact = compactProductLabel(selectedProductTitle);
  if (!selected || !selectedCompact) return false;

  return explicitProducts.some((product) => {
    const normalized = normalize(product);
    if (!normalized || isExplicitlySharedProductLabel(normalized)) return false;
    return normalized === selected || compactProductLabel(normalized) === selectedCompact;
  });
}

// True when the row text names the selected product AND no MORE-SPECIFIC sibling
// product (a title that extends the selected title, e.g. "A-Spire Wireless"
// extends "A-Spire") is also named in the row. This keeps legacy numeric-id rows
// that genuinely describe the selected product, while excluding rows that
// actually describe a distinct, more-specific variant.
function rowNamesSelectedProduct(
  textNorm: string,
  selectedTitleNorm: string,
  siblingTitleNorms: string[],
): boolean {
  if (!selectedTitleNorm) return false;
  if (!containsPhrase(textNorm, selectedTitleNorm)) return false;
  for (const sibling of siblingTitleNorms) {
    if (!sibling || sibling === selectedTitleNorm) continue;
    // A sibling is "more specific" when the selected title is a sub-phrase of it.
    // If such a sibling is the one actually named in the row, the row is about
    // the distinct variant, not the selected product → do not keep.
    if (
      containsPhrase(sibling, selectedTitleNorm) &&
      containsPhrase(textNorm, sibling)
    ) {
      return false;
    }
  }
  return true;
}

export function scopeLegacyChunksToProduct(options: {
  productScope: string;
  selectedProductTitle?: string | null;
  // All product titles for the shop (preview-only). Used to tell sibling
  // variants apart (wired "A-Spire" vs "A-Spire Wireless") in the legacy
  // title-mention fallback. Optional — without it the fallback still works by
  // word-boundary phrase match, just cannot disambiguate prefix-variant titles.
  siblingProductTitles?: string[] | null;
  // All known product external ids for the shop (preview-only). When a chunk's
  // product_id is in this set but is not the selected one, the chunk is
  // definitively scoped to a known other product and is excluded WITHOUT
  // consulting the title-mention fallback. Optional — when omitted, behavior is
  // unchanged (the fallback still guards prefix-variant leakage via titles).
  knownProductExternalIds?: string[] | null;
  chunks: LegacyScopeChunk[];
}): {
  kept: LegacyScopeChunk[];
  diagnostics: LegacyScopeResult;
} {
  const productScope = String(options.productScope || "").trim();
  const selectedExternalId = externalIdFromProductScope(productScope);
  const selectedTitleNorm = normalize(options.selectedProductTitle || "");
  const siblingTitleNorms = Array.isArray(options.siblingProductTitles)
    ? options.siblingProductTitles
      .map((title) => normalize(title || ""))
      .filter(Boolean)
    : [];
  const knownExternalIds = new Set(
    (Array.isArray(options.knownProductExternalIds)
      ? options.knownProductExternalIds
      : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  const chunks = Array.isArray(options.chunks) ? options.chunks : [];

  const kept: LegacyScopeChunk[] = [];
  const included: string[] = [];
  const excluded: string[] = [];

  for (const chunk of chunks) {
    const pid = String(chunk.product_id || "").trim();
    const explicitProducts = Array.isArray(chunk.products)
      ? chunk.products.map((p) => String(p || "").trim()).filter(Boolean)
      : [];
    const hasExplicitProductScope = explicitProducts.some((p) =>
      !isExplicitlySharedProductLabel(p)
    );
    let keep: boolean;
    if (selectedExternalId && pid === selectedExternalId) {
      keep = true; // same product (canonical external id)
    } else if (pid && knownExternalIds.has(pid)) {
      // product_id resolves to a known OTHER product → definitively scoped
      // elsewhere; never let the title-mention fallback rescue it.
      keep = false;
    } else if (
      pid &&
      selectedTitleNorm &&
      rowNamesSelectedProduct(
        normalize(`${chunk.source_title || ""} ${chunk.content || ""}`),
        selectedTitleNorm,
        siblingTitleNorms,
      )
    ) {
      // Legacy numeric product id that no longer resolves, but the row clearly
      // names the selected product (and not a more-specific sibling variant)
      // → keep it as selected-product knowledge.
      keep = true;
    } else if (pid) {
      keep = false; // scoped to a different product
    } else if (chunk.applies_to_all_products === true) {
      keep = true; // explicitly shared by metadata
    } else if (hasExplicitProductScope) {
      keep = explicitProductsMatchSelected(
        explicitProducts,
        options.selectedProductTitle || "",
      );
    } else {
      keep = true; // shared / general / not product-scoped
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
