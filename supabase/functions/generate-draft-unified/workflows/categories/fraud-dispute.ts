import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildFraudDisputeDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "fraud_dispute",
    promptHint:
      "WORKFLOW: Fraud / dispute. Kunden rapporterer uautoriseret køb, chargeback eller mistanke om svindel. Neutral og formel tone. Indrøm ALDRIG ansvar. Bed om dokumentation. Marker til menneskelig gennemgang.",
    systemHint:
      "Workflow er Fraud/dispute: neutral og formel tone, aldrig indrøm ansvar, bed om dokumentation, eskalér til menneskelig gennemgang.",
    promptBlocks: [
      "FRAUD / DISPUTE WORKFLOW — følg disse regler strengt:\n\n" +
      "1. TON:\n" +
      "- Neutral og professionel. Hverken varm og imødekommende (som normalt) eller kold.\n" +
      "- Undgå al brug af emojis eller uformelle formuleringer.\n\n" +
      "2. INDRØM ALDRIG ANSVAR:\n" +
      "- Skriv IKKE 'vi beklager at dette er sket' i en form der antyder at butikken er skyld i den uautoriserede transaktion.\n" +
      "- Korrekt formulering: 'Vi tager din henvendelse alvorligt og vil undersøge sagen.'\n\n" +
      "3. BED OM DOKUMENTATION:\n" +
      "- Bed om ordrenummer (hvis tilgængeligt), transaktionstidspunkt og eventuel bankkorrespondance.\n" +
      "- Stil MAKSIMALT ét samlet spørgsmål.\n\n" +
      "4. INFORMER om processen:\n" +
      "- Oplys at sagen vil blive gennemgået af teamet og at kunden vil høre nærmere.\n" +
      "- Giv IKKE løfter om tilbagebetaling, annullering eller udfald — disse afgøres efter gennemgang.\n\n" +
      "5. FORESLÅ intern note til menneskelig gennemgang.",
    ],
    systemRules: [
      "Neutral og formel tone. Aldrig varm og uformel tone i fraud/dispute-sager.",
      "Indrøm aldrig ansvar for den uautoriserede transaktion. Anerkend henvendelsen, ikke fejlen.",
      "Giv ingen løfter om refund, annullering eller udfald — sagen skal gennemgås af et menneske.",
      "Foreslå altid intern note eller tag til menneskelig eskalering.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
    blockedActionTypes: [
      "refund_order",
      "cancel_order",
      "update_shipping_address",
      "initiate_return",
    ],
  };
}
