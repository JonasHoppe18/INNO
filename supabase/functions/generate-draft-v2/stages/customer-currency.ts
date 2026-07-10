// Draft-time currency resolution. We quote a price only in a currency we can
// justify: the customer's actual order currency first, then their country,
// then a language inference, then the shop's primary market, then base. Never
// invents an FX rate — the amount itself comes from Shopify Markets presentment
// prices, and a resolved currency the product has no presentment price for
// falls back to base at the quoting stage.
//
// Country beats language because it is both more reliable and correct for the
// cross-border case: a US customer who happens to write in Danish should still
// be quoted USD, and a Dane on a short "hej"-only message (which language
// detection abstains on, to avoid da/sv confusion) still gets DKK.

// ISO-3166 alpha-2 → currency, covering the markets a Nordic/EU shop typically
// sells in. Countries in the euro area collapse to EUR.
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  DK: "DKK", SE: "SEK", NO: "NOK", US: "USD", GB: "GBP", CA: "CAD", CH: "CHF",
  // Euro area
  DE: "EUR", FR: "EUR", NL: "EUR", FI: "EUR", IE: "EUR", ES: "EUR", IT: "EUR",
  AT: "EUR", BE: "EUR", PT: "EUR", LU: "EUR", GR: "EUR", EE: "EUR", LV: "EUR",
  LT: "EUR", SK: "EUR", SI: "EUR", CY: "EUR", MT: "EUR", HR: "EUR",
};

// Common free-text country names (contact-form "Your Country" is unstructured,
// e.g. "Usa", "Denmark", "Deutschland") → ISO alpha-2, so the map above applies.
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  denmark: "DK", danmark: "DK",
  sweden: "SE", sverige: "SE",
  norway: "NO", norge: "NO",
  usa: "US", "united states": "US", "united states of america": "US", america: "US",
  "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB",
  canada: "CA",
  germany: "DE", deutschland: "DE",
  france: "FR", netherlands: "NL", holland: "NL", finland: "FI",
  ireland: "IE", spain: "ES", españa: "ES", italy: "IT", italia: "IT",
  austria: "AT", belgium: "BE", portugal: "PT", switzerland: "CH",
};

const LANGUAGE_TO_CURRENCY: Record<string, string> = {
  da: "DKK", sv: "SEK", nb: "NOK", nn: "NOK", no: "NOK",
  de: "EUR", fr: "EUR", nl: "EUR", es: "EUR", it: "EUR", fi: "EUR",
  en: "", // ambiguous — do not infer a currency from English
};

function norm(v: string | null | undefined): string {
  return String(v ?? "").trim().toUpperCase();
}

/** Map a country code or free-text country name to a currency, or "" if unknown. */
function currencyFromCountry(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  // Direct ISO alpha-2 (case-insensitive).
  const iso = value.toUpperCase();
  if (COUNTRY_TO_CURRENCY[iso]) return COUNTRY_TO_CURRENCY[iso];
  // Free-text name → ISO → currency.
  const mappedIso = COUNTRY_NAME_TO_ISO[value.toLowerCase()];
  if (mappedIso && COUNTRY_TO_CURRENCY[mappedIso]) return COUNTRY_TO_CURRENCY[mappedIso];
  return "";
}

export function resolveCustomerCurrency(input: {
  orderCurrency?: string | null;
  customerCountry?: string | null;
  customerLanguage?: string | null;
  primaryMarketCurrency?: string | null;
  baseCurrency?: string | null;
}): string | null {
  const order = norm(input.orderCurrency);
  if (order) return order;

  const fromCountry = norm(currencyFromCountry(input.customerCountry));
  if (fromCountry) return fromCountry;

  const lang = String(input.customerLanguage ?? "").trim().toLowerCase().slice(0, 2);
  const fromLang = norm(LANGUAGE_TO_CURRENCY[lang]);
  if (fromLang) return fromLang;

  const market = norm(input.primaryMarketCurrency);
  if (market) return market;

  const base = norm(input.baseCurrency);
  return base || null;
}
