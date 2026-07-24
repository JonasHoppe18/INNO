export type SupportVoiceViolation =
  | "ai_meta"
  | "case_management_wording"
  | "evidence_language"
  | "empathy_deflection"
  | "formal_opening"
  | "generic_filler"
  | "internal_status_code"
  | "internal_system_wording"
  | "investigate_further"
  | "manual_process_wording"
  | "stock_system_wording"
  | "team_handoff";

const SUPPORT_VOICE_PATTERNS: Array<[SupportVoiceViolation, RegExp]> = [
  ["ai_meta", /\b(?:as an ai|som ai|kunstig intelligens)\b/i],
  [
    // Customers need the answer, not a report about how the answer was found.
    // Keep this narrower than ordinary requests for documentation (photos,
    // receipts, proof of purchase), which can be legitimate support asks.
    "evidence_language",
    /\b(?:(?:ingen|ikke nogen|intet|ikke|uden)\s+(?:klart\s+)?dokumenteret(?:e|et)?|(?:no|not|isn['’]?t|is not)\s+(?:clearly\s+)?documented|according to (?:our|the) (?:documentation|knowledge base|records)|(?:vores|our|the) (?:vidensbase|knowledge base))\b/i,
  ],
  [
    // Template empathy immediately dismissed by "men"/"but" — reads as a
    // deflection of the complaint, not an acknowledgment of it.
    "empathy_deflection",
    /\bjeg forstår,? at det (?:kan være|er) (?:frustrerende|irriterende|ærgerligt),? men\b|\bi understand,? (?:that )?(?:this|it) (?:can be|is|may be|must be) (?:frustrating|annoying|inconvenient),? but\b/i,
  ],
  [
    "formal_opening",
    /\b(?:tak for din henvendelse|tak for din besked|tak for at sende trackingnummeret|thank you for (?:reaching out|your message|contacting us|sending the tracking number))\b/i,
  ],
  [
    "generic_filler",
    /\b(?:if you have any (?:other|further|more) questions|feel free to (?:ask|reach out|contact us)|do(?:n['’]?t| not) hesitate to (?:ask|reach out|contact us)|(?:du er|er du) (?:altid )?velkommen til at (?:skrive|kontakte os|spørge)|hvis du har (?:yderligere |flere )?spørgsmål[^.?!\n]{0,80}\b(?:velkommen|skriv|spørg|kontakt|sig endelig))\b/i,
  ],
  [
    "case_management_wording",
    /\b(?:vi har noteret|we have noted|returneringen skal (?:stadig )?(?:registreres|bekræftes) hos os|returen skal (?:stadig )?(?:registreres|bekræftes) hos os|registreres hos os|bekræfte næste skridt|confirm the next step|confirm next steps|next steps can be confirmed)\b/i,
  ],
  [
    "internal_system_wording",
    /\b(?:vores system|systemet|our system|in our system|in our data|our data|our records|structured data)\b/i,
  ],
  [
    // Stock answers should sound like a shop employee, not a report from an
    // inventory integration. Verified outcomes can be stated directly; an
    // unavailable lookup should be framed as a short human check.
    "stock_system_wording",
    /\b(?:(?:jeg|vi)\s+kan\s+ikke\s+(?:se|bekræfte)\s+(?:den\s+)?(?:aktuelle\s+)?lagerstatus(?:\s+(?:direkte|her|herfra|lige nu))*|i\s+can(?:not|'t)\s+(?:see|confirm)\s+(?:the\s+)?(?:current\s+|live\s+)?stock(?:\s+status|\s+availability)?|live\s+(?:stock|availability)|(?:live|current)\s+(?:stock\s+)?availability\s+(?:could\s+not|cannot|can(?:not|'t))\s+be\s+confirmed|(?:currently\s+)?appears?\s+to\s+be\s+(?:in|out\s+of)\s+stock)\b/i,
  ],
  [
    "internal_status_code",
    /\b(?:awaiting_tracking_from_warehouse|manual_order_requested_awaiting_tracking|shipping_arranged|back_order|replacement_sent|label_(?:requested|created)|shipment_(?:arranged|pending))\b/i,
  ],
  [
    "investigate_further",
    /\b(?:undersøge|gennemgå|review|investigate|look into)[^.?!\n]{0,80}\b(?:nærmere|yderligere|further|internt|internally)\b/i,
  ],
  [
    "manual_process_wording",
    /\b(?:manuel(?:t|le)?\s+(?:gennemgang|behandling|håndtering|review|processing|handling)|manual\s+(?:review|processing|handling))\b/i,
  ],
  [
    "team_handoff",
    /\b(?:(?:teamet|vores team|our team|the team)\s+(?:kan|vil|skal|må|vender|vende|hjælper|hjælpe|undersøge|gennemgå|can|will|shall|may|helps?|review|investigate|look into|get back|follow up)|(?:send(?:er|es)?|videresend(?:er|es)?|forward(?:ed|ing)?|pass(?:ed)?)[^.?!\n]{0,80}\b(?:teamet|vores team|our team|the team))\b/i,
  ],
];

const FILLER_SENTENCE_RE =
  /[^.!?\n]*\b(?:if you have any (?:other|further|more) questions|feel free to (?:ask|reach out|contact us)|do(?:n['’]?t| not) hesitate to (?:ask|reach out|contact us)|(?:du er|er du) (?:altid )?velkommen til at (?:skrive|kontakte os|spørge)|hvis du har (?:yderligere |flere )?spørgsmål[^.?!\n]{0,80}\b(?:velkommen|skriv|spørg|kontakt|sig endelig))\b[^.!?\n]*[.!?]?/gi;

const INTERNAL_SYSTEM_QUALIFIER_RE =
  /\s+\b(?:i vores system|in our system|in our data|in our records)\b/gi;

const INTERNAL_STATUS_PAREN_RE =
  /\s*\((?:awaiting_tracking_from_warehouse|manual_order_requested_awaiting_tracking|shipping_arranged|back_order|replacement_sent|label_(?:requested|created)|shipment_(?:arranged|pending))\)/gi;

export function detectSupportVoiceViolations(
  text: string | null | undefined,
): SupportVoiceViolation[] {
  const draft = String(text ?? "");
  const violations: SupportVoiceViolation[] = [];
  for (const [label, pattern] of SUPPORT_VOICE_PATTERNS) {
    if (pattern.test(draft)) violations.push(label);
  }
  return [...new Set(violations)];
}

export function sanitizeSupportVoiceDraft(
  text: string | null | undefined,
): string {
  let out = String(text ?? "");
  out = out.replace(FILLER_SENTENCE_RE, "");
  out = out.replace(INTERNAL_SYSTEM_QUALIFIER_RE, "");
  out = out.replace(INTERNAL_STATUS_PAREN_RE, "");
  out = out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.!?,])/g, "$1")
    .trim();
  return out;
}

export function buildSupportVoiceRewriteInstruction(input: {
  language: string;
  violations: SupportVoiceViolation[];
}): string {
  const violations = input.violations.length
    ? input.violations.join(", ")
    : "support_voice";
  return [
    `Rewrite the full draft in ${input.language} as a customer-ready reply from an experienced support employee.`,
    `Fix these support-voice violations: ${violations}.`,
    "Preserve the same facts, limitations, asks and next steps. Do not add promises, dates, refunds, delivery claims, actions, goodwill or certainty.",
    "Lead with the useful customer-facing outcome, then stop. Use short natural paragraphs.",
    "Never describe source coverage or how the answer was researched with phrases such as 'documented', 'according to our documentation', 'knowledge base', or 'verified information'. If the sources explicitly establish a yes/no answer, state that customer outcome directly. If they do not, keep the uncertainty but express it naturally, for example 'Jeg kan desværre ikke finde den variant i vores sortiment' / 'I cannot find that option in our current range'. Never turn missing evidence into an absolute no.",
    "For a simple product question, use one direct answer sentence and at most one relevant explanatory sentence. Remove unasked specifications, sales language, and stock clauses unless the customer asked for them and live facts support them. Use range wording such as 'i vores sortiment' / 'we carry' for catalogue facts; never say 'tilgængelig' / 'available' unless live availability is verified.",
    "For stock questions, sound like a shop employee: verified in stock -> 'Ja, [product/variant] er på lager lige nu'; verified out of stock -> '[Product/variant] er desværre udsolgt lige nu'; unknown for a clearly identified product -> 'Jeg skal lige have lagerstatus på [product] bekræftet, før jeg kan give dig et sikkert svar'; ambiguous product or variant -> ask exactly one concrete model/variant question. Never say 'live availability', 'appears to be out of stock', 'jeg kan ikke se lagerstatus direkte her', or explain an inventory lookup.",
    "Do not expose internal process wording, internal data/system wording, team handoff language, manual-review wording, AI/meta wording, or generic filler.",
    "Prefer plain employee phrasing like 'Tak, jeg har trackingnummeret nu' and 'Jeg kan ikke se, at refunderingen er lavet endnu' when those facts are supported.",
    "Forbidden customer-facing patterns include: 'ingen dokumenteret version', 'not documented', 'according to our documentation', 'knowledge base', 'vi har noteret', 'we have noted', 'registreres hos os', 'bekræfte næste skridt', 'teamet kan', 'our team can', 'vores system', 'in our system', 'manuel gennemgang', 'manual review', 'undersøge yderligere', 'investigate further', 'live availability', 'appears to be out of stock', internal underscore status codes, 'feel free to reach out', and 'tak for din henvendelse'.",
  ].join(" ");
}
