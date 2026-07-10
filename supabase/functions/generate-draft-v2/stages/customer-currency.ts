// Draft-time currency resolution. We quote a price only in a currency we can
// justify: the customer's actual order currency first, then a language→market
// inference, then the shop's primary market, then base. Never invents an FX
// rate — the amount itself comes from Shopify Markets presentment prices.

const LANGUAGE_TO_CURRENCY: Record<string, string> = {
  da: "DKK", sv: "SEK", nb: "NOK", nn: "NOK", no: "NOK",
  de: "EUR", fr: "EUR", nl: "EUR", es: "EUR", it: "EUR", fi: "EUR",
  en: "", // ambiguous — do not infer a currency from English
};

function norm(v: string | null | undefined): string {
  return String(v ?? "").trim().toUpperCase();
}

export function resolveCustomerCurrency(input: {
  orderCurrency?: string | null;
  customerLanguage?: string | null;
  primaryMarketCurrency?: string | null;
  baseCurrency?: string | null;
}): string | null {
  const order = norm(input.orderCurrency);
  if (order) return order;

  const lang = String(input.customerLanguage ?? "").trim().toLowerCase().slice(0, 2);
  const fromLang = norm(LANGUAGE_TO_CURRENCY[lang]);
  if (fromLang) return fromLang;

  const market = norm(input.primaryMarketCurrency);
  if (market) return market;

  const base = norm(input.baseCurrency);
  return base || null;
}
