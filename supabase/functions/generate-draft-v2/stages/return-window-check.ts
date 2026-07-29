// supabase/functions/generate-draft-v2/stages/return-window-check.ts
//
// Pure, deterministic post-writer safety check. NO DB / NO API / NO LLM.
//
// Observed live (C5, 2026-07-28): the writer granted a return on an order
// placed five months earlier, with full return instructions. The order-age
// fact was present and explicitly said not to promise return rights without a
// documented policy — but retrieval had surfaced the policy chunk holding the
// return ADDRESS rather than the one holding the window, and prose directives
// do not bind a model.
//
// This module compares the documented window against the order's actual age
// and reports whether a human should look. It deliberately does NOT block or
// rewrite: whether to honour a late return is a business judgement (goodwill,
// warranty vs. statutory regret), and a hard refusal would be wrong as often
// as it was right. What must not happen is Sona granting it unilaterally.
//
// Shop-agnostic: the window always comes from the shop's own retrieved policy,
// never from a hardcoded default.

import type { RetrievedChunk } from "./retriever.ts";

export type ReturnWindowViolationType =
  | "return_granted_outside_window"
  | "return_granted_without_documented_window";

export type ReturnWindowCheckInput = {
  draft_text: string;
  // Age of the matched order in whole days, or null when no order is known.
  order_age_days: number | null;
  retrieved_chunks?: RetrievedChunk[];
};

export type ReturnWindowCheckResult = {
  compliant: boolean;
  violations: Array<{
    type: ReturnWindowViolationType;
    excerpt: string;
    order_age_days: number;
    // Absent when the retrieved knowledge documents no window at all.
    documented_window_days?: number;
  }>;
  requires_review: boolean;
};

// Active, first-person grants of a return. Questions and conditionals are
// excluded by construction: these all require the agent to be DOING something.
const GRANT_PATTERNS: RegExp[] = [
  // DA: "jeg igangsætter returprocessen", "vi opretter en retursag"
  /\b(?:jeg|vi)\s+(?:igangsætter|opretter|starter|sætter\s+i\s+gang|behandler)\b[^.?!\n]{0,60}\bretur/i,
  // DA: "send venligst pakken til", "returnér varen til"
  /\b(?:send|sender|returnér|returner)\b(?:\s+venligst)?[^.?!\n]{0,40}\b(?:pakken|varen|produktet|den)\b[^.?!\n]{0,40}\btil\b/i,
  // EN: "I'm starting the return process", "we are opening a return"
  /\b(?:I(?:'m|\s+am)|we(?:'re|\s+are))\s+(?:starting|initiating|opening|processing)\b[^.?!\n]{0,60}\breturn/i,
  // EN: "please send the package to", "return the item to"
  /\b(?:please\s+send|send|return)\b[^.?!\n]{0,40}\b(?:package|parcel|item|product)\b[^.?!\n]{0,40}\bto\b/i,
];

// Day counts that are never a return window.
const NON_WINDOW_DAY_RE =
  /\b(?:business|working|hverdage?|arbejds)\s*(?:days?|dage?)/i;

// Sentence must be about returning/refunding before a day count in it counts.
const RETURN_CONTEXT_RE =
  /\b(?:return|returner\w*|retur|refund\w*|regret|fortryd\w*|money-?back|byttere\w*)/i;

const DAY_COUNT_RE = /(\d{1,3})\s*[-–]?\s*(?:days?|dages?|dage)\b/gi;

function splitSentences(text: string): string[] {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function grantExcerpt(draftText: string): string | null {
  for (const sentence of splitSentences(draftText)) {
    for (const re of GRANT_PATTERNS) {
      if (re.test(sentence)) return sentence.slice(0, 160);
    }
  }
  return null;
}

// Longest window the shop documents anywhere in the retrieved knowledge.
// Deliberately the maximum: a policy commonly states both a 14-day statutory
// right of regret and a longer voluntary guarantee, and flagging against the
// shorter one would reject returns the shop actually honours.
function documentedWindowDays(chunks: RetrievedChunk[]): number | null {
  let longest: number | null = null;
  for (const c of chunks) {
    for (const sentence of splitSentences(c?.content ?? "")) {
      if (!RETURN_CONTEXT_RE.test(sentence)) continue;
      DAY_COUNT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = DAY_COUNT_RE.exec(sentence)) !== null) {
        // Skip "1–3 business days" style delivery estimates.
        const around = sentence.slice(
          Math.max(0, m.index - 20),
          m.index + m[0].length + 12,
        );
        if (NON_WINDOW_DAY_RE.test(around)) continue;
        const days = Number(m[1]);
        if (!Number.isFinite(days) || days <= 0) continue;
        if (longest === null || days > longest) longest = days;
      }
    }
  }
  return longest;
}

// Pre-writer counterpart to the check below. The writer is unreliable at two
// things this needs: locating a window inside retrieved prose, and doing date
// arithmetic. So we do both here and hand it the finished verdict.
//
// Shape matches ResolvedFact from fact-resolver; kept structural to avoid a
// circular import between the two modules.
export function buildReturnWindowFact(input: {
  order_age_days: number | null;
  retrieved_chunks?: RetrievedChunk[];
}): { label: string; value: string } | null {
  const age = input.order_age_days;
  if (age === null || age === undefined || !Number.isFinite(age)) return null;

  const windowDays = documentedWindowDays(input.retrieved_chunks ?? []);
  const label = "Returvindue";

  if (windowDays === null) {
    return {
      label,
      value:
        `Ordren er ${age} dage gammel. Den hentede viden dokumenterer INTET returvindue. ` +
        `Opfind aldrig en frist, og lov ikke returret. Sig at du skal have det bekræftet ` +
        `af en kollega før du kan love en retur.`,
    };
  }

  if (age > windowDays) {
    return {
      label,
      value:
        `Ordren er ${age} dage gammel, og butikkens dokumenterede returvindue er ${windowDays} dage. ` +
        `Ordren er dermed UDEN FOR returvinduet. Igangsæt ikke en retur og send ikke returinstruktioner ` +
        `eller returadresse. Forklar at ordren ligger uden for fristen, og tilbyd at få en kollega til ` +
        `at vurdere om der kan gøres en undtagelse.`,
    };
  }

  return {
    label,
    value:
      `Ordren er ${age} dage gammel, og butikkens dokumenterede returvindue er ${windowDays} dage. ` +
      `Ordren er INDEN FOR returvinduet.`,
  };
}

export function checkReturnWindow(
  input: ReturnWindowCheckInput,
): ReturnWindowCheckResult {
  const ok: ReturnWindowCheckResult = {
    compliant: true,
    violations: [],
    requires_review: false,
  };

  const age = input.order_age_days;
  // No order means no purchase date. Guessing here would flag every enquiry
  // from a customer we could not match to an order.
  if (age === null || age === undefined || !Number.isFinite(age)) return ok;

  const excerpt = grantExcerpt(input.draft_text ?? "");
  if (!excerpt) return ok;

  const windowDays = documentedWindowDays(input.retrieved_chunks ?? []);

  if (windowDays === null) {
    return {
      compliant: false,
      requires_review: true,
      violations: [{
        type: "return_granted_without_documented_window",
        excerpt,
        order_age_days: age,
      }],
    };
  }

  if (age > windowDays) {
    return {
      compliant: false,
      requires_review: true,
      violations: [{
        type: "return_granted_outside_window",
        excerpt,
        order_age_days: age,
        documented_window_days: windowDays,
      }],
    };
  }

  return ok;
}
