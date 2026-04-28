// supabase/functions/generate-draft-v2/stages/case-state-updater.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

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

export async function updateCaseState(
  { thread, messages, supabase }: CaseStateInput,
): Promise<CaseState> {
  const existing =
    (thread as { case_state_json?: CaseState }).case_state_json ??
    DEFAULT_CASE_STATE;

  const latestMsg = messages[messages.length - 1] as {
    clean_body_text?: string;
    from_email?: string;
    id?: string;
  };
  const body = latestMsg?.clean_body_text ?? "";

  // Extract order numbers (#1234 or 1234-style)
  const orderMatches = body.match(/#?\b\d{4,6}\b/g) ?? [];
  const orderNumbers = [
    ...new Set([...existing.entities.order_numbers, ...orderMatches]),
  ];

  // Simple language detection
  const hasDanish =
    /\b(tak|hej|venlig|hilsen|bestilling|levering|returnere|refundering)\b/i
      .test(body);
  const hasSwedish =
    /\b(tack|hej|vänlig|beställning|leverans|returnera|återbetalning)\b/i.test(
      body,
    );
  const hasGerman =
    /\b(danke|hallo|freundlich|bestellung|lieferung|rücksendung|erstattung)\b/i
      .test(body);
  const language = hasDanish
    ? "da"
    : hasSwedish
    ? "sv"
    : hasGerman
    ? "de"
    : existing.language;

  const updated: CaseState = {
    ...existing,
    entities: {
      ...existing.entities,
      order_numbers: orderNumbers,
      customer_email:
        latestMsg?.from_email ?? existing.entities.customer_email,
    },
    language,
    last_updated_msg_id: latestMsg?.id ?? existing.last_updated_msg_id,
  };

  // Persist to thread (fire and forget — don't block pipeline)
  supabase
    .from("mail_threads")
    .update({ case_state_json: updated })
    .eq("id", (thread as { id: string }).id)
    .then(({ error }) => {
      if (error) console.warn("[case-state-updater] persist failed:", error);
    });

  return updated;
}
