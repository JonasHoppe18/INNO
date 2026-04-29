// supabase/functions/generate-draft-v2/pipeline.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { runGate } from "./stages/gate.ts";
import { updateCaseState } from "./stages/case-state-updater.ts";
import { runPlanner } from "./stages/planner.ts";
import { runRetriever } from "./stages/retriever.ts";
import { runFactResolver } from "./stages/fact-resolver.ts";
import { runActionDecision } from "./stages/action-decision.ts";
import { runWriter } from "./stages/writer.ts";
import { runVerifier } from "./stages/verifier.ts";
import { buildPinnedPolicyContext } from "../_shared/policy-context.ts";

export interface PipelineInput {
  thread_id: string;
  message_id?: string;
  shop_id: string;
  supabase: SupabaseClient;
}

export interface PipelineResult {
  draft_text: string | null;
  proposed_actions: unknown[];
  routing_hint: "auto" | "review" | "block";
  confidence: number;
  sources: Array<{ content: string; kind: string; source_label: string }>;
  skipped?: boolean;
  skip_reason?: string;
}

const STRONG_MODEL = Deno.env.get("OPENAI_STRONG_MODEL") ?? "gpt-4o";
const CONFIDENCE_ESCALATION_THRESHOLD = 0.6;

export async function runDraftV2Pipeline(input: PipelineInput): Promise<PipelineResult> {
  const { thread_id, shop_id, supabase } = input;

  // 1. Load context parallelt
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
      routing_hint: "block",
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
      routing_hint: "block",
      confidence: 0,
      sources: [],
      skipped: true,
      skip_reason: "no_messages",
    };
  }

  // 2. Gate
  const gate = await runGate({ thread, latestMessage, shop });
  if (!gate.should_process) {
    console.log(`[generate-draft-v2] gate blocked: ${gate.reason}`);
    return {
      draft_text: null,
      proposed_actions: [],
      routing_hint: "block",
      confidence: 0,
      sources: [],
      skipped: true,
      skip_reason: gate.reason,
    };
  }

  // 3. Case state — LLM-baseret ekstraktion af intents, entities, åbne spørgsmål
  const caseState = await updateCaseState({ thread, messages, shop, supabase });

  // 4. Plan — bestem intent, hvad der skal hentes, hvilke facts der kræves
  const plan = await runPlanner({ caseState, latestMessage, shop });

  // 5. Retrieve + resolve facts parallelt (uafhængige)
  const [retrieved, facts] = await Promise.all([
    runRetriever({ plan, shop_id, supabase }),
    runFactResolver({ plan, caseState, thread, shop, supabase }),
  ]);

  // 6. Deterministisk action-decision baseret på plan + caseState + facts
  const actionDecision = await runActionDecision({ plan, caseState, facts });

  // 7. Byg shop policy-kontekst deterministisk (pinned — altid med i prompten)
  const latestBody = (latestMessage.clean_content ?? latestMessage.content ?? "") as string;
  const subject = (thread.subject ?? "") as string;
  const policyContext = buildPinnedPolicyContext({
    subject,
    body: latestBody,
    policies: {
      policy_refund: (shop as Record<string, unknown>).policy_refund as string ?? null,
      policy_shipping: (shop as Record<string, unknown>).policy_shipping as string ?? null,
      policy_terms: (shop as Record<string, unknown>).policy_terms as string ?? null,
      policy_summary_json: (shop as Record<string, unknown>).policy_summary_json ?? null,
    },
    reservedTokens: 800,
  });

  // 8. Skriv første draft med gpt-4o-mini
  const written = await runWriter({
    plan,
    caseState,
    retrieved,
    facts,
    shop,
    actionProposals: actionDecision.proposals,
    policyContext,
  });

  // 9. Verificér grounding og kvalitet
  const verified = await runVerifier({
    draftText: written.draft_text,
    proposedActions: actionDecision.proposals,
    citations: written.citations,
    facts,
    retrievedChunks: retrieved.chunks,
  });

  let finalDraft = written.draft_text;
  let finalConfidence = verified.confidence;

  // 10. Eskalér til gpt-4o hvis verifier flagger lav confidence
  if (verified.retry_with_stronger_model && !verified.block_send) {
    console.log(
      `[generate-draft-v2] confidence ${verified.confidence} < ${CONFIDENCE_ESCALATION_THRESHOLD} — re-running with ${STRONG_MODEL}`,
    );
    try {
      const strongWritten = await runWriter({
        plan,
        caseState,
        retrieved,
        facts,
        shop,
        actionProposals: actionDecision.proposals,
        policyContext,
        model: STRONG_MODEL,
      });

      if (strongWritten.draft_text) {
        const strongVerified = await runVerifier({
          draftText: strongWritten.draft_text,
          proposedActions: actionDecision.proposals,
          citations: strongWritten.citations,
          facts,
          retrievedChunks: retrieved.chunks,
        });

        if (strongVerified.confidence >= verified.confidence) {
          finalDraft = strongWritten.draft_text;
          finalConfidence = strongVerified.confidence;
          console.log(
            `[generate-draft-v2] strong model improved confidence: ${verified.confidence} → ${strongVerified.confidence}`,
          );
        }
      }
    } catch (err) {
      console.warn("[generate-draft-v2] strong model escalation failed:", err);
    }
  }

  if (verified.block_send) {
    console.warn(
      `[generate-draft-v2] verifier blocked send — confidence: ${finalConfidence}`,
    );
  }

  return {
    draft_text: finalDraft,
    proposed_actions: actionDecision.proposals,
    routing_hint: actionDecision.routing_hint,
    confidence: finalConfidence,
    sources: retrieved.chunks.slice(0, 5).map((c) => ({
      content: c.content.slice(0, 200),
      kind: c.kind,
      source_label: c.source_label,
    })),
  };
}
