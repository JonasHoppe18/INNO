// supabase/functions/generate-draft-v2/stages/writer.ts
import { Plan } from "./planner.ts";
import { CaseState } from "./case-state-updater.ts";
import { RetrieverResult } from "./retriever.ts";
import { FactResolverResult } from "./fact-resolver.ts";
import { ActionProposal } from "./action-decision.ts";

export interface WriterResult {
  draft_text: string;
  proposed_actions: ActionProposal[];
  citations: Array<{ claim: string; source_index: number }>;
}

export interface PolicyContextInput {
  policySummaryText: string;
  policyRulesText: string;
  policyExcerptText: string;
}

export interface WriterInput {
  plan: Plan;
  caseState: CaseState;
  retrieved: RetrieverResult;
  facts: FactResolverResult;
  shop: Record<string, unknown>;
  latestCustomerMessage?: string;
  conversationHistory?: Array<{ role: "customer" | "agent"; text: string }>;
  actionProposals?: ActionProposal[];
  policyContext?: PolicyContextInput;
  model?: string;
}

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

const LANGUAGE_NAMES: Record<string, string> = {
  da: "dansk",
  sv: "svensk",
  de: "tysk",
  en: "engelsk",
  nl: "hollandsk",
  fr: "fransk",
  no: "norsk",
};

export async function runWriter(
  { plan, caseState, retrieved, facts, shop, latestCustomerMessage, conversationHistory, actionProposals, policyContext, model }: WriterInput,
): Promise<WriterResult> {
  const resolvedModel = model ?? Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
  const shopName = (shop as { name?: string }).name ?? "butikken";
  const persona =
    (shop as { persona_instructions?: string; instructions?: string })
      .persona_instructions ??
    (shop as { instructions?: string }).instructions ??
    "";

  const langName = LANGUAGE_NAMES[caseState.language] ?? caseState.language;

  // --- Few-shot (primær tone-anker — placeres øverst så modellen ser det først) ---
  const fewShotBlock = retrieved.past_ticket_examples.length > 0
    ? `# Eksempler på hvordan ${shopName} support svarer
Spejl PRÆCIS denne tone, længde og stil:

` +
      retrieved.past_ticket_examples
        .map(
          (ex, i) =>
            `[Eksempel ${i + 1}]
Kunde: "${ex.customer_msg.slice(0, 350)}"
Support svarede: "${ex.agent_reply.slice(0, 500)}"`,
        )
        .join("\n\n")
    : "";

  // --- Verificerede fakta (deterministiske — brug disse frem for viden) ---
  const factsBlock = facts.facts.length > 0
    ? `# Verificerede fakta (brug disse som kilde til faktuelle påstande)
` + facts.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n")
    : "";

  // --- Shop policy (deterministisk — brug altid disse regler) ---
  const policyBlock = policyContext
    ? [
        policyContext.policyRulesText,
        policyContext.policySummaryText,
        policyContext.policyExcerptText,
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";

  // --- Hvad er allerede besluttet/tilbudt i denne samtale ---
  const decisionsMade = caseState.decisions_made.length > 0
    ? `# Hvad er allerede tilbudt/besluttet i denne samtale
` + caseState.decisions_made.map((d) => `- ${d.decision}`).join("\n")
    : "";

  const pendingAsks = caseState.pending_asks.length > 0
    ? `# Vi venter stadig på fra kunden
` + caseState.pending_asks.map((a) => `- ${a}`).join("\n")
    : "";

  // --- Åbne spørgsmål der SKAL besvares (primær driver for svaret) ---
  const openQBlock = caseState.open_questions.length > 0
    ? `# Kundens åbne spørgsmål — DIT SVAR SKAL BESVARE DISSE (brug fakta til at informere svaret)
` + caseState.open_questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
    : "";

  // --- Foreslåede actions fra deterministisk action-decision ---
  const actionsBlock = actionProposals && actionProposals.length > 0
    ? `# Planlagte actions (deterministisk besluttet — nævn dem naturligt i svaret)
` +
      actionProposals
        .map((a) => `- ${a.type}: ${a.reason}`)
        .join("\n")
    : "";

  // --- Viden fra vidensbase ---
  const knowledgeBlock = retrieved.chunks.length > 0
    ? `# Relevant viden fra vidensbasen
` +
      retrieved.chunks
        .map(
          (c, i) =>
            `[kilde ${i}] ${c.source_label}
${c.content.slice(0, 700)}`,
        )
        .join("\n\n")
    : "";

  const isFollowUp = caseState.decisions_made.length > 0 || caseState.pending_asks.length > 0;

  const systemPrompt = `Du er en erfaren support-medarbejder for ${shopName}.
${persona ? `\nBUTIKKENS EGNE INSTRUKTIONER (følg disse præcist):\n${persona}\n` : ""}
SPROG (KRITISK): Svar altid på det sprog kunden selv bruger i deres besked. Se på kundens besked og match sproget præcist — hilsen, brødtekst og afslutning skal alle være på samme sprog. Bland aldrig sprog.

DU ER ET MENNESKE: Ingen "Som AI kan jeg...", ingen unødvendige undskyldninger.

HILSEN: Start med den naturlige hilsen på kundens sprog + fornavn fra ordren eller kundens signatur. Kender du ikke navnet, brug blot den enkle hilsen på kundens sprog.

ÅBNING:
${isFollowUp
  ? "- OPFØLGNINGSSVAR — gå direkte til sagen efter hilsenen."
  : "- FØRSTE svar — efter hilsenen: kort varm indledning (tak kunden, vis empati). Gå direkte til løsning — genfortæl IKKE kundens problem med dine egne ord."}

AFSLUTNING — vælg baseret på situationen, skriv på kundens sprog:
- Handling udført og sagen er lukket → kort venlig afsked
- Vi venter på svar fra kunden eller sagen er ikke løst → udtryk at du ser frem til at høre fra dem
- Frustreret kunde, lang ventetid eller vi har skuffet kunden → undskyld for ulejligheden og tak for tålmodigheden
- Aldrig: "er du velkommen til at kontakte os igen" — kunden er allerede i kontakt.

LÆNGDE OG TONE:
- Vær kortfattet og præcis — undgå fyldord som "Ifølge trackingoplysningerne fra" eller "Du er velkommen til at"
- Kom til sagen: "Din pakke blev leveret den 13. februar kl. 11:13" ikke "Ifølge GLS-data blev pakken leveret..."
- Spejl tonen fra eksemplerne — uformel hvis eksemplerne er uformelle
- Bekræft handlingen — forklar ikke den tekniske årsag bag medmindre kunden har spurgt: "Vi har opdateret adressen" ikke "Vi har opdateret adressen, da ordren endnu ikke er afsendt"

KANAL-REGEL: Bed ALDRIG kunden om at "sende en email" — de er allerede her.

URL-REGEL: Skriv URLs som plain text (https://...) — ALDRIG som markdown [tekst](url).

VIDENSBASE-REGEL: Når du bruger trin eller guides fra vidensbasen, oversæt dem til kundens sprog. Fjern metadata-labels som "(Engelsk)", "(English)", "(Dansk)" og lignende — de er interne markeringer der ikke hører hjemme i kundens svar.

FAKTA-REGEL:
- Kundens spørgsmål/anmodning er ALTID udgangspunktet for svaret — fakta bruges til at BESVARE spørgsmålet, ikke til at erstatte det
- Eksempel: Kunden beder om adresseændring → svar på OM det kan lade sig gøre baseret på ordrens status, ikke bare rapportér status
- Eksempel: Ordre allerede leveret + kunden vil ændre adresse → "Desværre er ordren allerede leveret den [dato], så vi kan ikke ændre adressen"
- Brug præcis dato og tid fra fakta når de er tilgængelige
- Spørg ALDRIG om noget kunden allerede har oplyst
- Hvis du ikke ved noget sikkert — tilbyd at undersøge det direkte i denne tråd
- Nævn planlagte actions naturligt: "Vi har igangsat en retur for din ordre"

RETURRET-REGEL (KRITISK — følg altid):
Returvinduet (f.eks. 30 dage) gælder KUN når kunden aktivt ønsker at RETURNERE en vare de ikke vil have.

Det gælder ALDRIG for:
- Manglende varer: "Jeg modtog kun 1 i stedet for 2" → shopens fejl, send den manglende
- Forkert vare: kunden fik det forkerte produkt → shopens fejl, ret det
- Defekt/ødelagt ved levering → shopens ansvar
- Ombytning pga. produktfejl → shopens ansvar

EKSEMPEL: Kunden skriver "Jeg modtog kun 1 AirPod i stedet for et par — jeg forventer ombytning."
FORKERT svar: "Returneringen ligger uden for vores 30-dages returfrist."
RIGTIGT svar: "Vi beklager at du kun modtog én AirPod. Vi undersøger sagen og sender dig en løsning hurtigst muligt."

Nævn ALDRIG returvinduet i disse tilfælde — det er irrelevant og virker afvisende.

Returner KUN gyldigt JSON — ingen markdown udenfor JSON.`;

  // --- Samtalehistorik — de seneste udvekslinger i den aktuelle tråd ---
  const historyBlock = conversationHistory && conversationHistory.length > 1
    ? `# Samtalehistorik (den aktuelle tråd — se hvad der allerede er sagt og lovet)
${conversationHistory
    .slice(-6) // max 6 beskeder bagud
    .map((m) => `[${m.role === "agent" ? "Support" : "Kunde"}]: ${m.text.slice(0, 600)}`)
    .join("\n\n")}`
    : "";

  const userContent = [
    fewShotBlock,
    policyBlock,
    factsBlock,
    decisionsMade,
    pendingAsks,
    actionsBlock,
    openQBlock,
    knowledgeBlock,
    historyBlock,
    latestCustomerMessage
      ? `# Kundens seneste besked (læs denne grundigt — brug alle detaljer kunden har givet)
${latestCustomerMessage.slice(0, 1200)}`
      : "",
    `# Sammenfatning af henvendelsen
Intent: ${plan.primary_intent}
Sprog: ${caseState.language} (${langName})
${caseState.entities.order_numbers.length > 0 ? `Ordrenumre nævnt: ${caseState.entities.order_numbers.join(", ")}` : ""}
${caseState.entities.products_mentioned.length > 0 ? `Produkter nævnt: ${caseState.entities.products_mentioned.join(", ")}` : ""}
Kundens email: ${caseState.entities.customer_email || "ukendt"}`,
    `# Output format
Returner JSON:
{
  "reply_draft": "Dit svar her — komplet og klar til at sende",
  "citations": [{"claim": "den faktuelle påstand", "source_index": 0}]
}`,
  ].filter(Boolean).join("\n\n");

  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: resolvedModel,
        temperature: 0.2,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!resp.ok) throw new Error(`Writer API error: ${resp.status}`);
    const data = await resp.json();
    const parsed = JSON.parse(data.choices[0].message.content);

    return {
      draft_text: parsed.reply_draft ?? "",
      proposed_actions: actionProposals ?? [],
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
    };
  } catch (err) {
    console.error("[writer] Error:", err);
    return { draft_text: "", proposed_actions: actionProposals ?? [], citations: [] };
  }
}
