import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildMissingItemDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "missing_item",
    promptHint:
      "WORKFLOW: Missing item. Kunden modtog pakken, men en eller flere varer manglede. Det er IKKE et leveringsproblem — pakken ankom. Anerkend problemet, bed om dokumentation og tilbyd reshipping af den manglende vare.",
    systemHint:
      "Workflow er Missing item: pakken er modtaget men ufuldstændig. Anerkend problemet, indhent dokumentation, tilbyd reshipping eller delvis refund.",
    promptBlocks: [
      "MISSING ITEM WORKFLOW — følg denne rækkefølge:\n\n" +
      "STEP 1 — Anerkend problemet:\n" +
      "- Bekræft at det er frustrerende at modtage en ufuldstændig pakke. Undskyld direkte.\n" +
      "- Skriv IKKE 'det lyder som om noget mangler' — vær direkte: 'Vi er kede af at din pakke var ufuldstændig.'\n\n" +
      "STEP 2 — Indhent dokumentation (KUN hvis ikke allerede givet):\n" +
      "- Bed om foto af pakkeindholdet og pakkesedlen (hvis synlig)\n" +
      "- Bed om ordrenummer hvis det ikke fremgår\n" +
      "- Stil MAKSIMALT ét samlet spørgsmål: 'Kan du sende et foto af indholdet i pakken samt dit ordrenummer?'\n\n" +
      "STEP 3 — Tilbyd løsning:\n" +
      "- Reshipping af den manglende vare er standardløsningen.\n" +
      "- Tilbyd alternativt delvis refund af den manglende vares pris, hvis kunden foretrækker det.\n" +
      "- Tilbyd KUN fuld refund hvis kunden eksplicit beder om det.\n\n" +
      "Foreslå action: lookup_order_status for at verificere hvad der skulle have været i pakken.",
    ],
    systemRules: [
      "Pakken er modtaget — det er ikke et trackingproblem. Anerkend at indholdet var ufuldstændigt.",
      "Bed om foto og ordrenummer i ét spørgsmål — ikke to separate spørgsmål.",
      "Reshipping er standardløsningen. Delvis refund er alternativet. Fuld refund kun på kundens eksplicitte ønske.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
  };
}
