// supabase/functions/generate-draft-v2/stages/writer.ts
import { Plan } from "./planner.ts";
import { CaseState } from "./case-state-updater.ts";
import { RetrieverResult } from "./retriever.ts";
import { FactResolverResult } from "./fact-resolver.ts";

export interface WriterResult {
  draft_text: string;
  proposed_actions: unknown[];
  citations: Array<{ claim: string; source_index: number }>;
}

export interface WriterInput {
  plan: Plan;
  caseState: CaseState;
  retrieved: RetrieverResult;
  facts: FactResolverResult;
  shop: Record<string, unknown>;
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
  { plan, caseState, retrieved, facts, shop }: WriterInput,
): Promise<WriterResult> {
  const shopName = (shop as { name?: string }).name ?? "shop";
  const persona =
    (shop as { persona_instructions?: string; instructions?: string })
      .persona_instructions ??
    (shop as { instructions?: string }).instructions ??
    "";

  const langName = LANGUAGE_NAMES[caseState.language] ?? caseState.language;

  // --- Few-shot block (kerne-mekanisme til tone-matching) ---
  const fewShotBlock = retrieved.past_ticket_examples.length > 0
    ? `# Sådan har vores team tidligere svaret på lignende henvendelser\n` +
      retrieved.past_ticket_examples
        .map(
          (ex, i) =>
            `[Eksempel ${i + 1}]\nKunde: "${ex.customer_msg.slice(0, 400)}"\nVores svar: "${ex.agent_reply.slice(0, 600)}"`,
        )
        .join("\n\n")
    : "";

  // --- Facts block ---
  const factsBlock = facts.facts.length > 0
    ? `# Verificerede fakta\n` +
      facts.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n")
    : "";

  // --- Open questions ---
  const openQBlock = caseState.open_questions.length > 0
    ? `# Kundens åbne spørgsmål der skal besvares\n` +
      caseState.open_questions.map((q) => `- ${q}`).join("\n")
    : "";

  // --- Knowledge block ---
  const knowledgeBlock = retrieved.chunks.length > 0
    ? `# Relevant viden\n` +
      retrieved.chunks
        .map(
          (c, i) =>
            `[${i}] (${c.kind}, ${c.source_label})\n${c.content.slice(0, 700)}`,
        )
        .join("\n\n")
    : "";

  const systemPrompt =
    `Du er en support-medarbejder for ${shopName}. ${persona}

Regler:
- Svar altid på ${langName}.
- Spejl tonen og stilen i de historiske eksempler nøjagtigt.
- Enhver faktuel påstand skal have en citation [source_index] fra vidensblokken.
- Foreslå kun actions fra listen: ${plan.skills_to_consider.join(", ") || "ingen actions tilgængelige"}.
- Returner KUN gyldigt JSON — ingen markdown, ingen forklaringer.`;

  const userContent = [
    fewShotBlock,
    factsBlock,
    openQBlock,
    knowledgeBlock,
    `# Samtalestate\nHovedintent: ${plan.primary_intent}\nSprog: ${caseState.language}`,
    `# Output\nReturner JSON:\n{\n  "reply_draft": "...",\n  "citations": [{"claim": "...", "source_index": 0}],\n  "proposed_actions": []\n}`,
  ].filter(Boolean).join("\n\n");

  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
        temperature: 0.3,
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
      proposed_actions: Array.isArray(parsed.proposed_actions)
        ? parsed.proposed_actions
        : [],
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
    };
  } catch (err) {
    console.error("[writer] Error:", err);
    return { draft_text: "", proposed_actions: [], citations: [] };
  }
}
