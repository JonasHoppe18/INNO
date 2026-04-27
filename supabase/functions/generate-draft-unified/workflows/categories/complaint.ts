import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildComplaintDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "complaint",
    promptHint:
      "WORKFLOW: Complaint. Kunden udtrykker generel utilfredshed uden en specifik actionbar anmodning. Prioritér empati og anerkendelse frem for løsningsforslag. Spørg åbent hvad der ville gøre det bedre.",
    systemHint:
      "Workflow er Complaint: empati og anerkendelse først. Ingen forhastede løsninger. Ingen defensiv tone. Spørg hvad der ville hjælpe.",
    promptBlocks: [
      "COMPLAINT WORKFLOW — følg disse principper:\n\n" +
      "1. ANERKEND frustration direkte og oprigtigt:\n" +
      "- Brug ét konkret sætning der viser du forstår kundens oplevelse.\n" +
      "- ALDRIG brug formuleringer som 'Vi beklager eventuelle ulemper' eller 'Vi er kede af at høre det' som isolerede sætninger — de er tomme.\n" +
      "- Anerkend den SPECIFIKKE frustration: 'Vi forstår at det er dybt frustrerende at [konkret problem].'\n\n" +
      "2. UNDGÅ defensiv tone:\n" +
      "- Forsvar ikke butikkens processer eller procedurer i første svar.\n" +
      "- Indrøm ikke ansvar for noget der ikke er bekræftet, men anerkend oplevelsen.\n\n" +
      "3. SPØRG åbent hvad der ville gøre det bedre:\n" +
      "- Afslut med et oprigtigt åbent spørgsmål: 'Hvad ville hjælpe mest for dig lige nu?'\n" +
      "- Foreslå IKKE konkrete løsninger (rabat, refund, erstatning) medmindre kunden specifikt har bedt om dem — det kan virke afvisende.\n\n" +
      "4. HOLD svaret kort:\n" +
      "- Maksimalt 3-4 sætninger. En klage eskaleres ikke med lange forklaringer.",
    ],
    systemRules: [
      "Empati og anerkendelse er prioritet #1. Løsningsforslag er sekundært og må ikke virke som et forsøg på at lukke klagen hurtigt.",
      "Aldrig brug isolerede standardfraser som 'Vi beklager eventuelle ulemper' — anerkend den specifikke situation.",
      "Ingen defensive forklaringer om interne processer i første svar.",
      "Svar skal være kort: 3-4 sætninger maksimalt.",
      "Slut med åbent spørgsmål om hvad der ville hjælpe — foreslå ikke konkrete løsninger medmindre kunden beder om dem.",
    ],
    allowedActionTypes: [
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
  };
}
