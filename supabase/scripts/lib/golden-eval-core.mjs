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

export function runGates(draft, actions, testCase) {
  if (testCase.tier !== "edge") return { passed: true, failures: [] };
  const failures = [];
  const hay = String(draft || "").toLowerCase();

  for (const needle of testCase.must_contain || []) {
    if (!hay.includes(String(needle).toLowerCase())) {
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
