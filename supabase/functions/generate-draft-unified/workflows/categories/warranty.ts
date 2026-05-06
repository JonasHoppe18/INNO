import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildWarrantyDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "warranty",
    promptHint:
      "WORKFLOW: Warranty. Kunden gør krav gældende under garanti. Verificer dækningsperiode fra POLITIKKER, bed om dokumentation, og beskriv warranty-processen. Foreslå IKKE teknisk troubleshooting — kunden ønsker dækning, ikke en løsning.",
    systemHint:
      "Workflow er Warranty: følg garantibetingelserne fra POLITIKKER. Bed om købsdokument og fejlbeskrivelse. Ingen troubleshooting.",
    promptBlocks: [
      "WARRANTY WORKFLOW — følg denne struktur:\n\n" +
      "STEP 1 — Anerkend kravet:\n" +
      "- Bekræft at du har modtaget kunden garanti-henvendelse.\n" +
      "- Udtryk forståelse for at produktet ikke lever op til forventningerne.\n\n" +
      "STEP 2 — Indhent dokumentation (KUN hvis ikke allerede givet):\n" +
      "- Ordrenummer eller kvittering (til verificering af køb og dato) — dette er det vigtigste\n" +
      "- Foto eller video af fejlen (hvis relevant)\n" +
      "- Stil MAKSIMALT ét samlet spørgsmål med alle manglende felter samlet.\n" +
      "- Spørg ALDRIG om noget kunden allerede har oplyst.\n\n" +
      "STEP 3 — Afslut med konkret næste skridt:\n" +
      "- Hvis dokumentation mangler (ordrenummer, foto): bed om det nu — aldrig 'vi gennemgår internt og vender tilbage'.\n" +
      "- Hvis dokumentation er modtaget: bekræft at sagen behandles — 'Vi behandler din garanti-sag og vender tilbage med næste skridt hurtigst muligt.'\n" +
      "- Brug garantiperioden fra POLITIKKER hvis den fremgår (fx 'Vi tilbyder X års garanti').\n" +
      "- Giv ALDRIG løfter om erstatning eller refund uden verificeret dækning.\n\n" +
      "FORESLÅ IKKE teknisk troubleshooting — kunden har eksplicit invokeret garantien og ønsker ikke en DIY-løsning.",
    ],
    systemRules: [
      "Brug garantiperioden og -betingelserne fra POLITIKKER. Opfind aldrig garantivilkår.",
      "Foreslå aldrig teknisk troubleshooting i warranty-workflow — kunden ønsker garantidækning, ikke en løsning.",
      "Giv ingen løfter om erstatning eller refund uden verificeret dækning.",
      "Maksimalt ét samlet spørgsmål om dokumentation.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
  };
}
