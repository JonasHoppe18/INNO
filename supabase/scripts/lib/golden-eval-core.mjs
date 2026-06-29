// supabase/scripts/lib/golden-eval-core.mjs
export const ACEZONE_SHOP_ID = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";

export function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : null;
  };
  // Fail loudly on unknown flags so a typo (or an unsupported flag like an old
  // --set) can never silently fall through to running the full golden set.
  // Value tokens (which never start with "--") are skipped.
  const KNOWN_FLAGS = new Set([
    "--shop", "--set", "--tier", "--limit", "--intent",
    "--abs-floor", "--pq-budget", "--accept",
    "--issue-tiebreak", "--source-consolidate",
  ]);
  for (const tok of argv) {
    if (typeof tok === "string" && tok.startsWith("--") && !KNOWN_FLAGS.has(tok)) {
      throw new Error(
        `Unknown argument: ${tok}. Known flags: ${[...KNOWN_FLAGS].join(", ")}`,
      );
    }
  }
  const tier = val("--tier");
  if (tier !== null && tier !== "historical" && tier !== "edge") {
    throw new Error('tier must be "historical" or "edge"');
  }
  const limitRaw = val("--limit");
  const intentRaw = val("--intent");
  const absFloorRaw = val("--abs-floor");
  const pqBudgetRaw = val("--pq-budget");
  return {
    shop: val("--shop") || ACEZONE_SHOP_ID,
    // Path to a curated subset file. null = use the default full golden set.
    set: val("--set"),
    tier,
    limit: limitRaw !== null ? parseInt(limitRaw, 10) : null,
    // Comma-separated list of intents to keep (e.g. "complaint,product_question").
    // null = no intent filter.
    intent: intentRaw !== null
      ? intentRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : null,
    accept: has("--accept"),
    retrievalAbsFloor: absFloorRaw !== null ? parseFloat(absFloorRaw) : null,
    retrievalPqBudget: pqBudgetRaw !== null ? parseInt(pqBudgetRaw, 10) : null,
    retrievalIssueTiebreak: has("--issue-tiebreak"),
    retrievalSourceConsolidate: has("--source-consolidate"),
  };
}

// Resolve which case-set file to load. When --set is given it MUST exist — never
// silently fall back to the full golden set (that is the cost bug this guards).
export function resolveSetPath(opts, { defaultPath, existsSync }) {
  if (!opts || !opts.set) return defaultPath;
  if (!existsSync(opts.set)) {
    throw new Error(`--set file not found: ${opts.set}`);
  }
  return opts.set;
}

export function validateCase(c) {
  if (!c || typeof c !== "object") throw new Error("case must be an object");
  for (const f of ["id", "body", "human_reply"]) {
    if (!String(c[f] || "").trim()) throw new Error(`case ${c?.id || "?"}: missing ${f}`);
  }
  if (c.tier !== "historical" && c.tier !== "edge") {
    throw new Error(`case ${c.id}: tier must be "historical" or "edge"`);
  }
  if (c.tier === "historical" && !String(c.source_thread_id || "").trim()) {
    throw new Error(`case ${c.id}: historical case requires source_thread_id`);
  }
  if (c.tier === "edge" && c.source_thread_id != null) {
    throw new Error(`case ${c.id}: edge case must have null source_thread_id`);
  }
  return c;
}

export function loadGoldenSet(set, { tier = null, limit = null, intent = null } = {}) {
  if (!set || !Array.isArray(set.cases)) throw new Error("golden set must have a cases array");
  let cases = set.cases.map(validateCase);
  if (tier) cases = cases.filter((c) => c.tier === tier);
  if (intent && intent.length) {
    const wanted = new Set(intent.map((s) => String(s).toLowerCase()));
    cases = cases.filter((c) => wanted.has(String(c.intent || "").toLowerCase()));
  }
  if (limit) cases = cases.slice(0, limit);
  return cases;
}

export function extractActionTypes(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((a) => a?.type || a?.action_type || a?.kind || a?.name || null)
    .filter(Boolean);
}

const MUST_CONTAIN_SYNONYMS = {
  photo: [
    "photo",
    "photos",
    "picture",
    "pictures",
    "image",
    "images",
    "video",
    "videos",
    "short video",
    "video showing",
  ],
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsMustContainNeedle(hay, needle) {
  const normalizedNeedle = String(needle).toLowerCase();
  const synonyms = MUST_CONTAIN_SYNONYMS[normalizedNeedle];
  if (!synonyms) return hay.includes(normalizedNeedle);
  return synonyms.some((synonym) => {
    const pattern = new RegExp(`\\b${escapeRegExp(synonym)}\\b`, "i");
    return pattern.test(hay);
  });
}

export function runGates(draft, actions, testCase) {
  if (testCase.tier !== "edge") return { passed: true, failures: [] };
  const failures = [];
  const hay = String(draft || "").toLowerCase();

  for (const needle of testCase.must_contain || []) {
    if (!containsMustContainNeedle(hay, needle)) {
      failures.push(`must_contain missing: "${needle}"`);
    }
  }
  for (const needle of testCase.must_not_contain || []) {
    if (hay.includes(String(needle).toLowerCase())) {
      failures.push(`must_not_contain present: "${needle}"`);
    }
  }
  if (testCase.expected_action != null) {
    const types = extractActionTypes(actions);
    if (testCase.expected_action === "none") {
      if (types.length > 0) failures.push(`expected no action, got: [${types.join(", ")}]`);
    } else if (!types.includes(testCase.expected_action)) {
      failures.push(`expected_action "${testCase.expected_action}" not in [${types.join(", ")}]`);
    }
  }
  return { passed: failures.length === 0, failures };
}

const DIMS = ["correctness", "completeness", "tone", "actionability", "overall_10"];

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function computeAggregate(results) {
  const allScored = results.filter((r) => r.status === "scored");
  // Non-comparable action anchors (human reply IS a completed action confirmation)
  // are reported separately and kept OUT of the headline averages — judging a
  // draft directly against an action confirmation deflates and distorts scores.
  const isNonComparable = (r) => r.anchor_class === "non_comparable_anchor";
  // live_fact_dependent cases (human reply used live order/shipping/refund data
  // the AI cannot resolve in eval) are likewise kept out of the headline and
  // reported separately. A case already excluded as non_comparable is not
  // double-counted in the live-fact bucket.
  const isLiveFact = (r) => r.live_fact_dependent === true && !isNonComparable(r);
  const excludedResults = allScored.filter(isNonComparable);
  const liveFactResults = allScored.filter(isLiveFact);
  const scored = allScored.filter((r) => !isNonComparable(r) && !isLiveFact(r));
  const aggregate = {};
  for (const dim of DIMS) {
    aggregate[dim] = scored.length
      ? round2(scored.reduce((s, r) => s + (r.scores[dim] || 0), 0) / scored.length)
      : 0;
  }
  aggregate.send_ready_rate = scored.length
    ? round2(scored.filter((r) => r.scores.send_ready).length / scored.length)
    : 0;

  const per_intent = {};
  const byIntent = {};
  for (const r of scored) {
    const k = r.intent || "unknown";
    (byIntent[k] = byIntent[k] || []).push(r.scores.overall_10 || 0);
  }
  for (const [k, arr] of Object.entries(byIntent)) {
    per_intent[k] = round2(arr.reduce((s, v) => s + v, 0) / arr.length);
  }

  const per_case = {};
  for (const r of scored) per_case[r.id] = r.scores.overall_10;

  const withCoh = scored.filter(
    (r) => r.coherence && typeof r.coherence.n_chunks === "number",
  );
  const coherence = {
    n: withCoh.length,
    grab_bag_rate: withCoh.length
      ? round2(withCoh.filter((r) => r.coherence.is_grab_bag).length / withCoh.length)
      : 0,
    avg_distinct_sources: withCoh.length
      ? round2(withCoh.reduce((s, r) => s + r.coherence.distinct_sources, 0) / withCoh.length)
      : 0,
    avg_distinct_products: withCoh.length
      ? round2(withCoh.reduce((s, r) => s + r.coherence.distinct_products, 0) / withCoh.length)
      : 0,
    avg_top_source_share: withCoh.length
      ? round2(withCoh.reduce((s, r) => s + r.coherence.top_source_share, 0) / withCoh.length)
      : 0,
    per_case: {},
  };
  for (const r of withCoh) {
    coherence.per_case[r.id] = {
      is_grab_bag: r.coherence.is_grab_bag,
      distinct_sources: r.coherence.distinct_sources,
      distinct_products: r.coherence.distinct_products,
    };
  }

  const excluded = {
    n: excludedResults.length,
    avg_overall_10: excludedResults.length
      ? round2(
        excludedResults.reduce((s, r) => s + (r.scores.overall_10 || 0), 0) /
          excludedResults.length,
      )
      : 0,
    per_case: Object.fromEntries(
      excludedResults.map((r) => [r.id, r.scores.overall_10]),
    ),
  };

  const excludedLiveFact = {
    n: liveFactResults.length,
    avg_overall_10: liveFactResults.length
      ? round2(
        liveFactResults.reduce((s, r) => s + (r.scores.overall_10 || 0), 0) /
          liveFactResults.length,
      )
      : 0,
    ids: liveFactResults.map((r) => r.id),
    per_case: Object.fromEntries(
      liveFactResults.map((r) => [r.id, r.scores.overall_10]),
    ),
    reason:
      "live data the human reply used is unresolvable in eval (redacted identifier); assess these on live-fact grounding, not similarity to the old human reply",
  };

  return {
    n_cases: scored.length,
    n_excluded: excludedResults.length,
    aggregate,
    per_intent,
    per_case,
    coherence,
    excluded,
    excluded_live_fact_dependent: excludedLiveFact,
  };
}

export function computeCoherence(chunks) {
  const arr = Array.isArray(chunks) ? chunks : [];
  const n_chunks = arr.length;
  if (n_chunks === 0) {
    return {
      n_chunks: 0, distinct_sources: 0, distinct_products: 0,
      top_source_share: 1, is_grab_bag: false,
    };
  }
  // Group identity: prefer source_id, fall back to title (multi-chunk guides
  // share both). Empty identity is ignored so it never inflates the count.
  const identity = (c) => String(c?.source_id ?? c?.title ?? "").trim().toLowerCase();
  const counts = new Map();
  for (const c of arr) {
    const id = identity(c);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const distinct_sources = counts.size;
  const maxCount = counts.size ? Math.max(...counts.values()) : 0;
  const top_source_share = round2(maxCount / n_chunks);

  const productSet = new Set();
  for (const c of arr) {
    const prods = Array.isArray(c?.products) ? c.products : [];
    for (const p of prods) {
      const name = String(p || "").trim().toLowerCase();
      if (name) productSet.add(name);
    }
  }
  const distinct_products = productSet.size;
  const is_grab_bag = distinct_sources >= 3 || distinct_products >= 2;

  return { n_chunks, distinct_sources, distinct_products, top_source_share, is_grab_bag };
}

export function diffBaseline(current, baseline) {
  if (!baseline || !baseline.aggregate) {
    return { aggregateDeltas: null, regressedCases: [] };
  }
  const aggregateDeltas = {};
  for (const dim of [...DIMS, "send_ready_rate"]) {
    if (typeof baseline.aggregate[dim] === "number") {
      aggregateDeltas[dim] = round2((current.aggregate[dim] || 0) - baseline.aggregate[dim]);
    }
  }
  const regressedCases = [];
  for (const [id, score] of Object.entries(current.per_case)) {
    const base = baseline.per_case?.[id];
    if (typeof base === "number" && score < base) {
      regressedCases.push({ id, from: base, to: score });
    }
  }
  return { aggregateDeltas, regressedCases };
}

// ---- Retrieval metrics (matcher precision, separate from answer quality) ----
// Identity convention: source_id when present, else title; lowercased+trimmed.
// Matches computeCoherence's grouping so gold-labels and live chunks line up.
function retrievalIdentity(entry) {
  return String(entry?.source_id ?? entry?.title ?? "").trim().toLowerCase();
}

// gold: array of correct snippet identities ([] means "no snippet should match").
// matcher: { candidates[], ranked[], selected_ids[], abstained } from retrieval_debug.
// Returns per-case metrics; fields are null when not applicable so the
// aggregate can average only over the cases each metric makes sense for.
export function computeRetrievalMetrics(gold, matcher) {
  const goldSet = new Set((gold || []).map((g) => String(g).trim().toLowerCase()));
  const goldEmpty = goldSet.size === 0;
  const m = matcher || {};
  const candidates = Array.isArray(m.candidates) ? m.candidates : [];
  const ranked = Array.isArray(m.ranked) ? m.ranked : [];
  const selected = Array.isArray(m.selected_ids) ? m.selected_ids : [];

  if (goldEmpty) {
    // Abstention case: correct iff we selected nothing.
    return {
      gold_empty: true,
      recall_at_k: null,
      precision_at_1: null,
      mrr: null,
      abstention_correct: selected.length === 0 ? 1 : 0,
    };
  }

  const recall = candidates.some((c) => goldSet.has(retrievalIdentity(c))) ? 1 : 0;

  let mrr = 0;
  for (let i = 0; i < ranked.length; i++) {
    if (goldSet.has(retrievalIdentity(ranked[i]))) {
      mrr = 1 / (i + 1);
      break;
    }
  }
  const precisionAt1 = ranked.length > 0 && goldSet.has(retrievalIdentity(ranked[0])) ? 1 : 0;

  return {
    gold_empty: false,
    recall_at_k: recall,
    precision_at_1: precisionAt1,
    mrr: round2(mrr),
    abstention_correct: null,
  };
}

export function aggregateRetrievalMetrics(perCase) {
  const arr = Array.isArray(perCase) ? perCase : [];
  const avg = (key) => {
    const vals = arr.map((p) => p?.[key]).filter((v) => typeof v === "number");
    return vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  };
  return {
    n_labeled: arr.length,
    n_abstain_cases: arr.filter((p) => p?.gold_empty).length,
    recall_at_k: avg("recall_at_k"),
    precision_at_1: avg("precision_at_1"),
    mrr: avg("mrr"),
    abstention_correct: avg("abstention_correct"),
  };
}

export function buildGoldenEvalResult({
  testCase,
  gen,
  judged,
  gate,
  coherence,
  retrieval,
  candidateDiagnostics,
  retrievalFunnel,
  anchorClass,
  liveFactDependent,
}) {
  const routingHint = gen?.routingHint ?? gen?.routing_hint ?? null;
  const blockSendRecommended =
    gen?.blockSendRecommended ?? gen?.block_send_recommended ?? null;
  return {
    id: testCase.id,
    intent: testCase.intent || null,
    tier: testCase.tier,
    status: "scored",
    anchor_class: anchorClass,
    live_fact_dependent: liveFactDependent,
    scores: {
      correctness: judged.correctness,
      completeness: judged.completeness,
      tone: judged.tone,
      actionability: judged.actionability,
      overall_10: judged.overall_10,
      send_ready: judged.send_ready,
    },
    gate,
    coherence,
    retrieval,
    retrievalDebug: gen.retrievalDebug || [],
    candidate_diagnostics: candidateDiagnostics,
    retrieval_funnel: retrievalFunnel,
    routing_hint: routingHint,
    block_send_recommended: blockSendRecommended,
    safety: gen?.safety ?? null,
    draft: gen.draft,
    actions: gen.actions,
    latencyMs: gen.latencyMs,
  };
}

// ---- Retrieval funnel diagnostics summarization (eval-only observability) ----
// `candidate_diagnostics` is emitted by generate-draft-v2 (gated on eval_payload)
// and captured by eval-runner. It exposes the full retrieval funnel so a run with
// n_chunks=0 can be attributed to the exact stage where candidates vanish.
// This summarizer is PURE: no IO, no network, fully deterministic.

// Default title substrings that identify AceZone "General" knowledge-document
// chunks. candidate_diagnostics does not carry source_provider/category per
// candidate, so General-doc presence is detected heuristically by section-heading
// title. Override via opts.trackTitlePatterns (or opts.trackChunkIds) when needed.
export const GENERAL_DOC_TITLE_PATTERNS = [
  "general knowledge",
  "missing accessories",
  "spare parts",
  "office visits",
  "warranty claims",
  "proof of purchase",
  "defects, failures",
  "complaints and customer tone",
  "technical issues",
];

function uniqueIds(list) {
  const out = [];
  const seen = new Set();
  for (const v of list || []) {
    const id = String(v ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// Funnel stage order, matching how candidate_diagnostics is produced:
// raw retrieval -> scored -> post-dedupe -> matcher pool (top15) -> final.
const FUNNEL_STAGE_ORDER = ["raw", "scored", "post_dedupe", "pool", "final"];

export function summarizeCandidateDiagnostics(cd, opts = {}) {
  if (!cd || typeof cd !== "object") {
    return { available: false };
  }
  const queryResults = Array.isArray(cd.query_results) ? cd.query_results : [];
  const merged = Array.isArray(cd.merged_candidates_pre_score)
    ? cd.merged_candidates_pre_score
    : [];
  const scored = Array.isArray(cd.scored_candidates_pre_dedupe)
    ? cd.scored_candidates_pre_dedupe
    : [];
  const postDedupe = Array.isArray(cd.candidates_post_dedupe)
    ? cd.candidates_post_dedupe
    : [];
  const pool = Array.isArray(cd.matcher_pool_top15) ? cd.matcher_pool_top15 : [];
  const finalSel = Array.isArray(cd.final_selected_ids) ? cd.final_selected_ids : [];

  // chunk_id -> best metadata. Raw query results are the only stage carrying
  // titles/source_type/usable_as, so we key off them (keeping the best raw_score).
  const metaById = new Map();
  for (const r of queryResults) {
    const id = String(r?.chunk_id ?? "").trim();
    if (!id) continue;
    const score = typeof r?.raw_score === "number" ? r.raw_score : null;
    const prev = metaById.get(id);
    if (!prev || (score !== null && (prev.score === null || score > prev.score))) {
      metaById.set(id, {
        chunk_id: id,
        title: r?.title ?? null,
        source_type: r?.source_type ?? null,
        usable_as: r?.usable_as ?? null,
        score,
      });
    }
  }

  const rawIds = uniqueIds([
    ...queryResults.map((r) => r?.chunk_id),
    ...merged.map((r) => r?.chunk_id),
  ]);
  const scoredIds = uniqueIds(scored.map((r) => r?.chunk_id));
  const postDedupeIds = uniqueIds(postDedupe);
  const poolIds = uniqueIds(pool);
  const finalIds = uniqueIds(finalSel);

  const topN = Number.isInteger(opts.topN) ? opts.topN : 5;
  const top_candidates = [...metaById.values()]
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
    .slice(0, topN);

  // Trace tracked chunks (default: General doc) through the funnel so we can tell
  // whether they were present in the pool and where they disappeared.
  const titlePatterns = (opts.trackTitlePatterns ?? GENERAL_DOC_TITLE_PATTERNS)
    .map((p) => String(p).toLowerCase());
  const trackChunkIds = new Set(
    (opts.trackChunkIds ?? []).map((x) => String(x).trim()).filter(Boolean),
  );
  const matchesTracked = (id) => {
    if (trackChunkIds.has(id)) return true;
    const title = String(metaById.get(id)?.title ?? "").toLowerCase();
    return title ? titlePatterns.some((p) => title.includes(p)) : false;
  };

  const stageSets = {
    raw: new Set(rawIds),
    scored: new Set(scoredIds),
    post_dedupe: new Set(postDedupeIds),
    pool: new Set(poolIds),
    final: new Set(finalIds),
  };
  const trackedIds = uniqueIds([
    ...rawIds.filter(matchesTracked),
    ...trackChunkIds,
  ]);
  const tracked = trackedIds.map((id) => {
    const presence = {};
    for (const name of FUNNEL_STAGE_ORDER) presence[name] = stageSets[name].has(id);
    // The last funnel stage where it was still present (null if never seen).
    let lastPresent = null;
    for (const name of FUNNEL_STAGE_ORDER) {
      if (presence[name]) lastPresent = name;
    }
    return {
      key: id,
      title: metaById.get(id)?.title ?? null,
      ...presence,
      ever_seen: lastPresent !== null,
      // Stage after which the chunk dropped out (null when it reached final or
      // was never seen at all).
      dropped_after: presence.final || lastPresent === null ? null : lastPresent,
    };
  });

  const matcherAbstain = typeof cd.matcher_abstain === "boolean"
    ? cd.matcher_abstain
    : (cd.matcher_abstain ?? null);
  const fellBack = opts.matcher && typeof opts.matcher.fell_back === "boolean"
    ? opts.matcher.fell_back
    : null;
  // Fix B: conservative policy/procedure passthrough that rescued already-pooled
  // chunks after the matcher abstained. Lives on matcher_debug (opts.matcher).
  const policyFallback =
    opts.matcher && typeof opts.matcher.policy_fallback === "boolean"
      ? opts.matcher.policy_fallback
      : null;
  const policyFallbackCount =
    opts.matcher && typeof opts.matcher.policy_fallback_count === "number"
      ? opts.matcher.policy_fallback_count
      : null;
  const policyFallbackScoreBasis =
    opts.matcher && typeof opts.matcher.policy_fallback_score_basis === "string"
      ? opts.matcher.policy_fallback_score_basis
      : null;

  return {
    available: true,
    raw_query_results: queryResults.length,
    distinct_raw_candidates: rawIds.length,
    scored: scoredIds.length,
    post_dedupe: postDedupeIds.length,
    pool: poolIds.length,
    final: finalIds.length,
    matcher_abstain: matcherAbstain,
    fell_back: fellBack,
    policy_fallback: policyFallback,
    policy_fallback_count: policyFallbackCount,
    policy_fallback_score_basis: policyFallbackScoreBasis,
    top_candidates,
    tracked,
  };
}

// Render the summary as compact human-readable lines for the run log. Pure.
export function formatCandidateDiagnosticsSummary(summary, { indent = "    " } = {}) {
  if (!summary || !summary.available) {
    return `${indent}retrieval funnel: (no candidate_diagnostics in response)`;
  }
  const lines = [];
  lines.push(
    `${indent}retrieval funnel: raw=${summary.distinct_raw_candidates} ` +
      `scored=${summary.scored} post_dedupe=${summary.post_dedupe} ` +
      `pool=${summary.pool} final=${summary.final} ` +
      `(query_results=${summary.raw_query_results})`,
  );
  lines.push(
    `${indent}matcher: abstain=${summary.matcher_abstain} fell_back=${summary.fell_back}` +
      ` policy_fallback=${summary.policy_fallback}` +
      (summary.policy_fallback_count ? `(${summary.policy_fallback_count})` : "") +
      (summary.policy_fallback_score_basis
        ? ` basis=${summary.policy_fallback_score_basis}`
        : ""),
  );
  if (summary.top_candidates.length) {
    lines.push(`${indent}top candidates:`);
    for (const c of summary.top_candidates) {
      const score = typeof c.score === "number" ? c.score.toFixed(3) : "n/a";
      lines.push(
        `${indent}  - [${score}] ${c.source_type ?? "?"}/${c.usable_as ?? "?"} ` +
          `${c.title ?? "(untitled)"}`,
      );
    }
  }
  if (summary.tracked.length) {
    for (const t of summary.tracked) {
      const path = FUNNEL_STAGE_ORDER.map((s) => (t[s] ? s : `~${s}`)).join(">");
      const verdict = t.final
        ? "reached writer"
        : t.ever_seen
          ? `dropped after ${t.dropped_after}`
          : "never retrieved";
      lines.push(
        `${indent}tracked ${t.title ?? t.key}: ${path}  => ${verdict}`,
      );
    }
  } else {
    lines.push(
      `${indent}tracked: no General-doc chunks matched in candidate pool`,
    );
  }
  return lines.join("\n");
}
