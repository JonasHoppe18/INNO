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
  { plan, caseState, retrieved, facts, shop, actionProposals, policyContext, model }: WriterInput,
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

  // --- Åbne spørgsmål der SKAL besvares ---
  const openQBlock = caseState.open_questions.length > 0
    ? `# Kundens åbne spørgsmål — ALLE skal besvares
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
SPROG: Svar KUN på ${langName}. Aldrig på andet sprog.

DU ER ET MENNESKE: Ingen "Som AI kan jeg...", ingen unødvendige undskyldninger.

ÅBNING:
${isFollowUp
  ? "- Dette er et OPFØLGNINGSSVAR — spring indledningen over og gå direkte til sagen."
  : `- Dette er det FØRSTE svar — start med en kort, varm indledning på ${langName}: tak kunden og vis empati for problemet. Gå direkte til løsning bagefter — genfortæl IKKE kundens problem.`}

AFSLUTNING — vurdér situationen og skriv på ${langName}:
- Konkrete trin givet, afventer resultat → "Jeg ser frem til at høre fra dig."
- Problem løst eller ombytning aftalt → "God dag!"
- Frustreret kunde eller lang ventetid → "Undskyld for ulejligheden og tak for din tålmodighed."

LÆNGDE OG TONE:
- Vær kortfattet og præcis — undgå fyldord som "Ifølge trackingoplysningerne fra" eller "Du er velkommen til at"
- Kom til sagen: "Din pakke blev leveret den 13. februar kl. 11:13" ikke "Ifølge GLS-data blev pakken leveret..."
- Spejl tonen fra eksemplerne — uformel hvis eksemplerne er uformelle

KANAL-REGEL: Bed ALDRIG kunden om at "sende en email" — de er allerede her.

URL-REGEL: Skriv URLs som plain text (https://...) — ALDRIG som markdown [tekst](url).

FAKTA-REGEL:
- Brug præcis dato og tid fra fakta når de er tilgængelige
- Spørg ALDRIG om noget kunden allerede har oplyst
- Hvis du ikke ved noget sikkert — tilbyd at undersøge det direkte i denne tråd
- Nævn planlagte actions naturligt: "Vi har igangsat en retur for din ordre"

Returner KUN gyldigt JSON — ingen markdown udenfor JSON.`;

  const userContent = [
    fewShotBlock,
    policyBlock,
    factsBlock,
    decisionsMade,
    pendingAsks,
    actionsBlock,
    openQBlock,
    knowledgeBlock,
    `# Sammenfatning af henvendelsen
Intent: ${plan.primary_intent}
Sprog: ${caseState.language} (${langName})
${caseState.entities.order_numbers.length > 0 ? `Ordrenumre nævnt: ${caseState.entities.order_numbers.join(", ")}` : ""}
${caseState.entities.products_mentioned.length > 0 ? `Produkter nævnt: ${caseState.entities.products_mentioned.join(", ")}` : ""}`,
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
