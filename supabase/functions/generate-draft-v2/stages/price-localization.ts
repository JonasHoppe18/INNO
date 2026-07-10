// Injects a writer directive that states each relevant product's price in the
// customer's resolved currency, drawn from Shopify Markets presentment prices.
// Mirrors compatibilityBlock/comparisonBlock: detect → look up shop_products →
// build directive. The writer thus only ever sees ONE correct-currency price.

const PRICE_CUE_RE =
  /\b(pris|priser|koster|kostede|hvad\s+koster|hvor\s+meget|price|cost|how\s+much)\b/i;

export function isPriceQuestion(text: string): boolean {
  return PRICE_CUE_RE.test(String(text ?? ""));
}

export function buildPriceLocalizationBlock(input: {
  text: string;
  currency: string | null;
  products: Array<{
    title: string;
    presentment_prices: Record<string, string>;
    price: string | null;
    base_currency: string | null;
  }>;
}): string {
  if (!isPriceQuestion(input.text)) return "";
  const currency = String(input.currency ?? "").trim().toUpperCase();
  const named = input.products
    .filter((p) =>
      p.title && input.text.toLowerCase().includes(p.title.toLowerCase())
    )
    .map((p) => {
      const map = p.presentment_prices ?? {};
      if (currency && map[currency]) return `- ${p.title}: ${map[currency]} ${currency}`;
      const base = String(p.base_currency ?? "").trim().toUpperCase();
      if (p.price) return `- ${p.title}: ${p.price} ${base}`.trimEnd();
      return `- ${p.title}: pris ikke tilgængelig`;
    });
  if (!named.length) return "";
  const label = currency || "";
  return [
    `PRISER — angiv produktpriser i ${label || "produktets valuta"} og brug PRÆCIST disse tal (ingen omregning, ingen gæt):`,
    ...named,
  ].join("\n");
}
