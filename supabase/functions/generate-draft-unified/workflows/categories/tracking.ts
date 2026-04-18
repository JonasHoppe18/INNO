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
      "Brug DENNE STRUKTUR præcist — tilpas kun de konkrete detaljer:\n" +
      "1. POSITIV framing — ALDRIG start med negativt: Skriv IKKE 'Ordren er endnu ikke afsendt'. Skriv I STEDET: 'Din ordre klargøres til afsendelse' eller 'Vi er ved at klargøre din ordre.'\n" +
      "2. Oplys afsendelsesvinduet FRA BUTIKKENS FRAGPOLITIK (se POLITIKKER i kontekst). Eksempel: 'Vi sender normalt inden for 1-3 hverdage fra vores lager.' Brug det PRÆCISE tal fra politikken.\n" +
      "3. Afslut med: 'Du modtager automatisk en sporingsmail med trackingnummer, når pakken er afsendt.'\n" +
      "4. AFSLUTNINGSHILSEN: Afslut med 'God dag!' på en ny linje.\n" +
      "VIGTIGT: 'Du modtager en sporingsmail' er en korrekt formulering — brug den selvom brand voice ellers fraråder 'Du vil modtage en bekræftelse'.\n" +
      "VIGTIGT: Nævn ALDRIG bare 'vi arbejder på det' eller 'vi sender så hurtigt som muligt' uden at inkludere det konkrete tidsvindue fra fragpolitikken.\n" +
      "Undgå at love en specifik leveringsdato medmindre den fremgår eksplicit af ordredata.\n\n" +
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
      "Hold tracking-svar fokuserede: ingen bulleted lists, ingen troubleshooting, ingen forklaringer om forsinkelsesårsager. Følg persona-tonen fuldt ud — varm åbning ved første svar, situationsbestemt afslutning.",
      "Tillad kun read-only actions. Forsøg ikke ordre-mutationer i tracking-workflow.",
      "KRITISK for usendte ordrer: Nævn ALTID det konkrete afsendelsesvindue fra butikkens fragpolitik (fx '1-3 hverdage'). Skriv ALDRIG kun 'vi sender så hurtigt som muligt' — det er for vagt. Afslut ALTID med 'Du modtager automatisk en sporingsmail med trackingnummer, når pakken er afsendt.'",
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
