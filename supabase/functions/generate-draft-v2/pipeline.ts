// supabase/functions/generate-draft-v2/pipeline.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { runGate } from "./stages/gate.ts";
import { updateCaseState } from "./stages/case-state-updater.ts";
import { runPlanner } from "./stages/planner.ts";
import { runRetriever } from "./stages/retriever.ts";
import { runFactResolver } from "./stages/fact-resolver.ts";
import { runWriter } from "./stages/writer.ts";
import { runVerifier } from "./stages/verifier.ts";

export interface PipelineInput {
  thread_id: string;
  message_id?: string;
  shop_id: string;
  supabase: SupabaseClient;
}

export interface PipelineResult {
  draft_text: string | null;
  proposed_actions: unknown[];
  confidence: number;
  sources: Array<{ content: string; kind: string; source_label: string }>;
  skipped?: boolean;
  skip_reason?: string;
}

export async function runDraftV2Pipeline(input: PipelineInput): Promise<PipelineResult> {
  const { thread_id, shop_id, supabase } = input;

  // 1. Load context
  const [threadResult, shopResult, messagesResult] = await Promise.all([
    supabase.from("mail_threads").select("*").eq("id", thread_id).single(),
    supabase.from("shops").select("*").eq("id", shop_id).single(),
    supabase
      .from("mail_messages")
      .select("*")
      .eq("thread_id", thread_id)
      .order("created_at", { ascending: true }),
  ]);

  const thread = threadResult.data;
  const shop = shopResult.data;
  const messages = messagesResult.data ?? [];

  if (!thread || !shop) {
    return {
      draft_text: null,
      proposed_actions: [],
      confidence: 0,
      sources: [],
      skipped: true,
      skip_reason: "thread_or_shop_not_found",
    };
  }

  const latestMessage = messages[messages.length - 1];
  if (!latestMessage) {
    return {
      draft_text: null,
      proposed_actions: [],
      confidence: 0,
      sources: [],
      skipped: true,
      skip_reason: "no_messages",
    };
  }

  // 2. Gate — should we generate?
  const gate = await runGate({ thread, latestMessage, shop });
  if (!gate.should_process) {
    console.log(`[generate-draft-v2] gate blocked: ${gate.reason}`);
    return {
      draft_text: null,
      proposed_actions: [],
      confidence: 0,
      sources: [],
      skipped: true,
      skip_reason: gate.reason,
    };
  }

  // 3. Update case state
  const caseState = await updateCaseState({ thread, messages, shop, supabase });

  // 4. Plan
  const plan = await runPlanner({ caseState, latestMessage, shop });

  // 5. Retrieve (parallel: knowledge + past tickets via single rpc call)
  const retrieved = await runRetriever({ plan, shop_id, supabase });

  // 6. Resolve facts deterministically
  const facts = await runFactResolver({ plan, shop, supabase });

  // 7. Write draft
  const written = await runWriter({
    plan,
    caseState,
    retrieved,
    facts,
    shop,
  });

  // 8. Verify grounding
  const verified = await runVerifier({
    draftText: written.draft_text,
    proposedActions: written.proposed_actions,
    citations: written.citations,
    facts,
    retrievedChunks: retrieved.chunks,
  });

  // If verifier flags low confidence and suggests stronger model — placeholder for gpt-4o retry
  const finalDraft = verified.retry_with_stronger_model
    ? written.draft_text // TODO: re-run with gpt-4o when confidence < 0.6
    : written.draft_text;

  return {
    draft_text: finalDraft,
    proposed_actions: written.proposed_actions,
    confidence: verified.confidence,
    sources: retrieved.chunks.slice(0, 5).map((c) => ({
      content: c.content.slice(0, 200),
      kind: c.kind,
      source_label: c.source_label,
    })),
  };
}
