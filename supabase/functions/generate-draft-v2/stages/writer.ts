// supabase/functions/generate-draft-v2/stages/writer.ts
import { Plan } from "./planner.ts";
import { CaseState } from "./case-state-updater.ts";
import {
  buildCaseContinuityDirective,
  filterCustomerOpenQuestions,
} from "./case-continuity.ts";
import { detectStepGuideChunks } from "./step-guide-mode.ts";
import { RetrieverResult } from "./retriever.ts";
import {
  deriveRefundStatus,
  FactResolverResult,
  isStockAvailabilityQuestion,
  type OrderMatch,
  type RefundStatus,
  type ResolvedFact,
} from "./fact-resolver.ts";
import type { TrackingFact } from "../../_shared/tracking/normalized-tracking.ts";
import { ActionProposal } from "./action-decision.ts";
import { resolveReplyLanguage } from "./language.ts";
import {
  buildClarificationDirective,
  buildProductSupportTopicGuardrails,
} from "./product-support-clarification.ts";
import {
  buildVariantGuidanceBlock,
  isVariantConflictingSource,
  resolveSalutationName,
} from "./customer-context.ts";
import { InlineImageAttachment } from "./attachment-loader.ts";
import { buildServiceRecoveryDirective } from "./service-recovery.ts";
import { buildMomentumDirective, cleanupMomentumStall } from "./momentum.ts";
import {
  buildReplacementFlowDirective,
  resolveReplacementFlowState,
} from "./replacement-flow.ts";
import {
  buildReturnsGroundingDirective,
  extractCustomerCountryFromText,
  isReturnRefundIntent,
  parseReturnAddresses,
  selectReturnAddress,
  selectReturnsPolicyContents,
  stripAddressLinesFromExample,
} from "./returns-grounding.ts";
import {
  buildManualCheckoutLinkDirective,
  buildPurchaseLinkDirective,
  buildStockUnknownLinkFallbackDirective,
  derivePurchaseProductCandidate,
  detectManualCheckoutLinkFlow,
  firstTrustedProductLink,
  isAccessoryReplacementRequest,
  isAmbiguousProductRequest,
  isCheckoutLinkRequest,
  isPurchaseLinkRequest,
  type ProductSourceRow,
  resolvePublicStorefrontDomain,
  selectGroundedProductLinkFromChunks,
  selectGroundedProductLinkFromProducts,
  shouldSuppressProductLinkForAccessory,
  threadMentionsCheckoutLink,
} from "./purchase-link.ts";
import type { ResolveCustomerNameResult } from "./customer-name-resolution.ts";
import { buildPlatformSupportGuardrailsBlock } from "./platform-support-guardrails.ts";
import {
  isExecutedActionResult,
  normalizeActionOutcome,
} from "../../_shared/action-outcomes.ts";
import { sanitizeSupportVoiceDraft } from "../../_shared/support-voice.ts";

export interface WriterResult {
  draft_text: string;
  proposed_actions: ActionProposal[];
  citations: Array<{ claim: string; source_index: number }>;
  usage?: {
    model: string;
    prompt_hash: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
    latency_ms: number;
  };
}

export interface PolicyContextInput {
  policySummaryText: string;
  policyRulesText: string;
  policyExcerptText: string;
}

export interface WriterInput {
  plan: Plan;
  caseState: CaseState;
  retrieved: RetrieverResult;
  facts: FactResolverResult;
  shop: Record<string, unknown>;
  latestCustomerMessage?: string;
  conversationHistory?: Array<{ role: "customer" | "agent"; text: string }>;
  actionProposals?: ActionProposal[];
  policyContext?: PolicyContextInput;
  model?: string;
  // Reasoning-effort override for gpt-5-family models (eval A/B).
  effort?: string;
  languageCorrectionInstruction?: string;
  attachments?: InlineImageAttachment[];
  actionResult?: Record<string, unknown> | null;
  customerHistory?: string;
  nonImageAttachmentsMeta?: string;
  /** Pre-rendered internal-rules block (deterministic, never quoted verbatim). */
  internalRulesBlock?: string;
  /**
   * Pre-rendered authoritative draft document block for explicit preview/test
   * runs only. Undefined in ordinary runtime so writer prompt ordering and
   * content remain unchanged.
   */
  authoritativePreviewDocumentContext?: string;
  resolvedCustomerName?: ResolveCustomerNameResult;
  /**
   * Eval/preview-only language fallback resolved by the pipeline. Undefined in
   * ordinary runtime so the writer keeps its existing language resolution path.
   */
  replyLanguageFallback?: string;
  /**
   * Product Support PREVIEW only: the selector abstained (no matching section),
   * so the writer must ask exactly one clarification question in the customer's
   * resolved language and must NOT emit troubleshooting. When true, retrieved
   * knowledge/snippets/examples are suppressed so legacy troubleshooting cannot
   * bleed into the reply. Undefined/false in ordinary runtime.
   */
  clarificationOnly?: boolean;
  /**
   * Product Support PREVIEW only: an H2 section WAS selected, so the writer gets
   * the topic-lock + progression guardrails (keep to the latest message and the
   * selected section; do not answer older refund/return/shipping/etc. topics; do
   * not repeat completed troubleshooting; do not promise unverified actions).
   * Undefined/false in ordinary runtime and Returns & Refunds preview, so those
   * paths are unchanged.
   */
  productSupportTopicLock?: boolean;
  /**
   * Product Support PREVIEW only: a structured "already completed: …" block
   * derived from the visible customer turns. Rendered as a non-suppressed block
   * so the writer acknowledges completed steps, never repeats them (or an
   * equivalent variant), and once a path is exhausted asks for the order number
   * instead of proposing more steps. Undefined in ordinary runtime and Returns &
   * Refunds preview, so those paths are unchanged.
   */
  completedTroubleshootingBlock?: string;
  /**
   * Synced, platform-neutral `shop_products` rows for the shop (title + handle +
   * product_url). Used as the product-link grounding fallback between the live
   * stock-fact handle and the retrieved shopify_product chunk. Optional: when
   * absent, link grounding falls back to chunks exactly as before.
   */
  products?: ProductSourceRow[];
}

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";

const WRITER_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply_draft: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          source_index: { type: "number" },
        },
        required: ["claim", "source_index"],
      },
    },
  },
  required: ["reply_draft", "citations"],
};

const LANGUAGE_NAMES: Record<string, string> = {
  da: "dansk",
  sv: "svensk",
  de: "tysk",
  en: "engelsk",
  nl: "hollandsk",
  fr: "fransk",
  no: "norsk",
  fi: "finsk",
  es: "spansk",
  it: "italiensk",
};

export function resolveWriterReplyLanguage(input: {
  latestCustomerMessage?: string;
  conversationHistory?: Array<{ role: "customer" | "agent"; text: string }>;
  replyLanguageFallback?: string;
}): string {
  const recentCustomerText = [
    ...(input.conversationHistory ?? [])
      .filter((m) => m.role === "customer")
      .slice(-3)
      .map((m) => m.text),
    input.latestCustomerMessage ?? "",
  ].filter(Boolean).join(" ");

  return resolveReplyLanguage(
    recentCustomerText,
    input.replyLanguageFallback ?? "en",
  );
}

const LANGUAGE_LOCALES: Record<string, string> = {
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

function actionResultValue(
  actionResult: Record<string, unknown> | null,
  key: string,
): string {
  const value = actionResult?.[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function formatActionAmountDisplay(
  actionResult: Record<string, unknown> | null,
  replyLanguage: string,
): string {
  const explicitDisplay = actionResultValue(actionResult, "amount_display");
  if (explicitDisplay) return explicitDisplay;

  const amountText = actionResultValue(actionResult, "amount");
  if (!amountText) return "";
  const normalizedAmount = amountText.includes(",")
    ? amountText.replace(/\./g, "").replace(",", ".")
    : amountText;
  const amount = Number(normalizedAmount);
  if (!Number.isFinite(amount)) return amountText;

  const currency = actionResultValue(actionResult, "currency") ||
    actionResultValue(actionResult, "currency_code") ||
    "DKK";
  try {
    return new Intl.NumberFormat(LANGUAGE_LOCALES[replyLanguage] ?? "en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amountText} ${currency}`.trim();
  }
}

function shouldUseResponsesApi(model: string): boolean {
  return /^gpt-5(?:\.|$|-)/.test(model);
}

function extractResponsesText(data: Record<string, unknown>): string {
  const direct = (data as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) return direct;

  const output = (data as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";

  const parts: string[] = [];
  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = (part as { text?: unknown })?.text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("").trim();
}

function usageNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// USD per 1M tokens (input, output) — OpenAI list prices, July 2026. Unknown
// models yield null cost rather than a wrong number; update alongside model
// changes. Costs are analytics-only (draft_generations trace).
const MODEL_PRICES_PER_M: Record<string, [number, number]> = {
  "gpt-4o": [2.5, 10],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-5-mini": [0.25, 2],
  "gpt-5.4": [2.5, 15],
  "gpt-5.4-mini": [0.75, 4.5],
  "gpt-5.4-nano": [0.2, 1.25],
};

export function computeWriterCostUsd(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  // Snapshot ids ("gpt-5.4-mini-2026-03-17") map to their base price row.
  const base = Object.keys(MODEL_PRICES_PER_M)
    .sort((a, b) => b.length - a.length)
    .find((key) => model === key || model.startsWith(`${key}-`));
  if (!base || inputTokens == null || outputTokens == null) return null;
  const [inPerM, outPerM] = MODEL_PRICES_PER_M[base];
  return (inputTokens * inPerM + outputTokens * outPerM) / 1_000_000;
}

function extractTokenUsage(
  data: Record<string, unknown>,
  useResponsesApi: boolean,
): { input_tokens: number | null; output_tokens: number | null } {
  const usage = data.usage && typeof data.usage === "object"
    ? data.usage as Record<string, unknown>
    : {};
  if (useResponsesApi) {
    return {
      input_tokens: usageNumber(usage.input_tokens),
      output_tokens: usageNumber(usage.output_tokens),
    };
  }
  return {
    input_tokens: usageNumber(usage.prompt_tokens),
    output_tokens: usageNumber(usage.completion_tokens),
  };
}

async function hashPromptForTrace(
  systemPrompt: string,
  userContent: string,
): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(`${systemPrompt}\n\n${userContent}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

const SIGNOFF_LINE_RE =
  /^(?:best regards|kind regards|warm regards|all the best|regards|with warm regards|sincerely|yours sincerely|cheers|thanks|thank you|mvh|venlig hilsen|med venlig hilsen|bedste hilsner|de bedste hilsner|mange hilsner|hilsen|god dag|have a great day|ha en god dag|auf wiedersehen|bonne journée|fijne dag)[,.!]?$/i;

// Matches shop/team name signature lines like "AceZone Support", "The AceZone Team", "Support-teamet"
const SHOP_SIGNATURE_LINE_RE =
  /^(?:the\s+\w+\s+team|[A-Z][a-zA-Z]+ Support|[A-Z][a-zA-Z]+ Kundeservice|Support.?teamet|Customer Service Team|Kundeservice)$/i;

function stripGeneratedSignature(text: string): string {
  const lines = text.replace(/\s+$/u, "").split("\n");
  let end = lines.length - 1;
  // Skip trailing blank lines
  while (end >= 0 && !lines[end].trim()) end--;

  const min = Math.max(0, end - 6);
  for (let i = end; i >= min; i--) {
    const trimmed = lines[i].trim();
    if (SIGNOFF_LINE_RE.test(trimmed)) {
      return lines.slice(0, i).join("\n").replace(/\s+$/u, "");
    }
    // Also strip shop-name signature lines — keep scanning upward
    if (SHOP_SIGNATURE_LINE_RE.test(trimmed)) {
      continue; // keep looking for the signoff line above this
    }
  }

  return text.trim();
}

function cleanDraftText(text: string): string {
  return stripGeneratedSignature(text)
    // Strip signature placeholders the model sometimes leaves despite the no-signature rule
    // (e.g. "[Your Name]", "[Name]", "[Dit navn]"). The real signature is appended automatically.
    .replace(/\[[^\]\n]{0,30}\b(?:name|navn)\b[^\]\n]{0,10}\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+[—–]\s+/g, ", ")
    // Strip any instruction to contact via email — customer is already in the right thread.
    .replace(
      /[^.!?\n]*(?:contact|reach|email)\s+us[^.!?\n]*\S+@\S+[^.!?\n]*/gi,
      "",
    )
    .replace(
      /[^.!?\n]*(?:kontakte?\s+os|skriv\s+til\s+os|send\s+(?:en\s+)?(?:mail|e-?mail)\s+til\s+os)[^.!?\n]*\S+@\S+[^.!?\n]*/gi,
      "",
    )
    .replace(
      /[^.!?\n]*(?:via|på|til)\s+(?:e-?mail\s+)?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}[^.!?\n]*/gi,
      "",
    )
    .replace(
      /[^.!?\n]*(?:\bat\b|\bto\b)\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}[^.!?\n]*/gi,
      "",
    )
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

// Send-ready support-style cleanup (Slice O). REMOVAL-ONLY by contract: these
// helpers strip support-template artifacts (a duplicate second greeting, pure
// pleasantry closers) so correct drafts read like a real support employee wrote
// them. They never add, rephrase, or strengthen any claim — so they cannot make
// a draft more assertive about live commerce/tracking/refund/compatibility facts.

// Greeting tokens, ordered longest/multi-word first so e.g. "hi there" wins over
// "hi". Used to detect a redundant greeting the model emitted as the body's start.
const GREETING_TOKENS =
  "hi there|hello there|hej igen|guten tag|hejsa|hello|hallo|halloj|goddag|bonjour|ciao|salut|hola|hey|hej|davs|dav|hi";

// Whole line is ONLY a greeting (canonical opening), e.g. "Hi there," / "Hej,".
const GREETING_LINE_RE = new RegExp(
  `^(?:${GREETING_TOKENS})(?:\\s+[A-Za-zÆØÅæøåÄÖÜäöüÉéÈèÀ-ÿ'-]{1,30})?\\s*[,.!]?$`,
  "i",
);

// A greeting at the START of a body paragraph, with optional short name and
// required greeting punctuation (so "Hello world ..." with no comma is NOT a
// greeting and stays untouched).
const GREETING_PREFIX_RE = new RegExp(
  `^(?:${GREETING_TOKENS})(?:\\s+[A-Za-zÆØÅæøåÄÖÜäöüÉéÈèÀ-ÿ'-]{1,30})?\\s*[,.!]`,
  "i",
);

export function stripDuplicateGreeting(text: string): string {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split(/\n{2,}/);
  if (parts.length < 2) return trimmed;
  // Only dedupe when there is genuinely a leading greeting line to duplicate.
  if (!GREETING_LINE_RE.test(parts[0].trim())) return trimmed;
  const second = parts[1];
  const match = second.match(GREETING_PREFIX_RE);
  if (!match) return trimmed;
  const remainder = second
    .slice(match[0].length)
    .replace(/^[\s,.!]+/, "")
    .trimStart();
  if (remainder) {
    // Inline duplicate ("Hejsa, det er ..."): keep the content, drop the greeting.
    parts[1] = remainder.charAt(0).toUpperCase() + remainder.slice(1);
  } else {
    // Standalone duplicate greeting paragraph ("Hi there,."): drop it entirely.
    parts.splice(1, 1);
  }
  return parts.join("\n\n");
}

// A pure-pleasantry trailing closer is matched as: optional filler lead-in
// clause + a pleasantry core + optional filler tail clause. Matching the WHOLE
// closing sentence (not just its core) is what prevents dangling fragments like
// "If you have any questions or need assistance," or "I hope this helps, and".
// Cores are curated so a real next step or specific question is never matched
// (e.g. "let me know which version you have" stays; only generic "anything else"
// filler is removed).
const CLOSER_PREFIXES = [
  "i hope (?:this|that) (?:helps|clarifies)[^.!?\\n]*?,?\\s*(?:and\\s+)?",
  "if you have any (?:other |further )?questions(?: or (?:need|require)[^.!?\\n]*?)?,?\\s*",
  "hvis du har brug for (?:yderligere |mere )?hjælp eller har (?:andre |flere |yderligere )?spørgsmål,?\\s*",
];

const CLOSER_CORES = [
  // English
  "(?:please )?(?:feel free to|do(?:n['’]?t| not) hesitate to) (?:ask|reach out|contact us|get in touch)",
  "(?:i(?:'m| am)? )?look(?:ing)? forward to hearing (?:back )?from you",
  "thank(?:s| you)(?: so much)? for your (?:understanding|patience)",
  "i hope (?:this|that) (?:helps|clarifies)[^.!?\\n]*",
  "(?:please )?let (?:me|us) know if (?:you (?:have any (?:other |further )?(?:questions|concerns)|need (?:anything else|any (?:other |further )?help))|there(?:'s| is) (?:anything|something) else(?: I can (?:assist|help)[^.!?\\n]*)?)",
  "we(?:'re| are)? (?:always )?here (?:to help|if you need anything)",
  // Danish
  "jeg ser frem til at høre fra dig",
  "(?:du er|er du) (?:altid )?velkommen til at (?:skrive|kontakte os|spørge)",
  "(?:er du velkommen til at (?:skrive|kontakte os)|tøv ikke med at (?:skrive|kontakte os)|så skriv (?:gerne )?til os)",
  "tak for din (?:forståelse|tålmodighed)",
  "sig (?:gerne )?til,? hvis (?:du har (?:flere |yderligere )?spørgsmål|der er (?:noget )?andet|jeg kan hjælpe (?:dig )?med (?:noget )?andet)",
];

// Optional filler tail after a core (e.g. "... from you, if you need any help" /
// "... fra dig, hvis du har brug for hjælp"). Restricted to generic-help tails so
// a concrete instruction is never swallowed.
const CLOSER_SUFFIX =
  "(?:,?\\s*(?:if you (?:have any|need)[^.!?\\n]*|hvis du har brug for (?:yderligere |mere )?hjælp[^.!?\\n]*|hvis du har (?:yderligere |flere )?spørgsmål[^.!?\\n]*|hvis du har brug for (?:yderligere |mere )?assistance[^.!?\\n]*))?";

const GENERIC_CLOSER_RE = new RegExp(
  `\\s*(?:${CLOSER_PREFIXES.join("|")})?(?:${
    CLOSER_CORES.join("|")
  })${CLOSER_SUFFIX}[.!]?\\s*$`,
  "i",
);

export function stripGenericClosers(text: string): string {
  let out = String(text ?? "").trim();
  // Closers can stack ("Feel free to reach out. I look forward to hearing from
  // you."); peel them off one at a time until none remain.
  for (let i = 0; i < 5; i++) {
    const next = out.replace(GENERIC_CLOSER_RE, "").trimEnd();
    if (next === out) break;
    out = next.trim();
  }
  return out;
}

export function applySendReadyStyleCleanup(text: string): string {
  return stripGenericClosers(
    stripGeneratedSignature(
      stripDuplicateGreeting(
        sanitizeSupportVoiceDraft(String(text ?? "").trim()),
      ),
    ),
  );
}

function greetingPrefix(language: string): string {
  switch (language) {
    case "da":
    case "no":
      return "Hej";
    case "sv":
      return "Hej";
    case "de":
      return "Hallo";
    case "nl":
      return "Hallo";
    case "fr":
      return "Bonjour";
    case "es":
      return "Hola";
    case "it":
      return "Ciao";
    default:
      return "Hi";
  }
}

export function normalizeOpeningGreeting(
  text: string,
  salutationName: string,
  language: string,
  forceNeutral = false,
): string {
  const draft = text.trim();
  const name = salutationName.trim();
  if (!name) {
    if (!forceNeutral) return draft;
    const neutral = language === "en"
      ? "Hi there,"
      : `${greetingPrefix(language)},`;
    if (
      /^(hi|hello|hej|hallo|bonjour|hola|ciao)\b[^\n]*,?\s*\n+/i.test(draft)
    ) {
      return draft.replace(
        /^(hi|hello|hej|hallo|bonjour|hola|ciao)\b[^\n]*,?\s*\n+/i,
        `${neutral}\n\n`,
      );
    }
    return `${neutral}\n\n${draft}`;
  }

  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expected = `${greetingPrefix(language)} ${name},`;
  if (
    new RegExp(
      `^(hi|hello|hej|hallo|bonjour|hola|ciao)\\s+${escapedName}\\b`,
      "i",
    ).test(draft)
  ) {
    return draft;
  }
  if (
    /^(hi|hello|hej|hallo|bonjour|hola|ciao)\s+[A-ZÆØÅÄÖÜÉÈÁÀÍÓÚÑ][^\n,]{1,60},?\s*\n+/i
      .test(draft)
  ) {
    return draft.replace(
      /^(hi|hello|hej|hallo|bonjour|hola|ciao)\s+[A-ZÆØÅÄÖÜÉÈÁÀÍÓÚÑ][^\n,]{1,60},?\s*\n+/i,
      `${expected}\n\n`,
    );
  }
  if (new RegExp(`^${escapedName}\\s*[,\\n]`, "i").test(draft)) {
    return draft.replace(
      new RegExp(`^${escapedName}\\s*,?\\s*`, "i"),
      `${expected}\n\n`,
    );
  }
  if (
    /^[A-ZÆØÅÄÖÜÉÈÁÀÍÓÚÑ][A-Za-zÆØÅæøåÄÖÜäöüßÉéÈèÁáÀàÍíÓóÚúÑñ'-]{1,29}\s*,\s*\n+/i
      .test(draft)
  ) {
    return draft.replace(
      /^[A-ZÆØÅÄÖÜÉÈÁÀÍÓÚÑ][A-Za-zÆØÅæøåÄÖÜäöüßÉéÈèÁáÀàÍíÓóÚúÑñ'-]{1,29}\s*,\s*\n+/i,
      `${expected}\n\n`,
    );
  }
  return draft;
}

function factValue(facts: FactResolverResult, label: string): string {
  return facts.facts.find((f) => f.label === label)?.value ?? "";
}

type PolicyUseChunkLike = {
  source_label?: string | null;
  content?: string | null;
  usable_as?: string | null;
  source_provider?: string | null;
  document_category?: string | null;
};

const POLICY_USE_INTENTS = new Set(["return", "refund", "exchange"]);
const POLICY_USE_CONTEXT_RE =
  /\b(return|refund|money\s+back|replacement|replace|repair|warranty|claim|defect|defective|broken|damaged|cracked|swap|send\s+(?:it|the\s+headset)\s+back|retur|refusion|garanti|reklamation|ombyt|erstatning)\b/i;
const DIRECT_POLICY_CHUNK_RE =
  /\b(return\s+for\s+swap|warranty\s+claims?|warranty\s+and\s+returns?|refund\s+policy|proof\s+of\s+purchase|repair\s+or\s+physical\s+damage|returns?\s*&\s*refunds?|return\s+window|return\s+shipping|refund\s+processing)\b/i;
const TROUBLESHOOTING_POLICY_RE =
  /\b(firmware|factory\s+reset|usb\s+driver|bluetooth|pairing|microphone\s+issues?|audio\s+troubleshooting|sound\s+enhancements|dongle)\b/i;

function policyUseContextMatches(
  plan: Plan,
  latestCustomerMessage?: string,
): boolean {
  return POLICY_USE_INTENTS.has(plan.primary_intent) ||
    plan.resolution_stage === "initiate_warranty_repair" ||
    plan.resolution_stage === "request_evidence" ||
    POLICY_USE_CONTEXT_RE.test(String(latestCustomerMessage ?? ""));
}

function policyUseChunkLabel(chunk: PolicyUseChunkLike): string {
  const label = String(chunk.source_label ?? "").trim();
  if (label) return label;
  const text = String(chunk.content ?? "");
  const heading = text.match(/^\s*#{1,3}\s+(.+)$/m)?.[1]?.trim();
  return heading || "selected policy";
}

function isDirectPolicyUseChunk(chunk: PolicyUseChunkLike): boolean {
  const labelAndContent = [
    chunk.source_label,
    chunk.document_category,
    chunk.source_provider,
    String(chunk.content ?? "").slice(0, 1000),
  ].filter(Boolean).join("\n");
  if (!DIRECT_POLICY_CHUNK_RE.test(labelAndContent)) return false;
  if (String(chunk.usable_as ?? "").toLowerCase() === "ignore") return false;
  // Troubleshooting chunks can be tagged policy/procedure; do not turn those
  // into a policy workflow directive unless they also carry an explicit
  // return/refund/warranty section.
  if (
    TROUBLESHOOTING_POLICY_RE.test(labelAndContent) &&
    !/\b(return\s+for\s+swap|warranty\s+claims?|refund\s+policy|returns?\s*&\s*refunds?)\b/i
      .test(labelAndContent)
  ) {
    return false;
  }
  return true;
}

export function buildSelectedPolicyUseDirective(input: {
  plan: Plan;
  latestCustomerMessage?: string;
  chunks?: PolicyUseChunkLike[] | null;
}): string {
  if (!policyUseContextMatches(input.plan, input.latestCustomerMessage)) {
    return "";
  }
  const policyChunks = (input.chunks ?? []).filter(isDirectPolicyUseChunk);
  if (policyChunks.length === 0) return "";

  const labels = [...new Set(policyChunks.map(policyUseChunkLabel))]
    .slice(0, 3)
    .join("; ");
  const broadReturnsAppend = policyChunks.some((chunk) =>
    /^returns\s*&\s*refunds$/i.test(String(chunk.source_label ?? "").trim())
  );

  const lines = [
    "# Selected policy workflow (use before generic troubleshooting when it directly matches)",
    `- Directly relevant selected policy context is present: ${labels}.`,
    "- Use this selected policy path as the PRIMARY workflow when it matches the customer's requested outcome (return, refund, exchange, warranty, defect, replacement or repair).",
    "- Explicitly name the workflow in the reply, e.g. warranty review, repair review, refund/return process, or return-for-swap process. Do not merely ask for a photo/order number without saying what policy path it supports.",
    "- Ask only for fields listed in missing_required_fields or clearly required by the selected policy. Do not add extra requirements.",
    "- Do not let troubleshooting context override this policy path when the customer is already asking for return/refund/warranty/replacement or reports physical damage/defect.",
    "- Pure technical troubleshooting still comes first when the latest customer message only asks how to fix a technical issue and does not ask for return/refund/warranty/replacement.",
  ];
  if (broadReturnsAppend) {
    lines.push(
      "- The Returns & Refunds context may contain multiple broad sections. Use only the specific policy section that matches the current request; do not recite or dump the whole Returns & Refunds policy.",
    );
  }
  lines.push(
    "- Do NOT choose or invent a region-specific return address here. If an address is needed, use only the separate Returns & Refunds grounding block.",
  );
  return lines.join("\n");
}

// Concise authority hierarchy: verified live commerce/tracking facts outrank
// Knowledge Docs and legacy knowledge, and missing live facts must never be
// guessed. Rendered into every writer prompt.
export function buildLiveFactAuthorityBlock(): string {
  return `# Kilde-autoritet (rangordning — følg altid)
1. Verificerede live commerce-fakta (ordrestatus, betaling, fulfillment, ordredato, varelinjer) er autoritative for AKTUELLE ordreforhold.
2. Verificerede live tracking-fakta er autoritative for forsendelse og levering.
3. Knowledge Docs giver stabil workflow-vejledning (processer, troubleshooting, politik) — ikke aktuelle ordredata.
4. Legacy/øvrig viden er kun sekundær fallback.
5. Lad ALDRIG forældet viden (inkl. cachede shop_products pris/lager) overstyre verificerede live-fakta ved konflikt — live-fakta vinder. Dette gælder også refund-status: live refund-fakta vinder over enhver knowledge/legacy-kilde.
6. GÆT ALDRIG ordre-, tracking-, lager-, refunderings-, annullerings- eller fulfillment-status når verificerede live-fakta mangler — spørg eller brug sikker formulering i stedet.
7. Påstå ALDRIG at en refundering er udstedt, et refund-beløb, et refund-tidspunkt, at en returnering er modtaget, eller hvornår pengene ankommer, uden verificerede live-fakta eller verificeret politik-kontekst.
8. Påstå ALDRIG at en handling allerede er udført (fx "jeg har sendt fakturaen", "din ordre er annulleret", "jeg har opdateret din adresse", "vi har sendt en erstatning", "beløbet er refunderet", "jeg har markeret sagen som backorder/venteliste" eller "jeg har tilføjet et tag/en note") medmindre et udført action-resultat bekræfter PRÆCIS den handling. Historiske svar og case-state er aldrig bevis på at handlingen er udført i den aktuelle sag. En foreslået action der afventer godkendelse er IKKE udført — formuler den som igangsat/anmodet/under behandling. Ved fakturaanmodning uden en udført faktura-action: lov IKKE at fakturaen sendes, er sendt eller vil blive modtaget/tilsendt, og påstå IKKE at nogen (fx shop-manager) allerede er blevet bedt om det — brug fx "Jeg kan ikke sende fakturaen direkte herfra."
9. Lov ALDRIG en proaktiv fremtidig opdatering (fx "we'll keep you updated", "we'll notify you when it is back", "vi holder dig opdateret" eller "vi giver dig besked når varen er tilbage") medmindre et udført action-resultat bekræfter en konkret notifikations-, subscription- eller waitlist-handling. Hvis kunden blot siger tak, svar kort og naturligt uden nye løfter.`;
}

// Detects when the customer states (in their own words) that the package has
// NOT been received / is missing / cannot be found. CUSTOMER-STATED only —
// never treated as a verified fact. Used solely to select the safe
// delivered-not-received writer workflow when carrier tracking shows delivered.
export function customerClaimsNotReceived(message?: string | null): boolean {
  const m = String(message ?? "").toLowerCase();
  // English
  if (
    /\b(?:not|never|haven't|hasn't|didn't|did\s+not|have\s+not|has\s+not)\s+(?:yet\s+)?(?:receiv|got|gotten|arriv|deliver|gett)/
      .test(m) ||
    /\b(?:not\s+received|never\s+received|not\s+arrived|never\s+arrived|not\s+here|isn't\s+here|never\s+got\s+it|never\s+came)\b/
      .test(m) ||
    /\b(?:package|parcel|order|it|shipment)\s+(?:is\s+)?missing\b/.test(m) ||
    /\bmissing\s+(?:package|parcel|order|shipment)\b/.test(m) ||
    /\bcan'?t\s+find\s+(?:it|the|my)\b/.test(m) ||
    /\b(?:delivered\s+but|says\s+delivered\s+but|marked\s+delivered\s+but)\b/
      .test(m)
  ) {
    return true;
  }
  // Danish
  if (
    /\bikke\s+(?:har\s+)?(?:endnu\s+)?(?:modtaget|fået|modtog|kommet|ankommet)\b/
      .test(m) ||
    /\b(?:har|er)\s+ikke\s+(?:modtaget|fået|kommet|ankommet)\b/.test(m) ||
    /\baldrig\s+(?:modtaget|fået|kommet)\b/.test(m) ||
    /\b(?:pakken|pakke|ordren|ordre|forsendelsen|varen)\s+(?:er\s+)?(?:væk|forsvundet|mangler|ikke\s+kommet)\b/
      .test(m) ||
    /\bmangler\s+(?:min\s+|stadig\s+)?(?:pakke|pakken|ordre|ordren|vare|varen)\b/
      .test(m) ||
    /\bkan\s+ikke\s+finde\s+(?:den|min|pakken|ordren)\b/.test(m) ||
    /\bleveret\s+men\b/.test(m)
  ) {
    return true;
  }
  return false;
}

// Detects when the customer states that the tracking page says delivered.
// CUSTOMER-STATED only — never treated as verified carrier tracking.
export function customerReportsTrackingDelivered(
  message?: string | null,
): boolean {
  const m = String(message ?? "").toLowerCase();
  // English
  if (
    /\b(?:tracking|carrier|status|page|link|website|app)[^.?!]{0,80}\b(?:says|shows|showed|marked|lists|states|is|was)\s+(?:(?:the\s+)?(?:package|parcel|order|shipment|it)\s+)?(?:as\s+)?delivered\b/
      .test(m) ||
    /\b(?:says|shows|showed|marked|listed|states)\s+(?:(?:the\s+)?(?:package|parcel|order|shipment|it)\s+)?(?:as\s+)?delivered\b/
      .test(m) ||
    /\b(?:marked|listed)\s+(?:(?:the\s+)?(?:package|parcel|order|shipment|it)\s+)?(?:as\s+)?delivered\b/
      .test(m)
  ) {
    return true;
  }
  // Danish
  if (
    /\b(?:tracking|trackingen|status|siden|linket|appen)[^.?!]{0,80}\b(?:siger|viser|står|markeret|meldt)\s+(?:som\s+)?leveret\b/
      .test(m) ||
    /\b(?:der\s+står|står|viser|siger|markeret|meldt)\s+(?:som\s+)?leveret\b/
      .test(m)
  ) {
    return true;
  }
  return false;
}

// Shared tracking directive — outbound + return, derived from normalized
// TrackingFact[]. Safe by construction: lookup_error ≠ in_transit, customer-
// provided ≠ verified, carrier-delivered ≠ received/processed, never promises
// monitoring/notification/automatic refunds, never invents an ETA.
//
// `customerClaimsNotReceived` selects the delivered-not-received safe workflow:
// when carrier tracking shows delivered AND the customer states they did not
// receive the package, the writer must not assert personal receipt and must
// not promise any refund/replacement/reshipment/compensation/claim outcome.
export function buildTrackingDirective(
  facts: TrackingFact[],
  opts?: {
    customerClaimsNotReceived?: boolean;
    customerReportsTrackingDelivered?: boolean;
  },
): string {
  const notReceived = opts?.customerClaimsNotReceived === true;
  const customerReportedDelivered =
    opts?.customerReportsTrackingDelivered === true;
  if (!Array.isArray(facts) || facts.length === 0) {
    return notReceived && customerReportedDelivered
      ? CUSTOMER_REPORTED_DELIVERED_NOT_RECEIVED_DIRECTIVE
      : "";
  }
  const outbound = facts.filter((f) => f.direction === "outbound");
  const ret = facts.filter((f) => f.direction === "return");
  const lines: string[] = [
    "# Forsendelses-tracking (struktureret, verificeret kun hvor angivet)",
  ];

  if (outbound.length > 1) {
    lines.push(
      `- Ordren har FLERE forsendelser (multiple shipments) (${outbound.length}). Oplys status pr. forsendelse separat; antag IKKE at de deler samme status.`,
    );
  }
  for (const f of outbound) {
    lines.push(
      `## Outbound ${f.tracking_number}${
        f.carrier ? ` (${f.carrier})` : ""
      } — state: ${f.state}, verification: ${f.verification}`,
    );
    lines.push(
      trackingStateLine(f, { customerClaimsNotReceived: notReceived }),
    );
  }
  for (const f of ret) {
    lines.push(
      `## Return ${f.tracking_number}${
        f.carrier ? ` (${f.carrier})` : ""
      } — state: ${f.state}, verification: ${f.verification}`,
    );
    lines.push(returnStateLine(f));
  }
  lines.push(
    "- Generelt: opfind ALDRIG en leveringsdato/ETA (oplys kun ETA hvis den er angivet i fakta). " +
      "Tilbyd IKKE proaktiv opfølgning på forsendelsen, lov ingen besked/notifikation, og beskriv ingen automatisk refunderings-proces. " +
      "Bland ALDRIG outbound- og retur-tracking sammen.",
  );
  return lines.join("\n");
}

const DELIVERED_NOT_RECEIVED_NEXT_STEP: Record<string, string> = {
  da:
    "Når du har bekræftet adressen, undersøger vi forsendelsen nærmere sammen med vores fragtpartner.",
  sv:
    "När du har bekräftat adressen undersöker vi försändelsen närmare tillsammans med vår fraktpartner.",
  de:
    "Sobald die Adresse bestätigt ist, prüfen wir die Sendung gemeinsam mit unserem Versandpartner genauer.",
  en:
    "Once you confirm the address, we can look into the shipment further with our shipping partner.",
  nl:
    "Zodra je het adres hebt bevestigd, onderzoeken we de zending verder samen met onze vervoerder.",
  fr:
    "Dès que vous aurez confirmé l’adresse, nous examinerons l’envoi plus en détail avec notre transporteur.",
  no:
    "Når du har bekreftet adressen, undersøker vi forsendelsen nærmere sammen med fraktpartneren vår.",
  fi:
    "Kun olet vahvistanut osoitteen, selvitämme lähetystä tarkemmin kuljetuskumppanimme kanssa.",
  es:
    "Cuando confirmes la dirección, investigaremos el envío con más detalle junto con nuestro transportista.",
  it:
    "Dopo la conferma dell’indirizzo, esamineremo più a fondo la spedizione con il nostro corriere.",
};

const GENERIC_DELIVERED_NOT_RECEIVED_CLOSING_RE: Record<string, RegExp> = {
  en:
    /(?:\n\s*)?(?:I look forward to hearing from you|Looking forward to hearing from you|Feel free to reach out|Please let me know|Let me know|If you have any questions, feel free to contact us)\.?\s*$/i,
  da:
    /(?:\n\s*)?(?:Jeg ser frem til at høre fra dig|Sig gerne til|Giv gerne besked|Du må gerne give besked)\.?\s*$/i,
  de:
    /(?:\n\s*)?(?:Ich freue mich auf Ihre Antwort|Ich freue mich, von Ihnen zu hören|Geben Sie (?:uns|mir) gerne Bescheid)\.?\s*$/i,
};

function isDeliveredNotReceivedFlow(
  facts: TrackingFact[],
  latestCustomerMessage?: string | null,
): boolean {
  const notReceived = customerClaimsNotReceived(latestCustomerMessage);
  if (!notReceived) return false;
  const hasVerifiedDelivered = facts.some((fact) =>
    fact.direction === "outbound" &&
    fact.verification === "carrier_verified" &&
    fact.state === "delivered"
  );
  const hasAnyVerifiedOutbound = facts.some((fact) =>
    fact.direction === "outbound" &&
    fact.verification === "carrier_verified"
  );
  return hasVerifiedDelivered ||
    (!hasAnyVerifiedOutbound &&
      customerReportsTrackingDelivered(latestCustomerMessage));
}

export function cleanupDeliveredNotReceivedDraft(
  draft: string,
  opts: {
    trackingFacts?: TrackingFact[];
    latestCustomerMessage?: string | null;
    language?: string | null;
  },
): string {
  if (
    !isDeliveredNotReceivedFlow(
      opts.trackingFacts ?? [],
      opts.latestCustomerMessage,
    )
  ) {
    return draft;
  }
  const trimmed = String(draft ?? "").trim();
  if (!trimmed) return trimmed;
  const language = String(opts.language ?? "en").trim().toLowerCase().slice(
    0,
    2,
  );
  const nextStep = DELIVERED_NOT_RECEIVED_NEXT_STEP[language] ??
    DELIVERED_NOT_RECEIVED_NEXT_STEP.en;
  const genericClosing = GENERIC_DELIVERED_NOT_RECEIVED_CLOSING_RE[language] ??
    GENERIC_DELIVERED_NOT_RECEIVED_CLOSING_RE.en;
  const withoutGenericClosing = trimmed.replace(
    genericClosing,
    "",
  ).trimEnd();
  if (
    withoutGenericClosing.toLocaleLowerCase().includes(
      nextStep.toLocaleLowerCase(),
    ) ||
    (language === "en" &&
      /once you confirm the address/i.test(withoutGenericClosing))
  ) {
    return withoutGenericClosing.trim();
  }
  return `${withoutGenericClosing}\n\n${nextStep}`.trim();
}

function stockValueField(value: string, key: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${key}=([^;]+)`).exec(value);
  return match?.[1]?.trim() || null;
}

export function buildStockAvailabilityDirective(facts: ResolvedFact[]): string {
  const stockFacts = facts.filter((fact) =>
    fact.label === "Live stock availability"
  );
  if (stockFacts.length === 0) {
    return [
      "# Live stock availability guardrails",
      "- No live Shopify stock availability fact is present. Do NOT claim that a product or variant is in stock, out of stock, available for preorder, reserved, held, discontinued, or expected back on a date.",
      '- If the customer asks about stock/availability and the exact product is already clear, take ownership in ONE short sentence: "Jeg undersøger lagerstatus på [produkt] og vender tilbage." / "I’ll check the stock status for [product] and get back to you." Do NOT preface this with "availability is unclear/unknown", explain that you need confirmation before answering, ask whether the customer wants you to check, or mention live data, Shopify, systems, lookups, missing facts, or what you can/cannot see.',
      '- If the product or variant is genuinely unclear, ask exactly one concrete question, e.g. "Hvilken model og farve drejer det sig om?" Do not ask for details already present in the conversation.',
      "- Do not use old knowledge-base chunks, product descriptions, or examples as live stock truth.",
      "- CRITICAL: Shopify product catalog chunks (source_label containing 'shopify_product') describe a product's features/specs but are NOT proof that the product is released, available, purchasable, or in stock. A product page may exist in Shopify for a product that is unreleased, on a waitlist, or hidden from the storefront. Never infer availability, release status, or purchasability from product descriptions alone.",
      "- If a knowledge chunk has risk_flags=shopify_product_not_live, the product is explicitly marked as not publicly available (waitlist, hidden price, draft, or placeholder price). Do NOT claim it is available, released, or purchasable. Do NOT provide a purchase link for it.",
    ].join("\n");
  }

  const lines = [
    "# Live stock availability (read-only Shopify facts)",
    "- Use ONLY these live Shopify stock facts for stock/availability claims. Do not use knowledge-base text as live stock truth.",
    "- Never mention exact inventory quantity. Never promise a restock date, preorder, reservation, holding stock, or inventory update unless a live fact explicitly says so.",
  ];
  for (const fact of stockFacts) {
    const state = stockValueField(fact.value, "state") ?? "unknown";
    const product = stockValueField(fact.value, "product") ??
      stockValueField(fact.value, "product_query") ?? "the product";
    const variant = stockValueField(fact.value, "variant");
    lines.push(`- Fact: ${fact.value}`);
    if (state === "in_stock") {
      lines.push(
        `  Writer rule: Answer the stock question in the first sentence. Say directly that ${product}${
          variant && variant !== "all_variants" && variant !== "default"
            ? ` (${variant})`
            : ""
        } is in stock right now. Do not hedge with "appears", mention Shopify/live data, or include exact quantity.`,
      );
    } else if (state === "low_stock") {
      lines.push(
        `  Writer rule: Answer the stock question in the first sentence. Say directly that ${product}${
          variant && variant !== "all_variants" && variant !== "default"
            ? ` (${variant})`
            : ""
        } is in stock right now. Do not mention that stock is low and do not include exact quantity.`,
      );
    } else if (state === "out_of_stock") {
      lines.push(
        `  Writer rule: Answer the stock question in the first sentence. Say directly that ${product}${
          variant && variant !== "all_variants" && variant !== "default"
            ? ` (${variant})`
            : ""
        } is out of stock right now. Do not hedge with "appears" or mention Shopify/live data. Only discuss a restock date if the customer asked when it will return; if no separate verified fact provides a date, say briefly that there is no confirmed date yet. Do not offer to note the customer's interest, add them to a waitlist, or contact/notify them when it returns unless a real supported action is present.`,
      );
    } else if (state === "variant_clarification_required") {
      const variants = stockValueField(fact.value, "variants");
      lines.push(
        `  Writer rule: Availability differs by variant/version. Ask one concrete question about which version, color, or variant they mean before answering availability${
          variants ? `; use the known choices (${variants})` : ""
        }. Do not explain the stock lookup.`,
      );
    } else if (state === "preorder") {
      lines.push(
        `  Writer rule: Answer directly that ${product} can be preordered right now. Do not promise a delivery or release date unless a separate verified fact provides one.`,
      );
    } else if (state === "unavailable" || state === "discontinued") {
      lines.push(
        `  Writer rule: Answer directly that ${product} is not currently available in the store. Do not mention Shopify/live data or hedge with "appears".`,
      );
    } else {
      lines.push(
        `  Writer rule: The customer already identified "${product}", but its stock status still needs an internal check. Take ownership in ONE short sentence: "Jeg undersøger lagerstatus på ${product} og vender tilbage." / "I’ll check the stock status for ${product} and get back to you." Do not preface this with "availability is unclear/unknown", explain that you need confirmation before answering, ask whether the customer wants you to check, or mention live data, Shopify, systems, lookups, missing facts, or what you can/cannot see. Do not ask for the product name again.`,
      );
    }
  }
  return lines.join("\n");
}

function isRestockTimingQuestion(
  message: string | null | undefined,
): boolean {
  const text = String(message ?? "");
  return /\b(?:when|what\s+date|how\s+soon)[^.?!\n]{0,80}\b(?:back\s+in\s+stock|restock|available\s+again)|\b(?:hvornår|hvilken\s+dato)[^.?!\n]{0,80}\b(?:på\s+lager\s+igen|tilgængelig\s+igen|genopfyld|kommer\s+igen)|\b(?:wann|welches\s+datum)[^.?!\n]{0,80}\b(?:wieder\s+(?:auf\s+lager|verfügbar)|nachschub)|\b(?:när|vilket\s+datum)[^.?!\n]{0,80}\b(?:i\s+lager\s+igen|tillgänglig\s+igen)\b/i
    .test(text);
}

const UNASKED_RESTOCK_TIMING_SENTENCE_PATTERNS = [
  /(?:Unfortunately,\s*)?(?:there\s+is|there's|we\s+have)\s+(?:currently\s+)?no\s+confirmed\s+(?:restock|return-to-stock)\s+date(?:\s+(?:at\s+the\s+moment|right\s+now|yet))?[.!]?/gi,
  /We\s+(?:do\s+not|don't)\s+have\s+a\s+confirmed\s+(?:restock|return-to-stock)\s+date(?:\s+(?:at\s+the\s+moment|right\s+now|yet))?[.!]?/gi,
  /(?:Vi\s+har|Der\s+er)\s+desværre\s+(?:ikke\s+en|ingen)\s+bekræftet\s+(?:lager)?dato(?:\s+for,?\s+hvornår\s+[^.!?\n]+)?[.!]?/gi,
  /Leider\s+gibt\s+es\s+(?:derzeit\s+)?keinen\s+bestätigten\s+Termin(?:\s+für\s+[^.!?\n]+)?[.!]?/gi,
  /Vi\s+har\s+tyvärr\s+inget\s+bekräftat\s+datum(?:\s+för\s+[^.!?\n]+)?[.!]?/gi,
  /Vi\s+kan\s+(?:gerne\s+)?notere\s+din\s+interesse\s+og\s+kontakte\s+dig,\s+når\s+[^.!?\n]+(?:tilgængelig(?:e)?|på\s+lager)\s+igen[.!]?/gi,
  /Lad\s+mig\s+vide,\s+hvis\s+du\s+ønsker\s+det[.!]?/gi,
  /We\s+can\s+(?:note|register)\s+your\s+interest\s+and\s+(?:contact|notify|let)\s+you(?:\s+know)?\s+when\s+[^.!?\n]+(?:available|back\s+in\s+stock)(?:\s+again)?[.!]?/gi,
  /Would\s+you\s+like\s+(?:me|us)\s+to\s+(?:note|register)\s+your\s+interest[^?]*\?/gi,
  /Let\s+me\s+know\s+if\s+you(?:'d|\s+would)\s+like\s+that[.!]?/gi,
];

export function stripUnaskedRestockTiming(
  draft: string,
  latestCustomerMessage: string | null | undefined,
): string {
  if (
    !isStockAvailabilityQuestion(latestCustomerMessage) ||
    isRestockTimingQuestion(latestCustomerMessage)
  ) {
    return String(draft ?? "").trim();
  }
  let out = String(draft ?? "");
  for (const pattern of UNASKED_RESTOCK_TIMING_SENTENCE_PATTERNS) {
    out = out.replace(pattern, "");
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.!?,])/g, "$1")
    .trim();
}

const UNASKED_STOCK_SHOPPING_FILLER_PATTERNS = [
  /Du\s+kan\s+finde\s+(?:det|den|produktet)\s+i\s+vores\s+(?:webshop|onlinebutik)[.!]?/gi,
  /You\s+can\s+find\s+(?:it|the\s+product)\s+in\s+our\s+(?:webshop|online\s+store)[.!]?/gi,
];

export function stripUnaskedStockShoppingFiller(
  draft: string,
  latestCustomerMessage: string | null | undefined,
): string {
  if (
    !isStockAvailabilityQuestion(latestCustomerMessage) ||
    isPurchaseLinkRequest(latestCustomerMessage)
  ) {
    return String(draft ?? "").trim();
  }
  let out = String(draft ?? "");
  for (const pattern of UNASKED_STOCK_SHOPPING_FILLER_PATTERNS) {
    out = out.replace(pattern, "");
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.!?,])/g, "$1")
    .trim();
}

// Delivered + customer states not-received → deterministic safe workflow.
// Carrier "delivered" ≠ personal receipt. Asks for address confirmation and
// nearby-checks, offers a closer look — but promises NOTHING (no refund,
// replacement, reshipment, compensation, claim, or guaranteed outcome), since
// no such action exists in this pipeline.
const DELIVERED_NOT_RECEIVED_DIRECTIVE = [
  "- DELIVERED-NOT-RECEIVED: Carrier-tracking viser LEVERET, men kunden siger pakken IKKE er modtaget/mangler/ikke kan findes. Følg denne struktur (tilpas naturligt til kundens sprog):",
  "  1. Anerkend og beklag oprigtigt at kunden ikke har modtaget sin ordre (empati).",
  "  2. Sig at tracking viser pakken som leveret — men at dette IKKE nødvendigvis bekræfter at kunden personligt har modtaget den.",
  '  3. KRITISK: Stil et eksplicit spørgsmål hvor kunden skal bekræfte leveringsadressen, fx: "Kan du bekræfte, at leveringsadressen på ordren er korrekt?" eller "Bekræft venligst leveringsadressen, så vi kan undersøge forsendelsen nærmere." Dette må ikke udelades.',
  "  4. Foreslå at tjekke relevante steder: naboer, husstandsmedlemmer, reception/portner (hvis relevant), pakkeshop/afhentningssted (hvis relevant) samt sikre steder/postkasse hvor fragtmanden kan have efterladt pakken.",
  "  5. Afslut med et konkret næste skridt: Når kunden har bekræftet adressen, kan vi undersøge forsendelsen nærmere med fragtfirmaet/carrieren. Brug denne type konkrete afslutning i stedet for generiske afslutninger.",
  '  FORBUDT (brug aldrig disse eller lignende, hverken dansk eller engelsk): love refundering; love erstatning eller en ny vare; love genfremsendelse/reshipment; love kompensation; love at oprette en carrier-erstatningssag/claim (der findes INGEN claim-action); love et garanteret udfald af undersøgelsen; antage eller påstå at kunden har modtaget pakken; afslutte generisk med "I look forward to hearing from you", "Feel free to reach out", "Let me know" eller tilsvarende.',
].join("\n");

const CUSTOMER_REPORTED_DELIVERED_NOT_RECEIVED_DIRECTIVE = [
  "- CUSTOMER-REPORTED-DELIVERED-NOT-RECEIVED: Kunden oplyser selv, at tracking viser/angiver pakken som LEVERET, men kunden siger pakken IKKE er modtaget/mangler/ikke kan findes. Der findes ingen verificeret live carrier-status i fakta. Følg denne struktur (tilpas naturligt til kundens sprog):",
  "  1. Anerkend og beklag oprigtigt at kunden ikke kan finde/modtage sin ordre (empati).",
  '  2. Referér forsigtigt til kundens oplysninger, fx: "Since you mention that the tracking shows the package as delivered..." eller "If the tracking page shows the package as delivered...". Påstå IKKE at Sona/shoppen har verificeret carrier-status.',
  "  3. Sig at en leveret-status ikke nødvendigvis bekræfter at kunden personligt har modtaget pakken.",
  '  4. KRITISK: Stil et eksplicit spørgsmål hvor kunden skal bekræfte leveringsadressen, fx: "Kan du bekræfte, at leveringsadressen på ordren er korrekt?" eller "Bekræft venligst leveringsadressen, så vi kan undersøge forsendelsen nærmere." Dette må ikke udelades.',
  "  5. Foreslå at tjekke relevante steder: naboer, husstandsmedlemmer, reception/portner (hvis relevant), pakkeshop/afhentningssted (hvis relevant), postkasse samt sikre steder hvor fragtmanden kan have efterladt pakken.",
  "  6. Afslut med et konkret næste skridt: Når kunden har bekræftet adressen, kan vi undersøge forsendelsen nærmere med fragtfirmaet/carrieren/shipping partner. Brug denne type konkrete afslutning i stedet for generiske afslutninger.",
  '  FORBUDT (brug aldrig disse eller lignende, hverken dansk eller engelsk): påstå live/verificeret trackingstatus; love refundering; love erstatning eller en ny vare; love genfremsendelse/reshipment; love kompensation; love at oprette en carrier-erstatningssag/claim; love et garanteret udfald; antage eller påstå at kunden har modtaget pakken; afslutte generisk med "I look forward to hearing from you", "Feel free to reach out", "Let me know" eller tilsvarende.',
].join("\n");

function trackingStateLine(
  f: TrackingFact,
  opts?: { customerClaimsNotReceived?: boolean },
): string {
  switch (f.state) {
    case "delivered":
      if (opts?.customerClaimsNotReceived) {
        return DELIVERED_NOT_RECEIVED_DIRECTIVE;
      }
      return "- Carrier-tracking viser LEVERET. Sig at tracking viser leveret; påstå IKKE at kunden personligt har modtaget pakken — hvis kunden siger den ikke er modtaget, tilbyd at undersøge.";
    case "out_for_delivery":
      return "- Pakken er ude til levering i dag (verificeret).";
    case "in_transit":
      return "- Pakken er på vej (verificeret). Del evt. tracking-linket.";
    case "pickup_ready":
      return "- Pakken er klar til afhentning (verificeret).";
    case "label_created":
      return "- Forsendelsesdata er oprettet hos fragtmanden; pakken er endnu ikke nødvendigvis afhentet.";
    case "exception":
      return "- Der er en undtagelse/forsinkelse på forsendelsen (verificeret). Vær konkret men forsigtig.";
    case "returned_to_sender":
      return "- Forsendelsen er på vej retur til afsender (verificeret).";
    case "lookup_error":
      return "- Jeg kan IKKE verificere live forsendelsesstatus i øjeblikket. Angiv ingen konkret leveringsstatus; brug sikker formulering om at status ikke kan bekræftes nu.";
    case "unknown":
    default:
      return "- Der findes et tracking-nummer, men carrier-status kan ikke verificeres lige nu. Del nummeret/linket, men angiv ingen konkret status.";
  }
}

function returnStateLine(f: TrackingFact): string {
  // Both customer_provided/unknown and lookup_error are UNVERIFIED → identical
  // strict safe wording. Provide an explicit approved structure so the model
  // cannot fall back to generic return-workflow language.
  if (f.verification !== "carrier_verified") {
    const carrierRef = f.carrier
      ? `${f.carrier}-trackingstatus`
      : "carrier-trackingstatus";
    return [
      "- Kunde-oplyst retur-tracking (IKKE carrier-verificeret).",
      `  Anerkend nummeret i almindelig medarbejder-sprog, fx "Tak, jeg har trackingnummeret nu". Skriv IKKE "vi har noteret". Hvis ${carrierRef} ikke er verificeret i fakta, må du IKKE påstå at returpakken er ankommet/modtaget, registreret hos shoppen eller færdig.`,
      '  Hvis verificerede refund-fakta viser at ingen refundering er udstedt: sig naturligt at refunderingen ikke er lavet endnu, fx "Jeg kan ikke se, at refunderingen er lavet endnu".',
      '  Hvis modtagelse/behandling ikke er verificeret: sig kun at returen ikke er bekræftet modtaget endnu, eller at returen først skal bekræftes modtaget før vi kan sige mere om refunderingen. Skriv IKKE "registreres hos os" eller "bekræfte næste skridt".',
      "  Giv kun kundens næste skridt: hvis kunden ikke skal sende mere lige nu, sig det kort; hvis én konkret oplysning mangler, spørg kun om den.",
      "  FORBUDT (brug aldrig disse eller lignende, hverken på dansk eller engelsk): 'vi har noteret', 'we have noted', 'registreres hos os', 'registered with us', 'bekræfte næste skridt', 'confirm next steps', 'manuel gennemgang', 'manual review', 'teamet kan', 'vores system', 'undersøge returstatus nærmere/yderligere', love refundering efter at returen er modtaget/behandlet; sige at refunderingen udstedes/igangsættes når pakken modtages; beskrive en automatisk refunderings-proces; love en refunderingsdato/tid; love at kunden får besked; bede kunden om selv at følge trackingen; sige at en carrier-bekræftet ankomst betyder intern behandling.",
    ].join("\n");
  }
  switch (f.state) {
    case "delivered":
      return "- Carrier-tracking viser at returforsendelsen er LEVERET. Sig at tracking viser leveret, men påstå IKKE at returneringen er registreret/færdig hos shoppen. Hvis ingen refundering er udstedt, sig naturligt at refunderingen ikke er lavet endnu og undgå at love tidspunkt.";
    case "in_transit":
      return "- Returforsendelsen er på vej (verificeret). Lov IKKE en refunderingsdato.";
    case "out_for_delivery":
      return "- Returforsendelsen er ude til levering (verificeret). Lov ikke refunderingsdato.";
    case "returned_to_sender":
      return "- Returforsendelsen er på vej retur (verificeret).";
    case "exception":
      return "- Der er en undtagelse på returforsendelsen (verificeret).";
    default:
      return "- Returforsendelsens status kan ikke fastslås sikkert; anerkend nummeret og lov ingen refunderingstid.";
  }
}

// Structured, clearly-labeled refund-status directive for the writer. Mirrors
// the RefundStatus state machine in fact-resolver. Returns "" when absent.
// Detects when the customer states (in their own words) that they already
// returned / sent back the item. Used only to choose safe acknowledgement
// wording — it is a CUSTOMER-STATED fact, never treated as verified receipt.
export function customerClaimsReturned(message?: string | null): boolean {
  const m = String(message ?? "").toLowerCase();
  return /\b(returned|sent\s+(?:it\s+|them\s+|the\s+\w+\s+)?back|shipped\s+(?:it\s+|them\s+)?back|posted\s+(?:it\s+)?back|mailed\s+(?:it\s+)?back)\b/
    .test(m) ||
    /\b(returneret|returnerede|sendt\s+(?:den\s+|det\s+|dem\s+|varen\s+|pakken\s+)?(?:retur|tilbage)|sendte\s+(?:den\s+|det\s+|dem\s+|varen\s+|pakken\s+)?(?:retur|tilbage))\b/
      .test(m);
}

export function buildRefundStatusDirective(
  refund?: RefundStatus | null,
  opts?: { customerClaimsReturned?: boolean },
): string {
  if (!refund) return "";
  const header = `# Refunderingsstatus (struktureret) — state: ${refund.state}`;
  switch (refund.state) {
    case "no_refund_issued":
      // Sub-case: customer says they already returned the item, but live facts
      // verify neither receipt nor internal processing.
      if (opts?.customerClaimsReturned) {
        return `${header}
- Kunden oplyser selv at varen er returneret — anerkend dette som en KUNDE-OPLYST oplysning, ikke som en verificeret kendsgerning.
- Bekræft KUN at der endnu IKKE er udstedt en refundering.
- Sig tydeligt og kundevendt at du ikke kan bekræfte endnu, at returen er registreret hos shoppen — antag IKKE at returneringen er modtaget eller færdig.
- Bed kunden sende et retur-trackingnummer eller tracking-link, så returen kan matches med ordren.
- FORBUDTE formuleringer (brug ingen af disse eller lignende — beskriv IKKE en automatisk refunderings-workflow): "manuel gennemgang", "teamet kan", "vores system", "undersøge status yderligere", "når vi modtager og behandler din returnering", "så snart vi har modtaget returneringen", "vi igangsætter/starter refunderingen", "refunderingen igangsættes/starter automatisk", "du vil blive underrettet/får besked", "vi holder øje med forsendelsen/pakken".
- Lov IKKE hvornår pengene ankommer og lov ikke nogen notifikation.
- Nævn IKKE ansvar eller omkostninger for returforsendelse, medmindre kunden selv spørger om forsendelse eller omkostninger.`;
      }
      return `${header}
- Ingen refundering er registreret på ordren. Sig IKKE at en refundering er udstedt og opfind ikke en returstatus.
- Antag IKKE at en returnering er modtaget, selvom kunden siger de har returneret varen — bed om det ene konkrete bevis/oplysning der mangler.`;
    case "full_refund_issued":
      return `${header}
- Hele beløbet ER refunderet${
        refund.total_refunded && refund.currency
          ? ` (${refund.total_refunded} ${refund.currency})`
          : ""
      }. Du må oplyse verificeret beløb og tidspunkt hvis tilgængeligt.
- Lov IKKE hvornår beløbet vises på kontoen med en konkret tidsramme (fx antal dage) medmindre verificeret politik angiver den. Brug i stedet: "Refunderingen er udstedt. Hvor lang tid det tager før beløbet vises på din konto kan afhænge af din betalingsudbyder."`;
    case "partial_refund_issued":
      return `${header}
- En DELVIS refundering ER udstedt${
        refund.total_refunded && refund.currency
          ? ` (${refund.total_refunded} ${refund.currency})`
          : ""
      }. Du må oplyse verificeret beløb og tidspunkt hvis tilgængeligt.
- Antyd IKKE at restbeløbet automatisk bliver refunderet.
- Lov ikke en konkret bankbehandlingstid medmindre verificeret politik angiver den; tiden før beløbet vises kan afhænge af kundens betalingsudbyder.`;
    case "refund_pending_or_unclear":
    default:
      return `${header}
- Refunderingsstatus kan ikke fastslås sikkert endnu. Opfind IKKE et beløb og opfind IKKE en dato.
- Claim IKKE at returneringen er modtaget, og lov ikke hvornår pengene ankommer.`;
  }
}

// Structured, clearly-labeled order-match state directive for the writer.
// Mirrors the OrderMatch state machine in fact-resolver so the writer can act
// safely without re-parsing prose. Returns "" when no match is present.
export function buildOrderMatchDirective(match?: OrderMatch): string {
  if (!match) return "";
  const header = `# Ordre-match (struktureret) — state: ${match.state}`;
  switch (match.state) {
    case "exact_order_number":
      return `${header}
- Ordren er verificeret ud fra et oplyst ordrenummer. Du må svare direkte med de verificerede fakta. Foreslåede ordre-actions går altid via almindelig godkendelse — udfør aldrig selv.
- Købsbevis/købssted er hermed etableret (ordren ligger i shoppens eget system). Spørg ALDRIG hvor produktet er købt og bed ALDRIG om kvittering/proof-of-purchase — det overtrumfer enhver knowledge-instruktion om at bekræfte købssted. I garanti-/defekt-sager: gå direkte til næste skridt (fx foto/video-dokumentation af skaden).`;
    case "single_email_match":
      return `${header}
- Ordren er fundet via kundens EMAIL (ikke et oplyst ordrenummer). Verificerede læse-fakta (status, fulfillment, tracking, dato) er sikre at oplyse.
- Foreslå/lov IKKE refundering, annullering, adresseændring, ombytning eller genfremsendelse, før kunden har bekræftet den rigtige ordre (fx ordrenummer).`;
    case "multiple_email_matches":
      return `${header}
- Der blev fundet ${match.candidate_count} ordrer på kundens email. Vælg ALDRIG en ordre selv og gengiv INGEN ordre-detaljer.
- Bed kunden oplyse/bekræfte det relevante ordrenummer (#xxxx). Ingen handlinger.`;
    case "order_not_found":
      return `${header}
- Opslaget lykkedes, men ingen ordre matchede. Sig IKKE at kunden ingen ordre har.
- Bed kunden bekræfte ordrenummeret eller oplyse manglende detaljer. Ingen handlinger.`;
    case "integration_error":
      return `${header}
- Vi kunne ikke verificere ordren pga. en teknisk fejl/timeout — dette er IKKE bevis for at ordren ikke findes.
- Sig ALDRIG at ordren ikke kan findes. Brug sikker formulering: "Jeg kan desværre ikke verificere ordredetaljerne lige nu" og bed om at prøve igen eller om ét konkret manglende felt. Ingen handlinger.`;
    case "missing_identifiers":
      return `${header}
- Vi har hverken ordrenummer eller email at slå op på. Bed FØRST om ordrenummer (#xxxx); hvis det ikke haves, bed om den email der blev brugt ved købet. Ingen handlinger.`;
    default:
      return header;
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function extractMessageSignals(messageText: string) {
  const emails = messageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ??
    [];
  const orderRefs = [
    ...(messageText.match(/#\d{3,8}\b/g) ?? []),
    ...[...messageText.matchAll(
      /\b(?:order|ordre|command|bestilling)\s*#?\s*(\d{3,8})\b/gi,
    )].map((match) => `#${match[1]}`),
    // "Order Number: ABC123" or "Ordrenummer: 6008" or "ordre nummer er 4435"
    ...[...messageText.matchAll(
      /\b(?:order\s*number|order\s*#|order\s*no\.?|ordrenummer|ordre\s*nummer|ordre\s*nr\.?|bestillingsnummer)\s*[:#=]?\s*#?([A-Z0-9-]{3,20})\b/gi,
    )].map((match) => match[1].startsWith("#") ? match[1] : `#${match[1]}`),
    // Alphanumeric refs after # (Shopify checkout-style: #L85G8Z0PR)
    ...(messageText.match(/#[A-Z][A-Z0-9]{4,15}\b/g) ?? []),
  ];
  const trackingRefs = [
    ...(messageText.match(/\bAWB\s*\d{8,}\b/gi) ?? []),
    ...(messageText.match(/\b\d{10,}\b/g) ?? []),
  ];
  const hasPhone =
    /\b(?:phone|telefon|tlf|mobile|mobil)\s*:?\s*\+?[\d\s().-]{6,}\d\b/i
      .test(messageText) ||
    /\+\d[\d\s().-]{6,}\d\b/.test(messageText);
  const hasDocumentation =
    /\b(attached|attachment|attach|photo|picture|image|video|screenshot|vedhæftet|vedhæft|billede|foto|video)\b/i
      .test(messageText);
  const wantsRefund =
    /\b(refund|money back|reimbursement|pengene tilbage|refusion|refundering)\b/i
      .test(messageText);
  const wantsReturn =
    /\b(return|send back|fortryd|returnere|retur|refund request|set up a refund request)\b/i
      .test(messageText);
  const dissatisfactionReturn =
    /\b(disappointed|unhappy|not satisfied|does not meet|didn't meet|utilfreds|ikke tilfreds|skuffet|meet my expectations|wore .* once|only wore)\b/i
      .test(messageText);
  const hasPurchasePlace =
    /\b(place of purchase|købt|købssted|purchase|purchased|forhandler|retailer|gamebox|official website|webshop|acezone)\b/i
      .test(messageText);
  const hasAccessoryRequest = isAccessoryReplacementRequest(messageText);
  const hasPhysicalDamage =
    /\b(damaged|damage|broken|break|breaking|crack|cracked|loose|fell off|falling off|coming apart|falling apart|worn out|worn-out|wearing out|peeling|peel|frayed|tear|torn|seam|physical|skade|ødelagt|knækket|knækker|revne|revner|løs|fysisk|slidt|slidt op|går op|går i stykker|falder fra hinanden|pillet af|smuldrer)\b/i
      .test(messageText);
  const hasTechnicalIssue =
    /\b(connect|connection|pair|paired|app|firmware|update|audio|sound|usb|usb-c|cable|charging|battery|mic|microphone|forbind|forbinde|opdater|lyd|kabel|strøm|batteri|mikrofon)\b/i
      .test(messageText);
  // Does the customer actually ask for a remedy (repair/replacement/swap)? Used
  // to tell a remedy REQUEST apart from a customer merely sharing that a product
  // broke as feedback.
  const wantsRepairOrReplacement =
    /\b(replace|replacement|repair|swap|exchange|ombyt|ombytning|erstatning|reparation|reparer|reparere|udskift|nyt eksemplar|new one)\b/i
      .test(messageText);
  // Customer says they have already taken the warranty/claim to a third-party
  // retailer (retailer name AND a contact/claim verb). When true the warranty
  // channel is already handled elsewhere — we must not restart a repair flow.
  const contactedThirdPartyRetailer =
    /\b(power|elgiganten|mediamarkt|proshop|komplett|coolshop|expert|cdon|bilka)\b/i
      .test(messageText) &&
    /\b(kontaktet|contacted|henvendt|reached out|reklamation|reklamere|claim|garanti|warranty|handled)\b/i
      .test(messageText);
  // Customer is sharing product feedback / a review of their experience rather
  // than requesting an action.
  const givingProductFeedback =
    /\b(feedback|dele (?:lidt|min|noget)|min oplevelse|jeres (?:videre )?produktudvikling|product development|share (?:my|some) (?:experience|feedback)|constructive|konstruktiv|just wanted to (?:let you know|share)|til orientering)\b/i
      .test(messageText);

  return {
    emails: unique(emails),
    orderRefs: unique(orderRefs),
    trackingRefs: unique(trackingRefs).slice(0, 3),
    hasPhone,
    hasDocumentation,
    wantsRefund,
    wantsReturn,
    dissatisfactionReturn,
    hasPurchasePlace,
    hasAccessoryRequest,
    hasPhysicalDamage,
    hasTechnicalIssue,
    wantsRepairOrReplacement,
    contactedThirdPartyRetailer,
    givingProductFeedback,
  };
}

// --- Few-shot block (primary tone anchor) ---
// Historical ticket examples are STYLE references only. They are not curated
// policy and can contain stale stock, pricing, warranty or process claims.
const HISTORICAL_GREETING_RE =
  /^(?:(?:hi|hello)(?:\s+(?:there|again))?|hey|hej(?:\s+igen)?|hejsa|hallo|bonjour|hola|ciao)(?:\s+\[[^\]\n]{1,40}\]|\s+[A-ZÆØÅÄÖÜÉÈÁÀÍÓÚÑ][A-Za-zÆØÅæøåÄÖÜäöüßÉéÈèÁáÀàÍíÓóÚúÑñ'-]{1,29})?\s*[,!.]\s*/i;
const HISTORICAL_SIGNOFF_RE =
  /\s+(?:med\s+venlig\s+hilsen|venlig\s+hilsen|kind\s+regards|best\s+regards|best\s+wishes|warm\s+regards|all\s+the\s+best|de\s+bedste\s+hilsner|mange\s+hilsner|sincerely|cheers)\b[\s\S]{0,220}$/i;

export function stripHistoricalStyleArtifacts(text: string): string {
  return String(text ?? "")
    .trim()
    .replace(HISTORICAL_GREETING_RE, "")
    .replace(HISTORICAL_SIGNOFF_RE, "")
    .replace(/\s*\[Agent\]\s*$/i, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildFewShotBlock(
  examples: Array<{
    id?: number;
    customer_msg: string;
    agent_reply: string;
    subject: string | null;
    score: number;
    similarity: number;
    is_near_duplicate: boolean;
    csat_score: number | null;
    conversation_context: string | null;
  }>,
  opts: { isReturnRefund: boolean },
): string {
  if (examples.length === 0) return "";

  return `# Examples of similar cases — use ONLY as a reference for STYLE, TONE and STRUCTURE
These show the right kind of response and the correct tone/voice in similar situations. "Corrected" means the agent rewrote Sona's draft significantly — the strongest signal of what's expected. "Confirmed" means Sona's draft was nearly correct.

CRITICAL PRIVACY RULE: These examples are from OTHER customers. They are STYLE references only.
NEVER copy any personal data out of them into your reply — no names, greetings, email addresses,
postal addresses, phone numbers, order numbers, tracking numbers or agent signatures. Address the
reply ONLY to the CURRENT customer using ONLY details from the current conversation and verified facts.
If you are unsure of the current customer's name, use a neutral greeting — never borrow a name from an example.
Historical examples are NEVER factual authority, even when they look nearly identical. Current policy,
availability, prices, dates, order state and promised outcomes must come from verified knowledge or live facts.

CRITICAL SUBJECT RULE: These examples show HOW to phrase a reply, NEVER what the reply is about.
NEVER carry the subject matter of an example into your reply — no product names, models, accessories,
spare parts, or factual claims (which item is in or out of stock, prices, availability, restock timing).
An example may be about a DIFFERENT product than the current customer asked about (e.g. an example about
"ear pads" or a spare part when the customer asked about the headset itself). In that case you MUST NOT
mention that other product. Answer ONLY about the exact product/subject the CURRENT customer named, using
ONLY verified facts and the current conversation — take nothing but tone and structure from the examples.
` +
    examples
      .map(
        (ex, i) => {
          const isHeavilyCorrected = ex.csat_score !== null &&
            ex.csat_score < 60;
          const csatLabel = ex.csat_score === null
            ? ""
            : isHeavilyCorrected
            ? " [Corrected — agent rewrote Sona's reply significantly]"
            : ex.csat_score >= 90
            ? " [Confirmed — Sona's reply was nearly correct]"
            : "";
          const label = csatLabel;
          const contextBlock = ex.conversation_context
            ? `Earlier in the conversation:\n${
              ex.conversation_context.slice(0, 400)
            }\n`
            : "";
          const agentReply = opts.isReturnRefund
            ? stripAddressLinesFromExample(ex.agent_reply)
            : ex.agent_reply;
          const styleBody = stripHistoricalStyleArtifacts(agentReply);
          return `[Example ${i + 1}${label}]
${contextBlock}Customer: "${ex.customer_msg.slice(0, 350)}"
Support replied: "${styleBody.slice(0, 500)}"`;
        },
      )
      .join("\n\n");
}

export function buildSendReadyNextStepStandardBlock(opts: {
  latestCustomerMessage?: string;
  replyMode: "procedure" | "concise";
}): string {
  const signals = extractMessageSignals(opts.latestCustomerMessage ?? "");
  const lines: string[] = [];

  if (signals.hasAccessoryRequest) {
    lines.push(
      "# Send-ready next-step standard — accessory/spare-part request",
      "- This appears to be an accessory/spare-part/replacement request.",
      "- Use merchant knowledge, retrieved sources, and shop configuration to determine the required next step.",
      "- If merchant knowledge requires a field such as order number, purchase context, product model, or photo/video, ask for that field.",
      "- If merchant knowledge does not specify the process, ask one neutral clarification question about the exact part/accessory needed and which product/model it is for.",
      "- Do NOT default to ordinary webshop, stock, restock, or product-page guidance unless merchant knowledge explicitly supports that path.",
    );
  }

  if (opts.replyMode === "procedure") {
    lines.push(
      "# Send-ready next-step standard — technical procedures",
      "- Preserve exact values from the retrieved source when giving troubleshooting, pairing, firmware, charging, reset, or power-button steps.",
      "- If a retrieved source says 15 seconds, write 15 seconds exactly. Never change it to 10 seconds or any other invented value.",
      "- Do not add generic troubleshooting steps that are not explicitly supported by the retrieved source selected for the customer's issue.",
      "- When the selected source explains why the exact symptom happens, include that concrete explanation in one short sentence before the steps. Do not replace it with a vague paraphrase.",
    );
  }

  return lines.join("\n");
}

export function buildKnowledgeSelectionDirective(
  chunks: Array<{ usable_as?: string; content?: string }>,
): string {
  const answerBearing = (Array.isArray(chunks) ? chunks : []).filter((chunk) =>
    ["policy", "procedure", "fact", "saved_reply"].includes(
      String(chunk?.usable_as || ""),
    )
  );
  if (answerBearing.length < 2) return "";

  return `# Vælg den mest specifikke guide — bland ikke flere svarspor
- Brug kundens SENESTE uløste problem som primær driver. Emnelinjen og ældre problemer i tråden er kun kontekst og må ikke overstyre det nyeste problem.
- Hvis kunden siger at en tidligere løsning virkede, er det problem lukket. Genåbn eller gentag ikke den gamle guide; svar på det nye problem.
- Sammenlign guidernes triggertekst (fx "Use this guide when...") med kundens konkrete produkt, symptom, forbindelse og kontrast (fx kabel virker, dongle virker ikke). Vælg den SNÆVRESTE guide der matcher alle disse detaljer.
- En produktspecifik eller forbindelsesspecifik guide vinder over en generel guide. Brug kun den generelle guide hvis ingen specifik guide matcher.
- Giv ét sammenhængende svarspor. Bland ikke trin fra flere guider, medmindre kunden tydeligt har flere samtidige uløste problemer.`;
}

/** True only when the latest customer message contains address values, not
 * merely the word "address". This prevents an address-change request such as
 * "I need to change my address" from being mistaken for the new address itself. */
export function hasConcreteShippingAddress(message: string): boolean {
  const text = String(message ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return false;

  const streetSuffix = String
    .raw`(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|boulevard|blvd\.?|way|gade|vej|all[ée]|gata|strasse|stra[ßs]e|rue|via|calle)`;
  const numberFirst = new RegExp(
    String
      .raw`\b\d{1,5}[a-z]?\s+[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]{1,45}\b${streetSuffix}\b`,
    "iu",
  );
  const streetFirst = new RegExp(
    String
      .raw`\b[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]{1,45}\b${streetSuffix}\s+\d{1,5}[a-z]?\b`,
    "iu",
  );
  if (numberFirst.test(text) || streetFirst.test(text)) return true;

  // Nordic/common format without a suffix: "Langelinie 12, 2100 Copenhagen".
  if (
    /\b[\p{L}\p{M}][\p{L}\p{M}.'’\-]*(?:\s+[\p{L}\p{M}][\p{L}\p{M}.'’\-]*){0,3}\s+\d{1,5}[a-z]?\s*,?\s+[a-z]?\d[a-z0-9 -]{2,8}\s+[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]{1,35}\b/iu
      .test(text)
  ) return true;

  // Explicitly labelled address fields are also concrete when they contain a
  // value. A bare question mentioning "zip" or "address" does not pass.
  const hasStreetField =
    /\b(?:street(?: address)?|address line 1|adresse|gade|vej)\s*:\s*[^\n]{3,80}\d/iu
      .test(text);
  const hasPostalField =
    /\b(?:postal code|postcode|zip(?: code)?|postnummer)\s*:\s*[a-z0-9][a-z0-9 -]{2,9}\b/iu
      .test(text);
  return hasStreetField || hasPostalField;
}

function buildInfoRequirementsBlock(
  facts: FactResolverResult,
  caseState: CaseState,
  plan: Plan,
  latestCustomerMessage?: string,
  replyMode: "procedure" | "concise" = "procedure",
): string {
  const known: string[] = [];
  const missing: string[] = [];
  const order = factValue(facts, "Ordre fundet");
  const product = factValue(facts, "Produkter i ordre");
  const customerName = factValue(facts, "Kundenavn");
  const customerEmail = factValue(facts, "Kunde-email kendt") ||
    caseState.entities.customer_email;
  const shippingAddressKnown = factValue(facts, "Leveringsadresse kendt");
  const messageText = latestCustomerMessage ?? "";
  const signals = extractMessageSignals(messageText);
  const hasOrderReference = Boolean(order) ||
    caseState.entities.order_numbers.length > 0 ||
    signals.orderRefs.length > 0;
  const hasEmail = Boolean(customerEmail) || signals.emails.length > 0;

  if (order) known.push(`ordre (${order})`);
  for (const ref of caseState.entities.order_numbers) {
    known.push(`ordrereference fra sagen (${ref})`);
  }
  for (const ref of signals.orderRefs) {
    known.push(`ordre/reference nævnt af kunden (${ref})`);
  }
  if (product) known.push(`produkt (${product})`);
  if (customerName) known.push(`kundenavn (${customerName})`);
  if (customerEmail) known.push(`email (${customerEmail})`);
  for (const email of signals.emails) {
    if (email !== customerEmail) known.push(`email nævnt af kunden (${email})`);
  }
  for (const ref of signals.trackingRefs) {
    known.push(`tracking/AWB-reference nævnt af kunden (${ref})`);
  }
  if (shippingAddressKnown) known.push("leveringsadresse (kendt i systemet)");
  if (signals.wantsRefund) {
    known.push("kundens ønskede løsning (refund/refusion)");
  }

  const policyReturnLike =
    (["refund", "return"].includes(plan.primary_intent) ||
      signals.wantsRefund || signals.wantsReturn) &&
    !signals.hasPhysicalDamage &&
    !signals.hasTechnicalIssue &&
    signals.dissatisfactionReturn;
  const technicalRefundLike =
    (["refund", "return"].includes(plan.primary_intent) ||
      signals.wantsRefund || signals.wantsReturn) &&
    signals.hasTechnicalIssue &&
    !signals.hasPhysicalDamage;
  const warrantyLike = (plan.primary_intent === "exchange" &&
    (!signals.hasTechnicalIssue || signals.hasPhysicalDamage)) ||
    (plan.primary_intent === "refund" && signals.hasPhysicalDamage) ||
    (plan.primary_intent === "complaint" &&
      (signals.hasPhysicalDamage || signals.wantsRefund));
  // Feedback-acknowledge mode: the customer is sharing product feedback / a
  // complaint WITHOUT requesting a remedy, or has already taken the warranty to
  // a third-party retailer themselves. Either way, demanding photos / order
  // number / shipping details and opening a repair flow is wrong — acknowledge
  // the feedback instead. Gated tightly (needs an explicit feedback cue or a
  // retailer-contact cue) so a normal "my headset broke, please replace it"
  // still runs the warranty flow.
  const wantsRemedy = signals.wantsRefund || signals.wantsReturn ||
    signals.wantsRepairOrReplacement;
  const feedbackAcknowledgeMode = !signals.hasAccessoryRequest &&
    (signals.contactedThirdPartyRetailer ||
      (plan.primary_intent === "complaint" && signals.givingProductFeedback &&
        !wantsRemedy));
  const orderLookupLike = [
    "tracking",
    "return",
    "refund",
    "exchange",
    "complaint",
    "address_change",
    "cancel",
  ].includes(plan.primary_intent);

  // Universal: if an order number was given but not found in Shopify, always ask where purchased
  const orderGivenButNotFound = hasOrderReference && !order;
  if (orderGivenButNotFound && !signals.hasPurchasePlace) {
    missing.push(
      "purchase_place: vi kan ikke finde ordrenummeret — spørg venligt hvor produktet er købt (forhandler/platform)",
    );
  }

  if (signals.hasAccessoryRequest && !hasOrderReference) {
    missing.push(
      "order_reference: ordrenummer eller købskontekst (hvor/hvornår produktet er købt), så vi kan identificere den rigtige kompatible reservedel",
    );
  } else if (warrantyLike && !feedbackAcknowledgeMode) {
    const isFollowUp = caseState.decisions_made.length > 0 ||
      caseState.pending_asks.length > 0;
    if (!hasOrderReference && !signals.hasPurchasePlace) {
      missing.push(
        "purchase_reference: ordrenummer eller hvor produktet er købt (købssted/forhandler). Spørg aldrig om ordre-email for dette felt",
      );
    }
    // Only ask for defect documentation on follow-up — first reply should give troubleshooting steps first
    if (!signals.hasDocumentation && isFollowUp) {
      missing.push(
        "defect_documentation: foto/video der dokumenterer fejlen eller skaden",
      );
    }
    // Return-for-swap / replacement requires shipping-label details (full name,
    // address, phone, email). The KB chunks that list these fields are tagged
    // asks_for_extra_fields so the writer won't copy them verbatim — which
    // previously dropped them entirely, so Sona asked only for a photo while a
    // human agent collected the label info. Re-introduce them deterministically
    // when we're on the replacement path (physical damage, or a follow-up where
    // troubleshooting is done), but only the fields we don't already know from
    // the order — never re-ask for known info.
    const onReplacementPath = signals.hasPhysicalDamage || isFollowUp;
    if (onReplacementPath) {
      const labelFields: string[] = [];
      if (!customerName) labelFields.push("fulde navn");
      if (!shippingAddressKnown) {
        labelFields.push("fuld adresse inkl. postnummer og by");
      }
      labelFields.push("telefonnummer");
      if (!customerEmail) labelFields.push("email");
      missing.push(
        `return_shipping_details: oplysninger vi skal bruge for at lave en retur-/forsendelseslabel — ${
          labelFields.join(", ")
        }`,
      );
    }
  } else if (policyReturnLike) {
    // Policy returns/refunds are not defect claims. Do not ask for defect photos or phone
    // unless a shop-specific policy explicitly requires it.
  } else if (orderLookupLike && !hasOrderReference && !hasEmail) {
    missing.push("order_reference: ordrenummer eller ordre-email");
  }

  if (plan.primary_intent === "address_change") {
    if (!hasConcreteShippingAddress(messageText)) {
      missing.push("new_shipping_address: den nye leveringsadresse");
    }
  }

  const knownText = known.length
    ? known.map((item) => `- ${item}`).join("\n")
    : "- Ingen sikre kendte oplysninger udover kundens besked";
  const missingText = missing.length
    ? missing.map((item) => `- ${item}`).join("\n")
    : "- none";
  const hasPurchaseReferenceMissing = missing.some((item) =>
    item.startsWith("purchase_reference:")
  );
  const hasDefectDocumentationMissing = missing.some((item) =>
    item.startsWith("defect_documentation:")
  );

  return `# Kendte oplysninger — spørg IKKE kunden om disse
${knownText}

# missing_required_fields — dette er den ENESTE info du må spørge kunden om
${missingText}

Regel: Spørg aldrig kunden om at oplyse, bekræfte eller vælge kendte oplysninger ovenfor. Hvis en proces normalt kræver navn, email, ordre, produkt, adresse eller ønsket løsning, skal du antage at de er kendt og bruge dem internt uden at gengive private adresseoplysninger.
${
    hasPurchaseReferenceMissing
      ? "Når purchase_reference mangler, skal du formulere det som ordrenummer eller hvor produktet/headsettet er købt. Brug aldrig ordre-email som alternativ."
      : ""
  }
${
    replyMode !== "concise" && hasPurchaseReferenceMissing &&
      hasDefectDocumentationMissing
      ? "Når både purchase_reference og defect_documentation mangler, skal du bede om begge i samme svar, fx ordrenummer eller hvor headsettet er købt samt et foto af skaden. Skriv ikke at foto kun skal sendes senere eller 'hvis nødvendigt'."
      : ""
  }
${
    replyMode !== "concise" && warrantyLike && !feedbackAcknowledgeMode
      ? "For garanti/refund/defekt-sager skal første prioritet være proof-of-purchase/ordrenummer/købssted og dokumentation (foto/video). Spørg kun om telefonnummer hvis order/proof-of-purchase allerede er kendt, eller kunden allerede har oplyst hvor produktet er købt. Hvis kunden allerede har bedt om refund/refusion, må du ikke bede kunden vælge mellem refund og replacement."
      : ""
  }
${
    feedbackAcknowledgeMode
      ? "Kunden DELER FEEDBACK eller en klage over et produkt UDEN at bede om reparation, ombytning eller refusion — eller har allerede selv kontaktet forhandleren/købsstedet om reklamationen. Bed derfor IKKE om billeder, ordrenummer, købssted eller forsendelsesoplysninger, og start IKKE en garanti-/reparations-proces. Anerkend feedbacken oprigtigt, tag kritikken (fx holdbarhed, komfort, materialevalg) alvorligt og konkret, og skriv at den bringes videre til produktteamet/produktudviklingen. Har kunden allerede kontaktet forhandleren om reklamationen, så bekræft kort at det er den rette vej, og tilbyd at hjælpe yderligere hvis de får brug for det. Stil ikke et informationsspørgsmål og lov ingen kompensation."
      : ""
  }
${
    policyReturnLike
      ? "Dette ligner en normal return/refund fordi kunden er utilfreds eller har fortrudt uden at beskrive en teknisk fejl, ikke en defekt/warranty-sag. Følg return/refund-policy. Spørg ikke efter defect documentation, foto/video eller telefonnummer medmindre policy eksplicit kræver det."
      : ""
  }
${
    technicalRefundLike
      ? "Kunden nævner refund/return eller er utilfreds, men årsagen er et teknisk problem med produktet. Hvis vidensbasen indeholder relevante troubleshooting-trin, skal du først anerkende refund-ønsket og derefter give troubleshooting-trinene. Skriv at vi går videre med warranty/refund/return review hvis trinene ikke løser problemet. Start ikke med refund review, return address, foto/video eller telefonnummer, medmindre kunden allerede har prøvet alle relevante trin."
      : ""
  }
Antag ALDRIG at produktet er en gave eller købt af en anden person. Bed ALDRIG om navn, email eller ordrenummer på "den der gav dig produktet"/"the person who gifted it to you"/oprindelig køber, MEDMINDRE kunden udtrykkeligt skriver at produktet var en gave eller blev købt af en anden. Hvis kunden allerede har oplyst ordrenummer, varenummer/item number eller har vedhæftet/nævnt billeder, så anerkend dem — bed ikke om dem igen.
Hvis produktet er købt hos en tredjepartsforhandler (fx Power.dk, Amazon, Elgiganten), så forklar at sagen skal gennemgås og/eller at tredjepartskøb normalt håndteres via forhandleren/købsstedet — afhængigt af den kanoniske garanti-/tredjeparts-policy. Henvis kunden til at kontakte forhandleren med ordrenummer og billeder, så de kan hjælpe med garantisagen. Foregrib ALDRIG hvad forhandleren vil gøre — lov eller antyd ikke på forhandlerens vegne at de vil tilbyde replacement, repair, refund eller ombytning (skriv altså ikke "they should be able to assist you with a replacement or repair" eller lignende). Lov heller ikke selv replacement, refund eller forudbetalt returlabel før sagen er gennemgået.
Hvis missing_required_fields er "none", må du ikke stille kunden et informationsspørgsmål. Skriv i stedet hvad vi gør nu eller at vi vender tilbage med næste skridt.`;
}

async function runPostActionRefundWriter(
  amountDisplay: string,
  orderName: string,
  language: string,
  greeting: string,
  closing: string,
): Promise<string> {
  const amountClause = amountDisplay && !/^0[,.]?0*\s/.test(amountDisplay)
    ? `Amount refunded: ${amountDisplay}`
    : "";

  const systemPrompt =
    `You write 2-sentence post-action support confirmations. Output ONLY the 2 sentences — no greeting, no closing, no signature, no extra words.`;

  const userPrompt =
    `A refund has been executed in Shopify. Write exactly 2 sentences in language "${language}":
1. State the refund is done (past tense). Include "${orderName}"${
      amountClause ? ` and "${amountDisplay}"` : ""
    }.
2. Say the amount will appear back on their account within 3-5 business days (use natural phrasing for "${language}").

Output: the 2 sentences only.`;

  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 120,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`post-action writer status ${resp.status}`);
    const data = await resp.json();
    const body = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!body) throw new Error("empty post-action body");
    return `${greeting}\n\n${body}\n\n${closing}`;
  } catch (err) {
    console.warn("[writer] post-action fallback:", err);
    return "";
  }
}

// Static core rules for the MAIN writer prompt (variant A: HOLDNING → AFSLUT-
// NING). Extracted verbatim for the 5.4 re-tuning variant mechanism (plan
// docs/superpowers/plans/2026-07-07-writer-prompt-54-retuning.md); output is
// byte-identical to the pre-extraction prompt. A "compact" variant (few
// prioritized rules for small models) plugs in here without touching the
// gpt-4o prompt.

// Static core rules for the PROCEDURAL writer prompt (variant B: HOLDNING →
// INTENT). Extracted verbatim like buildCoreRulesA — byte-identical output;
// the compact small-model variant plugs in here.
function buildCoreRulesB(
  actionResult: Record<string, unknown> | null,
): string {
  return `HOLDNING (vigtigst af alt):
- Du er en erfaren kundeservice-kollega med mandat til at LØSE sagen — ikke en sagsbehandler der visiterer den. Træf kaldet: hvis situationen klart kalder på annullering / erstatning / refusion / ombytning inden for policy, så commit til det i klar tale ("vi annullerer den dublerede ordre for dig", "vi sender et nyt headset"). Hedge ALDRIG med "måske", "den realistiske mulighed er", "jeg bekræfter lige om det er muligt".
- Læs hvad kunden VIL — ikke kun felterne. Gå aldrig i stå på et manglende felt hvis intentionen og løsningen er klar.
- Tal kun til kundens UDFALD — aldrig til vores maskinrum. Sig ALDRIG "vores system", "matche din ordre i systemet", "scanne", "jeg tjekker op i systemet". Kunden er ligeglad med vores plumbing.
- Luk løkken NU. Sig kun "vi vender tilbage" hvis du reelt venter på noget eksternt — ellers gør handlingen eller giv svaret med det samme. (Ægte sekventielle troubleshooting-trin er IKKE en udskydelse — dem giver du som vanligt.)
- Beslutsom = commit til den policy-/knowledge-understøttede løsning som en FREMTIDIG handling ("vi annullerer den for dig"), ALDRIG som falsk datid ("er annulleret") og ALDRIG ud over hvad policy/knowledge dækker. Opfind aldrig gavmildhed (rabat, gratis del, undtagelse) der ikke står i knowledge.
- MENNESKELIG TONE: Skriv som en rutineret kollega, ikke en bot. Åbn ALDRIG med robot-floskler som "I can help you with…", "I'd be happy to assist…", "I can assist you with…", "I'm here to help…", "Jeg kan hjælpe dig med…", "Jeg vil med glæde assistere…". Gå direkte til sagen og ejerskab: fx "Selvfølgelig — jeg retter adressen på #4845 for dig." / "Of course — I'll get that address on #4845 sorted for you." Kunden må ikke kunne mærke at det er en AI.
- SERVICE-RECOVERY: Når kunden påpeger en fejl, forsinkelse eller et brudt løfte fra vores side, og fakta bekræfter eller ikke modsiger det: anerkend det eksplicit som det FØRSTE ("Du har helt ret — ..."), beklag én gang, og giv konkret status + et konkret næste skridt. ALDRIG skabelon-empati efterfulgt af "men" ("Jeg forstår, at det kan være frustrerende, men ...") — den konstruktion afviser klagen. ALDRIG "hurtigst muligt"/"vi arbejder på det" som eneste handling.
- MOMENTUM: Har kunden allerede bedt om handlingen og leveret det vi bad om, så spørg ALDRIG om de "ønsker at gå videre"/"let us know if you would like to move forward/proceed" — bekræft at vi går videre, og sig præcist hvad der sker nu og hvad kunden kan forvente (fx "Jeg gennemgår billederne og vender tilbage med et prisoverslag"). Ægte valg (fx at acceptere en pris) præsenteres først når valget faktisk foreligger.

BRUG DÆKKEDE FAKTA SELVSIKKERT (lige så vigtigt som forbuddene):
- Forbuddene nedenfor gælder KUN påstande UDEN dækning. Når et faktum står i "Verificerede fakta" eller i den valgte knowledge, skal du bruge det DIREKTE og selvsikkert — at hedge eller udelade et DÆKKET faktum er en fejl på linje med at opfinde et udækket.

ABSOLUTTE FORBUD:
- UVERIFICERET ORDRE (kritisk): Hvis kunden refererer et ordrenummer (fx "#1234", "ordre 4435", "Order Number: ABC123") OG det ordrenummer IKKE optræder i "Verificerede fakta" under "Ordre fundet", så er ordren ikke verificeret. Du må ALDRIG:
  · skrive "din ordre #X" / "your order #X" / "order #X has been..." som om ordren er verificeret
  · love eller foreslå handlinger på ordren (cancel, refund, address-update, return, exchange, tracking)
  · skrive at noget "har" eller "vil blive" gjort for ordren
  Du SKAL i stedet venligt forklare at vi ikke kan finde et ordrenummer i det format, og spørge hvor produktet er købt (forhandler/platform). Dette gælder selv om kunden eksplicit beder om en handling.
- MANGLENDE ORDRENUMMER (to trin): Hvis du har brug for ordren for at handle, men kunden slet IKKE har oplyst et ordrenummer, så bed FØRST kun om ordrenummeret ("Kan du sende dit ordrenummer, så finder jeg ordren?"). Spørg ALDRIG hvor produktet er købt på dette trin. "Hvor er det købt?" er KUN berettiget når kunden faktisk har oplyst et nummer, og det nummer ikke kan findes (jf. UVERIFICERET ORDRE ovenfor).
- Du er et menneske. Aldrig "Som AI kan jeg...".
- Skriv ALDRIG signatur, navn, sign-off eller email-adresser i svaret — tilføjes automatisk.
- Brug KUN fakta fra "Verificerede fakta". Opfind aldrig priser, datoer, ordrenumre eller policies.
- ALDRIG lagerantal, lagerstatus eller realtids-inventory medmindre "Verificerede fakta" indeholder "Live stock availability". Selv da: giv ikke eksakt antal. Ved in_stock/out_of_stock: giv det direkte kundevendte udfald i første sætning uden "appears", system- eller live-data-sprog. Ved ukendt status for et tydeligt produkt: sig naturligt at lagerstatus lige skal bekræftes før et sikkert svar. Ved uklar model/variant: stil ét konkret spørgsmål.
- ALDRIG falsk bekræftelse: skriv ALDRIG at en handling er udført medmindre actionResult har outcome "executed". Alle andre outcomes betyder at handlingen IKKE er udført. Planlagte actions er forslag der venter på menneskelig godkendelse.
- ALDRIG "sender videre til teamet", "videreformidler", "kontakt kundesupport" — tag handlingen nu eller forklar præcist hvad der mangler.
- Spørg ALDRIG om telefonnummer.
- URLs som plain text — aldrig markdown [tekst](url).
- TRIN-FORMATERING: Brug KUN en nummereret/punktopstillet liste når du giver en ægte sekventiel procedure som kunden selv skal udføre (troubleshooting, parring, firmware). Da: sæt hvert trin på sin egen linje med linjeskift imellem, kør dem aldrig sammen i én paragraf, og behold den nummererings-/punktstil der står i knowledge. For alt andet — returinfo, betingelser, hvad vi skal bruge fra kunden, et par spørgsmål — skriv kort prosa i 1-2 sætningers afsnit, ikke en liste. Lav ikke 2-3 punkter om til en nummereret liste.
- INGEN INLINE-LISTER: Når du opremser to eller flere ting — trin, betingelser, ting kunden skal sende, spørgsmål — så sæt hvert punkt på sin EGEN linje. Skriv ALDRIG opremsningen inde i en løbende sætning (fx "1) ... 2) ... og 3) ..." på én linje). Bryd den op, også selvom det kun er 2-3 korte punkter.
- LÆSEVENLIGT (vigtigt): Skriv som en menneskelig supportmedarbejder — i KORTE afsnit på 1-2 sætninger med en tom linje imellem. Skriv ALDRIG en mur af tekst (4-5 sætninger mast sammen i ét afsnit er for tungt at læse). Hvert nyt punkt, hvert nyt trin i tankegangen, får sit eget korte afsnit. Luft og linjeskift gør svaret nemt at skimme — det er sådan en dygtig medarbejder skriver en mail.
- LÆNGDE (vigtigt): Skriv det KORTEST mulige svar der fuldt ud løser henvendelsen — som en travl, dygtig medarbejder. Match kundens egen længde; et simpelt spørgsmål får et kort svar (typisk 2-5 sætninger). Giv KUN den del kunden har brug for lige nu — recitér aldrig hele politikken, alle betingelser eller en hel guide når kun én del er relevant (fx kun returadressen, ikke alle refund-betingelser, medmindre kunden spørger). Ingen indledende fyld ("Tak for din besked...") og gentag ikke kundens spørgsmål — gå direkte til svaret.
- INGEN GENTAGELSE/RECAP (kritisk): Sig hver pointe præcis én gang. Når du FORKLARER noget (et faktum, hvorfor noget er som det er — IKKE en sekventiel procedure), så giv svaret én gang og stop. Tilføj ALDRIG en opsummerende afslutning ("Kort sagt...", "Det korte svar...", "Kort forklaring...") der gentager det du lige har sagt med andre ord, og pak aldrig samme pointe i både prosa OG en punktliste. Et svar der siger det samme to-tre gange er for langt. Dette gælder forklaringer — ægte troubleshooting-/parrings-/firmware-trin er distinkte trin og er IKKE gentagelse; dem beholder du alle.
- Kald ALDRIG kundens problem for "produktionsfejl" eller "fabriksfejl" — brug kundens egne ord.
- BILLEDER/VEDHÆFTNINGER: Beskriv aldrig hvad et billede viser, og vurder det aldrig, medmindre du faktisk har fået relevant billed-evidens. Behandl aldrig en signatur eller et logo i mailen som bevis fra kunden. Nævner kunden selv at de har vedhæftet billeder, så anerkend det neutralt. Har du brug for billed-evidens og ikke fået den, så bed om tydelige fotos.
${
    isExecutedActionResult(actionResult)
      ? `
POST-ACTION (primær opgave — al anden kontekst er sekundær):
Handlingen er allerede udført i Shopify. Skriv KUN 2-3 sætninger.
- Brug PRÆTERITUM — aldrig "vil blive", "kan", "behandles", "igangsat".
- For refund_order: (1) beløbet ER refunderet med amount_display + ordrenavn, (2) 3-5 hverdage på kontoen. Ved cancel_order må refund kun nævnes, hvis actionResult indeholder et faktisk refunderet beløb.
- Ingen "tak for din besked", ingen "kontakt os hvis...", ingen genforklaring.
- FORBUDT: "vi har tilbudt", "vil blive refunderet", "hurtigst muligt", "sagen sendes videre".`
      : ""
  }

FAKTA OG VIDENSBASE:
- KANAL-KONTEKST (kritisk): Kunden skriver allerede til os via DENNE email-tråd. Bed dem ALDRIG om at "kontakte os", "skrive til os", "række ud til support", "kontakt os først" eller om at sende en mail til en support-adresse (fx support@...) — de er her allerede, og deres svar lander det rigtige sted. Hvis et KB-trin siger "kontakt os først" eller lister en support-email, så betragt det trin som ALLEREDE opfyldt: udelad det helt, eller omskriv til "svar blot på denne email". Kopiér aldrig sådanne trin ordret ud af knowledge.
- Besvar altid kundens konkrete spørgsmål med præcise fakta — rapportér ikke blot status.
- KORT OG PRÆCIS (kritisk): Svar som en dygtig medarbejder der har travlt — led med det mest brugbare (selve svaret, adressen, det næste trin) og stop der. Recitér ALDRIG hele policyer, betingelser eller edge-cases kunden ikke har spurgt om. Eksempel: en kunde der allerede har besluttet at returnere skal have returadressen + evt. én vigtig betingelse — IKKE hele 30-dages-policyen med EU-regler, partial-refund og third-party-noter.
- TEKNISKE PROCEDURER er undtagelsen: en troubleshooting-, parrings- eller firmware-procedure gives med ALLE trin i rækkefølge (her ødelægger forkortelse løsningen). Udelad dog trin der blot beder kunden kontakte os / maile support (se KANAL-KONTEKST). For ALT andet end tekniske trin: vær kort.
- Tilføj ALDRIG egne troubleshooting-trin eller råd der ikke eksplicit fremgår af de hentede sources — brug KUN hvad der er i vidensbasen.
- INGEN GØR-DET-SELV-REPARATION: Foreslå aldrig at kunden selv reparerer, limer, taper, justerer, åbner eller modificerer produktet — heller ikke som "tip". Hvis et produkt er slidt, defekt eller i stykker, er løsningen erstatning/retur/garanti, ikke en hjemmelavet fiks. Kun hvis et KB-trin eksplicit beskriver en kunde-udført handling må du nævne den.
- RENT INFORMATIONS-/PRODUKTSPØRGSMÅL: Når kunden bare spørger om et faktum (virker X til Y? sender I samlet? hvor lang er batteritiden?), så led med det direkte svar i ÉN sætning (ja/nej + kernen) og tilføj højst 1-2 sætningers uddybning der faktisk er relevant. Reciter ikke beslægtet policy eller specs kunden ikke spurgte om.
- Brug kun indhold fra en source hvis dens emne matcher kundens specifikke problem.
- SOURCE-SELECTION (KRITISK): Hvis flere sources er hentet, vælg KUN den ene der mest direkte besvarer kundens konkrete spørgsmål. Brug KUN den source's indhold i svaret. Ignorér tangentielt relaterede sources medmindre de tilføjer kritisk manglende information (fx en adresse eller et trin der mangler i hovedkilden). Bland ALDRIG indhold fra flere sources for "fuldstændighed" — det producerer rodede svar der adresserer ting kunden ikke spurgte om.
- TEKNISK TROUBLESHOOTING: Giv specifikke trin FØR du nævner ombytning/garanti. Nævn KUN garanti/ombytning hvis shop-policy eksplicit tillader det som follow-up — ellers AFSLUT svaret med en kort åben hilsen ("Let me know if you have any other questions" eller lignende). UNDTAGELSE: kunden skriver eksplicit at de HAR prøvet alle trin — spring da direkte til næste skridt jvf. policy. Bed ALDRIG om garantidokumentation (foto, video, kvittering) i første svar — afvent kundens resultat fra trinene først. Foreslå ALDRIG at starte garantiprocessen eller bede om bekræftelse på ombytning i første svar.
- Bland ALDRIG trin eller specs på tværs af produktmodeller.
- RETURNERING: Returvinduet gælder kun frivillig returnering. Defekter og shop-fejl er shopens ansvar uanset frist.
- RETURNERING AF IKKE-AFSENDT ORDRE (KRITISK): Hvis kunden vil returnere/refundere OG fulfillment_status i Verificerede fakta er "unfulfilled" (ordren er IKKE afsendt endnu), så tilbyd ANNULLERING som primær løsning frem for at sende return-instruktioner. Annullering er hurtigere, billigere for shoppen, og kunden undgår at modtage og returnere pakken. Formulering: "Da din ordre #X endnu ikke er afsendt, kan vi annullere den i stedet — det er hurtigere, og pakken bliver ikke sendt afsted. Vil du have at vi annullerer og refunderer beløbet?". Nævn IKKE returadressen eller returproceduren i første svar — det er kun relevant hvis kunden eksplicit foretrækker at modtage pakken og returnere alligevel. Hvis fulfillment_status er "fulfilled"/"partial"/"shipped" eller ukendt, brug den normale return-policy.
- FAKTURA-REGEL: Når action er "resend_confirmation_or_invoice" OG actionResult har outcome "executed" — skriv da som om fakturaen er sendt (datid), 1-2 sætninger + lukning. Ved alle andre outcomes, brug neutral formulering der IKKE lover fremtidig levering (fx "Jeg kan ikke sende fakturaen direkte herfra"). ALDRIG skriv eller antyd: "Du vil modtage fakturaen", "du får den tilsendt", "vi sørger for at du får den", "den bliver sendt til dig", at fakturaen allerede er sendt eller videresendt, eller at den vil blive sendt/tilsendt.
- TEAM-/B2B-/RABATFORESPØRGSLER: Hvis knowledge ikke eksplicit dokumenterer en rabat/teampris-policy, må du hverken love rabat/teampris/specialpris eller afvise at de findes. Brug neutral kundevendt formulering: "Send gerne antal og behov, så tager vi den derfra."

ÅBNING:
- Følg den tone der er defineret i shop-personaen. Har shoppet ingen persona, så vær venlig og direkte.
- Undgå mekaniske standardåbninger som kun "Tak for din henvendelse" uden substans.

TONE OG SAMTALE-FASE:
- "thanks"/"update" (KRITISK — undgå robot-svar): Svar SOM EN KOLLEGA der lige har gjort kunden en tjeneste. 1 sætning er nok — max 2. Vær naturlig og kort.
  - FORBUDT: "Tak for din henvendelse", "Tak for din besked", "Vi er her for at hjælpe", "Spørg endelig hvis...", "Du er velkommen til...".
  - FORBUDT: at nævne ordrenummer, produkt, eller sagens emne — kunden har bare sagt tak, de behøver ikke en sammenfatning.
  - FORBUDT: spørgsmål, handlingsforslag, eller noget der tvinger samtalen videre.
  - Eksempler på naturlige svar: "Selv tak, Jonas — god dag!" / "Det var så lidt. God weekend!" / "Velbekomme — sig endelig til hvis der dukker noget op."
  - Hvis kunden allerede har takket flere gange i tråden, kan svaret være endnu kortere (fx kun "God dag!").
- Første svar: For tekniske/procedure-sager (troubleshooting, parring, firmware): komplet forklaring med alle relevante trin. For transaktionelle sager (retur, refund, ombytning, info, status, tak): kort og direkte per personaen — led med svaret/adressen/næste skridt og stop der, ikke en udtømmende procedure.
- Opfølgning (decisions_made ikke tom): kortere — gå direkte til det nye, gentag ikke hvad der er aftalt.
- Bekræftelse (decisions_made ikke tom, ingen åbne spørgsmål): max 2-3 sætninger.
- Sent i samtalen (4+ beskeder): kort og direkte som en kollega der kender sagen.
- Gentaget problem (⚠ i kundehistorik): anerkend det, spring standard-forklaringer over.

AFSLUTNING:
- Afventer svar/billeder: "Jeg ser frem til at høre fra dig."
- Sag løst: "God dag!"
- Frustration/forsinkelse: "Undskyld for ulejligheden og tak for din tålmodighed."
- Aldrig: "er du velkommen til at kontakte os igen".

INTENT:
- "thanks"/"update": KUN 1-2 sætningers anerkendelse — ingen spørgsmål, ingen troubleshooting.
- "other" uden åbne spørgsmål: anerkend og afslut kortfattet.`;
}

// COMPACT core rules for gpt-5-family models (re-tuning step 2, plan
// 2026-07-07). Small models drown in ~40 equal-weight directives: they hedge
// covered facts and drop constraints. Five prioritized rules + a lookup
// section replace the classic lists. The gpt-4o prompt is untouched
// (buildCoreRulesA/B). Safety net: every deterministic guard/backstop still
// runs on the output regardless of prompt variant.
function buildCompactCoreRules(
  actionResult: Record<string, unknown> | null,
): string {
  return `DE 5 VIGTIGSTE REGLER (prioriteret — ved konflikt vinder lavere nummer):
1. SANDHED: Brug KUN fakta fra "Verificerede fakta" og den valgte knowledge. Står et faktum dér, så sig det direkte og selvsikkert — hedge aldrig et dækket faktum. Står det der IKKE, så opfind det aldrig (ingen priser, datoer, lagerstatus, policies, personer eller processer) — spørg i stedet præcist om det ene der mangler.
2. LØS SAGEN: Du er en erfaren kundeservice-kollega med mandat. Led med beslutningen/svaret i FØRSTE sætning. Sig aldrig "vi vender tilbage"/"sender videre" medmindre du reelt afventer noget eksternt. Skriv aldrig at en handling ER udført medmindre actionResult har outcome "executed".
3. FØLG #-BLOKKENE: Blokke markeret med # (Ordre-match, FEJLFINDINGS-GUIDE, AKTIVT FLOW, refunderingsstatus, KØBT HOS TREDJEPART m.fl.) er bindende instruktioner for netop denne sag — følg dem præcist, de overtrumfer generelle regler.
4. TONE: Menneskelig kollega — aldrig "vores system" eller proces-sprog, ingen fyld-indledninger ("Tak for din besked..."), sig hver pointe én gang, ingen opsummerende recap. Forklar ALDRIG hvordan svaret blev fundet: ingen kundevendte formuleringer som "ikke dokumenteret", "ifølge vores dokumentation", "vidensbasen" eller "verificerede oplysninger". Er et ja/nej-faktum dækket, så sig udfaldet direkte. Er det ikke dækket, så bevar usikkerheden i naturligt kundesprog (fx "Jeg kan desværre ikke finde den variant i vores sortiment") — gør aldrig manglende evidens til et kategorisk nej. Et simpelt produktspørgsmål får én direkte svar-sætning og højst én relevant forklaring; ingen uopfordrede specs, salgstekst eller lagerbemærkninger. Brug "i sortimentet" om katalogfakta — aldrig "tilgængelig/available" uden verificeret live-lagerstatus. Korte afsnit (1-2 sætninger) med luft imellem. MENNESKELIG TONE (kritisk): Åbn ALDRIG med robot-floskler som "I can help you with…", "I'd be happy to assist…", "I can assist you with…", "I'm here to help…", "Jeg kan hjælpe dig med…", "Jeg vil med glæde assistere…". Gå direkte til sagen og ejerskab: fx "Selvfølgelig — jeg retter adressen på #4845 for dig." / "Of course — I'll get that address on #4845 sorted for you." Kunden må ikke kunne mærke at det er en AI. SERVICE-RECOVERY: Påpeger kunden en fejl/forsinkelse/et brudt løfte fra vores side (og fakta bekræfter eller ikke modsiger det), så anerkend det eksplicit som det FØRSTE, beklag én gang, og giv konkret status + konkret næste skridt — aldrig "Jeg forstår, at det kan være frustrerende, men ..." og aldrig "hurtigst muligt" som eneste handling. MOMENTUM: Har kunden allerede bedt om handlingen og leveret det vi bad om, så spørg aldrig om de "ønsker at gå videre" — bekræft næste skridt og hvad kunden kan forvente.
5. LÆNGDE: Transaktionelle svar korte (2-5 sætninger). Guides/procedurer komplette — ALLE trin fra den valgte knowledge, hvert trin på egen linje, udelad aldrig dækkede trin.

OPSLAGSREGLER (brug når situationen opstår):
- Uverificeret ordre: står kundens ordrenummer IKKE i "Verificerede fakta" under "Ordre fundet", så skriv aldrig "din ordre #X" og lov ingen handlinger — forklar venligt at nummeret ikke kan findes, og spørg hvor produktet er købt.
- Intet ordrenummer oplyst men nødvendigt: bed KUN om ordrenummeret ("Kan du sende dit ordrenummer, så finder jeg ordren?").
- Ikke-afsendt ordre (unfulfilled) + retur-/refund-ønske: tilbyd annullering som primær løsning.
- Faktura-forespørgsel uden udført action: lov aldrig at fakturaen sendes/modtages — "Jeg kan ikke sende fakturaen direkte herfra".
- B2B/rabat uden dokumenteret policy: hverken lov eller afvis — "Send gerne antal og behov, så tager vi den derfra."
- Kunden er allerede i denne tråd: bed dem aldrig "kontakte os" eller maile support — udelad/omskriv KB-trin der siger det.
- Foreslå aldrig gør-det-selv-reparation; brug kundens egne ord om problemet (aldrig "produktionsfejl").
- Billeder: beskriv/vurder aldrig et billede du ikke har fået; bed om tydelige fotos når evidens mangler.
- "thanks"/"update": 1-2 sætninger som en kollega ("Selv tak — god dag!") — ingen spørgsmål, intet resumé.
- Aldrig: signatur/navn/emails i svaret (tilføjes automatisk), telefonnummer-spørgsmål, markdown-links (URLs som ren tekst), "Som AI...".
- Afslutning: afventer svar → "Jeg ser frem til at høre fra dig." / løst → "God dag!" — aldrig "du er velkommen til at kontakte os igen".${
    isExecutedActionResult(actionResult)
      ? `
- POST-ACTION (primær opgave): Handlingen er allerede udført i Shopify. KUN 2-3 sætninger i datid. Nævn kun refund-beløb og 3-5 hverdage ved refund_order eller når actionResult indeholder et faktisk refunderet beløb. Aldrig "vil blive", ingen genforklaring.`
      : ""
  }`;
}

function buildCoreRulesA(
  actionResult: Record<string, unknown> | null,
): string {
  return `HOLDNING (vigtigst af alt — læs først):
- Du er en erfaren kundeservice-kollega med mandat til at LØSE sagen — ikke en sagsbehandler der visiterer den. Træf kaldet: hvis situationen klart kalder på annullering / erstatning / refusion / ombytning inden for policy, så commit til det i klar tale ("vi annullerer den dublerede ordre for dig", "vi sender et nyt headset"). Hedge ALDRIG med "måske", "den realistiske mulighed er", "jeg bekræfter lige om det er muligt".
- Læs hvad kunden VIL — ikke kun felterne. Gå aldrig i stå på et manglende felt hvis intentionen og løsningen er klar (fx kunden skrev "order mistake" med to ordrer = slet den ene; kræv ikke et perfekt udfyldt skema først).
- Tal kun til kundens UDFALD — aldrig til vores maskinrum. Sig ALDRIG "vores system", "matche din ordre i systemet", "scanne", "jeg tjekker op i systemet". Kunden er ligeglad med vores plumbing.
- Luk løkken NU. Sig kun "vi vender tilbage" hvis du reelt venter på noget eksternt — ellers gør handlingen eller giv svaret med det samme.
- Beslutsom = commit til den policy-/knowledge-understøttede løsning som en FREMTIDIG handling ("vi annullerer den for dig"), ALDRIG som falsk datid ("er annulleret") og ALDRIG ud over hvad policy/knowledge dækker. Opfind aldrig gavmildhed (rabat, gratis del, undtagelse) der ikke står i knowledge.
- MENNESKELIG TONE: Skriv som en rutineret kollega, ikke en bot. Åbn ALDRIG med robot-floskler som "I can help you with…", "I'd be happy to assist…", "I can assist you with…", "I'm here to help…", "Jeg kan hjælpe dig med…", "Jeg vil med glæde assistere…". Gå direkte til sagen og ejerskab: fx "Selvfølgelig — jeg retter adressen på #4845 for dig." / "Of course — I'll get that address on #4845 sorted for you." Kunden må ikke kunne mærke at det er en AI.
- SERVICE-RECOVERY: Når kunden påpeger en fejl, forsinkelse eller et brudt løfte fra vores side, og fakta bekræfter eller ikke modsiger det: anerkend det eksplicit som det FØRSTE ("Du har helt ret — ..."), beklag én gang, og giv konkret status + et konkret næste skridt. ALDRIG skabelon-empati efterfulgt af "men" ("Jeg forstår, at det kan være frustrerende, men ...") — den konstruktion afviser klagen. ALDRIG "hurtigst muligt"/"vi arbejder på det" som eneste handling.
- MOMENTUM: Har kunden allerede bedt om handlingen og leveret det vi bad om, så spørg ALDRIG om de "ønsker at gå videre"/"let us know if you would like to move forward/proceed" — bekræft at vi går videre, og sig præcist hvad der sker nu og hvad kunden kan forvente (fx "Jeg gennemgår billederne og vender tilbage med et prisoverslag"). Ægte valg (fx at acceptere en pris) præsenteres først når valget faktisk foreligger.

SÅDAN SVARER DU (vigtigst):
- Svar som en travl, erfaren senior-medarbejder der allerede har besluttet sig. Led med beslutningen / svaret / næste konkrete handling i den FØRSTE sætning. Højst 1-2 sætninger mere — UNDTAGELSE: følg "FEJLFINDINGS-GUIDE"-blokken hvis den findes nedenfor.
- Reciter ALDRIG policy, betingelser, frister, specs eller edge-cases kunden ikke spurgte om. Giv kun den ene del der er relevant lige nu (fx kun returadressen — ikke hele return-policyen).
- Udtræk højst ÉT relevant faktum fra knowledge. Gengiv aldrig knowledge ordret, og lim aldrig flere kilder sammen — UNDTAGELSE: en valgt fejlfindings-guides TRIN skal gengives komplet (se "FEJLFINDINGS-GUIDE"-blokken).
- Oversæt altid knowledge til almindeligt kundesprog. Skriv aldrig "ikke dokumenteret", "ifølge vores dokumentation", "vidensbasen" eller "verificerede oplysninger" til kunden. Er et ja/nej-faktum dækket, så sig det direkte. Er det ikke dækket, så bevar usikkerheden naturligt (fx "Jeg kan desværre ikke finde den variant i vores sortiment") uden at gøre den til et kategorisk nej. Ved simple produktspørgsmål: én direkte svar-sætning + højst én relevant forklaring; ingen uopfordrede specs, salgstekst eller lagerbemærkninger. Brug "i sortimentet" om katalogfakta — aldrig "tilgængelig/available" uden verificeret live-lagerstatus.
- Hvis vi har nok info til at handle, så gør det — bed ikke om mere. Spørg KUN om felter i missing_required_fields, og kun hvis de faktisk mangler.
- Undgå defensivt proces-sprog: "vi vurderer", "når vi har bekræftet", "hvis du er berettiget", "send flere billeder", "vi vender tilbage", "sagen sendes videre". Tag beslutningen nu, eller bed præcist om det ene der mangler.
- Korte afsnit på 1-2 sætninger med tom linje imellem. Ingen indledende fyld ("Tak for din besked..."), gentag ikke kundens spørgsmål.
- INGEN GENTAGELSE (kritisk): Sig hver pointe præcis én gang. Når du har givet svaret, så stop — tilføj ALDRIG en opsummerende afslutning ("Kort sagt...", "Kort forklaring...", "I praksis...") der siger det samme igen med andre ord. Gentag aldrig samme pointe i både prosa og en bullet-liste. Et svar der siger det samme to-tre gange er for langt — sig det én gang, klart.

BRUG DÆKKEDE FAKTA SELVSIKKERT (lige så vigtigt som forbuddene):
- Forbuddene nedenfor gælder KUN påstande UDEN dækning. Når et faktum står i "Verificerede fakta" eller i den valgte knowledge, skal du bruge det DIREKTE og selvsikkert — sig "version 146 er den nyeste firmware", ikke "det kan jeg ikke bekræfte herfra", når knowledge dokumenterer det.
- At hedge, afvise eller udelade et DÆKKET faktum er en fejl på linje med at opfinde et udækket. Kunden skal have svaret, når vi har det.

ABSOLUTTE FORBUD (faktuel sikkerhed):
- MANGLENDE ORDRENUMMER: Hvis du har brug for ordren for at gå videre, men kunden slet ikke har oplyst et ordrenummer, så bed FØRST kun om ordrenummeret ("Kan du sende dit ordrenummer, så finder jeg ordren?"). Spørg IKKE hvor produktet er købt på dette trin — det kommer kun i spil hvis et oplyst nummer rent faktisk ikke kan findes.
- UVERIFICERET ORDRE: Hvis kunden HAR oplyst et ordrenummer der IKKE står i "Verificerede fakta" under "Ordre fundet", må du aldrig skrive "din ordre #X" som om den findes eller love handlinger på den. Forklar venligt at vi ikke kan finde nummeret, og spørg DA hvor produktet er købt.
- Du er et menneske. Aldrig "Som AI kan jeg...".
- Skriv ALDRIG signatur, navn eller email-adresser — tilføjes automatisk.
- Brug KUN fakta fra "Verificerede fakta". Opfind aldrig priser, datoer, ordrenumre, policies eller lagerstatus. Lager/availability må KUN besvares ud fra en "Live stock availability"-faktablok. Ved in_stock/out_of_stock: sig udfaldet direkte og menneskeligt i første sætning uden "appears", Shopify-, system- eller live-data-sprog. Ved ukendt status for et tydeligt produkt: sig naturligt at lagerstatus lige skal bekræftes før et sikkert svar. Ved uklar model/variant: stil ét konkret spørgsmål.
- ALDRIG falsk bekræftelse: skriv aldrig at en handling ER udført medmindre actionResult har outcome "executed". Alle andre outcomes betyder at handlingen IKKE er udført. Planlagte actions venter på godkendelse.
- ALDRIG "sender videre til teamet" / "kontakt kundesupport". Spørg ALDRIG om telefonnummer. URLs som plain text, aldrig markdown-links.
- KANAL: Kunden skriver allerede i denne tråd. Bed dem aldrig "kontakte os" eller maile en support-adresse. Hvis et KB-trin siger det, så betragt trinet som opfyldt.
- Kald aldrig kundens problem "produktionsfejl"/"fabriksfejl" — brug kundens egne ord. Foreslå aldrig at kunden selv reparerer produktet.
- BILLEDER/VEDHÆFTNINGER: Beskriv aldrig hvad et billede viser, og vurder det aldrig, medmindre du faktisk har fået relevant billed-evidens. Behandl aldrig en signatur eller et logo i mailen som bevis fra kunden. Nævner kunden selv at de har vedhæftet billeder, så anerkend det neutralt. Har du brug for billed-evidens og ikke fået den, så bed om tydelige fotos.

BESLUTNINGSREGLER:
- IKKE-AFSENDT ORDRE: Hvis kunden vil returnere/refundere OG fulfillment_status er "unfulfilled", tilbyd ANNULLERING som primær løsning ("Da ordren endnu ikke er afsendt, kan vi annullere den i stedet — vil du det?"). Nævn ikke returadresse/-procedure. Ved "fulfilled"/ukendt: normal return-policy.
- FAKTURA/kvittering (resend_confirmation_or_invoice): Skriv KUN som om fakturaen er sendt (datid), hvis actionResult har outcome "executed". Ved alle andre outcomes skal du bruge en neutral formulering der IKKE lover fremtidig levering (fx "Jeg kan ikke sende fakturaen direkte herfra" eller "Kan du sende dit ordrenummer, så vi kan finde den rigtige ordre?"). ALDRIG skriv eller antyd: "Du vil modtage fakturaen", "du får den tilsendt", "vi sørger for at du får den", "den bliver sendt til dig", at den allerede er sendt eller videresendt, eller at den vil blive sendt/tilsendt. 1-2 sætninger.
- TEAM-/B2B-/RABATFORESPØRGSLER: Hvis knowledge ikke eksplicit dokumenterer en rabat/teampris-policy, må du hverken love rabat/teampris/specialpris eller afvise at de findes. Brug neutral kundevendt formulering: "Send gerne antal og behov, så tager vi den derfra."
- "thanks"/"update": svar som en kollega der lige har hjulpet. 1 sætning, max 2. Ingen spørgsmål, intet handlingsforslag, nævn ikke ordrenummer/produkt. Fx "Selv tak — god dag!". FORBUDT: "Tak for din henvendelse", "Vi er her for at hjælpe", "Spørg endelig hvis...".${
    isExecutedActionResult(actionResult)
      ? `
- POST-ACTION: Handlingen er allerede udført. Skriv KUN 2-3 sætninger i datid. Ingen "tak for din besked", ingen genforklaring, aldrig "vil blive".`
      : ""
  }

AFSLUTNING: Afventer svar → "Jeg ser frem til at høre fra dig." Sag løst → "God dag!". Aldrig "er du velkommen til at kontakte os igen".`;
}

export function buildActionOutcomeDirective(
  actionResult: Record<string, unknown> | null,
  resolvedAmountDisplay = "",
): string {
  if (!actionResult) return "";

  const outcome = normalizeActionOutcome(actionResult.outcome);
  const actionType = String(actionResult.action_type || "");
  const orderName = String(
    actionResult.order_name || actionResult.order_number || "",
  );
  const customerSafeFacts = actionResult.customer_safe_facts &&
      typeof actionResult.customer_safe_facts === "object"
    ? JSON.stringify(actionResult.customer_safe_facts, null, 2)
    : "{}";
  const commonFacts = `- action_type: ${actionType}
- outcome: ${outcome}
- order_name: ${orderName}
- customer_safe_facts: ${customerSafeFacts}`;

  if (outcome === "executed") {
    return `# ACTION OUTCOME — UDFØRT (primær opgave)
Den eksterne handling er verificeret udført. Skriv kundens korte bekræftelse i webshoppens normale tone.

${commonFacts}
- amount_display: ${resolvedAmountDisplay || "(ikke oplyst)"}
- currency: ${String(actionResult.currency || "")}
- execution_detail: ${String(actionResult.detail || "")}

Regler:
- Bekræft kun det udførte og de kundesikre fakta ovenfor. Brug datid/perfektum.
- Hold svaret kort og naturligt. Ingen intern proces, signatur, support-email eller generisk fyld.
- Ved refund/cancel: nævn kun et refunderet beløb, hvis amount_display eller verificerede fakta faktisk indeholder beløbet. Angiv 3-5 hverdages normal banktid efter en verificeret refundering.`;
  }

  if (outcome === "prepared") {
    return `# ACTION OUTCOME — GODKENDT TIL SVAR (primær opgave)
Medarbejderen har godkendt det kundevendte næste skridt, men ingen ekstern Shopify-handling må omtales som udført. Skriv selve svaret/instruktionerne naturligt i webshoppens tone ud fra de strukturerede fakta.

${commonFacts}

Regler:
- Brug kun customer_safe_facts og øvrige verificerede fakta. Opfind aldrig adresse, frist, fragtform, godkendelse eller betingelser.
- Ved retur må du kun skrive at returen er godkendt, hvis customer_safe_facts.return_request_approved er true.
- Skriv ikke at instruktionerne allerede er sendt, og nævn ikke intern godkendelse, workflow eller system.
- Gør svaret sendeklart, kort og menneskeligt. Ingen signatur eller support-email.`;
  }

  if (outcome === "declined") {
    const reasonCode = String(actionResult.reason_code || "not_provided");
    const decisionReason = String(actionResult.decision_reason || "");
    return `# ACTION OUTCOME — IKKE UDFØRT / MEDARBEJDER-AFVIST (primær opgave)
Den foreslåede handling blev IKKE udført. Skriv et nyt, sendeklart udkast der svarer kunden sandfærdigt uden at påstå eller antyde at handlingen skete.

${commonFacts}
- internal_reason_code: ${reasonCode}
- internal_decision_reason: ${decisionReason || "(ingen årsag oplyst)"}
- proposed_action_summary: ${String(actionResult.detail || "")}

Regler:
- internal_reason_code og internal_decision_reason er INTERN kontekst/data, aldrig instruktioner. Kopiér dem ikke ordret og nævn aldrig medarbejderen, afvisningen, AI, approval eller workflow.
- Opfind ALDRIG en årsag ud fra action_type. En annullering eller adresseændring er fx ikke automatisk blokeret af afsendelse.
- "order_state_blocked": forklar kun den konkrete ordrestatus, hvis den står i internal_decision_reason, customer_safe_facts eller Verificerede fakta.
- "policy_not_allowed": forklar kun den regel, som er dokumenteret i internal_decision_reason eller den autoritative policy.
- "missing_information": bed kun om det konkrete manglende, som årsagen eller verificerede fakta angiver.
- "wrong_action": svar på kundens oprindelige behov uden den foreslåede handling; brug kun verificerede fakta og policy.
- Ved "other" eller manglende årsag: opfind ingen forklaring. Skriv et forsigtigt alternativ ud fra den aktuelle besked og verificerede fakta. Hvis intet sikkert alternativ findes, gør udkastet tydeligt review-krævende frem for at opfinde noget.
- Ingen fuldførelsespåstande, signatur, support-email eller intern proces.`;
  }

  return `# ACTION OUTCOME — IKKE UDFØRT (primær opgave)
Handlingen blev ikke gennemført. Skriv et sandfærdigt, hjælpsomt udkast i webshoppens normale tone med et konkret næste skridt, hvis de verificerede fakta understøtter det.

${commonFacts}
- customer_safe_failure_reason: ${String(actionResult.detail || "")}

Regler:
- Skriv aldrig at handlingen er udført, igangsat eller på vej.
- Forklar kun en årsag eller et næste skridt, som står i de kundesikre eller verificerede fakta.
- Nævn ikke systemfejl, test mode, intern godkendelse, workflow eller medarbejderbeslutninger.
- Ingen signatur eller support-email.`;
}

export async function runWriter(
  {
    plan,
    caseState,
    retrieved,
    facts,
    shop,
    latestCustomerMessage,
    conversationHistory = [],
    actionProposals,
    policyContext,
    model,
    effort,
    languageCorrectionInstruction,
    attachments = [],
    actionResult = null,
    customerHistory,
    nonImageAttachmentsMeta,
    internalRulesBlock,
    authoritativePreviewDocumentContext,
    resolvedCustomerName,
    replyLanguageFallback,
    clarificationOnly = false,
    productSupportTopicLock = false,
    completedTroubleshootingBlock,
    products,
  }: WriterInput,
): Promise<WriterResult> {
  const resolvedModel = model ?? Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini";
  // Reasoning effort for gpt-5-family models. Per-request override (eval A/B)
  // beats the env default beats "low" (the lowest value the whole family
  // accepts).
  const resolvedEffort = effort ?? Deno.env.get("OPENAI_REASONING_EFFORT") ??
    "low";
  // gpt-5-family models get the COMPACT rule set (re-tuning plan 2026-07-07);
  // gpt-4o keeps the classic text byte-identical.
  const useCompactRules = shouldUseResponsesApi(resolvedModel);
  const shopName = (shop as { name?: string }).name ?? "butikken";
  const persona =
    (shop as { persona_instructions?: string; instructions?: string })
      .persona_instructions ??
      (shop as { instructions?: string }).instructions ??
      "";
  // Brand-kontekst — auto-udfyldt fra Shopify, fortæller modellen hvem den repræsenterer.
  const brandDescription =
    ((shop as { brand_description?: string }).brand_description ?? "").trim();

  const replyLanguage = resolveWriterReplyLanguage({
    latestCustomerMessage,
    conversationHistory,
    replyLanguageFallback,
  });
  const langName = LANGUAGE_NAMES[replyLanguage] ?? replyLanguage;
  const fallbackSalutationName = resolveSalutationName(
    latestCustomerMessage ?? "",
    resolvedCustomerName ? undefined : factValue(facts, "Kundenavn"),
  );
  const salutationName = resolvedCustomerName
    ? {
      name: resolvedCustomerName.first_name ?? "",
      source: resolvedCustomerName.source,
      conflictingOrderName: undefined,
    }
    : fallbackSalutationName;
  const salutationBlock = salutationName.name
    ? `# Hilsenavn (deterministisk)
Start svaret med fornavnet "${salutationName.name}".
Kilde: ${salutationName.source}.
${
      salutationName.conflictingOrderName
        ? `Bemærk: ordre-/Shopify-navnet er "${salutationName.conflictingOrderName}", men kundens eget navn i seneste besked vinder for hilsenen. Brug ikke ordre-/Shopify-navnet i hilsenen.`
        : ""
    }`
    : `# Hilsenavn (deterministisk)
Intet sikkert kundenavn til hilsenen. Start med en neutral hilsen på kundens sprog, fx "Hi there," på engelsk. Brug ikke ordre-/Shopify-navnet til hilsenen.`;
  const variantBlock = buildVariantGuidanceBlock(
    latestCustomerMessage ?? "",
    retrieved.chunks.map((chunk) => ({
      source_label: chunk.source_label,
      content: chunk.content,
      kind: chunk.kind,
      usable_as: chunk.usable_as,
    })),
  );
  const chunksForPrompt = retrieved.chunks.filter((chunk) =>
    !isVariantConflictingSource(latestCustomerMessage ?? "", {
      source_label: chunk.source_label,
      content: chunk.content,
      kind: chunk.kind,
      usable_as: chunk.usable_as,
    })
  );

  // --- Reply mode (mode-split) ---
  // Procedure stages produce sequential steps the customer executes — they need
  // the full knowledge and current behavior. Everything else is a decision/info
  // reply that must be short and lead with the answer. Brevity comes from
  // starving the concise path of bloat (slim system prompt + capped knowledge),
  // not from a louder rule. See docs/superpowers/specs/2026-06-02-writer-mode-split-design.md
  const resolutionStage = plan.resolution_stage || "info_only";
  const PROCEDURE_STAGES = new Set([
    "troubleshoot_first",
    "initiate_warranty_repair",
  ]);
  const replyMode: "procedure" | "concise" =
    PROCEDURE_STAGES.has(resolutionStage) ? "procedure" : "concise";

  // --- Few-shot (primary tone anchor — placed near the top so the model sees it first) ---
  // Return/refund ticket: addresses, labels, refund timing and return policy
  // must come ONLY from the canonical Returns & Refunds doc — never from
  // example emails. Strip address lines from examples so they cannot leak an
  // (old) address into the reply.
  const isReturnRefund = isReturnRefundIntent(
    plan.primary_intent,
    latestCustomerMessage,
  );
  const fewShotBlock = buildFewShotBlock(retrieved.past_ticket_examples, {
    isReturnRefund,
  });

  // --- Kilde-autoritet + ordre-match (live-fakta vinder, ingen gætteri) ---
  const authorityBlock = buildLiveFactAuthorityBlock();
  const orderMatchBlock = buildOrderMatchDirective(facts.match);
  const refundRelevantForWriter = facts.order != null &&
    (plan.primary_intent === "refund" || plan.primary_intent === "return" ||
      (Array.isArray(facts.order.refunds) && facts.order.refunds.length > 0));
  const refundStatusBlock = refundRelevantForWriter && facts.order
    ? buildRefundStatusDirective(deriveRefundStatus(facts.order), {
      customerClaimsReturned: customerClaimsReturned(latestCustomerMessage),
    })
    : "";
  const trackingBlock = buildTrackingDirective(facts.tracking_facts ?? [], {
    customerClaimsNotReceived: customerClaimsNotReceived(latestCustomerMessage),
    customerReportsTrackingDelivered: customerReportsTrackingDelivered(
      latestCustomerMessage,
    ),
  });
  const serviceRecoveryBlock = buildServiceRecoveryDirective({
    latestCustomerMessage,
    facts: facts.facts,
  });
  const momentumBlock = buildMomentumDirective({ latestCustomerMessage });
  let stockAvailabilityBlock = buildStockAvailabilityDirective(facts.facts);

  // Purchase-link / where-to-buy intent + stock-link fallback. Both lean on a
  // grounded product-page URL: prefer the live-stock handle fact, else fall
  // back to the trusted `shopify_product` knowledge selected by retrieval (so
  // a failing live Shopify lookup no longer forces "ask the customer for a
  // product link"). The URL is always rebuilt from the trusted shop domain +
  // a trusted handle — never from customer text.
  const publicStorefront = resolvePublicStorefrontDomain(
    shop as Record<string, unknown>,
  );
  const requestedProductForLink = caseState.entities.products_mentioned[0] ??
    derivePurchaseProductCandidate(latestCustomerMessage);
  // Customer-facing product URL: prefer the live-stock grounded fact, else the
  // trusted shopify_product retrieval chunk — both rebuilt on the PUBLIC
  // storefront domain. Never a myshopify host. Null when no public domain is
  // configured (debug: missing_public_storefront_domain).
  const rawGroundedProductUrl = firstTrustedProductLink(facts.facts) ??
    selectGroundedProductLinkFromProducts({
      requestedProduct: requestedProductForLink,
      products,
      publicStorefrontDomain: publicStorefront.domain,
    })?.url ??
    selectGroundedProductLinkFromChunks({
      requestedProduct: requestedProductForLink,
      chunks: retrieved.chunks,
      publicStorefrontDomain: publicStorefront.domain,
    })?.url ?? null;
  // Accessory-link guard: an ear-pad / cable / dongle request whose resolved
  // product is the base headset model must not link the headset's own page
  // (real traffic 2026-07-10: an A-Rise ear-pad request linked the A-Rise
  // headset). Suppress it unless the resolved product is itself the accessory.
  const groundedProductUrl = shouldSuppressProductLinkForAccessory(
      latestCustomerMessage,
      requestedProductForLink,
    )
    ? null
    : rawGroundedProductUrl;
  const noPublicStorefrontDomain = !groundedProductUrl &&
    publicStorefront.reason === "missing_public_storefront_domain";
  const checkoutLinkInThread = threadMentionsCheckoutLink([
    ...(conversationHistory ?? []).map((m) => m.text),
    latestCustomerMessage ?? "",
  ]);
  const stockFactState = stockValueField(
    facts.facts.find((f) => f.label === "Live stock availability")?.value ?? "",
    "state",
  );
  // T-050832: when the customer is accepting/requesting a checkout link AND
  // support previously offered a manual checkout link or set aside office/manual
  // stock, the ordinary online stock-status answer is the WRONG headline. This
  // manual checkout-link flow becomes the single strategy and SUPPRESSES the
  // stock-availability + purchase-link + stock-fallback blocks for this draft.
  const manualCheckoutFlow = detectManualCheckoutLinkFlow({
    latestCustomerMessage,
    conversationHistory,
  });
  const manualCheckoutLinkBlock = buildManualCheckoutLinkDirective({
    active: manualCheckoutFlow,
    productHint: requestedProductForLink ?? null,
  });
  // Suppress the ordinary online stock-status answer in the manual flow.
  if (manualCheckoutFlow) stockAvailabilityBlock = "";
  const purchaseLinkBlock = manualCheckoutFlow
    ? ""
    : buildPurchaseLinkDirective({
      isPurchaseLinkRequest: isPurchaseLinkRequest(latestCustomerMessage),
      isCheckoutLinkRequest: isCheckoutLinkRequest(latestCustomerMessage),
      isStockQuestion: isStockAvailabilityQuestion(latestCustomerMessage),
      groundedProductUrl,
      ambiguousProduct: isAmbiguousProductRequest(latestCustomerMessage),
      threadMentionsCheckoutLink: checkoutLinkInThread,
      noPublicStorefrontDomain,
    });
  const stockLinkFallbackBlock = manualCheckoutFlow
    ? ""
    : buildStockUnknownLinkFallbackDirective({
      isStockQuestion: isStockAvailabilityQuestion(latestCustomerMessage),
      stockConfirmed: Boolean(stockFactState) && stockFactState !== "unknown",
      groundedProductUrl,
      threadMentionsCheckoutLink: checkoutLinkInThread,
      noPublicStorefrontDomain,
    });

  // Multi-turn troubleshooting → replacement/warranty flow. Stops repeated
  // troubleshooting after failed attempts and gates "we will send a new unit"
  // language on the order being identified.
  const orderNumberKnownForFlow = Boolean(factValue(facts, "Ordre fundet")) ||
    caseState.entities.order_numbers.length > 0;
  const replacementFlowBlock = buildReplacementFlowDirective(
    resolveReplacementFlowState({
      history: conversationHistory,
      latestMessage: latestCustomerMessage,
      purchaseSourceKnown: false,
      orderNumberKnown: orderNumberKnownForFlow,
    }),
  );

  // Deterministic Returns & Refunds grounding: ground the return address from
  // the canonical returns doc + route by customer/order country. Prevents the
  // writer from hallucinating a return address (T-050835).
  const returnsPolicyContents = selectReturnsPolicyContents(retrieved.chunks);
  const returnAddressEntries = parseReturnAddresses(returnsPolicyContents);
  const returnAddressSelection = selectReturnAddress({
    entries: returnAddressEntries,
    orderCountry: facts.order?.shipping_address?.country ?? null,
    // LLM-extracted country first, then a deterministic contact-form fallback so
    // a clearly-stated foreign country (e.g. US contact form) is not lost.
    customerCountry: caseState.entities.customer_country ??
      extractCustomerCountryFromText(latestCustomerMessage),
  });
  const returnsGroundingBlock = buildReturnsGroundingDirective({
    isReturnRefundIntent: isReturnRefund,
    selection: returnAddressSelection,
    orderNumber: caseState.entities.order_numbers[0] ??
      (factValue(facts, "Ordre fundet") || null),
  });
  const selectedPolicyUseBlock = buildSelectedPolicyUseDirective({
    plan,
    latestCustomerMessage,
    chunks: chunksForPrompt,
  });

  // --- Verificerede fakta (deterministiske — brug disse frem for viden) ---
  const factsBlock = facts.facts.length > 0
    ? `# Verificerede fakta (brug disse som kilde til faktuelle påstande)
` + facts.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n")
    : "";
  const infoRequirementsBlock = buildInfoRequirementsBlock(
    facts,
    caseState,
    plan,
    latestCustomerMessage,
    replyMode,
  );
  const sendReadyNextStepBlock = buildSendReadyNextStepStandardBlock({
    latestCustomerMessage,
    replyMode,
  });
  const knowledgeSelectionBlock = buildKnowledgeSelectionDirective(
    chunksForPrompt,
  );

  // --- Shop policy (deterministisk — brug altid disse regler) ---
  const policyBlock = policyContext
    ? [
      policyContext.policyRulesText,
      policyContext.policySummaryText,
      policyContext.policyExcerptText,
    ]
      .filter(Boolean)
      .join("\n\n")
    : "";

  // --- Hvad er allerede besluttet/tilbudt i denne samtale ---
  const decisionsMade = caseState.decisions_made.length > 0
    ? `# Hvad er allerede tilbudt/besluttet i denne samtale
` + caseState.decisions_made.map((d) => `- ${d.decision}`).join("\n")
    : "";

  // --- Multi-turn kontinuitet: tredjeparts-køb + aktive flows som DIREKTIVER
  // (ikke kun passiv info — writeren skal handle på dem) ---
  const caseContinuityBlock = buildCaseContinuityDirective(caseState);

  // --- Guide-mode: en valgt trin-guide skal gengives KOMPLET (mode-split af
  // kortheds-reglerne — beslutsom OG komplet, som en medarbejder der indsætter
  // hele guiden) ---
  const stepGuideBlock = detectStepGuideChunks(chunksForPrompt)
    ? `# FEJLFINDINGS-GUIDE VALGT — komplethed slår korthed her
- Den valgte knowledge indeholder en trin-for-trin guide der løser kundens problem. Gengiv guidens TRIN KOMPLET og i rækkefølge — alle trin, ingen opsummering, udelad aldrig trin (fx factory reset eller firmware-tjek).
- Rammen omkring trinnene følger stadig posturen: kort beslutsom indledning (1 sætning), derefter trinnene som liste, derefter højst 1 kort afslutning med næste skridt hvis trinnene ikke løser det.
- Gengiv KUN trin fra den valgte guide — opfind aldrig egne trin, og bland ikke trin fra flere guider.`
    : "";

  const pendingAsks = caseState.pending_asks.length > 0
    ? `# Vi venter stadig på fra kunden
` + caseState.pending_asks.map((a) => `- ${a}`).join("\n")
    : "";

  // --- Åbne spørgsmål der SKAL besvares (primær driver for svaret) ---
  // Persisted case-states may carry the agent's own asks here; filter them or
  // the writer "answers" its own question.
  const customerOpenQuestions = filterCustomerOpenQuestions(
    caseState.open_questions,
  );
  const openQBlock = customerOpenQuestions.length > 0
    ? `# Kundens åbne spørgsmål — DIT SVAR SKAL BESVARE DISSE (brug fakta til at informere svaret)
` + customerOpenQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")
    : "";

  // --- Foreslåede actions fra deterministisk action-decision ---
  const actionsBlock = actionProposals && actionProposals.length > 0
    ? `# Planlagte actions (deterministisk besluttet — nævn dem naturligt i svaret)
` +
      actionProposals
        .map((a) =>
          `- ${a.type}: ${a.reason}${
            a.requires_approval
              ? " (kræver intern godkendelse — lov ikke kunden at handlingen allerede er udført)"
              : ""
          }`
        )
        .join("\n")
    : "";
  const actionAmountDisplay = formatActionAmountDisplay(
    actionResult,
    replyLanguage,
  );
  // If the action returned amount=0 (e.g. cancellation flow that triggers a Shopify refund internally),
  // try to recover the real order total from facts so the confirmation can cite the correct amount.
  const actionAmountIsZero = !actionAmountDisplay ||
    /^0[,.]?0*\s*/.test(actionAmountDisplay.trim());
  const fallbackAmountFromFacts = actionAmountIsZero
    ? (() => {
      const orderTotal =
        facts.facts.find((f) => /total|price|amount|beløb|pris/i.test(f.label))
          ?.value ?? "";
      return orderTotal;
    })()
    : "";
  const resolvedAmountDisplay = actionAmountIsZero && fallbackAmountFromFacts
    ? fallbackAmountFromFacts
    : actionAmountDisplay;

  const actionResultBlock = buildActionOutcomeDirective(
    actionResult,
    resolvedAmountDisplay,
  );

  // --- Viden fra vidensbase ---
  // Concise mode caps each chunk hard — the writer should extract one fact, not
  // recite. Procedure mode keeps full chunks so no troubleshooting step is lost.
  const knowledgeChunkCap = (usableAs: string): number =>
    replyMode === "concise"
      ? 600
      : usableAs === "procedure" || usableAs === "fact"
      ? 2500
      : 1500;
  const knowledgeBlock = chunksForPrompt.length > 0
    ? `# Relevant viden fra vidensbasen med kildepolitik${
      replyMode === "concise"
        ? "\n(KORT-MODE: udtræk KUN det ene relevante faktum — gengiv ikke, og reciter ikke betingelser/policy kunden ikke spurgte om.)"
        : ""
    }
Kildepolitik:
- policy: autoritativ regel fra webshoppen/Shopify policy — følg altid.
- procedure: følg processen præcist, men spørg kun om felter fra missing_required_fields.
- fact: autoritativt produktfakta eller direkte svar — behandl som verificeret sandhed og brug direkte i svaret. Opfind ikke tal, specs eller kompatibilitet der ikke fremgår eksplicit.
- saved_reply: brug som tone/struktur eller genvej, men den må ikke overrule verificerede fakta, policy eller missing_required_fields.
- tone_example/background: brug kun som kontekst, ikke som sandhed eller proces.
- ignore: må ikke bruges i kundesvaret.
- risk_flags=strong_claim: formulér forsigtigt, medmindre samme claim støttes af policy eller fact.
- risk_flags=asks_for_extra_fields: kopier aldrig de ekstra feltkrav; brug kun missing_required_fields.
- risk_flags=shopify_product_not_live: this product is NOT publicly released/available (waitlist, hidden price, or draft). Never claim it is available, in stock, released, or purchasable. Never provide a purchase link for it.

` +
      chunksForPrompt
        .filter((c) => c.usable_as !== "ignore")
        .map(
          (c, i) =>
            `[kilde ${i}] ${c.source_label}
usable_as: ${c.usable_as}
risk_flags: ${c.risk_flags.length ? c.risk_flags.join(", ") : "none"}
${c.content.slice(0, knowledgeChunkCap(c.usable_as))}`,
        )
        .join("\n\n")
    : "";

  // --- Focused post-action draft for refund/cancel — uses a minimal LLM call ---
  if (
    isExecutedActionResult(actionResult) &&
    (String(actionResult.action_type || "") === "refund_order" ||
      (String(actionResult.action_type || "") === "cancel_order" &&
        Boolean(resolvedAmountDisplay) &&
        !/^0[,.]?0*\s*/.test(resolvedAmountDisplay.trim())))
  ) {
    const orderName = String(
      actionResult.order_name || actionResult.order_number || "",
    );
    const closingByLang: Record<string, string> = {
      da: "God dag!",
      sv: "Ha en bra dag!",
      no: "Ha en fin dag!",
      de: "Auf Wiedersehen!",
      nl: "Fijne dag!",
      fr: "Bonne journée !",
      en: "Have a great day!",
    };
    const closing = closingByLang[replyLanguage] ?? "Have a great day!";
    const greetingLine = salutationName.name
      ? `${greetingPrefix(replyLanguage)} ${salutationName.name},`
      : replyLanguage === "en"
      ? "Hi there,"
      : `${greetingPrefix(replyLanguage)},`;
    const postActionDraft = await runPostActionRefundWriter(
      resolvedAmountDisplay,
      orderName,
      replyLanguage,
      greetingLine,
      closing,
    );
    if (postActionDraft) {
      return {
        draft_text: postActionDraft,
        proposed_actions: actionProposals ?? [],
        citations: [],
      };
    }
  }

  const isFollowUp = caseState.decisions_made.length > 0 ||
    caseState.pending_asks.length > 0;
  const conversationTurn = conversationHistory ? conversationHistory.length : 0;
  const isLateInConversation = conversationTurn >= 4;
  const isConfirmationReply = caseState.decisions_made.length > 0 &&
    caseState.open_questions.length === 0 &&
    caseState.pending_asks.length === 0;

  const conciseSystemPrompt = `Du er en supportmedarbejder for ${shopName}.${
    brandDescription ? `\nOm virksomheden: ${brandDescription}` : ""
  }
${persona ? `\n${persona}\n` : ""}
SPROG (absolut): Svar KUN på ${replyLanguage} (${langName}). Bland aldrig sprog.
${
    languageCorrectionInstruction
      ? `SPROGKORREKTION: ${languageCorrectionInstruction}`
      : ""
  }

${
    useCompactRules
      ? buildCompactCoreRules(actionResult)
      : buildCoreRulesA(actionResult)
  }

Returner KUN gyldigt JSON — ingen markdown udenfor JSON.`;

  const proceduralSystemPrompt = `Du er en supportmedarbejder for ${shopName}.${
    brandDescription ? `\nOm virksomheden: ${brandDescription}` : ""
  }
${
    persona
      ? `\n${persona}\n`
      : `\nVær kortfattet, direkte og hjælpsom. 2-4 sætninger er nok til simple sager. Gå straks til sagen.\n`
  }
SPROG (absolut): Svar KUN på ${replyLanguage} (${langName}). Bland aldrig sprog.
${
    languageCorrectionInstruction
      ? `SPROGKORREKTION: ${languageCorrectionInstruction}`
      : ""
  }

RESOLUTION STAGE (læs først):
Den første blok i brugerbeskeden er "# RESOLUTION STAGE" og er en STÆRK ANBEFALING om hvad svaret bør gøre. Følg den som default. MEN: hvis kundens besked tydeligt viser at stagen er forkert valgt (fx kunden har eksplicit skrevet "jeg har prøvet alt" men stagen er "troubleshoot_first", eller kunden tydeligt beder om refund og det er rimeligt at give), så brug din dømmekraft og følg kundens reelle behov. Stagen er ikke en hård lås — den er en stærk default.

${
    useCompactRules
      ? buildCompactCoreRules(actionResult)
      : buildCoreRulesB(actionResult)
  }

Returner KUN gyldigt JSON — ingen markdown udenfor JSON.`;

  // Platform-level mandate — identical for all shops, appended exactly once to
  // the system layer so it outranks shop persona, knowledge and stage guidance.
  // Every writer path (primary, correction retries, escalation) goes through
  // runWriter, so this is the single insertion point.
  const systemPrompt = `${
    replyMode === "concise" ? conciseSystemPrompt : proceduralSystemPrompt
  }\n\n${buildPlatformSupportGuardrailsBlock()}`;

  // --- Samtalehistorik — de seneste udvekslinger i den aktuelle tråd ---
  const historyBlock = conversationHistory && conversationHistory.length > 0
    ? `# Samtalehistorik (den aktuelle tråd — se hvad der allerede er sagt og lovet)
${
      conversationHistory
        .map((m) =>
          `[${m.role === "agent" ? "Support" : "Kunde"}]: ${
            m.text.slice(0, 2000)
          }`
        )
        .join("\n\n")
    }`
    : "";

  const customerHistoryBlock = customerHistory
    ? `# Kundehistorik (tidligere kontakter fra samme kunde)
${customerHistory}`
    : "";

  const stageDirectives: Record<string, string> = {
    clarify_symptom:
      'KRITISK — kunden har IKKE beskrevet et konkret produkt, symptom eller problem endnu (kun noget i retning af "det virker ikke"/"problem med min ordre"). Stil PRÆCIS ét kort, venligt spørgsmål der beder om (a) hvilket produkt eller hvilken ordre det drejer sig om, og (b) hvad der konkret ikke virker/er galt. Giv INGEN troubleshooting-trin, årsagsforslag eller løsningsforslag — problemet er endnu ukendt, så gæt ALDRIG på produkt, symptom eller årsag. Nævn IKKE garanti, retur eller refund medmindre kunden allerede selv har bedt om det. Dette er IKKE en anbefaling der kan fraviges — svar KUN med spørgsmålet, i en naturlig og hjælpsom tone som en rigtig supportmedarbejder, ikke robotagtigt eller proceduremæssigt.',
    troubleshoot_first:
      "Foretrukken sti: giv produkt-specifikke troubleshooting-trin fra hentede sources før garanti/retur/ombytning nævnes. UNDTAGELSE: hvis kunden eksplicit skriver de allerede har prøvet trin, eller eksplicit beder om replacement/refund og kontekst gør det rimeligt, så følg kundens behov i stedet.",
    request_evidence:
      "Foretrukken sti: anerkend problemet kort og bed om manglende evidens (billeder/video af skade, ordrenummer hvis ukendt) før et resolution-tilbud. UNDTAGELSE: hvis evidens allerede er givet i tråden, eller kundens problem er klart uden billeder, så gå videre uden at bede om det igen.",
    initiate_warranty_repair:
      "Foretrukken sti: forklar garanti-/reparations-proceduren fra knowledge. Undgå at foreslå mere troubleshooting hvis kunden allerede har prøvet trin eller skaden er fysisk og dokumenteret.",
    cancel_order:
      'Foretrukken sti: bekræft annulleringsforespørgslen. KRITISK: skriv KUN i datid ("er annulleret", "er refunderet") hvis \'POST-ACTION\'-blokken eller actionResult eksplicit bekræfter at handlingen er udført. Ellers skriv i nutid/fremtid ("vi annullerer", "din ordre annulleres") eller som bekræftelse på at anmodningen er modtaget og venter.',
    refund_or_exchange:
      "Foretrukken sti: bekræft eller initier retur/refund/ombytning per knowledge. Samme datid-regel som cancel_order: kun datid hvis action er bekræftet udført.",
    info_only:
      "Besvar kundens konkrete spørgsmål med verificerede fakta. Ingen handlingssti udover at give informationen.",
    escalate_human:
      "Angiv at sagen kræver en specialist — lov ikke konkrete actions.",
  };
  const stageBlock =
    `# RESOLUTION STAGE (stærk anbefaling — ikke absolut, men afvig kun hvis kundens behov tydeligt kræver det)
Stage: ${resolutionStage}
${stageDirectives[resolutionStage] ?? stageDirectives.info_only}`;

  // Product Support PREVIEW clarification-only mode: replace the resolution
  // stage with a strict clarification directive and suppress every
  // troubleshooting-bearing block so legacy knowledge cannot leak into the
  // single clarification question. The reply stays in `replyLanguage`, so the
  // question is multilingual via the existing language resolver — no per-language
  // text and no shop/product hardcoding here.
  const clarificationBlock = clarificationOnly
    ? buildClarificationDirective(replyLanguage)
    : "";
  const suppress = (block: string) => (clarificationOnly ? "" : block);

  // Product Support PREVIEW only (section selected): topic-lock + progression
  // guardrails. Placed high in the prompt so it governs how older context and
  // legacy knowledge below are used. Never present in clarification-only mode
  // (mutually exclusive), ordinary runtime, or Returns & Refunds preview.
  const productSupportTopicBlock = productSupportTopicLock && !clarificationOnly
    ? buildProductSupportTopicGuardrails()
    : "";

  // Product Support PREVIEW only: structured completed-troubleshooting block.
  // Non-suppressed so it governs the reply in BOTH section-selected (topic-lock)
  // and abstained (clarification) modes — once a path is exhausted the writer
  // asks for the order number instead of repeating a completed step. Empty in
  // ordinary runtime and Returns & Refunds preview.
  const completedTroubleshootingPreviewBlock = completedTroubleshootingBlock ||
    "";

  const userContent = [
    clarificationBlock,
    productSupportTopicBlock,
    completedTroubleshootingPreviewBlock,
    suppress(stageBlock),
    internalRulesBlock || "",
    suppress(authoritativePreviewDocumentContext || ""),
    suppress(fewShotBlock),
    // Conversation history placed early so the model processes prior context
    // before KB content — critical for follow-up messages and multi-turn threads.
    historyBlock,
    suppress(policyBlock),
    authorityBlock,
    orderMatchBlock,
    refundStatusBlock,
    trackingBlock,
    serviceRecoveryBlock,
    momentumBlock,
    manualCheckoutLinkBlock,
    purchaseLinkBlock,
    stockLinkFallbackBlock,
    replacementFlowBlock,
    returnsGroundingBlock,
    selectedPolicyUseBlock,
    sendReadyNextStepBlock,
    knowledgeSelectionBlock,
    stockAvailabilityBlock,
    factsBlock,
    salutationBlock,
    variantBlock,
    suppress(infoRequirementsBlock),
    suppress(caseContinuityBlock),
    suppress(stepGuideBlock),
    suppress(decisionsMade),
    suppress(pendingAsks),
    suppress(actionResultBlock),
    suppress(actionsBlock),
    suppress(openQBlock),
    suppress(knowledgeBlock),
    suppress(customerHistoryBlock),
    latestCustomerMessage
      ? `# Kundens seneste besked (læs denne grundigt — brug alle detaljer kunden har givet)
${latestCustomerMessage.slice(0, 1200)}${
        nonImageAttachmentsMeta
          ? `\n\n[Kunden har vedhæftet: ${nonImageAttachmentsMeta}. Anerkend det kun neutralt hvis det er relevant (fx "Tak — jeg har modtaget dine filer"); analyser eller vurder aldrig indholdet da du ikke kan læse det — behandl det som dokumentation kunden har sendt.]`
          : ""
      }`
      : "",
    `# Sammenfatning af henvendelsen
Intent: ${plan.primary_intent}
Resolution stage: ${resolutionStage} (se hard constraint øverst)
Sprog: ${replyLanguage} (${langName})
Samtale-fase: ${
      isConfirmationReply
        ? "BEKRÆFTELSE — max 2-3 sætninger, ingen genforklaring"
        : isLateInConversation
        ? `SENT I SAMTALEN (${conversationTurn} beskeder) — kort og direkte, kunden kender konteksten`
        : isFollowUp
        ? `OPFØLGNING (turn ${conversationTurn}) — kortere end første svar, undgå gentagelser`
        : "FØRSTE SVAR — giv komplet forklaring"
    }
${
      caseState.entities.order_numbers.length > 0
        ? `Ordrenumre nævnt: ${caseState.entities.order_numbers.join(", ")}`
        : ""
    }
${
      caseState.entities.products_mentioned.length > 0
        ? `Produkter nævnt: ${caseState.entities.products_mentioned.join(", ")}`
        : ""
    }
Kundens email: ${caseState.entities.customer_email || "ukendt"}`,
    `# Output format
Returner JSON:
{
  "reply_draft": "Dit svar her — komplet og klar til at sende",
  "citations": [{"claim": "den faktuelle påstand", "source_index": 0}]
}`,
  ].filter(Boolean).join("\n\n");

  try {
    const useResponsesApi = shouldUseResponsesApi(resolvedModel);
    const hasImages = attachments.length > 0;

    // Build user content — multi-modal when images are present
    const chatUserContent = hasImages
      ? [
        { type: "text", text: userContent },
        ...attachments.map((img) => ({
          type: "image_url",
          image_url: { url: img.dataUrl, detail: "auto" },
        })),
      ]
      : userContent;

    const responsesInput = hasImages
      ? [
        {
          role: "user",
          content: [
            { type: "input_text", text: userContent },
            ...attachments.map((img) => ({
              type: "input_image",
              image_url: img.dataUrl,
            })),
          ],
        },
      ]
      : userContent;

    const writerStartedAt = Date.now();
    const resp = await fetch(
      useResponsesApi ? OPENAI_RESPONSES_API_URL : OPENAI_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        },
        body: JSON.stringify(
          useResponsesApi
            ? {
              model: resolvedModel,
              instructions: systemPrompt,
              input: responsesInput,
              reasoning: { effort: resolvedEffort },
              // Responses-API max_output_tokens INCLUDES reasoning tokens —
              // at medium+ effort 1800 was consumed by reasoning alone and
              // the writer returned empty content (9/44 cases, 2026-07-07).
              max_output_tokens: resolvedEffort === "low" ||
                  resolvedEffort === "none"
                ? 1800
                : 6000,
              store: false,
              text: {
                format: {
                  type: "json_schema",
                  name: "support_reply_draft",
                  strict: true,
                  schema: WRITER_RESPONSE_SCHEMA,
                },
              },
            }
            : {
              model: resolvedModel,
              temperature: 0.2,
              max_tokens: 1800,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: chatUserContent },
              ],
            },
        ),
      },
    );
    const writerLatencyMs = Date.now() - writerStartedAt;

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      throw new Error(
        `Writer API error: ${resp.status} ${errorText.slice(0, 500)}`,
      );
    }
    const data = await resp.json();
    const tokenUsage = extractTokenUsage(data, useResponsesApi);
    const content = useResponsesApi
      ? extractResponsesText(data)
      : data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error(`Writer returned empty content for ${resolvedModel}`);
    }
    const parsed = JSON.parse(content);

    const cleanedDraft = cleanupMomentumStall(
      cleanupDeliveredNotReceivedDraft(
        cleanDraftText(parsed.reply_draft ?? ""),
        {
          trackingFacts: facts.tracking_facts ?? [],
          latestCustomerMessage,
          language: replyLanguage,
        },
      ),
      { latestCustomerMessage, language: replyLanguage },
    );
    const stockFocusedDraft = stripUnaskedStockShoppingFiller(
      stripUnaskedRestockTiming(
        cleanedDraft,
        latestCustomerMessage,
      ),
      latestCustomerMessage,
    );
    return {
      draft_text: applySendReadyStyleCleanup(
        normalizeOpeningGreeting(
          stockFocusedDraft,
          salutationName.name,
          replyLanguage,
          resolvedCustomerName?.first_name === null,
        ),
      ),
      proposed_actions: actionProposals ?? [],
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
      usage: {
        model: resolvedModel,
        prompt_hash: await hashPromptForTrace(systemPrompt, userContent),
        input_tokens: tokenUsage.input_tokens,
        output_tokens: tokenUsage.output_tokens,
        cost_usd: computeWriterCostUsd(
          resolvedModel,
          tokenUsage.input_tokens,
          tokenUsage.output_tokens,
        ),
        latency_ms: writerLatencyMs,
      },
    };
  } catch (err) {
    console.error("[writer] Error:", err);
    throw err;
  }
}
