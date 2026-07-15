// Momentum: when the customer's latest message DELIVERS the details we asked
// for (labeled fields like "Full name:", "Phone number:" — the exact shape our
// repair/return drafts request), the case is already moving. Asking "let us
// know if you would like to move forward" at that point stalls it — a human
// colleague confirms the next step instead. Deterministic: fires only on
// labeled-field replies, so ordinary questions never see the directive.

const LABELED_DETAIL_RES: RegExp[] = [
  /^(?:full name|name|navn|fulde navn|dit navn)\s*[:\-]/im,
  /^(?:full address|address|adresse|fulde adresse)\s*[:\-]/im,
  /^(?:phone(?: number)?|telefon(?:nummer)?|tlf\.?)\s*[:\-]/im,
  /^(?:e-?mail(?: address)?|mail(?:adresse)?)\s*[:\-]/im,
  /^(?:order(?: number)?|ordre(?:nummer)?)\s*[:\-]/im,
];

export function customerDeliveredRequestedDetails(
  message: string | null | undefined,
): boolean {
  const text = String(message ?? "");
  if (!text.trim()) return false;
  let hits = 0;
  for (const re of LABELED_DETAIL_RES) {
    if (re.test(text)) hits += 1;
  }
  // Two or more labeled fields = the customer is filling in what we asked for,
  // not casually mentioning a detail.
  return hits >= 2;
}

export function buildMomentumDirective(opts: {
  latestCustomerMessage?: string | null;
}): string {
  if (!customerDeliveredRequestedDetails(opts.latestCustomerMessage)) return "";
  return [
    "# Momentum: kunden har netop leveret de efterspurgte oplysninger",
    "- Kundens seneste besked udfylder de felter vi bad om — sagen er allerede i gang, og kunden HAR bedt om handlingen.",
    '- Spørg ALDRIG om kunden "ønsker at gå videre" — skriv ALDRIG "let us know if you would like to move forward/proceed" eller tilsvarende tilladelses-forespørgsler.',
    "- Bekræft i stedet det konkrete næste skridt og hvad kunden kan forvente hvornår (fx \"Jeg gennemgår billederne og vender tilbage med et prisoverslag for reparation og fragt\").",
    "- Kvittér kort for det modtagne (uden at gentage felterne), og genspørg ALDRIG om noget kunden lige har oplyst.",
    "- Ægte valg (fx at acceptere et prisoverslag) præsenteres først når valget faktisk foreligger — ikke som betingelse for at vi går i gang.",
  ].join("\n");
}
