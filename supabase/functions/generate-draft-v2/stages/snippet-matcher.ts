// supabase/functions/generate-draft-v2/stages/snippet-matcher.ts
//
// Cross-lingual LLM precision layer. Given the customer message and a broad
// candidate pool from hybrid retrieval, an LLM (gpt-4o-mini) ranks each
// candidate by how well it ANSWERS the customer's actual request — matching on
// meaning across languages, not topic. Threshold/margin/budget rules then
// select the winner(s) or abstain (zero chunks).
//
// Two jobs, both required:
//   1. Select among many (tiebreak) — relevant at >=2 candidates.
//   2. Reject a topical-but-wrong single candidate (relevance-gate) — relevant
//      even at exactly 1 candidate. So the call is NOT gated on >=2; it is only
//      skipped when there are 0 candidates.
//
// Pure module: no retrieval logic. The LLM call is injectable so unit tests run
// deterministically against stubbed rankings with no live API.
import { callOpenAIJson, type JsonSchema } from "./openai-json.ts";

export type MatchCandidate = {
  id: string;
  question: string | null;
  title: string;
  excerpt: string;
};

export type MatchResult = { id: string; relevance: number; reason: string };

export type MatchOptions = {
  model: string;
  threshold: number;
  maxSelected: number;
  marginMin: number;
};

export type MatchResponse = {
  selected: MatchResult[];
  ranked: MatchResult[];
  abstained: boolean;
};

type CallJson = typeof callOpenAIJson;

const SYSTEM_PROMPT =
  "You decide which knowledge snippet(s) actually answer the customer's " +
  "question. Match on MEANING ACROSS LANGUAGES — the customer may write Danish " +
  "or Spanish while the snippet is English. A snippet matches only if it answers " +
  "the customer's ACTUAL request, not merely the same topic. If none answers it, " +
  "return an empty list. Score each candidate 0-1 for how well it answers the " +
  "request (1 = directly answers, 0 = unrelated). " +
  "RESOLUTION-FIRST: when the customer wants to return, refund, or exchange " +
  "BECAUSE something is broken or not working, a snippet that fixes the " +
  "underlying problem answers their real need at least as well as a " +
  "return/refund-process snippet — score the fix as high as (or higher than) " +
  "the return snippet, and keep both relevant, so the fix can be offered first " +
  "with return as the fallback.";

// Advisory only for gpt-4o-mini: callOpenAIJson enforces json_schema structured
// output for gpt-5 models but falls back to json_object mode otherwise, so this
// schema documents the shape rather than guaranteeing it. matchSnippets validates
// and filters the parsed output defensively, so a non-conforming response is safe.
const RANKING_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rankings"],
  properties: {
    rankings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "relevance", "reason"],
        properties: {
          id: { type: "string" },
          relevance: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
  },
};

export function buildUserPrompt(
  customerMessage: string,
  candidates: MatchCandidate[],
): string {
  const blocks = candidates.map((c, i) => {
    const lines = [`#${i + 1} [id: ${c.id}]`];
    if (c.question) lines.push(`Question: ${c.question}`);
    lines.push(`Title: ${c.title}`);
    lines.push(`Excerpt: ${c.excerpt.slice(0, 500)}`);
    return lines.join("\n");
  });
  return (
    `Customer message:\n${customerMessage}\n\n` +
    `Candidates (Question is the strongest signal, then Title, then Excerpt):\n` +
    `${blocks.join("\n\n")}\n\n` +
    `Return JSON {"rankings":[{"id","relevance","reason"}]} with one entry per ` +
    `candidate, using the exact ids above.`
  );
}

// Selection rules (spec): only candidates at/above threshold are selectable;
// if #1 clears #2 by marginMin (or #2 is below threshold) take only #1; else
// take the above-threshold winners up to maxSelected; none above → abstain.
export function selectFromRanked(
  ranked: MatchResult[],
  opts: MatchOptions,
): { selected: MatchResult[]; abstained: boolean } {
  const eligible = ranked
    .filter((r) => r.relevance >= opts.threshold)
    .sort((a, b) => b.relevance - a.relevance);
  if (eligible.length === 0) return { selected: [], abstained: true };
  if (
    eligible.length === 1 ||
    eligible[0].relevance - eligible[1].relevance >= opts.marginMin
  ) {
    return { selected: [eligible[0]], abstained: false };
  }
  return { selected: eligible.slice(0, opts.maxSelected), abstained: false };
}

export async function matchSnippets(
  customerMessage: string,
  candidates: MatchCandidate[],
  opts: MatchOptions,
  deps: { callJson?: CallJson } = {},
): Promise<MatchResponse> {
  if (candidates.length === 0) {
    return { selected: [], ranked: [], abstained: true };
  }
  const callJson = deps.callJson ?? callOpenAIJson;
  const raw = await callJson<{ rankings: MatchResult[] }>({
    model: opts.model,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(customerMessage, candidates),
    // One entry per candidate (pool can be 15) with a reason each — 800 was
    // within truncation range of a verbose response.
    maxTokens: 2000,
    schema: RANKING_SCHEMA,
    schemaName: "snippet_rankings",
    temperature: 0,
  });
  const validIds = new Set(candidates.map((c) => c.id));
  // The model flip-flops on the id namespace: chunk ids come back as JSON
  // numbers (g-020) or as the "#N" positional numbering from the prompt
  // (e-002). Resolve exact chunk id first; otherwise a small integer that is
  // a valid 1-based position (and NOT a valid chunk id) maps to that
  // candidate. Anything else is dropped.
  const resolveId = (rawId: unknown): string | null => {
    const s = String(rawId ?? "").trim();
    if (validIds.has(s)) return s;
    const positional = /^#?(\d+)$/.exec(s);
    if (positional) {
      const idx = Number(positional[1]);
      if (Number.isInteger(idx) && idx >= 1 && idx <= candidates.length) {
        return candidates[idx - 1].id;
      }
    }
    return null;
  };
  const ranked: MatchResult[] = (raw?.rankings ?? [])
    .map((r) =>
      r && typeof r.relevance === "number"
        ? { resolved: resolveId(r.id), r }
        : { resolved: null, r }
    )
    .filter((x): x is { resolved: string; r: MatchResult } =>
      x.resolved !== null
    )
    .map(({ resolved, r }) => ({
      id: resolved,
      relevance: Math.max(0, Math.min(1, r.relevance)),
      reason: String(r.reason ?? ""),
    }))
    .sort((a, b) => b.relevance - a.relevance);
  const { selected, abstained } = selectFromRanked(ranked, opts);
  return { selected, ranked, abstained };
}
