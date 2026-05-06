// supabase/functions/generate-draft-v2/pipeline.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { runGate } from "./stages/gate.ts";
import { updateCaseState } from "./stages/case-state-updater.ts";
import { runPlanner } from "./stages/planner.ts";
import { runRetriever } from "./stages/retriever.ts";
import { runFactResolver } from "./stages/fact-resolver.ts";
import {
  ActionProposal,
  runActionDecision,
  ShopActionConfig,
} from "./stages/action-decision.ts";
import { runWriter } from "./stages/writer.ts";
import { runVerifier } from "./stages/verifier.ts";
import {
  buildPinnedPolicyContext,
  PolicyIntent,
} from "../_shared/policy-context.ts";
import { loadImageAttachments } from "./stages/attachment-loader.ts";
import {
  cleanupMixedLanguageDraft,
  mixedLanguageCheck,
  resolveReplyLanguage,
} from "./stages/language.ts";

export interface EvalPayload {
  subject: string;
  body: string;
  from_email?: string;
  conversation_history?: string;
}

export interface PipelineInput {
  thread_id?: string;
  message_id?: string;
  shop_id: string;
  supabase: SupabaseClient;
  customer_context?: Record<string, unknown> | null;
  eval_payload?: EvalPayload;
  eval_options?: {
    writer_model?: string;
    strong_model?: string;
    disable_escalation?: boolean;
  };
}

export interface KnowledgeGap {
  gap_type: "missing_procedure" | "missing_policy" | "low_kb_coverage" | "low_grounding";
  intent: string;
  suggested_title: string;
  suggested_content_hint: string;
  tickets_affected?: number;
}

export interface PipelineResult {
  draft_text: string | null;
  draft_id?: string;
  proposed_actions: ActionProposal[];
  routing_hint: "auto" | "review" | "block";
  is_test_mode: boolean;
  confidence: number;
  sources: Array<{
    content: string;
    kind: string;
    source_label: string;
    usable_as?: string;
    risk_flags?: string[];
  }>;
  knowledge_gaps: KnowledgeGap[];
  skipped?: boolean;
  skip_reason?: string;
}

const STRONG_MODEL = Deno.env.get("OPENAI_STRONG_MODEL") ?? "gpt-5-mini";
const SIMPLE_MODEL = Deno.env.get("OPENAI_SIMPLE_MODEL") ?? "gpt-4o-mini";
const CONFIDENCE_ESCALATION_THRESHOLD = 0.6;

// Simple intents get gpt-4o-mini — cheaper, fast enough for straightforward replies.
// Everything else uses gpt-5-mini.
const SIMPLE_INTENTS = new Set(["thanks", "tracking"]);

function resolveWriterModel(
  intent: string,
  hasOrderFacts: boolean,
  overrideModel?: string,
): string {
  if (overrideModel) return overrideModel;
  // tracking only qualifies as simple when we actually found the order —
  // otherwise there's nothing to report and the model needs to improvise.
  if (intent === "thanks") return SIMPLE_MODEL;
  if (intent === "tracking" && hasOrderFacts) return SIMPLE_MODEL;
  return Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini";
}

const INTENT_GAP_SUGGESTIONS: Record<string, { title: string; hint: string }> = {
  exchange: {
    title: "Procedure: Warranty replacement — confirmation response",
    hint: "Describe what happens after a customer confirms their details for a warranty replacement: we create an order and send a tracking link. Include expected delivery time and what the customer should expect.",
  },
  refund: {
    title: "Procedure: Refund process",
    hint: "Describe what happens when a refund is approved: processing time, payment method, when the customer receives the money.",
  },
  return: {
    title: "Procedure: Return process",
    hint: "Describe the return process step-by-step: who pays for shipping, how the item is returned, when the customer receives a refund or replacement.",
  },
  tracking: {
    title: "Procedure: Shipping and delivery",
    hint: "Describe what happens if a package is delayed or delivered incorrectly. Include expected delivery time and when we escalate to the carrier.",
  },
  complaint: {
    title: "Procedure: Complaint handling",
    hint: "Describe how we handle complaints: what is offered to the customer, when we escalate, what the acceptable response is for strong dissatisfaction.",
  },
  technical_support: {
    title: "Procedure: Technical support — troubleshooting steps",
    hint: "Add complete step-by-step troubleshooting guides for your products. Include ALL steps — incomplete guides produce poor answers.",
  },
  warranty: {
    title: "Procedure: Warranty handling",
    hint: "Describe the warranty process: what information is required (order number, photo), what is offered (replacement/refund), what the warranty period is.",
  },
  cancel: {
    title: "Procedure: Cancellation process",
    hint: "Describe when an order can be cancelled, what happens to the payment, and what is communicated to the customer.",
  },
};

function detectKnowledgeGaps(
  intent: string,
  verifierIssues: string[],
  groundedClaimsPct: number,
  chunkCount: number,
  policyChunkCount: number,
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];
  const suggestion = INTENT_GAP_SUGGESTIONS[intent];

  // No relevant KB chunks at all for this intent
  if (chunkCount === 0 && !["thanks", "other"].includes(intent)) {
    gaps.push({
      gap_type: "low_kb_coverage",
      intent,
      suggested_title: suggestion?.title ?? `Procedure: ${intent}`,
      suggested_content_hint: suggestion?.hint ??
        `Add knowledge about how to handle '${intent}' inquiries.`,
    });
    return gaps;
  }

  // Reply missing commitment AND doesn't answer the question — missing procedure
  if (
    verifierIssues.includes("no_commitment") &&
    verifierIssues.includes("answers_question_missing") &&
    suggestion
  ) {
    gaps.push({
      gap_type: "missing_procedure",
      intent,
      suggested_title: suggestion.title,
      suggested_content_hint: suggestion.hint,
    });
  }

  // Low grounding — AI guessing instead of using KB
  if (groundedClaimsPct < 0.45 && chunkCount < 3) {
    gaps.push({
      gap_type: "low_grounding",
      intent,
      suggested_title: suggestion?.title ?? `More detail needed: ${intent}`,
      suggested_content_hint: suggestion?.hint ??
        `Sona made claims not backed by the knowledge base. Add more specific information about '${intent}'.`,
    });
  }

  // Missing policy for intents that require one
  if (
    policyChunkCount === 0 &&
    ["refund", "return", "exchange", "warranty", "cancel"].includes(intent)
  ) {
    gaps.push({
      gap_type: "missing_policy",
      intent,
      suggested_title: `Policy: ${intent === "refund" ? "Refund policy" : intent === "return" ? "Return policy" : intent === "warranty" ? "Warranty terms" : "Cancellation policy"}`,
      suggested_content_hint:
        `Add your official policy for '${intent}' so Sona can cite it correctly in replies.`,
    });
  }

  return gaps;
}

function parseEvalConversationHistory(
  history?: string,
): Record<string, unknown>[] {
  const text = String(history || "").trim();
  if (!text) return [];

  const messages: Record<string, unknown>[] = [];
  const pattern = /(?:^|\n)(Customer|Kunde|Agent|Support):\s*/gi;
  const matches = [...text.matchAll(pattern)];
  if (!matches.length) return [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const next = matches[i + 1];
    const role = String(match[1] || "").toLowerCase();
    const start = (match.index ?? 0) + match[0].length;
    const end = next?.index ?? text.length;
    const body = text.slice(start, end).trim();
    if (!body) continue;
    const isAgent = role === "agent" || role === "support";
    messages.push({
      id: `eval-history-${i}`,
      clean_body_text: body,
      body_text: body,
      from_me: isAgent,
      direction: isAgent ? "outbound" : "inbound",
      created_at: new Date(Date.now() - (matches.length - i) * 1000)
        .toISOString(),
    });
  }

  return messages;
}

// Maps action type to the automation flag that must be enabled for auto-execution.
// Returns true if the action needs approval (flag is disabled or flag doesn't exist).
function actionNeedsApproval(
  type: string,
  automation: {
    order_updates: boolean;
    cancel_orders: boolean;
    automatic_refunds: boolean;
  },
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
      if (
        ["add_note", "add_tag", "lookup_order_status", "fetch_tracking"]
          .includes(type)
      ) {
        return false;
      }
      return true; // unknown action types default to requiring approval
  }
}

// Apply shop automation flags + test_mode to the raw action-decision result.
// Returns updated proposals with correct requires_approval and the effective routing_hint.
export function applyAutomationConstraints(
  proposals: ActionProposal[],
  aiRoutingHint: "auto" | "review" | "block",
  automation: {
    order_updates: boolean;
    cancel_orders: boolean;
    automatic_refunds: boolean;
  },
  isTestMode: boolean,
): { proposals: ActionProposal[]; routing_hint: "auto" | "review" | "block" } {
  if (aiRoutingHint === "block") {
    return { proposals, routing_hint: "block" };
  }

  // Apply automation flags to each proposal
  const updatedProposals = proposals.map((p) => ({
    ...p,
    requires_approval: p.requires_approval ||
      actionNeedsApproval(p.type, automation),
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

export function shouldDeferDraftUntilActionDecision(
  proposals: ActionProposal[],
  routingHint: "auto" | "review" | "block",
): boolean {
  return proposals.length > 0 && routingHint === "review";
}

export async function runDraftV2Pipeline(
  input: PipelineInput,
): Promise<PipelineResult> {
  const {
    thread_id,
    shop_id,
    supabase,
    customer_context,
    eval_payload,
    eval_options,
  } = input;
  const draftId = crypto.randomUUID();

  const writerModelOverride = eval_payload
    ? eval_options?.writer_model
    : undefined;
  const strongModelOverride = eval_payload
    ? eval_options?.strong_model
    : undefined;
  const disableEscalation = eval_payload
    ? eval_options?.disable_escalation === true
    : false;

  // 1. Load context — either from DB (normal) or from eval_payload (eval mode)
  let thread: Record<string, unknown>;
  let shop: Record<string, unknown>;
  let messages: Record<string, unknown>[];
  let latestMessage: Record<string, unknown>;

  if (eval_payload) {
    // Eval mode: synthetic context from raw email data, no real thread needed
    const shopResult = await supabase.from("shops").select("*").eq(
      "id",
      shop_id,
    ).single();
    if (!shopResult.data) {
      return {
        draft_text: null,
        proposed_actions: [],
        routing_hint: "block",
        is_test_mode: false,
        confidence: 0,
        sources: [],
        skipped: true,
        skip_reason: "shop_not_found",
        knowledge_gaps: [],
      };
    }
    shop = shopResult.data;
    thread = {
      id: "eval",
      subject: eval_payload.subject,
      from_email: eval_payload.from_email ?? "eval@eval.internal",
    };
    latestMessage = {
      id: "eval",
      clean_body_text: eval_payload.body,
      body_text: eval_payload.body,
      from_me: false,
      created_at: new Date().toISOString(),
    };
    messages = [
      ...parseEvalConversationHistory(eval_payload.conversation_history),
      latestMessage,
    ];
  } else {
    // Normal mode: load from DB
    const [threadResult, shopResult, messagesResult] = await Promise.all([
      supabase.from("mail_threads").select("*").eq("id", thread_id).single(),
      supabase.from("shops").select("*").eq("id", shop_id).single(),
      supabase.from("mail_messages").select("*").eq("thread_id", thread_id)
        .order("created_at", { ascending: true }),
    ]);

    if (!threadResult.data || !shopResult.data) {
      return {
        draft_text: null,
        proposed_actions: [],
        routing_hint: "block",
        is_test_mode: false,
        confidence: 0,
        sources: [],
        skipped: true,
        skip_reason: "thread_or_shop_not_found",
        knowledge_gaps: [],
      };
    }

    thread = threadResult.data;
    shop = shopResult.data;
    messages = messagesResult.data ?? [];

    if (messages.length === 0) {
      return {
        draft_text: null,
        proposed_actions: [],
        routing_hint: "block",
        is_test_mode: false,
        confidence: 0,
        sources: [],
        skipped: true,
        skip_reason: "no_messages",
        knowledge_gaps: [],
      };
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
      knowledge_gaps: [],
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
        knowledge_gaps: [],
      };
    }
  }

  // 3. Load automation flags + test_mode in parallel with case state
  const workspaceId =
    (shop as Record<string, unknown>).workspace_id as string | null ?? null;

  const [caseState, automationResult, testModeResult, personaResult] =
    await Promise.all([
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
  const latestBody =
    (latestMessage.clean_body_text ?? latestMessage.body_text ?? "") as string;

  if (!eval_payload && thread_id) {
    supabase.from("agent_logs").insert({
      draft_id: draftId,
      step_name: "draft_intent_assessed",
      step_detail: JSON.stringify({
        thread_id,
        primary_intent: plan.primary_intent,
        language: plan.language,
        confidence: plan.confidence,
      }),
      status: "info",
      created_at: new Date().toISOString(),
    }).then(({ error }) => {
      if (error) {
        console.warn(
          "[pipeline] draft_intent_assessed log failed:",
          error.message,
        );
      }
    });
  }

  // 5. Retrieve + resolve facts parallelt (uafhængige)
  const [retrieved, facts] = await Promise.all([
    runRetriever({
      plan,
      shop_id,
      workspace_id: workspaceId,
      customerMessage: latestBody,
      shop,
      supabase,
    }),
    runFactResolver({
      plan,
      caseState,
      thread,
      shop,
      supabase,
      customerContext: customer_context,
    }),
  ]);

  if (!eval_payload && thread_id) {
    supabase.from("agent_logs").insert({
      draft_id: draftId,
      step_name: "draft_context_loaded",
      step_detail: JSON.stringify({
        thread_id,
        order_found: !!facts.order,
        order_number: facts.order?.name ?? null,
        facts_count: facts.facts?.length ?? 0,
      }),
      status: facts.order ? "success" : "info",
      created_at: new Date().toISOString(),
    }).then(({ error }) => {
      if (error) {
        console.warn(
          "[pipeline] draft_context_loaded log failed:",
          error.message,
        );
      }
    });
  }

  // 6. Deterministisk action-decision med per-shop config + KB-overrides
  // Læs shop action_config (JSONB) — giver per-shop tilpasning uden kodeændringer.
  const rawActionConfig = (shop as Record<string, unknown>).action_config;
  const shopActionConfig: ShopActionConfig =
    (rawActionConfig && typeof rawActionConfig === "object" &&
        !Array.isArray(rawActionConfig))
      ? rawActionConfig as ShopActionConfig
      : {};

  const actionDecision = await runActionDecision({
    plan,
    caseState,
    facts,
    retrieved, // KB-chunks til at tolke shop-specifikke procedurer
    shopConfig: shopActionConfig,
  });

  // 7. Anvend shop automation-flags — overskriv requires_approval og routing_hint
  const { proposals: finalProposals, routing_hint: effectiveRoutingHint } =
    applyAutomationConstraints(
      actionDecision.proposals,
      actionDecision.routing_hint,
      automation,
      isTestMode,
    );

  if (isTestMode) {
    console.log(
      "[generate-draft-v2] workspace is in test_mode — actions will NOT mutate Shopify",
    );
  }

  const latestCustomerMessage =
    (latestMessage.clean_body_text ?? latestMessage.body_text ?? "") as string;
  const replyLanguage = resolveReplyLanguage(
    latestCustomerMessage,
    plan.language || caseState.language,
  );

  const shouldWaitForActionDecision = shouldDeferDraftUntilActionDecision(
    finalProposals,
    effectiveRoutingHint,
  ) && !eval_payload;

  if (shouldWaitForActionDecision) {
    if (!eval_payload && thread_id) {
      const ownerUserId =
        (shop as Record<string, unknown>).owner_user_id as string | null ??
          null;
      const nowIso = new Date().toISOString();
      const order = facts.order;
      const draftThreadKey =
        (thread as Record<string, unknown>).provider_thread_id as
          | string
          | null ??
          thread_id;

      await supabase
        .from("thread_actions")
        .update({ status: "superseded", updated_at: nowIso })
        .eq("thread_id", thread_id)
        .eq("status", "pending")
        .then(({ error }) => {
          if (error) {
            console.warn(
              "[pipeline] thread_actions supersede failed:",
              error.message,
            );
          }
        });

      let firstActionId: string | null = null;
      for (const proposal of finalProposals) {
        const { data: insertedAction, error: insertError } = await supabase
          .from("thread_actions")
          .insert({
            workspace_id: workspaceId,
            user_id: ownerUserId ?? null,
            thread_id,
            action_type: proposal.type,
            action_key: `${proposal.type}_${thread_id}_${nowIso}`,
            status: "pending",
            detail: proposal.reason,
            payload: { ...proposal.params, _confidence: proposal.confidence },
            order_id: order?.id ? String(order.id) : null,
            order_number: order?.name ?? null,
            source: "automation",
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select("id")
          .maybeSingle();
        if (insertError) {
          console.warn(
            "[pipeline] thread_actions insert failed:",
            insertError.message,
          );
        }
        if (!firstActionId && insertedAction?.id) {
          firstActionId = String(insertedAction.id);
        }
      }

      if (workspaceId && shop_id) {
        await supabase
          .from("drafts")
          .update({ status: "superseded" })
          .eq("thread_id", draftThreadKey)
          .eq("workspace_id", workspaceId)
          .eq("status", "pending");

        const { error: draftInsertError } = await supabase
          .from("drafts")
          .insert({
            id: draftId,
            shop_id,
            workspace_id: workspaceId,
            thread_id: draftThreadKey,
            platform: "smtp",
            status: "pending",
            kind: "internal_recommendation",
            execution_state: "pending_approval",
            source_action_id: firstActionId,
            ai_draft_text: null,
            created_at: nowIso,
          });
        if (draftInsertError) {
          console.warn(
            "[pipeline] drafts insert failed:",
            draftInsertError.message,
          );
        }
      }
    }

    return {
      draft_text: null,
      draft_id: eval_payload ? undefined : draftId,
      proposed_actions: finalProposals,
      routing_hint: effectiveRoutingHint,
      is_test_mode: isTestMode,
      confidence: plan.confidence,
      knowledge_gaps: [],
      sources: retrieved.chunks.slice(0, 5).map((c) => ({
        content: c.content.slice(0, 200),
        kind: c.kind,
        source_label: c.source_label,
        usable_as: c.usable_as,
        risk_flags: c.risk_flags,
      })),
    };
  }

  // 8. Byg shop policy-kontekst deterministisk (pinned — altid med i prompten)
  const subject = (thread.subject ?? "") as string;

  // Map planner intent → PolicyIntent so policy block matches what the planner decided
  const plannerIntentMap: Record<string, PolicyIntent> = {
    tracking: "SHIPPING",
    return: "RETURN",
    refund: "REFUND",
    exchange: "OTHER", // exchange → OTHER suppresses return-specific rules
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
      policy_refund:
        (shop as Record<string, unknown>).policy_refund as string ?? null,
      policy_shipping:
        (shop as Record<string, unknown>).policy_shipping as string ?? null,
      policy_terms: (shop as Record<string, unknown>).policy_terms as string ??
        null,
      policy_summary_json:
        (shop as Record<string, unknown>).policy_summary_json ?? null,
    },
    reservedTokens: 800,
    intentOverride,
  });

  // Hent billedvedhæftninger for seneste kundebesked (tom liste i eval-mode)
  const latestMessageId = (latestMessage as Record<string, unknown>).id as
    | string
    | undefined;
  const imageAttachments = latestMessageId
    ? await loadImageAttachments(supabase, latestMessageId)
    : [];

  // Byg samtalehistorik fra messages — ekskludér den seneste besked (vises separat)
  const conversationHistory = messages.slice(0, -1).map((m) => {
    const msg = m as {
      clean_body_text?: string;
      body_text?: string;
      direction?: string;
      from_me?: boolean;
    };
    const isAgent = msg.direction === "outbound" || msg.from_me === true;
    return {
      role: isAgent ? "agent" as const : "customer" as const,
      text: (msg.clean_body_text ?? msg.body_text ?? "") as string,
    };
  }).filter((m) => m.text.length > 0);

  // 9. Skriv første draft — simple intents bruger gpt-4o-mini, resten gpt-5-mini
  const firstPassModel = resolveWriterModel(
    plan.primary_intent,
    !!facts.order,
    writerModelOverride,
  );
  console.log(`[generate-draft-v2] writer model: ${firstPassModel} (intent=${plan.primary_intent})`);
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
    model: firstPassModel,
    attachments: imageAttachments,
  });

  let languageCheckedWritten = written;
  const initialLanguageCheck = mixedLanguageCheck(
    languageCheckedWritten.draft_text,
    replyLanguage,
  );
  if (!initialLanguageCheck.ok) {
    console.warn(
      `[generate-draft-v2] mixed language detected before verifier: expected=${replyLanguage} foreign=${
        initialLanguageCheck.detectedForeignLanguages.join(",")
      } segments=${initialLanguageCheck.foreignSegments.join(" | ")}`,
    );
    try {
      const correctionWritten = await runWriter({
        plan,
        caseState,
        retrieved,
        facts,
        shop: shopWithPersona,
        latestCustomerMessage,
        conversationHistory,
        actionProposals: finalProposals,
        policyContext,
        model: firstPassModel,
        attachments: imageAttachments,
        languageCorrectionInstruction:
          `Rewrite the full draft in ${replyLanguage} only. Preserve the same facts, meaning, asks, and next steps. Do not add new information. Remove or translate these foreign-language segments: ${
            initialLanguageCheck.foreignSegments.join(" | ")
          }`,
      });
      if (correctionWritten.draft_text) {
        languageCheckedWritten = correctionWritten;
      }
    } catch (err) {
      console.warn(
        "[generate-draft-v2] language correction retry failed:",
        err,
      );
    }
  }

  const retryLanguageCheck = mixedLanguageCheck(
    languageCheckedWritten.draft_text,
    replyLanguage,
  );
  if (!retryLanguageCheck.ok) {
    languageCheckedWritten = {
      ...languageCheckedWritten,
      draft_text: cleanupMixedLanguageDraft(
        languageCheckedWritten.draft_text,
        replyLanguage,
      ),
    };
  }

  // 10. Verificér grounding og kvalitet
  const verified = await runVerifier({
    draftText: languageCheckedWritten.draft_text,
    proposedActions: finalProposals,
    citations: languageCheckedWritten.citations,
    facts,
    retrievedChunks: retrieved.chunks,
    customerMessage: latestCustomerMessage,
    language: replyLanguage,
  });

  let finalDraft = languageCheckedWritten.draft_text;
  let finalConfidence = verified.confidence;
  let finalRoutingHint = effectiveRoutingHint;

  if (!mixedLanguageCheck(finalDraft, replyLanguage).ok) {
    finalConfidence = Math.min(finalConfidence, 0.62);
    finalRoutingHint = "review";
  }

  // 11. Eskalér til gpt-5-mini hvis verifier flagger lav confidence
  if (
    !disableEscalation && verified.retry_with_stronger_model &&
    !verified.block_send
  ) {
    const escalationModel = strongModelOverride ?? STRONG_MODEL;
    console.log(
      `[generate-draft-v2] confidence ${verified.confidence} < ${CONFIDENCE_ESCALATION_THRESHOLD} — re-running with ${escalationModel}`,
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
        model: escalationModel,
        attachments: imageAttachments,
      });

      if (strongWritten.draft_text) {
        let strongDraftText = strongWritten.draft_text;
        if (!mixedLanguageCheck(strongDraftText, replyLanguage).ok) {
          strongDraftText = cleanupMixedLanguageDraft(
            strongDraftText,
            replyLanguage,
          );
        }
        const strongVerified = await runVerifier({
          draftText: strongDraftText,
          proposedActions: finalProposals,
          citations: strongWritten.citations,
          facts,
          retrievedChunks: retrieved.chunks,
          customerMessage: latestCustomerMessage,
          language: replyLanguage,
        });

        if (strongVerified.confidence >= verified.confidence) {
          finalDraft = strongDraftText;
          finalConfidence = strongVerified.confidence;
          if (!mixedLanguageCheck(finalDraft, replyLanguage).ok) {
            finalConfidence = Math.min(finalConfidence, 0.62);
            finalRoutingHint = "review";
          }
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

  const policyChunkCount = retrieved.chunks.filter((c) =>
    c.usable_as === "policy"
  ).length;
  const knowledgeGaps = detectKnowledgeGaps(
    plan.primary_intent,
    verified.issues,
    verified.grounded_claims_pct,
    retrieved.chunks.length,
    policyChunkCount,
  );
  if (knowledgeGaps.length > 0) {
    console.log(
      `[generate-draft-v2] knowledge gaps detected: ${
        knowledgeGaps.map((g) => g.gap_type + "/" + g.intent).join(", ")
      }`,
    );
  }

  const deferDraftUntilActionDecision = shouldDeferDraftUntilActionDecision(
    finalProposals,
    finalRoutingHint,
  ) && !eval_payload;

  // Persist til DB (kun i normal mode — ikke eval mode)
  if (!eval_payload && thread_id && finalDraft) {
    const ownerUserId =
      (shop as Record<string, unknown>).owner_user_id as string | null ?? null;
    const nowIso = new Date().toISOString();
    const draftThreadKey =
      (thread as Record<string, unknown>).provider_thread_id as string | null ??
        thread_id;

    // 1. Gem draft tekst på den seneste inbound besked → composeren viser den.
    // Ved action approval må kundesvaret først genereres efter approve/decline.
    const latestInbound = messages
      .filter((m) => !(m as Record<string, unknown>).from_me)
      .at(-1) as Record<string, unknown> | undefined;

    if (latestInbound?.id && !deferDraftUntilActionDecision) {
      supabase
        .from("mail_messages")
        .update({ ai_draft_text: finalDraft, updated_at: nowIso })
        .eq("id", latestInbound.id as string)
        .then(({ error }) => {
          if (error) {
            console.warn(
              "[pipeline] ai_draft_text update failed:",
              error.message,
            );
          }
        });
    }

    // 2. Gem proposed actions i thread_actions → action cards i inbox
    if (finalProposals.length > 0) {
      const order = facts.order;

      // Superseder eksisterende pending actions for denne tråd
      // før vi indsætter nye — undgår duplikater
      await supabase
        .from("thread_actions")
        .update({ status: "superseded", updated_at: nowIso })
        .eq("thread_id", thread_id)
        .eq("status", "pending")
        .then(({ error }) => {
          if (error) {
            console.warn(
              "[pipeline] thread_actions supersede failed:",
              error.message,
            );
          }
        });

      for (const proposal of finalProposals) {
        const status = deferDraftUntilActionDecision
          ? "pending"
          : isTestMode
          ? "approved_test_mode"
          : "pending";

        const { error: insertError } = await supabase
          .from("thread_actions")
          .insert({
            workspace_id: workspaceId,
            user_id: ownerUserId ?? null,
            thread_id,
            action_type: proposal.type,
            action_key: `${proposal.type}_${thread_id}_${nowIso}`,
            status,
            detail: proposal.reason,
            payload: { ...proposal.params, _confidence: proposal.confidence },
            order_id: order?.id ? String(order.id) : null,
            order_number: order?.name ?? null,
            source: "automation",
            created_at: nowIso,
            updated_at: nowIso,
          });
        if (insertError) {
          console.warn(
            "[pipeline] thread_actions insert failed:",
            insertError.message,
          );
        }
      }
    }

    // 3. Log draft i drafts tabel → edit-distance tracking
    // Superseder eksisterende pending drafts for denne tråd, indsætter ny
    if (workspaceId && shop_id) {
      await supabase
        .from("drafts")
        .update({ status: "superseded" })
        .eq("thread_id", draftThreadKey)
        .eq("workspace_id", workspaceId)
        .eq("status", "pending");

      const { error: draftInsertError } = await supabase
        .from("drafts")
        .insert({
          id: draftId,
          shop_id,
          workspace_id: workspaceId,
          thread_id: draftThreadKey,
          platform: "smtp",
          status: "pending",
          kind: deferDraftUntilActionDecision
            ? "internal_recommendation"
            : "final_customer_reply",
          execution_state: deferDraftUntilActionDecision
            ? "pending_approval"
            : "no_action",
          ai_draft_text: deferDraftUntilActionDecision ? null : finalDraft,
          created_at: nowIso,
        });
      if (draftInsertError) {
        console.warn(
          "[pipeline] drafts insert failed:",
          draftInsertError.message,
        );
      }
    }

    // 4. Log pipeline completion → "What did Sona do?" timeline
    const finalSourcesForLog = retrieved.chunks.slice(0, 5).map((c) => ({
      content: c.content.slice(0, 300),
      kind: c.kind,
      source_label: c.source_label,
    }));
    supabase.from("agent_logs").insert({
      draft_id: draftId,
      step_name: "draft_created",
      step_detail: JSON.stringify({
        thread_id,
        intent: plan.primary_intent,
        confidence: finalConfidence,
        routing_hint: finalRoutingHint,
        sources: finalSourcesForLog,
      }),
      status: "success",
      created_at: nowIso,
    }).then(({ error }) => {
      if (error) {
        console.warn("[pipeline] draft_created log failed:", error.message);
      }
    });

    // 5. Log knowledge gaps → webshoppen ser hvad der mangler
    if (knowledgeGaps.length > 0) {
      supabase.from("agent_logs").insert({
        draft_id: draftId,
        step_name: "knowledge_gap_detected",
        step_detail: JSON.stringify({
          thread_id,
          shop_id,
          gaps: knowledgeGaps,
          confidence: finalConfidence,
          intent: plan.primary_intent,
        }),
        status: "warning",
        created_at: nowIso,
      }).then(({ error }) => {
        if (error) {
          console.warn("[pipeline] knowledge_gap log failed:", error.message);
        }
      });
    }
  }

  return {
    draft_text: deferDraftUntilActionDecision ? null : finalDraft,
    draft_id: eval_payload ? undefined : draftId,
    proposed_actions: finalProposals,
    routing_hint: finalRoutingHint,
    is_test_mode: isTestMode,
    confidence: finalConfidence,
    knowledge_gaps: knowledgeGaps,
    sources: retrieved.chunks.slice(0, 5).map((c) => ({
      content: c.content.slice(0, 200),
      kind: c.kind,
      source_label: c.source_label,
      usable_as: c.usable_as,
      risk_flags: c.risk_flags,
    })),
  };
}
