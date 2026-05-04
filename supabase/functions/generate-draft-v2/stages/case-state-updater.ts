// supabase/functions/generate-draft-v2/stages/case-state-updater.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { resolveReplyLanguage } from "./language.ts";

export interface CaseState {
  intents: Array<{ type: string; confidence: number }>;
  entities: {
    order_numbers: string[];
    customer_email: string;
    products_mentioned: string[];
    customer_country?: string;
  };
  decisions_made: Array<{ decision: string; timestamp: string }>;
  open_questions: string[];
  pending_asks: string[];
  language: string;
  last_updated_msg_id: string;
}

export interface CaseStateInput {
  thread: Record<string, unknown>;
  messages: Record<string, unknown>[];
  shop: Record<string, unknown>;
  supabase: SupabaseClient;
}

const DEFAULT_CASE_STATE: CaseState = {
  intents: [],
  entities: { order_numbers: [], customer_email: "", products_mentioned: [] },
  decisions_made: [],
  open_questions: [],
  pending_asks: [],
  language: "da",
  last_updated_msg_id: "",
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

export async function updateCaseState(
  { thread, messages, supabase }: CaseStateInput,
): Promise<CaseState> {
  const existing =
    (thread as { case_state_json?: CaseState }).case_state_json ??
      DEFAULT_CASE_STATE;

  const latestMsg = messages[messages.length - 1] as {
    clean_body_text?: string;
    body_text?: string;
    from_email?: string;
    id?: string;
    direction?: string;
  };

  // Byg en komprimeret samtale-historik til LLM (max 8 beskeder, 600 tegn per besked)
  const recentMessages = messages.slice(-8).map((m) => {
    const msg = m as {
      clean_body_text?: string;
      body_text?: string;
      from_email?: string;
      direction?: string;
    };
    const body = (msg.clean_body_text || msg.body_text || "").slice(0, 2000);
    const role = msg.direction === "outbound" ? "Agent" : "Kunde";
    return `[${role}]: ${body}`;
  }).join("\n\n");

  const existingSummary = existing.open_questions.length > 0
    ? `Åbne spørgsmål fra tidligere: ${existing.open_questions.join("; ")}`
    : "";

  const systemPrompt =
    `Du er en support-analyse AI. Ekstraher struktureret information fra en support-samtale. Output KUN gyldigt JSON.`;

  const userPrompt = `Samtale:
${recentMessages}

${existingSummary}

Ekstraher og output JSON:
{
  "primary_intent": "tracking|return|refund|exchange|address_change|product_question|complaint|thanks|other",
  "language": "da|sv|de|en|nl|fr|no|fi|es|it",
  "order_numbers": ["#1234"],
  "customer_email": "kunde@example.com eller tom streng",
  "products_mentioned": ["produktnavn"],
  "customer_country": "DK eller null",
  "open_questions": ["Hvad er status på min pakke?"],
  "pending_asks": ["Vi venter på ordrenummer fra kunden"],
  "decisions_made": ["refund_offered", "replacement_sent"]
}

Regler:
- open_questions: kundens ubesvarede spørgsmål fra samtalen. Fjern et spørgsmål så snart agenten har besvaret det.
- pending_asks: information eller bekræftelse vi HAR BEDT kunden om, men ENDNU IKKE modtaget svar på. Fjern straks når kunden har svaret — selv med et kort "ja", "ok" eller "det er korrekt".
- decisions_made: hvad agenten allerede har tilbudt, gjort, eller hvad kunden har bekræftet. Eksempler: "cable_replacement_initiated", "address_confirmed: Højrupvej 48 5750 Ringe", "warranty_replacement_offered", "refund_offered". Inkludér bekræftede kundeoplysninger som en del af decisions_made så næste svar ved hvad der allerede er på plads.
- Vigtigste regel: Når kunden bekræfter noget vi har spurgt om (adresse, ordrenummer, situation), skal pending_asks være TOM og decisions_made skal indeholde hvad der nu er bekræftet.
- Kun inkludér det der faktisk er i samtalen`;

  let llmResult: {
    primary_intent?: string;
    language?: string;
    order_numbers?: string[];
    customer_email?: string;
    products_mentioned?: string[];
    customer_country?: string;
    open_questions?: string[];
    pending_asks?: string[];
    decisions_made?: string[];
  } = {};

  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini",
        temperature: 0,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      llmResult = JSON.parse(data.choices[0].message.content);
    }
  } catch (err) {
    console.warn(
      "[case-state-updater] LLM extraction failed, using regex fallback:",
      err,
    );
  }

  // Regex fallback for order numbers — scan ALL messages so order numbers from agent replies are captured too
  const allBodies = [
    String((thread as { subject?: unknown }).subject ?? ""),
    ...messages.map((m) => {
      const msg = m as { clean_body_text?: string; body_text?: string };
      return msg.clean_body_text ?? msg.body_text ?? "";
    }),
  ].join(" ");
  const regexOrderNumbers = allBodies.match(/#\d{4,6}\b/g) ?? [];
  const keywordOrderNumbers = [...allBodies.matchAll(
    /\b(?:order|ordre|command|bestilling)\s*#?\s*(\d{3,8})\b/gi,
  )].map((match) => `#${match[1]}`);
  const regexEmails =
    allBodies.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

  const strictOrderPattern = /^#\d{4,6}$/;
  const mergedOrderNumbers = [
    ...new Set([
      // Fresh extractions first — take priority over stale cache
      ...(llmResult.order_numbers ?? []),
      ...regexOrderNumbers,
      ...keywordOrderNumbers,
      // Existing only if properly formatted (filters out bare years like "2026")
      ...existing.entities.order_numbers.filter((n) =>
        strictOrderPattern.test(n)
      ),
    ]),
  ];

  // Brug eksisterende decisions som base, tilføj nye
  const existingDecisionKeys = new Set(
    existing.decisions_made.map((d) => d.decision),
  );
  const newDecisions = (llmResult.decisions_made ?? [])
    .filter((d) => !existingDecisionKeys.has(d))
    .map((d) => ({ decision: d, timestamp: new Date().toISOString() }));

  const updated: CaseState = {
    intents: llmResult.primary_intent
      ? [{ type: llmResult.primary_intent, confidence: 0.9 }]
      : existing.intents,
    entities: {
      order_numbers: mergedOrderNumbers,
      customer_email: llmResult.customer_email ||
        regexEmails[0] ||
        latestMsg?.from_email ||
        existing.entities.customer_email,
      products_mentioned: [
        ...new Set([
          ...existing.entities.products_mentioned,
          ...(llmResult.products_mentioned ?? []),
        ]),
      ],
      customer_country: llmResult.customer_country ??
        existing.entities.customer_country,
    },
    decisions_made: [...existing.decisions_made, ...newDecisions],
    open_questions: llmResult.open_questions ?? existing.open_questions,
    pending_asks: llmResult.pending_asks ?? existing.pending_asks,
    language: resolveReplyLanguage(
      latestMsg?.clean_body_text ?? latestMsg?.body_text ?? "",
      llmResult.language ?? existing.language,
    ),
    last_updated_msg_id: (latestMsg?.id as string) ??
      existing.last_updated_msg_id,
  };

  // Persist til thread (fire and forget — blokerer ikke pipeline)
  supabase
    .from("mail_threads")
    .update({ case_state_json: updated })
    .eq("id", (thread as { id: string }).id)
    .then(({ error }) => {
      if (error) console.warn("[case-state-updater] persist failed:", error);
    });

  return updated;
}
