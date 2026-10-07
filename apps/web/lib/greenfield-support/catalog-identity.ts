type CatalogRecord = Record<string, unknown>;

// Linguistic normalization only. Product names and identities come from the
// supplied live catalog; this table never supplies merchant aliases.
const equivalents: Record<string, string> = {
  sort: "black", sorte: "black", hvid: "white", hvide: "white",
  lampe: "lamp", lampen: "lamp", vasen: "vase",
};
const functionWords = new Set(
  "a an the this that my your please can could i buy is it in stock today now right price for of and with about what does include inside postage variant sku to den det en et jeg kan er har på lager pris tak vil gerne købe med til".split(" ").map(normalize),
);

function normalize(value: unknown): string {
  return String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function tokens(value: unknown): string[] {
  return normalize(value).split(" ").filter(Boolean).map((word) => equivalents[word] ?? word);
}
function variants(product: CatalogRecord): CatalogRecord[] {
  return Array.isArray(product.variants)
    ? product.variants.filter((value): value is CatalogRecord => Boolean(value && typeof value === "object")) : [];
}
function variantTokens(variant: CatalogRecord): string[] {
  return [variant.title, variant.option1, variant.option2, variant.option3, variant.sku, variant.id].flatMap(tokens);
}
function matchesToken(wanted: string, values: string[]): boolean {
  return values.some((value) => value === wanted || (wanted.length >= 4 && value.startsWith(wanted)));
}

export interface CatalogIdentityMatch {
  product: CatalogRecord;
  variants: CatalogRecord[];
  variantSpecified: boolean;
}

/** Resolves tokens against canonical live records, preserving every ambiguity. */
export function resolveCatalogIdentity(query: string, catalog: CatalogRecord[]): CatalogIdentityMatch[] {
  const wanted = normalize(query);
  if (!wanted) return [];
  const exactVariants = catalog.flatMap((product) => {
    const selected = variants(product).filter((variant) =>
      [variant.sku, variant.id].some((value) => value != null && normalize(value) === wanted));
    return selected.length ? [{ product, variants: selected, variantSpecified: true }] : [];
  });
  if (exactVariants.length) return exactVariants;
  const exactProducts = catalog.filter((product) =>
    [product.title, product.handle, product.id].some((value) => value != null && normalize(value) === wanted));
  if (exactProducts.length) return exactProducts.map((product) => ({ product, variants: variants(product), variantSpecified: false }));

  // Order annotations are support context, not catalog identity. Other numbers
  // remain constraints and must match a live product or variant identifier.
  const reference = query.replace(/\border\s+#?\d+\b/gi, " ");
  const queryTokens = tokens(reference).filter((word) => !functionWords.has(word));
  if (!queryTokens.length) return [];
  return catalog.flatMap<CatalogIdentityMatch>((product) => {
    const titleTokens = [product.title, product.handle, product.id].flatMap(tokens);
    // A variant adjective alone is not a product identity.
    const identifierPresent = variants(product).some((variant) =>
      [variant.sku, variant.id].some((value) => {
        const identifier = normalize(value);
        return identifier && ` ${normalize(reference)} `.includes(` ${identifier} `);
      }));
    if (!identifierPresent && !queryTokens.some((word) => matchesToken(word, titleTokens))) return [];
    const variantWords = queryTokens.filter((word) => !matchesToken(word, titleTokens));
    const allVariants = variants(product);
    if (!variantWords.length) return [{ product, variants: allVariants, variantSpecified: false }];
    const selected = allVariants.filter((variant) =>
      variantWords.every((word) => matchesToken(word, variantTokens(variant))));
    // Unknown/conflicting variants never fall back to a different variant.
    return selected.length ? [{ product, variants: selected, variantSpecified: true }] : [];
  });
}
