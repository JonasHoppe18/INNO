// supabase/functions/generate-draft-v2/stages/live-fact-action-claim-check.ts
//
// Pure, deterministic post-writer safety check. NO DB / NO API / NO LLM.
//
// The writer can produce claims wider than the verified live facts / executed
// actions available to it. On a FIRST-PASS draft there is no executed action
// (postActionResult is only populated after a human/auto approval executes an
// action in Shopify), so any past-tense "I've sent / cancelled / refunded /
// shipped / delivered" claim is unsupported unless a verified live fact or an
// executed action confirms it. Prompt-only guardrails do not reliably prevent
// this on every model (baseline failures g-037 tracking, g-044 invoice-sent).
//
// This module flags two families of unsupported claim and routes the draft to
// human review. It NEVER rewrites the draft, NEVER executes actions, and is
// shop-agnostic — no shop ids, no per-shop branching.
//
// Precision over recall: only definite, present-claim / past / present-perfect
// phrasings match. Future ("will"), conditional ("once approved", "requires
// approval"), negated ("not shipped yet"), and "requested/forwarded" phrasings
// deliberately do NOT match.

import type { ResolvedFact } from "./fact-resolver.ts";
import type { TrackingFact } from "../../_shared/tracking/normalized-tracking.ts";

export type LiveFactActionViolationType =
  | "live_fact/no_verified_tracking"
  | "live_fact/no_verified_delivery"
  | "live_fact/no_verified_refund"
  | "action/not_executed_invoice"
  | "action/not_executed_cancel"
  | "action/not_executed_address"
  | "action/not_executed_replacement"
  | "action/not_executed_case_update"
  | "action/not_executed_followup";

export type LiveFactActionClaimCheckInput = {
  draft_text: string;
  facts: ResolvedFact[];
  // Verified normalized outbound/return tracking facts (read-only carrier state).
  tracking_facts?: TrackingFact[];
  // Action types that were ACTUALLY executed (postActionResult, outcome
  // "executed"). NOT proposed actions and NOT requires_approval=false — a
  // proposed action is not an executed action.
  executed_action_types?: string[];
  language?: string | null;
};

export type LiveFactActionClaimCheckResult = {
  compliant: boolean;
  violations: Array<{ type: LiveFactActionViolationType; excerpt: string }>;
  requires_review: boolean;
};

// ── Fact-support helpers ────────────────────────────────────────────────────

// A verified tracking fact exists when the fact-resolver emitted a carrier
// tracking / URL / pickup-point / ETA fact (only produced for fulfilled
// orders), OR a normalized outbound tracking fact has a real (non-error)
// verified state. The bare "Tracking: Ordren er endnu ikke afsendt" fact has
// label exactly "Tracking" and is intentionally NOT matched here.
const VERIFIED_TRACKING_FACT_LABEL_RE =
  /^(?:Tracking \(fragtmand\)|Tracking URL|Pakkeshop|Forventet levering|Leveret tidspunkt)$/i;

const TRACKING_ERROR_STATES = new Set(["lookup_error", "unknown"]);

function hasVerifiedTrackingFact(
  facts: ResolvedFact[],
  trackingFacts: TrackingFact[],
): boolean {
  if (facts.some((f) => VERIFIED_TRACKING_FACT_LABEL_RE.test(f.label))) {
    return true;
  }
  return trackingFacts.some((t) =>
    t.direction === "outbound" &&
    t.verification !== "customer_provided" &&
    !TRACKING_ERROR_STATES.has(t.state)
  );
}

// Delivery requires a stronger signal than mere tracking existence: a delivered
// timestamp fact, or an outbound tracking fact whose state is delivered.
function hasVerifiedDeliveryFact(
  facts: ResolvedFact[],
  trackingFacts: TrackingFact[],
): boolean {
  if (facts.some((f) => /^Leveret tidspunkt$/i.test(f.label))) return true;
  return trackingFacts.some((t) =>
    t.direction === "outbound" &&
    t.verification !== "customer_provided" &&
    t.state === "delivered"
  );
}

// A refund is verified-issued only for the deterministic full/partial issued
// states. "ingen refundering udstedt" / "skal gennemgås" / absent → not issued.
function hasVerifiedRefundIssued(facts: ResolvedFact[]): boolean {
  return facts.some((f) =>
    /^Refunderingsstatus: (?:fuld|delvis) refundering udstedt$/i.test(f.label)
  );
}

// ── Claim families ──────────────────────────────────────────────────────────

// Hedge / conditional / future markers. A sentence carrying one of these is a
// pending/conditional statement, never an unconditional completed claim.
const HEDGE_RE =
  /\b(?:requires approval|require approval|once approved|after approval|if (?:approved|eligible)|will be|kræver godkendelse|når (?:den|det|sagen) er godkendt|efter godkendelse|endnu ikke|not yet|har ikke|has not|have not|hasn't|haven't|isn't|aren't)\b/i;

type ClaimFamily = {
  violationType: LiveFactActionViolationType;
  patterns: RegExp[];
  // Returns true when the claim is supported (verified fact or executed action).
  isSupported: (ctx: SupportContext) => boolean;
};

type SupportContext = {
  facts: ResolvedFact[];
  trackingFacts: TrackingFact[];
  executed: string[];
};

function executedMatches(executed: string[], re: RegExp): boolean {
  return executed.some((t) => re.test(t));
}

const FAMILIES: ClaimFamily[] = [
  // 1a. Tracking-exists / shipped / dispatched / on-its-way claims.
  {
    violationType: "live_fact/no_verified_tracking",
    patterns: [
      /\bhere\s+is\s+your\s+tracking\b/i,
      /\byour\s+tracking\s+(?:number|link|code)\s+is\b/i,
      /\b(?:your|the)\s+order\s+has\s+shipped\b/i,
      /\b(?:your|the)\s+order\s+has\s+been\s+(?:shipped|dispatched|sent\s+out)\b/i,
      /\bwe(?:'ve| have)\s+shipped\s+(?:your|the)\s+(?:order|package|parcel)\b/i,
      /\b(?:your|the)\s+(?:order|package|parcel)\s+is\s+on\s+(?:its|it's|the)\s+way\b/i,
      // DA
      /\bdin\s+ordre\s+er\s+(?:blevet\s+)?(?:afsendt|sendt\s+afsted)\b/i,
      /\bpakken\s+er\s+(?:blevet\s+)?(?:afsendt|sendt\s+afsted)\b/i,
      /\bdin\s+pakke\s+er\s+(?:blevet\s+)?(?:afsendt|på\s+vej)\b/i,
      /\bdit\s+trackingnummer\s+er\b/i,
      /\bher\s+er\s+(?:dit|dine)\s+track(?:ing|ingnummer|nummer)\b/i,
      // READINESS-6a: asserted carrier state ("trackingdataene viser at ...",
      // "trackingen viser ...") — a live-fact claim regardless of what follows.
      // Conditional restatements of the customer's own report ("hvis tracking
      // viser leveret", "if the tracking shows") are excluded via lookbehind.
      // READINESS-7: widened to cover other conditional connectors that
      // restate the customer's own premise instead of asserting a new fact
      // ("siden/da/eftersom/fordi tracking viser leveret...").
      /(?<!\bhvis\s)(?<!\bselv\s+om\s)(?<!\bsiden\s)(?<!\bda\s)(?<!\beftersom\s)(?<!\bfordi\s)\btracking(?:en|s|-?data(?:ene)?)?\s+viser\b/i,
      /\bforsendelsen\s+er\s+(?:blevet\s+)?oprettet\b/i,
      // READINESS-6a: shipped claim with an order number and/or "allerede"
      // between "ordre(n)" and "er afsendt" ("din ordre #4602 allerede er
      // afsendt"). Hedges ("endnu ikke") are filtered before matching.
      /\bordren?\s+(?:#?\S{1,12}\s+)?(?:allerede\s+)?er\s+(?:blevet\s+)?afsendt\b/i,
      // READINESS-6a: a concrete tracking link (carrier tracking path + an
      // embedded 8+ digit tracking number) is itself a live-fact claim. A
      // generic tracking-portal link without a number does not match.
      /\bhttps?:\/\/\S*(?:track|sporing|find-pakke|sendungsverfolgung|parcel)\S*\d{8,}/i,
    ],
    isSupported: (ctx) => hasVerifiedTrackingFact(ctx.facts, ctx.trackingFacts),
  },
  // 1b. Delivered claims (stronger support requirement).
  {
    violationType: "live_fact/no_verified_delivery",
    patterns: [
      /\b(?:your|the)\s+(?:order|package|parcel)\s+has\s+been\s+delivered\b/i,
      /\b(?:your|the)\s+(?:order|package|parcel)\s+was\s+delivered\b/i,
      /\bwe(?:'ve| have)\s+delivered\s+(?:your|the)\s+(?:order|package|parcel)\b/i,
      // DA
      /\b(?:din\s+ordre|pakken|din\s+pakke)\s+(?:er|blev)\s+(?:blevet\s+)?leveret\b/i,
    ],
    isSupported: (ctx) => hasVerifiedDeliveryFact(ctx.facts, ctx.trackingFacts),
  },
  // 2. Refund-issued claims.
  {
    violationType: "live_fact/no_verified_refund",
    patterns: [
      /\byour\s+refund\s+has\s+been\s+(?:issued|processed|completed)\b/i,
      /\b(?:the\s+)?refund\s+has\s+been\s+(?:issued|processed)\b/i,
      /\bwe(?:'ve| have)\s+(?:already\s+)?refunded\s+(?:you|your\s+order|the\s+order)\b/i,
      // DA
      /\bdin\s+refundering\s+er\s+(?:blevet\s+)?(?:behandlet|udstedt|gennemført)\b/i,
      /\bvi\s+har\s+(?:allerede\s+)?refunderet\b/i,
      /\bbeløbet\s+er\s+(?:blevet\s+)?refunderet\b/i,
    ],
    isSupported: (ctx) =>
      hasVerifiedRefundIssued(ctx.facts) ||
      executedMatches(ctx.executed, /refund/i),
  },
  // 3a. Invoice-sent claims.
  {
    violationType: "action/not_executed_invoice",
    patterns: [
      /\b(?:i|we)(?:'ve| have)\s+(?:already\s+)?(?:sent|forwarded)\s+(?:you\s+)?(?:the\s+|your\s+|an?\s+)?invoice\b/i,
      /\b(?:the\s+|your\s+)?invoice\s+has\s+been\s+(?:sent|forwarded)\b/i,
      // DA
      /\b(?:jeg|vi)\s+har\s+(?:allerede\s+)?(?:sendt|videresendt|sendt\s+videre)\s+(?:dig\s+)?(?:fakturaen|din\s+faktura|en\s+faktura)\b/i,
      /\b(?:jeg|vi)\s+videresender\s+(?:dig\s+)?(?:fakturaen|din\s+faktura|en\s+faktura)\b/i,
      /\bfakturaen\s+er\s+(?:blevet\s+)?(?:sendt|videresendt|sendt\s+videre)\b/i,
      // READINESS-4: request-noun variants ("fakturaforespørgsel") — a claim
      // of having forwarded the *request* is still an unexecuted-action claim.
      /\b(?:jeg|vi)\s+har\s+(?:allerede\s+)?(?:sendt|videresendt|sendt\s+videre)\s+(?:dig\s+)?(?:din\s+)?fakturaforespørgsel(?:en)?\b/i,
      /\b(?:jeg|vi)\s+har\s+sendt\s+(?:dig\s+)?(?:din\s+)?fakturaforespørgsel(?:en)?\s+videre\b/i,
    ],
    isSupported: (ctx) =>
      executedMatches(ctx.executed, /resend_confirmation_or_invoice|invoice/i),
  },
  // 3b. Order-cancelled claims.
  {
    violationType: "action/not_executed_cancel",
    patterns: [
      /\b(?:your|the)\s+order\s+has\s+been\s+(?:cancelled|canceled)\b/i,
      /\bwe(?:'ve| have)\s+(?:already\s+)?(?:cancelled|canceled)\s+(?:your|the)\s+order\b/i,
      // DA
      /\b(?:din|denne)\s+ordre\s+er\s+(?:blevet\s+)?annulleret\b/i,
      /\bvi\s+har\s+(?:allerede\s+)?annulleret\s+(?:din\s+)?ordre\b/i,
    ],
    isSupported: (ctx) => executedMatches(ctx.executed, /cancel/i),
  },
  // 3c. Address-updated claims.
  {
    violationType: "action/not_executed_address",
    patterns: [
      /\b(?:i|we)(?:'ve| have)\s+(?:already\s+)?(?:updated|changed)\s+(?:your\s+)?(?:shipping\s+)?address\b/i,
      /\b(?:your\s+)?(?:shipping\s+)?address\s+has\s+been\s+(?:updated|changed)\b/i,
      // DA
      /\b(?:jeg|vi)\s+har\s+(?:allerede\s+)?(?:opdateret|ændret)\s+(?:din\s+)?(?:leverings)?adresse\b/i,
      /\bdin\s+(?:leverings)?adresse\s+er\s+(?:blevet\s+)?(?:opdateret|ændret)\b/i,
    ],
    isSupported: (ctx) =>
      executedMatches(ctx.executed, /address|update_shipping/i),
  },
  // 3d. Replacement-sent / replacement-order-created claims.
  {
    violationType: "action/not_executed_replacement",
    patterns: [
      /\byour\s+replacement\s+has\s+been\s+sent\b/i,
      /\bwe(?:'ve| have)\s+(?:already\s+)?sent\s+(?:you\s+)?(?:a\s+|an\s+)?replacement\b/i,
      /\bwe(?:'ve| have)\s+(?:already\s+)?created\s+(?:a\s+|an\s+)?replacement\s+order\b/i,
      /\ba\s+replacement\s+order\s+has\s+been\s+created\b/i,
      // DA
      /\bvi\s+har\s+(?:allerede\s+)?sendt\s+(?:dig\s+)?(?:en\s+)?erstatning\b/i,
      /\bvi\s+har\s+(?:allerede\s+)?oprettet\s+(?:en\s+)?(?:erstatningsordre|ny\s+ordre)\b/i,
    ],
    isSupported: (ctx) => executedMatches(ctx.executed, /replac|exchange/i),
  },
  // 3e. Ticket/order marked as backorder/waitlist. These are merchant-specific
  // case updates and must never be inferred from an old reply example.
  {
    violationType: "action/not_executed_case_update",
    patterns: [
      /\b(?:i|we)(?:'ve| have)\s+(?:now\s+|already\s+)?(?:marked|tagged|added)\s+(?:this|the|your)?\s*(?:ticket|order|request)\s+(?:as|to)\s+(?:a\s+)?(?:back\s*order|waitlist)\b/i,
      /\b(?:this|the|your)\s+(?:ticket|order|request)\s+has\s+been\s+(?:marked|tagged|added)\s+(?:as|to)\s+(?:a\s+)?(?:back\s*order|waitlist)\b/i,
      /\bwe(?:'ll| will)\s+keep\s+(?:this|the|your)\s+(?:ticket|order|request)\s+marked\s+(?:as\s+)?(?:a\s+)?(?:back\s*order|waitlist)\b/i,
      /\b(?:jeg|vi)\s+har\s+(?:nu\s+|allerede\s+)?(?:markeret|tagget|tilføjet)\s+(?:denne|din|sagen|ordren|ticketen)?\s*(?:som|til|på)\s+(?:back\s*order|venteliste)\b/i,
      /\b(?:sagen|ordren|ticketen)\s+er\s+(?:nu\s+)?(?:markeret|tagget|tilføjet)\s+(?:som|til|på)\s+(?:back\s*order|venteliste)\b/i,
      /\bvi\s+holder\s+(?:din|denne)?\s*(?:sag|ordre|ticket)\s+(?:markeret\s+)?(?:som|på)\s+(?:back\s*order|venteliste)\b/i,
    ],
    isSupported: (ctx) =>
      executedMatches(ctx.executed, /tag|note|back.?order|waitlist/i),
  },
  // 3f. A proactive future notification is an operational commitment too. It
  // needs an actual waitlist/subscription/notification action, not merely a
  // historical example where an employee remembered to follow up manually.
  {
    violationType: "action/not_executed_followup",
    patterns: [
      /\bwe(?:'ll| will)\s+keep\s+you\s+(?:posted|updated)\b/i,
      /\bwe(?:'ll| will)\s+(?:notify|message|email)\s+you\s+(?:when|once|as soon as)\b/i,
      /\band\s+(?:we(?:'ll| will)\s+)?(?:notify|message|email)\s+you\s+(?:when|once|as soon as)\b/i,
      /\bvi\s+holder\s+dig\s+opdateret\b/i,
      /\bvi\s+(?:giver|sender)\s+dig\s+besked\s+(?:når|så snart)\b/i,
    ],
    isSupported: (ctx) =>
      executedMatches(ctx.executed, /notify|subscription|subscribe|waitlist/i),
  },
];

// ── Sentence handling ───────────────────────────────────────────────────────

// Strip quoted lines (history / customer text the assistant is not authoring)
// so they cannot create false positives.
function stripQuotedLines(text: string): string {
  return text
    .split(/\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildExcerpt(sentence: string): string {
  const MAX_LEN = 140;
  if (sentence.length <= MAX_LEN) return sentence;
  return `${sentence.slice(0, MAX_LEN).trim()}…`;
}

function hasUnsupportedFamilyClaim(
  sentence: string,
  family: ClaimFamily,
  ctx: SupportContext,
): boolean {
  for (const re of family.patterns) {
    const match = re.exec(sentence);
    if (!match) continue;
    const precedingText = sentence.slice(0, match.index);
    if (HEDGE_RE.test(precedingText)) continue;
    return !family.isSupported(ctx);
  }
  return false;
}

export function checkLiveFactAndActionClaims(
  input: LiveFactActionClaimCheckInput,
): LiveFactActionClaimCheckResult {
  const draftText = input.draft_text ?? "";
  if (!draftText.trim()) {
    return { compliant: true, violations: [], requires_review: false };
  }

  const ctx: SupportContext = {
    facts: Array.isArray(input.facts) ? input.facts : [],
    trackingFacts: Array.isArray(input.tracking_facts)
      ? input.tracking_facts
      : [],
    executed: Array.isArray(input.executed_action_types)
      ? input.executed_action_types
      : [],
  };

  const sentences = splitSentences(stripQuotedLines(draftText));
  const violations: LiveFactActionClaimCheckResult["violations"] = [];

  for (const sentence of sentences) {
    for (const family of FAMILIES) {
      // READINESS-7: a hedge/conditional marker only exempts a claim when it
      // appears BEFORE that claim in the sentence. A compound sentence like
      // "Trackingdata viser X, men Y er endnu ikke Z" carries an unconditional
      // fabricated claim followed by an unrelated hedge about a different
      // sub-fact — the trailing hedge must not retroactively excuse the
      // earlier claim. Only text preceding the actual regex match is checked.
      if (!hasUnsupportedFamilyClaim(sentence, family, ctx)) continue;
      violations.push({
        type: family.violationType,
        excerpt: buildExcerpt(sentence),
      });
    }
  }

  return {
    compliant: violations.length === 0,
    violations,
    requires_review: violations.length > 0,
  };
}

const REMOVABLE_OPERATIONAL_UPDATE_TYPES = new Set<
  LiveFactActionViolationType
>([
  "action/not_executed_case_update",
  "action/not_executed_followup",
]);

/** Remove only sentences that falsely claim an operational case update or a
 * proactive notification. Other high-risk action claims remain review-only;
 * deleting them could change the customer's requested outcome. */
export function removeUnsupportedOperationalUpdateClaims(
  input: LiveFactActionClaimCheckInput,
): string {
  const draft = String(input.draft_text || "").trim();
  if (!draft) return draft;

  const ctx: SupportContext = {
    facts: Array.isArray(input.facts) ? input.facts : [],
    trackingFacts: Array.isArray(input.tracking_facts)
      ? input.tracking_facts
      : [],
    executed: Array.isArray(input.executed_action_types)
      ? input.executed_action_types
      : [],
  };
  const removableFamilies = FAMILIES.filter((family) =>
    REMOVABLE_OPERATIONAL_UPDATE_TYPES.has(family.violationType)
  );
  const sentences = splitSentences(draft);
  const kept = sentences.filter((sentence) =>
    !removableFamilies.some((family) =>
      hasUnsupportedFamilyClaim(sentence, family, ctx)
    )
  );
  if (kept.length === sentences.length) return draft;
  if (kept.length) return kept.join("\n\n").trim();

  const language = String(input.language || "en").toLowerCase().slice(0, 2);
  const fallback: Record<string, string> = {
    da: "Tak for din forståelse.",
    de: "Vielen Dank für Ihr Verständnis.",
    fr: "Merci pour votre compréhension.",
    nl: "Bedankt voor je begrip.",
    sv: "Tack för din förståelse.",
    no: "Takk for forståelsen.",
    en: "Thank you for your understanding.",
  };
  return fallback[language] ?? fallback.en;
}
