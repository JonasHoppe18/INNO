// supabase/functions/generate-draft-v2/stages/retriever.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { Plan } from "./planner.ts";
import { isVariantConflictingSource } from "./customer-context.ts";
import {
  applyAbsoluteFloor,
  consolidateDominantSource,
  resolveKnowledgeBudget,
  type RetrievalCoherenceFlags,
} from "./retriever-coherence.ts";
import { type MatchCandidate, matchSnippets } from "./snippet-matcher.ts";
import { embedText } from "../../_shared/embed-text.ts";
import { filterSoftDisabledRows } from "../../_shared/knowledge-flags.ts";

// Snippet-matcher config. Thresholds are starting values calibrated against the
// retrieval-eval (E); adjust only against measured aggregates, never single cases.
const SNIPPET_MATCHER_MODEL = "gpt-4o-mini";
const SNIPPET_MATCHER_THRESHOLD = 0.6;
const SNIPPET_MATCHER_MARGIN = 0.15;
// Candidate-pool size handed to the matcher (recall layer). Above this we trust
// hybrid ranking; the matcher (precision layer) picks the final chunks from here.
const MATCH_POOL_SIZE = 15;
// Conservative policy/procedure fallback (Fix B.2). When the matcher abstains
// (finalChunks empty) but the already-scored/gated pool still contains a
// well-retrieved policy or procedure chunk, pass through the top few rather than
// leave the writer with zero knowledge. Gated on the chunk's RETRIEVAL score —
// not the matcher relevance: the matcher scores policy/procedure low precisely
// because they are guardrails/process, not Q&A answers, so re-using its relevance
// to decide what to rescue from abstention is circular. A policy/procedure chunk
// must instead be retrieval-competitive with the strongest pool candidate. Pool-
// only: no new chunks, no gate bypass, capped, policy/procedure only.
const POLICY_FALLBACK_SCORE_RATIO = 0.6;
const POLICY_FALLBACK_MAX = 2;
const POLICY_FALLBACK_USABLE_AS: ReadonlySet<RetrievedChunk["usable_as"]> =
  new Set<RetrievedChunk["usable_as"]>(["policy", "procedure"]);
const POLICY_FALLBACK_CONTENT_CHARS = 1200;
const MAX_DIAGNOSTIC_QUERY_RESULTS = 200;
const MAX_DIAGNOSTIC_CANDIDATES = 60;
const MAX_DIAGNOSTIC_TEXT = 120;

export interface RetrievedChunk {
  id: string;
  content: string;
  kind: string;
  source_label: string;
  similarity: number;
  usable_as:
    | "policy"
    | "procedure"
    | "fact"
    | "saved_reply"
    | "tone_example"
    | "background"
    | "ignore";
  risk_flags: string[];
  // True when this chunk applies to every product in the shop (e.g. a snippet
  // saved in the Product Questions → General bucket). Used by the scorer to
  // skip cross-product penalties and grant a small product-context boost so
  // brand-wide knowledge doesn't drown in noisy product description chunks.
  applies_to_all_products: boolean;
  // Canonical issue_type tags from the snippet metadata (e.g. "pairing",
  // "physical_damage"). Used as an explicit scoring boost when they overlap
  // with the issue terms detected on the customer message — rewards admins
  // who took the time to tag snippets properly.
  chunk_issue_types: string[];
  // ---- Eval-only observability (populated from chunk metadata) ----
  // Used to measure retrieval coherence (single-guide vs grab-bag). Optional
  // because not every construction site has metadata; consumers fall back to
  // source_label/title when these are absent.
  source_id?: string | null;
  // Raw snippet title from metadata (no display "provider: " prefix). This is the
  // identity used to match against gold-labels — it must equal what
  // build-gold-labels.mjs writes (metadata.title || name || label). source_label
  // is a display string and must NOT be used as identity.
  source_title?: string | null;
  chunk_index?: number | null;
  chunk_count?: number;
  products?: string[];
  // Single product external id/scope this chunk is scoped to, when set.
  // null/undefined = not tied to one product (shared/general).
  product_id?: string | null;
  source_provider?: string | null;
  document_category?: string | null;
  document_type?: string | null;
  knowledge_document_access_reason?: string | null;
  // Max cosine similarity (1 - distance) seen for this chunk across the vector
  // queries that surfaced it. null for BM25-only chunks (no vector score).
  // Used by the absolute relevance floor to drop the whole knowledge block when
  // nothing is genuinely relevant. Distinct from `similarity`, which after
  // fusion holds the RRF rank score, not cosine.
  vector_similarity?: number | null;
  // The snippet's free-text customer question (metadata.question), when this
  // chunk came from a Q&A snippet. The snippet-matcher weights this highest —
  // it is a more specific, cross-lingual discriminator than any tag. null for
  // non-Q&A chunks (Shopify product descriptions, manuals, policies).
  question?: string | null;
  // Trusted Shopify product identity from synced `shopify_product` knowledge
  // metadata. Used to ground a product-page URL when the LIVE Shopify stock
  // lookup cannot find the product (e.g. credentials/scope/sync gap) but
  // retrieval still selected a trusted product source. Never derived from
  // customer text. null for non-product chunks.
  product_handle?: string | null;
  product_url?: string | null;
}

export interface RetrieverResult {
  chunks: RetrievedChunk[];
  past_ticket_examples: Array<{
    id?: number;
    customer_msg: string;
    agent_reply: string;
    subject: string | null;
    score: number;
    csat_score: number | null;
    conversation_context: string | null;
  }>;
  // Eval-only observability for retrieval-precision metrics. Populated by the
  // matcher step; consumed by the golden runner. Omitted in production.
  matcher_debug?: {
    candidates: Array<{ id: string; source_id: string | null; title: string }>;
    ranked: Array<
      { id: string; source_id: string | null; title: string; relevance: number }
    >;
    selected_ids: string[];
    abstained: boolean;
    fell_back: boolean;
    // Fix B/B.2: true when the matcher abstained but a conservative
    // policy/procedure passthrough rescued one or more already-pooled chunks.
    // score_basis records what the passthrough gated on. Eval-only.
    policy_fallback?: boolean;
    policy_fallback_count?: number;
    policy_fallback_score_basis?: string | null;
    policy_fallback_details?: PolicyFallbackDebug[];
  };
  candidate_diagnostics?: RetrievalCandidateDiagnostics;
}

export interface RetrieverInput {
  plan: Plan;
  shop_id: string;
  workspace_id?: string | null;
  customerMessage?: string;
  shop?: Record<string, unknown>;
  supabase: SupabaseClient;
  // Eval mode: exclude this ticket's own stored reply from few-shot examples
  // to prevent the model from trivially finding the correct answer in the KB.
  excludeExternalTicketId?: string;
  // Preview mode: exclude specific agent_knowledge chunk ids from retrieval.
  // Used by the "test snippet against ticket" feature to compare a draft with
  // and without a candidate snippet's chunks present in the KB.
  excludeChunkIds?: string[];
  // Retrieval coherence rules. Omitted/undefined fields = production defaults.
  coherenceFlags?: Partial<RetrievalCoherenceFlags>;
}

function sanitiseBm25Query(query: string): string {
  return query
    .replace(/[<>():!&|*\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "could",
  "from",
  "have",
  "hello",
  "help",
  "into",
  "more",
  "need",
  "order",
  "please",
  "that",
  "this",
  "with",
  "would",
  "your",
  "you",
  "jeg",
  "har",
  "det",
  "den",
  "der",
  "kan",
  "med",
  "men",
  "mit",
  "min",
  "mvh",
  "tak",
  "til",
  "ikke",
  "ordrenummer",
]);

const INTENT_TO_ISSUE_TYPES: Record<string, string[]> = {
  tracking: ["tracking", "shipping"],
  return: ["return"],
  refund: ["refund", "return"],
  exchange: ["return", "physical_damage", "connectivity"],
  complaint: [
    "physical_damage",
    "connectivity",
    "audio",
    "battery",
    "firmware",
  ],
  product_question: [
    "product_specs",
    "connectivity",
    "audio",
    "firmware",
    "battery",
  ],
  address_change: ["shipping"],
  cancel: ["return"],
  other: [],
  thanks: [],
  update: [],
};

function stripHtml(text: string): string {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return stripHtml(text)
    .toLowerCase()
    .replace(/[^a-z0-9æøåäöüßéèáàíóúñ-]+/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function shortDiagnosticText(value: unknown): string | null {
  const text = stripHtml(String(value ?? "")).slice(0, MAX_DIAGNOSTIC_TEXT);
  return text || null;
}

function normalizeConnectors(text: string): string {
  return text.replace(/\s*[+&]\s*/g, " and ");
}

function buildShopProductTerms(shop?: Record<string, unknown>): string[] {
  const overview = String(shop?.product_overview || "");
  const terms = overview
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\s]+/, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 80);
  return uniqueStrings(
    terms.flatMap((term) => {
      const lower = term.toLowerCase();
      const normalized = normalizeConnectors(lower);
      const variants = lower === normalized ? [lower] : [lower, normalized];
      if (lower === "ear pads") variants.push("earpads");
      return variants;
    }),
  );
}

// B1: most-specific product resolution. When several shop product terms match
// the same message and one term is a substring of another, longer matched term
// (e.g. "a-spire" ⊂ "a-spire wireless"), keep only the most specific term. This
// prevents a wireless customer from also counting as a wired ("a-spire") match,
// which previously kept mentionedProducts.length===2 and silently disabled the
// cross-product penalty. Generic — no hardcoded product names. Genuinely
// different products (e.g. "a-blaze" + "a-spire wireless") are both preserved.
export function resolveMostSpecificProductTerms(
  matchedTerms: string[],
): string[] {
  const terms = uniqueStrings(matchedTerms.map((t) => t.toLowerCase().trim()));
  return terms.filter((term) =>
    !terms.some((other) =>
      other !== term &&
      other.length > term.length &&
      other.includes(term)
    )
  );
}

export function extractMentionedProductTerms(
  text: string,
  shop?: Record<string, unknown>,
): string[] {
  const lower = stripHtml(text).toLowerCase();
  const lowerNormalized = normalizeConnectors(lower);
  const shopTerms = buildShopProductTerms(shop);
  const matched = shopTerms.filter((term) => {
    if (lower.includes(term)) return true;
    if (lowerNormalized.includes(term)) return true;
    if (term === "ear pads" && lower.includes("earpads")) return true;
    return false;
  });
  return resolveMostSpecificProductTerms(matched);
}

function isKnowledgeDocumentProvider(sourceProvider: unknown): boolean {
  return String(sourceProvider || "").trim().toLowerCase() ===
    KNOWLEDGE_DOCUMENT_PROVIDER;
}

function isReturnRefundContext(
  plan: Plan,
  customerMessage?: string,
): boolean {
  const issueTerms = extractIssueTerms(customerMessage || "");
  return RETURN_INTENTS.has(plan.primary_intent) ||
    plan.resolution_stage === "initiate_warranty_repair" ||
    issueTerms.some((term) => RETURN_ISSUE_TERMS.has(term));
}

function isEarPadContext(customerMessage?: string): boolean {
  const lower = stripHtml(customerMessage || "").toLowerCase();
  return extractIssueTerms(lower).includes("ear_pads") ||
    /\b(ear\s*pads?|earpads?|replacement\s+pads?|pads?|cushions?|ørepuder?)\b/i
      .test(lower);
}

const SOFTWARE_CONNECTIVITY_RE =
  /\b(app|software|firmware|bluetooth|pairing|pair|paired|forbind|forbinde|tilslut|connect|connection|disconnect|opdater)\b/i;

function isSoftwareConnectivityContext(customerMessage?: string): boolean {
  return SOFTWARE_CONNECTIVITY_RE.test(stripHtml(customerMessage || ""));
}

function hasSoftwareConnectivitySignal(text: string): boolean {
  return SOFTWARE_CONNECTIVITY_RE.test(text);
}

const TECHNICAL_SUPPORT_CONTEXT_RE =
  /\b(microphone|mic|audio|sound|discord|windows|48\s*k(?:hz)?|48khz|48000\s*hz|48000hz|16000\s*hz|16000hz|robotic|distorted|muffled|choppy|low\s+volume|sound\s+enhancements?|audio\s+enhancements?|spatial\s+sound|voice\s+clarity|krisp|noise\s+suppression)\b/i;

function isTechnicalSupportContext(customerMessage?: string): boolean {
  return TECHNICAL_SUPPORT_CONTEXT_RE.test(stripHtml(customerMessage || ""));
}

// Accessory compatibility (cable / adapter / charger) is shared across every
// AceZone headset, so a bare "any USB-C cable?" / "any USB-C to USB-A adapter?"
// question carries no product name. Detector matches the customer message;
// the heading check below constrains which document sections may answer it.
const ACCESSORY_COMPAT_RE =
  /\b(cable|kabel|adapter|adaptor|usb-?c|usb-?a|dongle|charger|charging|oplader)\b/i;

function isAccessoryCompatibilityContext(customerMessage?: string): boolean {
  return ACCESSORY_COMPAT_RE.test(stripHtml(customerMessage || ""));
}

const ACCESSORY_HEADING_RE =
  /\b(cable|adapter|adaptor|accessor|usb-?c|usb-?a|charger|charging)\b/i;

function hasAccessoryCompatibilityHeading(text: string): boolean {
  return ACCESSORY_HEADING_RE.test(text);
}

const ACCESSORY_REPLACEMENT_INTENT_RE =
  /\b(missing|lost|broken|replacement|replace|spare\s*parts?|accessor(?:y|ies)|dongle|mangler|mistet|ødelagt|defekt|reservedele|tilbehør|erstatning|ny|købe|buy)\b/i;
const ACCESSORY_REPLACEMENT_PROCEDURE_RE =
  /\b(missing|lost|broken|replacement|replace|spare\s*parts?|mangler|mistet|ødelagt|defekt|reservedele|erstatning|ny|købe|buy)\b/i;
const ACCESSORY_REPLACEMENT_OBJECT_RE =
  /\b(accessor(?:y|ies)|dongle|spare\s*parts?|parts?|tilbehør|reservedele)\b/i;

function isAccessoryReplacementContext(text?: string): boolean {
  const normalized = stripHtml(text || "");
  return ACCESSORY_REPLACEMENT_INTENT_RE.test(normalized) &&
    (
      ACCESSORY_REPLACEMENT_PROCEDURE_RE.test(normalized) &&
      ACCESSORY_REPLACEMENT_OBJECT_RE.test(normalized)
    );
}

function hasAccessoryReplacementSignal(text: string): boolean {
  return ACCESSORY_REPLACEMENT_INTENT_RE.test(stripHtml(text));
}

const POWER_RESET_INTENT_RE =
  /\b(power(?:\s+on)?|won'?t\s+power\s+on|will\s+not\s+power\s+on|charging|charge|reset|factory\s+reset|tænder|oplade|oplader|nulstil)\b/i;
const RESET_PROCEDURE_RE =
  /\b(factory\s+reset|nulstil|15\s*seconds?|power\s+button)\b/i;

function isPowerResetContext(text?: string): boolean {
  return POWER_RESET_INTENT_RE.test(stripHtml(text || ""));
}

function hasResetProcedureSignal(text: string): boolean {
  return RESET_PROCEDURE_RE.test(stripHtml(text));
}

const RETURN_POLICY_CONTEXT_RE =
  /\b(return|returns|refund|refunded|refunds|warranty|claim|claims|defect|defective|broken|crack|cracked|repair|replacement|exchange|proof\s+of\s+purchase|retur|refundering|reklamation|garanti|ombytning|defekt|ødelagt|reparation)\b/i;
const RETURN_POLICY_FOCUSED_RE =
  /\b(return|returns|refund|refunds|warranty|claim|claims|return\s+shipping|return\s+address|return\s+label|return\s+portal|defect|defective|broken|crack|cracked|repair|replacement\s+under\s+warranty|proof\s+of\s+purchase|exchange|retur|refundering|reklamation|garanti|ombytning|defekt|ødelagt|reparation)\b/i;

function isReturnPolicyBoostContext(
  intentText: string,
  issueTerms: string[],
): boolean {
  const normalized = stripHtml(intentText || "");
  return RETURN_POLICY_CONTEXT_RE.test(normalized) ||
    issueTerms.some((term) => RETURN_ISSUE_TERMS.has(term));
}

function returnPolicyBoostForChunk(input: {
  chunk: RetrievedChunk;
  intentText: string;
  issueTerms: string[];
}): number {
  const { chunk, intentText, issueTerms } = input;
  if (!isReturnPolicyBoostContext(intentText, issueTerms)) return 0;
  if (chunk.usable_as !== "policy" && chunk.usable_as !== "procedure") return 0;
  const isReturnsKnowledgeDoc =
    isKnowledgeDocumentProvider(chunk.source_provider) &&
    chunk.document_category === RETURNS_DOCUMENT_CATEGORY;
  const isProductSupportKnowledgeDoc =
    isKnowledgeDocumentProvider(chunk.source_provider) &&
    chunk.document_category === PRODUCT_SUPPORT_DOCUMENT_CATEGORY;
  // Product-support sections already receive product/issue boosts. Q1 is only
  // to keep shared policy/procedure context from falling out of the matcher pool
  // behind troubleshooting chunks.
  if (isProductSupportKnowledgeDoc) return 0;

  const titleQuestion = [
    chunk.source_title ?? "",
    chunk.source_label ?? "",
    chunk.question ?? "",
  ].join(" ");
  const focusedText = `${titleQuestion} ${
    String(chunk.content ?? "").slice(0, 1200)
  }`;
  const focused = RETURN_POLICY_FOCUSED_RE.test(stripHtml(focusedText));
  if (!focused && !isReturnsKnowledgeDoc) return 0;
  return focused ? 0.18 : 0.08;
}

function isPureCableAdapterCompatibility(text: string): boolean {
  const normalized = stripHtml(text);
  return /\b(cable|kabel|adapter|adaptor|compatibility|usb-?c|usb-?a)\b/i
    .test(normalized) && !hasResetProcedureSignal(normalized);
}

function extractKnowledgeDocumentProductTerms(input: {
  content?: string;
  metadata?: Record<string, unknown> | null;
  shop?: Record<string, unknown>;
}): string[] {
  const metadata = input.metadata && typeof input.metadata === "object"
    ? input.metadata
    : {};
  const rawProducts = [
    metadata.product_scope,
    metadata.product_id,
    metadata.product_title,
    metadata.document_title,
    metadata.title,
    metadata.name,
    metadata.label,
    ...(Array.isArray(metadata.product_ids) ? metadata.product_ids : []),
    ...(Array.isArray(metadata.products) ? metadata.products : []),
  ];
  const explicitTerms = rawProducts
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .flatMap((value) => extractMentionedProductTerms(value, input.shop));
  if (explicitTerms.length) return uniqueStrings(explicitTerms);

  // Fallback to the structured document title embedded as a Markdown H1 by the
  // chunk builder. Do not use arbitrary body text for ownership; cross-product
  // comparisons inside the guide must never make the chunk belong to that other
  // product.
  return extractMentionedProductTerms(
    extractKnowledgeDocumentTitleText({ content: input.content, metadata }),
    input.shop,
  );
}

function extractKnowledgeDocumentTitleText(input: {
  content?: string;
  metadata?: Record<string, unknown> | null;
}): string {
  const metadata = input.metadata && typeof input.metadata === "object"
    ? input.metadata
    : {};
  const explicit = String(
    metadata.title || metadata.name || metadata.label || "",
  )
    .trim();
  if (explicit) return explicit;
  const heading = String(input.content || "").match(/^\s*#\s+(.+)$/m)?.[1];
  return String(heading || "").trim();
}

export type RuntimeKnowledgeDocumentDecision = {
  allowed: boolean;
  reason: string;
};

export function evaluateRuntimeKnowledgeDocumentAccess(input: {
  source_provider?: string | null;
  content?: string;
  metadata?: Record<string, unknown> | null;
  plan: Plan;
  customerMessage?: string;
  shop?: Record<string, unknown>;
}): RuntimeKnowledgeDocumentDecision {
  if (!isKnowledgeDocumentProvider(input.source_provider)) {
    return { allowed: true, reason: "not_knowledge_document" };
  }

  const metadata = input.metadata && typeof input.metadata === "object"
    ? input.metadata
    : {};
  const environment = String(metadata.environment || "").trim().toLowerCase();
  if (!KNOWLEDGE_DOCUMENT_ENVIRONMENTS.has(environment)) {
    return { allowed: false, reason: "unsupported_document_environment" };
  }

  const category = String(metadata.category || "").trim();
  if (category === RETURNS_DOCUMENT_CATEGORY) {
    return isReturnRefundContext(input.plan, input.customerMessage)
      ? { allowed: true, reason: "returns_context" }
      : { allowed: false, reason: "not_returns_context" };
  }

  if (category === TECHNICAL_SUPPORT_DOCUMENT_CATEGORY) {
    return isTechnicalSupportContext(input.customerMessage)
      ? { allowed: true, reason: "technical_support_context" }
      : { allowed: false, reason: "not_technical_support_context" };
  }

  if (category === GENERAL_DOCUMENT_CATEGORY) {
    return { allowed: true, reason: "general_document_context" };
  }

  if (category !== PRODUCT_SUPPORT_DOCUMENT_CATEGORY) {
    return { allowed: false, reason: "unsupported_document_category" };
  }

  // Product Support docs are currently used in inbox drafts as human-reviewed
  // draft context. No auto-send/autonomous action path exists.
  const mentionedProducts = extractMentionedProductTerms(
    input.customerMessage || "",
    input.shop,
  );
  const documentProducts = extractKnowledgeDocumentProductTerms({
    content: input.content,
    metadata,
    shop: input.shop,
  });
  const earPadContext = isEarPadContext(input.customerMessage);
  const scopedMentionedProducts = earPadContext && mentionedProducts.length > 1
    ? mentionedProducts.filter((term) => normProduct(term) !== "ear pads")
    : mentionedProducts;
  const titleProducts = extractMentionedProductTerms(
    extractKnowledgeDocumentTitleText({ content: input.content, metadata }),
    input.shop,
  );
  const isGenericEarPadDocument = titleProducts.some((term) =>
    normProduct(term) === "ear pads"
  );

  if (isGenericEarPadDocument) {
    return earPadContext
      ? { allowed: true, reason: "ear_pads_context" }
      : { allowed: false, reason: "ear_pads_document_without_context" };
  }

  // Cross-product app/software/Bluetooth/firmware exception: these topics are
  // legitimately shared across multiple headset models (e.g. the AceZone app
  // works with A-Rise, A-Blaze, and A-Spire Wireless). When no specific
  // product is mentioned, allow document chunks whose section heading matches
  // the detected software/connectivity issue terms.
  if (scopedMentionedProducts.length === 0) {
    const softwareIssue = isSoftwareConnectivityContext(input.customerMessage);
    if (softwareIssue) {
      const sectionHeading = String(metadata.section_heading || "")
        .toLowerCase();
      const titleText = extractKnowledgeDocumentTitleText({
        content: input.content,
        metadata,
      }).toLowerCase();
      const combinedText = `${sectionHeading} ${titleText}`;
      if (hasSoftwareConnectivitySignal(combinedText)) {
        return { allowed: true, reason: "cross_product_software_context" };
      }
    }
  }

  // Cross-product power/reset exception: reset procedures are shared enough to
  // be useful when product resolution fails, but keep this constrained to reset
  // procedure headings/content so cable compatibility and generic power docs do
  // not enter on power-on tickets.
  if (scopedMentionedProducts.length === 0) {
    const powerResetIntentText = [
      input.customerMessage ?? "",
      ...(input.plan.sub_queries ?? []),
    ].join(" ");
    const powerResetIssue = isPowerResetContext(powerResetIntentText);
    if (powerResetIssue) {
      const sectionHeading = String(metadata.section_heading || "")
        .toLowerCase();
      const titleText = extractKnowledgeDocumentTitleText({
        content: input.content,
        metadata,
      }).toLowerCase();
      const combinedText = `${sectionHeading} ${titleText} ${
        String(input.content || "").slice(0, 1500)
      }`;
      if (
        hasResetProcedureSignal(combinedText) &&
        !isPureCableAdapterCompatibility(combinedText)
      ) {
        return { allowed: true, reason: "cross_product_power_reset_context" };
      }
    }
  }

  // Cross-product accessory exception: cable / adapter / charger compatibility
  // is the same across every headset (any standard USB-C cable works; any
  // standard USB-C to USB-A adapter works on the dongle). When no specific
  // product is mentioned and the customer asks an accessory-compatibility
  // question, allow document chunks whose section heading is about cable /
  // adapter / accessory compatibility. Heading-constrained so unrelated product
  // sections never leak in on a bare accessory question.
  if (scopedMentionedProducts.length === 0) {
    const accessoryIssue = isAccessoryCompatibilityContext(
      input.customerMessage,
    );
    if (accessoryIssue) {
      const sectionHeading = String(metadata.section_heading || "")
        .toLowerCase();
      if (hasAccessoryCompatibilityHeading(sectionHeading)) {
        return { allowed: true, reason: "cross_product_accessory_context" };
      }
    }
  }

  if (scopedMentionedProducts.length !== 1) {
    return {
      allowed: false,
      reason: scopedMentionedProducts.length > 1
        ? "ambiguous_product_context"
        : "missing_product_context",
    };
  }

  if (!documentProducts.length) {
    return { allowed: false, reason: "document_product_unresolved" };
  }

  const mentioned = normProduct(scopedMentionedProducts[0]);
  const matches = documentProducts.some((term) =>
    normProduct(term) === mentioned
  );
  return matches
    ? { allowed: true, reason: "same_product_context" }
    : { allowed: false, reason: "wrong_product_context" };
}

// Output values MUST be from the canonical issue_types vocabulary defined in
// apps/web/lib/knowledge/issue-types.js. The UI tags snippets with these exact
// values, and metadata-overlap scoring depends on them matching. Drift = silent
// retrieval misses.
function extractIssueTerms(text: string): string[] {
  const lower = stripHtml(text).toLowerCase();
  const terms: string[] = [];
  const addIf = (term: string, pattern: RegExp) => {
    if (pattern.test(lower)) terms.push(term);
  };
  addIf("app", /\b(app|ios|android)\b/);
  addIf("pairing", /\b(pair|paired|pairing|parring|parre)\b/);
  addIf(
    "connectivity",
    /\b(connect|connection|forbind|forbinde|tilslut|bluetooth|disconnect)\b/,
  );
  addIf("firmware", /\b(firmware|update|updater|opdater)\b/);
  addIf("factory_reset", /\b(factory reset|reset|nulstil)\b/);
  addIf("audio", /\b(audio|sound|lyd|cable|kabel|usb|usb-c)\b/);
  addIf("microphone", /\b(mic|microphone|mikrofon|mute|unmute)\b/);
  addIf("battery", /\b(battery|batteri|charging|charge|strøm|oplade)\b/);
  addIf("ear_pads", /\b(ear\s*pads?|earpads?|pads?|cushions?|ørepuder?)\b/);
  addIf(
    "physical_damage",
    /\b(damage|damaged|broken|crack|cracked|skade|ødelagt|knækket|broke)\b/,
  );
  addIf(
    "refund",
    /\b(refund|money back|reimbursement|refusion|pengene tilbage)\b/,
  );
  addIf(
    "return",
    /\b(return|retur|swap|replacement|ombytning|warranty|garanti)\b/,
  );
  addIf("tracking", /\b(tracking|track|pakke|shipment|forsendelse|awb)\b/);
  addIf(
    "shipping",
    /\b(shipping|delivery|fragt|levering|courier|dhl|gls|postnord)\b/,
  );
  addIf(
    "product_specs",
    /\b(specs?|specifications?|specifikation|dimensions?|weight|vægt)\b/,
  );
  return uniqueStrings(terms);
}

function overlapCount(haystack: string, needles: string[]): number {
  const lower = stripHtml(haystack).toLowerCase();
  return needles.filter((needle) => lower.includes(needle.toLowerCase()))
    .length;
}

function hasLexicalIssueSignal(
  haystack: string,
  issueTerms: string[],
): boolean {
  const normalized = normalizeIssueSignalText(haystack);
  const tokens = new Set(normalized.split(" ").filter(Boolean));
  const padded = ` ${normalized} `;
  return issueTerms.some((term) => {
    const normalizedTerm = normalizeIssueSignalText(term);
    if (!normalizedTerm) return false;
    const termTokens = normalizedTerm.split(" ").filter(Boolean);
    if (termTokens.length === 1) return tokens.has(termTokens[0]);
    return padded.includes(` ${termTokens.join(" ")} `);
  });
}

function normalizeIssueSignalText(value: string): string {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Issue-type vocabulary terms that signal a commercial return/refund intent
// (as opposed to a technical fault). Drawn from the shared issue_types vocab in
// apps/web/lib/knowledge/issue-types.js — NOT shop-specific phrasing.
const RETURN_ISSUE_TERMS = new Set(["return", "refund"]);

// Intents that should additionally probe for return/refund knowledge even if no
// return/refund issue term was lexically detected in the message.
const RETURN_INTENTS = new Set(["return", "refund", "exchange"]);
const KNOWLEDGE_DOCUMENT_PROVIDER = "knowledge_document";
const KNOWLEDGE_DOCUMENT_ENVIRONMENTS = new Set(["preview", "production"]);
const PRODUCT_SUPPORT_DOCUMENT_CATEGORY = "product_support";
const RETURNS_DOCUMENT_CATEGORY = "returns";
const TECHNICAL_SUPPORT_DOCUMENT_CATEGORY = "technical_support";
const GENERAL_DOCUMENT_CATEGORY = "general";

// Intents whose messages warrant a technical/troubleshooting probe.
const TECHNICAL_INTENTS = new Set([
  "complaint",
  "exchange",
  "refund",
  "product_question",
  "technical_support",
]);

// A supplementary retrieval query plus how it should be filtered.
// productAgnostic=true runs the query WITHOUT the product metadata filter —
// used for return/refund content, which is product-independent (a return policy
// applies regardless of which headset). Technical queries keep productAgnostic
// false so the strict product filter still separates e.g. A-Spire from A-Spire
// Wireless and never blends the two distinct products.
export interface FallbackQuery {
  text: string;
  productAgnostic: boolean;
}

type QuerySource = "vector" | "bm25";

type QueryPair = {
  vector: Array<Record<string, unknown>>;
  bm25: Array<Record<string, unknown>>;
};

export interface RetrievalCandidateDiagnostics {
  planner_queries: string[];
  fallback_queries: Array<{
    query: string;
    product_agnostic: boolean;
  }>;
  query_results: Array<{
    query: string;
    query_index: number;
    source: QuerySource;
    chunk_id: string;
    raw_rank: number;
    raw_score: number | null;
    source_type: string | null;
    usable_as: RetrievedChunk["usable_as"] | null;
    title: string | null;
    question: string | null;
    products: string[];
    issue_types: string[];
  }>;
  merged_candidates_pre_score: Array<{
    chunk_id: string;
    vector_rank: number | null;
    bm25_rank: number | null;
    rrf_score: number;
  }>;
  scored_candidates_pre_dedupe: Array<{
    chunk_id: string;
    base_score: number;
    product_boost: number;
    issue_type_boost: number;
    lexical_issue_boost: number;
    product_support_doc_boost: number;
    general_policy_boost: number;
    power_reset_boost: number;
    return_policy_boost: number;
    source_type_boost: number;
    usable_as_boost: number;
    cross_product_penalty: number;
    final_score: number;
  }>;
  candidates_post_dedupe: string[];
  matcher_pool_top15: string[];
  matcher_selected_ids: string[];
  matcher_abstain: boolean | null;
  final_selected_ids: string[];
  final_chunks: Array<{
    id: string;
    title: string | null;
    usable_as: RetrievedChunk["usable_as"];
    source_type: string | null;
    source_provider: string | null;
    category: string | null;
    document_category: string | null;
    document_type: string | null;
    score: number;
    base_score: number;
    final_score: number;
    vector_similarity: number | null;
    excerpt: string;
    selected_by_policy_fallback: boolean;
    fallback_ranking_score: number | null;
    fallback_overlap_reason: string | null;
  }>;
  // B2 eval-only observability for the metadata-based product scorer. Lets the
  // golden runner see exactly which resolved product term matched which chunk's
  // products[] metadata, and the resulting boost/penalty — without re-deriving
  // it. Optional so older consumers / best-effort fallbacks stay valid.
  product_scoring?: {
    product_match_source: "metadata";
    mentioned_products_resolved: string[];
    per_chunk: Array<{
      chunk_id: string;
      chunk_products_normalized: string[];
      product_boost: number;
      cross_product_penalty: number;
    }>;
  };
}

// Build supplementary retrieval queries from the customer message.
//
// Design note (recall, not policy): a single message often carries TWO intents
// — e.g. "I want to return it because it won't connect" is both a return
// request AND a technical fault. We emit each as a SEPARATE query so the
// candidate pool contains BOTH the troubleshooting knowledge AND the
// return/refund knowledge. We deliberately do NOT decide which one answers the
// customer here — that choice is shop-specific (one shop deflects with a guide,
// another just accepts the return) and is made downstream by the snippet
// matcher / writer against whatever the shop actually has in its knowledge.
// Nothing here is hardcoded to a particular shop's behaviour; the splits are
// driven by the shared issue-type vocabulary.
export function buildFallbackQueries(
  plan: Plan,
  customerMessage?: string,
  shop?: Record<string, unknown>,
): FallbackQuery[] {
  const text = stripHtml(customerMessage || "");
  if (!text) return [];

  const products = extractMentionedProductTerms(text, shop);
  const issues = extractIssueTerms(text);
  const returnIssues = issues.filter((i) => RETURN_ISSUE_TERMS.has(i));
  const technicalIssues = issues.filter((i) => !RETURN_ISSUE_TERMS.has(i));
  const queries: FallbackQuery[] = [];

  if (issues.includes("ear_pads")) {
    queries.push({
      text: `${products[0] || ""} ear pads earpads compatible replaceable`
        .trim(),
      productAgnostic: false,
    });
  }
  if (plan.primary_intent === "product_question" && products.length) {
    queries.push({
      text: `${products[0]} compatibility product specs accessories`,
      productAgnostic: false,
    });
  }

  if (isAccessoryReplacementContext(text)) {
    queries.push({
      text: "missing accessories spare parts replacement policy instructions",
      productAgnostic: true,
    });
  }

  // Return/refund probe — fires on either a detected return/refund issue term
  // OR a return-family intent, and is INDEPENDENT of whether a product is
  // named (a bare "I want to return this" must still surface return knowledge).
  // Runs product-agnostic: return content is often tagged with an incidental or
  // no product, so a strict product filter would wrongly drop it.
  if (
    returnIssues.length > 0 || RETURN_INTENTS.has(plan.primary_intent) ||
    plan.resolution_stage === "initiate_warranty_repair"
  ) {
    queries.push({
      text: [...returnIssues, "return", "refund", "policy", "instructions"]
        .join(" "),
      productAgnostic: true,
    });
  }

  // Technical probe — surfaces troubleshooting/manual knowledge. Driven purely
  // by the detected technical issue terms; no fixed bias phrase is appended so
  // the query reflects the customer's actual problem rather than assuming one.
  if (
    technicalIssues.length > 0 && TECHNICAL_INTENTS.has(plan.primary_intent) &&
    products.length
  ) {
    queries.push({
      text: `${products[0]} ${technicalIssues.join(" ")}`,
      productAgnostic: false,
    });
  }

  // Dedup by text, keeping product-agnostic precedence if a text repeats.
  const byText = new Map<string, FallbackQuery>();
  for (const q of queries) {
    if (q.text.length <= 3) continue;
    const prev = byText.get(q.text);
    if (!prev) byText.set(q.text, q);
    else if (q.productAgnostic) prev.productAgnostic = true;
  }
  return [...byText.values()];
}

type PolicyFallbackIntentKind = "power_reset" | "warranty" | "accessory";

export type PolicyFallbackDebug = {
  chunk_id: string;
  ranking_score: number;
  overlap_reason: string;
  title_question_overlap: number;
  content_overlap: number;
  issue_tag_overlap: number;
};

export type PolicyFallbackResult = {
  chunks: RetrievedChunk[];
  debug: PolicyFallbackDebug[];
};

const POWER_RESET_TERMS = [
  "power",
  "powers",
  "reset",
  "factory",
  "charging",
  "charge",
  "charger",
  "tænder",
  "oplade",
  "oplader",
];
const POWER_RESET_REQUIRED_TERMS = [
  "power",
  "powers",
  "reset",
  "factory",
  "tænder",
];
const WARRANTY_TERMS = [
  "warranty",
  "claim",
  "claims",
  "defect",
  "defective",
  "repair",
  "replacement",
  "garanti",
  "reklamation",
];
const ACCESSORY_TERMS = [
  "accessory",
  "accessories",
  "replacement",
  "replace",
  "missing",
  "lost",
  "broken",
  "spare",
  "part",
  "parts",
  "dongle",
  "tilbehør",
  "reservedele",
  "mangler",
  "mistet",
];
const ACCESSORY_REQUIRED_TERMS = ACCESSORY_TERMS.filter((term) =>
  term !== "dongle"
);

function includesAnyText(haystack: string, terms: string[]): boolean {
  const normalized = stripHtml(haystack).toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function fallbackIntentKinds(text: string): PolicyFallbackIntentKind[] {
  const kinds: PolicyFallbackIntentKind[] = [];
  if (includesAnyText(text, POWER_RESET_TERMS)) kinds.push("power_reset");
  if (includesAnyText(text, WARRANTY_TERMS)) kinds.push("warranty");
  if (includesAnyText(text, ACCESSORY_TERMS)) kinds.push("accessory");
  return kinds;
}

function fallbackIntentTerms(input: {
  customerMessage?: string;
  plannerQueries?: string[];
  issueTerms?: string[];
}): string[] {
  const source = [
    input.customerMessage ?? "",
    ...(input.plannerQueries ?? []),
    ...(input.issueTerms ?? []),
  ].join(" ");
  const focused = [
    ...POWER_RESET_TERMS,
    ...WARRANTY_TERMS,
    ...ACCESSORY_TERMS,
    ...(input.issueTerms ?? []),
  ].filter((term) => includesAnyText(source, [term]));
  return uniqueStrings(focused);
}

function fallbackTextParts(chunk: RetrievedChunk): {
  titleQuestion: string;
  content: string;
  all: string;
} {
  const titleQuestion = [
    chunk.source_title ?? "",
    chunk.source_label ?? "",
    chunk.question ?? "",
  ].join(" ");
  const content = String(chunk.content ?? "").slice(
    0,
    POLICY_FALLBACK_CONTENT_CHARS,
  );
  return {
    titleQuestion,
    content,
    all: `${titleQuestion} ${content}`,
  };
}

function tokenOverlapSize(haystack: string, needles: string[]): number {
  const haystackTokens = new Set(tokenize(haystack));
  return needles.filter((term) =>
    haystackTokens.has(term) || includesAnyText(haystack, [term])
  ).length;
}

function policyFallbackCandidateScore(input: {
  chunk: RetrievedChunk;
  intentText: string;
  intentTerms: string[];
  intentKinds: PolicyFallbackIntentKind[];
  issueTerms: string[];
}): PolicyFallbackDebug & { eligible: boolean } {
  const { chunk, intentText, intentTerms, intentKinds, issueTerms } = input;
  const parts = fallbackTextParts(chunk);
  const titleQuestionOverlap = tokenOverlapSize(
    parts.titleQuestion,
    intentTerms,
  );
  const contentOverlap = tokenOverlapSize(parts.content, intentTerms);
  const issueTagOverlap =
    (chunk.chunk_issue_types ?? []).filter((tag) =>
      issueTerms.includes(tag) || includesAnyText(intentText, [tag])
    ).length;

  const lowerTitle = parts.titleQuestion.toLowerCase();
  const lowerAll = parts.all.toLowerCase();
  const accessoryFamilyOverlap = intentKinds.includes("accessory") &&
    isAccessoryReplacementContext(intentText) &&
    hasAccessoryReplacementSignal(lowerAll) &&
    includesAnyText(lowerAll, ACCESSORY_REQUIRED_TERMS);
  const hasDirectOverlap = titleQuestionOverlap > 0 || contentOverlap > 0 ||
    issueTagOverlap > 0 || accessoryFamilyOverlap;
  const isCompatibilityOnly =
    /\b(cable|adapter|compatibility|usb-c|usb)\b/i.test(lowerTitle) &&
    !includesAnyText(lowerAll, POWER_RESET_REQUIRED_TERMS);

  let eligible = hasDirectOverlap;
  const reasons: string[] = [];
  if (titleQuestionOverlap > 0) {
    reasons.push(`title_question:${titleQuestionOverlap}`);
  }
  if (contentOverlap > 0) reasons.push(`content:${contentOverlap}`);
  if (issueTagOverlap > 0) reasons.push(`issue_tag:${issueTagOverlap}`);
  if (accessoryFamilyOverlap) reasons.push("accessory_family");

  if (intentKinds.includes("power_reset")) {
    if (!includesAnyText(lowerAll, POWER_RESET_REQUIRED_TERMS)) {
      eligible = false;
      reasons.push("blocked:missing_power_reset_overlap");
    }
    if (isCompatibilityOnly) {
      eligible = false;
      reasons.push("blocked:compatibility_only_for_power_reset");
    }
  }

  if (intentKinds.includes("accessory")) {
    if (!includesAnyText(lowerAll, ACCESSORY_REQUIRED_TERMS)) {
      eligible = false;
      reasons.push("blocked:accessory_intent_without_accessory_overlap");
    }
  }

  const warrantyClaimsBonus =
    intentKinds.includes("warranty") && /\bwarranty claims?\b/i.test(lowerTitle)
      ? 0.35
      : 0;
  const procedureBonus = chunk.usable_as === "procedure" ? 0.03 : 0;
  const rankingScore = chunk.similarity +
    titleQuestionOverlap * 0.04 +
    contentOverlap * 0.015 +
    issueTagOverlap * 0.025 +
    (accessoryFamilyOverlap ? 0.08 : 0) +
    procedureBonus +
    warrantyClaimsBonus;

  return {
    chunk_id: String(chunk.id),
    ranking_score: Number(rankingScore.toFixed(12)),
    overlap_reason: reasons.join(",") || "none",
    title_question_overlap: titleQuestionOverlap,
    content_overlap: contentOverlap,
    issue_tag_overlap: issueTagOverlap,
    eligible,
  };
}

// Fix B.2 narrowing — conservative policy/procedure fallback. Selects from the
// EXISTING matcher pool only (already product/category/runtime-gated); it never
// pulls new chunks and never bypasses a gate. Eligibility:
//   - usable_as ∈ {policy, procedure} (never fact/saved_reply/background/etc.)
//   - retrieval score is competitive with the strongest pool candidate
//   - direct lexical intent overlap with title/question/content/issue tags
// Low-risk intent guards prevent generic compatibility or unrelated dongle
// troubleshooting chunks from being rescued for power/reset or missing-part
// requests. Pure: no IO, deterministic.
export function selectPolicyFallback(
  pool: RetrievedChunk[],
  opts: {
    max: number;
    scoreRatio: number;
    customerMessage?: string;
    plannerQueries?: string[];
    issueTerms?: string[];
  },
): PolicyFallbackResult {
  const chunks = pool ?? [];
  const score = (c: RetrievedChunk) =>
    typeof c.similarity === "number" ? c.similarity : 0;
  // Top retrieval score across the WHOLE pool, so a rescued policy/procedure
  // chunk must be competitive with the best retrieved candidate, not merely the
  // best among weak policy chunks.
  const topPoolScore = chunks.reduce((m, c) => Math.max(m, score(c)), 0);
  if (!(topPoolScore > 0)) return { chunks: [], debug: [] };
  const floor = topPoolScore * opts.scoreRatio;
  const intentText = [
    opts.customerMessage ?? "",
    ...(opts.plannerQueries ?? []),
    ...(opts.issueTerms ?? []),
  ].join(" ");
  const intentTerms = fallbackIntentTerms(opts);
  const intentKinds = fallbackIntentKinds(intentText);
  const issueTerms = opts.issueTerms ?? [];
  const ranked = chunks
    .map((chunk) => ({
      chunk,
      debug: policyFallbackCandidateScore({
        chunk,
        intentText,
        intentTerms,
        intentKinds,
        issueTerms,
      }),
    }))
    .filter(({ chunk, debug }) =>
      POLICY_FALLBACK_USABLE_AS.has(chunk.usable_as) &&
      score(chunk) > 0 &&
      score(chunk) >= floor &&
      debug.eligible
    )
    .sort((a, b) =>
      b.debug.ranking_score - a.debug.ranking_score ||
      score(b.chunk) - score(a.chunk)
    )
    .slice(0, Math.max(0, opts.max));
  return {
    chunks: ranked.map(({ chunk }) => chunk),
    debug: ranked.map(({ debug }) => {
      const { eligible: _eligible, ...rest } = debug;
      return rest;
    }),
  };
}

// Resolve a human-readable label from a chunk's metadata. Document chunks (e.g.
// General knowledge) store their H2 under metadata.section_heading /
// normalized_heading rather than metadata.title, so fall back to those. This is
// label-only: it surfaces the existing heading to retrieval diagnostics and the
// matcher's candidate title; it does not change retrieval, scoring, or selection.
export function metadataLabelText(metadata: Record<string, unknown>): string {
  return String(
    metadata.title || metadata.name || metadata.label ||
      metadata.section_heading || metadata.normalized_heading || "",
  ).trim();
}

export function sourceLabel(chunk: Record<string, unknown>): string {
  const metadata = chunk.metadata && typeof chunk.metadata === "object"
    ? chunk.metadata as Record<string, unknown>
    : {};
  const title = metadataLabelText(metadata);
  const provider = String(
    chunk.source_provider ?? chunk.source_type ?? "knowledge",
  );
  return title ? `${provider}: ${title}` : provider;
}

// Whether a synced shopify_product chunk represents a product that is NOT live
// for sale (placeholder price, hidden price, waitlist, or draft). Prefers the
// centralized `is_placeholder_price` flag stamped by the product sync, and keeps
// the original hard-coded sentinel-price/tag/status checks as a safety fallback
// for legacy chunks synced before the flag existed.
export function isShopifyProductNotLive(
  metadata: Record<string, unknown>,
): boolean {
  if (metadata?.is_placeholder_price === true) return true;
  const tags = String(metadata?.tags ?? "").toLowerCase();
  const price = String(metadata?.price ?? "").trim();
  const placeholderPrice = price !== "" &&
    (Number(price) >= 99999 || price === "0.00" || price === "0");
  return (
    /\bwaitlist\b/.test(tags) ||
    /\bhide-price\b/.test(tags) ||
    /\bdraft\b/.test(String(metadata?.status ?? "").toLowerCase()) ||
    placeholderPrice
  );
}

function classifyKnowledgeSource(input: {
  content: string;
  kind: string;
  source_label: string;
  source_provider?: string | null;
  metadata?: Record<string, unknown> | null;
}): Pick<
  RetrievedChunk,
  "usable_as" | "risk_flags" | "applies_to_all_products" | "chunk_issue_types"
> {
  const provider = String(input.source_provider || "").toLowerCase();
  const kind = String(input.kind || "").toLowerCase();
  const label = String(input.source_label || "").toLowerCase();
  const metadata = input.metadata && typeof input.metadata === "object"
    ? input.metadata
    : {};
  const title = String(metadata.title || metadata.name || "").toLowerCase();
  const content = String(input.content || "");
  const lower = [
    provider,
    kind,
    label,
    title,
    content.slice(0, 1500).toLowerCase(),
  ].join("\n");

  const riskFlags: string[] = [];
  if (
    /\b(full name|full address|email address|order number|phone number|fulde navn|fulde adresse|telefonnummer|ordrenummer|mailadresse)\b/i
      .test(content)
  ) {
    riskFlags.push("asks_for_extra_fields");
  }
  if (
    /\b(known defect|known production|always|never|must|guaranteed|free return|we cover return shipping|fuld refund|altid|aldrig)\b/i
      .test(content)
  ) {
    riskFlags.push("strong_claim");
  }
  if (
    /\b(retailer|forhandler|amazon|power|elgiganten|proshop)\b/i.test(content)
  ) {
    riskFlags.push("retailer_specific");
  }
  if (provider === "shopify_product" && isShopifyProductNotLive(metadata)) {
    riskFlags.push("shopify_product_not_live");
  }

  let usable_as: RetrievedChunk["usable_as"] = "background";
  if (
    provider === "shopify_policy" ||
    /\b(policy|refund policy|shipping policy|terms|return policy|privacy policy)\b/
      .test(lower)
  ) {
    usable_as = "policy";
  } else if (kind === "saved_reply" || provider === "saved_reply") {
    usable_as = "saved_reply";
  } else if (
    /\b(procedure|script|step-by-step|follow these steps|use this script|return for swap|rma|warranty process)\b/i
      .test(content) ||
    // Numbered step list (e.g. "1. Pack the item.\n2. Print a label.\n3. ...").
    // Catches procedure snippets that don't literally contain the word
    // "procedure" — e.g. AceZone's return guide which is just numbered steps
    // followed by an office address. Without this, such snippets fell through
    // to `background` and the writer refused to use them.
    /(^|\n)\s*\d+[.)]\s/.test(content) ||
    // Postal-address shape — "send the item to" or a clear address block.
    // Same purpose: classify return/RMA address snippets as procedure so
    // the writer treats them as authoritative.
    /\b(send (the |this )?item to|send back to|ship (?:back )?to|return to|return shipping address)\b/i
      .test(content)
  ) {
    usable_as = "procedure";
  } else if (provider === "manual_text") {
    // Admin-curated Q&A snippets from the Knowledge UI are written
    // intentionally as authoritative answers to specific customer questions.
    // Default them to `fact` so the writer treats their content as truth
    // rather than mere "background context". Explicit metadata.usable_as
    // (set further down) still wins if the admin overrode it.
    usable_as = "fact";
  } else if (kind === "ticket") {
    usable_as = "tone_example";
  }

  if (/\b(marketing|newsletter|press release|campaign)\b/.test(lower)) {
    usable_as = "ignore";
  }

  // Explicit classification set by shop admin in KB management UI takes priority over heuristic.
  const VALID_USABLE_AS: RetrievedChunk["usable_as"][] = [
    "policy",
    "procedure",
    "fact",
    "saved_reply",
    "tone_example",
    "background",
    "ignore",
  ];
  const explicitUsableAs = typeof input.metadata?.usable_as === "string"
    ? input.metadata.usable_as as RetrievedChunk["usable_as"]
    : null;
  if (explicitUsableAs && VALID_USABLE_AS.includes(explicitUsableAs)) {
    usable_as = explicitUsableAs;
  }

  // "Applies to all products" — set explicitly when a snippet is saved in
  // Product Questions → General. Also derived for snippets ingested before the
  // flag existed: any manual snippet in product-questions that isn't tied to a
  // product belongs to the general bucket.
  const explicitAppliesToAll = input.metadata?.applies_to_all_products === true;
  const metaCategory = String(input.metadata?.category || "").trim();
  const metaProductId = String(input.metadata?.product_id || "").trim();
  const metaProductsLen = Array.isArray(input.metadata?.products)
    ? (input.metadata?.products as unknown[]).length
    : 0;
  const isManualSnippet =
    String(input.source_provider || "").toLowerCase() === "manual_text";
  const derivedAppliesToAll = isManualSnippet &&
    metaCategory === "product-questions" &&
    !metaProductId &&
    metaProductsLen === 0;
  const applies_to_all_products = explicitAppliesToAll || derivedAppliesToAll;

  const rawIssueTypes = Array.isArray(input.metadata?.issue_types)
    ? (input.metadata?.issue_types as unknown[])
    : [];
  const chunk_issue_types = uniqueStrings(
    rawIssueTypes.map((t) => String(t || "").trim().toLowerCase()).filter(
      Boolean,
    ),
  );

  return {
    usable_as,
    risk_flags: [...new Set(riskFlags)],
    applies_to_all_products,
    chunk_issue_types,
  };
}

function diagnosticChunkMeta(row: Record<string, unknown>): {
  source_type: string | null;
  usable_as: RetrievedChunk["usable_as"] | null;
  title: string | null;
  question: string | null;
  products: string[];
  issue_types: string[];
} {
  const metadata = row.metadata && typeof row.metadata === "object"
    ? row.metadata as Record<string, unknown>
    : {};
  const source_label = sourceLabel(row);
  const classified = classifyKnowledgeSource({
    content: String(row.content || ""),
    kind: String(row.source_type || "knowledge"),
    source_label,
    source_provider: row.source_provider as string | null,
    metadata,
  });
  return {
    source_type: row.source_type != null ? String(row.source_type) : null,
    usable_as: classified.usable_as,
    title: shortDiagnosticText(metadataLabelText(metadata)),
    question: typeof metadata.question === "string"
      ? shortDiagnosticText(metadata.question)
      : null,
    products: Array.isArray(metadata.products)
      ? (metadata.products as unknown[]).map((p) =>
        String(p || "").trim().toLowerCase()
      ).filter(Boolean).slice(0, 8)
      : [],
    issue_types: classified.chunk_issue_types.slice(0, 8),
  };
}

function buildRawRankIndex(
  queryPairs: QueryPair[],
  source: QuerySource,
): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const pair of queryPairs) {
    const list = source === "vector" ? pair.vector : pair.bm25;
    list.forEach((row, index) => {
      const id = String(row.id);
      const rank = index + 1;
      const existing = ranks.get(id);
      if (existing == null || rank < existing) ranks.set(id, rank);
    });
  }
  return ranks;
}

type ScoreBreakdown = {
  base_score: number;
  product_boost: number;
  issue_type_boost: number;
  lexical_issue_boost: number;
  product_support_doc_boost: number;
  general_policy_boost: number;
  power_reset_boost: number;
  return_policy_boost: number;
  source_type_boost: number;
  usable_as_boost: number;
  cross_product_penalty: number;
  final_score: number;
};

// B2: canonical product-identity normalizer. Lowercase, trim, and collapse any
// run of hyphens/whitespace to a single space so "A-Spire Wireless",
// "a-spire   wireless" and "a-spire-wireless" compare equal. Used to match a
// customer's resolved product term against a chunk's products[] METADATA — the
// authoritative product tag — instead of counting brand-name occurrences in the
// chunk body (which rewarded verbose product-description chunks and let a
// wrongly-tagged wired chunk slip past the cross-product penalty).
export function normProduct(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[-\s]+/g, " ")
    .trim();
}

export function buildScoreBreakdown(input: {
  chunk: RetrievedChunk;
  mentionedProducts: string[];
  otherProducts: string[];
  issueTerms: string[];
  intentText?: string;
}): ScoreBreakdown {
  const { chunk, mentionedProducts, issueTerms } = input;
  const text = `${chunk.source_label} ${chunk.content}`;
  // Product match is driven by chunk.products[] METADATA, not body text.
  const chunkProductSet = new Set((chunk.products ?? []).map(normProduct));
  const mentionedNorm = mentionedProducts.map(normProduct);
  const metadataMatchCount =
    mentionedNorm.filter((p) => chunkProductSet.has(p)).length;
  const isProductSupportKnowledgeDoc =
    isKnowledgeDocumentProvider(chunk.source_provider) &&
    chunk.document_category === PRODUCT_SUPPORT_DOCUMENT_CATEGORY;
  const isEarPadsAccess =
    chunk.knowledge_document_access_reason === "ear_pads_context";
  const isCrossProductSoftwareAccess =
    chunk.knowledge_document_access_reason === "cross_product_software_context";
  const productSupportScopeMatch = metadataMatchCount > 0 ||
    (isEarPadsAccess && chunkProductSet.has("ear pads"));
  const directProductBoost = metadataMatchCount * 0.10;
  const generalProductBoost =
    chunk.applies_to_all_products && mentionedProducts.length > 0 ? 0.05 : 0;
  const productBoost = directProductBoost + generalProductBoost;
  // Penalize a product-specific chunk whose metadata names a DIFFERENT product
  // than the single product the customer asked about.
  const crossProductPenalty = !isEarPadsAccess &&
      !isCrossProductSoftwareAccess &&
      !chunk.applies_to_all_products &&
      mentionedProducts.length === 1 &&
      chunkProductSet.size > 0 &&
      metadataMatchCount === 0
    ? 0.12
    : 0;
  const taggedIssueOverlap =
    chunk.chunk_issue_types.filter((t) => issueTerms.includes(t)).length;
  const issueTypeBoost = taggedIssueOverlap * 0.06;
  const lexicalIssueOverlap = overlapCount(text, issueTerms);
  const lexicalIssueBoost = lexicalIssueOverlap * 0.02;
  const productSupportDocBoost = isProductSupportKnowledgeDoc &&
      (chunk.knowledge_document_access_reason === "same_product_context" ||
        isEarPadsAccess ||
        isCrossProductSoftwareAccess) &&
      (productSupportScopeMatch || isCrossProductSoftwareAccess) &&
      hasLexicalIssueSignal(text, issueTerms)
    ? 0.16
    : 0;
  const intentText = input.intentText ?? "";
  const isGeneralKnowledgeDoc =
    isKnowledgeDocumentProvider(chunk.source_provider) &&
    chunk.document_category === GENERAL_DOCUMENT_CATEGORY;
  const generalPolicyBoost = isAccessoryReplacementContext(intentText) &&
      isGeneralKnowledgeDoc &&
      hasAccessoryReplacementSignal(text)
    ? 0.18
    : 0;
  const powerResetBoost = isPowerResetContext(intentText) &&
      hasResetProcedureSignal(text) &&
      !isPureCableAdapterCompatibility(text)
    ? 0.18
    : 0;
  const returnPolicyBoost = returnPolicyBoostForChunk({
    chunk,
    intentText,
    issueTerms,
  });
  const sourceTypeBoost =
    /manual_text|snippet/i.test(`${chunk.source_label} ${chunk.kind}`)
      ? 0.04
      : 0;
  const usableAsBoost = (chunk.usable_as === "saved_reply" ? 0.06 : 0) +
    (chunk.usable_as === "policy" ? 0.02 : 0) +
    (chunk.usable_as === "fact" ? 0.02 : 0);
  const finalScore = chunk.similarity +
    productBoost +
    issueTypeBoost +
    lexicalIssueBoost +
    productSupportDocBoost +
    generalPolicyBoost +
    powerResetBoost +
    returnPolicyBoost +
    sourceTypeBoost +
    usableAsBoost -
    crossProductPenalty;
  return {
    base_score: chunk.similarity,
    product_boost: productBoost,
    issue_type_boost: issueTypeBoost,
    lexical_issue_boost: lexicalIssueBoost,
    product_support_doc_boost: productSupportDocBoost,
    general_policy_boost: generalPolicyBoost,
    power_reset_boost: powerResetBoost,
    return_policy_boost: returnPolicyBoost,
    source_type_boost: sourceTypeBoost,
    usable_as_boost: usableAsBoost,
    cross_product_penalty: crossProductPenalty,
    final_score: finalScore,
  };
}

export function buildRetrievalCandidateDiagnostics(input: {
  plannerQueries: string[];
  fallbackQueries: FallbackQuery[];
  queryDefs: FallbackQuery[];
  queryPairs: QueryPair[];
  fusedRaw: Array<{
    id: string;
    score: number;
    vectorSimilarity: number | null;
    chunk: Record<string, unknown>;
  }>;
  scoredChunks: RetrievedChunk[];
  candidatesPostDedupe: RetrievedChunk[];
  matcherPool: RetrievedChunk[];
  matcherDebug?: RetrieverResult["matcher_debug"];
  finalChunks: RetrievedChunk[];
  scoreBreakdown: (chunk: RetrievedChunk) => ScoreBreakdown;
  // B2: resolved (most-specific) product terms detected on the query. Optional —
  // when absent, the product_scoring diagnostics block is omitted.
  mentionedProductsResolved?: string[];
}): RetrievalCandidateDiagnostics {
  const vectorRanks = buildRawRankIndex(input.queryPairs, "vector");
  const bm25Ranks = buildRawRankIndex(input.queryPairs, "bm25");
  const queryResults: RetrievalCandidateDiagnostics["query_results"] = [];
  input.queryPairs.forEach((pair, queryIndex) => {
    const query = input.queryDefs[queryIndex]?.text ?? "";
    for (const source of ["vector", "bm25"] as const) {
      const list = source === "vector" ? pair.vector : pair.bm25;
      list.forEach((row, index) => {
        if (queryResults.length >= MAX_DIAGNOSTIC_QUERY_RESULTS) return;
        const meta = diagnosticChunkMeta(row);
        queryResults.push({
          query,
          query_index: queryIndex,
          source,
          chunk_id: String(row.id),
          raw_rank: index + 1,
          raw_score: typeof row.similarity === "number" ? row.similarity : null,
          source_type: meta.source_type,
          usable_as: meta.usable_as,
          title: meta.title,
          question: meta.question,
          products: meta.products,
          issue_types: meta.issue_types,
        });
      });
    }
  });

  return {
    planner_queries: input.plannerQueries.slice(0, 5),
    fallback_queries: input.fallbackQueries.slice(0, 5).map((q) => ({
      query: q.text,
      product_agnostic: q.productAgnostic,
    })),
    query_results: queryResults,
    merged_candidates_pre_score: input.fusedRaw
      .slice(0, MAX_DIAGNOSTIC_CANDIDATES)
      .map((row) => ({
        chunk_id: String(row.id),
        vector_rank: vectorRanks.get(String(row.id)) ?? null,
        bm25_rank: bm25Ranks.get(String(row.id)) ?? null,
        rrf_score: row.score,
      })),
    scored_candidates_pre_dedupe: input.scoredChunks
      .slice(0, MAX_DIAGNOSTIC_CANDIDATES)
      .map((chunk) => ({
        chunk_id: String(chunk.id),
        ...input.scoreBreakdown(chunk),
      })),
    candidates_post_dedupe: input.candidatesPostDedupe
      .slice(0, MAX_DIAGNOSTIC_CANDIDATES)
      .map((chunk) => String(chunk.id)),
    matcher_pool_top15: input.matcherPool.map((chunk) => String(chunk.id)),
    matcher_selected_ids: (input.matcherDebug?.selected_ids ?? []).map((id) =>
      String(id)
    ),
    matcher_abstain: input.matcherDebug?.abstained ?? null,
    final_selected_ids: input.finalChunks.map((chunk) => String(chunk.id)),
    final_chunks: input.finalChunks.map((chunk) => {
      const breakdown = input.scoreBreakdown(chunk);
      const fallbackDetails = input.matcherDebug?.policy_fallback_details?.find(
        (d) => String(d.chunk_id) === String(chunk.id),
      );
      const selectedByPolicyFallback =
        Boolean(input.matcherDebug?.policy_fallback) &&
        Boolean(fallbackDetails);
      return {
        id: String(chunk.id),
        title: shortDiagnosticText(
          chunk.source_title ?? chunk.source_label ?? "",
        ),
        usable_as: chunk.usable_as,
        source_type: chunk.kind ?? null,
        source_provider: chunk.source_provider ?? null,
        category: chunk.document_category ?? null,
        document_category: chunk.document_category ?? null,
        document_type: chunk.document_type ?? null,
        score: chunk.similarity,
        base_score: breakdown.base_score,
        final_score: breakdown.final_score,
        vector_similarity: chunk.vector_similarity ?? null,
        excerpt: shortDiagnosticText(chunk.content ?? "") ?? "",
        selected_by_policy_fallback: selectedByPolicyFallback,
        fallback_ranking_score: fallbackDetails?.ranking_score ?? null,
        fallback_overlap_reason: fallbackDetails?.overlap_reason ?? null,
      };
    }),
    ...(input.mentionedProductsResolved
      ? {
        product_scoring: {
          product_match_source: "metadata" as const,
          mentioned_products_resolved: input.mentionedProductsResolved.map(
            normProduct,
          ),
          per_chunk: input.scoredChunks
            .slice(0, MAX_DIAGNOSTIC_CANDIDATES)
            .map((chunk) => {
              const b = input.scoreBreakdown(chunk);
              return {
                chunk_id: String(chunk.id),
                chunk_products_normalized: (chunk.products ?? []).map(
                  normProduct,
                ),
                product_boost: b.product_boost,
                cross_product_penalty: b.cross_product_penalty,
              };
            }),
        },
      }
      : {}),
  };
}

export function buildRetrievalCandidateDiagnosticsBestEffort(
  build: () => RetrievalCandidateDiagnostics,
): RetrievalCandidateDiagnostics | undefined {
  try {
    return build();
  } catch (err) {
    console.warn(
      `[retriever] candidate diagnostics skipped: ${(err as Error).message}`,
    );
    return undefined;
  }
}

function tokenOverlapJaccard(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  const intersection = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 ? intersection / union : 0;
}

function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const isDuplicate = kept.some(
      (k) => tokenOverlapJaccard(k.content, chunk.content) >= 0.6,
    );
    if (!isDuplicate) kept.push(chunk);
  }
  return kept;
}

// Reciprocal Rank Fusion over multiple ranked lists.
// k=60 dampens high-rank advantage.
function rrfFusion(
  lists: Array<Array<Record<string, unknown>>>,
  k = 60,
): Array<
  {
    id: string;
    score: number;
    vectorSimilarity: number | null;
    chunk: Record<string, unknown>;
  }
> {
  const scores = new Map<
    string,
    {
      id: string;
      score: number;
      vectorSimilarity: number | null;
      chunk: Record<string, unknown>;
    }
  >();

  for (const list of lists) {
    list.forEach((item, rank) => {
      const id = item.id as string;
      const existing = scores.get(id) ??
        { id, score: 0, vectorSimilarity: null, chunk: item };
      existing.score += 1 / (k + rank + 1);
      const sim = typeof item.similarity === "number" ? item.similarity : null;
      if (sim !== null) {
        existing.vectorSimilarity = existing.vectorSimilarity === null
          ? sim
          : Math.max(existing.vectorSimilarity, sim);
      }
      existing.chunk = item;
      scores.set(id, existing);
    });
  }

  return [...scores.values()].sort((a, b) => b.score - a.score);
}

// Run vector + BM25 for a single query string. Returns two ranked lists.
async function runQueryPair(
  query: string,
  shop_id: string,
  supabase: SupabaseClient,
  filterProducts?: string[],
  filterIssueTypes?: string[],
): Promise<
  {
    vector: Array<Record<string, unknown>>;
    bm25: Array<Record<string, unknown>>;
  }
> {
  const [vectorResult, bm25Result] = await Promise.allSettled([
    (async () => {
      const embedding = await embedText(query);
      const { data, error } = await supabase.rpc("match_agent_knowledge", {
        query_embedding: embedding,
        match_count: 20,
        filter_shop_id: shop_id,
        filter_products: filterProducts?.length ? filterProducts : null,
        filter_issue_types: filterIssueTypes?.length ? filterIssueTypes : null,
      });
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    })(),
    (async () => {
      const safeQuery = sanitiseBm25Query(query);
      if (!safeQuery) return [];
      const { data, error } = await supabase
        .from("agent_knowledge")
        .select("id, content, source_type, source_provider, metadata")
        .eq("shop_id", shop_id)
        .neq("source_type", "ticket")
        .neq("source_provider", "saved_reply")
        .textSearch("content", safeQuery, { type: "websearch" })
        .limit(15);
      if (error) {
        console.warn("[retriever] BM25 search error:", error.message);
        return [];
      }
      // BM25 bypasses match_agent_knowledge, so apply the soft-disable filter
      // here too (archived / disabled_for_ai / active_for_ai=false).
      return filterSoftDisabledRows(
        (data ?? []) as Array<Record<string, unknown>>,
      );
    })(),
  ]);

  return {
    vector: vectorResult.status === "fulfilled" ? vectorResult.value : [],
    bm25: bm25Result.status === "fulfilled" ? bm25Result.value : [],
  };
}

export async function runRetriever(
  {
    plan,
    shop_id,
    workspace_id,
    customerMessage,
    shop,
    supabase,
    excludeExternalTicketId,
    excludeChunkIds,
    coherenceFlags,
  }: RetrieverInput,
): Promise<RetrieverResult> {
  const excludedIdSet = new Set(
    (excludeChunkIds ?? []).map((id) => String(id)).filter(Boolean),
  );
  const flags: RetrievalCoherenceFlags = {
    absFloor: coherenceFlags?.absFloor ?? null,
    pqBudget: coherenceFlags?.pqBudget ?? null,
    issueTiebreak: coherenceFlags?.issueTiebreak === true,
    sourceConsolidate: coherenceFlags?.sourceConsolidate === true,
  };
  // Assemble queries with per-query filter intent. Planner sub_queries inherit
  // the strict product filter; fallback queries carry their own productAgnostic
  // flag (return/refund probes run product-agnostic — see buildFallbackQueries).
  const queryDefs: FallbackQuery[] = [];
  const seenQueryText = new Set<string>();
  const plannerQueries = plan.sub_queries.filter(Boolean);
  for (const text of plannerQueries) {
    if (seenQueryText.has(text)) continue;
    seenQueryText.add(text);
    queryDefs.push({ text, productAgnostic: false });
  }
  const fallbackQueries = buildFallbackQueries(plan, customerMessage, shop);
  for (const q of fallbackQueries) {
    if (seenQueryText.has(q.text)) continue;
    seenQueryText.add(q.text);
    queryDefs.push(q);
  }
  const boundedQueryDefs = queryDefs.slice(0, 5);
  const queries = boundedQueryDefs.map((q) => q.text);
  if (queries.length === 0) return { chunks: [], past_ticket_examples: [] };

  const filterProducts = extractMentionedProductTerms(
    customerMessage || "",
    shop,
  );
  const intentIssueTypes = INTENT_TO_ISSUE_TYPES[plan.primary_intent] ?? [];
  const detectedIssueTypes = extractIssueTerms(customerMessage || "");
  const filterIssueTypes = uniqueStrings([
    ...intentIssueTypes,
    ...detectedIssueTypes,
  ]);

  // Resolve which ticket_examples ids to exclude (eval data-leakage prevention).
  const excludedTicketExampleIds = new Set<number>();
  if (excludeExternalTicketId) {
    const { data: excludeRows } = await supabase
      .from("ticket_examples")
      .select("id")
      .eq("shop_id", shop_id)
      .eq("external_ticket_id", excludeExternalTicketId);
    for (const row of excludeRows ?? []) {
      if (typeof row.id === "number") excludedTicketExampleIds.add(row.id);
    }
  }

  // Run knowledge queries + ticket lookup in parallel. Saved replies are indexed
  // into agent_knowledge with source_provider='saved_reply', so they use the same
  // metadata/product retrieval path as other knowledge.
  const [queryPairs, ticketResult] = await Promise.all([
    (async () => {
      const filtered = await Promise.all(
        boundedQueryDefs.map((q) =>
          runQueryPair(
            q.text,
            shop_id,
            supabase,
            // Return/refund probes run product-agnostic so product-independent
            // return content isn't dropped by a strict product filter.
            q.productAgnostic ? undefined : filterProducts,
            filterIssueTypes,
          )
        ),
      );
      const totalHits = filtered.reduce(
        (sum, p) => sum + p.vector.length + p.bm25.length,
        0,
      );
      if (
        totalHits === 0 &&
        (filterProducts.length > 0 || filterIssueTypes.length > 0)
      ) {
        console.log(
          "[retriever] metadata filter returned 0 results — falling back to unfiltered search",
        );
        return Promise.all(
          queries.map((q) => runQueryPair(q, shop_id, supabase)),
        );
      }
      return filtered;
    })(),
    // Dedicated ticket_examples lookup via own RPC — separate vector index, typed columns
    (async () => {
      try {
        const embeddings = await Promise.all(
          queries.slice(0, 2).map((query) => embedText(query)),
        );
        const intent = plan.primary_intent !== "other"
          ? plan.primary_intent
          : null;
        const resultMap = new Map<
          string,
          {
            customer_msg: string;
            agent_reply: string;
            subject?: string;
            intent?: string;
            csat_score: number | null;
            conversation_context: string | null;
            id: number;
            similarity: number;
            score: number;
          }
        >();

        for (const embedding of embeddings) {
          for (
            const filterIntent of uniqueStrings([
              intent || "",
              "",
            ])
          ) {
            const { data, error } = await supabase.rpc(
              "match_ticket_examples",
              {
                query_embedding: embedding,
                match_count: 5,
                filter_shop_id: shop_id,
                filter_intent: filterIntent || null,
              },
            );
            if (error) {
              console.warn(
                "[retriever] ticket_examples lookup error:",
                error.message,
              );
              continue;
            }

            for (const row of data ?? []) {
              const item = row as {
                id: number;
                customer_msg: string;
                agent_reply: string;
                subject?: string;
                intent?: string;
                csat_score?: number | null;
                conversation_context?: string | null;
                similarity: number;
              };
              const text = `${
                item.subject || ""
              } ${item.customer_msg} ${item.agent_reply}`;
              const queryText = `${queries.join(" ")} ${customerMessage || ""}`;
              const productTerms = extractMentionedProductTerms(
                queryText,
                shop,
              );
              const issueTerms = extractIssueTerms(queryText);
              const lexicalScore = overlapCount(text, productTerms) * 0.12 +
                overlapCount(text, issueTerms) * 0.08;
              // Boost heavily-corrected examples — low csat_score means the shop
              // had to rewrite Sona's draft significantly, making it a richer learning signal.
              const csatScore = typeof item.csat_score === "number"
                ? item.csat_score
                : null;
              const correctionBoost = csatScore !== null
                ? ((100 - csatScore) / 100) * 0.15
                : 0;
              const score = Number(item.similarity || 0) + lexicalScore +
                correctionBoost;
              // Skip tickets that are the source of this eval run
              if (excludedTicketExampleIds.has(item.id)) continue;
              const existing = resultMap.get(String(item.id));
              if (!existing || score > existing.score) {
                resultMap.set(String(item.id), {
                  id: item.id,
                  customer_msg: item.customer_msg,
                  agent_reply: item.agent_reply,
                  subject: item.subject,
                  intent: item.intent,
                  csat_score: csatScore,
                  conversation_context: item.conversation_context ?? null,
                  similarity: item.similarity,
                  score,
                });
              }
            }
          }
        }

        return [...resultMap.values()]
          .filter((item) =>
            item.agent_reply && item.agent_reply.length > 20 &&
            item.score >= 0.45
          )
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((item) => ({
            id: item.id,
            customer_msg: item.customer_msg,
            agent_reply: item.agent_reply,
            subject: item.subject ?? null,
            score: item.score,
            csat_score: item.csat_score,
            conversation_context: item.conversation_context ?? null,
          }));
      } catch (err) {
        console.warn("[retriever] ticket_examples lookup failed:", err);
        return [];
      }
    })(),
  ]);

  // Fuse knowledge chunks (policies, FAQs, product info) — tickets handled separately
  const allLists: Array<Array<Record<string, unknown>>> = [];
  for (const pair of queryPairs) {
    if (pair.vector.length > 0) allLists.push(pair.vector);
    if (pair.bm25.length > 0) allLists.push(pair.bm25);
  }

  const fusedRaw = rrfFusion(allLists);
  // Drop excluded chunks before any scoring/ranking — used by the snippet
  // preview feature to simulate "what would the AI answer if this snippet
  // wasn't in the knowledge base?"
  const fused = excludedIdSet.size
    ? fusedRaw.filter((r) => !excludedIdSet.has(String(r.id)))
    : fusedRaw;

  // Knowledge chunks include saved replies indexed into agent_knowledge.
  //
  // Budget is intent-aware: complaint/technical_support tickets typically have
  // ONE specific problem (e.g. "headset shuts down randomly"), and sending 4
  // semantically-similar snippets ("powers off", "audio cuts out", "mic
  // doesn't work", "bluetooth workaround") causes the writer to blend them
  // into a generic response instead of using the single best match. Trim to
  // 2 for these intents. Other intents keep the wider context window because
  // returns, refunds, exchanges etc. often legitimately span multiple
  // procedures / policies in one reply.
  const knowledgeBudget = resolveKnowledgeBudget(
    plan.primary_intent,
    flags.pqBudget,
  );
  const queryText = `${queries.join(" ")} ${customerMessage || ""}`;
  const productTerms = extractMentionedProductTerms(queryText, shop);
  const issueTerms = extractIssueTerms(queryText);
  // When exactly one product is mentioned, identify other shop products to penalise
  const mentionedProducts = productTerms.length > 0 ? productTerms : [];
  const allShopProducts = buildShopProductTerms(shop);
  const otherProducts = mentionedProducts.length === 1
    ? allShopProducts.filter((p) => p !== mentionedProducts[0])
    : [];

  const scoreBreakdown = (chunk: RetrievedChunk) =>
    buildScoreBreakdown({
      chunk,
      mentionedProducts,
      otherProducts,
      issueTerms,
      intentText: queryText,
    });

  const scoredChunks: RetrievedChunk[] = fused
    // Internal rules (metadata.audience === "internal") are injected
    // deterministically by the internal-rules stage and must NEVER reach the
    // customer-facing knowledge block. Knowledge Docs are the one exception:
    // they are deliberately authored as internal, human-reviewed draft context,
    // and pass through only when the document-specific runtime scope gate below
    // says the current ticket matches the document category/product.
    .filter((r) => {
      const meta = r.chunk.metadata && typeof r.chunk.metadata === "object"
        ? r.chunk.metadata as Record<string, unknown>
        : {};
      const sourceProvider = r.chunk.source_provider as string | null;
      if (isKnowledgeDocumentProvider(sourceProvider)) {
        return evaluateRuntimeKnowledgeDocumentAccess({
          source_provider: sourceProvider,
          content: String(r.chunk.content || ""),
          metadata: meta,
          plan,
          customerMessage,
          shop,
        }).allowed;
      }
      return String(meta.audience || "").toLowerCase() !== "internal";
    })
    .map((r) => {
      const meta = r.chunk.metadata && typeof r.chunk.metadata === "object"
        ? r.chunk.metadata as Record<string, unknown>
        : {};
      const sourceProvider = r.chunk.source_provider as string | null;
      const accessDecision = isKnowledgeDocumentProvider(sourceProvider)
        ? evaluateRuntimeKnowledgeDocumentAccess({
          source_provider: sourceProvider,
          content: String(r.chunk.content || ""),
          metadata: meta,
          plan,
          customerMessage,
          shop,
        })
        : null;
      const runtimeDocumentProducts =
        isKnowledgeDocumentProvider(sourceProvider)
          ? extractKnowledgeDocumentProductTerms({
            content: String(r.chunk.content || ""),
            metadata: meta,
            shop,
          })
          : [];
      const metadataProducts = Array.isArray(meta.products)
        ? (meta.products as unknown[]).map((p) =>
          String(p || "").trim().toLowerCase()
        ).filter(Boolean)
        : [];
      const base = {
        id: r.chunk.id as string,
        content: r.chunk.content as string,
        kind: (r.chunk.source_type as string) ?? "knowledge",
        source_label: sourceLabel(r.chunk),
        similarity: r.score,
        source_id: meta.source_id != null ? String(meta.source_id) : null,
        source_title:
          String(meta.title || meta.name || meta.label || "").trim() ||
          null,
        chunk_index: typeof meta.chunk_index === "number"
          ? meta.chunk_index
          : null,
        chunk_count: typeof meta.chunk_count === "number"
          ? meta.chunk_count
          : 1,
        products: uniqueStrings([
          ...metadataProducts,
          ...runtimeDocumentProducts,
        ]),
        product_id: meta.product_id != null
          ? String(meta.product_id).trim() || null
          : meta.product_scope != null
          ? String(meta.product_scope).trim() || null
          : null,
        source_provider: sourceProvider,
        document_category: isKnowledgeDocumentProvider(sourceProvider)
          ? String(meta.category || "").trim() || null
          : null,
        document_type: String(meta.document_type || "").trim() || null,
        knowledge_document_access_reason: accessDecision?.reason ?? null,
        vector_similarity: r.vectorSimilarity,
        question: typeof meta.question === "string" ? meta.question : null,
        product_handle: sourceProvider === "shopify_product" &&
            typeof meta.handle === "string"
          ? meta.handle.trim() || null
          : null,
        product_url: sourceProvider === "shopify_product" &&
            typeof meta.url === "string"
          ? meta.url.trim() || null
          : null,
      };
      return {
        ...base,
        ...classifyKnowledgeSource({
          ...base,
          source_provider: sourceProvider,
          metadata: r.chunk.metadata as Record<string, unknown> | null,
        }),
      };
    })
    .filter((chunk) =>
      !isVariantConflictingSource(customerMessage || "", {
        source_label: chunk.source_label,
        content: chunk.content,
        kind: chunk.kind,
        usable_as: chunk.usable_as,
      })
    )
    .sort((a, b) =>
      scoreBreakdown(b).final_score - scoreBreakdown(a).final_score
    );

  // Mechanism 3: collapse to a dominant multi-chunk guide when one exists.
  // Inert for single-chunk-snippet shops (all source_id null) — see helper.
  const consolidated = flags.sourceConsolidate
    ? consolidateDominantSource(scoredChunks)
    : scoredChunks;

  const regularChunks: RetrievedChunk[] = consolidated
    // Deduplicate near-identical chunks before applying budget
    .reduce((acc: RetrievedChunk[], chunk) => {
      const isDuplicate = acc.some(
        (k) => tokenOverlapJaccard(k.content, chunk.content) >= 0.6,
      );
      return isDuplicate ? acc : [...acc, chunk];
    }, [])
    // Only include chunks that clear a minimum relevance floor relative to the top score
    .filter((chunk, _i, arr) => {
      if (arr.length === 0) return true;
      const topSimilarity = arr[0].similarity;
      // Always include at least 3 results; after that require >= 60% of top score
      return _i < 3 || chunk.similarity >= topSimilarity * 0.6;
    })
    .slice(0, knowledgeBudget);

  // Mechanism 1: drop the whole knowledge block when nothing clears the
  // absolute cosine floor (junk-fallback guard).
  if (flags.absFloor !== null) {
    const floored = applyAbsoluteFloor(regularChunks, flags.absFloor);
    if (floored.length !== regularChunks.length) {
      console.log(
        `[retriever] abs-floor gate → dropping knowledge block (best vector_similarity below ${flags.absFloor})`,
      );
      regularChunks.length = 0;
      regularChunks.push(...floored);
    }
  }

  // ---- Snippet-matcher: cross-lingual precision + abstention ----
  // Re-rank a broad candidate pool against the customer message with an LLM and
  // select the winner(s) — or abstain (zero chunks) when nothing truly answers
  // the request. Replaces the old lexical title-match override + issue-tiebreak.
  // Never blocks a draft: on any failure we fall back to regularChunks (today's
  // behaviour). matcher_debug is for eval only.
  const candidatesPostDedupe = consolidated
    .reduce((acc: RetrievedChunk[], chunk) => {
      const dup = acc.some((k) =>
        tokenOverlapJaccard(k.content, chunk.content) >= 0.6
      );
      return dup ? acc : [...acc, chunk];
    }, []);
  const pool = candidatesPostDedupe.slice(0, MATCH_POOL_SIZE);

  let finalChunks = regularChunks;
  let matcherDebug: RetrieverResult["matcher_debug"] | undefined;

  if (customerMessage && pool.length > 0) {
    const byId = new Map(pool.map((c) => [c.id, c]));
    const candidates: MatchCandidate[] = pool.map((c) => ({
      id: c.id,
      question: c.question ?? null,
      title: c.source_label,
      excerpt: c.content,
    }));
    try {
      const matched = await matchSnippets(customerMessage, candidates, {
        model: SNIPPET_MATCHER_MODEL,
        threshold: SNIPPET_MATCHER_THRESHOLD,
        maxSelected: knowledgeBudget,
        marginMin: SNIPPET_MATCHER_MARGIN,
      });
      finalChunks = matched.selected
        .map((s) => byId.get(s.id))
        .filter((c): c is RetrievedChunk => Boolean(c));
      // Fix B.2: when the matcher selected nothing, rescue the top already-pooled
      // policy/procedure chunks by RETRIEVAL score (not matcher relevance, which
      // de-ranks guardrail chunks by design). Conservative + capped; normal
      // selection is untouched when the matcher picked anything.
      let policyFallback = false;
      let policyFallbackDetails: PolicyFallbackDebug[] = [];
      if (finalChunks.length === 0) {
        const rescued = selectPolicyFallback(pool, {
          max: POLICY_FALLBACK_MAX,
          scoreRatio: POLICY_FALLBACK_SCORE_RATIO,
          customerMessage,
          plannerQueries,
          issueTerms,
        });
        if (rescued.chunks.length > 0) {
          finalChunks = rescued.chunks;
          policyFallbackDetails = rescued.debug;
          policyFallback = true;
        }
      }
      console.log(
        `[retriever] snippet-matcher selected=${finalChunks.length} abstained=${matched.abstained} pool=${pool.length} policy_fallback=${policyFallback}`,
      );
      matcherDebug = {
        candidates: pool.map((c) => ({
          id: c.id,
          source_id: c.source_id ?? null,
          title: c.source_title ?? c.source_label,
        })),
        ranked: matched.ranked.map((r) => {
          const c = byId.get(r.id);
          return {
            id: r.id,
            source_id: c?.source_id ?? null,
            title: c?.source_title ?? c?.source_label ?? "",
            relevance: r.relevance,
          };
        }),
        selected_ids: finalChunks.map((c) => c.id),
        abstained: matched.abstained,
        fell_back: false,
        policy_fallback: policyFallback,
        policy_fallback_count: policyFallback ? finalChunks.length : 0,
        policy_fallback_score_basis: policyFallback
          ? "retrieval_score_plus_lexical_intent"
          : null,
        policy_fallback_details: policyFallback ? policyFallbackDetails : [],
      };
    } catch (err) {
      // Additive layer: never make things worse than today. Keep regularChunks.
      console.error(
        `[retriever] snippet-matcher failed, falling back to top-chunks: ${
          (err as Error).message
        }`,
      );
      try {
        await supabase.from("agent_logs").insert({
          shop_id,
          workspace_id: workspace_id ?? null,
          step: "snippet_matcher_fallback",
          step_detail: {
            error: (err as Error).message,
            pool_size: pool.length,
          },
        });
      } catch (_logErr) {
        // logging must never block a draft
      }
      finalChunks = regularChunks;
      matcherDebug = {
        candidates: pool.map((c) => ({
          id: c.id,
          source_id: c.source_id ?? null,
          title: c.source_title ?? c.source_label,
        })),
        ranked: regularChunks.map((c) => ({
          id: c.id,
          source_id: c.source_id ?? null,
          title: c.source_title ?? c.source_label,
          relevance: 0,
        })),
        selected_ids: regularChunks.map((c) => c.id),
        abstained: false,
        fell_back: true,
      };
    }
  }

  const candidateDiagnostics = buildRetrievalCandidateDiagnosticsBestEffort(
    () =>
      buildRetrievalCandidateDiagnostics({
        plannerQueries,
        fallbackQueries,
        queryDefs: boundedQueryDefs,
        queryPairs,
        fusedRaw,
        scoredChunks,
        candidatesPostDedupe,
        matcherPool: pool,
        matcherDebug,
        finalChunks,
        scoreBreakdown,
        mentionedProductsResolved: mentionedProducts,
      }),
  );

  // Past ticket examples — directly from typed ticket_examples table
  const pastTicketExamples = ticketResult
    .filter((t) => t.agent_reply && t.agent_reply.length > 20)
    .map((t) => ({
      customer_msg: t.customer_msg,
      agent_reply: t.agent_reply,
      subject: t.subject ?? null,
      score: t.score,
      csat_score: t.csat_score ?? null,
      conversation_context: t.conversation_context ?? null,
    }));

  console.log(
    `[retriever] queries=${queries.length} knowledge=${finalChunks.length} saved_reply_knowledge=${
      finalChunks.filter((chunk) => chunk.usable_as === "saved_reply").length
    } past_tickets=${pastTicketExamples.length}`,
  );

  return {
    chunks: finalChunks,
    past_ticket_examples: pastTicketExamples,
    ...(matcherDebug ? { matcher_debug: matcherDebug } : {}),
    ...(candidateDiagnostics
      ? { candidate_diagnostics: candidateDiagnostics }
      : {}),
  };
}
