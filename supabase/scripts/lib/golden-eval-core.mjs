// supabase/scripts/lib/golden-eval-core.mjs
export const ACEZONE_SHOP_ID = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";

export function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : null;
  };
  const tier = val("--tier");
  if (tier !== null && tier !== "historical" && tier !== "edge") {
    throw new Error('tier must be "historical" or "edge"');
  }
  const limitRaw = val("--limit");
  return {
    shop: val("--shop") || ACEZONE_SHOP_ID,
    tier,
    limit: limitRaw !== null ? parseInt(limitRaw, 10) : null,
    accept: has("--accept"),
  };
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

export function loadGoldenSet(set, { tier = null, limit = null } = {}) {
  if (!set || !Array.isArray(set.cases)) throw new Error("golden set must have a cases array");
  let cases = set.cases.map(validateCase);
  if (tier) cases = cases.filter((c) => c.tier === tier);
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
