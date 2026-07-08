export type SupportVoiceViolation =
  | "ai_meta"
  | "case_management_wording"
  | "formal_opening"
  | "generic_filler"
  | "internal_system_wording"
  | "investigate_further"
  | "manual_process_wording"
  | "team_handoff";

const SUPPORT_VOICE_PATTERNS: Array<[SupportVoiceViolation, RegExp]> = [
  ["ai_meta", /\b(?:as an ai|som ai|kunstig intelligens)\b/i],
  [
    "formal_opening",
    /\b(?:tak for din henvendelse|tak for din besked|tak for at sende trackingnummeret|thank you for (?:reaching out|your message|contacting us|sending the tracking number))\b/i,
  ],
  [
    "generic_filler",
    /\b(?:if you have any (?:other|further|more) questions|feel free to (?:ask|reach out|contact us)|do(?:n['’]?t| not) hesitate to (?:ask|reach out|contact us)|du er (?:altid )?velkommen til at (?:skrive|kontakte os|spørge)|hvis du har (?:yderligere |flere )?spørgsmål[^.?!\n]{0,80}\b(?:velkommen|skriv|spørg|kontakt|sig endelig))\b/i,
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
    "investigate_further",
    /\b(?:undersøge|gennemgå|review|investigate|look into)[^.?!\n]{0,80}\b(?:nærmere|yderligere|further|internt|internally)\b/i,
  ],
  [
    "manual_process_wording",
    /\b(?:manuel(?:t|le)?\s+(?:gennemgang|behandling|håndtering|review|processing|handling)|manual\s+(?:review|processing|handling))\b/i,
  ],
  [
    "team_handoff",
    /\b(?:(?:teamet|vores team|our team|the team)\s+(?:kan|vil|skal|må|vender|vende|hjælper|hjælpe|undersøge|gennemgå|review|investigate|look into|get back|follow up)|(?:send(?:er|es)?|videresend(?:er|es)?|forward(?:ed|ing)?|pass(?:ed)?)[^.?!\n]{0,80}\b(?:teamet|vores team|our team|the team))\b/i,
  ],
];

const FILLER_SENTENCE_RE =
  /[^.!?\n]*\b(?:if you have any (?:other|further|more) questions|feel free to (?:ask|reach out|contact us)|do(?:n['’]?t| not) hesitate to (?:ask|reach out|contact us)|du er (?:altid )?velkommen til at (?:skrive|kontakte os|spørge)|hvis du har (?:yderligere |flere )?spørgsmål[^.?!\n]{0,80}\b(?:velkommen|skriv|spørg|kontakt|sig endelig))\b[^.!?\n]*[.!?]?/gi;

const INTERNAL_SYSTEM_QUALIFIER_RE =
  /\s+\b(?:i vores system|in our system|in our data|in our records)\b/gi;

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
    "Do not expose internal process wording, internal data/system wording, team handoff language, manual-review wording, AI/meta wording, or generic filler.",
    "Prefer plain employee phrasing like 'Tak, jeg har trackingnummeret nu' and 'Jeg kan ikke se, at refunderingen er lavet endnu' when those facts are supported.",
    "Forbidden customer-facing patterns include: 'vi har noteret', 'we have noted', 'registreres hos os', 'bekræfte næste skridt', 'teamet kan', 'our team can', 'vores system', 'in our system', 'manuel gennemgang', 'manual review', 'undersøge yderligere', 'investigate further', 'feel free to reach out', and 'tak for din henvendelse'.",
  ].join(" ");
}
