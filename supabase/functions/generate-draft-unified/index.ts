// supabase/functions/generate-draft-unified/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildAutomationGuidance,
  fetchAutomation,
  fetchRelevantKnowledge,
  fetchRelevantKnowledgeDetailed,
  fetchOwnerProfile,
  fetchPersona,
  fetchPolicies,
  type KnowledgeMatch,
} from "../_shared/agent-context.ts";
import { assessCase, type CaseAssessment } from "../_shared/case-assessment.ts";
import { retrieveFactContext, type FactContext } from "../_shared/fact-context.ts";
import {
  getKnowledgeSourcePriority,
  mapKnowledgeSourceClass,
  summarizeRetrievalPriority,
} from "../_shared/knowledge-source-class.ts";
import { decideActions, type ActionDecision } from "../_shared/action-decision.ts";
import {
  validateActionDecision,
  type ActionDecisionValidation,
} from "../_shared/action-validator.ts";
import { buildReplyStrategy, type ReplyStrategy } from "../_shared/reply-strategy.ts";
import { generateReplyFromStrategy } from "../_shared/reply-generator.ts";
import {
  containsCompletionLanguage,
  guardSameChannelEscalation,
  guardReplyForExecutionState,
  isActionSensitiveReplyCase,
  type ExecutionState,
} from "../_shared/reply-safety.ts";
import { AutomationAction, executeAutomationActions } from "../_shared/automation-actions.ts";
import { classifyEmail } from "../_shared/classify-email.ts";
import type { EmailCategory } from "../_shared/email-category.ts";
import { PERSONA_REPLY_JSON_SCHEMA } from "../_shared/openai-schema.ts";
import { buildOrderSummary, resolveOrderContext } from "../_shared/shopify.ts";
import { buildMailPrompt } from "../_shared/prompt.ts";
import { formatEmailBody } from "../_shared/email.ts";
import { buildPinnedPolicyContext } from "../_shared/policy-context.ts";
import {
  ensureWorkspaceReturnSettings,
  type WorkspaceReturnSettings,
} from "../_shared/return-settings.ts";
import { evaluateReturnEligibility, type ReturnEligibilityResult } from "../_shared/return-eligibility.ts";
import {
  applyMatchedSubjectOrderNumber,
  buildReturnDetailsFoundBlock,
  extractReturnDetails,
  isReturnReasonRequiredByPolicy,
  missingReturnDetails,
} from "../_shared/return-details.ts";
import { fetchTrackingDetailsForOrders } from "../_shared/tracking.ts";
import {
  buildTrackingReplyFallback,
  buildTrackingReplySameLanguage,
  detectTrackingIntent,
  pickOrderTrackingKey,
} from "../_shared/tracking-reply.ts";
import { applyWorkflowActionPolicy } from "./workflows/action-policy.ts";
import { BASE_ACTION_CONTEXT } from "./workflows/prompt-parts.ts";
import { buildWorkflowRoute, extractThreadCategoryFromTags } from "./workflows/routes.ts";


const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const OPENAI_EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
const ENCRYPTION_KEY = Deno.env.get("ENCRYPTION_KEY");
const SHOPIFY_API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2024-07";
const EDGE_DEBUG_LOGS = Deno.env.get("EDGE_DEBUG_LOGS") === "true";

const readEnvNumber = (
  key: string,
  fallback: number,
  options?: { min?: number; max?: number },
) => {
  const raw = Deno.env.get(key);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  let next = parsed;
  if (Number.isFinite(options?.min)) next = Math.max(next, Number(options?.min));
  if (Number.isFinite(options?.max)) next = Math.min(next, Number(options?.max));
  return next;
};

const readEnvFlag = (key: string, fallback: boolean) => {
  const raw = Deno.env.get(key);
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const KNOWLEDGE_MIN_SIMILARITY = readEnvNumber("KNOWLEDGE_MIN_SIMILARITY", 0.62, {
  min: 0,
  max: 1,
});
const PRODUCT_MIN_SIMILARITY = readEnvNumber("PRODUCT_MIN_SIMILARITY", 0.35, {
  min: 0,
  max: 1,
});
const MAX_RETRIEVAL_CHUNKS = readEnvNumber("MAX_RETRIEVAL_CHUNKS", 4, {
  min: 1,
  max: 10,
});
const MAX_CONTEXT_TOKENS = readEnvNumber("MAX_CONTEXT_TOKENS", 3500, {
  min: 0,
});
const KNOWLEDGE_SECTION_MIN_TOKENS = readEnvNumber("KNOWLEDGE_SECTION_MIN_TOKENS", 450, {
  min: 150,
  max: 900,
});
const TECHNICAL_FALLBACK_KNOWLEDGE_MIN_SIMILARITY = readEnvNumber(
  "TECHNICAL_FALLBACK_KNOWLEDGE_MIN_SIMILARITY",
  0.42,
  { min: 0, max: 1 },
);
const POLICY_RESERVED_TOKENS = readEnvNumber("POLICY_RESERVED_TOKENS", 600, {
  min: 400,
  max: 800,
});
const CLASSIFY_FIRST = readEnvFlag("CLASSIFY_FIRST", true);
const RETRIEVAL_TRACE_ENABLED = readEnvFlag("RETRIEVAL_TRACE_ENABLED", false);
const RETRIEVAL_TRACE_SAMPLE_RATE = readEnvNumber(
  "RETRIEVAL_TRACE_SAMPLE_RATE",
  Deno.env.get("DENO_DEPLOYMENT_ID") ? 0.1 : 1,
  { min: 0, max: 1 },
);
const V2_STAGED_ORCHESTRATOR_ENABLED = readEnvFlag("V2_STAGED_ORCHESTRATOR_ENABLED", false);
const V2_CASE_ASSESSMENT_ENABLED = readEnvFlag("V2_CASE_ASSESSMENT_ENABLED", false);
const V2_ACTION_VALIDATION_ENABLED = readEnvFlag("V2_ACTION_VALIDATION_ENABLED", false);
const V2_REPLY_STRATEGY_ENABLED = readEnvFlag("V2_REPLY_STRATEGY_ENABLED", false);
const V2_DECIDE_ACTIONS_ENABLED = readEnvFlag("V2_DECIDE_ACTIONS_ENABLED", false);
const V2_GENERATE_REPLY_FROM_STRATEGY_ENABLED = readEnvFlag(
  "V2_GENERATE_REPLY_FROM_STRATEGY_ENABLED",
  false,
);
const V2_TWO_STAGE_FALLBACK_ENABLED = readEnvFlag("V2_TWO_STAGE_FALLBACK_ENABLED", true);
const V2_RETRIEVAL_RERANK_BY_CASE_TYPE_ENABLED = readEnvFlag(
  "V2_RETRIEVAL_RERANK_BY_CASE_TYPE_ENABLED",
  false,
);
const V2_RETRIEVAL_RERANK_BY_CASE_TYPE_RAW =
  Deno.env.get("V2_RETRIEVAL_RERANK_BY_CASE_TYPE_ENABLED") ?? null;
const V2_STRUCTURED_ARTIFACT_LOGGING_ENABLED = readEnvFlag(
  "V2_STRUCTURED_ARTIFACT_LOGGING_ENABLED",
  false,
);
const POLICY_SOURCE_PROVIDER = "shopify_policy";
const TRACKING_CARRIERS_PROVIDER = "tracking_carriers";
const ZENDESK_SOURCE_PROVIDER = "zendesk";

if (!PROJECT_URL) console.warn("PROJECT_URL mangler – generate-draft-unified kan ikke kalde Supabase.");
if (!SERVICE_ROLE_KEY)
  console.warn("SERVICE_ROLE_KEY mangler – generate-draft-unified kan ikke læse tabeller.");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY mangler – AI udkast vil kun bruge fallback.");
if (!Deno.env.get("OPENAI_MODEL")) console.warn("OPENAI_MODEL mangler – bruger default gpt-4o-mini.");
if (!Deno.env.get("OPENAI_EMBEDDING_MODEL"))
  console.warn("OPENAI_EMBEDDING_MODEL mangler – bruger default text-embedding-3-small.");
if (!ENCRYPTION_KEY)
  console.warn("ENCRYPTION_KEY mangler – Shopify opslag/dekryptering kan fejle.");

// Service-role klient bruges til at læse/skrive på tværs af tenants.
const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

const emitDebugLog = (...args: Array<unknown>) => {
  if (EDGE_DEBUG_LOGS) console.log(...args);
};

type EmailData = {
  messageId?: string;
  threadId?: string;
  subject?: string;
  from?: string;
  fromEmail?: string;
  body?: string;
  headers?: Array<{ name: string; value: string }>;
};

type AgentContext = {
  workspaceId: string | null;
  ownerUserId: string | null;
  profile: Awaited<ReturnType<typeof fetchOwnerProfile>>;
  persona: Awaited<ReturnType<typeof fetchPersona>>;
  automation: Awaited<ReturnType<typeof fetchAutomation>>;
  policies: Awaited<ReturnType<typeof fetchPolicies>>;
  relevantKnowledgeMatches: KnowledgeMatch[];
  orderSummary: string;
  matchedSubjectNumber: string | null;
  orders: any[];
};

type ShopScope = {
  ownerUserId: string | null;
  workspaceId: string | null;
};

type OpenAIResult = {
  reply: string | null;
  actions: AutomationAction[];
};

type InlineImageAttachment = {
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  dataUrl: string;
};

type ProductMatch = {
  id?: string | number;
  external_id?: string | number;
  title?: string;
  handle?: string;
  description?: string;
  similarity?: number;
  score?: number;
  price?: string | number;
};

const PII_EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PII_PHONE_REGEX = /\+?\d[\d\s().-]{7,}\d/g;

const stripHtmlSimple = (html: string) =>
  String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const normalizeLine = (value: string) => String(value || "").replace(/\s+/g, " ").trim();

const maskPii = (value: string) =>
  normalizeLine(value).replace(PII_EMAIL_REGEX, "[email]").replace(PII_PHONE_REGEX, "[phone]");

const splitLines = (value: string) =>
  String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const wordCount = (value: string) =>
  normalizeLine(value)
    .split(" ")
    .filter(Boolean).length;

const estimateTokens = (value: string) => Math.ceil(String(value || "").length / 4);

const truncateToApproxTokens = (value: string, maxTokens: number) => {
  const text = String(value || "");
  if (maxTokens <= 0) return "";
  const approxChars = Math.max(0, Math.floor(maxTokens * 4));
  if (!approxChars || text.length <= approxChars) return text;
  return text.slice(0, approxChars).trim();
};

const getKnowledgePromptPriority = (provider: string) => {
  const normalized = String(provider || "").trim().toLowerCase();
  switch (normalized) {
    case "manual_text":
      return 600;
    case "pdf_upload":
    case "image_upload":
      return 560;
    case "shopify_file":
      return 520;
    case "shopify_page":
      return 500;
    case "shopify_product":
    case "shopify_variant":
      return 490;
    case "shopify_policy":
      return 470;
    case "shopify_collection":
    case "shopify_metaobject":
    case "shopify_metafield":
    case "shopify_blog_article":
      return 460;
    case ZENDESK_SOURCE_PROVIDER:
      return 100;
    default:
      return 220;
  }
};

const normalizeForHash = (value: string) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const shouldSample = (rate: number) => {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() < rate;
};

const withThreadMeta = (detail: string, threadId?: string | null) => {
  if (!threadId) return detail;
  const raw = String(detail || "").trim();
  if (!raw) return `thread_id:${threadId}`;
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return JSON.stringify({ ...parsed, thread_id: parsed.thread_id || threadId });
      }
    } catch {
      // Fallback to text marker below.
    }
  }
  return `${raw} |thread_id:${threadId}`;
};

const appendStructuredArtifactLog = (
  reasoningLogs: Array<{ step_name: string; step_detail: string; status: string }>,
  stepName: string,
  artifact: Record<string, unknown>,
  threadId?: string | null,
) => {
  if (!V2_STRUCTURED_ARTIFACT_LOGGING_ENABLED) return;
  reasoningLogs.push({
    step_name: stepName,
    step_detail: withThreadMeta(JSON.stringify(artifact), threadId),
    status: "info",
  });
};

const deriveExecutionState = (options: {
  validation: ActionDecisionValidation | null;
  hasBlockedAction?: boolean;
  hasPendingApproval?: boolean;
}): ExecutionState => {
  if (options.hasBlockedAction) return "blocked";
  if (options.hasPendingApproval) return "pending_approval";
  if (!options.validation || options.validation.allowed_actions.length === 0) return "no_action";
  if (options.validation.decision === "approval_required") return "pending_approval";
  if (options.validation.decision === "auto_action") return "validated_not_executed";
  return "no_action";
};

const isApprovalRequiredProposalFlow = (options: {
  validation: ActionDecisionValidation | null;
  hasPendingApproval?: boolean;
  executionState: ExecutionState;
}) =>
  options.hasPendingApproval ||
  options.executionState === "pending_approval" ||
  options.validation?.decision === "approval_required";

const routeCategoryFromIntent = (intent: CaseAssessment["latest_message_primary_intent"]): EmailCategory | null => {
  switch (intent) {
    case "technical_issue":
    case "product_question":
    case "warranty_complaint":
      return "Product question";
    case "tracking_shipping":
      return "Tracking";
    case "return_refund":
      return "Return";
    case "billing_payment":
      return "Payment";
    case "order_change":
      return "General";
    case "general_support":
      return "General";
    default:
      return null;
  }
};

const shouldUseLatestMessageRoute = (assessment: CaseAssessment) =>
  (
    assessment.latest_message_confidence >= 0.55 ||
    (
      assessment.latest_message_confidence >= 0.42 &&
      assessment.historical_context_intents.includes("tracking_shipping") &&
      assessment.latest_message_primary_intent !== "tracking_shipping" &&
      (
        assessment.latest_message_primary_intent === "general_support" ||
        assessment.latest_message_primary_intent === "return_refund" ||
        assessment.latest_message_primary_intent === "order_change"
      )
    )
  ) &&
  assessment.intent_conflict_detected &&
  assessment.current_message_should_override_thread_route;

const shouldSuppressTrackingEnrichment = (options: {
  assessment: CaseAssessment | null;
  currentMessageTrackingIntent: boolean;
}) => {
  if (options.currentMessageTrackingIntent) return false;
  const assessment = options.assessment;
  if (!assessment) return false;
  const staleTrackingHistory = assessment.historical_context_intents.includes("tracking_shipping");
  const nonTrackingCurrentAsk =
    assessment.latest_message_primary_intent !== "tracking_shipping" &&
    (
      assessment.latest_message_primary_intent === "general_support" ||
      assessment.latest_message_primary_intent === "return_refund" ||
      assessment.latest_message_primary_intent === "order_change"
    );
  return staleTrackingHistory && nonTrackingCurrentAsk;
};

const shouldSuppressPolicyForTechnicalReply = (options: {
  assessment: CaseAssessment | null;
  executionState: ExecutionState;
  policyIntent?: string | null;
}) => {
  const assessment = options.assessment;
  if (!assessment) return false;
  const types = new Set([assessment.primary_case_type, ...assessment.secondary_case_types]);
  const technicalOrProduct = types.has("technical_issue") || types.has("product_question");
  const hasReturnRefundIntent = types.has("return_refund");
  return (
    technicalOrProduct &&
    !hasReturnRefundIntent &&
    options.executionState === "no_action" &&
    String(options.policyIntent || "OTHER").toUpperCase() === "OTHER"
  );
};

const buildCompactTroubleshootingQuery = (
  assessment: CaseAssessment | null,
  customerMessage?: string | null,
) => {
  if (!assessment) return "";
  const normalizedMessage = String(customerMessage || "")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter((line) =>
      line &&
      !/^(?:(?:den|on|mon\.?|tue\.?|tues\.?|wed\.?|thu\.?|thur\.?|thurs\.?|fri\.?|sat\.?|sun\.?|man\.?|tir\.?|tirs\.?|ons\.?|tor\.?|tors\.?|fre\.?|lør\.?|loer\.?|søn\.?|soen\.?)\b.*\b(?:wrote|skrev)\b.*|(?:fra|from|til|to|subject|emne|cc|bcc|date|dato|sent|sendt)\s*:.*|.*<[^>]+@[^>]+>:\s*$)/i
        .test(line)
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const symptomPhrases = (assessment.entities.symptom_phrases || [])
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const contextPhrases = (assessment.entities.context_phrases || [])
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const productPhrases = (assessment.entities.product_queries || [])
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const issuePriorityPatterns: Array<{ pattern: RegExp; value: string }> = [
    {
      pattern:
        /\b(?:dongle|receiver|usb dongle|wireless receiver|trådløs forbindelse|same frequency|samme frekvens)\b/i,
      value: "dongle",
    },
    {
      pattern:
        /\b(?:disconnects again|disconnects|disconnecting|loses connection|drops connection|can't stay connected|cannot stay connected|hopper af|hopper fra|mister forbindelsen|forbindelsen ryger)\b/i,
      value: "disconnects",
    },
    {
      pattern:
        /\b(?:10\s*seconds?|ten seconds?|few seconds?|10\s*sekunder|sekunder|sek)\b/i,
      value: "10 seconds",
    },
    {
      pattern: /\b(?:no sound|audio drops|sound cuts out|ingen lyd|lyden forsvinder)\b/i,
      value: "no sound",
    },
    {
      pattern:
        /\b(?:everything updated|fully updated|all updated|already updated|updated|opdateret|alt er opdateret)\b/i,
      value: "updated",
    },
    {
      pattern:
        /\b(?:pairing problem|connection issue|wireless connection|forbindelsesproblem|parringsproblem)\b/i,
      value: "connectivity",
    },
  ];

  const prioritizedTokens: string[] = [];
  const pushUnique = (value: string) => {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized) return;
    if (prioritizedTokens.includes(normalized)) return;
    prioritizedTokens.push(normalized);
  };

  if (productPhrases.length) {
    pushUnique(productPhrases[0]);
  }

  for (const entry of issuePriorityPatterns) {
    const matchedAssessment =
      symptomPhrases.some((value) => entry.pattern.test(value)) ||
      contextPhrases.some((value) => entry.pattern.test(value));
    const matchedMessage = normalizedMessage && entry.pattern.test(normalizedMessage);
    if (matchedAssessment || matchedMessage) {
      pushUnique(entry.value);
    }
  }

  for (const value of symptomPhrases) {
    if (prioritizedTokens.length >= 5) break;
    if (value.length <= 40) pushUnique(value);
  }
  for (const value of contextPhrases) {
    if (prioritizedTokens.length >= 6) break;
    if (value.length <= 24) pushUnique(value);
  }

  return prioritizedTokens.slice(0, 6).join(" ");
};

const buildTechnicalKnowledgeSummary = (
  assessment: CaseAssessment | null,
  knowledgeHits: Array<{
    source_class: string;
    source_provider: string;
    similarity: number | null;
    included: boolean;
    content: string;
    _text: string;
  }>,
) => {
  if (!assessment) return "";
  const types = new Set([assessment.primary_case_type, ...assessment.secondary_case_types]);
  const technicalOrProduct = types.has("technical_issue") || types.has("product_question");
  if (!technicalOrProduct) return "";
  return knowledgeHits
    .filter((hit) =>
      hit.included &&
      [
        "troubleshooting",
        "product_manual",
        "support_process",
        "general_knowledge",
      ].includes(String(hit.source_class || "")) &&
      [
        "manual_text",
        "shopify_file",
        "pdf_upload",
        "shopify_page",
        "csv_support_knowledge",
      ].includes(String(hit.source_provider || "").toLowerCase())
    )
    .sort((left, right) => Number(right.similarity ?? 0) - Number(left.similarity ?? 0))
    .slice(0, 4)
    .map((hit) => hit._text)
    .join("\n");
};

const extractTechnicalDiagnosticFacts = (
  assessment: CaseAssessment | null,
  knowledgeHits: Array<{
    source_class: string;
    source_provider: string;
    similarity: number | null;
    included: boolean;
    content: string;
  }>,
) => {
  if (!assessment) return [] as string[];
  const types = new Set([assessment.primary_case_type, ...assessment.secondary_case_types]);
  const technicalOrProduct = types.has("technical_issue") || types.has("product_question");
  if (!technicalOrProduct) return [];

  const productName = String(assessment.entities.product_queries?.[0] || "").toLowerCase();
  const symptomTerms = (assessment.entities.symptom_phrases || [])
    .flatMap((item) => String(item || "").toLowerCase().split(/\s+/))
    .filter(Boolean);
  const contextTerms = (assessment.entities.context_phrases || [])
    .flatMap((item) => String(item || "").toLowerCase().split(/\s+/))
    .filter(Boolean);
  const issuePriorityPattern =
    /\b(?:microphone|mic|freeze|freezes|freezing|crash|shutdown|shut down|game|app|firmware|update|serial|platform|device)\b/i;
  const issueCriticalPattern =
    /\b(?:freeze|freezes|freezing|crash|shutdown|shut down|game|app|microphone|mic)\b/i;
  const genericAudioSettingPenalty =
    /\b(?:sidetone|microphone level|sound control panel|volume slider|windows sound settings|sound settings)\b/i;
  const selectedFacts: Array<{ text: string; score: number }> = [];
  const addFact = (value: string, score: number) => {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length < 15 || normalized.length > 220) return;
    if (selectedFacts.some((fact) => fact.text === normalized)) return;
    selectedFacts.push({ text: normalized, score });
  };

  for (const hit of knowledgeHits) {
    if (
      !hit.included ||
      ![
        "troubleshooting",
        "product_manual",
        "support_process",
        "general_knowledge",
      ].includes(String(hit.source_class || "")) ||
      ![
        "manual_text",
        "shopify_file",
        "pdf_upload",
        "shopify_page",
        "csv_support_knowledge",
      ].includes(String(hit.source_provider || "").toLowerCase())
    ) {
      continue;
    }

    const candidates = String(hit.content || "")
      .split(/\n|(?<=[.!?])\s+/)
      .map((part) => part.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter(Boolean)
      .filter((part) =>
        /(microphone|mic|speaker|audio|sound|freeze|freez|shutdown|shut down|game|firmware|reset|pair|connection|driver|update|support|serial)/i
          .test(part)
      );

    for (const candidate of candidates) {
      const normalized = candidate.toLowerCase();
      let score = Number(hit.similarity ?? 0);
      if (productName && normalized.includes(productName)) score += 2.5;
      let symptomOverlap = 0;
      for (const term of symptomTerms) {
        if (term.length >= 3 && normalized.includes(term)) {
          score += 0.75;
          symptomOverlap += 1;
        }
      }
      let contextOverlap = 0;
      for (const term of contextTerms) {
        if (term.length >= 2 && normalized.includes(term)) {
          score += 0.8;
          contextOverlap += 1;
        }
      }
      if (issuePriorityPattern.test(candidate)) {
        score += 1.8;
      }
      if (issueCriticalPattern.test(candidate)) {
        score += 1.6;
      }
      if (symptomOverlap > 0 && contextOverlap > 0) {
        score += 1.4;
      }
      if (symptomOverlap === 0 && contextOverlap === 0) {
        score -= 0.8;
      }
      if (genericAudioSettingPenalty.test(candidate) && symptomOverlap === 0) {
        score -= 3.4;
      }
      addFact(candidate, score);
    }
  }

  return selectedFacts
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((fact) => fact.text);
};

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(digest);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const detectLanguage = (samples: string[]) => {
  const danishHints = ["hej", "tak", "venlig", "hilsen", "mvh", "ordre", "pakke"];
  const englishHints = ["hi", "hello", "thanks", "regards", "order", "shipping"];
  let da = 0;
  let en = 0;
  samples.forEach((text) => {
    const lower = text.toLowerCase();
    danishHints.forEach((word) => {
      if (lower.includes(word)) da += 1;
    });
    englishHints.forEach((word) => {
      if (lower.includes(word)) en += 1;
    });
  });
  if (da === 0 && en === 0) return null;
  return da >= en ? "Danish" : "English";
};

const extractGreeting = (text: string) => {
  const firstLine = splitLines(text)[0] || "";
  const lower = firstLine.toLowerCase();
  if (lower.startsWith("hej")) return "Hej";
  if (lower.startsWith("hi")) return "Hi";
  if (lower.startsWith("hello")) return "Hello";
  if (lower.startsWith("dear")) return "Dear";
  return null;
};

const extractSignoff = (text: string) => {
  const lines = splitLines(text);
  const last = lines[lines.length - 1]?.toLowerCase() || "";
  if (last.includes("mvh")) return "Mvh";
  if (last.includes("venlig hilsen")) return "Venlig hilsen";
  if (last.includes("best regards")) return "Best regards";
  if (last.includes("kind regards")) return "Kind regards";
  if (last.includes("regards")) return "Regards";
  if (last.includes("cheers")) return "Cheers";
  return null;
};


const extractPhrasesToAvoid = (text: string) => {
  const phrases = [
    "hope this email finds you well",
    "tak for din henvendelse",
    "vi beklager ulejligheden",
  ];
  const lower = text.toLowerCase();
  return phrases.filter((phrase) => lower.includes(phrase));
};

const mergeBullets = (base: string[], extra: string[], max = 8) => {
  const seen = new Set<string>();
  const output: string[] = [];
  [...base, ...extra].forEach((item) => {
    const cleaned = item.replace(/^[-•]\s*/, "").trim();
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    output.push(`- ${cleaned}`);
  });
  return output.slice(0, max);
};

const extractNameFromFromField = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutEmail = raw.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim();
  if (!withoutEmail || withoutEmail.includes("@")) return "";
  const cleaned = withoutEmail.replace(/\s+/g, " ").trim();
  const first = cleaned.split(" ").find(Boolean) || "";
  return first.replace(/[^A-Za-zÆØÅæøåÀ-ÿ'-]/g, "").trim();
};

const extractNameFromBody = (value: string) => {
  const lines = splitLines(String(value || ""));
  if (!lines.length) return "";
  const blockedTokens = new Set([
    "hej",
    "hi",
    "hello",
    "hey",
    "dear",
    "hola",
    "bonjour",
    "hallo",
    "goddag",
    "mvh",
    "venlig",
    "hilsen",
    "regards",
    "best",
    "kind",
    "team",
    "support",
    "service",
    "customer",
    "kundeservice",
    "teamet",
  ]);
  const cleanNameToken = (raw: string) =>
    String(raw || "").replace(/[^A-Za-zÆØÅæøåÀ-ÿ'-]/g, "").trim();
  const isValidNameToken = (token: string) => {
    if (token.length < 2) return false;
    if (!/[A-Za-zÆØÅæøåÀ-ÿ]/.test(token)) return false;
    if (blockedTokens.has(token.toLowerCase())) return false;
    return true;
  };

  const extractFirstCandidateToken = (raw: string) => {
    const firstToken = String(raw || "").split(/\s+/)[0] || "";
    const cleaned = cleanNameToken(firstToken);
    return isValidNameToken(cleaned) ? cleaned : "";
  };

  // Priority 0: structured form fields ("Name: Albert" / "Name:" + next line).
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = String(lines[idx] || "").trim();
    if (!line) continue;
    const inlineMatch = line.match(/^(name|full name|customer name)\s*[:\-]\s*(.+)$/i);
    if (inlineMatch) {
      const candidate = extractFirstCandidateToken(inlineMatch[2] || "");
      if (candidate) return candidate;
    }

    const labelOnlyMatch = line.match(/^(name|full name|customer name)\s*[:\-]?\s*$/i);
    if (labelOnlyMatch) {
      for (let lookahead = idx + 1; lookahead < Math.min(lines.length, idx + 4); lookahead += 1) {
        const nextLine = String(lines[lookahead] || "").trim();
        if (!nextLine) continue;
        if (/^(email|e-mail|mail|company|team|country|phone)\b/i.test(nextLine)) break;
        const candidate = extractFirstCandidateToken(nextLine);
        if (candidate) return candidate;
      }
    }
  }

  // Priority 1: greeting near top of customer message ("Hi Maria,", "Hej Jonas,")
  const greetingNameRegex =
    /^(hej|hi|hello|hey|dear|hola|bonjour|hallo)\s+([A-Za-zÆØÅæøåÀ-ÿ'-]{2,})(?=[\s,!.:;]|$)/i;
  const greetingWindow = Math.min(lines.length, 8);
  for (let idx = 0; idx < greetingWindow; idx += 1) {
    const line = lines[idx];
    if (!line || line.length > 64) continue;
    const match = line.match(greetingNameRegex);
    if (!match) continue;
    const candidate = cleanNameToken(match[2] || "");
    if (isValidNameToken(candidate)) return candidate;
  }

  // Priority 2: signoff + explicit name line at the very end.
  const signoffRegex = /^(mvh|venlig hilsen|med venlig hilsen|best regards|kind regards|regards|hilsen)$/i;
  for (let idx = lines.length - 1; idx >= 1; idx -= 1) {
    const current = String(lines[idx] || "");
    const previous = String(lines[idx - 1] || "").toLowerCase();
    if (!current || current.length > 40) continue;
    if (/^sent from my (iphone|ipad|android|mobile)/i.test(current)) continue;
    if (!signoffRegex.test(previous)) continue;
    if (current.includes("@")) continue;
    const candidate = extractFirstCandidateToken(current);
    if (candidate) return candidate;
  }

  // No reliable name found in message body.
  return "";
};

const normalizeCustomerFirstName = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const cleaned = raw.replace(/\d+/g, "").replace(/[^A-Za-zÆØÅæøåÀ-ÿ'-]/g, "").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
};

const extractCustomerFirstName = (emailData: EmailData) => {
  const fromName = extractNameFromFromField(emailData?.from || "");
  if (fromName) return normalizeCustomerFirstName(fromName);
  const bodyName = extractNameFromBody(emailData?.body || "");
  if (bodyName) return normalizeCustomerFirstName(bodyName);
  const localPart = String(emailData?.fromEmail || "")
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .trim();
  const localToken = localPart.split(" ")[0] || "";
  const localName = normalizeCustomerFirstName(localToken);
  return localName.length >= 2 ? localName : "";
};

const extractOrderFirstName = (order: any) => {
  if (!order || typeof order !== "object") return "";
  const candidates = [
    order?.customer?.first_name,
    typeof order?.shipping_address?.name === "string"
      ? String(order.shipping_address.name).split(/\s+/)[0]
      : "",
    typeof order?.billing_address?.name === "string"
      ? String(order.billing_address.name).split(/\s+/)[0]
      : "",
  ];
  for (const value of candidates) {
    const normalized = normalizeCustomerFirstName(String(value || ""));
    if (normalized) return normalized;
  }
  return "";
};

const inferLanguageHint = (subject: string, body: string): string => {
  const text = `${subject || ""}\n${body || ""}`.toLowerCase();
  const hasDanish = /(\b(hvor|hvornår|modtager|levering|pakke|ikke|med)\b|[æøå])/i.test(text);
  const hasEnglish = /(\b(hi|hello|where|when|order|delivery|tracking|received)\b)/i.test(text);
  const hasSpanish = /(\b(hola|dónde|donde|pedido|entrega|seguimiento|recibido)\b|[¡¿])/i.test(text);
  if (hasSpanish) return "es";
  if (hasEnglish && !hasDanish) return "en";
  if (hasDanish && !hasEnglish) return "da";
  if (hasEnglish) return "en";
  return "same_as_customer";
};

const ensureFirstLineHasName = (text: string, firstName: string): string => {
  const body = String(text || "").trim();
  const name = String(firstName || "").trim();
  if (!body || !name) return body;
  const lines = body.split("\n");
  const firstLineRaw = String(lines[0] || "").trim();
  const firstLine = firstLineRaw.toLowerCase();
  if (firstLine.includes(name.toLowerCase())) return body;

  // If first line is just a greeting (e.g. "Hi," / "Hej"), inject the name there.
  const greetingOnly = firstLineRaw.match(
    /^(hi|hello|hey|hej|hola|bonjour|hallo|ciao)[!,.\s]*$/i,
  );
  if (greetingOnly) {
    lines[0] = `${greetingOnly[1]} ${name},`;
    return lines.join("\n").trim();
  }

  // If first line starts with a greeting but has no name, normalize it.
  const greetingStart = firstLineRaw.match(
    /^(hi|hello|hey|hej|hola|bonjour|hallo|ciao)\b/i,
  );
  if (greetingStart && !firstLine.includes(name.toLowerCase())) {
    lines[0] = `${greetingStart[1]} ${name},`;
    return lines.join("\n").trim();
  }

  return `${name},\n\n${body}`;
};

const applyTrackingClosingByLanguage = (text: string, languageHint: string): string => {
  const body = String(text || "").trim();
  if (!body) return body;

  const hint = String(languageHint || "").toLowerCase();
  const target = hint === "da" ? "God dag." : hint === "en" ? "Have a great day!" : "";
  if (!target) return body;

  const lines = body.split("\n");
  let idx = lines.length - 1;
  while (idx >= 0 && !String(lines[idx] || "").trim()) idx -= 1;
  if (idx < 0) return body;

  const current = String(lines[idx] || "").trim();
  if (/^(god dag|have a great day|hav en god dag)[!.]?$/i.test(current)) {
    lines[idx] = target;
    return lines.join("\n").trim();
  }

  return `${body}\n\n${target}`.trim();
};

const resolveGreetingByLanguage = (languageHint: string, firstName: string) => {
  const normalized = String(languageHint || "").toLowerCase();
  const name = String(firstName || "").trim();
  if (normalized === "da") return name ? `Hej ${name},` : "Hej,";
  if (normalized === "es") return name ? `Hola ${name},` : "Hola,";
  if (normalized === "fr") return name ? `Bonjour ${name},` : "Bonjour,";
  if (normalized === "de") return name ? `Hallo ${name},` : "Hallo,";
  return name ? `Hi ${name},` : "Hi,";
};

const enforceLocalizedGreeting = (text: string, firstName: string, languageHint: string) => {
  const body = String(text || "").trim();
  if (!body) return body;
  const greeting = resolveGreetingByLanguage(languageHint, firstName);
  const withoutGreeting = body.replace(
    /^(hej|hi|hello|dear)\s*[^\n,]*,?\s*\n*/i,
    "",
  );
  return `${greeting}\n\n${withoutGreeting.trim()}`.trim();
};

const isSignoffLine = (value: string) => {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[.,:;!?]+$/g, "")
    .trim();
  if (!normalized) return false;
  return [
    "venlig hilsen",
    "med venlig hilsen",
    "mvh",
    "hilsen",
    "best regards",
    "kind regards",
    "regards",
    "sincerely",
  ].includes(normalized);
};

const stripTrailingSignoff = (text: string) => {
  const lines = String(text || "").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return "";

  // Remove signoff line only when it appears at the end of the draft.
  const tailWindowStart = Math.max(0, lines.length - 4);
  let signoffIndex = -1;
  for (let i = lines.length - 1; i >= tailWindowStart; i -= 1) {
    if (isSignoffLine(lines[i])) {
      signoffIndex = i;
      break;
    }
  }
  if (signoffIndex === -1) return lines.join("\n").trim();

  const cleaned = lines.slice(0, signoffIndex);
  while (cleaned.length && !cleaned[cleaned.length - 1].trim()) cleaned.pop();
  return cleaned.join("\n").trim();
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, inner]) => `${JSON.stringify(key)}:${stableStringify(inner)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

const buildThreadActionKey = ({
  type,
  orderId,
  payload,
}: {
  type: string;
  orderId?: number;
  payload?: Record<string, unknown>;
}) =>
  `${String(type || "").trim().toLowerCase()}::${String(orderId || "").trim()}::${stableStringify(
    payload || {},
  )}`;

const asTextOrNull = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
};

function buildReturnSettingsPromptBlock(
  settings: WorkspaceReturnSettings | null,
  eligibility: ReturnEligibilityResult | null,
) {
  if (!settings) return "";
  const lines = [
    "STRUCTURED RETURN SETTINGS:",
    `- Return window (days): ${settings.return_window_days}`,
    `- Return shipping mode: ${settings.return_shipping_mode}`,
    `- Return address: ${settings.return_address || "missing"}`,
    `- Require original packaging: ${settings.require_original_packaging ? "yes" : "no"}`,
    `- Require unused item: ${settings.require_unused ? "yes" : "no"}`,
    `- Exchange allowed: ${settings.exchange_allowed ? "yes" : "no"}`,
  ];
  if (eligibility) {
    lines.push(
      `- Eligibility: ${
        eligibility.eligible === true ? "eligible" : eligibility.eligible === false ? "not_eligible" : "manual_review"
      } (${eligibility.reason})`,
    );
  }
  return lines.join("\n");
}

function buildOutsideWindowReply(options: {
  languageHint: string;
  customerName: string;
  returnWindowDays: number;
}): string {
  const { languageHint, customerName, returnWindowDays } = options;
  if (String(languageHint || "").toLowerCase() === "da") {
    return [
      `Hej ${customerName || "der"},`,
      "",
      `Tak for din besked. Vi har gennemgået ordren, og returneringen ser ud til at ligge uden for vores returfrist på ${returnWindowDays} dage.`,
      "Hvis du ønsker, kan vores supportteam stadig lave en manuel vurdering af sagen.",
      "",
      "God dag.",
    ].join("\n");
  }
  return [
    `Hi ${customerName || "there"},`,
    "",
    `Thanks for your message. We reviewed the order, and this return appears to be outside our ${returnWindowDays}-day return window.`,
    "If needed, our support team can still perform a manual review.",
    "",
    "Have a great day.",
  ].join("\n");
}

async function persistThreadActions({
  ownerUserId,
  workspaceId,
  threadId,
  results,
}: {
  ownerUserId: string;
  workspaceId: string | null;
  threadId: string;
  results: Array<{
    type: string;
    ok: boolean;
    status?: "success" | "pending_approval" | "partial_failure" | "error";
    orderId?: number;
    payload?: Record<string, unknown>;
    detail?: string;
    error?: string;
  }>;
}) {
  if (!supabase || !ownerUserId || !threadId || !results.length) return;
  const nowIso = new Date().toISOString();

  for (const result of results) {
    const actionType = String(result?.type || "").trim().toLowerCase();
    if (!actionType) continue;
    const actionKey = buildThreadActionKey({
      type: actionType,
      orderId: result?.orderId,
      payload: result?.payload || {},
    });
    const nextStatus =
      result?.status === "pending_approval"
        ? "pending"
        : result?.status === "success"
        ? "applied"
        : "failed";

    let existingQuery = supabase
      .from("thread_actions")
      .select("id, status")
      .eq("thread_id", threadId)
      .eq("action_key", actionKey);
    existingQuery = workspaceId
      ? existingQuery.eq("workspace_id", workspaceId)
      : existingQuery.eq("user_id", ownerUserId);
    const { data: existing, error: existingError } = await existingQuery
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) {
      console.warn("generate-draft-unified: thread_actions lookup failed", existingError.message);
      continue;
    }

    const existingStatus = String(existing?.status || "").toLowerCase();
    const isFinalized =
      existingStatus === "applied" ||
      existingStatus === "approved" ||
      existingStatus === "declined";
    if (nextStatus === "pending" && isFinalized) {
      continue;
    }

    const rowPayload = {
      action_type: actionType,
      action_key: actionKey,
      status: nextStatus,
      detail: result?.detail || result?.error || null,
      payload: result?.payload || {},
      order_id: result?.orderId ? String(result.orderId) : null,
      error: result?.ok ? null : result?.error || null,
      updated_at: nowIso,
      ...(nextStatus === "applied"
        ? { decided_at: nowIso, applied_at: nowIso, declined_at: null }
        : nextStatus === "declined"
        ? { decided_at: nowIso, declined_at: nowIso, applied_at: null }
        : {}),
    };

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("thread_actions")
        .update(rowPayload)
        .eq("id", existing.id);
      if (updateError) {
        console.warn("generate-draft-unified: thread_actions update failed", updateError.message);
      }
      continue;
    }

    const { error: insertError } = await supabase.from("thread_actions").insert({
      user_id: ownerUserId,
      workspace_id: workspaceId,
      thread_id: threadId,
      source: "automation",
      created_at: nowIso,
      ...rowPayload,
    });
    if (insertError) {
      console.warn("generate-draft-unified: thread_actions insert failed", insertError.message);
    }
  }
}

async function upsertRejectedReturnCase(options: {
  workspaceId: string | null;
  threadId: string | null;
  selectedOrder: any;
  customerEmail: string | null;
  reason: string;
  eligibilityReason: string;
  returnShippingMode: string;
}) {
  const { workspaceId, threadId, selectedOrder, customerEmail, reason, eligibilityReason, returnShippingMode } = options;
  if (!supabase || !workspaceId || !threadId) return;
  const nowIso = new Date().toISOString();
  const orderIdText = asTextOrNull(selectedOrder?.id ? String(selectedOrder.id) : selectedOrder?.order_number);
  let query = supabase
    .from("return_cases")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("thread_id", threadId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const { data: existing } = await query.maybeSingle();
  const payload = {
    workspace_id: workspaceId,
    thread_id: threadId,
    shopify_order_id: orderIdText,
    customer_email: customerEmail,
    reason,
    status: "rejected",
    return_shipping_mode: returnShippingMode || "customer_paid",
    is_eligible: false,
    eligibility_reason: eligibilityReason || "outside_return_window",
    updated_at: nowIso,
  };
  if (existing?.id) {
    await supabase.from("return_cases").update(payload).eq("id", existing.id);
    return;
  }
  await supabase.from("return_cases").insert({
    ...payload,
    created_at: nowIso,
  });
}

async function fetchLearningProfile(
  mailboxId: string | null,
  userId: string | null,
): Promise<{ enabled: boolean; styleRules: string[] }> {
  if (!supabase || !mailboxId || !userId) return { enabled: false, styleRules: [] };
  const { data, error } = await supabase
    .from("mail_learning_profiles")
    .select("enabled, style_rules")
    .eq("mailbox_id", mailboxId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("generate-draft-unified: learning profile fetch failed", error.message);
    return { enabled: false, styleRules: [] };
  }
  const styleRules = String(data?.style_rules || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { enabled: data?.enabled !== false, styleRules };
}

async function fetchMailboxHistory(mailboxId: string | null, userId: string | null) {
  if (!supabase || !mailboxId || !userId) return [];
  const { data, error } = await supabase
    .from("mail_messages")
    .select("body_text, body_html, from_me, sent_at, received_at, created_at")
    .eq("mailbox_id", mailboxId)
    .eq("user_id", userId)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.warn("generate-draft-unified: mailbox history fetch failed", error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

async function fetchSelectedTrackingCarriers(
  workspaceId: string | null,
  userId: string | null,
): Promise<string[]> {
  if (!supabase || (!workspaceId && !userId)) return [];
  let query = supabase
    .from("integrations")
    .select("config")
    .eq("provider", TRACKING_CARRIERS_PROVIDER)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1);
  query = workspaceId ? query.eq("workspace_id", workspaceId) : query.eq("user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.warn("generate-draft-unified: tracking carrier settings fetch failed", error.message);
    return [];
  }
  const carriers = Array.isArray((data as any)?.config?.selected_carriers)
    ? (data as any).config.selected_carriers
    : [];
  return carriers
    .map((carrier: unknown) => String(carrier || "").trim().toLowerCase())
    .filter(Boolean);
}

function buildStyleHeuristics(history: Array<any>): string[] {
  if (!history.length) return [];
  const sent = history.filter((msg) => msg?.from_me && msg?.sent_at);
  const samples = (sent.length ? sent : history)
    .map((msg) => msg?.body_text || stripHtmlSimple(msg?.body_html || ""))
    .map(maskPii)
    .filter(Boolean);
  if (!samples.length) return [];

  const avgWords =
    samples.reduce((sum, text) => sum + wordCount(text), 0) / samples.length;

  const greetings = samples.map(extractGreeting).filter(Boolean) as string[];
  const signoffs = samples.map(extractSignoff).filter(Boolean) as string[];
  const avoidPhrases = samples.flatMap(extractPhrasesToAvoid);

  const topGreeting = greetings.sort(
    (a, b) => greetings.filter((g) => g === b).length - greetings.filter((g) => g === a).length
  )[0];
  const topSignoff = signoffs.sort(
    (a, b) => signoffs.filter((g) => g === b).length - signoffs.filter((g) => g === a).length
  )[0];

  const language = detectLanguage(samples);

  const bullets: string[] = [];
  if (Number.isFinite(avgWords)) {
    const rounded = Math.round(avgWords / 5) * 5;
    bullets.push(`Keep replies around ${rounded} words on average.`);
  }
  if (topGreeting) bullets.push(`Typical greeting: "${topGreeting}".`);
  if (topSignoff) bullets.push(`Typical sign-off: "${topSignoff}".`);
  if (language) bullets.push(`Preferred language: ${language}.`);
  if (avoidPhrases.length) bullets.push("Avoid filler phrases (e.g., “hope this email finds you well”).");

  return bullets;
}

// Find shop scope så vi kan læse workspace-shared konfiguration.
async function resolveShopScope(shopId: string): Promise<ShopScope> {
  const fallback: ShopScope = { ownerUserId: null, workspaceId: null };
  if (!supabase) return fallback;
  const { data, error } = await supabase
    .from("shops")
    .select("owner_user_id, workspace_id")
    .eq("id", shopId)
    .maybeSingle();
  if (error) {
    console.warn("generate-draft-unified: failed to resolve shop scope", error.message);
    return fallback;
  }
  return {
    ownerUserId: data?.owner_user_id ?? null,
    workspaceId: data?.workspace_id ?? null,
  };
}

// Laver embedding af mailtekst for at slå relevante produkter op via vector search.
async function embedText(input: string): Promise<number[]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message || `OpenAI embedding error ${res.status}`);
  }
  const vector = json?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("OpenAI embedding missing");
  return vector;
}

// Hent produktkontekst så svaret kan blive mere præcist.
async function fetchProductContext(
  supabaseClient: ReturnType<typeof createClient> | null,
  shopId: string | null,
  text: string,
) {
  if (!supabaseClient || !shopId || !text?.trim()) return { hits: [] as ProductMatch[] };
  try {
    const embedding = await embedText(text.slice(0, 4000));
    const { data, error } = await supabaseClient.rpc("match_products", {
      query_embedding: embedding,
      match_threshold: PRODUCT_MIN_SIMILARITY,
      match_count: Math.max(1, Math.min(Math.round(MAX_RETRIEVAL_CHUNKS), 10)),
      filter_shop_id: shopId,
    });
    if (error || !Array.isArray(data) || !data.length) return { hits: [] as ProductMatch[] };
    return { hits: data as ProductMatch[] };
  } catch (err) {
    console.warn("generate-draft-unified: product context failed", err);
    return { hits: [] as ProductMatch[] };
  }
}

// Saml persona, automation flags, policies og ordre-kontekst for shoppen.
async function getAgentContext(
  shopId: string,
  email?: string,
  subject?: string,
  emailBody?: string,
): Promise<AgentContext> {
  const scope = await resolveShopScope(shopId);
  console.info(
    JSON.stringify({
      event: "knowledge.retrieve.start",
      shop_id: shopId,
      workspace_id: scope.workspaceId ?? null,
      message_id: null,
    }),
  );
  const ownerUserId = scope.ownerUserId;
  const profile = await fetchOwnerProfile(supabase, ownerUserId);
  const persona = await fetchPersona(supabase, ownerUserId);
  const automation = await fetchAutomation(supabase, ownerUserId, scope.workspaceId);
  const policies = await fetchPolicies(supabase, ownerUserId, scope.workspaceId);
  const relevantKnowledgeMatches = await fetchRelevantKnowledge(
    supabase,
    shopId,
    emailBody ?? "",
    Math.max(1, Math.min(Math.round(MAX_RETRIEVAL_CHUNKS), 10)),
    KNOWLEDGE_MIN_SIMILARITY,
  );
  console.info(
    JSON.stringify({
      event: "knowledge.retrieve.result",
      shop_id: shopId,
      workspace_id: scope.workspaceId ?? null,
      knowledge_hits_count: Array.isArray(relevantKnowledgeMatches)
        ? relevantKnowledgeMatches.length
        : 0,
    }),
  );
  const filteredKnowledgeMatches = (relevantKnowledgeMatches || []).filter(
    (match) => String(match?.source_provider || "").toLowerCase() !== POLICY_SOURCE_PROVIDER,
  );
  const { orders, matchedSubjectNumber } = await resolveOrderContext({
    supabase,
    userId: ownerUserId,
    workspaceId: scope.workspaceId,
    email,
    subject: [subject, emailBody].filter(Boolean).join("\n"),
    tokenSecret: ENCRYPTION_KEY,
    apiVersion: SHOPIFY_API_VERSION,
  });
  const orderSummary = buildOrderSummary(orders);

  return {
    workspaceId: scope.workspaceId,
    ownerUserId,
    profile,
    persona,
    automation,
    policies,
    relevantKnowledgeMatches: filteredKnowledgeMatches,
    orderSummary,
    matchedSubjectNumber,
    orders,
  };
}

// Brug JSON schema så vi altid får reply + automation actions.
async function callOpenAI(prompt: string, system?: string): Promise<OpenAIResult> {
  if (!OPENAI_API_KEY) return { reply: null, actions: [] };
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.3,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: PERSONA_REPLY_JSON_SCHEMA,
    },
    max_tokens: 800,
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    return { reply: null, actions: [] };
  }
  try {
    const parsed = JSON.parse(content);
    const reply = typeof parsed?.reply === "string" ? parsed.reply : null;
    const actions = Array.isArray(parsed?.actions)
      ? parsed.actions.filter((action: any) => typeof action?.type === "string")
      : [];
    return { reply, actions };
  } catch (_err) {
    return { reply: null, actions: [] };
  }
}

function parseInlineStoragePath(value: string | null | undefined): {
  mimeType: string;
  contentBase64: string;
} | null {
  const raw = String(value || "");
  if (!raw.startsWith("inline:")) return null;
  const payload = raw.slice("inline:".length);
  const commaIndex = payload.indexOf(",");
  if (commaIndex <= 0) return null;
  const metadata = payload.slice(0, commaIndex);
  const contentBase64 = payload.slice(commaIndex + 1).replace(/\s+/g, "");
  const [mimeType] = metadata.split(";");
  if (!contentBase64) return null;
  return {
    mimeType: String(mimeType || "application/octet-stream").trim() || "application/octet-stream",
    contentBase64,
  };
}

async function loadInlineImageAttachments(options: {
  userId: string | null;
  workspaceId: string | null;
  provider: string;
  providerMessageId: string | null;
}): Promise<InlineImageAttachment[]> {
  if (!supabase || !options.providerMessageId) return [];
  let messageQuery = supabase
    .from("mail_messages")
    .select("id, user_id")
    .eq("provider", options.provider)
    .eq("provider_message_id", options.providerMessageId);
  messageQuery = options.workspaceId
    ? messageQuery.eq("workspace_id", options.workspaceId)
    : messageQuery.eq("user_id", options.userId);
  const { data: messageRow } = await messageQuery.maybeSingle();
  const messageId = String(messageRow?.id || "").trim();
  const messageUserId = String(messageRow?.user_id || "").trim();
  if (!messageId || !messageUserId) return [];

  const { data: rows, error } = await supabase
    .from("mail_attachments")
    .select("filename, mime_type, size_bytes, storage_path")
    .eq("message_id", messageId)
    .eq("user_id", messageUserId)
    .order("created_at", { ascending: true })
    .limit(8);
  if (error || !Array.isArray(rows) || !rows.length) return [];

  const accepted: InlineImageAttachment[] = [];
  let totalBytes = 0;
  const MAX_IMAGES = 3;
  const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
  for (const row of rows) {
    if (accepted.length >= MAX_IMAGES) break;
    const mimeType = String(row?.mime_type || "").toLowerCase();
    if (!mimeType.startsWith("image/")) continue;
    const parsed = parseInlineStoragePath(row?.storage_path);
    if (!parsed) continue;
    const bytes = Math.floor((parsed.contentBase64.length * 3) / 4);
    if (bytes <= 0) continue;
    if (totalBytes + bytes > MAX_TOTAL_BYTES) break;
    totalBytes += bytes;
    accepted.push({
      filename: String(row?.filename || "image").trim() || "image",
      mimeType: parsed.mimeType,
      sizeBytes: Number.isFinite(Number(row?.size_bytes)) ? Number(row?.size_bytes) : bytes,
      dataUrl: `data:${parsed.mimeType};base64,${parsed.contentBase64}`,
    });
  }
  return accepted;
}

async function callOpenAIWithImages(
  prompt: string,
  system: string | undefined,
  images: InlineImageAttachment[],
): Promise<OpenAIResult> {
  if (!OPENAI_API_KEY) return { reply: null, actions: [] };
  if (!Array.isArray(images) || !images.length) return callOpenAI(prompt, system);
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  const content: any[] = [{ type: "text", text: prompt }];
  images.forEach((image) => {
    content.push({
      type: "image_url",
      image_url: {
        url: image.dataUrl,
        detail: "auto",
      },
    });
  });
  messages.push({ role: "user", content });
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.3,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: PERSONA_REPLY_JSON_SCHEMA,
    },
    max_tokens: 900,
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
  const responseContent = json?.choices?.[0]?.message?.content;
  if (!responseContent || typeof responseContent !== "string") {
    return { reply: null, actions: [] };
  }
  try {
    const parsed = JSON.parse(responseContent);
    const reply = typeof parsed?.reply === "string" ? parsed.reply : null;
    const actions = Array.isArray(parsed?.actions)
      ? parsed.actions.filter((action: any) => typeof action?.type === "string")
      : [];
    return { reply, actions };
  } catch {
    return { reply: null, actions: [] };
  }
}

async function generateBlockedOrderActionReply(options: {
  customerName: string;
  emailBody: string;
  reasons: string[];
  personaInstructions?: string | null;
}): Promise<string | null> {
  const uniqueReasons = Array.from(
    new Set(
      (options.reasons || [])
        .map((reason) => String(reason || "").trim())
        .filter(Boolean),
    ),
  );
  if (!uniqueReasons.length) return null;
  const reasonsLower = uniqueReasons.join(" ").toLowerCase();
  const lang = inferLanguageHint("", options.emailBody || "");
  const isDanish = lang === "da" || lang === "same_as_customer";
  const customer = String(options.customerName || "").trim() || (isDanish ? "kunden" : "there");

  // Hard guard: if order is cancelled, never phrase as shipped/fulfilled and never mention tracking.
  if (reasonsLower.includes("cancelled") || reasonsLower.includes("canceled")) {
    if (isDanish) {
      return [
        `Hej ${customer},`,
        "",
        "Ordren er allerede annulleret, så vi kan desværre ikke ændre leveringsadressen.",
        "",
        "Hvis du stadig ønsker varen, kan du lægge en ny ordre.",
        "",
        "God dag.",
      ].join("\n");
    }
    return [
      `Hi ${customer},`,
      "",
      "The order is already canceled, so we unfortunately cannot update the shipping address.",
      "",
      "If you still want the item, please place a new order.",
      "",
      "Have a great day.",
    ].join("\n");
  }

  const systemMsg = [
    "Du er en kundeservice-assistent.",
    "Skriv et kort, professionelt svar på samme sprog som kundens mail.",
    `Start altid svaret med "Hej ${options.customerName || "kunden"},".`,
    "Forklar tydeligt at ønsket ikke kan udføres, baseret på den konkrete blokeringsårsag.",
    "Nævn aldrig trackingnummer, trackinglink eller forsendelsesstatus medmindre det fremgår eksplicit af årsagen.",
    "Tilbyd et realistisk næste skridt uden at love noget du ikke kan gennemføre.",
    "Returner JSON med felterne reply og actions.",
    "actions SKAL være en tom liste.",
    "Afslut ikke med signatur.",
    `Persona-noter: ${options.personaInstructions?.trim() || "Hold tonen venlig og effektiv."}`,
  ].join("\n");

  const prompt = [
    "KUNDENS BESKED:",
    options.emailBody?.trim() || "(tom)",
    "",
    "BLOKERINGSÅRSAG(ER):",
    uniqueReasons.map((reason) => `- ${reason}`).join("\n"),
    "",
    "Skriv nu et præcist svar til kunden.",
  ].join("\n");

  const ai = await callOpenAI(prompt, systemMsg);
  return typeof ai.reply === "string" ? ai.reply.trim() : null;
}

async function enforceReplyLanguage(
  customerMessage: string,
  reply: string,
  languageHint?: string,
): Promise<string> {
  const source = String(customerMessage || "").trim();
  const draft = String(reply || "").trim();
  if (!source || !draft) return draft;
  const system = [
    "You rewrite customer support drafts.",
    "Keep the meaning exactly the same.",
    "Rewrite the draft in the exact same language as the customer message.",
    "Output must be entirely in one language and must not mix languages.",
    languageHint ? `Preferred output language hint: ${languageHint}.` : "",
    "Do not add signature or extra sections.",
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = [
    "Customer message:",
    source,
    "",
    "Draft to rewrite:",
    draft,
  ].join("\n");
  const ai = await callOpenAI(prompt, system);
  return ai.reply?.trim() || draft;
}

function enforceReturnChannelGuard(options: {
  text: string;
  languageHint: string;
  missingDetails: Array<"order_number" | "customer_name" | "return_reason">;
  hasKnownOrderContext?: boolean;
  ongoingReturnContinuation?: boolean;
}): string {
  let next = String(options.text || "");
  const lines = next.split("\n");
  const filtered = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (
      /send us (an )?e-?mail/.test(lower) ||
      /email us/.test(lower) ||
      /contact us via e-?mail/.test(lower) ||
      /contact us by e-?mail/.test(lower) ||
      /contact us at\s+\S+@\S+/.test(lower) ||
      /send os en e-?mail/.test(lower) ||
      /skriv .* e-?mail/.test(lower) ||
      /kontakt os på\s+\S+@\S+/.test(lower) ||
      /skriv til\s+\S+@\S+/.test(lower)
    ) {
      return false;
    }
    return true;
  });

  next = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  next = next
    .split("\n")
    .filter((line) => {
      const lower = line.toLowerCase();
      if (/follow these steps/.test(lower)) return false;
      if (/følg disse trin/.test(lower)) return false;
      if (/^\s*\d+\.\s+/.test(line)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const effectiveMissingDetails = options.missingDetails.filter((key) => {
    if (!options.hasKnownOrderContext) return true;
    if (key === "return_reason" && options.ongoingReturnContinuation) return false;
    return key !== "order_number" && key !== "customer_name";
  });

  if (!effectiveMissingDetails.length) return next;

  const missingLabelMap: Record<string, string> =
    String(options.languageHint || "").toLowerCase() === "da"
      ? {
          order_number: "ordrenummer",
          customer_name: "navn brugt ved køb",
          return_reason: "årsag til returnering",
        }
      : {
          order_number: "order number",
          customer_name: "name used at purchase",
          return_reason: "return reason",
        };
  const missingList = effectiveMissingDetails.map((key) => missingLabelMap[key] || key);
  const askLine =
    String(options.languageHint || "").toLowerCase() === "da"
      ? `Svar venligst her i tråden med: ${missingList.join(", ")}.`
      : `Please reply in this thread with: ${missingList.join(", ")}.`;
  if (!next.toLowerCase().includes(askLine.toLowerCase())) {
    next = `${next}\n\n${askLine}`.trim();
  }
  return next;
}

function toLineItemGid(value: unknown): string {
  if (typeof value === "string" && value.startsWith("gid://shopify/LineItem/")) return value;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "";
  return `gid://shopify/LineItem/${Math.trunc(num)}`;
}

function toVariantGid(value: unknown): string {
  if (typeof value === "string" && value.startsWith("gid://shopify/ProductVariant/")) return value;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "";
  return `gid://shopify/ProductVariant/${Math.trunc(num)}`;
}

function inferExchangeReason(subject: string, body: string): string {
  const text = `${subject || ""}\n${body || ""}`.toLowerCase();
  if (/\b(defekt|ødelagt|skadet|broken|defective|damaged|faulty)\b/.test(text)) {
    return "DEFECTIVE";
  }
  if (
    /\b(mangler|missing|kun en|only one|forkert vare|wrong item|not as described|ikke som beskrevet)\b/.test(
      text,
    )
  ) {
    return "WRONG_ITEM";
  }
  return "UNKNOWN";
}

function hasExchangeSignals(subject: string, body: string): boolean {
  const text = `${subject || ""}\n${body || ""}`.toLowerCase();
  return (
    /\b(ombyt|exchange|replacement|replace|erstatning)\b/.test(text) ||
    /\b(mangler|missing|kun en|only one|forkert vare|wrong item)\b/.test(text)
  );
}

function isInternalAnnotationAction(type: string): boolean {
  const normalized = String(type || "").trim().toLowerCase();
  return (
    normalized === "add_note" ||
    normalized === "add_tag" ||
    normalized === "add_internal_note_or_tag"
  );
}

function normalizeAutomationActionsForOrderContext(
  actions: AutomationAction[],
  selectedOrder: any,
): { actions: AutomationAction[]; removed: Array<{ type: string; reason: string }> } {
  const selectedOrderId = Number(selectedOrder?.id ?? 0);
  const hasSelectedOrderId = Number.isFinite(selectedOrderId) && selectedOrderId > 0;
  const kept: AutomationAction[] = [];
  const removed: Array<{ type: string; reason: string }> = [];

  for (const action of actions || []) {
    const type = String(action?.type || "").trim().toLowerCase();
    if (!type) continue;

    const payloadOrderId = Number(action?.payload?.order_id ?? action?.payload?.orderId ?? 0);
    const actionOrderId = Number(action?.orderId ?? 0);
    const resolvedOrderId =
      Number.isFinite(actionOrderId) && actionOrderId > 0
        ? actionOrderId
        : Number.isFinite(payloadOrderId) && payloadOrderId > 0
        ? payloadOrderId
        : hasSelectedOrderId
        ? selectedOrderId
        : 0;

    if (!Number.isFinite(resolvedOrderId) || resolvedOrderId <= 0) {
      removed.push({ type, reason: "missing_order_context" });
      continue;
    }

    kept.push({
      ...action,
      orderId: resolvedOrderId,
    });
  }

  return { actions: kept, removed };
}

function maybeBuildExchangeFallbackAction(options: {
  selectedOrder: any;
  orderSummary: string;
  subject: string;
  body: string;
  existingActions: AutomationAction[];
}): AutomationAction | null {
  if (!options.selectedOrder) return null;
  const text = `${options.subject || ""}\n${options.body || ""}`.toLowerCase();
  const hasExchangeSignal = hasExchangeSignals(options.subject, options.body);
  const refundOnlySignal =
    /\b(refund|tilbagebetaling|pengene tilbage)\b/.test(text) &&
    !/\b(ombyt|exchange|replacement|replace|erstatning)\b/.test(text);
  if (!hasExchangeSignal || refundOnlySignal) return null;
  const existingTypes = new Set(
    (options.existingActions || []).map((item) => String(item?.type || "").trim().toLowerCase()),
  );
  if (existingTypes.has("create_exchange_request")) return null;
  const hasBlockingMutation = Array.from(existingTypes).some(
    (type) =>
      ![
        "lookup_order_status",
        "fetch_tracking",
        "add_note",
        "add_tag",
        "add_internal_note_or_tag",
      ].includes(type),
  );
  if (hasBlockingMutation) return null;

  const lineItems = Array.isArray(options.selectedOrder?.line_items)
    ? options.selectedOrder.line_items
    : [];
  const chosen = lineItems.find((item: any) => {
    const lineItemId = toLineItemGid(item?.admin_graphql_api_id || item?.id);
    const variantId = toVariantGid(item?.variant_admin_graphql_api_id || item?.variant_id);
    return Boolean(lineItemId && variantId);
  }) || null;
  if (!chosen) return null;

  const orderId = Number(options.selectedOrder?.id);
  if (!Number.isFinite(orderId) || orderId <= 0) return null;
  let lineItemId = toLineItemGid(chosen?.admin_graphql_api_id || chosen?.id);
  let variantId = toVariantGid(chosen?.variant_admin_graphql_api_id || chosen?.variant_id);
  if (!lineItemId || !variantId) {
    const summary = String(options.orderSummary || "");
    const lineMatch = summary.match(/line_item_id=(gid:\/\/shopify\/LineItem\/\d+)/i);
    const variantMatch = summary.match(/variant_id=(gid:\/\/shopify\/ProductVariant\/\d+)/i);
    lineItemId = lineItemId || (lineMatch?.[1] ? String(lineMatch[1]).trim() : "");
    variantId = variantId || (variantMatch?.[1] ? String(variantMatch[1]).trim() : "");
  }
  if (!lineItemId || !variantId) return null;

  return {
    type: "create_exchange_request",
    orderId: Math.trunc(orderId),
    payload: {
      return_line_item_id: lineItemId,
      exchange_variant_id: variantId,
      return_quantity: 1,
      exchange_quantity: 1,
      return_reason: inferExchangeReason(options.subject, options.body),
    },
  };
}

function stripSupportEscalationLines(text: string): string {
  const lines = String(text || "").split("\n");
  const filtered = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (
      /support@\S+/.test(lower) ||
      /kontakt os på\s+\S+@\S+/.test(lower) ||
      /contact us at\s+\S+@\S+/.test(lower) ||
      /send us (an )?e-?mail/.test(lower) ||
      /email us/.test(lower)
    ) {
      return false;
    }
    return true;
  });
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function resolveInternalThread(
  userId: string | null,
  workspaceId: string | null,
  provider: string,
  emailData: EmailData,
) {
  if (!supabase || (!userId && !workspaceId)) {
    return { threadId: null, mailboxId: null, tags: [] as string[] };
  }
  if (provider === "smtp" && emailData.threadId) {
    let query = supabase
      .from("mail_threads")
      .select("id, mailbox_id, tags")
      .eq("id", emailData.threadId);
    query = workspaceId ? query.eq("workspace_id", workspaceId) : query.eq("user_id", userId);
    const { data } = await query.maybeSingle();
    if (data?.id) {
      return { threadId: data.id, mailboxId: data.mailbox_id ?? null, tags: data.tags ?? [] };
    }
  }
  if (emailData.threadId) {
    let query = supabase
      .from("mail_threads")
      .select("id, mailbox_id, tags")
      .eq("provider", provider)
      .eq("provider_thread_id", emailData.threadId);
    query = workspaceId ? query.eq("workspace_id", workspaceId) : query.eq("user_id", userId);
    const { data } = await query.maybeSingle();
    if (data?.id) {
      return { threadId: data.id, mailboxId: data.mailbox_id ?? null, tags: data.tags ?? [] };
    }
  }
  if (emailData.messageId) {
    let query = supabase
      .from("mail_messages")
      .select("thread_id, mailbox_id")
      .eq("provider", provider)
      .eq("provider_message_id", emailData.messageId);
    query = workspaceId ? query.eq("workspace_id", workspaceId) : query.eq("user_id", userId);
    const { data } = await query.maybeSingle();
    if (data?.thread_id) {
      let threadQuery = supabase
        .from("mail_threads")
        .select("id, mailbox_id, tags")
        .eq("id", data.thread_id);
      threadQuery = workspaceId
        ? threadQuery.eq("workspace_id", workspaceId)
        : threadQuery.eq("user_id", userId);
      const { data: threadData } = await threadQuery.maybeSingle();
      if (threadData?.id) {
        return {
          threadId: threadData.id,
          mailboxId: threadData.mailbox_id ?? data.mailbox_id ?? null,
          tags: threadData.tags ?? [],
        };
      }
      return { threadId: data.thread_id, mailboxId: data.mailbox_id ?? null, tags: [] as string[] };
    }
  }
  return { threadId: null, mailboxId: null, tags: [] as string[] };
}

async function createInternalDraft(options: {
  userId: string | null;
  workspaceId: string | null;
  mailboxId: string | null;
  threadId: string | null;
  provider: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}) {
  if (
    !supabase ||
    (!options.userId && !options.workspaceId) ||
    !options.threadId ||
    !options.provider
  ) {
    return null;
  }

  // Keep a single active draft per thread, so newer customer emails replace stale drafts.
  let cleanupQuery = supabase
    .from("mail_messages")
    .delete()
    .eq("thread_id", options.threadId)
    .eq("is_draft", true)
    .eq("from_me", true);
  cleanupQuery = options.workspaceId
    ? cleanupQuery.eq("workspace_id", options.workspaceId)
    : cleanupQuery.eq("user_id", options.userId);
  const { error: cleanupError } = await cleanupQuery;
  if (cleanupError) {
    throw new Error(`Internal draft cleanup failed: ${cleanupError.message}`);
  }

  const payload: Record<string, unknown> = {
    user_id: options.userId,
    workspace_id: options.workspaceId,
    mailbox_id: options.mailboxId,
    thread_id: options.threadId,
    provider: options.provider,
    provider_message_id: `draft-${options.threadId}-${Date.now()}`,
    subject: options.subject,
    snippet: options.textBody.slice(0, 160),
    body_text: options.textBody,
    body_html: options.htmlBody,
    clean_body_text: options.textBody,
    clean_body_html: options.htmlBody,
    quoted_body_text: null,
    quoted_body_html: null,
    is_draft: true,
    from_me: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("mail_messages")
    .insert(payload)
    .select()
    .maybeSingle();
  if (error) {
    throw new Error(`Internal draft insert failed: ${error.message}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const body = await req.json().catch(() => ({}));
    const shopId = typeof body?.shop_id === "string" ? body.shop_id.trim() : "";
    const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
    const forceProcess = body?.force_process === true;
    const emailData: EmailData = body?.email_data ?? {};

    if (!shopId || !provider) {
      return new Response(JSON.stringify({ error: "shop_id og provider er påkrævet." }), {
        status: 400,
      });
    }

    const reasoningLogs: Array<{
      step_name: string;
      step_detail: string;
      status: string;
    }> = [];

    let classification: Awaited<ReturnType<typeof classifyEmail>> | null = null;
    if (CLASSIFY_FIRST) {
      classification = await classifyEmail({
        from: emailData.from ?? "",
        subject: emailData.subject ?? "",
        body: emailData.body ?? "",
        headers: emailData.headers ?? [],
      });
      if (!forceProcess && !classification.process) {
        emitDebugLog("generate-draft-unified: gatekeeper skip", {
          reason: classification.reason,
          category: classification.category,
        });
        return new Response(
          JSON.stringify({
            success: true,
            skipped: true,
            reason: classification.reason,
            category: classification.category ?? null,
            explanation: classification.explanation ?? null,
          }),
          { status: 200 },
        );
      }
    }

    const context = await getAgentContext(
      shopId,
      emailData.fromEmail,
      emailData.subject,
      emailData.body,
    );
    const explicitOrderNumber = String(context?.matchedSubjectNumber || "").replace(/\D/g, "");
    const selectedOrder =
      context?.orders?.length
        ? explicitOrderNumber
          ? context.orders.find((item) => {
              const orderNum = String(item?.order_number ?? "").replace(/\D/g, "");
              if (orderNum && orderNum === explicitOrderNumber) return true;
              const orderName = String(item?.name || "").trim();
              return new RegExp(`#\\s*${explicitOrderNumber}(?:\\b|\\D)`, "i").test(orderName);
            }) || null
          : context.orders[0]
        : null;
    if (selectedOrder) {
      const orderLabel =
        selectedOrder?.name ??
        selectedOrder?.order_number ??
        selectedOrder?.id ??
        context.matchedSubjectNumber ??
        "";
      reasoningLogs.push({
        step_name: "Shopify Lookup",
        step_detail: `Found Order ${orderLabel}`.trim(),
        status: "success",
      });
    } else {
      reasoningLogs.push({
        step_name: "Shopify Lookup",
        step_detail: "No order found",
        status: "warning",
      });
    }
    // Gatekeeper: spring over hvis mailen ikke skal behandles.
    if (!classification) {
      classification = await classifyEmail({
        from: emailData.from ?? "",
        subject: emailData.subject ?? "",
        body: emailData.body ?? "",
        headers: emailData.headers ?? [],
      });
    }
    if (!forceProcess && !classification.process) {
      emitDebugLog("generate-draft-unified: gatekeeper skip", {
        reason: classification.reason,
        category: classification.category,
      });
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: classification.reason,
          category: classification.category ?? null,
          explanation: classification.explanation ?? null,
        }),
        { status: 200 },
      );
    }

    const ownerUserId = context.ownerUserId;
    const workspaceId = context.workspaceId;
    const traceEnabledForRequest =
      RETRIEVAL_TRACE_ENABLED &&
      CLASSIFY_FIRST &&
      classification.process &&
      shouldSample(RETRIEVAL_TRACE_SAMPLE_RATE);
    const internalThread = await resolveInternalThread(
      ownerUserId,
      workspaceId,
      provider,
      emailData,
    );
    const selectedTrackingCarriers = await fetchSelectedTrackingCarriers(workspaceId, ownerUserId);
    const legacyTicketCategory = extractThreadCategoryFromTags(internalThread.tags);
    let ticketCategory = legacyTicketCategory;
    let workflowRoute = buildWorkflowRoute(ticketCategory);
    let caseAssessment: CaseAssessment | null = null;
    let factContext: FactContext | null = null;
    let actionValidation: ActionDecisionValidation | null = null;
    let replyStrategyArtifact: ReplyStrategy | null = null;
    reasoningLogs.push({
      step_name: "workflow_routing",
      step_detail: `Routed by ticket category: ${workflowRoute.category} -> ${workflowRoute.workflow}`,
      status: "success",
    });
    const providerMessageId =
      typeof emailData.messageId === "string" ? emailData.messageId.trim() : "";
    if (supabase && (ownerUserId || workspaceId) && providerMessageId) {
      let dedupeQuery = supabase
        .from("mail_messages")
        .select("ai_draft_text")
        .eq("provider", provider)
        .eq("provider_message_id", providerMessageId);
      dedupeQuery = workspaceId
        ? dedupeQuery.eq("workspace_id", workspaceId)
        : dedupeQuery.eq("user_id", ownerUserId);
      const { data, error } = await dedupeQuery.maybeSingle();
      if (error) {
        console.warn("generate-draft-unified: dedupe lookup failed", error.message);
      } else if (data?.ai_draft_text?.trim()) {
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: "already_drafted" }),
          { status: 200 },
        );
      }
    }
    let prioritizedKnowledgeMatches = context.relevantKnowledgeMatches || [];
    const currentMessageTrackingIntent = detectTrackingIntent(
      emailData.subject || "",
      emailData.body || "",
    );
    if (V2_STAGED_ORCHESTRATOR_ENABLED && V2_CASE_ASSESSMENT_ENABLED) {
      caseAssessment = assessCase({
        subject: emailData.subject,
        body: emailData.body,
        from: emailData.from,
        fromEmail: emailData.fromEmail,
        ticketCategory,
        workflow: workflowRoute.workflow,
        trackingIntent: currentMessageTrackingIntent,
        matchedSubjectNumber: context.matchedSubjectNumber,
        hasSelectedOrder: Boolean(selectedOrder),
        styleLearningEnabled: Boolean(context.automation?.historic_inbox_access),
      });
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_latest_message_intent",
        {
          artifact_type: "latest_message_intent",
          latest_message_primary_intent: caseAssessment.latest_message_primary_intent,
          latest_message_confidence: caseAssessment.latest_message_confidence,
          latest_message_entities: {
            emails: caseAssessment.entities.emails,
            order_numbers: caseAssessment.entities.order_numbers,
            product_queries: caseAssessment.entities.product_queries,
          },
          legacy_category: legacyTicketCategory,
          legacy_workflow: buildWorkflowRoute(legacyTicketCategory).workflow,
        },
        internalThread.threadId,
      );
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_historical_context_hints",
        {
          artifact_type: "historical_context_hints",
          historical_context_intents: caseAssessment.historical_context_intents,
          legacy_category: legacyTicketCategory,
          legacy_workflow: buildWorkflowRoute(legacyTicketCategory).workflow,
        },
        internalThread.threadId,
      );
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_intent_conflict",
        {
          artifact_type: "intent_conflict",
          latest_message_primary_intent: caseAssessment.latest_message_primary_intent,
          latest_message_confidence: caseAssessment.latest_message_confidence,
          historical_context_intents: caseAssessment.historical_context_intents,
          intent_conflict_detected: caseAssessment.intent_conflict_detected,
          current_message_should_override_thread_route:
            caseAssessment.current_message_should_override_thread_route,
        },
        internalThread.threadId,
      );
      if (shouldUseLatestMessageRoute(caseAssessment)) {
        const assessmentCategory = routeCategoryFromIntent(
          caseAssessment.latest_message_primary_intent,
        );
        if (assessmentCategory && assessmentCategory !== ticketCategory) {
          const legacyCategoryBeforeOverride = ticketCategory;
          const legacyWorkflowBeforeOverride = workflowRoute.workflow;
          ticketCategory = assessmentCategory;
          workflowRoute = buildWorkflowRoute(ticketCategory);
          reasoningLogs.push({
            step_name: "workflow_routing_override",
            step_detail: JSON.stringify({
              reason: "current_message_first_override",
              legacy_category: legacyCategoryBeforeOverride,
              legacy_workflow: legacyWorkflowBeforeOverride,
              latest_message_primary_intent: caseAssessment.latest_message_primary_intent,
              latest_message_confidence: caseAssessment.latest_message_confidence,
              historical_context_intents: caseAssessment.historical_context_intents,
              intent_conflict_detected: caseAssessment.intent_conflict_detected,
              current_message_should_override_thread_route:
                caseAssessment.current_message_should_override_thread_route,
              primary_case_type: caseAssessment.primary_case_type,
              secondary_case_types: caseAssessment.secondary_case_types,
              confidence: caseAssessment.confidence,
              overridden_category: ticketCategory,
              overridden_workflow: workflowRoute.workflow,
            }),
            status: "warning",
          });
        }
      }
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_case_assessment",
        {
          artifact_type: "case_assessment",
          version: caseAssessment.version,
          debug_marker: caseAssessment.debug_marker,
          workflow: workflowRoute.workflow,
          case_assessment: caseAssessment,
        },
        internalThread.threadId,
      );
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_case_assessment_v2",
        {
          artifact_type: "case_assessment_v2",
          version: caseAssessment.version,
          debug_marker: caseAssessment.debug_marker,
          primary_case_type: caseAssessment.primary_case_type,
          secondary_case_types: caseAssessment.secondary_case_types,
          latest_message_primary_intent: caseAssessment.latest_message_primary_intent,
          latest_message_confidence: caseAssessment.latest_message_confidence,
          historical_context_intents: caseAssessment.historical_context_intents,
          intent_conflict_detected: caseAssessment.intent_conflict_detected,
          current_message_should_override_thread_route:
            caseAssessment.current_message_should_override_thread_route,
          intent_scores: caseAssessment.intent_scores,
          metadata_only_signals: caseAssessment.metadata_only_signals,
          retrieval_needs: caseAssessment.retrieval_needs,
          entities: {
            product_queries: caseAssessment.entities.product_queries,
            symptom_phrases: caseAssessment.entities.symptom_phrases,
            context_phrases: caseAssessment.entities.context_phrases,
            old_device_works: caseAssessment.entities.old_device_works,
            tried_fixes: caseAssessment.entities.tried_fixes,
          },
          cleanup_debug: caseAssessment.cleanup_debug || null,
        },
        internalThread.threadId,
      );
      const retrievalPriorityPlan = summarizeRetrievalPriority(caseAssessment.primary_case_type);
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_retrieval_priority_plan",
        {
          artifact_type: "retrieval_priority_plan",
          primary_case_type: caseAssessment.primary_case_type,
          retrieval_priority: retrievalPriorityPlan,
          rerank_enabled: V2_RETRIEVAL_RERANK_BY_CASE_TYPE_ENABLED,
          rerank_flag_raw: V2_RETRIEVAL_RERANK_BY_CASE_TYPE_RAW,
          effective_rerank_state:
            V2_STAGED_ORCHESTRATOR_ENABLED &&
            V2_CASE_ASSESSMENT_ENABLED &&
            V2_RETRIEVAL_RERANK_BY_CASE_TYPE_ENABLED,
        },
        internalThread.threadId,
      );
      const beforeOrder = prioritizedKnowledgeMatches.map((match) => String(match?.id ?? "")).join(",");
      prioritizedKnowledgeMatches = [...prioritizedKnowledgeMatches].sort((left, right) => {
        const leftClass = mapKnowledgeSourceClass(left);
        const rightClass = mapKnowledgeSourceClass(right);
        const leftPriority = getKnowledgeSourcePriority(caseAssessment.primary_case_type, leftClass);
        const rightPriority = getKnowledgeSourcePriority(caseAssessment.primary_case_type, rightClass);
        if (V2_RETRIEVAL_RERANK_BY_CASE_TYPE_ENABLED && rightPriority !== leftPriority) {
          return rightPriority - leftPriority;
        }
        return Number(right.similarity ?? 0) - Number(left.similarity ?? 0);
      });
      const afterOrder = prioritizedKnowledgeMatches.map((match) => String(match?.id ?? "")).join(",");
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_retrieval_rerank_result",
        {
          artifact_type: "retrieval_rerank_result",
          rerank_flag_raw: V2_RETRIEVAL_RERANK_BY_CASE_TYPE_RAW,
          rerank_enabled: V2_RETRIEVAL_RERANK_BY_CASE_TYPE_ENABLED,
          effective_rerank_state:
            V2_STAGED_ORCHESTRATOR_ENABLED &&
            V2_CASE_ASSESSMENT_ENABLED &&
            V2_RETRIEVAL_RERANK_BY_CASE_TYPE_ENABLED,
          case_type_used: caseAssessment.primary_case_type,
          rerank_changed_order: beforeOrder !== afterOrder,
          top_source_classes_before: (context.relevantKnowledgeMatches || [])
            .slice(0, 3)
            .map((match) => mapKnowledgeSourceClass(match)),
          top_source_classes_after: prioritizedKnowledgeMatches
            .slice(0, 3)
            .map((match) => mapKnowledgeSourceClass(match)),
        },
        internalThread.threadId,
      );
    }
    const productQueryText = caseAssessment?.entities?.product_queries?.length
      ? caseAssessment.entities.product_queries.join("\n")
      : "";
    const productRetrieval = productQueryText.trim()
      ? await fetchProductContext(
        supabase,
        shopId,
        productQueryText,
      )
      : { hits: [] as ProductMatch[] };
    let supplementalKnowledgeMatches: typeof prioritizedKnowledgeMatches = [];
    const shouldTryTechnicalFallbackKnowledge =
      Boolean(caseAssessment) &&
      (
        caseAssessment?.primary_case_type === "technical_issue" ||
        caseAssessment?.secondary_case_types?.includes("technical_issue") ||
        caseAssessment?.primary_case_type === "product_question"
      ) &&
      (!caseAssessment?.entities?.product_queries?.length || !(productRetrieval.hits || []).length);
    const troubleshootingQueryText = buildCompactTroubleshootingQuery(
      caseAssessment,
      null,
    );
    let supplementalKnowledgeDebug:
      | Awaited<ReturnType<typeof fetchRelevantKnowledgeDetailed>>["debug"]
      | null = null;
    if (shouldTryTechnicalFallbackKnowledge && troubleshootingQueryText.trim()) {
      const fallbackKnowledgeResult = await fetchRelevantKnowledgeDetailed(
        supabase,
        shopId,
        troubleshootingQueryText,
        Math.max(1, Math.min(Math.round(MAX_RETRIEVAL_CHUNKS), 6)),
        TECHNICAL_FALLBACK_KNOWLEDGE_MIN_SIMILARITY,
      );
      supplementalKnowledgeMatches = fallbackKnowledgeResult.matches;
      supplementalKnowledgeDebug = fallbackKnowledgeResult.debug;
      if (supplementalKnowledgeMatches.length) {
        const existingIds = new Set(
          prioritizedKnowledgeMatches.map((match) => String(match?.id ?? "")).filter(Boolean),
        );
        prioritizedKnowledgeMatches = [
          ...prioritizedKnowledgeMatches,
          ...supplementalKnowledgeMatches.filter((match) => {
            const id = String(match?.id ?? "").trim();
            return !id || !existingIds.has(id);
          }),
        ];
      }
    }
    console.info(
      JSON.stringify({
        event: "knowledge.retrieve.result",
        shop_id: shopId,
        workspace_id: context.workspaceId ?? null,
        message_id: internalThread.messageId ?? null,
        knowledge_hits_count: Array.isArray(context.relevantKnowledgeMatches)
          ? context.relevantKnowledgeMatches.length
          : 0,
        product_hits_count: Array.isArray(productRetrieval.hits)
          ? productRetrieval.hits.length
          : 0,
        product_query_text: productQueryText,
        troubleshooting_query_text: troubleshootingQueryText,
        supplemental_knowledge_hits_count: supplementalKnowledgeMatches.length,
        technical_fallback_knowledge_min_similarity: TECHNICAL_FALLBACK_KNOWLEDGE_MIN_SIMILARITY,
      }),
    );
    appendStructuredArtifactLog(
      reasoningLogs,
      "v2_product_query",
      {
        artifact_type: "product_query",
        product_queries: caseAssessment?.entities?.product_queries || [],
        product_query_text: productQueryText,
        product_hits_count: Array.isArray(productRetrieval.hits) ? productRetrieval.hits.length : 0,
        troubleshooting_query_text: troubleshootingQueryText,
        supplemental_knowledge_hits_count: supplementalKnowledgeMatches.length,
        technical_fallback_knowledge_min_similarity: TECHNICAL_FALLBACK_KNOWLEDGE_MIN_SIMILARITY,
      },
      internalThread.threadId,
    );
    if (supplementalKnowledgeDebug) {
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_technical_retrieval_debug",
        {
          artifact_type: "technical_retrieval_debug",
          query_text: supplementalKnowledgeDebug.query_text,
          threshold: supplementalKnowledgeDebug.threshold,
          safe_limit: supplementalKnowledgeDebug.safe_limit,
          retrieval_limit: supplementalKnowledgeDebug.retrieval_limit,
          raw_count: supplementalKnowledgeDebug.raw_count,
          filtered_count: supplementalKnowledgeDebug.filtered_count,
          selected_count: supplementalKnowledgeDebug.selected_count,
          top_candidates: supplementalKnowledgeDebug.top_candidates,
        },
        internalThread.threadId,
      );
    }
    if (productRetrieval.hits.length) {
      reasoningLogs.push({
        step_name: "Product Search",
        step_detail: "Found matching products",
        status: "success",
      });
    }
    const trackingIntentSuppressed = shouldSuppressTrackingEnrichment({
      assessment: caseAssessment,
      currentMessageTrackingIntent,
    });
    const trackingIntent =
      !trackingIntentSuppressed &&
      (
        Boolean(workflowRoute.forceTrackingIntent) ||
        currentMessageTrackingIntent
      );
    appendStructuredArtifactLog(
      reasoningLogs,
      "v2_tracking_intent",
      {
        artifact_type: "tracking_intent",
        current_message_tracking_intent: currentMessageTrackingIntent,
        workflow_forces_tracking: Boolean(workflowRoute.forceTrackingIntent),
        tracking_intent_suppressed: trackingIntentSuppressed,
        effective_tracking_intent: trackingIntent,
        latest_message_primary_intent: caseAssessment?.latest_message_primary_intent ?? null,
        historical_context_intents: caseAssessment?.historical_context_intents ?? [],
      },
      internalThread.threadId,
    );
    if (trackingIntent && selectedTrackingCarriers.length) {
      reasoningLogs.push({
        step_name: "carrier_preferences",
        step_detail: `Configured carriers: ${selectedTrackingCarriers.join(", ")}`,
        status: "success",
      });
    }
    const trackingOrders = selectedOrder ? [selectedOrder] : [];
    const trackingDetailsByOrderKey =
      trackingIntent && trackingOrders.length
        ? await fetchTrackingDetailsForOrders(trackingOrders, {
          preferredCarriers: selectedTrackingCarriers,
        })
        : {};
    if (trackingIntent) {
      const trackingKey = selectedOrder ? pickOrderTrackingKey(selectedOrder) : null;
      const selectedTracking = trackingKey ? trackingDetailsByOrderKey[trackingKey] ?? null : null;
      if (selectedTracking) {
        reasoningLogs.push({
          step_name: "carrier_tracking",
          step_detail: JSON.stringify({
            detail: `Loaded ${selectedTracking.carrier} tracking status.`,
            carrier: selectedTracking.carrier,
            status: selectedTracking.statusText,
            tracking_number: selectedTracking.trackingNumber,
            tracking_url: selectedTracking.trackingUrl,
            source: selectedTracking.source || "shopify",
            lookup_source: selectedTracking.lookupSource || "unknown",
            lookup_detail: selectedTracking.lookupDetail || "",
          }),
          status: "success",
        });
      } else {
        reasoningLogs.push({
          step_name: "carrier_tracking",
          step_detail: "No carrier event found - using Shopify tracking fallback.",
          status: "warning",
        });
      }
    }

    let learnedStyle = "";
    const learningProfile = await fetchLearningProfile(internalThread.mailboxId, ownerUserId);
    if (context.automation?.historic_inbox_access && learningProfile.enabled) {
      const history = await fetchMailboxHistory(internalThread.mailboxId, ownerUserId);
      const heuristicBullets = buildStyleHeuristics(history);
      learnedStyle = mergeBullets(heuristicBullets, learningProfile.styleRules).join("\n");
    } else if (learningProfile.enabled && learningProfile.styleRules.length) {
      learnedStyle = mergeBullets([], learningProfile.styleRules).join("\n");
    }

    const customerFirstName = extractOrderFirstName(selectedOrder) || extractCustomerFirstName(emailData);
    const policyContext = buildPinnedPolicyContext({
      subject: emailData.subject || "",
      body: emailData.body || "",
      policies: context.policies,
      reservedTokens: POLICY_RESERVED_TOKENS,
    });
    if (V2_STAGED_ORCHESTRATOR_ENABLED) {
      factContext = retrieveFactContext({
        selectedOrder,
        orders: context.orders,
        matchedSubjectNumber: context.matchedSubjectNumber,
        automation: context.automation,
      });
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_fact_context",
        {
          artifact_type: "fact_context",
          version: factContext.version,
          fact_context: factContext,
        },
        internalThread.threadId,
      );
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_policy_context",
        {
          artifact_type: "policy_context",
          intent: policyContext.intent,
          summary_included: policyContext.policySummaryIncluded,
          excerpt_included: policyContext.policyExcerptIncluded,
          summary_tokens: policyContext.policySummaryTokens,
          excerpt_tokens: policyContext.policyExcerptTokens,
        },
        internalThread.threadId,
      );
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_product_context",
        {
          artifact_type: "product_context",
          hits: (productRetrieval.hits || []).map((item) => ({
            id: item?.external_id ?? item?.id ?? null,
            title: item?.title ?? null,
            similarity: Number(item?.similarity ?? item?.score ?? 0) || null,
          })),
        },
        internalThread.threadId,
      );
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_style_context",
        {
          artifact_type: "style_context",
          learning_enabled: Boolean(learningProfile.enabled),
          learned_style_present: Boolean(learnedStyle),
        },
        internalThread.threadId,
      );
    }
    const policySummaryText = policyContext.policySummaryText;
    const policyRulesText = policyContext.policyRulesText;
    const policyExcerptText = policyContext.policyExcerptText;
    const returnDetails = applyMatchedSubjectOrderNumber(
      extractReturnDetails(emailData.subject || "", emailData.body || ""),
      context.matchedSubjectNumber,
    );
    const isReturnIntent =
      Boolean(workflowRoute.forceReturnDetailsFlow) ||
      policyContext.intent === "RETURN" ||
      policyContext.intent === "REFUND";
    const returnDetailsFoundText = isReturnIntent
      ? buildReturnDetailsFoundBlock(returnDetails)
      : "";
    const reasonRequired = isReturnReasonRequiredByPolicy(
      `${context.policies?.policy_refund || ""}\n${context.policies?.policy_terms || ""}`,
    );
    const returnDetailsMissing = isReturnIntent
      ? missingReturnDetails(returnDetails, { requireReason: reasonRequired })
      : [];
    const returnSettings = isReturnIntent
      ? await ensureWorkspaceReturnSettings({
        supabase,
        workspaceId,
      })
      : null;
    const returnEligibility =
      isReturnIntent && selectedOrder
        ? evaluateReturnEligibility({
          settings: returnSettings,
          order: selectedOrder,
        })
        : null;
    const returnPromptBlock = isReturnIntent
      ? buildReturnSettingsPromptBlock(returnSettings, returnEligibility)
      : "";

    // Byg shared prompt med policies, automation-regler og ordre-kontekst.
    const promptBase = buildMailPrompt({
      emailBody: emailData.body || "(tomt indhold)",
      orderSummary: context.orderSummary,
      personaInstructions: context.persona.instructions,
      matchedSubjectNumber: context.matchedSubjectNumber,
      customerName: customerFirstName || null,
      extraContext: [
        BASE_ACTION_CONTEXT,
        `Workflow category: ${workflowRoute.category}`,
        workflowRoute.workflow === "tracking" && selectedTrackingCarriers.length
          ? `Configured carriers for this workspace: ${selectedTrackingCarriers.join(", ")}.`
          : "",
        returnPromptBlock,
        workflowRoute.promptHint,
        ...(workflowRoute.promptBlocks || []),
      ]
        .filter(Boolean)
        .join("\n"),
      signature: context.profile.signature?.trim() || "",
      learnedStyle: learnedStyle || null,
      policies: context.policies,
      policySummary: policySummaryText,
      policyExcerpt: policyExcerptText,
      policyRules: policyRulesText,
      policyIntent: policyContext.intent,
      returnDetailsFound: returnDetailsFoundText,
      returnDetailsMissing,
    });
    const inlineImageAttachments = await loadInlineImageAttachments({
      userId: ownerUserId,
      workspaceId,
      provider,
      providerMessageId: emailData.messageId || null,
    });
    const knowledgeTraceHits = prioritizedKnowledgeMatches.map((match, index) => {
      const rawMatch = match as Record<string, unknown>;
      const type = match?.source_type || "snippet";
      const provider = match?.source_provider ? `, Provider: ${match.source_provider}` : "";
      const content = String(match?.content || "").trim();
      const text = content ? `[${index + 1}] (Type: ${type}${provider}) ${content}` : "";
      const metadata =
        match?.metadata && typeof match.metadata === "object"
          ? (match.metadata as Record<string, unknown>)
          : {};
      return {
        knowledge_id: Number(match?.id ?? 0) || null,
        source_type: type,
        source_provider: match?.source_provider || "",
        source_class: mapKnowledgeSourceClass(match),
        similarity:
          Number.isFinite(Number(match?.similarity)) ? Number(match?.similarity) : null,
        chunk_index:
          Number.isInteger(Number(rawMatch?.chunk_index)) && Number(rawMatch?.chunk_index) >= 0
            ? Number(rawMatch?.chunk_index)
            : Number.isInteger(Number(metadata?.chunk_index)) && Number(metadata?.chunk_index) >= 0
            ? Number(metadata?.chunk_index)
            : null,
        chunk_count:
          Number.isInteger(Number(rawMatch?.chunk_count)) && Number(rawMatch?.chunk_count) > 0
            ? Number(rawMatch?.chunk_count)
            : Number.isInteger(Number(metadata?.chunk_count)) && Number(metadata?.chunk_count) > 0
            ? Number(metadata?.chunk_count)
            : null,
        included: false,
        approx_tokens: estimateTokens(text),
        prompt_priority:
          getKnowledgePromptPriority(String(match?.source_provider || "")) +
          (caseAssessment
            ? getKnowledgeSourcePriority(
                caseAssessment.primary_case_type,
                mapKnowledgeSourceClass(match),
              ) * 100
            : 0),
        content,
        _text: text,
      };
    }).filter((hit) => hit._text)
      .sort((left, right) => {
        if (right.prompt_priority !== left.prompt_priority) {
          return right.prompt_priority - left.prompt_priority;
        }
        return (Number(right.similarity ?? 0) - Number(left.similarity ?? 0));
      });

    const productTraceHits = (productRetrieval.hits || []).map((item) => {
      const price = item?.price ? `Price: ${item.price}.` : "";
      const text = `Product: ${item?.title ?? "Unknown"}. ${price} Details: ${
        item?.description ?? ""
      }`;
      const similarityRaw = Number(item?.similarity ?? item?.score);
      return {
        product_id:
          String(item?.external_id ?? item?.id ?? "").trim() || null,
        title: String(item?.title || "").trim() || null,
        handle: String(item?.handle || "").trim() || null,
        similarity: Number.isFinite(similarityRaw) ? similarityRaw : null,
        included: false,
        approx_tokens: estimateTokens(text),
        _text: text,
      };
    });
    const trackingTraceHits =
      trackingIntent && selectedOrder
        ? Object.entries(trackingDetailsByOrderKey).map(([, detail]) => {
            const text =
              `Carrier: ${detail.carrier}. Status: ${detail.statusText}. ` +
              `Tracking: ${detail.trackingNumber}. Link: ${detail.trackingUrl}`;
            return {
              included: false,
              approx_tokens: estimateTokens(text),
              _text: text,
            };
          })
        : [];

    const extras: string[] = [];
    const baseTokens = estimateTokens(promptBase);
    let remaining = MAX_CONTEXT_TOKENS > 0 ? Math.max(0, MAX_CONTEXT_TOKENS - baseTokens) : Number.POSITIVE_INFINITY;
    const droppedContextReasons: string[] = [];
    const addDropReason = (reason: string) => {
      if (!reason || droppedContextReasons.includes(reason)) return;
      droppedContextReasons.push(reason);
    };

    const appendSectionWithBudget = (
      sectionKey: string,
      header: string,
      hits: Array<{ _text: string; included: boolean; approx_tokens: number }>,
      options?: { allowOverflow?: boolean; minimumTokens?: number },
    ) => {
      if (!hits.length) return;
      const allowOverflow = options?.allowOverflow === true;
      const sectionBudget = remaining > 0
        ? remaining
        : allowOverflow
        ? Math.max(0, Number(options?.minimumTokens ?? 0))
        : 0;
      if (sectionBudget <= 0) {
        addDropReason(`${sectionKey}:token_budget`);
        return;
      }
      const headerTokens = estimateTokens(header);
      if (headerTokens > sectionBudget) {
        addDropReason(`${sectionKey}:token_budget`);
        return;
      }

      const sectionLines: string[] = [header];
      let sectionRemaining = sectionBudget - headerTokens;
      for (const hit of hits) {
        if (sectionRemaining <= 0) {
          addDropReason(`${sectionKey}:token_budget`);
          break;
        }
        const hitTokens = estimateTokens(hit._text);
        if (hitTokens <= sectionRemaining) {
          sectionLines.push(hit._text);
          hit.included = true;
          hit.approx_tokens = hitTokens;
          sectionRemaining -= hitTokens;
          continue;
        }
        const trimmed = truncateToApproxTokens(hit._text, sectionRemaining);
        if (trimmed) {
          sectionLines.push(trimmed);
          hit.included = true;
          hit.approx_tokens = estimateTokens(trimmed);
          sectionRemaining = 0;
        }
        addDropReason(`${sectionKey}:token_budget`);
        break;
      }
      if (sectionLines.length > 1) {
        extras.push(sectionLines.join("\n"));
        remaining = Math.max(0, remaining - (sectionBudget - sectionRemaining));
      }
    };

    if (MAX_CONTEXT_TOKENS <= 0 || baseTokens < MAX_CONTEXT_TOKENS) {
      appendSectionWithBudget("knowledge", "RELEVANT KNOWLEDGE & HISTORY:", knowledgeTraceHits, {
        allowOverflow: true,
        minimumTokens: KNOWLEDGE_SECTION_MIN_TOKENS,
      });
      if (trackingTraceHits.length) {
        appendSectionWithBudget("tracking", "LIVE TRACKING:", trackingTraceHits);
      }
      appendSectionWithBudget("product", "PRODUKTKONTEKST:", productTraceHits);
      if (inlineImageAttachments.length) {
        const imageContextLines = inlineImageAttachments.map(
          (image, index) =>
            `- [${index + 1}] ${image.filename} (${image.mimeType}, ${image.sizeBytes ?? "ukendt"} bytes)`,
        );
        extras.push(
          [
            "CUSTOMER IMAGE ATTACHMENTS:",
            "You also receive these images directly in the model input. Use them when relevant.",
            ...imageContextLines,
            "If image details are unclear, say so and ask a concise follow-up question.",
          ].join("\n"),
        );
      }
    } else {
      addDropReason("base_prompt:token_budget");
      appendSectionWithBudget("knowledge", "RELEVANT KNOWLEDGE & HISTORY:", knowledgeTraceHits, {
        allowOverflow: true,
        minimumTokens: KNOWLEDGE_SECTION_MIN_TOKENS,
      });
    }

    const prompt = [promptBase, ...extras].join("\n\n");
    const dynamicExtrasTokens = extras.length
      ? extras.reduce((sum, section) => sum + estimateTokens(section), 0)
      : 0;
    const policyPinnedTokens = policyContext.policySummaryTokens + policyContext.policyExcerptTokens;
    const includedContextTokens = Math.max(1, policyPinnedTokens + dynamicExtrasTokens);
    const retrievalTracePayload = {
      knowledge_hits: knowledgeTraceHits.map((hit) => ({
        knowledge_id: hit.knowledge_id,
        source_type: hit.source_type,
        source_provider: hit.source_provider,
        source_class: hit.source_class,
        similarity: hit.similarity,
        prompt_priority: hit.prompt_priority,
        chunk_index: hit.chunk_index,
        chunk_count: hit.chunk_count,
        included: hit.included,
        approx_tokens: hit.approx_tokens,
      })),
      product_hits: productTraceHits.map((hit) => ({
        product_id: hit.product_id,
        title: hit.title,
        handle: hit.handle,
        similarity: hit.similarity,
        included: hit.included,
        approx_tokens: hit.approx_tokens,
      })),
      policy_intent: policyContext.intent,
      policy_summary_included: policyContext.policySummaryIncluded,
      policy_excerpt_included: policyContext.policyExcerptIncluded,
      policy_summary_tokens: policyContext.policySummaryTokens,
      included_context_tokens: includedContextTokens,
      dropped_context_reason:
        droppedContextReasons.length > 0 ? droppedContextReasons[0] : null,
      dropped_context_reasons: droppedContextReasons,
    };
    const knowledgeSummaryText = knowledgeTraceHits
      .filter((hit) => hit.included)
      .map((hit) => hit._text)
      .join("\n");
    const technicalKnowledgeSummaryText = buildTechnicalKnowledgeSummary(
      caseAssessment,
      knowledgeTraceHits,
    );
    const technicalDiagnosticFacts = extractTechnicalDiagnosticFacts(
      caseAssessment,
      knowledgeTraceHits,
    );
    const productSummaryText = productTraceHits
      .filter((hit) => hit.included)
      .map((hit) => hit._text)
      .join("\n");
    const factSummaryText = [
      factContext?.summary || "",
      selectedOrder
        ? `Selected order status: fulfillment=${String(selectedOrder?.fulfillment_status || "unknown")}, financial=${String(selectedOrder?.financial_status || "unknown")}, cancelled=${selectedOrder?.cancelled_at ? "yes" : "no"}.`
        : "No selected order.",
    ]
      .filter(Boolean)
      .join("\n");

    // Generer reply + actions med OpenAI JSON schema.
    let aiText: string | null = null;
    let automationActions: AutomationAction[] = [];
    let actionDecisionArtifact: ActionDecision | null = null;
    let usedTwoStageModel = false;
    let shouldRunLegacyCombinedFallback = false;
    let decisionModelSuccess = false;
    let replyModelSuccess = false;
    let fallbackUsed = false;
    let fallbackReason: string | null = null;
    let replyContainsConfirmationLanguage = false;
    let executionState: ExecutionState = "no_action";
    let returnActionResult:
      | {
        type: string;
        ok: boolean;
        status: "pending_approval";
        orderId?: number;
        payload?: Record<string, unknown>;
        detail?: string;
        error?: string;
      }
      | null = null;
    const runLegacyCombinedModel = async () => {
      const automationGuidance = buildAutomationGuidance(context.automation);
      const personaGuidance = `Sprogregel har altid forrang; ignorer persona-instruktioner om sprogvalg.
Persona instruktionsnoter: ${context.persona.instructions?.trim() || "Hold tonen venlig og effektiv."}
Afslut ikke med signatur – signaturen tilføjes automatisk senere.`;
      const systemMsgBase = [
        "Du er en kundeservice-assistent.",
        "Skriv kort, venligt og professionelt pa samme sprog som kundens mail.",
        "Hvis kunden skriver pa engelsk, svar pa engelsk selv om andre instruktioner er pa dansk.",
        `Start altid svaret med "Hej ${customerFirstName || "kunden"},".`,
        "Brug KONTEKST-sektionen til at finde relevante oplysninger og nævn dem eksplicit i svaret.",
        "Ved returns/refunds/warranty/shipping: følg policy summary/excerpts strengt.",
        "Opfind aldrig return-portal URL, labels eller processer som ikke står i kontekst.",
        "Når return shipping mode er customer_paid: nævn aldrig returlabel eller parcel shop.",
        "Hvis du giver returinstruktioner, brug kun den konfigurerede return_address fra konteksten.",
        `Ticket category: ${workflowRoute.category}.`,
        workflowRoute.systemHint,
        ...(workflowRoute.systemRules || []),
        personaGuidance,
        "Automationsregler:",
        automationGuidance,
        "Ud over forventet svar skal du returnere JSON med 'reply' og 'actions'.",
        "Hvis en handling udføres (f.eks. opdater adresse, annuller ordre, refund, hold, line item edit, opdater kontakt, resend invoice, tilføj note/tag), skal actions-listen indeholde et objekt med type, orderId og payload.",
        "Tilladte actions: update_shipping_address, cancel_order, refund_order, create_exchange_request, change_shipping_method, hold_or_release_fulfillment, edit_line_items, update_customer_contact, add_note, add_tag, add_internal_note_or_tag, resend_confirmation_or_invoice, lookup_order_status, fetch_tracking.",
        "Ved rene status/tracking-spørgsmål skal du foretrække read-only actions: lookup_order_status og fetch_tracking. Undgå add_note/add_tag medmindre kunden udtrykkeligt beder om en intern note/tag.",
        "Nævn aldrig trackingnummer eller trackinglink, medmindre KONTEKST for den valgte ordre indeholder trackingdata.",
        "For update_shipping_address skal payload.shipping_address mindst indeholde name, address1, city, zip/postal_code og country.",
        "For create_exchange_request skal payload mindst indeholde return_line_item_id og exchange_variant_id. Brug return_quantity/exchange_quantity hvis kunden har angivet antal.",
        "For edit_line_items skal payload.operations bruges med type: set_quantity/remove_line_item/add_variant samt line_item_id/variant_id og quantity.",
        "Afslut ikke med signatur – signaturen tilføjes automatisk senere.",
      ].join("\n");
      const systemMsg = context.matchedSubjectNumber
        ? systemMsgBase +
          ` Hvis KONTEKST indeholder et ordrenummer (fx #${context.matchedSubjectNumber}), brug dette ordrenummer som reference i svaret og spørg IKKE efter ordrenummer igen.`
        : systemMsgBase;
      const { reply, actions } = await callOpenAIWithImages(
        prompt,
        systemMsg,
        inlineImageAttachments,
      );
      aiText = reply;
      automationActions = actions ?? [];
      const policyResult = applyWorkflowActionPolicy(automationActions, workflowRoute);
      automationActions = policyResult.actions;
      if (policyResult.removed.length) {
        reasoningLogs.push({
          step_name: "workflow_action_policy",
          step_detail: JSON.stringify({
            workflow: workflowRoute.workflow,
            removed_actions: policyResult.removed,
          }),
          status: "warning",
        });
      }
    };
    try {
      if (OPENAI_API_KEY) {
        const automationGuidance = buildAutomationGuidance(context.automation);
        const customerMessage = `${emailData.subject || ""}\n\n${emailData.body || ""}`.trim();
        const shouldUseTwoStageModel =
          V2_STAGED_ORCHESTRATOR_ENABLED &&
          V2_DECIDE_ACTIONS_ENABLED &&
          V2_GENERATE_REPLY_FROM_STRATEGY_ENABLED;

        if (shouldUseTwoStageModel) {
          try {
            actionDecisionArtifact = await decideActions({
              customerMessage,
              workflow: workflowRoute.workflow,
              workflowCategory: workflowRoute.category,
              automationGuidance,
              orderSummary: context.orderSummary || "",
              factSummary: factSummaryText,
              policyRules: policyRulesText,
              policySummary: policySummaryText,
              policyExcerpt: policyExcerptText,
              productSummary: productSummaryText,
              matchedSubjectNumber: context.matchedSubjectNumber,
              customerFirstName,
            });
            automationActions = actionDecisionArtifact.actions ?? [];
            usedTwoStageModel = true;
            decisionModelSuccess = true;
            appendStructuredArtifactLog(
              reasoningLogs,
              "v2_action_decision",
              {
                artifact_type: "action_decision",
                action_decision: actionDecisionArtifact,
              },
              internalThread.threadId,
            );
          } catch (stageErr) {
            reasoningLogs.push({
              step_name: "v2_action_decision",
              step_detail: withThreadMeta(
                JSON.stringify({
                  artifact_type: "action_decision_error",
                  error: stageErr instanceof Error ? stageErr.message : String(stageErr),
                  fallback_to_legacy: V2_TWO_STAGE_FALLBACK_ENABLED,
                }),
                internalThread.threadId,
              ),
              status: "warning",
            });
            if (!V2_TWO_STAGE_FALLBACK_ENABLED) throw stageErr;
            fallbackUsed = true;
            fallbackReason = "action_decision_error";
          }
        }

        if (!usedTwoStageModel) {
          await runLegacyCombinedModel();
        }

        if (hasExchangeSignals(emailData.subject || "", emailData.body || "")) {
          automationActions = automationActions.filter(
            (action) => !isInternalAnnotationAction(String(action?.type || "")),
          );
        }
        const exchangeFallbackAction = maybeBuildExchangeFallbackAction({
          selectedOrder,
          orderSummary: context.orderSummary || "",
          subject: emailData.subject || "",
          body: emailData.body || "",
          existingActions: automationActions,
        });
        if (exchangeFallbackAction) {
          automationActions = [...automationActions, exchangeFallbackAction];
          reasoningLogs.push({
            step_name: "Shopify Action",
            step_detail: "Fallback exchange action inferred from return request.",
            status: "warning",
          });
        }
      } else {
        aiText = null;
      }
    } catch (e) {
      console.warn("OpenAI fejl", e?.message || e);
      aiText = null;
    }

    if (!automationActions.length) {
      const exchangeFallbackAction = maybeBuildExchangeFallbackAction({
        selectedOrder,
        orderSummary: context.orderSummary || "",
        subject: emailData.subject || "",
        body: emailData.body || "",
        existingActions: automationActions,
      });
      if (exchangeFallbackAction) {
        automationActions = [...automationActions, exchangeFallbackAction];
        reasoningLogs.push({
          step_name: "Shopify Action",
          step_detail: "Fallback exchange action inferred after empty AI action set.",
          status: "warning",
        });
      }
    }

    if (
      hasExchangeSignals(emailData.subject || "", emailData.body || "") &&
      !automationActions.some(
        (action) => String(action?.type || "").trim().toLowerCase() === "create_exchange_request",
      )
    ) {
      const forcedExchangeAction = maybeBuildExchangeFallbackAction({
        selectedOrder,
        orderSummary: context.orderSummary || "",
        subject: emailData.subject || "",
        body: emailData.body || "",
        existingActions: automationActions,
      });
      if (forcedExchangeAction) {
        automationActions = [
          ...automationActions.filter((action) => !isInternalAnnotationAction(String(action?.type || ""))),
          forcedExchangeAction,
        ];
        reasoningLogs.push({
          step_name: "Shopify Action",
          step_detail: "Forced exchange action replaced internal note/tag action.",
          status: "warning",
        });
      }
    }

    if (automationActions.length) {
      const finalPolicy = applyWorkflowActionPolicy(automationActions, workflowRoute);
      automationActions = finalPolicy.actions;
      if (finalPolicy.removed.length) {
        reasoningLogs.push({
          step_name: "workflow_action_policy_final",
          step_detail: JSON.stringify({
            workflow: workflowRoute.workflow,
            removed_actions: finalPolicy.removed,
          }),
          status: "warning",
        });
      }
    }

    if (automationActions.length) {
      const normalizedActionResult = normalizeAutomationActionsForOrderContext(
        automationActions,
        selectedOrder,
      );
      automationActions = normalizedActionResult.actions;
      if (normalizedActionResult.removed.length) {
        reasoningLogs.push({
          step_name: "workflow_action_order_context",
          step_detail: JSON.stringify({
            selected_order_id: Number(selectedOrder?.id ?? 0) || null,
            removed_actions: normalizedActionResult.removed,
          }),
          status: "warning",
        });
      }
    }

    if (isReturnIntent && returnSettings && selectedOrder) {
      const orderIdNumeric = Number(selectedOrder?.id ?? 0);
      const customerEmail = asTextOrNull(emailData.fromEmail || emailData.from);
      const returnReason = asTextOrNull(returnDetails.return_reason) || "customer_requested_return";
      if (returnEligibility?.eligible === true) {
        returnActionResult = {
          type: "send_return_instructions",
          ok: false,
          status: "pending_approval",
          orderId: Number.isFinite(orderIdNumeric) && orderIdNumeric > 0 ? orderIdNumeric : undefined,
          payload: {
            actionType: "send_return_instructions",
            reason: returnReason,
            return_window_days: returnSettings.return_window_days,
            return_shipping_mode: returnSettings.return_shipping_mode,
            return_address: returnSettings.return_address || null,
            require_original_packaging: returnSettings.require_original_packaging,
            require_unused: returnSettings.require_unused,
            exchange_allowed: returnSettings.exchange_allowed,
            eligibility: returnEligibility,
            customer_email: customerEmail,
          },
          detail: `Send return instructions (${returnSettings.return_shipping_mode}).`,
          error: "Return instructions require manual approval.",
        };
      } else if (returnEligibility?.eligible == null) {
        returnActionResult = {
          type: "create_return_case",
          ok: false,
          status: "pending_approval",
          orderId: Number.isFinite(orderIdNumeric) && orderIdNumeric > 0 ? orderIdNumeric : undefined,
          payload: {
            actionType: "create_return_case",
            reason: returnReason,
            return_shipping_mode: returnSettings.return_shipping_mode,
            customer_email: customerEmail,
            shopify_order_id:
              Number.isFinite(orderIdNumeric) && orderIdNumeric > 0 ? String(orderIdNumeric) : null,
            eligibility: returnEligibility,
            eligibility_reason: returnEligibility.reason,
          },
          detail: "Create return case for manual review.",
          error: "Return data is incomplete and requires manual review.",
        };
      } else if (returnEligibility?.reason === "outside_return_window") {
        aiText = buildOutsideWindowReply({
          languageHint: inferLanguageHint(emailData.subject || "", emailData.body || ""),
          customerName: customerFirstName || "there",
          returnWindowDays: returnSettings.return_window_days,
        });
        await upsertRejectedReturnCase({
          workspaceId,
          threadId: internalThread.threadId || null,
          selectedOrder,
          customerEmail,
          reason: returnReason,
          eligibilityReason: "outside_return_window",
          returnShippingMode: returnSettings.return_shipping_mode,
        });
      }
    }

    if (V2_STAGED_ORCHESTRATOR_ENABLED && V2_ACTION_VALIDATION_ENABLED) {
      actionValidation = validateActionDecision({
        actions: automationActions,
        workflowRoute,
        selectedOrder,
        automation: context.automation,
      });
      automationActions = actionValidation.allowed_actions;
      executionState = deriveExecutionState({
        validation: actionValidation,
        hasBlockedAction: false,
        hasPendingApproval: Boolean(returnActionResult?.status === "pending_approval"),
      });
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_action_validation",
        {
          artifact_type: "action_validation",
          validation: actionValidation,
        },
        internalThread.threadId,
      );
    }

    if (V2_STAGED_ORCHESTRATOR_ENABLED && V2_REPLY_STRATEGY_ENABLED) {
      const assessmentForStrategy =
        caseAssessment ||
        assessCase({
          subject: emailData.subject,
          body: emailData.body,
          from: emailData.from,
          fromEmail: emailData.fromEmail,
          ticketCategory,
          workflow: workflowRoute.workflow,
          trackingIntent,
          matchedSubjectNumber: context.matchedSubjectNumber,
          hasSelectedOrder: Boolean(selectedOrder),
          styleLearningEnabled: Boolean(context.automation?.historic_inbox_access),
        });
      const validationForStrategy =
        actionValidation ||
        validateActionDecision({
          actions: automationActions,
          workflowRoute,
          selectedOrder,
          automation: context.automation,
        });
      executionState = deriveExecutionState({
        validation: validationForStrategy,
        hasBlockedAction: false,
        hasPendingApproval: Boolean(returnActionResult?.status === "pending_approval"),
      });
      replyStrategyArtifact = buildReplyStrategy({
        assessment: assessmentForStrategy,
        validation: validationForStrategy,
        selectedOrder,
        trackingIntent,
        hasPolicyContext:
          policyContext.policySummaryIncluded || policyContext.policyExcerptIncluded,
        policyIntent: policyContext.intent,
        executionState,
      });
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_reply_strategy",
        {
          artifact_type: "reply_strategy",
          reply_strategy: replyStrategyArtifact,
        },
        internalThread.threadId,
      );
    }

    if (
      usedTwoStageModel &&
      V2_STAGED_ORCHESTRATOR_ENABLED &&
      V2_GENERATE_REPLY_FROM_STRATEGY_ENABLED &&
      replyStrategyArtifact
    ) {
      try {
        const replyActionTypes = (actionValidation?.allowed_actions || automationActions || []).map((action) =>
          String(action?.type || "").trim().toLowerCase()
        );
        const allowGeneralKnowledgeForReply = !isActionSensitiveReplyCase({
          actionTypes: replyActionTypes,
          isReturnIntent,
        });
        const suppressPolicyForReply = shouldSuppressPolicyForTechnicalReply({
          assessment: caseAssessment,
          executionState: replyStrategyArtifact.execution_state,
          policyIntent: policyContext.intent,
        });
        appendStructuredArtifactLog(
          reasoningLogs,
          "v2_reply_context_guard",
          {
            artifact_type: "reply_context_guard",
            suppress_policy_for_reply: suppressPolicyForReply,
            policy_intent: policyContext.intent,
            execution_state: replyStrategyArtifact.execution_state,
            case_type: caseAssessment?.primary_case_type ?? null,
          },
          internalThread.threadId,
        );
        appendStructuredArtifactLog(
          reasoningLogs,
          "v2_technical_knowledge_summary",
          {
            artifact_type: "technical_knowledge_summary",
            technical_knowledge_present: Boolean(technicalKnowledgeSummaryText),
            technical_knowledge_line_count: technicalKnowledgeSummaryText
              ? technicalKnowledgeSummaryText.split("\n").filter(Boolean).length
              : 0,
            technical_diagnostic_facts: technicalDiagnosticFacts,
          },
          internalThread.threadId,
        );
        aiText = await generateReplyFromStrategy({
          customerMessage: `${emailData.subject || ""}\n\n${emailData.body || ""}`.trim(),
          customerFirstName,
          replyStrategy: replyStrategyArtifact,
          executionState: replyStrategyArtifact.execution_state,
          factSummary: factSummaryText,
          technicalKnowledgeSummary: technicalKnowledgeSummaryText,
          technicalDiagnosticFacts,
          policySummary: suppressPolicyForReply ? "" : policySummaryText,
          policyExcerpt: suppressPolicyForReply ? "" : policyExcerptText,
          productSummary: productSummaryText,
          generalKnowledgeSummary: allowGeneralKnowledgeForReply ? knowledgeSummaryText : "",
          learnedStyle,
          personaInstructions: context.persona.instructions,
        });
        replyModelSuccess = Boolean(aiText);
        appendStructuredArtifactLog(
          reasoningLogs,
          "v2_reply_generation",
          {
            artifact_type: "reply_generation",
            used_two_stage_model: true,
            generated_reply_present: Boolean(aiText),
          },
          internalThread.threadId,
        );
        if (!aiText && V2_TWO_STAGE_FALLBACK_ENABLED) {
          usedTwoStageModel = false;
          shouldRunLegacyCombinedFallback = true;
          fallbackUsed = true;
          fallbackReason = fallbackReason || "reply_generation_empty_output";
        }
      } catch (replyErr) {
        reasoningLogs.push({
          step_name: "v2_reply_generation",
          step_detail: withThreadMeta(
            JSON.stringify({
              artifact_type: "reply_generation_error",
              error: replyErr instanceof Error ? replyErr.message : String(replyErr),
              fallback_to_legacy: V2_TWO_STAGE_FALLBACK_ENABLED,
            }),
            internalThread.threadId,
          ),
          status: "warning",
        });
        if (!V2_TWO_STAGE_FALLBACK_ENABLED) throw replyErr;
        usedTwoStageModel = false;
        shouldRunLegacyCombinedFallback = true;
        fallbackUsed = true;
        fallbackReason = "reply_generation_error";
      }
    }

    if (shouldRunLegacyCombinedFallback && OPENAI_API_KEY) {
      await runLegacyCombinedModel();
    }

    // Fallback hvis AI fejler eller er slået fra.
    if (!aiText) {
      aiText = `Hej,\n\nTak for din besked. Vi vender tilbage hurtigst muligt med en opdatering.`;
    }

    const customerMessage = `${emailData.subject || ""}\n\n${emailData.body || ""}`.trim();
    const languageHint = inferLanguageHint(emailData.subject || "", emailData.body || "");
    let finalText = stripTrailingSignoff(
      enforceLocalizedGreeting(aiText.trim(), customerFirstName, languageHint),
    );
    finalText = await enforceReplyLanguage(customerMessage, finalText, languageHint);
    finalText = ensureFirstLineHasName(finalText, customerFirstName);
    const ongoingReturnContinuation = Boolean(selectedOrder) &&
      (
        /\b(?:replacement|exchange|old headset|faulty headset|new headset|received the new|got the new)\b/i
          .test(`${emailData.subject || ""}\n${emailData.body || ""}`) ||
        /\b(?:erstatning|ombytning|gamle headset|defekt headset|nyt headset|modtaget det nye|fået det nye)\b/i
          .test(`${emailData.subject || ""}\n${emailData.body || ""}`)
      );
    if (hasExchangeSignals(emailData.subject || "", emailData.body || "")) {
      finalText = stripSupportEscalationLines(finalText);
    }
    if (isReturnIntent) {
      finalText = enforceReturnChannelGuard({
        text: finalText,
        languageHint,
        missingDetails: returnDetailsMissing,
        hasKnownOrderContext: Boolean(selectedOrder),
        ongoingReturnContinuation,
      });
      finalText = await enforceReplyLanguage(customerMessage, finalText, languageHint);
    }
    if (trackingIntent && selectedOrder) {
      const trackingKey = pickOrderTrackingKey(selectedOrder);
      const trackingDetail = trackingKey ? trackingDetailsByOrderKey[trackingKey] ?? null : null;
      const trackingName =
        extractOrderFirstName(selectedOrder) || customerFirstName || "there";
      const trackingReplyAi = await buildTrackingReplySameLanguage({
        customerMessage,
        customerFirstName: trackingName,
        threadKey: `${internalThread?.id || ""}|${emailData.messageId || ""}`,
        order: selectedOrder,
        tracking: trackingDetail,
      });
      const baseTrackingText =
        trackingReplyAi ||
        buildTrackingReplyFallback({
          customerFirstName: trackingName,
          order: selectedOrder,
          tracking: trackingDetail,
          threadKey: `${internalThread?.id || ""}|${emailData.messageId || ""}`,
        });
      finalText = await enforceReplyLanguage(customerMessage, baseTrackingText, languageHint);
      finalText = ensureFirstLineHasName(finalText, trackingName);
      finalText = applyTrackingClosingByLanguage(finalText, languageHint);
    }

    const sameChannelGuardResult = guardSameChannelEscalation({
      text: finalText,
      languageHint,
    });
    if (sameChannelGuardResult.changed) {
      finalText = sameChannelGuardResult.text;
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_same_channel_guard",
        {
          artifact_type: "same_channel_guard",
          removed_same_channel_escalation: sameChannelGuardResult.removedSameChannelEscalation,
        },
        internalThread.threadId,
      );
    }

    const replyGuardResult = guardReplyForExecutionState({
      text: finalText,
      executionState: replyStrategyArtifact?.execution_state || executionState,
      languageHint,
    });
    replyContainsConfirmationLanguage = replyGuardResult.containsConfirmationLanguage;
    if (replyGuardResult.downgraded) {
      finalText = stripTrailingSignoff(
        enforceLocalizedGreeting(replyGuardResult.text, customerFirstName, languageHint),
      );
      finalText = ensureFirstLineHasName(finalText, customerFirstName);
      appendStructuredArtifactLog(
        reasoningLogs,
        "v2_reply_guard",
        {
          artifact_type: "reply_guard",
          execution_state: replyStrategyArtifact?.execution_state || executionState,
          downgraded: true,
          reply_contains_confirmation_language: replyContainsConfirmationLanguage,
        },
        internalThread.threadId,
      );
    }

    // Render HTML med konsistent styling og line breaks.
    let htmlBody = formatEmailBody(finalText);

    let internalDraft: any = null;
    let draftId: string | null = null;
    let threadId: string | null = null;
    let automationResults: Array<{
      type: string;
      ok: boolean;
      status?: "success" | "pending_approval" | "partial_failure" | "error";
      orderId?: number;
      payload?: Record<string, unknown>;
      detail?: string;
      error?: string;
    }> = [];

    const internal = internalThread;
    if (!internal.threadId) {
      console.warn("generate-draft-unified: missing internal thread for draft");
    }
    internalDraft = await createInternalDraft({
      userId: ownerUserId,
      workspaceId,
      mailboxId: internal.mailboxId,
      threadId: internal.threadId,
      provider,
      subject: emailData.subject ? `Re: ${emailData.subject}` : "Re:",
      htmlBody,
      textBody: finalText,
    }).catch((err) => {
      console.warn("generate-draft-unified: internal draft failed", err?.message || err);
      return null;
    });
    draftId = internalDraft?.id ?? null;
    threadId = internal.threadId ?? emailData.threadId ?? null;
    const customerEmail = emailData.fromEmail || emailData.from || null;
    const subject = emailData.subject || "";
    const approvalRequiredProposalFlow = isApprovalRequiredProposalFlow({
      validation: actionValidation,
      hasPendingApproval: Boolean(returnActionResult?.status === "pending_approval"),
      executionState: replyStrategyArtifact?.execution_state || executionState,
    });

    if (supabase && (ownerUserId || workspaceId) && threadId) {
      let clearThreadDraftsQuery = supabase
        .from("mail_messages")
        .update({
          ai_draft_text: null,
          updated_at: new Date().toISOString(),
        })
        .eq("thread_id", threadId);
      clearThreadDraftsQuery = workspaceId
        ? clearThreadDraftsQuery.eq("workspace_id", workspaceId)
        : clearThreadDraftsQuery.eq("user_id", ownerUserId);
      const { error: clearThreadDraftsError } = await clearThreadDraftsQuery;
      if (clearThreadDraftsError) {
        console.warn(
          "generate-draft-unified: failed clearing previous thread drafts",
          clearThreadDraftsError.message,
        );
      }
    }

    if (!approvalRequiredProposalFlow && supabase && (ownerUserId || workspaceId) && emailData.messageId) {
      let updateMessageQuery = supabase
        .from("mail_messages")
        .update({
          ai_draft_text: finalText,
          updated_at: new Date().toISOString(),
        })
        .eq("provider", provider)
        .eq("provider_message_id", emailData.messageId);
      updateMessageQuery = workspaceId
        ? updateMessageQuery.eq("workspace_id", workspaceId)
        : updateMessageQuery.eq("user_id", ownerUserId);
      const { error: updateError } = await updateMessageQuery;
      if (updateError) {
        console.warn("generate-draft-unified: failed to store ai draft", updateError.message);
      }
    }

    // Log draft i Supabase til tracking.
    let loggedDraftId: number | null = null;
    if (supabase && threadId) {
      let staleDraftsQuery = supabase
        .from("drafts")
        .update({ status: "superseded" })
        .eq("platform", provider)
        .eq("thread_id", threadId)
        .eq("status", "pending");
      staleDraftsQuery = workspaceId
        ? staleDraftsQuery.eq("workspace_id", workspaceId)
        : staleDraftsQuery.eq("user_id", ownerUserId);
      const { error: staleDraftsError } = await staleDraftsQuery;
      if (staleDraftsError) {
        console.warn(
          "generate-draft-unified: failed to clear stale pending drafts",
          staleDraftsError.message,
        );
      }
      const { data, error } = await supabase
        .from("drafts")
        .insert({
          shop_id: shopId || null,
          workspace_id: workspaceId,
          customer_email: customerEmail,
          subject,
          platform: provider,
          status: "pending",
          kind: approvalRequiredProposalFlow ? "internal_recommendation" : "final_customer_reply",
          execution_state: replyStrategyArtifact?.execution_state || executionState,
          final_reply_generated_at: approvalRequiredProposalFlow ? null : new Date().toISOString(),
          draft_id: draftId,
          thread_id: threadId,
          created_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();
      loggedDraftId = typeof data?.id === "number" ? data.id : null;
      if (error) {
        console.warn("generate-draft-unified: failed to log draft", error.message);
      }
    }

    if (supabase && traceEnabledForRequest && classification.process) {
      try {
        const querySource = `${normalizeForHash(emailData.subject || "")}\n${normalizeForHash(
          emailData.body || "",
        )}`;
        const queryHash = await sha256Hex(querySource);
        const { error: traceError } = await supabase.from("retrieval_traces").insert({
          workspace_id: workspaceId,
          shop_id: shopId,
          draft_id: loggedDraftId != null ? String(loggedDraftId) : (draftId ? String(draftId) : null),
          thread_id: threadId ? String(threadId) : null,
          message_id: emailData.messageId ? String(emailData.messageId) : null,
          category: classification.category ?? null,
          query_hash: queryHash,
          context_budget_tokens: MAX_CONTEXT_TOKENS,
          max_retrieval_chunks: Math.max(1, Math.min(Math.round(MAX_RETRIEVAL_CHUNKS), 10)),
          knowledge_min_similarity: KNOWLEDGE_MIN_SIMILARITY,
          product_min_similarity: PRODUCT_MIN_SIMILARITY,
          included_context_tokens: retrievalTracePayload.included_context_tokens,
          dropped_context_reason: retrievalTracePayload.dropped_context_reason,
          dropped_context_reasons: retrievalTracePayload.dropped_context_reasons,
          policy_summary_included: retrievalTracePayload.policy_summary_included,
          policy_excerpt_included: retrievalTracePayload.policy_excerpt_included,
          policy_summary_tokens: retrievalTracePayload.policy_summary_tokens,
          data: {
            policy_intent: retrievalTracePayload.policy_intent,
            knowledge_hits: retrievalTracePayload.knowledge_hits,
            product_hits: retrievalTracePayload.product_hits,
            dropped_context_reasons: retrievalTracePayload.dropped_context_reasons,
          },
        });
        if (traceError) {
          console.warn("generate-draft-unified: retrieval trace insert failed", traceError.message);
        }
      } catch (traceErr) {
        console.warn("generate-draft-unified: retrieval trace failed", traceErr);
      }
    }

    if (supabase && loggedDraftId && reasoningLogs.length) {
      const now = new Date().toISOString();
      const rows = reasoningLogs.map((log) => ({
        draft_id: loggedDraftId,
        step_name: log.step_name,
        step_detail: withThreadMeta(log.step_detail, threadId),
        status: log.status,
        created_at: now,
      }));
      const { error } = await supabase.from("agent_logs").insert(rows);
      if (error) {
        console.warn("generate-draft-unified: failed to log reasoning", error.message);
      }
    }

    // Udfør godkendte Shopify-actions fra model output.
    if (ownerUserId) {
      const orderIdMap: Record<string, number> = {};
      for (const order of context.orders ?? []) {
        const shopifyId = Number(order?.id ?? 0);
        if (!shopifyId || Number.isNaN(shopifyId)) continue;
        const orderNumber = order?.order_number ?? order?.orderNumber ?? null;
        const name = typeof order?.name === "string" ? order.name.trim() : "";
        const nameKey = name.replace("#", "");
        if (orderNumber) {
          orderIdMap[String(orderNumber)] = shopifyId;
        }
        if (nameKey) {
          orderIdMap[nameKey] = shopifyId;
        }
        orderIdMap[String(shopifyId)] = shopifyId;
      }

      automationResults = await executeAutomationActions({
        supabase,
        supabaseUserId: ownerUserId,
        actions: automationActions,
        automation: context.automation,
        tokenSecret: ENCRYPTION_KEY,
        apiVersion: SHOPIFY_API_VERSION,
        orderIdMap,
      });
      emitDebugLog("generate-draft-unified: automation results", automationResults);
    }
    if (returnActionResult) {
      automationResults = [...automationResults, returnActionResult];
    }

    const blockedAutoResults = automationResults.filter((result) =>
      (result.type === "update_shipping_address" || result.type === "cancel_order") &&
      result.status === "error" &&
      typeof result.error === "string" &&
      result.error.startsWith("Order action blocked:")
    );

    if (blockedAutoResults.length) {
      const blockedReply = await generateBlockedOrderActionReply({
        customerName: customerFirstName || "kunden",
        emailBody: emailData.body || "",
        reasons: blockedAutoResults.map((item) => item.detail || item.error || ""),
        personaInstructions: context.persona.instructions,
      });

      if (blockedReply) {
        finalText = stripTrailingSignoff(
          enforceLocalizedGreeting(blockedReply, customerFirstName, languageHint),
        );
        finalText = await enforceReplyLanguage(customerMessage, finalText, languageHint);
        finalText = ensureFirstLineHasName(finalText, customerFirstName);
        if (isReturnIntent) {
          finalText = enforceReturnChannelGuard({
            text: finalText,
            languageHint,
            missingDetails: returnDetailsMissing,
            hasKnownOrderContext: Boolean(selectedOrder),
            ongoingReturnContinuation: Boolean(selectedOrder),
          });
          finalText = await enforceReplyLanguage(customerMessage, finalText, languageHint);
        }
        htmlBody = formatEmailBody(finalText);

        if (supabase && internalDraft?.id) {
          const { error: updateInternalDraftError } = await supabase
            .from("mail_messages")
            .update({
              body_text: finalText,
              body_html: htmlBody,
              clean_body_text: finalText,
              clean_body_html: htmlBody,
              quoted_body_text: null,
              quoted_body_html: null,
              snippet: finalText.slice(0, 160),
              updated_at: new Date().toISOString(),
            })
            .eq("id", internalDraft.id);
          if (updateInternalDraftError) {
            console.warn(
              "generate-draft-unified: failed to update blocked internal draft",
              updateInternalDraftError.message,
            );
          }
        }

        if (supabase && (ownerUserId || workspaceId) && emailData.messageId) {
          let updateBlockedAiDraftQuery = supabase
            .from("mail_messages")
            .update({
              ai_draft_text: finalText,
              updated_at: new Date().toISOString(),
            })
            .eq("provider", provider)
            .eq("provider_message_id", emailData.messageId);
          updateBlockedAiDraftQuery = workspaceId
            ? updateBlockedAiDraftQuery.eq("workspace_id", workspaceId)
            : updateBlockedAiDraftQuery.eq("user_id", ownerUserId);
          const { error: updateBlockedAiDraftError } = await updateBlockedAiDraftQuery;
          if (updateBlockedAiDraftError) {
            console.warn(
              "generate-draft-unified: failed to store blocked ai draft",
              updateBlockedAiDraftError.message,
            );
          }
        }
      }
    }

    if (supabase && loggedDraftId && automationResults.length) {
      const now = new Date().toISOString();
      const threadMarker = threadId ? ` |thread_id:${threadId}` : "";
      const rows = automationResults.map((result) => ({
        draft_id: loggedDraftId,
        step_name: "Shopify Action",
        step_detail:
          result.status === "pending_approval"
            ? JSON.stringify({
                thread_id: threadId,
                actionType: result.type,
                orderId: result.orderId ?? null,
                payload: result.payload ?? null,
                detail:
                  result.detail ||
                  result.error ||
                  "Automation setting requires approval before execution.",
                reason: result.error || null,
              })
            : result.status === "partial_failure"
            ? `${result.detail || `Partially applied ${result.type.replace(/_/g, " ")}.`}`.trim() +
              threadMarker
            : result.ok
            ? `${result.detail || `Executed ${result.type.replace(/_/g, " ")}.`}`.trim() +
              threadMarker
            : `Failed ${result.type.replace(/_/g, " ")}: ${result.error || "unknown error"}.` +
              threadMarker,
        status:
          result.status === "pending_approval"
            ? "warning"
            : result.status === "partial_failure"
            ? "warning"
            : result.ok
            ? "success"
            : "error",
        created_at: now,
      }));
      const { error } = await supabase.from("agent_logs").insert(rows);
      if (error) {
        console.warn("generate-draft-unified: failed to log automation results", error.message);
      }
    }

    if (ownerUserId && threadId && automationResults.length) {
      await persistThreadActions({
        ownerUserId,
        workspaceId,
        threadId,
        results: automationResults,
      });
    }

    if (supabase && loggedDraftId && approvalRequiredProposalFlow && threadId) {
      let pendingActionQuery = supabase
        .from("thread_actions")
        .select("id")
        .eq("thread_id", threadId)
        .eq("status", "pending")
        .order("updated_at", { ascending: false })
        .limit(1);
      pendingActionQuery = workspaceId
        ? pendingActionQuery.eq("workspace_id", workspaceId)
        : pendingActionQuery.eq("user_id", ownerUserId);
      const { data: pendingAction, error: pendingActionError } = await pendingActionQuery.maybeSingle();
      if (pendingActionError) {
        console.warn(
          "generate-draft-unified: failed to link pending proposal draft to thread action",
          pendingActionError.message,
        );
      } else if (pendingAction?.id) {
        const { error: updateDraftLinkError } = await supabase
          .from("drafts")
          .update({ source_action_id: String(pendingAction.id) })
          .eq("id", loggedDraftId);
        if (updateDraftLinkError) {
          console.warn(
            "generate-draft-unified: failed to update proposal draft source action",
            updateDraftLinkError.message,
          );
        }
      }
    }

    const finalExecutionState: ExecutionState = blockedAutoResults.length
      ? "blocked"
      : automationResults.some((result) => result.status === "success" || result.status === "partial_failure")
      ? "executed"
      : automationResults.some((result) => result.status === "pending_approval")
      ? "pending_approval"
      : replyStrategyArtifact?.execution_state || executionState;
    replyContainsConfirmationLanguage = containsCompletionLanguage(finalText);

    appendStructuredArtifactLog(
      reasoningLogs,
      "v2_generation_outcome",
      {
        artifact_type: "generation_outcome",
        generation_path: fallbackUsed
          ? "two_stage_with_legacy_fallback"
          : usedTwoStageModel
          ? "two_stage"
          : "legacy_combined",
        fallback_used: fallbackUsed,
        fallback_reason: fallbackReason,
        decision_model_success: decisionModelSuccess,
        reply_model_success: replyModelSuccess,
        execution_state: finalExecutionState,
        validated_action_count: actionValidation?.allowed_actions?.length ?? automationActions.length,
        reply_contains_confirmation_language: replyContainsConfirmationLanguage,
      },
      threadId,
    );

    if (supabase && loggedDraftId) {
      const threadMarker = threadId ? ` |thread_id:${threadId}` : "";
      const { error } = await supabase.from("agent_logs").insert({
        draft_id: loggedDraftId,
        step_name: "Context",
        step_detail: `Loaded Store Policies${threadMarker}`,
        status: "info",
        created_at: new Date().toISOString(),
      });
      if (error) {
        console.warn("generate-draft-unified: failed to log policies", error.message);
      }
    }

    emitDebugLog("generate-draft-unified", {
      provider,
      shopId,
      draftId,
      threadId,
    });

    return new Response(JSON.stringify({ success: true, draftId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    const message = err?.message || "Ukendt fejl";
    console.error("generate-draft-unified error:", message);
    return new Response(JSON.stringify({ error: message }), { status });
  }
});
