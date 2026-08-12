// Godkendte priser. Forsiden viser ticket-grænse og månedspris — ikke en
// beregnet pris pr. ticket.
export const PRICING_TIERS = [
  { id: "solo", nameKey: "tierSolo", tickets: 50, maxUsers: 1, dkk: 699, eur: 99, highlighted: false },
  { id: "starter", nameKey: "tierStarter", tickets: 250, dkk: 1995, eur: 279, highlighted: false },
  { id: "growth", nameKey: "tierGrowth", tickets: 1000, dkk: 4995, eur: 699, highlighted: true },
  { id: "scale", nameKey: "tierScale", tickets: 3000, dkk: 9995, eur: 1399, highlighted: false },
];

export function formatTierPrice(tier, locale) {
  const isDanish = locale === "da";
  const numberLocale = isDanish ? "da-DK" : "en-IE";
  const amount = isDanish ? tier.dkk : tier.eur;
  return isDanish
    ? `${amount.toLocaleString(numberLocale)} kr`
    : `€${amount.toLocaleString(numberLocale)}`;
}
