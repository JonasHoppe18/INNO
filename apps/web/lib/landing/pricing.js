// Godkendte DKK-priser. Forsiden viser ticket-grænse og månedspris — ikke
// en beregnet pris pr. ticket.
export const PRICING_TIERS = [
  { id: "solo", nameKey: "tierSolo", tickets: 100, dkk: 999, highlighted: false },
  { id: "starter", nameKey: "tierStarter", tickets: 250, dkk: 1995, highlighted: false },
  { id: "growth", nameKey: "tierGrowth", tickets: 1000, dkk: 4995, highlighted: true },
  { id: "scale", nameKey: "tierScale", tickets: 3000, dkk: 9995, highlighted: false },
];

export function formatTierPrice(tier, locale) {
  const numberLocale = locale === "da" ? "da-DK" : "en-IE";
  return `${tier.dkk.toLocaleString(numberLocale)} kr`;
}
