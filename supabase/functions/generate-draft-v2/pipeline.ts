// supabase/functions/generate-draft-v2/pipeline.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { runGate } from "./stages/gate.ts";
import { updateCaseState } from "./stages/case-state-updater.ts";
import { runPlanner } from "./stages/planner.ts";
import { runRetriever } from "./stages/retriever.ts";
import { runInternalRules } from "./stages/internal-rules.ts";
import { runFactResolver } from "./stages/fact-resolver.ts";
import {
  ActionProposal,
  runActionDecision,
  ShopActionConfig,
} from "./stages/action-decision.ts";
import { buildRetrievalLogPayload } from "./stages/retrieval-log.ts";
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
  // When set, the retriever excludes this ticket from few-shot examples to
  // prevent data leakage where the AI finds its own correct answer in the KB.
  source_thread_id?: string;
}

export interface PipelineInput {
  thread_id?: string;
  message_id?: string;
  shop_id: string;
  supabase: SupabaseClient;
  customer_context?: Record<string, unknown> | null;
  action_result?: Record<string, unknown> | null;
  eval_payload?: EvalPayload;
  eval_options?: {
    writer_model?: string;
    strong_model?: string;
    disable_escalation?: boolean;
    // Retrieval coherence rules (default off → production unchanged).
    retrieval_abs_floor?: number | null;
    retrieval_pq_budget?: number | null;
    retrieval_issue_tiebreak?: boolean;
    retrieval_source_consolidate?: boolean;
  };
  // Preview mode only — agent_knowledge chunk ids that should be excluded from
  // retrieval. Used by the snippet preview A/B feature.
  exclude_chunk_ids?: string[];
}

export interface KnowledgeGap {
  gap_type:
    | "missing_procedure"
    | "missing_policy"
    | "low_kb_coverage"
    | "low_grounding";
  intent: string;
  suggested_title: string;
  suggested_content_hint: string;
  tickets_affected?: number;
}

export interface PipelineResult {
  draft_text: string | null;
  draft_id?: string;
  generation_id?: string;
  proposed_actions: ActionProposal[];
  routing_hint: "auto" | "review" | "block";
  is_test_mode: boolean;
  confidence: number;
  intent?: string;
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
  // Eval-only: full writer-facing chunk set for coherence measurement.
  // Present only when the pipeline runs in eval mode (eval_payload set).
  retrieval_debug?: {
    chunks: Array<{
      id: string;
      title: string;
      source_id: string | null;
      chunk_index: number | null;
      chunk_count: number;
      score: number;
      vector_similarity: number | null;
      kind: string;
      usable_as?: string;
      products: string[];
      issue_types: string[];
    }>;
    // Snippet-matcher trace (eval only). Mirrors RetrieverResult["matcher_debug"].
    matcher?: {
      candidates: Array<
        { id: string; source_id: string | null; title: string }
      >;
      ranked: Array<
        {
          id: string;
          source_id: string | null;
          title: string;
          relevance: number;
        }
      >;
      selected_ids: string[];
      abstained: boolean;
      fell_back: boolean;
    };
  };
}

const STRONG_MODEL = Deno.env.get("OPENAI_STRONG_MODEL") ?? "gpt-5-mini";
const SIMPLE_MODEL = Deno.env.get("OPENAI_SIMPLE_MODEL") ?? "gpt-4o-mini";
const CONFIDENCE_ESCALATION_THRESHOLD = 0.6;

function safeErrorMessage(err: unknown): string {
  const message = err instanceof Error
    ? err.message
    : String(err || "Unknown error");
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .slice(0, 800);
}

function compactRetrievedChunks(chunks: Array<Record<string, unknown>>) {
  return chunks.map((chunk) => ({
    id: chunk.id,
    source_id: chunk.source_id ?? null,
    source_label: chunk.source_label ?? null,
    source_title: chunk.source_title ?? null,
    kind: chunk.kind ?? null,
    usable_as: chunk.usable_as ?? null,
    similarity: chunk.similarity ?? null,
    vector_similarity: chunk.vector_similarity ?? null,
    chunk_index: chunk.chunk_index ?? null,
    chunk_count: chunk.chunk_count ?? null,
    products: chunk.products ?? [],
    issue_types: chunk.chunk_issue_types ?? [],
    risk_flags: chunk.risk_flags ?? [],
  }));
}

async function createDraftGenerationTrace(input: {
  supabase: SupabaseClient;
  id: string;
  shop_id: string;
  thread_id?: string;
  message_id?: string;
  draft_id: string;
}) {
  const { error } = await input.supabase.from("draft_generations").insert({
    id: input.id,
    shop_id: input.shop_id,
    thread_id: input.thread_id ?? null,
    message_id: input.message_id ?? null,
    draft_id: input.draft_id,
    pipeline_version: "v2",
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.warn("[draft-generation-trace] create failed:", error.message);
  }
}

async function updateDraftGenerationTrace(
  supabase: SupabaseClient,
  generationId: string,
  patch: Record<string, unknown>,
) {
  if (!generationId || Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from("draft_generations")
    .update(patch)
    .eq("id", generationId);
  if (error) {
    console.warn("[draft-generation-trace] update failed:", error.message);
  }
}

function detectPostActionDraftIssues(
  draftText: string,
  actionResult: Record<string, unknown> | null,
  replyLanguage = "en",
): string[] {
  if (!actionResult) return [];
  const text = String(draftText || "").toLowerCase();
  const actionType = String(actionResult.action_type || "");
  const issues: string[] = [];

  const pendingLanguagePatterns: Array<[RegExp, string]> = [
    [
      /\b(?:kan|kunne)\s+refundere\b/i,
      "uses refund capability language instead of completed refund language",
    ],
    [
      /\bcan\s+refund\b/i,
      "uses refund capability language instead of completed refund language",
    ],
    [
      /\b(?:vil|will|skal)\s+(?:refundere|refund)\b/i,
      "uses future refund language instead of completed refund language",
    ],
    [
      /\bvil\s+blive\s+refunderet\b/i,
      "uses future refund language instead of completed refund language",
    ],
    [
      /\bvil\s+blive\s+tilbageført\b/i,
      "uses future payment-return language instead of direct original-payment-method confirmation",
    ],
    [
      /\bwill\s+be\s+refunded\b/i,
      "uses future refund language instead of completed refund language",
    ],
    [
      /\bwill\s+be\s+(?:returned|credited)\b/i,
      "uses future payment-return language instead of direct original-payment-method confirmation",
    ],
    [
      /\b(?:igangsat|påbegyndt|startet)\s+(?:en\s+)?(?:refusion|refundering)\b/i,
      "uses initiated-refund language instead of completed refund language",
    ],
    [
      /\b(?:initiated|started)\s+(?:a\s+)?refund\b/i,
      "uses initiated-refund language instead of completed refund language",
    ],
    [
      /\b(?:tilbudt|offered)\s+(?:en\s+)?(?:refusion|refund)\b/i,
      "uses offered-refund language instead of completed refund language",
    ],
    [
      /\b(?:har|have|has)\s+(?:allerede\s+)?(?:tilbudt|offered)\b/i,
      "uses offered-action language instead of completed action language",
    ],
    [/\bbliver\s+behandlet\b/i, "uses pending processing language"],
    [/\bbehandles\s+hurtigst\s+muligt\b/i, "uses pending processing language"],
    [/\bhurtigst\s+muligt\b/i, "uses generic pending-speed language"],
    [/\bas\s+soon\s+as\s+possible\b/i, "uses generic pending-speed language"],
    [
      /\b(?:anmodning|request)[\s\S]{0,80}(?:behandlet|processed)\b/i,
      "uses vague request-processed language",
    ],
    [
      /\b(?:sendes|sent)\s+(?:videre|for\s+review|to\s+review)\b/i,
      "uses internal handoff language",
    ],
    [
      /\b(?:venter|waiting|awaiting)\s+(?:på\s+)?(?:godkendelse|approval)\b/i,
      "uses approval-pending language",
    ],
  ];
  for (const [pattern, reason] of pendingLanguagePatterns) {
    if (pattern.test(text)) issues.push(reason);
  }

  if (actionType === "refund_order") {
    const amountDisplay = String(actionResult.amount_display || "").trim() ||
      formatActionAmountForLanguage(actionResult, replyLanguage);
    // Only flag missing amount when the refund has a non-zero amount to report
    const numericAmount = parseFloat(
      String(actionResult.amount || "0").replace(/[^0-9.,]/g, "").replace(
        ",",
        ".",
      ),
    );
    const hasAmount = Number.isFinite(numericAmount) && numericAmount > 0 &&
      Boolean(amountDisplay);
    if (hasAmount && !draftText.includes(amountDisplay)) {
      issues.push(
        "refund result does not use the exact formatted refund amount",
      );
    }
  }

  return Array.from(new Set(issues));
}

function cleanupPostActionDraftText(
  draftText: string,
  actionResult: Record<string, unknown> | null,
  replyLanguage: string,
): string {
  if (
    !actionResult || String(actionResult.action_type || "") !== "refund_order"
  ) {
    return draftText;
  }
  if (replyLanguage === "da") {
    return draftText
      .replace(
        /\b(?:beløbet|refusionen|det)\s+vil\s+blive\s+tilbageført\s+til\s+den\s+oprindelige\s+betalingsmetode\b/gi,
        "beløbet går tilbage til den oprindelige betalingsmetode",
      )
      .replace(/\bog\s+beløbet\s+går/gi, "og beløbet går")
      .replace(
        /(^|\n)beløbet går/g,
        (match) => match.replace("beløbet", "Beløbet"),
      );
  }
  if (replyLanguage === "en") {
    return draftText.replace(
      /\b(?:the\s+amount|the\s+refund|it)\s+will\s+be\s+(?:returned|credited)\s+to\s+the\s+original\s+payment\s+method\b/gi,
      "the amount goes back to the original payment method",
    );
  }
  return draftText;
}

function formatActionAmountForLanguage(
  actionResult: Record<string, unknown>,
  replyLanguage: string,
): string {
  const amountText = String(actionResult.amount || "").trim();
  if (!amountText) return "";
  const normalizedAmount = amountText.includes(",")
    ? amountText.replace(/\./g, "").replace(",", ".")
    : amountText;
  const amount = Number(normalizedAmount);
  if (!Number.isFinite(amount)) return "";
  const currency =
    String(actionResult.currency || actionResult.currency_code || "DKK")
      .trim() || "DKK";
  const locales: Record<string, string> = {
    da: "da-DK",
    sv: "sv-SE",
    de: "de-DE",
    en: "en-US",
    nl: "nl-NL",
    fr: "fr-FR",
    no: "nb-NO",
    fi: "fi-FI",
    es: "es-ES",
    it: "it-IT",
  };
  try {
    return new Intl.NumberFormat(locales[replyLanguage] ?? "en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return "";
  }
}

function resolveWriterModel(
  intent: string,
  hasOrderFacts: boolean,
  overrideModel?: string,
): string {
  if (overrideModel) return overrideModel;
  // tracking only qualifies as simple when we actually found the order —
  // otherwise there's nothing to report and the model needs to improvise.
  if (intent === "thanks" || intent === "update") return SIMPLE_MODEL;
  if (intent === "tracking" && hasOrderFacts) return SIMPLE_MODEL;
  return Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini";
}

const INTENT_GAP_SUGGESTIONS: Record<string, { title: string; hint: string }> =
  {
    exchange: {
      title: "Procedure: Warranty replacement — confirmation response",
      hint:
        "Describe what happens after a customer confirms their details for a warranty replacement: we create an order and send a tracking link. Include expected delivery time and what the customer should expect.",
    },
    refund: {
      title: "Procedure: Refund process",
      hint:
        "Describe what happens when a refund is approved: processing time, payment method, when the customer receives the money.",
    },
    return: {
      title: "Procedure: Return process",
      hint:
        "Describe the return process step-by-step: who pays for shipping, how the item is returned, when the customer receives a refund or replacement.",
    },
    tracking: {
      title: "Procedure: Shipping and delivery",
      hint:
        "Describe what happens if a package is delayed or delivered incorrectly. Include expected delivery time and when we escalate to the carrier.",
    },
    complaint: {
      title: "Procedure: Complaint handling",
      hint:
        "Describe how we handle complaints: what is offered to the customer, when we escalate, what the acceptable response is for strong dissatisfaction.",
    },
    technical_support: {
      title: "Procedure: Technical support — troubleshooting steps",
      hint:
        "Add complete step-by-step troubleshooting guides for your products. Include ALL steps — incomplete guides produce poor answers.",
    },
    warranty: {
      title: "Procedure: Warranty handling",
      hint:
        "Describe the warranty process: what information is required (order number, photo), what is offered (replacement/refund), what the warranty period is.",
    },
    cancel: {
      title: "Procedure: Cancellation process",
      hint:
        "Describe when an order can be cancelled, what happens to the payment, and what is communicated to the customer.",
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
  if (chunkCount === 0 && !["thanks", "update", "other"].includes(intent)) {
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
      suggested_title: `Policy: ${
        intent === "refund"
          ? "Refund policy"
          : intent === "return"
          ? "Return policy"
          : intent === "warranty"
          ? "Warranty terms"
          : "Cancellation policy"
      }`,
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

function parseReplacementShippingAddress(message = "", existingShipping = {}) {
  const lines = String(message || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    !lines.join(" ").match(
      /\b(?:address|adresse|leveringsadresse|shipping address)\b/i,
    )
  ) {
    return null;
  }
  const contentLines = lines.filter((line) =>
    !/^(?:hello|hi|hej|dear|thanks|thank you|tak|mvh|venlig hilsen)\b[,!.\s]*.*$/i
      .test(line) &&
    !/\b(?:kan i|can you|jeg har|i have|ordren|order|det er)\b/i.test(line)
  );
  const streetLine = contentLines.find((line) =>
    /\b[A-Za-zÆØÅæøåÄÖÜäöüß .'-]+(?:vej|gade|all[eé]|plads|stræde|vaenge|vænge)\s+\d+[A-Za-z0-9 ,.-]*$/i
      .test(line) ||
    /\b\d+[A-Za-z0-9 -]{0,8}\s+(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd|drive|dr\.?|lane|ln\.?)\b/i
      .test(line)
  );
  const zipCityLine =
    contentLines.find((line) => /^[A-Z]{0,3}-?\d{3,10}\s+\S.+$/i.test(line)) ||
    "";
  const zipCityMatch = zipCityLine.match(/^([A-Z]{0,3}-?\d{3,10})\s+(.+)$/i);
  if (!streetLine || !zipCityMatch) return null;
  const streetIndex = contentLines.indexOf(streetLine);
  const possibleName = streetIndex > 0
    ? String(contentLines[streetIndex - 1] || "").trim()
    : "";
  const countryLine =
    contentLines.find((line) =>
      /^(?:danmark|denmark|sverige|sweden|norge|norway|germany|tyskland|us|usa|united states)$/i
        .test(line)
    ) || "";
  const existing = existingShipping && typeof existingShipping === "object"
    ? existingShipping as Record<string, unknown>
    : {};
  const existingName = [existing.first_name, existing.last_name]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  return {
    name: possibleName || existingName || null,
    address1: streetLine,
    address2: null,
    zip: zipCityMatch[1].trim(),
    city: zipCityMatch[2].trim(),
    country: countryLine || String(existing.country || ""),
    phone: String(existing.phone || "") || null,
  };
}

function buildCustomerHistorySummary(
  priorThreads: Array<Record<string, unknown>>,
): string {
  const count = priorThreads.length;
  const daysSince = (dateStr: unknown): number | null => {
    if (!dateStr) return null;
    const ms = Date.now() - new Date(String(dateStr)).getTime();
    return Math.floor(ms / 86_400_000);
  };

  // Saml intenttyper på tværs af tidligere tråde
  const intentCounts: Record<string, number> = {};
  for (const t of priorThreads) {
    const key = String(t.classification_key || "other");
    intentCounts[key] = (intentCounts[key] ?? 0) + 1;
  }
  const topIntents = Object.entries(intentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => n > 1 ? `${k} (${n}x)` : k);

  // Gentagen samme intent = tegn på uløst problem
  const maxIntentCount = Math.max(...Object.values(intentCounts));
  const repeatedIssue = maxIntentCount >= 2;

  const mostRecent = priorThreads[0];
  const daysSinceLast = daysSince(mostRecent?.last_message_at);
  const recentStatus = String(mostRecent?.status || "");
  const recentSubject = String(mostRecent?.subject || "").slice(0, 80);
  const recentSolution = mostRecent?.solution_summary
    ? String(mostRecent.solution_summary).slice(0, 120)
    : null;

  const lines = [
    `Tidligere kontakter: ${count} ${count === 1 ? "sag" : "sager"}`,
    daysSinceLast !== null
      ? `Seneste sag: "${recentSubject}" (${daysSinceLast} dage siden, ${recentStatus})`
      : `Seneste sag: "${recentSubject}"`,
    recentSolution ? `Seneste løsning: ${recentSolution}` : null,
    topIntents.length ? `Emner: ${topIntents.join(", ")}` : null,
    repeatedIssue
      ? `⚠ Tilbagevendende problem — kunden har kontaktet os flere gange om samme emne.`
      : null,
  ].filter(Boolean);

  return lines.join("\n");
}

export async function runDraftV2Pipeline(
  input: PipelineInput,
): Promise<PipelineResult> {
  const {
    thread_id,
    shop_id,
    supabase,
    customer_context,
    action_result,
    eval_payload,
    eval_options,
  } = input;
  const draftId = crypto.randomUUID();
  const generationId = crypto.randomUUID();
  const pipelineStartedAt = Date.now();
  let currentStage = "initializing";

  await createDraftGenerationTrace({
    supabase,
    id: generationId,
    shop_id,
    thread_id,
    message_id: input.message_id,
    draft_id: draftId,
  });

  try {
    const completeSkippedGeneration = async (
      skipReason: string,
      extra: Partial<PipelineResult> = {},
    ): Promise<PipelineResult> => {
      await updateDraftGenerationTrace(supabase, generationId, {
        completed_at: new Date().toISOString(),
        total_latency_ms: Date.now() - pipelineStartedAt,
        skip_reason: skipReason,
      });
      return {
        draft_text: null,
        draft_id: eval_payload ? undefined : draftId,
        generation_id: generationId,
        proposed_actions: [],
        routing_hint: "block",
        is_test_mode: false,
        confidence: 0,
        sources: [],
        skipped: true,
        skip_reason: skipReason,
        knowledge_gaps: [],
        ...extra,
      };
    };

    const writerModelOverride = eval_payload
      ? eval_options?.writer_model
      : undefined;
    const strongModelOverride = eval_payload
      ? eval_options?.strong_model
      : undefined;
    const disableEscalation = eval_payload
      ? eval_options?.disable_escalation === true
      : false;
    const postActionResult =
      action_result && typeof action_result === "object" &&
        typeof (action_result as Record<string, unknown>).action_type ===
          "string"
        ? action_result as Record<string, unknown>
        : null;

    // 1. Load context — either from DB (normal) or from eval_payload (eval mode)
    currentStage = "load_context";
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
        return await completeSkippedGeneration("shop_not_found");
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
        // Propagate from_email down to the message so case-state-updater can
        // populate caseState.entities.customer_email via its latestMsg fallback.
        // Without this, the LLM has to extract email from the body alone, which
        // it usually can't — and fact-resolver loses its primary email source.
        from_email: eval_payload.from_email ?? "eval@eval.internal",
        extracted_customer_email: eval_payload.from_email ?? null,
      } as typeof latestMessage;
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
        return await completeSkippedGeneration("thread_or_shop_not_found");
      }

      thread = threadResult.data;
      shop = shopResult.data;
      messages = messagesResult.data ?? [];

      if (messages.length === 0) {
        return await completeSkippedGeneration("no_messages");
      }

      // Brug altid seneste inbound-besked som base — aldrig et outbound draft
      const latestInboundForBase = messages
        .filter((m) => {
          const row = m as Record<string, unknown>;
          return row.direction !== "outbound" && row.from_me !== true;
        })
        .at(-1);
      latestMessage = latestInboundForBase ?? messages[messages.length - 1];
      if (postActionResult) {
        const latestInboundMessage = messages
          .filter((m) => {
            const row = m as Record<string, unknown>;
            return row.direction !== "outbound" && row.from_me !== true;
          })
          .at(-1);
        if (!latestInboundMessage) {
          return await completeSkippedGeneration(
            "no_inbound_message_for_action_result",
          );
        }
        latestMessage = latestInboundMessage;
      }
    }

    if (!latestMessage && !eval_payload) {
      return await completeSkippedGeneration("no_messages");
    }

    // 2. Gate — skipped in eval mode
    currentStage = "gate";
    if (!eval_payload && !postActionResult) {
      const gate = await runGate({ thread, latestMessage, shop });
      if (!gate.should_process) {
        console.log(`[generate-draft-v2] gate blocked: ${gate.reason}`);
        return await completeSkippedGeneration(gate.reason);
      }
    }

    // 3. Load automation flags + test_mode in parallel with case state
    currentStage = "case_state";
    const workspaceId =
      (shop as Record<string, unknown>).workspace_id as string | null ?? null;

    const customerEmail =
      (thread as Record<string, unknown>).customer_email as string | null ??
        null;

    const [
      caseState,
      automationResult,
      testModeResult,
      personaResult,
      priorThreadsResult,
    ] = await Promise.all([
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

      // Kundehistorik — tidligere tråde fra samme email for denne shop
      customerEmail && workspaceId
        ? supabase
          .from("mail_threads")
          .select(
            "id, subject, status, classification_key, last_message_at, solution_summary",
          )
          .eq("workspace_id", workspaceId)
          .ilike("customer_email", customerEmail)
          .neq("id", thread_id)
          .order("last_message_at", { ascending: false })
          .limit(8)
        : Promise.resolve({ data: null }),
    ]);

    const automation = {
      order_updates: automationResult.data?.order_updates === true,
      cancel_orders: automationResult.data?.cancel_orders === true,
      automatic_refunds: automationResult.data?.automatic_refunds === true,
    };
    const isTestMode = testModeResult.data?.test_mode === true;

    await updateDraftGenerationTrace(supabase, generationId, {
      workspace_id: workspaceId,
      case_state_json: caseState,
    });

    // Webshoppen's eget AI-prompt — konfigureres i indstillinger under "Assistent"
    const shopWithPersona = {
      ...shop,
      persona_instructions: personaResult.data?.persona_instructions ?? null,
      persona_scenario: personaResult.data?.persona_scenario ?? null,
    };

    // Byg kundehistorik-oversigt til writer
    const priorThreads = Array.isArray(priorThreadsResult?.data)
      ? priorThreadsResult.data
      : [];
    const customerHistory: string | null = priorThreads.length > 0
      ? buildCustomerHistorySummary(priorThreads)
      : null;

    // 4. Plan — bestem intent, hvad der skal hentes, hvilke facts der kræves
    currentStage = "planner";
    let plan = await runPlanner({ caseState, latestMessage, shop });
    if (postActionResult) {
      const actionType = String(postActionResult.action_type || "");
      const actionIntentMap: Record<string, string> = {
        refund_order: "refund",
        cancel_order: "cancel",
        update_shipping_address: "address_change",
        create_exchange_request: "exchange",
        fulfill_exchange: "exchange",
      };
      plan = {
        ...plan,
        primary_intent: actionIntentMap[actionType] ?? plan.primary_intent,
        resolution_stage: "info_only",
        skills_to_consider: [],
        confidence: 1,
      };
    }
    const latestBody =
      (latestMessage.clean_body_text ?? latestMessage.body_text ??
        "") as string;
    if (
      plan.primary_intent !== "address_change" &&
      /\b(?:ændre|skifte|rette|opdatere|change|update|correct)\b[\s\S]{0,120}\b(?:adresse|leveringsadresse|shipping address|address)\b/i
        .test(`${latestMessage.subject || ""}\n${latestBody}`) &&
      /\b(?:adresse|leveringsadresse|shipping address|address)\b/i.test(
        latestBody,
      )
    ) {
      plan = {
        ...plan,
        primary_intent: "address_change",
        resolution_stage: "info_only",
        required_facts: Array.from(
          new Set([...(plan.required_facts || []), "order_state"]),
        ),
        skills_to_consider: Array.from(
          new Set([
            ...(plan.skills_to_consider || []),
            "update_shipping_address",
          ]),
        ),
        confidence: Math.max(Number(plan.confidence || 0), 0.9),
      };
    }

    await updateDraftGenerationTrace(supabase, generationId, {
      planner_output_json: plan,
      resolution_plan_json: {
        primary_intent: plan.primary_intent,
        resolution_stage: plan.resolution_stage,
        required_facts: plan.required_facts,
        skills_to_consider: plan.skills_to_consider,
        confidence: plan.confidence,
        language: plan.language,
      },
    });

    if (!eval_payload && thread_id) {
      supabase.from("agent_logs").insert({
        workspace_id: workspaceId ?? null,
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

      // A new customer message is being processed — any pending action from
      // a prior turn is now stale (the conversation has moved on). Supersede
      // them unconditionally; if the current draft proposes the same action
      // again it will be re-inserted as a fresh "pending" row below.
      // This fixes the bug where e.g. a "Cancel Order" awaiting-approval card
      // would persist after the customer pivoted to asking about returns.
      await supabase
        .from("thread_actions")
        .update({ status: "superseded", updated_at: new Date().toISOString() })
        .eq("thread_id", thread_id)
        .eq("status", "pending")
        .then(({ error }) => {
          if (error) {
            console.warn(
              "[pipeline] stale-action supersede failed:",
              error.message,
            );
          }
        });
    }

    // 5. Retrieve + resolve facts + interne regler parallelt (uafhængige)
    currentStage = "context_resolution";
    const [retrieved, facts, internalRules] = await Promise.all([
      runRetriever({
        plan,
        shop_id,
        workspace_id: workspaceId,
        customerMessage: latestBody,
        shop,
        supabase,
        excludeExternalTicketId: eval_payload?.source_thread_id ?? undefined,
        excludeChunkIds: input.exclude_chunk_ids,
        coherenceFlags: {
          absFloor: eval_options?.retrieval_abs_floor ?? null,
          pqBudget: eval_options?.retrieval_pq_budget ?? null,
          issueTiebreak: eval_options?.retrieval_issue_tiebreak === true,
          sourceConsolidate:
            eval_options?.retrieval_source_consolidate === true,
        },
      }),
      runFactResolver({
        plan,
        caseState,
        thread,
        shop,
        supabase,
        customerContext: customer_context,
      }),
      runInternalRules({
        shop_id,
        primary_intent: plan.primary_intent,
        supabase,
      }),
    ]);
    const internalRulesBlock = internalRules.block || undefined;
    await updateDraftGenerationTrace(supabase, generationId, {
      facts_json: facts,
      retrieved_chunk_ids: retrieved.chunks.map((chunk) => chunk.id),
      retrieval_trace_json: {
        included_chunks: compactRetrievedChunks(
          retrieved.chunks as unknown as Array<Record<string, unknown>>,
        ),
        matcher: retrieved.matcher_debug ?? null,
        diagnostics_coverage: {
          selected_chunks: "captured",
          matcher_rejected_candidates: retrieved.matcher_debug
            ? "captured_as_ranked_not_selected"
            : "not_available",
          drop_reasons: "not_available_in_generate_draft_v2_retriever",
        },
      },
      ticket_example_ids: retrieved.past_ticket_examples
        .map((example) => example.id ?? null)
        .filter(Boolean),
    });
    if (internalRules.rules.length > 0) {
      console.log(
        `[generate-draft-v2] internal rules injected: ${internalRules.rules.length} (intent=${plan.primary_intent})`,
      );
    }

    if (!eval_payload && thread_id) {
      supabase.from("agent_logs").insert({
        workspace_id: workspaceId ?? null,
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

      const logPayload = buildRetrievalLogPayload(
        thread_id,
        retrieved.chunks,
        retrieved.past_ticket_examples,
      );
      supabase.from("agent_logs").insert({
        workspace_id: workspaceId ?? null,
        ...logPayload,
        created_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) {
          console.warn(
            "[pipeline] retrieval_completed log failed:",
            error.message,
          );
        }
      });
    }

    // 6. Deterministisk action-decision med per-shop config + KB-overrides
    currentStage = "action_decision";
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
      customerMessage: latestBody,
    });
    await updateDraftGenerationTrace(supabase, generationId, {
      action_decision_json: actionDecision,
    });

    // 7. Anvend shop automation-flags — overskriv requires_approval og routing_hint
    let { proposals: finalProposals, routing_hint: effectiveRoutingHint } =
      applyAutomationConstraints(
        actionDecision.proposals,
        actionDecision.routing_hint,
        automation,
        isTestMode,
      );
    if (postActionResult) {
      finalProposals = [];
      effectiveRoutingHint = "auto";
    }
    if (
      finalProposals.length === 0 &&
      plan.primary_intent === "address_change" &&
      facts.order &&
      (facts.order.fulfillment_status === null ||
        facts.order.fulfillment_status === "unfulfilled")
    ) {
      const shippingAddress = parseReplacementShippingAddress(
        latestBody,
        facts.order.shipping_address || {},
      );
      if (
        shippingAddress?.address1 && shippingAddress?.city &&
        shippingAddress?.zip
      ) {
        const fallbackProposal: ActionProposal = {
          type: "update_shipping_address",
          confidence: "high",
          reason: "Ordren er ikke afsendt — adressen kan ændres",
          params: {
            order_id: facts.order.id,
            order_name: facts.order.name,
            shipping_address: shippingAddress,
          },
          requires_approval: true,
        };
        const constrained = applyAutomationConstraints(
          [fallbackProposal],
          "review",
          automation,
          isTestMode,
        );
        finalProposals = constrained.proposals;
        effectiveRoutingHint = constrained.routing_hint;
      }
    }
    await updateDraftGenerationTrace(supabase, generationId, {
      action_decision_json: {
        raw: actionDecision,
        effective: {
          proposals: finalProposals,
          routing_hint: effectiveRoutingHint,
          automation,
          is_test_mode: isTestMode,
        },
      },
    });

    if (isTestMode) {
      console.log(
        "[generate-draft-v2] workspace is in test_mode — actions will NOT mutate Shopify",
      );
    }

    const latestCustomerMessage =
      (latestMessage.clean_body_text ?? latestMessage.body_text ??
        "") as string;

    // Combine recent inbound messages for language detection — the latest message
    // alone may be too short (e.g. "Here is the receipt:") to score reliably.
    // Final fallback is "en": we should reply in the customer's language, not the shop's.
    const recentInboundForLanguage = messages
      .filter((m) => {
        const row = m as Record<string, unknown>;
        return row.direction !== "outbound" && row.from_me !== true;
      })
      .slice(-3)
      .map((m) => {
        const row = m as Record<string, unknown>;
        return ((row.clean_body_text ?? row.body_text ?? "") as string);
      })
      .filter((t) => t.length > 0)
      .join(" ");
    const replyLanguage = resolveReplyLanguage(
      recentInboundForLanguage || latestCustomerMessage,
      "en",
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
              draft_id: draftId,
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

      await updateDraftGenerationTrace(supabase, generationId, {
        completed_at: new Date().toISOString(),
        total_latency_ms: Date.now() - pipelineStartedAt,
        final_draft_text: null,
      });

      return {
        draft_text: null,
        draft_id: eval_payload ? undefined : draftId,
        generation_id: generationId,
        proposed_actions: finalProposals,
        routing_hint: effectiveRoutingHint,
        is_test_mode: isTestMode,
        confidence: plan.confidence,
        intent: plan.primary_intent,
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
      update: "OTHER",
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
        policy_terms:
          (shop as Record<string, unknown>).policy_terms as string ??
            null,
        policy_summary_json:
          (shop as Record<string, unknown>).policy_summary_json ?? null,
      },
      reservedTokens: ["RETURN", "REFUND"].includes(intentOverride ?? "")
        ? 1400
        : 800,
      intentOverride,
    });

    // Hent billedvedhæftninger for seneste kundebesked (tom liste i eval-mode)
    const latestMessageId = (latestMessage as Record<string, unknown>).id as
      | string
      | undefined;
    const [imageAttachments, allAttachmentRows] = await Promise.all([
      latestMessageId
        ? loadImageAttachments(supabase, latestMessageId)
        : Promise.resolve([]),
      latestMessageId
        ? supabase
          .from("mail_attachments")
          .select("filename, mime_type, size_bytes")
          .eq("message_id", latestMessageId)
          .then(({ data }) =>
            (data ?? []) as Array<
              { filename: string; mime_type: string; size_bytes: number }
            >
          )
        : Promise.resolve([]),
    ]);
    // Build a human-readable summary of non-image attachments so the writer knows
    // about videos, PDFs, etc. even though they cannot be analysed by vision.
    const nonImageAttachmentsMeta: string = allAttachmentRows.length > 0
      ? (() => {
        const parts = allAttachmentRows.map((a) => {
          const name = a.filename || "fil";
          const mime = String(a.mime_type || "").toLowerCase();
          const type = mime.startsWith("video/")
            ? "video"
            : mime.startsWith("audio/")
            ? "lydfil"
            : mime === "application/pdf"
            ? "PDF"
            : mime.startsWith("image/")
            ? "billede"
            : "fil";
          return `${type} (${name})`;
        });
        return parts.join(", ");
      })()
      : "";

    // Byg samtalehistorik fra messages — ekskludér den seneste besked (vises separat)
    const latestMessageIdForHistory =
      (latestMessage as Record<string, unknown>).id;
    const conversationHistory = messages.filter((m) => {
      if (!latestMessageIdForHistory) return m !== latestMessage;
      return (m as Record<string, unknown>).id !== latestMessageIdForHistory;
    }).map((m) => {
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
    currentStage = "writer";
    const firstPassModel = resolveWriterModel(
      plan.primary_intent,
      !!facts.order,
      writerModelOverride,
    );
    console.log(
      `[generate-draft-v2] writer model: ${firstPassModel} (intent=${plan.primary_intent})`,
    );
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
      internalRulesBlock,
      model: firstPassModel,
      attachments: imageAttachments,
      actionResult: postActionResult,
      customerHistory: customerHistory ?? undefined,
      nonImageAttachmentsMeta: nonImageAttachmentsMeta || undefined,
    });
    await updateDraftGenerationTrace(supabase, generationId, {
      writer_model: written.usage?.model ?? firstPassModel,
      writer_prompt_version: null,
      writer_prompt_hash: written.usage?.prompt_hash ?? null,
      writer_input_tokens: written.usage?.input_tokens ?? null,
      writer_output_tokens: written.usage?.output_tokens ?? null,
      writer_cost_usd: written.usage?.cost_usd ?? null,
      writer_latency_ms: written.usage?.latency_ms ?? null,
      total_input_tokens: written.usage?.input_tokens ?? null,
      total_output_tokens: written.usage?.output_tokens ?? null,
      total_cost_usd: written.usage?.cost_usd ?? null,
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
          internalRulesBlock,
          model: firstPassModel,
          attachments: imageAttachments,
          actionResult: postActionResult,
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

    for (let attempt = 1; attempt <= 3; attempt++) {
      const postActionIssues = detectPostActionDraftIssues(
        languageCheckedWritten.draft_text,
        postActionResult,
        replyLanguage,
      );
      if (postActionIssues.length === 0) break;
      console.warn(
        `[generate-draft-v2] post-action draft retry ${attempt}: ${
          postActionIssues.join("; ")
        }`,
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
          internalRulesBlock,
          model: firstPassModel,
          attachments: imageAttachments,
          actionResult: postActionResult,
          languageCorrectionInstruction:
            `Rewrite the full draft as a completed post-action confirmation in ${replyLanguage}. The Shopify action has already been executed. Fix these issues: ${
              postActionIssues.join("; ")
            }. Use completed-result wording only. For refunds, state that the exact formatted amount was refunded for the order and that the amount goes back to the original payment method. Do not say the refund was initiated, offered, can be done, will be refunded, will be returned, will be processed, is handled as soon as possible, or that the request was merely processed. Do not add a signature or support email.`,
        });
        if (correctionWritten.draft_text) {
          languageCheckedWritten = correctionWritten;
          if (
            !mixedLanguageCheck(
              languageCheckedWritten.draft_text,
              replyLanguage,
            ).ok
          ) {
            languageCheckedWritten = {
              ...languageCheckedWritten,
              draft_text: cleanupMixedLanguageDraft(
                languageCheckedWritten.draft_text,
                replyLanguage,
              ),
            };
          }
        }
      } catch (err) {
        console.warn(
          "[generate-draft-v2] post-action correction retry failed:",
          err,
        );
      }
    }
    if (postActionResult) {
      languageCheckedWritten = {
        ...languageCheckedWritten,
        draft_text: cleanupPostActionDraftText(
          languageCheckedWritten.draft_text,
          postActionResult,
          replyLanguage,
        ),
      };
    }

    // 10. Verificér grounding og kvalitet
    currentStage = "verifier";
    const verified = await runVerifier({
      draftText: languageCheckedWritten.draft_text,
      proposedActions: finalProposals,
      citations: languageCheckedWritten.citations,
      facts,
      retrievedChunks: retrieved.chunks,
      customerMessage: latestCustomerMessage,
      language: replyLanguage,
    });
    await updateDraftGenerationTrace(supabase, generationId, {
      verifier_output_json: verified,
    });

    let finalDraft = languageCheckedWritten.draft_text;
    let finalConfidence = verified.confidence;
    let finalRoutingHint = effectiveRoutingHint;

    if (!mixedLanguageCheck(finalDraft, replyLanguage).ok) {
      finalConfidence = Math.min(finalConfidence, 0.62);
      finalRoutingHint = "review";
    }

    // 11. Eskalér til stærkere model — kun for høj-risiko intents hvor fejl er dyre.
    // Tracking, thanks og address_change eskaleres aldrig — cost/quality tradeoff er ikke det værd.
    const HIGH_RISK_INTENTS = new Set([
      "refund",
      "return",
      "exchange",
      "warranty",
      "complaint",
      "cancel",
    ]);
    const intentQualifiesForEscalation = HIGH_RISK_INTENTS.has(
      plan.primary_intent,
    );
    if (
      !disableEscalation && verified.retry_with_stronger_model &&
      !verified.block_send && intentQualifiesForEscalation
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
          internalRulesBlock,
          model: escalationModel,
          attachments: imageAttachments,
          actionResult: postActionResult,
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
            await updateDraftGenerationTrace(supabase, generationId, {
              writer_model: strongWritten.usage?.model ?? escalationModel,
              writer_prompt_hash: strongWritten.usage?.prompt_hash ?? null,
              writer_input_tokens: strongWritten.usage?.input_tokens ?? null,
              writer_output_tokens: strongWritten.usage?.output_tokens ?? null,
              writer_cost_usd: strongWritten.usage?.cost_usd ?? null,
              writer_latency_ms: strongWritten.usage?.latency_ms ?? null,
              total_input_tokens: strongWritten.usage?.input_tokens ?? null,
              total_output_tokens: strongWritten.usage?.output_tokens ?? null,
              total_cost_usd: strongWritten.usage?.cost_usd ?? null,
              verifier_output_json: strongVerified,
            });
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
        console.warn(
          "[generate-draft-v2] strong model escalation failed:",
          err,
        );
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
        (shop as Record<string, unknown>).owner_user_id as string | null ??
          null;
      const nowIso = new Date().toISOString();
      const draftThreadKey =
        (thread as Record<string, unknown>).provider_thread_id as
          | string
          | null ??
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
            draft_id: draftId,
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
        workspace_id: workspaceId ?? null,
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
          workspace_id: workspaceId ?? null,
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

    await updateDraftGenerationTrace(supabase, generationId, {
      completed_at: new Date().toISOString(),
      total_latency_ms: Date.now() - pipelineStartedAt,
      final_draft_text: deferDraftUntilActionDecision ? null : finalDraft,
    });

    return {
      draft_text: deferDraftUntilActionDecision ? null : finalDraft,
      draft_id: eval_payload ? undefined : draftId,
      generation_id: generationId,
      proposed_actions: finalProposals,
      routing_hint: finalRoutingHint,
      is_test_mode: isTestMode,
      confidence: finalConfidence,
      intent: plan.primary_intent,
      knowledge_gaps: knowledgeGaps,
      sources: retrieved.chunks.slice(0, 5).map((c) => ({
        content: c.content.slice(0, 200),
        kind: c.kind,
        source_label: c.source_label,
        usable_as: c.usable_as,
        risk_flags: c.risk_flags,
      })),
      // Eval-only observability: the full writer-facing chunk set so the golden
      // runner can measure retrieval coherence. Omitted entirely in production
      // (gated on eval_payload), so no behavior or PII change for real traffic.
      ...(eval_payload
        ? {
          retrieval_debug: {
            chunks: retrieved.chunks.map((c) => ({
              id: c.id,
              title: c.source_label,
              source_id: c.source_id ?? null,
              chunk_index: c.chunk_index ?? null,
              chunk_count: c.chunk_count ?? 1,
              score: c.similarity,
              vector_similarity: c.vector_similarity ?? null,
              kind: c.kind,
              usable_as: c.usable_as,
              products: c.products ?? [],
              issue_types: c.chunk_issue_types,
            })),
            ...(retrieved.matcher_debug
              ? { matcher: retrieved.matcher_debug }
              : {}),
          },
        }
        : {}),
    };
  } catch (err) {
    await updateDraftGenerationTrace(supabase, generationId, {
      completed_at: new Date().toISOString(),
      total_latency_ms: Date.now() - pipelineStartedAt,
      error_stage: currentStage,
      error_message: safeErrorMessage(err),
    });
    throw err;
  }
}
