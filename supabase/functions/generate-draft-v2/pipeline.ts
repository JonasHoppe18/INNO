// supabase/functions/generate-draft-v2/pipeline.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { runGate } from "./stages/gate.ts";
import { updateCaseState } from "./stages/case-state-updater.ts";
import { runPlanner } from "./stages/planner.ts";
import { runRetriever } from "./stages/retriever.ts";
import { runFactResolver } from "./stages/fact-resolver.ts";
import { runActionDecision, ActionProposal } from "./stages/action-decision.ts";
import { runWriter } from "./stages/writer.ts";
import { runVerifier } from "./stages/verifier.ts";
import { buildPinnedPolicyContext, PolicyIntent } from "../_shared/policy-context.ts";

export interface EvalPayload {
  subject: string;
  body: string;
  from_email?: string;
}

export interface PipelineInput {
  thread_id?: string;
  message_id?: string;
  shop_id: string;
  supabase: SupabaseClient;
  eval_payload?: EvalPayload;
}

export interface PipelineResult {
  draft_text: string | null;
  proposed_actions: ActionProposal[];
  routing_hint: "auto" | "review" | "block";
  is_test_mode: boolean;
  confidence: number;
  sources: Array<{ content: string; kind: string; source_label: string }>;
  skipped?: boolean;
  skip_reason?: string;
}

const STRONG_MODEL = Deno.env.get("OPENAI_STRONG_MODEL") ?? "gpt-4o";
const CONFIDENCE_ESCALATION_THRESHOLD = 0.6;

// Maps action type to the automation flag that must be enabled for auto-execution.
// Returns true if the action needs approval (flag is disabled or flag doesn't exist).
function actionNeedsApproval(
  type: string,
  automation: { order_updates: boolean; cancel_orders: boolean; automatic_refunds: boolean },
): boolean {
  switch (type) {
    case "update_shipping_address":
    case "change_shipping_method":
    case "hold_fulfillment":
    case "release_fulfillment":
    case "edit_line_items":
    case "update_customer_contact":
    case "initiate_return":
      return !automation.order_updates;
    case "cancel_order":
      return !automation.cancel_orders;
    case "refund_order":
      return !automation.automatic_refunds;
    case "create_exchange_request":
      return true; // exchanges always need human approval
    default:
      // Low-risk annotation actions (add_note, add_tag) never need approval
      if (["add_note", "add_tag", "lookup_order_status", "fetch_tracking"].includes(type)) {
        return false;
      }
      return true; // unknown action types default to requiring approval
  }
}

// Apply shop automation flags + test_mode to the raw action-decision result.
// Returns updated proposals with correct requires_approval and the effective routing_hint.
function applyAutomationConstraints(
  proposals: ActionProposal[],
  aiRoutingHint: "auto" | "review" | "block",
  automation: { order_updates: boolean; cancel_orders: boolean; automatic_refunds: boolean },
  isTestMode: boolean,
): { proposals: ActionProposal[]; routing_hint: "auto" | "review" | "block" } {
  if (aiRoutingHint === "block") {
    return { proposals, routing_hint: "block" };
  }

  // Apply automation flags to each proposal
  const updatedProposals = proposals.map((p) => ({
    ...p,
    requires_approval: p.requires_approval || actionNeedsApproval(p.type, automation),
  }));

  // Test mode: actions are shown but never executed in Shopify — always review
  if (isTestMode) {
    return {
      proposals: updatedProposals,
      routing_hint: "review",
    };
  }

  // If any action needs approval (either by business logic or disabled flag), routing = review
  if (updatedProposals.some((p) => p.requires_approval)) {
    return { proposals: updatedProposals, routing_hint: "review" };
  }

  // All actions are approved by business logic AND automation flags — honour AI hint
  return { proposals: updatedProposals, routing_hint: aiRoutingHint };
}

export async function runDraftV2Pipeline(input: PipelineInput): Promise<PipelineResult> {
  const { thread_id, shop_id, supabase, eval_payload } = input;

  // 1. Load context — either from DB (normal) or from eval_payload (eval mode)
  let thread: Record<string, unknown>;
  let shop: Record<string, unknown>;
  let messages: Record<string, unknown>[];
  let latestMessage: Record<string, unknown>;

  if (eval_payload) {
    // Eval mode: synthetic context from raw email data, no real thread needed
    const shopResult = await supabase.from("shops").select("*").eq("id", shop_id).single();
    if (!shopResult.data) {
      return { draft_text: null, proposed_actions: [], routing_hint: "block", is_test_mode: false, confidence: 0, sources: [], skipped: true, skip_reason: "shop_not_found" };
    }
    shop = shopResult.data;
    thread = { id: "eval", subject: eval_payload.subject, from_email: eval_payload.from_email ?? "eval@eval.internal" };
    latestMessage = { id: "eval", clean_body_text: eval_payload.body, body_text: eval_payload.body, from_me: false, created_at: new Date().toISOString() };
    messages = [latestMessage];
  } else {
    // Normal mode: load from DB
    const [threadResult, shopResult, messagesResult] = await Promise.all([
      supabase.from("mail_threads").select("*").eq("id", thread_id).single(),
      supabase.from("shops").select("*").eq("id", shop_id).single(),
      supabase.from("mail_messages").select("*").eq("thread_id", thread_id).order("created_at", { ascending: true }),
    ]);

    if (!threadResult.data || !shopResult.data) {
      return { draft_text: null, proposed_actions: [], routing_hint: "block", is_test_mode: false, confidence: 0, sources: [], skipped: true, skip_reason: "thread_or_shop_not_found" };
    }

    thread = threadResult.data;
    shop = shopResult.data;
    messages = messagesResult.data ?? [];

    if (messages.length === 0) {
      return { draft_text: null, proposed_actions: [], routing_hint: "block", is_test_mode: false, confidence: 0, sources: [], skipped: true, skip_reason: "no_messages" };
    }

    latestMessage = messages[messages.length - 1];
  }

  if (!latestMessage && !eval_payload) {
    return {
      draft_text: null,
      proposed_actions: [],
      routing_hint: "block",
      is_test_mode: false,
      confidence: 0,
      sources: [],
      skipped: true,
      skip_reason: "no_messages",
    };
  }

  // 2. Gate — skipped in eval mode
  if (!eval_payload) {
    const gate = await runGate({ thread, latestMessage, shop });
    if (!gate.should_process) {
      console.log(`[generate-draft-v2] gate blocked: ${gate.reason}`);
      return {
        draft_text: null,
        proposed_actions: [],
        routing_hint: "block",
        is_test_mode: false,
        confidence: 0,
        sources: [],
        skipped: true,
        skip_reason: gate.reason,
      };
    }
  }

  // 3. Load automation flags + test_mode in parallel with case state
  const workspaceId = (shop as Record<string, unknown>).workspace_id as string | null ?? null;

  const [caseState, automationResult, testModeResult, personaResult] = await Promise.all([
    updateCaseState({ thread, messages, shop, supabase }),

    // agent_automation flags: order_updates, cancel_orders, automatic_refunds
    workspaceId
      ? supabase
          .from("agent_automation")
          .select("order_updates,cancel_orders,automatic_refunds")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    // test_mode lives on workspaces table
    workspaceId
      ? supabase
          .from("workspaces")
          .select("test_mode")
          .eq("id", workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    // Shop's custom AI persona — webshoppen konfigurerer dette selv i indstillinger
    workspaceId
      ? supabase
          .from("workspace_agent_settings")
          .select("persona_instructions,persona_scenario")
          .eq("workspace_id", workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const automation = {
    order_updates: automationResult.data?.order_updates === true,
    cancel_orders: automationResult.data?.cancel_orders === true,
    automatic_refunds: automationResult.data?.automatic_refunds === true,
  };
  const isTestMode = testModeResult.data?.test_mode === true;

  // Webshoppen's eget AI-prompt — konfigureres i indstillinger under "Assistent"
  const shopWithPersona = {
    ...shop,
    persona_instructions: personaResult.data?.persona_instructions ?? null,
    persona_scenario: personaResult.data?.persona_scenario ?? null,
  };

  // 4. Plan — bestem intent, hvad der skal hentes, hvilke facts der kræves
  const plan = await runPlanner({ caseState, latestMessage, shop });

  // 5. Retrieve + resolve facts parallelt (uafhængige)
  const [retrieved, facts] = await Promise.all([
    runRetriever({ plan, shop_id, supabase }),
    runFactResolver({ plan, caseState, thread, shop, supabase }),
  ]);

  // 6. Deterministisk action-decision baseret på plan + caseState + facts
  const actionDecision = await runActionDecision({ plan, caseState, facts });

  // 7. Anvend shop automation-flags — overskriv requires_approval og routing_hint
  const { proposals: finalProposals, routing_hint: effectiveRoutingHint } =
    applyAutomationConstraints(
      actionDecision.proposals,
      actionDecision.routing_hint,
      automation,
      isTestMode,
    );

  if (isTestMode) {
    console.log("[generate-draft-v2] workspace is in test_mode — actions will NOT mutate Shopify");
  }

  // 8. Byg shop policy-kontekst deterministisk (pinned — altid med i prompten)
  const latestBody = (latestMessage.clean_body_text ?? latestMessage.body_text ?? "") as string;
  const subject = (thread.subject ?? "") as string;

  // Map planner intent → PolicyIntent so policy block matches what the planner decided
  const plannerIntentMap: Record<string, PolicyIntent> = {
    tracking: "SHIPPING",
    return: "RETURN",
    refund: "REFUND",
    exchange: "OTHER",   // exchange → OTHER suppresses return-specific rules
    address_change: "OTHER",
    cancel: "OTHER",
    product_question: "OTHER",
    complaint: "OTHER",
    thanks: "OTHER",
    other: "OTHER",
  };
  const intentOverride = plannerIntentMap[plan.primary_intent] ?? undefined;

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
    intentOverride,
  });

  const latestCustomerMessage = (latestMessage.clean_body_text ?? latestMessage.body_text ?? "") as string;

  // Byg samtalehistorik fra messages — ekskludér den seneste besked (vises separat)
  const conversationHistory = messages.slice(0, -1).map((m) => {
    const msg = m as { clean_body_text?: string; body_text?: string; direction?: string; from_me?: boolean };
    const isAgent = msg.direction === "outbound" || msg.from_me === true;
    return {
      role: isAgent ? "agent" as const : "customer" as const,
      text: (msg.clean_body_text ?? msg.body_text ?? "") as string,
    };
  }).filter((m) => m.text.length > 0);

  // 9. Skriv første draft med gpt-4o-mini
  const written = await runWriter({
    plan,
    caseState,
    retrieved,
    facts,
    shop: shopWithPersona,
    latestCustomerMessage,
    conversationHistory,
    actionProposals: finalProposals,
    policyContext,
  });

  // 10. Verificér grounding og kvalitet
  const verified = await runVerifier({
    draftText: written.draft_text,
    proposedActions: finalProposals,
    citations: written.citations,
    facts,
    retrievedChunks: retrieved.chunks,
    customerMessage: latestCustomerMessage,
    language: caseState.language,
  });

  let finalDraft = written.draft_text;
  let finalConfidence = verified.confidence;

  // 11. Eskalér til gpt-4o hvis verifier flagger lav confidence
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
        shop: shopWithPersona,
        latestCustomerMessage,
        conversationHistory,
        actionProposals: finalProposals,
        policyContext,
        model: STRONG_MODEL,
      });

      if (strongWritten.draft_text) {
        const strongVerified = await runVerifier({
          draftText: strongWritten.draft_text,
          proposedActions: finalProposals,
          citations: strongWritten.citations,
          facts,
          retrievedChunks: retrieved.chunks,
          customerMessage: latestCustomerMessage,
          language: caseState.language,
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
    proposed_actions: finalProposals,
    routing_hint: effectiveRoutingHint,
    is_test_mode: isTestMode,
    confidence: finalConfidence,
    sources: retrieved.chunks.slice(0, 5).map((c) => ({
      content: c.content.slice(0, 200),
      kind: c.kind,
      source_label: c.source_label,
    })),
  };
}
