import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildExchangeDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "exchange",
    promptHint:
      "WORKFLOW: Exchange. Kunden ønsker en ombytning eller ny vare. TJEK FØRST om RELEVANT KNOWLEDGE indeholder en løsning på det beskrevne problem. Følg denne beslutningslogik:\n\nHVIS knowledge har en relevant løsning OG kunden IKKE eksplicit har sagt de har prøvet den:\n→ Giv løsningen med konkrete trin. Afslut med: \"Hjælper det ikke, ordner vi selvfølgelig en ombytning.\"\n\nHVIS knowledge IKKE har en løsning, ELLER kunden eksplicit har udtømt mulighederne:\n→ Bekræft ombytningen. Giv returadresse og instruktioner direkte i svaret. Afslut med: vi sender erstatningen så snart vi modtager den returnerede vare.\n\nForeslå INGEN Shopify-action.",
    systemHint:
      "Workflow er Exchange: løs problemet hvis knowledge har en løsning, tilbyd ombytning som fallback. Returinstruktioner skrives kun direkte når knowledge ikke har en relevant løsning eller kunden har udtømt mulighederne.",
    promptBlocks: [
      "EXCHANGE DECISION LOGIC — følg dette strengt:\n\nSTEP 1: Har RELEVANT KNOWLEDGE en konkret løsning til kundens problem?\n- JA og kunden har IKKE prøvet det: Giv løsningen med nummererede trin + tilbyd ombytning som fallback: \"Hjælper det ikke, ordner vi en ombytning.\"\n- NEJ eller kunden HAR allerede prøvet alt relevant: Gå til STEP 2.\n\nSTEP 2 (kun hvis ingen løsning): Bekræft ombytning + giv returinstruktioner i svaret:\n1. Bekræft ombytningsanmodningen med empati.\n2. Giv returadresse og eventuelle krav direkte i svarteksten.\n3. Afslut: vi sender erstatningen afsted så snart vi modtager din vare.\n\nForeslå INGEN action.",
    ],
    systemRules: [
      "Tjek altid RELEVANT KNOWLEDGE før du skriver returinstruktioner. Løs problemet hvis muligt — tilbyd kun ombytning direkte når ingen løsning findes eller kunden har udtømt mulighederne. Foreslå ingen Shopify-action.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "fetch_tracking",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
    forceReturnDetailsFlow: true,
  };
}

