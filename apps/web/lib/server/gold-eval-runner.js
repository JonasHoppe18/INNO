// DB-backed gold-eval runner.
//
// Runs a fixed, hand-curated set of gold_eval_cases through generate-draft-v2 in
// EVAL MODE (email_data => eval_payload), which by construction writes NO customer
// tables. For each case it records a stage-by-stage gold_eval_results row and rolls
// the batch up into a compact summary on the gold_eval_runs row.
//
// Grading is DETERMINISTIC only (no LLM judge here):
//   - intent_correct: normalized expected_intent === normalized actual_intent,
//     but only when expected_intent is representable by the runtime planner
//   - retrieval_hit_at_k: gold_knowledge_chunk_ids vs the retrieved chunk ids
// Everything that needs human/LLM judgement (facts/resolution/action correctness,
// completeness/tone/send-ready scores) is left null so manual assessment stays
// cleanly separable from automatic signals.
//
// Dependencies are injected (serviceClient + generate) so this module is unit
// testable against mocks without any network/OpenAI access.

const CASES_TABLE = "gold_eval_cases";
const RUNS_TABLE = "gold_eval_runs";
const RESULTS_TABLE = "gold_eval_results";

const DEFAULT_KS = [1, 3, 5, 10];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function persistableGenerationId(value) {
  const id = String(value ?? "").trim();
  return UUID_RE.test(id) ? id : null;
}

// The planner's actual output vocabulary. Keep business/analytics categories out
// of this list: a gold label such as `technical_support` or `order_status` is not
// deterministically comparable when the runtime cannot emit that label. Request
// suffixes are handled below by normalizeIntent solely as naming aliases.
export const RUNTIME_INTENT_TAXONOMY = Object.freeze([
  "tracking",
  "return",
  "refund",
  "exchange",
  "cancel",
  "address_change",
  "product_question",
  "complaint",
  "thanks",
  "update",
  "other",
]);

const NORMALIZED_RUNTIME_INTENTS = new Set(RUNTIME_INTENT_TAXONOMY.map((intent) => normalizeIntent(intent)));

function normalizeLabel(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function normalizeIntent(value) {
  const normalized = normalizeLabel(value);
  const aliases = {
    return: "return_request",
    return_request: "return_request",
    refund: "refund_request",
    refund_request: "refund_request",
    exchange: "exchange_request",
    exchange_request: "exchange_request",
  };
  return aliases[normalized] || normalized;
}

// Deterministic intent check. Returns null when the case has no expected_intent
// (i.e. intent is not being graded for this case).
export function compareIntent(expectedIntent, actualIntent) {
  const expected = normalizeIntent(expectedIntent);
  if (!expected) return { intentCorrect: null, actualIntent: actualIntent ?? null };
  const actualIntentRaw = actualIntent ?? null;
  const actualIntentNormalized = normalizeIntent(actualIntent);
  return {
    intentCorrect: expected === actualIntentNormalized,
    actualIntent: actualIntentNormalized || actualIntentRaw,
    actualIntentRaw,
    actualIntentNormalized,
  };
}

// Runner-specific grading guard. compareIntent intentionally remains a generic
// exact-match helper; this wrapper prevents gold labels outside the planner's
// output vocabulary from becoming deterministic failures by construction.
export function gradeRuntimeIntent(expectedIntent, actualIntent) {
  const expectedIntentRaw = expectedIntent ?? null;
  const expectedIntentNormalized = normalizeIntent(expectedIntent);
  const actualIntentRaw = actualIntent ?? null;
  const actualIntentNormalized = normalizeIntent(actualIntent);
  const actualIntentValue = actualIntentNormalized || actualIntentRaw;

  if (!expectedIntentNormalized) {
    return {
      intentCorrect: null,
      actualIntent: actualIntentValue,
      actualIntentRaw,
      actualIntentNormalized,
      expectedIntentRaw,
      expectedIntentNormalized,
      intentGradeable: false,
      intentGradeSkipReason: "missing_expected_intent",
    };
  }

  if (!NORMALIZED_RUNTIME_INTENTS.has(expectedIntentNormalized)) {
    return {
      intentCorrect: null,
      actualIntent: actualIntentValue,
      actualIntentRaw,
      actualIntentNormalized,
      expectedIntentRaw,
      expectedIntentNormalized,
      intentGradeable: false,
      intentGradeSkipReason: "expected_intent_outside_runtime_taxonomy",
    };
  }

  const comparison = compareIntent(expectedIntent, actualIntent);
  return {
    ...comparison,
    expectedIntentRaw,
    expectedIntentNormalized,
    intentGradeable: true,
    intentGradeSkipReason: null,
  };
}

// Pull a flat list of chunk identifiers out of whatever shape gold_knowledge_chunk_ids
// or the retrieved chunks arrive in (array of strings, or array of objects with id).
function toIdList(value, idKeys = ["id", "chunk_id", "source_id"]) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (item == null) continue;
    if (typeof item === "string" || typeof item === "number") {
      out.push(String(item));
      continue;
    }
    if (typeof item === "object") {
      for (const key of idKeys) {
        if (item[key] != null) {
          out.push(String(item[key]));
          break;
        }
      }
    }
  }
  return out;
}

export function activeGoldChunkIdsFromRows(goldChunkIds, rows) {
  const configured = toIdList(goldChunkIds);
  const activeIds = new Set(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => {
        const metadata = row?.metadata && typeof row.metadata === "object"
          ? row.metadata
          : {};
        return metadata.active_for_ai !== false && metadata.archived !== true;
      })
      .map((row) => String(row.id)),
  );
  return configured.filter((id) => activeIds.has(id));
}

async function loadActiveGoldChunkIds(serviceClient, goldChunkIds) {
  const configured = toIdList(goldChunkIds);
  if (!configured.length) return [];
  const { data, error } = await serviceClient
    .from("agent_knowledge")
    .select("id, metadata")
    .in("id", configured);
  if (error) {
    throw new Error(`gold-eval: failed to validate gold chunks: ${error.message}`);
  }
  return activeGoldChunkIdsFromRows(configured, data);
}

// Deterministic retrieval hit@k. retrievedChunkIds must be in retrieval rank order
// (best first). Returns null when the case carries no gold chunk ids (not graded).
export function computeRetrievalHitAtK(goldChunkIds, retrievedChunks, ks = DEFAULT_KS) {
  const gold = toIdList(goldChunkIds);
  if (gold.length === 0) {
    return { hitAtK: null, retrievedChunkIds: toIdList(retrievedChunks) };
  }
  const retrieved = toIdList(retrievedChunks);
  const goldSet = new Set(gold);

  let firstHitRank = null;
  for (let i = 0; i < retrieved.length; i++) {
    if (goldSet.has(retrieved[i])) {
      firstHitRank = i + 1;
      break;
    }
  }

  const hitAtK = {
    gold_count: gold.length,
    retrieved_count: retrieved.length,
    first_hit_rank: firstHitRank,
  };
  for (const k of ks) {
    const topK = retrieved.slice(0, k);
    const found = topK.filter((id) => goldSet.has(id));
    hitAtK[`hit_at_${k}`] = found.length > 0;
    hitAtK[`recall_at_${k}`] = gold.length > 0 ? found.length / gold.length : 0;
  }
  return { hitAtK, retrievedChunkIds: retrieved };
}

// Load active gold cases scoped to a shop (and optionally a workspace).
async function loadActiveGoldCases(serviceClient, { shopId, workspaceId = null, limit = null }) {
  let query = serviceClient
    .from(CASES_TABLE)
    .select("*")
    .eq("shop_id", shopId)
    .eq("is_active", true);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  query = query.order("created_at", { ascending: true });
  if (limit != null) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw new Error(`gold-eval: failed to load cases: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

// Best-effort enrichment from the instrumented pipeline trace. In eval mode the
// deployed pipeline does not persist draft_generations, so this is allowed to find
// nothing — token/stage fields then stay null. Forward-compatible with instrumentation.
async function loadGenerationTrace(serviceClient, generationId) {
  if (!generationId) return null;
  try {
    const { data, error } = await serviceClient
      .from("draft_generations")
      .select(
        "id, total_input_tokens, total_output_tokens, total_latency_ms, facts_json, resolution_plan_json, action_decision_json, verifier_output_json",
      )
      .eq("id", generationId)
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

// Run a single gold case and return the result row (not yet persisted).
async function runSingleCase({ serviceClient, runId, goldCase, generate }) {
  const conversationHistory = goldCase.thread_history_json ?? undefined;
  let gen;
  let activeGoldChunkIds;
  try {
    activeGoldChunkIds = await loadActiveGoldChunkIds(
      serviceClient,
      goldCase.gold_knowledge_chunk_ids,
    );
    gen = await generate(goldCase.shop_id, goldCase.title || "", goldCase.customer_message, {
      conversationHistory,
    });
  } catch (err) {
    return {
      eval_case_id: goldCase.id,
      eval_run_id: runId,
      error_message: String(err?.message || err).slice(0, 500),
    };
  }

  const {
    intentCorrect,
    actualIntent,
    actualIntentRaw,
    actualIntentNormalized,
    expectedIntentRaw,
    expectedIntentNormalized,
    intentGradeable,
    intentGradeSkipReason,
  } = gradeRuntimeIntent(goldCase.expected_intent, gen.intent);
  const { hitAtK, retrievedChunkIds } = computeRetrievalHitAtK(
    activeGoldChunkIds,
    gen.retrievalDebug,
  );
  const configuredGoldChunkIds = toIdList(goldCase.gold_knowledge_chunk_ids);
  const retrievalGradeable = activeGoldChunkIds.length > 0;
  const retrievalGradeSkipReason = retrievalGradeable
    ? null
    : configuredGoldChunkIds.length > 0
      ? "all_expected_chunks_inactive_or_missing"
      : "missing_expected_chunks";

  // Eval-mode intentionally returns a synthetic `dry-run:<uuid>` identifier so
  // it cannot be confused with a persisted customer generation. The DB column
  // is a UUID FK, therefore only real persisted UUIDs may be written there.
  const generationId = persistableGenerationId(gen.generationId);
  const trace = await loadGenerationTrace(serviceClient, generationId);

  return {
    eval_case_id: goldCase.id,
    eval_run_id: runId,
    generation_id: generationId,
    actual_intent: actualIntent,
    actual_intent_raw: actualIntentRaw,
    actual_intent_normalized: actualIntentNormalized,
    intent_correct: intentCorrect,
    // Eval-run metadata returned to callers and aggregated into summary_json.
    // These fields are deliberately stripped before inserting gold_eval_results,
    // whose fixed schema has no gradeability columns.
    intent_gradeable: intentGradeable,
    intent_grade_skip_reason: intentGradeSkipReason,
    expected_intent_raw: expectedIntentRaw,
    expected_intent_normalized: expectedIntentNormalized,
    retrieval_gradeable: retrievalGradeable,
    retrieval_grade_skip_reason: retrievalGradeSkipReason,
    retrieved_chunk_ids: retrievedChunkIds,
    retrieval_hit_at_k: hitAtK,
    facts_json: trace?.facts_json ?? null,
    facts_correct: null,
    actual_resolution: null,
    resolution_correct: null,
    actual_action_json: Array.isArray(gen.actions) ? gen.actions : null,
    action_correct: null,
    final_draft_text: gen.draft || null,
    answer_completeness_score: null,
    tone_score: null,
    send_ready_score: null,
    verifier_confidence: typeof gen.confidence === "number" ? gen.confidence : null,
    total_latency_ms:
      typeof trace?.total_latency_ms === "number"
        ? trace.total_latency_ms
        : typeof gen.latencyMs === "number"
          ? gen.latencyMs
          : null,
    input_tokens: typeof trace?.total_input_tokens === "number" ? trace.total_input_tokens : null,
    output_tokens: typeof trace?.total_output_tokens === "number" ? trace.total_output_tokens : null,
    error_message: null,
  };
}

function summarize(results) {
  const total = results.length;
  const failedCases = [];
  let intentGraded = 0;
  let intentCorrect = 0;
  const intentSkippedCases = [];
  let retrievalGraded = 0;
  let hitAt5 = 0;
  let missingExpectedChunks = 0;
  const retrievalSkippedCases = [];
  let confidenceSum = 0;
  let confidenceCount = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let inputTokenSum = 0;
  let inputTokenCount = 0;
  let outputTokenSum = 0;
  let outputTokenCount = 0;

  for (const r of results) {
    if (r.error_message) {
      failedCases.push({ eval_case_id: r.eval_case_id, reason: r.error_message });
      continue;
    }
    if (r.intent_correct !== null && r.intent_correct !== undefined) {
      intentGraded += 1;
      if (r.intent_correct) intentCorrect += 1;
      else failedCases.push({ eval_case_id: r.eval_case_id, reason: "intent_mismatch" });
    } else if (r.intent_gradeable === false) {
      intentSkippedCases.push({
        eval_case_id: r.eval_case_id,
        reason: r.intent_grade_skip_reason,
        expected_intent_raw: r.expected_intent_raw,
        expected_intent_normalized: r.expected_intent_normalized,
      });
    }
    const hk = r.retrieval_hit_at_k;
    if (hk && typeof hk === "object" && "hit_at_5" in hk) {
      retrievalGraded += 1;
      if (hk.hit_at_5) hitAt5 += 1;
      if (!hk.hit_at_5) missingExpectedChunks += 1;
    } else if (r.retrieval_gradeable === false) {
      retrievalSkippedCases.push({
        eval_case_id: r.eval_case_id,
        reason: r.retrieval_grade_skip_reason,
      });
    }
    if (typeof r.verifier_confidence === "number") {
      confidenceSum += r.verifier_confidence;
      confidenceCount += 1;
    }
    if (typeof r.total_latency_ms === "number") {
      latencySum += r.total_latency_ms;
      latencyCount += 1;
    }
    if (typeof r.input_tokens === "number") {
      inputTokenSum += r.input_tokens;
      inputTokenCount += 1;
    }
    if (typeof r.output_tokens === "number") {
      outputTokenSum += r.output_tokens;
      outputTokenCount += 1;
    }
  }

  const avg = (sum, count) => (count > 0 ? sum / count : null);
  return {
    total_cases: total,
    failed_count: failedCases.length,
    intent_accuracy: intentGraded > 0 ? intentCorrect / intentGraded : null,
    intent_graded: intentGraded,
    intent_ungraded: intentSkippedCases.length,
    intent_skipped_cases: intentSkippedCases,
    retrieval_hit_at_5: retrievalGraded > 0 ? hitAt5 / retrievalGraded : null,
    retrieval_graded: retrievalGraded,
    retrieval_ungraded: retrievalSkippedCases.length,
    retrieval_skipped_cases: retrievalSkippedCases,
    cases_missing_expected_chunks: missingExpectedChunks,
    avg_verifier_confidence: avg(confidenceSum, confidenceCount),
    avg_latency_ms: avg(latencySum, latencyCount),
    avg_input_tokens: avg(inputTokenSum, inputTokenCount),
    avg_output_tokens: avg(outputTokenSum, outputTokenCount),
    failed_cases: failedCases,
  };
}

// Orchestrate a full gold-eval batch for a shop/workspace.
//   serviceClient : Supabase service-role client (bypasses RLS, writes gold_eval_*)
//   shopId        : required
//   workspaceId   : optional scope
//   limit         : optional cap on number of cases
//   generate      : injectable draft generator (defaults to generateDraftV2)
// Returns { runId, summary, results }.
export async function runGoldEval({
  serviceClient,
  shopId,
  workspaceId = null,
  limit = null,
  generate,
  now = () => new Date().toISOString(),
}) {
  if (!serviceClient) throw new Error("gold-eval: serviceClient is required");
  if (!shopId) throw new Error("gold-eval: shopId is required");
  if (typeof generate !== "function") {
    throw new Error("gold-eval: generate function is required");
  }

  const cases = await loadActiveGoldCases(serviceClient, { shopId, workspaceId, limit });

  const { data: runRow, error: runErr } = await serviceClient
    .from(RUNS_TABLE)
    .insert({
      shop_id: shopId,
      workspace_id: workspaceId,
      status: "running",
      pipeline_version: "v2",
      case_count: cases.length,
    })
    .select("id")
    .maybeSingle();
  if (runErr || !runRow?.id) {
    throw new Error(`gold-eval: failed to create run: ${runErr?.message || "no id"}`);
  }
  const runId = runRow.id;

  const results = [];
  for (const goldCase of cases) {
    const row = await runSingleCase({ serviceClient, runId, goldCase, generate });
    results.push(row);
    // Gradeability is represented in the run summary without requiring a DB
    // migration. Persist only columns that exist on gold_eval_results.
    const {
      intent_gradeable: _intentGradeable,
      intent_grade_skip_reason: _intentGradeSkipReason,
      expected_intent_raw: _expectedIntentRaw,
      expected_intent_normalized: _expectedIntentNormalized,
      retrieval_gradeable: _retrievalGradeable,
      retrieval_grade_skip_reason: _retrievalGradeSkipReason,
      ...persistedRow
    } = row;
    const { error: insErr } = await serviceClient.from(RESULTS_TABLE).insert(persistedRow);
    if (insErr) {
      // Don't abort the whole batch on a single insert failure — record and move on.
      row.error_message = `result_insert_failed: ${insErr.message}`;
    }
  }

  const summary = summarize(results);
  await serviceClient
    .from(RUNS_TABLE)
    .update({
      status: "completed",
      completed_at: now(),
      summary_json: summary,
    })
    .eq("id", runId);

  return { runId, summary, results };
}

export const __internals = {
  loadActiveGoldCases,
  loadActiveGoldChunkIds,
  runSingleCase,
  summarize,
  toIdList,
};
