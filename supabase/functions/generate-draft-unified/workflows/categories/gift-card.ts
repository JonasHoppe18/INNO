import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildGiftCardDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "gift_card",
    promptHint:
      "WORKFLOW: Gift card. Kunden har et problem med et gavekort — aktivering, saldo, kode eller indløsning. Bed om gavekortets kode (hvis ikke oplyst), verificer problemet og tilbyd erstatningsgavekort ved bekræftet fejl.",
    systemHint:
      "Workflow er Gift card: bed om kode/nummer, verificer problemtype, tilbyd erstatning ved bekræftet fejl.",
    promptBlocks: [
      "GIFT CARD WORKFLOW — følg denne struktur:\n\n" +
      "STEP 1 — Identificer problemtypen:\n" +
      "Typiske problemer:\n" +
      "A) Koden virker ikke / ugyldig kode\n" +
      "B) Saldoen er forkert eller 0\n" +
      "C) Gavekortet er ikke modtaget (email-levering)\n" +
      "D) Indløsning fejler ved checkout\n\n" +
      "STEP 2 — Indhent nødvendige oplysninger (KUN hvis ikke givet):\n" +
      "- Gavekortets kode eller nummer\n" +
      "- Hvad sker der præcist (fejlmeddelelse, hvad kunden forsøgte)\n" +
      "- Stil MAKSIMALT ét spørgsmål.\n\n" +
      "STEP 3 — Tilbyd løsning:\n" +
      "- Problem A (ugyldig kode): tilbyd at udstede et erstatningsgavekort med samme saldo.\n" +
      "- Problem B (forkert saldo): undersøg og ret saldobalancen — tilbyd erstatningsgavekort hvis ikke rettes.\n" +
      "- Problem C (ikke modtaget): tilbyd at gensende gavekortet til kundens email.\n" +
      "- Problem D (checkout-fejl): spørg om de bruger koden korrekt ved checkout; tilbyd erstatningsgavekort ved bekræftet teknisk fejl.\n\n" +
      "Opfind ALDRIG politikker for gavekort der ikke fremgår af APPROVED FACTS eller KNOWLEDGE BASE.",
    ],
    systemRules: [
      "Bed om gavekortets kode i ét spørgsmål — kombiner med problemtype hvis nødvendigt.",
      "Tilbyd erstatningsgavekort ved bekræftet fejl. Indrøm ikke fejl der endnu ikke er verificeret.",
      "Opfind aldrig gavekortpolitikker eller -vilkår der ikke fremgår af POLITIKKER.",
    ],
    allowedActionTypes: [
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
      "resend_confirmation_or_invoice",
    ],
  };
}
