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

// Permission-stall sentences: "let us know if you would like to move
// forward/proceed" and Danish equivalents. Matched as whole sentences so the
// replacement never leaves fragments.
const STALL_SENTENCE_RE =
  /[^.!?\n]*\b(?:let (?:me|us) know if you(?:'d| would) like to (?:move forward|proceed|continue)|if you(?:'d| would) like to (?:move forward|proceed|continue)|sig (?:gerne )?til,? hvis du (?:ønsker|vil)(?: at)? (?:gå videre|fortsætte)|hvis du ønsker at (?:gå videre|fortsætte))\b[^.!?\n]*[.!?]?/gi;

const NEXT_STEP_LINE: Record<string, string> = {
  da: "Jeg gennemgår det, du har sendt, og vender tilbage med et prisoverslag for reparation og fragt.",
  en: "We'll review what you've sent and get back to you with an estimate for the repair and shipping costs.",
};

// Removal/replace-only post-processor (same pattern as
// cleanupDeliveredNotReceivedDraft): when the customer has delivered the
// requested details, a permission-stall sentence is swapped for a committed
// next step. The prompt directive alone loses to conversation-history
// anchoring when the previous agent turn used the same stall phrasing.
export function cleanupMomentumStall(
  draft: string,
  opts: { latestCustomerMessage?: string | null; language?: string | null },
): string {
  if (!customerDeliveredRequestedDetails(opts.latestCustomerMessage)) {
    return draft;
  }
  const text = String(draft ?? "");
  STALL_SENTENCE_RE.lastIndex = 0;
  if (!STALL_SENTENCE_RE.test(text)) return draft;
  STALL_SENTENCE_RE.lastIndex = 0;
  const lang = String(opts.language ?? "en").trim().toLowerCase().slice(0, 2);
  const replacement = NEXT_STEP_LINE[lang] ?? NEXT_STEP_LINE.en;
  let replaced = false;
  const out = text.replace(STALL_SENTENCE_RE, () => {
    if (replaced) return "";
    replaced = true;
    return replacement;
  });
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
