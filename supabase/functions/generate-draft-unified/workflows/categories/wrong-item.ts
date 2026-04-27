import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildWrongItemDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "wrong_item",
    promptHint:
      "WORKFLOW: Wrong item. Kunden har modtaget en forkert vare — en ekspeditionsfejl fra butikkens side. Det er IKKE en ombytning; kunden valgte ikke selv en forkert variant. Anerkend fejlen, bed om ordrenummer og bekræftelse af hvad de modtog vs. hvad de bestilte, og tilbyd reshipping af den korrekte vare.",
    systemHint:
      "Workflow er Wrong item: anerkend ekspeditionsfejlen. Foreslå reshipping af korrekt vare. Foreslå ikke refund medmindre kunden beder om det.",
    promptBlocks: [
      "WRONG ITEM WORKFLOW — følg denne rækkefølge:\n\n" +
      "STEP 1 — Anerkend fejlen med empati:\n" +
      "- Bekræft at kunden har modtaget en forkert vare. Undskyld direkte og klart.\n" +
      "- Brug ALDRIG passive formuleringer som 'det lyder som om der er sket en fejl' — vær direkte: 'Vi har desværre sendt dig den forkerte vare.'\n\n" +
      "STEP 2 — Indhent nødvendige oplysninger (KUN hvis ikke allerede givet):\n" +
      "- Ordrenummer (hvis ikke oplyst)\n" +
      "- Hvad de modtog vs. hvad de bestilte (hvis ikke klart fra emailen)\n" +
      "- Stil MAKSIMALT ét spørgsmål — kombiner om nødvendigt: 'Hvad er dit ordrenummer, og hvad modtog du i stedet?'\n\n" +
      "STEP 3 — Tilbyd løsning:\n" +
      "- Tilbyd reshipping af den korrekte vare — dette er standardløsningen.\n" +
      "- Spørg om kunden skal returnere den forkerte vare eller blot beholde den (følg butikkens returpolitik fra STRUCTURED RETURN SETTINGS).\n" +
      "- Tilbyd KUN refund hvis kunden eksplicit beder om det.\n\n" +
      "Foreslå action: lookup_order_status for at verificere ordreindhold.",
    ],
    systemRules: [
      "Dette er en ekspeditionsfejl fra butikkens side — anerkend fejlen direkte. Brug aldrig passiv sprog der antyder tvivl om fejlen.",
      "Standardløsningen er reshipping af korrekt vare. Foreslå ikke refund_order medmindre kunden eksplicit beder om det.",
      "Stil maksimalt ét samlet spørgsmål — kombiner ordrenummer og varebekræftelse i én sætning.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
  };
}
