// supabase/functions/generate-draft-v2/stages/case-state-updater.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { resolveReplyLanguage } from "./language.ts";
import { callOpenAIJson } from "./openai-json.ts";

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

const CASE_STATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    primary_intent: {
      type: "string",
      enum: [
        "tracking",
        "return",
        "refund",
        "exchange",
        "address_change",
        "product_question",
        "complaint",
        "thanks",
        "other",
      ],
    },
    language: {
      type: "string",
      enum: ["da", "sv", "de", "en", "nl", "fr", "no", "fi", "es", "it"],
    },
    order_numbers: { type: "array", items: { type: "string" } },
    customer_email: { type: "string" },
    products_mentioned: { type: "array", items: { type: "string" } },
    customer_country: { type: ["string", "null"] },
    open_questions: { type: "array", items: { type: "string" } },
    pending_asks: { type: "array", items: { type: "string" } },
    decisions_made: { type: "array", items: { type: "string" } },
  },
  required: [
    "primary_intent",
    "language",
    "order_numbers",
    "customer_email",
    "products_mentioned",
    "customer_country",
    "open_questions",
    "pending_asks",
    "decisions_made",
  ],
};

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
- Kun inkludér det der faktisk er i samtalen

AGENT-FORPLIGTELSER (KRITISK): Læs alle [Agent]-beskeder grundigt og fang hvad agenten har lovet eller arrangeret. Tilføj til decisions_made:
- Hvis agenten skriver at de opretter en back-order eller reserverer en vare → "back_order_placed" eller "back_order_placed_invoice_in_[måned]"
- Hvis agenten skriver at forsendelse er arrangeret / lager er kontaktet og sender ASAP → "shipping_arranged_asap"
- Hvis agenten skriver at de har bedt lager oprette en manuel ordre → "manual_order_requested_awaiting_tracking"
- Hvis agenten skriver at de venter på tracking fra lager → "awaiting_tracking_from_warehouse"
- Hvis agenten beder en tredjepart om noget specifikt (API-kode, manifest, data) og forklarer hvorfor → "context:[opsummér årsagen i 5-8 ord]"
- Formål: writer ved hvad der ALLEREDE er arrangeret og besvarer kundens opfølgningsspørgsmål om den aftale — ikke starter forfra`;

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
    llmResult = await callOpenAIJson<typeof llmResult>({
      model: Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini",
      systemPrompt,
      userPrompt,
      maxTokens: 700,
      schema: CASE_STATE_SCHEMA,
      schemaName: "draft_v2_case_state",
    });
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

  const threadId = (thread as { id?: string }).id;
  // Persist til thread (fire and forget — blokerer ikke pipeline).
  // Eval-mode uses the synthetic id "eval"; do not try to write it to a UUID column.
  if (
    threadId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(threadId)
  ) {
    supabase
      .from("mail_threads")
      .update({ case_state_json: updated })
      .eq("id", threadId)
      .then(({ error }) => {
        if (error) console.warn("[case-state-updater] persist failed:", error);
      });
  }

  return updated;
}
