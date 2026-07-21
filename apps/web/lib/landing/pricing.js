// Godkendte priser (spec §5). Valuta følger locale: DKK på /da, EUR på /en.
// `maxUsers` er kun sat når en plan har en brugergrænse (i dag kun Mini) —
// resten viser "unlimited users" som før.
export const PRICING_TIERS = [
  { id: "mini", nameKey: "tierMini", tickets: 50, maxUsers: 1, dkk: 699, eur: 99, highlighted: false },
  { id: "starter", nameKey: "tierStarter", tickets: 500, dkk: 1999, eur: 269, highlighted: false },
  { id: "growth", nameKey: "tierGrowth", tickets: 2000, dkk: 3999, eur: 549, highlighted: true },
  { id: "scale", nameKey: "tierScale", tickets: 5000, dkk: 6999, eur: 949, highlighted: false },
];

export function formatTierPrice(tier, locale) {
  if (locale === "da") {
    return `${tier.dkk.toLocaleString("da-DK")} kr`;
  }
  return `€${tier.eur.toLocaleString("en-IE")}`;
}
