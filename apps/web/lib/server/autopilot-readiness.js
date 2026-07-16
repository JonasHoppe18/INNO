// Autopilot readiness must be earned from observed human outcomes, never from
// the model's own confidence. This module is deliberately pure so both the GET
// display and the PUT enforcement use exactly the same policy.

export const AUTOPILOT_INTENT_LABELS = Object.freeze({
  tracking: "Order tracking",
  refund: "Refunds",
  return: "Returns",
  exchange: "Exchanges & warranty",
  complaint: "Complaints & support cases",
  cancel: "Order cancellations",
  address_change: "Address changes",
  product_question: "Product questions",
  thanks: "Acknowledgements",
  update: "Customer updates",
});

export const AUTOPILOT_READINESS_POLICY = Object.freeze({
  evidenceWindowDays: 90,
  // Autonomous routing is a production-safety gate, not a pilot heuristic.
  // A perfect 100-case slice has a ~96.3% two-sided 95% Wilson lower bound;
  // tiny streaks can therefore never unlock a customer-facing category.
  minimumLabeledSamples: 100,
  minimumNoEditRate: 0.98,
  minimumNoEditWilsonLowerBound: 0.95,
  maximumMajorEdits: 0,
  wilsonZ: 1.96,
  learningNoEditRate: 0.9,
});

const VALID_EDIT_CLASSIFICATIONS = new Set([
  "no_edit",
  "minor_edit",
  "major_edit",
]);

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function normalizeIntent(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return Object.hasOwn(AUTOPILOT_INTENT_LABELS, normalized)
    ? normalized
    : null;
}

function intentFromPayload(payload) {
  return normalizeIntent(asObject(payload).intent);
}

function intentFromGeneration(row) {
  const planner = asObject(row?.planner_output_json);
  const resolution = asObject(row?.resolution_plan_json);
  const caseState = asObject(row?.case_state_json);
  const caseIntents = Array.isArray(caseState.intents) ? caseState.intents : [];
  return normalizeIntent(planner.primary_intent)
    || normalizeIntent(resolution.primary_intent)
    || normalizeIntent(caseIntents[0]?.type);
}

function putFirst(map, key, value) {
  if (key == null || !value || map.has(String(key))) return;
  map.set(String(key), value);
}

/**
 * Two-sided 95% Wilson score lower bound by default. Unlike a raw percentage,
 * this prevents a tiny perfect sample from being treated as production-ready.
 */
export function wilsonLowerBound(successes, total, z = 1.96) {
  if (!Number.isFinite(successes) || !Number.isFinite(total) || total <= 0) return 0;
  const n = Math.max(0, Math.floor(total));
  const s = Math.min(n, Math.max(0, Math.floor(successes)));
  if (n === 0) return 0;
  const p = s / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / denominator);
}

function roundRate(value) {
  return Math.round(value * 1000) / 1000;
}

function buildIntentLookups(generatedEvents, generationRows) {
  const generatedByDraftId = new Map();
  const generatedByGenerationId = new Map();
  const traceByDraftId = new Map();
  const traceByGenerationId = new Map();

  // Queries order newest-first. Keeping the first value avoids accidentally
  // coupling a send to an older, reused identifier if legacy data is malformed.
  for (const event of generatedEvents) {
    const intent = intentFromPayload(event?.payload_json);
    if (!intent) continue;
    putFirst(generatedByDraftId, event?.draft_id, intent);
    putFirst(generatedByGenerationId, event?.generation_id, intent);
  }

  for (const row of generationRows) {
    const intent = intentFromGeneration(row);
    if (!intent) continue;
    putFirst(traceByDraftId, row?.draft_id, intent);
    putFirst(traceByGenerationId, row?.id, intent);
  }

  return {
    generatedByDraftId,
    generatedByGenerationId,
    traceByDraftId,
    traceByGenerationId,
  };
}

function resolveSentIntent(event, lookups) {
  const direct = intentFromPayload(event?.payload_json);
  if (direct) return direct;

  const draftId = event?.draft_id == null ? null : String(event.draft_id);
  const generationId = event?.generation_id == null
    ? null
    : String(event.generation_id);

  return (draftId && lookups.generatedByDraftId.get(draftId))
    || (generationId && lookups.generatedByGenerationId.get(generationId))
    || (draftId && lookups.traceByDraftId.get(draftId))
    || (generationId && lookups.traceByGenerationId.get(generationId))
    || null;
}

function evaluateStats(stats, policy) {
  const total = stats.no_edit + stats.minor_edit + stats.major_edit;
  const noEditRate = total > 0 ? stats.no_edit / total : 0;
  const minorEditRate = total > 0 ? stats.minor_edit / total : 0;
  const majorEditRate = total > 0 ? stats.major_edit / total : 0;
  const lowerBound = wilsonLowerBound(stats.no_edit, total, policy.wilsonZ);

  let readiness = "not_ready";
  let reason = "quality_below_threshold";

  if (stats.major_edit > policy.maximumMajorEdits) {
    readiness = "not_ready";
    reason = "recent_major_edit";
  } else if (total < policy.minimumLabeledSamples) {
    readiness = "insufficient_data";
    reason = "insufficient_labeled_sample";
  } else if (
    noEditRate >= policy.minimumNoEditRate
    && lowerBound >= policy.minimumNoEditWilsonLowerBound
  ) {
    readiness = "ready";
    reason = "human_outcomes_pass";
  } else if (noEditRate >= policy.learningNoEditRate) {
    readiness = "learning";
    reason = lowerBound < policy.minimumNoEditWilsonLowerBound
      ? "statistical_confidence_too_low"
      : "no_edit_rate_below_threshold";
  }

  return {
    ticket_count: total,
    no_edit_count: stats.no_edit,
    minor_edit_count: stats.minor_edit,
    major_edit_count: stats.major_edit,
    no_edit_rate: total > 0 ? roundRate(noEditRate) : null,
    minor_edit_rate: total > 0 ? roundRate(minorEditRate) : null,
    major_edit_rate: total > 0 ? roundRate(majorEditRate) : null,
    no_edit_wilson_lower_bound: total > 0 ? roundRate(lowerBound) : null,
    readiness,
    readiness_reason: reason,
  };
}

/**
 * Aggregate draft_sent human outcomes per exact generated intent.
 *
 * A labeled send without a provable intent coupling is reported as
 * unattributed and can never help unlock any category. `other` and unknown
 * legacy taxonomies are intentionally not eligible for autopilot.
 */
export function evaluateAutopilotReadiness({
  sentEvents = [],
  generatedEvents = [],
  generationRows = [],
  storedAutoSendIntents = [],
  policy = AUTOPILOT_READINESS_POLICY,
} = {}) {
  const statsByIntent = new Map(
    Object.keys(AUTOPILOT_INTENT_LABELS).map((intent) => [
      intent,
      { no_edit: 0, minor_edit: 0, major_edit: 0 },
    ]),
  );
  const lookups = buildIntentLookups(generatedEvents, generationRows);

  let totalLabeled = 0;
  let attributedLabeled = 0;
  for (const event of sentEvents) {
    const classification = String(event?.edit_classification || "").toLowerCase();
    if (!VALID_EDIT_CLASSIFICATIONS.has(classification)) continue;
    totalLabeled += 1;

    const intent = resolveSentIntent(event, lookups);
    if (!intent) continue;
    statsByIntent.get(intent)[classification] += 1;
    attributedLabeled += 1;
  }

  const normalizedStored = Array.from(new Set(
    (Array.isArray(storedAutoSendIntents) ? storedAutoSendIntents : [])
      .map(normalizeIntent)
      .filter(Boolean),
  ));

  const categories = Object.entries(AUTOPILOT_INTENT_LABELS).map(([intent, label]) => {
    const result = evaluateStats(statsByIntent.get(intent), policy);
    const isReady = result.readiness === "ready";
    return {
      intent,
      label,
      ...result,
      sona_recommends: isReady,
      auto_send_enabled: isReady && normalizedStored.includes(intent),
    };
  });

  const readinessOrder = {
    ready: 0,
    learning: 1,
    insufficient_data: 2,
    not_ready: 3,
  };
  categories.sort((a, b) =>
    readinessOrder[a.readiness] - readinessOrder[b.readiness]
    || b.ticket_count - a.ticket_count
    || a.label.localeCompare(b.label));

  const readyIntents = categories
    .filter((category) => category.readiness === "ready")
    .map((category) => category.intent);
  const readySet = new Set(readyIntents);
  const effectiveAutoSendIntents = normalizedStored.filter((intent) => readySet.has(intent));
  const blockedStoredIntents = normalizedStored.filter((intent) => !readySet.has(intent));

  return {
    categories,
    readyIntents,
    effectiveAutoSendIntents,
    blockedStoredIntents,
    evidence: {
      total_labeled: totalLabeled,
      attributed_labeled: attributedLabeled,
      unattributed_labeled: totalLabeled - attributedLabeled,
      policy: {
        evidence_window_days: policy.evidenceWindowDays,
        minimum_labeled_samples: policy.minimumLabeledSamples,
        minimum_no_edit_rate: policy.minimumNoEditRate,
        minimum_no_edit_wilson_lower_bound: policy.minimumNoEditWilsonLowerBound,
        maximum_major_edits: policy.maximumMajorEdits,
      },
    },
  };
}

export function validateRequestedAutoSendIntents(requestedIntents, readyIntents) {
  const raw = Array.isArray(requestedIntents) ? requestedIntents : [];
  const invalidIntents = raw.filter((value) =>
    typeof value !== "string"
    || !Object.hasOwn(AUTOPILOT_INTENT_LABELS, value.trim().toLowerCase()));
  const normalized = Array.from(new Set(raw.map(normalizeIntent).filter(Boolean)));
  const ready = new Set(Array.isArray(readyIntents) ? readyIntents : []);
  const blockedIntents = normalized.filter((intent) => !ready.has(intent));
  return {
    intents: normalized,
    invalidIntents,
    blockedIntents,
    ok: invalidIntents.length === 0 && blockedIntents.length === 0,
  };
}
