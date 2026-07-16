// Momentum: when the customer's latest message DELIVERS the details we asked
// for (labeled fields like "Full name:", "Phone number:" — the exact shape our
// repair/return drafts request), the case is already moving. Asking "let us
// know if you would like to move forward" at that point stalls it — a human
// colleague confirms the next step instead. Deterministic: fires only on
// labeled-field replies, so ordinary questions never see the directive.

const LABELED_CONTACT_DETAIL_RES: RegExp[] = [
  /^(?:full name|name|navn|fulde navn|dit navn|fullständigt namn|fullt navn|vollständiger name|nom complet|volledige naam|naam|nombre completo|nome completo|koko nimi|nimi)\s*[:\-]\s*\S[^\r\n]*$/im,
  /^(?:full address|address|adresse|fulde adresse|din adresse|fullständig adress|full adresse|vollständige adresse|adresse complète|volledig adres|adres|dirección completa|dirección|indirizzo completo|indirizzo|koko osoite|osoite)\s*[:\-]\s*\S[^\r\n]*$/im,
  /^(?:phone(?: number)?|telefon(?:nummer)?|tlf\.?|mobilnummer|telefonnummer|numéro de téléphone|telefoonnummer|número de teléfono|numero di telefono|puhelinnumero)\s*[:\-]\s*\S[^\r\n]*$/im,
  /^(?:e-?mail(?: address)?|mail(?:adresse)?|e-mail-adresse|adresse e-mail|e-mailadres|correo electrónico|indirizzo e-mail|sähköposti)\s*[:\-]\s*\S[^\r\n]*$/im,
];

export function customerDeliveredRequestedDetails(
  message: string | null | undefined,
): boolean {
  const text = String(message ?? "");
  if (!text.trim()) return false;
  let hits = 0;
  for (const re of LABELED_CONTACT_DETAIL_RES) {
    if (re.test(text)) hits += 1;
  }
  // A full intake/contact-details reply has at least three distinct populated
  // fields. Two arbitrary labels (especially order number + email) are common
  // in ordinary tickets and are not proof that a repair/return flow is moving.
  return hits >= 3;
}

// Permission-stall sentences: "let us know if you would like to move
// forward/proceed" and Danish equivalents. Matched as whole sentences so the
// replacement never leaves fragments.
const STALL_SENTENCE_RE =
  /[^.!?\n]*\b(?:let (?:me|us) know if you(?:'d| would) like to (?:move forward|proceed|continue)|if you(?:'d| would) like to (?:move forward|proceed|continue)|sig (?:gerne )?til,? hvis du (?:ønsker|vil)(?: at)? (?:gå videre|fortsætte)|hvis du ønsker at (?:gå videre|fortsætte))\b[^.!?\n]*[.!?]?/gi;

const REPAIR_QUOTE_CONTEXT_RE =
  /\b(?:repair(?:ing|s|ed)?|repair costs?|reparation|reparere|reparationen|prisoverslag|reparatur|réparation|reparación|riparazione|korjaus|estimate[^.!?\n]{0,50}(?:repair|shipping))\b/i;

const REPAIR_NEXT_STEP_LINE: Record<string, string> = {
  da: "Jeg gennemgår det, du har sendt, og vender tilbage med et prisoverslag for reparation og fragt.",
  en: "We'll review what you've sent and get back to you with an estimate for the repair and shipping costs.",
};

const GENERIC_NEXT_STEP_LINE: Record<string, string> = {
  da: "Jeg gennemgår det, du har sendt, og vender tilbage med næste skridt.",
  en: "We'll review what you've sent and get back to you with the next step.",
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
  const nextSteps = REPAIR_QUOTE_CONTEXT_RE.test(text)
    ? REPAIR_NEXT_STEP_LINE
    : GENERIC_NEXT_STEP_LINE;
  const replacement = nextSteps[lang] ?? nextSteps.en;
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
    "- Bekræft i stedet det konkrete næste skridt og hvad kunden kan forvente (fx \"Jeg gennemgår det, du har sendt, og vender tilbage med næste skridt\"). Nævn kun reparation, prisoverslag eller fragt hvis den aktuelle sag faktisk handler om det.",
    "- Kvittér kort for det modtagne (uden at gentage felterne), og genspørg ALDRIG om noget kunden lige har oplyst.",
    "- Ægte valg (fx at acceptere et prisoverslag) præsenteres først når valget faktisk foreligger — ikke som betingelse for at vi går i gang.",
  ].join("\n");
}
