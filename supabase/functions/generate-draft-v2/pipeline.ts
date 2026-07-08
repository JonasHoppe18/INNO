// supabase/functions/generate-draft-v2/pipeline.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { runGate } from "./stages/gate.ts";
import { updateCaseState } from "./stages/case-state-updater.ts";
import { runPlanner } from "./stages/planner.ts";
import {
  replacementIntentOverride,
  resolveReplacementFlowState,
} from "./stages/replacement-flow.ts";
import { runRetriever } from "./stages/retriever.ts";
import type { RetrievalCandidateDiagnostics } from "./stages/retriever.ts";
import { runInternalRules } from "./stages/internal-rules.ts";
import {
  buildCompatibilityOutcome,
  detectCompatibilityProduct,
  detectCompatibilityQuery,
  detectCompatibilityToneViolations,
  isCompatibilityQuestion,
  resolveCompatibility,
  sanitizeCompatibilityDraft,
} from "./stages/product-compatibility.ts";
import {
  buildComparisonDirective,
  buildComparisonProvenance,
  buildSpecComparison,
  detectComparisonQuery,
  isComparisonQuestion,
  resolveProductSpecs,
} from "./stages/product-specs.ts";
import {
  assembleProvenance,
  type GuardrailUnavailableProvenance,
  type Provenance,
  type StructuredFactProvenance,
} from "./stages/provenance.ts";
import { partitionLiveCommerceLegacy } from "./stages/live-commerce-retrieval-gate.ts";
import {
  hasGroundedReturnAddressChunk,
  isReturnRefundIntent,
} from "./stages/returns-grounding.ts";
import { runFactResolver } from "./stages/fact-resolver.ts";
import {
  ActionProposal,
  runActionDecision,
  ShopActionConfig,
} from "./stages/action-decision.ts";
import { buildRetrievalLogPayload } from "./stages/retrieval-log.ts";
import { runWriter } from "./stages/writer.ts";
import { runVerifier, type VerifierResult } from "./stages/verifier.ts";
import {
  buildPinnedPolicyContext,
  PolicyIntent,
} from "../_shared/policy-context.ts";
import { parseEmailReplyBodies } from "../_shared/email-reply-parser.ts";
import {
  extractContactFormOrderNumbers,
  parseShopifyContactIdentity,
} from "../_shared/shopify-contact-form.ts";
import { embedText } from "../_shared/embed-text.ts";
import { emitDraftGeneratedEvent } from "../_shared/draft-feedback-emit.ts";
import {
  buildSupportVoiceRewriteInstruction,
  detectSupportVoiceViolations,
  sanitizeSupportVoiceDraft,
  type SupportVoiceViolation,
} from "../_shared/support-voice.ts";
import { loadImageAttachments } from "./stages/attachment-loader.ts";
import {
  cleanupMixedLanguageDraft,
  mixedLanguageCheck,
  resolveReplyLanguage,
} from "./stages/language.ts";
import {
  buildKnowledgeDocPreviewContext,
  type KnowledgeDocPreviewContextInput,
} from "./stages/knowledge-doc-preview-context.ts";
import {
  isProductSupportClarificationReason,
  shouldApplyProductSupportTopicLock,
} from "./stages/product-support-clarification.ts";
import {
  externalIdFromProductScope,
  scopeLegacyChunksToProduct,
} from "./stages/product-support-legacy-scope.ts";
import {
  buildWriterConversationHistory,
  visibleEmailText,
} from "./stages/email-thread-normalizer.ts";
import { detectCustomerProvidedReturnTracking } from "./stages/return-tracking-attribution.ts";
import { detectVerifiedOrderProofAsks } from "./stages/verified-order-proof-ask.ts";
import { detectMissingDamageDocumentationAsk } from "./stages/damage-documentation-ask.ts";
import { resolveCustomerName } from "./stages/customer-name-resolution.ts";
import { checkUnsupportedCommitments } from "./stages/unsupported-commitment-check.ts";
import { checkUnsupportedAssumptions } from "./stages/unsupported-assumption-check.ts";
import { checkLiveFactAndActionClaims } from "./stages/live-fact-action-claim-check.ts";
import { checkUnsupportedNegativeClaims } from "./stages/unsupported-negative-claim-check.ts";
import {
  checkImageEvidenceClaims,
  type ImageEvidenceViolationType,
} from "./stages/image-evidence-claim-check.ts";

export interface EvalPayload {
  subject: string;
  body: string;
  from_email?: string;
  from_name?: string;
  conversation_history?: string | Array<{ role?: string; text?: string }>;
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
  // When true (or when eval_payload is present), the pipeline runs in
  // no-write mode: it executes end-to-end (retrieval, writer, draft) but never
  // inserts/updates `draft_generations`. Used by simulation / verification
  // callers that must not mutate production trace data.
  dry_run?: boolean;
  eval_options?: {
    writer_model?: string;
    strong_model?: string;
    writer_effort?: string;
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
  // Preview mode only — explicit docs chunks loaded and shop-scoped by the app
  // route. Absent in ordinary runtime so no preview context is loaded here.
  preview_document_context?: KnowledgeDocPreviewContextInput;
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
  block_send_recommended?: boolean;
  unsupported_commitment_check?: {
    checked: boolean;
    compliant: boolean;
    violations: Array<{ type: string; excerpt: string }>;
    requires_review: boolean;
  };
  unsupported_assumption_check?: {
    checked: boolean;
    compliant: boolean;
    violations: Array<{ type: string; excerpt: string }>;
    requires_review: boolean;
  };
  live_fact_action_claim_check?: {
    checked: boolean;
    compliant: boolean;
    violations: Array<{ type: string; excerpt: string }>;
    requires_review: boolean;
  };
  unsupported_negative_claim_check?: {
    checked: boolean;
    compliant: boolean;
    violations: Array<{ type: string; excerpt: string }>;
    requires_review: boolean;
  };
  support_voice_check?: {
    checked: boolean;
    compliant: boolean;
    violations: SupportVoiceViolation[];
    requires_review: boolean;
  };
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
  // Response-only provenance (Stage 5, Slice 1). Safe, UI-ready summary of where
  // the draft's facts came from. Never persisted in this slice. Never carries
  // hidden writer-directive text.
  provenance?: Provenance;
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
    candidate_diagnostics?: RetrievalCandidateDiagnostics;
    stock_lookup_debug?: NonNullable<
      Awaited<ReturnType<typeof runFactResolver>>["stock_lookup_debug"]
    >;
  };
  preview_document_context?: {
    requested: true;
    document_id: string;
    preview_chunk_ids: string[];
    section_headings: string[];
    active_only_for_test: true;
    injected: boolean;
    reason: string;
  } | null;
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

function buildPipelineSources(input: {
  retrievedChunks: Array<{
    content: string;
    kind: string;
    source_label: string;
    usable_as?: string;
    risk_flags?: string[];
  }>;
  previewSources: Array<{
    content: string;
    kind: string;
    source_label: string;
    usable_as?: string;
    risk_flags?: string[];
  }>;
}) {
  return [
    ...input.previewSources,
    ...input.retrievedChunks.slice(0, Math.max(0, 5 - input.previewSources.length)).map((c) => ({
      content: c.content.slice(0, 200),
      kind: c.kind,
      source_label: c.source_label,
      usable_as: c.usable_as,
      risk_flags: c.risk_flags,
    })),
  ];
}

// Synthetic generation ids minted in eval/dry-run mode carry this prefix. Both
// trace helpers detect it and skip the DB write entirely, so the pipeline can
// run end-to-end (writer, retrieval, draft) without ever touching
// `draft_generations`. The id still flows through downstream code that expects
// a string, but must NEVER reach a real DB write.
export const DRY_RUN_GENERATION_PREFIX = "dry-run:";

export function isDryRunGenerationId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(DRY_RUN_GENERATION_PREFIX);
}

// Single source of truth for "this run must not write trace rows". A run is
// no-write when it carries an eval payload (eval/simulation) OR an explicit
// dry_run flag. Production inbox generation has neither → writes as before.
export function isNoWriteDraftRun(input: {
  eval_payload?: unknown;
  dry_run?: boolean;
}): boolean {
  return Boolean(input.eval_payload) || input.dry_run === true;
}

// Mints the generation id for a run. No-write runs get the sentinel prefix so
// the trace helpers skip all DB writes; production runs get a plain uuid.
export function mintGenerationId(isNoWrite: boolean): string {
  return isNoWrite
    ? `${DRY_RUN_GENERATION_PREFIX}${crypto.randomUUID()}`
    : crypto.randomUUID();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createDraftGenerationTrace(input: {
  supabase: SupabaseClient;
  id: string;
  shop_id: string;
  thread_id?: string;
  message_id?: string;
  draft_id: string;
}) {
  // Dry-run / eval: no-op. Never insert a trace row.
  if (isDryRunGenerationId(input.id)) return;
  // Callers have passed the RFC Message-ID header here (postmark-inbound) —
  // the uuid column then rejected the INSERT and the whole trace row was
  // silently lost. Null a non-uuid message_id instead of losing the trace.
  const messageId = input.message_id && UUID_RE.test(input.message_id)
    ? input.message_id
    : null;
  const { error } = await input.supabase.from("draft_generations").insert({
    id: input.id,
    shop_id: input.shop_id,
    thread_id: input.thread_id ?? null,
    message_id: messageId,
    draft_id: input.draft_id,
    pipeline_version: "v2",
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.warn("[draft-generation-trace] create failed:", error.message);
  }
}

export async function updateDraftGenerationTrace(
  supabase: SupabaseClient,
  generationId: string,
  patch: Record<string, unknown>,
) {
  if (!generationId || Object.keys(patch).length === 0) return;
  // Dry-run / eval: no-op. Never update a trace row.
  if (isDryRunGenerationId(generationId)) return;
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

// Intents where a cheaper current-gen model matched or beat the strong model
// in eval (measured 2026-07-08: compact gpt-5.4-mini vs gpt-4o on the golden
// set — exchange +0.6, other +1.0, both n≥4). Deliberately conservative:
// noisy single-case parity (return|refund, address_change) is excluded, and
// the expensive/hard intents (complaint, return, refund, product_question)
// always stay on the strong model. Grow this set only from real-traffic
// no-edit-rate evidence per intent.
export const CHEAP_MODEL_INTENTS: ReadonlySet<string> = new Set([
  "exchange",
  "other",
]);

// Pure routing decision (unit-tested). All inputs explicit so it needs no env.
// cheapModel is the OPENAI_CHEAP_MODEL secret: unset/empty => the cheap route
// is DISABLED and parity intents fall through to the strong model, i.e. the
// whole feature is a no-op until the secret is deliberately set.
export function pickWriterModel(input: {
  intent: string;
  hasOrderFacts: boolean;
  overrideModel?: string;
  simpleModel: string;
  strongModel: string;
  cheapModel?: string | null;
  cheapIntents?: ReadonlySet<string>;
}): string {
  const {
    intent,
    hasOrderFacts,
    overrideModel,
    simpleModel,
    strongModel,
    cheapModel,
    cheapIntents = CHEAP_MODEL_INTENTS,
  } = input;
  if (overrideModel) return overrideModel;
  // tracking only qualifies as simple when we actually found the order —
  // otherwise there's nothing to report and the model needs to improvise.
  if (intent === "thanks" || intent === "update") return simpleModel;
  if (intent === "tracking" && hasOrderFacts) return simpleModel;
  if (cheapModel && cheapIntents.has(intent)) return cheapModel;
  return strongModel;
}

function resolveWriterModel(
  intent: string,
  hasOrderFacts: boolean,
  overrideModel?: string,
): string {
  return pickWriterModel({
    intent,
    hasOrderFacts,
    overrideModel,
    simpleModel: SIMPLE_MODEL,
    strongModel: Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini",
    cheapModel: Deno.env.get("OPENAI_CHEAP_MODEL") ?? null,
  });
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
  history?: EvalPayload["conversation_history"],
): Record<string, unknown>[] {
  if (Array.isArray(history)) {
    return history
      .map((turn, index) => {
        const role = String(turn?.role || "").toLowerCase();
        const body = String(turn?.text || "").trim();
        if (!body) return null;
        const isAgent = role === "agent" || role === "support";
        return {
          id: `eval-history-${index}`,
          clean_body_text: body,
          body_text: body,
          from_me: isAgent,
          direction: isAgent ? "outbound" : "inbound",
          created_at: new Date(Date.now() - (history.length - index) * 1000)
            .toISOString(),
        };
      })
      .filter(Boolean) as Record<string, unknown>[];
  }
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

// AZ-1b Stage 12d helper — deterministic image-evidence claim guard.
// Additive only: when the draft claims to have seen/assessed an image but no
// real image evidence reached the model (image_evidence_count === 0), escalate
// routing to "review" and recommend blocking send. Never downgrades an existing
// review/block and never rewrites the draft. Pure — exported for unit testing.
export function applyImageEvidenceClaimGuard(
  current: {
    routingHint: "auto" | "review" | "block";
    blockSendRecommended: boolean;
  },
  input: {
    draftText: string;
    imageEvidenceCount: number;
    language?: string | null;
  },
): {
  routingHint: "auto" | "review" | "block";
  blockSendRecommended: boolean;
  violations: Array<{ type: ImageEvidenceViolationType; excerpt: string }>;
} {
  const check = checkImageEvidenceClaims({
    draft_text: input.draftText,
    image_evidence_count: input.imageEvidenceCount,
    language: input.language ?? null,
  });
  if (check.requires_review) {
    return {
      routingHint: "review",
      blockSendRecommended: true,
      violations: check.violations,
    };
  }
  return {
    routingHint: current.routingHint,
    blockSendRecommended: current.blockSendRecommended,
    violations: [],
  };
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
  // No-write mode: eval runs (eval_payload) or an explicit dry_run flag. In this
  // mode the generation id is minted with a sentinel prefix so the trace helpers
  // skip every insert/update to `draft_generations`.
  const isDryRun = isNoWriteDraftRun({ eval_payload, dry_run: input.dry_run });
  const draftId = crypto.randomUUID();
  const generationId = mintGenerationId(isDryRun);
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
    const writerEffortOverride = eval_payload
      ? eval_options?.writer_effort
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
      const parsedEvalBody = parseEmailReplyBodies({ text: eval_payload.body });
      latestMessage = {
        id: "eval",
        clean_body_text: parsedEvalBody.cleanBodyText,
        body_text: eval_payload.body,
        quoted_body_text: parsedEvalBody.quotedBodyText,
        from_me: false,
        created_at: new Date().toISOString(),
        // Propagate from_email down to the message so case-state-updater can
        // populate caseState.entities.customer_email via its latestMsg fallback.
        // Without this, the LLM has to extract email from the body alone, which
        // it usually can't — and fact-resolver loses its primary email source.
        from_email: eval_payload.from_email ?? "eval@eval.internal",
        from_name: eval_payload.from_name ?? null,
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
    const latestVisibleCustomerText = visibleEmailText(latestMessage);
    if (latestVisibleCustomerText) {
      latestMessage = {
        ...latestMessage,
        clean_body_text: latestVisibleCustomerText,
      };
      const latestMessageId = (latestMessage as Record<string, unknown>).id;
      messages = messages.map((message) =>
        latestMessageId &&
          (message as Record<string, unknown>).id === latestMessageId
          ? latestMessage
          : message
      );
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

    // Deterministic contact-form identity: Shopify relays (mailer@shopify.com)
    // carry the REAL customer name/email/order number only as structured body
    // fields. postmark-inbound detects this but only logs it — the LLM
    // case-state misses a bare order number under the field label (T-051002)
    // and name resolution otherwise sees just the relay sender. Merge parsed
    // fields into the case state before planning/fact-resolution.
    const contactFormIdentity = parseShopifyContactIdentity({
      fromEmail: String(
        (latestMessage as Record<string, unknown>).from_email || "",
      ),
      fromName: String(
        (latestMessage as Record<string, unknown>).from_name || "",
      ),
      subject: String(
        (latestMessage as Record<string, unknown>).subject ||
          (thread as Record<string, unknown>).subject || "",
      ),
      bodyText: visibleEmailText(latestMessage),
    });
    if (contactFormIdentity.detected) {
      const formOrderNumbers = extractContactFormOrderNumbers(
        contactFormIdentity,
      );
      const existingOrderNumbers = Array.isArray(
          caseState.entities.order_numbers,
        )
        ? caseState.entities.order_numbers
        : [];
      for (const number of formOrderNumbers) {
        const known = existingOrderNumbers.some((existing) =>
          String(existing).replace(/^#/, "") === number
        );
        if (!known) existingOrderNumbers.push(number);
      }
      caseState.entities.order_numbers = existingOrderNumbers;

      const currentEmail = String(caseState.entities.customer_email || "")
        .trim().toLowerCase();
      if (
        contactFormIdentity.customerEmail &&
        (!currentEmail || currentEmail.endsWith("@shopify.com"))
      ) {
        caseState.entities.customer_email = contactFormIdentity.customerEmail;
      }
    }

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
    const latestBody = visibleEmailText(latestMessage);
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

    // Multi-turn replacement/warranty flow: a clear "Kan jeg få et nyt?" /
    // purchase-source confirmation after failed troubleshooting must not degrade
    // to a generic `other`. Deterministic, scans agent + customer turns.
    {
      const replacementHistory = messages.map((m) => {
        const msg = m as {
          clean_body_text?: string;
          body_text?: string;
          direction?: string;
          from_me?: boolean;
        };
        const isAgent = msg.direction === "outbound" || msg.from_me === true;
        return {
          role: (isAgent ? "agent" : "customer") as "agent" | "customer",
          text: msg.clean_body_text || msg.body_text || "",
        };
      });
      const replacementState = resolveReplacementFlowState({
        history: replacementHistory,
        latestMessage: latestBody,
        purchaseSourceKnown: false,
        orderNumberKnown: caseState.entities.order_numbers.length > 0,
      });
      const override = replacementIntentOverride(
        replacementState,
        plan.primary_intent,
      );
      if (override) {
        plan = {
          ...plan,
          primary_intent: override,
          resolution_stage: "refund_or_exchange",
          required_facts: Array.from(
            new Set([...(plan.required_facts || []), "order_state"]),
          ),
          confidence: Math.max(Number(plan.confidence || 0), 0.8),
        };
      }
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
        latestCustomerMessage: latestBody,
      }),
      runInternalRules({
        shop_id,
        primary_intent: plan.primary_intent,
        supabase,
      }),
    ]);
    const quotedAwareConversationHistory = buildWriterConversationHistory(
      messages,
      latestMessage,
    );
    const returnTrackingAttribution = detectCustomerProvidedReturnTracking({
      latestCustomerMessage: latestBody,
      conversationHistory: quotedAwareConversationHistory,
      plan,
    });
    if (returnTrackingAttribution) {
      facts.facts = facts.facts.filter((fact) =>
        ![
          "Tracking (fragtmand)",
          "Tracking URL",
          "Tracking",
          "Leveret tidspunkt",
          "Forventet levering",
          "Pakkeshop",
        ].includes(fact.label)
      );
      facts.facts.push({
        label: "Customer-provided return tracking",
        value: returnTrackingAttribution.tracking_numbers.join(", "),
      });
      plan = {
        ...plan,
        primary_intent: plan.primary_intent === "tracking"
          ? "return"
          : plan.primary_intent,
        resolution_stage: "info_only",
        required_facts: (plan.required_facts || []).filter((fact) =>
          fact !== "tracking"
        ),
        skills_to_consider: (plan.skills_to_consider || []).filter((skill) =>
          skill !== "get_tracking"
        ),
      };
    }
    // Stage 5, Slice 2A: intent-aware retrieval down-ranking. For pure
    // live-commerce intents WITH live order facts present, the authoritative
    // answer comes from live facts — so legacy factual retrieval (manual_text /
    // saved_reply, never policy/procedure) is removed from the writer's source
    // set to stop it contaminating the reply. Nothing is deleted from the DB;
    // the suppressed chunks are still surfaced in provenance, flagged
    // `downranked_live_commerce_legacy`, so the agent can see what was set aside.
    // No effect when the intent isn't live-commerce or no live order resolved.
    const liveCommerceGate = partitionLiveCommerceLegacy(retrieved.chunks, {
      intent: plan.primary_intent,
      hasLiveOrder: Boolean(facts.order),
    });
    const suppressedLegacyChunks = liveCommerceGate.suppressed.map((c) => ({
      ...c,
      risk_flags: [...(c.risk_flags ?? []), "downranked_live_commerce_legacy"],
    }));
    if (suppressedLegacyChunks.length > 0) {
      retrieved.chunks = liveCommerceGate.kept;
      console.log(
        `[generate-draft-v2] live-commerce gate: suppressed ${suppressedLegacyChunks.length} legacy factual chunk(s) from writer set (intent=${plan.primary_intent}, order=${facts.order?.name ?? "none"})`,
      );
    }
    // Stage 4B-3-1: structured product-compatibility facts. Only for
    // compatibility-style questions, and only when CONFIRMED rows exist — so
    // unrelated drafts and the pre-seed state are unchanged (no fighting the
    // existing manual_text/retrieval path). Brand-wide rows (product_id null)
    // apply to all products; product-specific override is supported by the
    // resolver/table for when product detection is wired in a later slice.
    // Best-effort: a missing table (pre-migration) yields no rows → no block.
    // Stage 5, Slice 1: response-only provenance accumulators. Populated only
    // from CONFIRMED structured facts that actually fed the writer directives;
    // never carry directive text. They never change writer behavior.
    const structuredFactsProvenance: StructuredFactProvenance[] = [];
    const provenanceGuardrails: GuardrailUnavailableProvenance[] = [];
    let compatibilityBlock = "";
    {
      const { targets, connections } = detectCompatibilityQuery(latestBody);
      // Slice J/M: resolve the asked product (if exactly one is named) BEFORE the
      // compatibility gate. confirmed product-specific rows are served; null =>
      // brand-wide only, never a guess. Doing this first also lets a broad
      // "<product> + <platform>" question (no connection/keyword) be recognized
      // as a compatibility question. Best-effort: a failed lookup leaves it null.
      let compatProductId: number | null = null;
      if (targets.length > 0) {
        try {
          const { data: prodRows } = await supabase
            .from("shop_products")
            .select("id, title")
            .eq("shop_ref_id", shop_id);
          compatProductId = detectCompatibilityProduct(
            latestBody,
            (Array.isArray(prodRows) ? prodRows : []) as Array<{ id: number; title: string }>,
          );
        } catch (_err) {
          compatProductId = null;
        }
      }
      if (
        targets.length > 0 &&
        isCompatibilityQuestion(latestBody, {
          productMentioned: compatProductId != null,
        })
      ) {
        const { data: compatRows, error: compatErr } = await supabase
          .from("shop_product_compatibility")
          .select(
            "product_id, target, connection, compatible, reason, workaround, confidence",
          )
          .eq("shop_ref_id", shop_id)
          .in("target", targets);
        const rows = !compatErr && Array.isArray(compatRows)
          ? (compatRows as Parameters<typeof resolveCompatibility>[0])
          : [];
        const resolved = targets.map((target) =>
          resolveCompatibility(rows, { target, productId: compatProductId })
        );
        // Stage 5, Slice 2B: ALWAYS inject a directive once a lookup was
        // attempted — the confirmed-facts block when known, otherwise the
        // NOT-CONFIRMED abstention block so the writer does not fall back to
        // retrieval/guessing. Known cases also emit structured provenance;
        // unknown cases emit a compatibility/no_confirmed_row guardrail.
        // Slice L: pass the asked connection(s) so the directive marks the exact
        // requested method's confirmed status and offers alternatives safely.
        const compatOutcome = buildCompatibilityOutcome(resolved, connections);
        compatibilityBlock = compatOutcome.directive;
        structuredFactsProvenance.push(...compatOutcome.structuredFacts);
        provenanceGuardrails.push(...compatOutcome.guardrails);
      }
    }
    // Stage 4B-3-2: structured product-comparison facts. Only for explicit
    // comparison questions naming 2+ known products, and only when CONFIRMED
    // comparable specs exist — so unrelated drafts and the pre-seed state are
    // unchanged. A cheap textual cue gates the title lookup so ordinary drafts
    // do no extra DB work. Best-effort: missing table/rows yield no block.
    let comparisonBlock = "";
    if (
      /\bvs\.?\b|\bversus\b|\bdifference\b|\bcompare|\bbetter\b|\bwhich (one|is)\b/i
        .test(latestBody ?? "")
    ) {
      const { data: prodRows } = await supabase
        .from("shop_products")
        .select("id, title")
        .eq("shop_ref_id", shop_id);
      const products = Array.isArray(prodRows)
        ? (prodRows as Array<{ id: number; title: string }>)
        : [];
      const titles = products.map((p) => p.title).filter(Boolean);
      if (isComparisonQuestion(latestBody, titles)) {
        const matched = detectComparisonQuery(latestBody, titles)
          .map((title) => ({
            title,
            id: products.find((p) => p.title === title)?.id ?? null,
          }))
          .filter((m): m is { title: string; id: number } => m.id != null);
        if (matched.length >= 2) {
          const ids = matched.map((m) => m.id);
          const { data: specRows, error: specErr } = await supabase
            .from("shop_product_specs")
            .select(
              "product_id, spec_key, spec_group, spec_value, value_bool, value_num, unit, display_order, comparable, confidence",
            )
            .eq("shop_ref_id", shop_id)
            .or(`product_id.is.null,product_id.in.(${ids.join(",")})`);
          const rows = !specErr && Array.isArray(specRows)
            ? (specRows as Parameters<typeof resolveProductSpecs>[0])
            : [];
          const productSpecs = matched.map((m) => ({
            productId: m.id,
            title: m.title,
            specs: resolveProductSpecs(rows, { productId: m.id }),
          }));
          const comparison = buildSpecComparison(productSpecs);
          comparisonBlock = buildComparisonDirective(
            comparison,
            productSpecs,
            { wasAsked: true },
          );
          // Response-only provenance: only when the directive actually used the
          // confirmed specs (mirrors what the writer received).
          if (comparisonBlock) {
            structuredFactsProvenance.push(
              ...buildComparisonProvenance(comparison, productSpecs),
            );
          }
        }
      }
    }
    const internalRulesBlock = [
      internalRules.block || "",
      returnTrackingAttribution?.blockText || "",
      compatibilityBlock || "",
      comparisonBlock || "",
    ].filter(Boolean).join("\n\n") || undefined;
    const latestSenderEmail = String(
      (latestMessage as Record<string, unknown>).from_email || "",
    ).trim() || null;
    const latestSenderDisplayName = String(
      (latestMessage as Record<string, unknown>).from_name || "",
    ).trim() || null;
    const resolvedCustomerName = resolveCustomerName({
      latestCustomerMessage: latestBody,
      senderEmail: latestSenderEmail,
      senderDisplayName: latestSenderDisplayName,
      contactFormName: contactFormIdentity.detected
        ? contactFormIdentity.customerName
        : null,
      orderCustomerName: facts.facts.find((fact) => fact.label === "Kundenavn")?.value ?? null,
      orderCustomerEmail: facts.order?.email ?? null,
      recentCustomerMessages: messages
        .filter((message) => {
          const row = message as Record<string, unknown>;
          return row.direction !== "outbound" && row.from_me !== true;
        })
        .slice(-6)
        .map((message) => {
          const row = message as Record<string, unknown>;
          return {
            text: visibleEmailText(row),
            senderEmail: String(row.from_email || "").trim() || null,
          };
        }),
    });
    const retrievalTrace = {
      included_chunks: compactRetrievedChunks(
        retrieved.chunks as unknown as Array<Record<string, unknown>>,
      ),
      matcher: retrieved.matcher_debug ?? null,
      diagnostics_coverage: {
        selected_chunks: "captured",
        matcher_rejected_candidates: retrieved.matcher_debug
          ? "captured_as_ranked_not_selected"
          : "not_available",
        drop_reasons: eval_payload && retrieved.candidate_diagnostics
          ? "captured_in_candidate_diagnostics"
          : "not_available_in_generate_draft_v2_retriever",
        raw_candidate_diagnostics: eval_payload && retrieved.candidate_diagnostics
          ? "captured_eval_only"
          : "not_captured",
      },
      ...(eval_payload && retrieved.candidate_diagnostics
        ? { candidate_diagnostics: retrieved.candidate_diagnostics }
        : {}),
    };
    await updateDraftGenerationTrace(supabase, generationId, {
      facts_json: facts,
      retrieved_chunk_ids: retrieved.chunks.map((chunk) => chunk.id),
      retrieval_trace_json: retrievalTrace,
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
    const actionDecisionTrace: Record<string, unknown> = {
      raw: actionDecision,
      effective: {
        proposals: finalProposals,
        routing_hint: effectiveRoutingHint,
        automation,
        is_test_mode: isTestMode,
      },
    };
    await updateDraftGenerationTrace(supabase, generationId, {
      action_decision_json: actionDecisionTrace,
    });

    if (isTestMode) {
      console.log(
        "[generate-draft-v2] workspace is in test_mode — actions will NOT mutate Shopify",
      );
    }

    const latestCustomerMessage = latestBody;

    // Combine recent inbound messages for language detection — the latest message
    // alone may be too short (e.g. "Here is the receipt:") to score reliably.
    // Final fallback is "en": we should reply in the customer's language, not the shop's.
    const recentInboundForLanguage = messages
      .filter((m) => {
        const row = m as Record<string, unknown>;
        return row.direction !== "outbound" && row.from_me !== true;
      })
      .slice(-3)
      .map((m) => visibleEmailText(m))
      .filter((t) => t.length > 0)
      .join(" ");
    const replyLanguageFallback = eval_payload ? plan.language : "en";
    const replyLanguage = resolveReplyLanguage(
      recentInboundForLanguage || latestCustomerMessage,
      replyLanguageFallback,
    );
    const writerReplyLanguageFallback = eval_payload ? replyLanguage : undefined;

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
        provenance: assembleProvenance({
          retrievedChunks: [...retrieved.chunks, ...suppressedLegacyChunks],
          structuredFacts: structuredFactsProvenance,
          facts: facts.facts,
          extraGuardrails: provenanceGuardrails,
        }),
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

    const previewLatestCustomerMessage = latestCustomerMessage ?? latestBody ?? "";
    const previewConversationHistory = Array.isArray(quotedAwareConversationHistory)
      ? quotedAwareConversationHistory
        .map((turn) => String(turn?.text ?? ""))
        .filter(Boolean)
        .join("\n")
      : undefined;

    // Hybrid Product Support section selection: embed the latest customer issue
    // ONCE, and ONLY for an explicit Product Support preview run. Never for
    // Returns & Refunds preview, never for ordinary runtime (no preview
    // context). On any embedding failure we fall back to lexical-only.
    let previewQueryEmbedding: number[] | undefined;
    const previewChunks = input.preview_document_context?.chunks;
    const isProductSupportPreview = Array.isArray(previewChunks) &&
      previewChunks.some((c) =>
        (c?.metadata as Record<string, unknown> | null | undefined)?.category ===
          "product_support"
      );
    if (isProductSupportPreview && previewLatestCustomerMessage.trim()) {
      try {
        previewQueryEmbedding = await embedText(previewLatestCustomerMessage.slice(0, 4000));
      } catch (error) {
        console.warn(
          `[generate-draft-v2] product-support query embedding failed, falling back to lexical: ${error}`,
        );
      }
    }

    const previewDocument = buildKnowledgeDocPreviewContext(
      input.preview_document_context,
      {
        latestCustomerMessage: previewLatestCustomerMessage,
        conversationHistory: previewConversationHistory,
        queryEmbedding: previewQueryEmbedding,
      },
    );
    const authoritativePreviewDocumentContext =
      previewDocument.blockText ?? undefined;
    if (previewDocument.diagnostics) {
      actionDecisionTrace.preview_document_context = previewDocument.diagnostics;
      await updateDraftGenerationTrace(supabase, generationId, {
        action_decision_json: actionDecisionTrace,
      });
    }

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

    // Byg samtalehistorik fra visible messages + parsed quoted support replies.
    const conversationHistory = quotedAwareConversationHistory;

    // Product Support PREVIEW only: the selector abstained (no matching
    // section). Drive the writer into clarification-only mode — suppress
    // troubleshooting knowledge and ask exactly one clarification question in
    // the resolved language — and skip every post-writer LLM pass so legacy
    // knowledge can never re-enter the reply. No effect in ordinary runtime
    // (no preview context) or for Returns & Refunds (different reason).
    const productSupportClarification = isProductSupportClarificationReason(
      previewDocument.diagnostics?.reason,
    );

    // Product Support PREVIEW only: an H2 section WAS selected → enable the
    // topic-lock + progression guardrails in the writer. False for Returns &
    // Refunds preview (reason "injected") and ordinary runtime (no diagnostics).
    const productSupportTopicLock = shouldApplyProductSupportTopicLock(
      previewDocument.diagnostics?.reason,
    );

    // Product Support PREVIEW only: scope legacy retrieved knowledge to the
    // selected product so cross-product snippets (e.g. an A-Blaze-only guide)
    // cannot contaminate a draft generated for a different product's support
    // document. Shared/general rows (no product_id) and the selected product's
    // own rows are kept. Ordinary runtime and Returns & Refunds preview are
    // unaffected (no product_support selection → no product_scope).
    let productSupportLegacyScope:
      | ReturnType<typeof scopeLegacyChunksToProduct>["diagnostics"]
      | undefined;
    const psSelection = previewDocument.diagnostics?.product_support_section_selection;
    if (psSelection?.product_scope) {
      let selectedProductTitle: string | null = null;
      let siblingProductTitles: string[] = [];
      let knownProductExternalIds: string[] = [];
      const selectedExternalId = externalIdFromProductScope(psSelection.product_scope);
      if (selectedExternalId) {
        try {
          // Fetch the shop's product titles so the legacy title-mention fallback
          // can tell prefix-variant siblings apart (wired "A-Spire" vs
          // "A-Spire Wireless"). Preview-only — this block only runs when a
          // Product Support section was selected (product_scope set).
          const { data: prods } = await supabase
            .from("shop_products")
            .select("title, external_id")
            .eq("shop_id", shop_id);
          const productRows = Array.isArray(prods) ? prods : [];
          siblingProductTitles = productRows
            .map((p) => String((p as Record<string, unknown>).title || "").trim())
            .filter(Boolean);
          knownProductExternalIds = productRows
            .map((p) => String((p as Record<string, unknown>).external_id || "").trim())
            .filter(Boolean);
          selectedProductTitle = (productRows.find((p) =>
            String((p as Record<string, unknown>).external_id || "").trim() ===
              selectedExternalId
          )?.title as string | undefined) ?? null;
        } catch (_err) {
          // Best-effort: without the title we still scope by canonical id.
          selectedProductTitle = null;
          siblingProductTitles = [];
          knownProductExternalIds = [];
        }
      }
      const scoped = scopeLegacyChunksToProduct({
        productScope: psSelection.product_scope,
        selectedProductTitle,
        siblingProductTitles,
        knownProductExternalIds,
        chunks: retrieved.chunks.map((c) => ({
          id: c.id,
          product_id: c.product_id,
          products: c.products,
          applies_to_all_products: c.applies_to_all_products,
          content: c.content,
          source_title: c.source_title,
        })),
      });
      productSupportLegacyScope = scoped.diagnostics;
      if (scoped.diagnostics.excluded_cross_product_row_ids.length > 0) {
        const keptIds = new Set(scoped.kept.map((c) => c.id));
        retrieved.chunks = retrieved.chunks.filter((c) => keptIds.has(c.id));
        console.log(
          `[generate-draft-v2] product-support preview scoped legacy retrieval to ${psSelection.product_scope}: excluded ${scoped.diagnostics.excluded_cross_product_row_ids.length} cross-product row(s)`,
        );
      }
    }

    // Deterministic Returns & Refunds grounding: guarantee the canonical returns
    // doc reaches the writer/verifier even when vector recall missed the tiny
    // address chunk (T-050835). Read-only; appended only for return/refund
    // intent and only when not already retrieved. No DB writes, no mutations.
    //
    // Gate on the ADDRESS chunk specifically (Q2b): the returns doc is chunked
    // into many sections (return window, refund processing, opened/tested,
    // addresses…). Retrieving a non-address section is NOT enough — it used to
    // satisfy the old "any returns chunk" gate and skip the fetch, so the tiny
    // address chunks (default + country-specific) never reached the selector and
    // a US customer got the default address (g-034).
    if (isReturnRefundIntent(plan.primary_intent, latestBody)) {
      const hasReturnsDoc = hasGroundedReturnAddressChunk(
        retrieved.chunks as unknown as Parameters<typeof hasGroundedReturnAddressChunk>[0],
      );
      if (!hasReturnsDoc) {
        try {
          const { data: returnsRows } = await supabase
            .from("agent_knowledge")
            .select("id, content, source_provider, metadata")
            .eq("shop_id", shop_id)
            .eq("source_provider", "knowledge_document")
            .eq("metadata->>category", "returns")
            .limit(20);
          for (const r of (Array.isArray(returnsRows) ? returnsRows : [])) {
            const row = r as Record<string, unknown>;
            retrieved.chunks.push({
              id: String(row.id ?? `returns-${retrieved.chunks.length}`),
              content: String(row.content ?? ""),
              kind: "knowledge",
              source_label: "Returns & Refunds",
              similarity: 0,
              usable_as: "policy",
              risk_flags: [],
              applies_to_all_products: true,
              chunk_issue_types: [],
              source_provider: "knowledge_document",
              document_category: "returns",
            });
          }
        } catch (err) {
          console.warn("[generate-draft-v2] returns-doc grounding fetch failed:", err);
        }
      }
    }

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
    // Stage 4B-1: synced, platform-neutral product rows for product-link
    // grounding (fallback between the live stock-fact handle and retrieved
    // shopify_product chunks). Scoped by shop_ref_id (never the legacy NULL
    // shop_id). Best-effort and tolerant of a pre-migration schema: a missing
    // column yields an error → empty list → unchanged chunk-based behavior.
    let productLinkRows: Array<
      { title: string | null; handle: string | null; product_url: string | null }
    > = [];
    {
      const { data: prodRows, error: prodErr } = await supabase
        .from("shop_products")
        .select("title, handle, product_url")
        .eq("shop_ref_id", shop_id);
      productLinkRows = !prodErr && Array.isArray(prodRows)
        ? (prodRows as typeof productLinkRows)
        : [];
    }
    const written = await runWriter({
      products: productLinkRows,
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
      authoritativePreviewDocumentContext,
      productSupportTopicLock,
      completedTroubleshootingBlock:
        previewDocument.completedTroubleshootingBlock ?? undefined,
      resolvedCustomerName,
      replyLanguageFallback: writerReplyLanguageFallback,
      model: firstPassModel,
          effort: writerEffortOverride,
      attachments: imageAttachments,
      actionResult: postActionResult,
      customerHistory: customerHistory ?? undefined,
      nonImageAttachmentsMeta: nonImageAttachmentsMeta || undefined,
      clarificationOnly: productSupportClarification,
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
    if (!productSupportClarification && !initialLanguageCheck.ok) {
      console.warn(
        `[generate-draft-v2] mixed language detected before verifier: expected=${replyLanguage} foreign=${
          initialLanguageCheck.detectedForeignLanguages.join(",")
        } segments=${initialLanguageCheck.foreignSegments.join(" | ")}`,
      );
      try {
        const correctionWritten = await runWriter({
          products: productLinkRows,
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
          authoritativePreviewDocumentContext,
          productSupportTopicLock,
          completedTroubleshootingBlock:
            previewDocument.completedTroubleshootingBlock ?? undefined,
          resolvedCustomerName,
          replyLanguageFallback: writerReplyLanguageFallback,
          model: firstPassModel,
          effort: writerEffortOverride,
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

    // Slice N: deterministic send-ready cleanup for compatibility answers. The
    // directive forbids robotic/internal wording and filler, but the model still
    // emits it, so strip the grammatically-safe offenders post-hoc. Only runs
    // when a compatibility directive was actually injected; never touches facts.
    if (compatibilityBlock && languageCheckedWritten.draft_text) {
      const cleaned = sanitizeCompatibilityDraft(languageCheckedWritten.draft_text);
      if (cleaned !== languageCheckedWritten.draft_text) {
        languageCheckedWritten = {
          ...languageCheckedWritten,
          draft_text: cleaned,
        };
      }
      const toneViolations = detectCompatibilityToneViolations(
        languageCheckedWritten.draft_text,
      );
      if (toneViolations.length > 0) {
        console.warn(
          `[generate-draft-v2] compatibility tone violations remain after sanitize: ${
            toneViolations.join("; ")
          }`,
        );
      }
    }

    for (let attempt = 1; !productSupportClarification && attempt <= 3; attempt++) {
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
          products: productLinkRows,
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
          authoritativePreviewDocumentContext,
          productSupportTopicLock,
          completedTroubleshootingBlock:
            previewDocument.completedTroubleshootingBlock ?? undefined,
          resolvedCustomerName,
          replyLanguageFallback: writerReplyLanguageFallback,
          model: firstPassModel,
          effort: writerEffortOverride,
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

    // Verified-order proof-of-purchase backstop (T-051002): the
    // exact_order_number directive forbids re-asking for receipt/purchase
    // details/where-bought, but the model still slips. Deterministic detect →
    // correction rewrite, mirroring the post-action retry.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const proofAskViolations = detectVerifiedOrderProofAsks(
        languageCheckedWritten.draft_text,
        facts.match?.state ?? null,
      );
      if (proofAskViolations.length === 0) break;
      console.warn(
        `[generate-draft-v2] verified-order proof-ask retry ${attempt}: ${
          proofAskViolations.join("; ")
        }`,
      );
      try {
        const correctionWritten = await runWriter({
          products: productLinkRows,
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
          authoritativePreviewDocumentContext,
          productSupportTopicLock,
          completedTroubleshootingBlock:
            previewDocument.completedTroubleshootingBlock ?? undefined,
          resolvedCustomerName,
          replyLanguageFallback: writerReplyLanguageFallback,
          model: firstPassModel,
          effort: writerEffortOverride,
          attachments: imageAttachments,
          actionResult: postActionResult,
          languageCorrectionInstruction:
            `Rewrite the full draft in ${replyLanguage}. The customer's order is already VERIFIED in the shop's own system (exact order-number match) — proof of purchase, place of purchase and the order number are established facts. REMOVE every request for purchase details, receipt, proof of purchase, invoice, order number/confirmation, or where the product was bought. Do NOT ask the customer to confirm warranty coverage. For warranty/defect cases, ask instead for the next concrete step (e.g. clear photos or a short video of the damage) if that ask is not already present. Keep all other content and the greeting unchanged. Fix these issues: ${
              proofAskViolations.join("; ")
            }. Do not add a signature or support email.`,
        });
        if (correctionWritten.draft_text) {
          languageCheckedWritten = correctionWritten;
          if (
            !mixedLanguageCheck(languageCheckedWritten.draft_text, replyLanguage)
              .ok
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
          "[generate-draft-v2] verified-order proof-ask retry failed:",
          err,
        );
      }
    }

    // Physical-damage documentation backstop: never arrange a replacement/
    // repair for physical damage without asking for photo/video evidence
    // (unless the customer already attached images).
    for (let attempt = 1; attempt <= 2; attempt++) {
      const damageDocViolations = detectMissingDamageDocumentationAsk({
        draftText: languageCheckedWritten.draft_text,
        customerMessage: latestCustomerMessage,
        imageAttachmentCount: imageAttachments.length,
      });
      if (damageDocViolations.length === 0) break;
      console.warn(
        `[generate-draft-v2] damage-documentation retry ${attempt}: ${
          damageDocViolations.join("; ")
        }`,
      );
      try {
        const correctionWritten = await runWriter({
          products: productLinkRows,
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
          authoritativePreviewDocumentContext,
          productSupportTopicLock,
          completedTroubleshootingBlock:
            previewDocument.completedTroubleshootingBlock ?? undefined,
          resolvedCustomerName,
          replyLanguageFallback: writerReplyLanguageFallback,
          model: firstPassModel,
          effort: writerEffortOverride,
          attachments: imageAttachments,
          actionResult: postActionResult,
          languageCorrectionInstruction:
            `Rewrite the full draft in ${replyLanguage}. The customer reports PHYSICAL damage and no images are attached yet. Keep the replacement/repair offer, but ask the customer to send clear photos or a short video of the damage as the concrete next step so the claim can be processed. Do not ask for purchase details, receipt or where the product was bought. Keep the greeting and all verified facts unchanged. Do not add a signature or support email.`,
        });
        if (correctionWritten.draft_text) {
          languageCheckedWritten = correctionWritten;
          if (
            !mixedLanguageCheck(languageCheckedWritten.draft_text, replyLanguage)
              .ok
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
          "[generate-draft-v2] damage-documentation retry failed:",
          err,
        );
      }
    }

    if (languageCheckedWritten.draft_text) {
      const cleaned = sanitizeSupportVoiceDraft(languageCheckedWritten.draft_text);
      if (cleaned !== languageCheckedWritten.draft_text) {
        languageCheckedWritten = {
          ...languageCheckedWritten,
          draft_text: cleaned,
        };
      }
    }

    const supportVoiceViolations = detectSupportVoiceViolations(
      languageCheckedWritten.draft_text,
    );
    if (!productSupportClarification && supportVoiceViolations.length > 0) {
      console.warn(
        `[generate-draft-v2] support voice retry: ${
          supportVoiceViolations.join(",")
        }`,
      );
      try {
        const correctionWritten = await runWriter({
          products: productLinkRows,
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
          authoritativePreviewDocumentContext,
          productSupportTopicLock,
          completedTroubleshootingBlock:
            previewDocument.completedTroubleshootingBlock ?? undefined,
          resolvedCustomerName,
          replyLanguageFallback: writerReplyLanguageFallback,
          model: firstPassModel,
          effort: writerEffortOverride,
          attachments: imageAttachments,
          actionResult: postActionResult,
          customerHistory: customerHistory ?? undefined,
          nonImageAttachmentsMeta: nonImageAttachmentsMeta || undefined,
          languageCorrectionInstruction: buildSupportVoiceRewriteInstruction({
            language: replyLanguage,
            violations: supportVoiceViolations,
          }),
        });
        if (correctionWritten.draft_text) {
          let correctedDraft = sanitizeSupportVoiceDraft(
            correctionWritten.draft_text,
          );
          if (!mixedLanguageCheck(correctedDraft, replyLanguage).ok) {
            correctedDraft = cleanupMixedLanguageDraft(
              correctedDraft,
              replyLanguage,
            );
          }
          languageCheckedWritten = {
            ...correctionWritten,
            draft_text: correctedDraft,
          };
        }
      } catch (err) {
        console.warn(
          "[generate-draft-v2] support voice correction retry failed:",
          err,
        );
      }

      const remainingSupportVoiceViolations = detectSupportVoiceViolations(
        languageCheckedWritten.draft_text,
      );
      if (remainingSupportVoiceViolations.length > 0) {
        console.warn(
          `[generate-draft-v2] support voice violations remain after retry: ${
            remainingSupportVoiceViolations.join(",")
          }`,
        );
      }
    }

    // 10. Verificér grounding og kvalitet. Skipped for the clarification-only
    // preview branch: there is nothing to ground (it is a single question) and
    // we must not trigger a verifier-driven rewrite (an extra LLM call) that
    // could re-introduce troubleshooting.
    currentStage = "verifier";
    const verified: VerifierResult = productSupportClarification
      ? {
        grounded_claims_pct: 1,
        contradictions: [],
        policy_violations: [],
        confidence: 0.6,
        block_send: false,
        retry_with_stronger_model: false,
        issues: [],
      }
      : await runVerifier({
        draftText: languageCheckedWritten.draft_text,
        proposedActions: finalProposals,
        citations: languageCheckedWritten.citations,
        facts,
        retrievedChunks: retrieved.chunks,
        customerMessage: latestCustomerMessage,
        conversationHistory,
        primaryIntent: plan.primary_intent,
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
          products: productLinkRows,
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
          authoritativePreviewDocumentContext,
          productSupportTopicLock,
          completedTroubleshootingBlock:
            previewDocument.completedTroubleshootingBlock ?? undefined,
          resolvedCustomerName,
          replyLanguageFallback: writerReplyLanguageFallback,
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
            conversationHistory,
            primaryIntent: plan.primary_intent,
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

    let blockSendRecommended = false;
    const finalSupportVoiceViolations = detectSupportVoiceViolations(
      finalDraft ?? "",
    );
    if (finalSupportVoiceViolations.length > 0) {
      finalRoutingHint = "review";
      blockSendRecommended = true;
      finalConfidence = Math.min(finalConfidence, 0.72);
      console.warn(
        `[generate-draft-v2] support voice guard flagged ${
          finalSupportVoiceViolations.join(",")
        } — routing to review`,
      );
    }

    // 12. Deterministic post-writer safety check — catches unsupported
    // refund/prepaid-label/replacement/exchange promises that prompt-only
    // guardrails do not reliably prevent. Additive only: never rewrites the
    // draft, never executes actions; only escalates routing_hint to "review".
    const unsupportedCommitmentCheck = checkUnsupportedCommitments({
      draft_text: finalDraft ?? "",
      approved_actions: finalProposals
        .filter((p) => !p.requires_approval)
        .map((p) => ({ type: p.type })),
      suggested_actions: finalProposals
        .filter((p) => p.requires_approval)
        .map((p) => ({ type: p.type })),
      retrieved_chunks: retrieved.chunks,
      language: replyLanguage,
    });
    if (unsupportedCommitmentCheck.requires_review) {
      finalRoutingHint = "review";
      blockSendRecommended = true;
      console.warn(
        `[generate-draft-v2] unsupported commitment check flagged ${unsupportedCommitmentCheck.violations.length} violation(s) — routing to review`,
      );
    }

    // 12b. Deterministic guard against an ungrounded "gift" / "original
    // purchaser" assumption (warranty / third-party cases). Same additive
    // posture: never rewrites, only escalates routing_hint to "review".
    const conversationTextForAssumptions = [
      latestCustomerMessage ?? "",
      Array.isArray(conversationHistory)
        ? conversationHistory
          .map((m) => (m && typeof m === "object" ? String(m.text ?? "") : ""))
          .join("\n")
        : String(conversationHistory ?? ""),
    ].join("\n");
    const unsupportedAssumptionCheck = checkUnsupportedAssumptions({
      draft_text: finalDraft ?? "",
      conversation_text: conversationTextForAssumptions,
    });
    if (unsupportedAssumptionCheck.requires_review) {
      finalRoutingHint = "review";
      blockSendRecommended = true;
      console.warn(
        `[generate-draft-v2] ungrounded gift/original-purchaser assumption flagged ${unsupportedAssumptionCheck.violations.length} violation(s) — routing to review`,
      );
    }

    // 12c. Deterministic guard against unsupported live-fact / action-completed
    // claims (fabricated tracking/delivery/refund status, or "I've sent the
    // invoice / cancelled your order / updated your address / sent a
    // replacement" with no executed action). Executed actions come ONLY from a
    // post-action pass (postActionResult) — never from proposed/requires_approval
    // actions. Same additive posture: never rewrites, only escalates to review.
    const executedActionTypes = postActionResult &&
        String(postActionResult.outcome || "executed") !== "declined" &&
        typeof postActionResult.action_type === "string"
      ? [String(postActionResult.action_type)]
      : [];
    const liveFactActionClaimCheck = checkLiveFactAndActionClaims({
      draft_text: finalDraft ?? "",
      facts: facts.facts,
      tracking_facts: facts.tracking_facts,
      executed_action_types: executedActionTypes,
      language: replyLanguage,
    });
    if (liveFactActionClaimCheck.requires_review) {
      finalRoutingHint = "review";
      blockSendRecommended = true;
      console.warn(
        `[generate-draft-v2] unsupported live-fact/action claim flagged ${
          liveFactActionClaimCheck.violations
            .map((v) => v.type)
            .join(", ")
        } — routing to review`,
      );
    }

    // 12d. Deterministic guard against unsupported image-evidence claims — the
    // draft says it has seen/assessed an image when no real image reached the
    // model (imageAttachments is the AZ-1-filtered vision set; eval-mode and
    // logo-only mails yield 0). Same additive posture: never rewrites, only
    // escalates routing_hint to "review".
    const imageEvidenceGuard = applyImageEvidenceClaimGuard(
      { routingHint: finalRoutingHint, blockSendRecommended },
      {
        draftText: finalDraft ?? "",
        imageEvidenceCount: imageAttachments.length,
        language: replyLanguage,
      },
    );
    finalRoutingHint = imageEvidenceGuard.routingHint;
    blockSendRecommended = imageEvidenceGuard.blockSendRecommended;
    if (imageEvidenceGuard.violations.length > 0) {
      console.warn(
        `[generate-draft-v2] unsupported image-evidence claim flagged ${
          imageEvidenceGuard.violations.map((v) => v.type).join(", ")
        } — routing to review`,
      );
    }

    // 12e. Deterministic guard against unsupported NEGATIVE compatibility /
    // accessory-fit / availability / purchasability claims ("not compatible",
    // "does not fit", "not available", "cannot buy") that lack grounding in
    // structured compatibility provenance, live stock facts, or a retrieved
    // knowledge chunk. Same additive posture: never rewrites, only escalates
    // routing_hint to "review".
    const unsupportedNegativeClaimCheck = checkUnsupportedNegativeClaims({
      draft_text: finalDraft ?? "",
      structured_facts: structuredFactsProvenance,
      facts: facts.facts,
      retrieved_chunks: retrieved.chunks,
    });
    if (unsupportedNegativeClaimCheck.requires_review) {
      finalRoutingHint = "review";
      blockSendRecommended = true;
      console.warn(
        `[generate-draft-v2] unsupported negative compatibility/availability claim flagged ${
          unsupportedNegativeClaimCheck.violations
            .map((v) => v.type)
            .join(", ")
        } — routing to review`,
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

    // Feedback-1c-1: best-effort draft_generated coupling event. Never throws,
    // never alters the draft; suppressed on no-write (eval/dry-run) runs. The AI
    // draft text stays in draft_generations.final_draft_text (reached via
    // generation_id) — only ids/enums/small metadata are recorded here.
    await emitDraftGeneratedEvent({
      supabase,
      isNoWrite: isDryRun,
      generationId,
      draftId,
      threadId: thread_id,
      shopId: shop_id,
      workspaceId,
      routingHint: finalRoutingHint,
      blockSendRecommended,
      payload: {
        intent: plan.primary_intent,
        language: caseState.language,
        pipeline_version: "v2",
        verifier_block_send: blockSendRecommended,
      },
    });

    return {
      draft_text: deferDraftUntilActionDecision ? null : finalDraft,
      draft_id: eval_payload ? undefined : draftId,
      generation_id: generationId,
      proposed_actions: finalProposals,
      routing_hint: finalRoutingHint,
      block_send_recommended: blockSendRecommended,
      unsupported_commitment_check: {
        checked: true,
        compliant: unsupportedCommitmentCheck.compliant,
        violations: unsupportedCommitmentCheck.violations,
        requires_review: unsupportedCommitmentCheck.requires_review,
      },
      unsupported_assumption_check: {
        checked: true,
        compliant: unsupportedAssumptionCheck.compliant,
        violations: unsupportedAssumptionCheck.violations,
        requires_review: unsupportedAssumptionCheck.requires_review,
      },
      live_fact_action_claim_check: {
        checked: true,
        compliant: liveFactActionClaimCheck.compliant,
        violations: liveFactActionClaimCheck.violations,
        requires_review: liveFactActionClaimCheck.requires_review,
      },
      unsupported_negative_claim_check: {
        checked: true,
        compliant: unsupportedNegativeClaimCheck.compliant,
        violations: unsupportedNegativeClaimCheck.violations,
        requires_review: unsupportedNegativeClaimCheck.requires_review,
      },
      support_voice_check: {
        checked: true,
        compliant: finalSupportVoiceViolations.length === 0,
        violations: finalSupportVoiceViolations,
        requires_review: finalSupportVoiceViolations.length > 0,
      },
      is_test_mode: isTestMode,
      confidence: finalConfidence,
      intent: plan.primary_intent,
      knowledge_gaps: knowledgeGaps,
      sources: buildPipelineSources({
        retrievedChunks: retrieved.chunks,
        previewSources: previewDocument.sources,
      }),
      provenance: assembleProvenance({
        retrievedChunks: [...retrieved.chunks, ...suppressedLegacyChunks],
        structuredFacts: structuredFactsProvenance,
        facts: facts.facts,
        extraGuardrails: provenanceGuardrails,
      }),
      ...(previewDocument.diagnostics
        ? { preview_document_context: previewDocument.diagnostics }
        : {}),
      ...(productSupportClarification
        ? {
          product_support_clarification: {
            used: true,
            reason: "low_confidence_no_matching_section",
          },
        }
        : {}),
      ...(productSupportLegacyScope
        ? { product_support_legacy_scope: productSupportLegacyScope }
        : {}),
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
            ...(retrieved.candidate_diagnostics
              ? { candidate_diagnostics: retrieved.candidate_diagnostics }
              : {}),
            ...(facts.stock_lookup_debug
              ? { stock_lookup_debug: facts.stock_lookup_debug }
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
