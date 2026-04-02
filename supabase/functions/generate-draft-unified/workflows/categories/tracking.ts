import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildTrackingDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "tracking",
    promptHint:
      "WORKFLOW: Tracking. Kunden spørger til status på sin forsendelse. Brug LIVE TRACKING-data fra kontekst direkte — inkluder trackingnummer og trackinglink i svaret. Tilpas svar til scenariet nedenfor.",
    systemHint:
      "Workflow er Tracking: hold actions read-only. Forsøg ikke ordre-mutationer.",
    promptBlocks: [
      "TRACKING SCENARIOS — vælg det der passer:\n\n" +
      "SCENARIE A — Live tracking tilgængeligt (LIVE TRACKING-sektion i kontekst):\n" +
      "- Angiv carrier og aktuel status direkte ('Din pakke er undervejs med PostNord.')\n" +
      "- Inkluder altid trackingnummer og trackinglink som klikbart link i svaret\n" +
      "- Hvis 'Expected delivery' er tilgængeligt: nævn den forventede leveringsdato præcist ('forventet levering: mandag den 6. januar')\n" +
      "- Hvis 'Delivered at' er tilgængeligt: bekræft at pakken er leveret med dato og tidspunkt\n" +
      "- Hvis 'Delivered to' er tilgængeligt: nævn hvilken by den er leveret til\n" +
      "- Hvis 'Out for delivery' er tilgængeligt: fortæl at pakken er ude til levering i dag\n" +
      "- Hvis 'Pickup point (parcel shop)' er tilgængeligt: oplys at pakken er klar til afhentning og angiv præcist navn og adresse på pakkeshoppen — f.eks. 'Din pakke er klar til afhentning hos Rema 1000, Nørrebrogade 45, 2200 København N.'\n" +
      "- Hold svaret kort — 3-5 sætninger. Ingen troubleshooting. Ingen bulleted lists.\n\n" +
      "SCENARIE B — Ordre afsendt men ingen live tracking (fulfillment=fulfilled, ingen LIVE TRACKING):\n" +
      "- 'Din ordre er afsendt. Du har modtaget en sporingsmail fra fragtmanden med dit trackingnummer.'\n" +
      "- Hvis trackinglink findes i ordredata: inkluder det direkte\n" +
      "- Undgå vage formuleringer som 'vi undersøger det'\n\n" +
      "SCENARIE C — Ordre ikke afsendt endnu (fulfillment=unfulfilled eller partial):\n" +
      "- 'Din ordre er bekræftet og klargøres til afsendelse. Du modtager automatisk en sporingsmail, når den er afsendt.'\n" +
      "- Nævn estimeret afsendelsestid hvis det fremgår af butikkens politik\n" +
      "- Undgå at love en specifik dato medmindre den fremgår eksplicit\n\n" +
      "SCENARIE D — Ingen ordre fundet i systemet:\n" +
      "- Bed venligt om ordrenummer og e-mailadresse brugt ved købet\n" +
      "- Ét enkelt spørgsmål — ikke en liste\n\n" +
      "REGLER FOR ALLE SCENARIER:\n" +
      "- Inkluder ALDRIG trackinglink som bare tekst — skriv det som URL så kunden kan klikke\n" +
      "- Brug aldrig vage formuleringer: 'vi kigger på det', 'vi undersøger', 'giv os lidt tid'\n" +
      "- Nævn aldrig trackingnummer uden at inkludere trackinglinket i samme sætning\n" +
      "- Skriv ikke 'du kan tracke din pakke på fragtmandens hjemmeside' — giv linket direkte",
    ],
    systemRules: [
      "Tracking workflow: brug LIVE TRACKING-data fra kontekst verbatim. Opfind ingen status eller datoer der ikke fremgår af kontekst.",
      "Inkluder altid trackinglinket direkte i svaret når det er tilgængeligt — aldrig kun trackingnummeret.",
      "Hold tracking-svar korte: ingen bulleted lists, ingen troubleshooting, ingen forklaringer om forsinkelsesårsager medmindre kunden eksplicit spørger.",
      "Tillad kun read-only actions. Forsøg ikke ordre-mutationer i tracking-workflow.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "fetch_tracking",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
    forceTrackingIntent: true,
  };
}
