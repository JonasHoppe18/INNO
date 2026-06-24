// supabase/scripts/inspect-report.mjs
//
// READ-ONLY inspector for a golden-eval run report. Prints the relevant per-case
// fields for review. Makes NO network/OpenAI calls, generates NO drafts, writes
// NOTHING. It only reads two JSON files: the run report and the case-set (for the
// customer message + human reply, which the report itself does not store).
//
// Run:
//   node supabase/scripts/inspect-report.mjs supabase/eval/runs/<file>.json
//   node supabase/scripts/inspect-report.mjs <report.json> --ids g-016,g-020,g-024,e-002
//   node supabase/scripts/inspect-report.mjs <report.json> --set supabase/eval/pilot-set.acezone.json
//
// Note: the golden run persists scores as { correctness, completeness, tone,
// actionability, overall_10, send_ready } only. judge_flags / reasoning /
// primary_gap / likely_root_cause are NOT persisted by run-golden-eval today —
// the inspector prints "(not persisted in this report)" for those and shows what
// IS available (draft, gate failures, retrieval metrics, retrievalDebug chunks).

import { readFileSync, existsSync } from "node:fs";

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
}

const reportPath = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2]
  : arg("--report");
const setPath = arg("--set", "supabase/eval/golden-set.acezone.json");
const ids = (arg("--ids", "g-016,g-020,g-024,e-002") || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

if (!reportPath) {
  console.error("Usage: node supabase/scripts/inspect-report.mjs <report.json> [--ids a,b] [--set file.json]");
  process.exit(1);
}
if (!existsSync(reportPath)) {
  console.error(`Report not found: ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const set = existsSync(setPath) ? JSON.parse(readFileSync(setPath, "utf8")) : { cases: [] };
const caseById = new Map((set.cases || []).map((c) => [c.id, c]));
const resultById = new Map((report.results || []).map((r) => [r.id, r]));

const N = (v) => (v === undefined || v === null ? "(absent)" : v);
const hr = (s = "─") => s.repeat(78);

function printField(label, value) {
  console.log(`\n${label}:`);
  console.log(String(value ?? "(absent)"));
}

// Report-level context for the requested ids.
console.log(hr("="));
console.log(`Report: ${reportPath}`);
if (report.summary?.aggregate) console.log("Headline aggregate:", JSON.stringify(report.summary.aggregate));
if (report.summary?.excluded_live_fact_dependent) {
  console.log("excluded_live_fact_dependent:", JSON.stringify(report.summary.excluded_live_fact_dependent));
}
const regressed = report.diff?.regressedCases || [];
if (regressed.length) console.log("regressed (all):", regressed.map((r) => `${r.id}:${r.from}->${r.to}`).join("  "));

for (const id of ids) {
  const r = resultById.get(id);
  const c = caseById.get(id);
  console.log(`\n${hr("=")}`);
  console.log(`CASE ${id}`);
  if (!r) {
    console.log("  (not found in report.results — was it in the run? was --set the same set used?)");
  }
  console.log(`  intent=${N(r?.intent ?? c?.intent)} tier=${N(r?.tier ?? c?.tier)} lang=${N(c?.language)}`);
  console.log(`  anchor_class=${N(r?.anchor_class)} live_fact_dependent=${N(r?.live_fact_dependent)} status=${N(r?.status)}`);

  // --- inputs (from the case set; report does not store these) ---
  printField("CUSTOMER MESSAGE (from case set)", c?.body);
  printField("GENERATED DRAFT (from report)", r?.draft ?? (r?.status === "failed" ? `(failed: ${r?.error})` : "(absent)"));
  if (r?.actions?.length) console.log("\nPROPOSED ACTIONS:", JSON.stringify(r.actions));
  printField("HUMAN REPLY (from case set)", c?.human_reply);

  // --- scores (persisted) ---
  const s = r?.scores || {};
  console.log(`\nSCORES: overall_10=${N(s.overall_10)} send_ready=${N(s.send_ready)} | correctness=${N(s.correctness)} completeness=${N(s.completeness)} tone=${N(s.tone)} actionability=${N(s.actionability)}`);

  // --- judge fields that the golden run does NOT persist today ---
  const judgeExtra = ["reasoning", "judge_flags", "primary_gap", "likely_root_cause", "missing_for_10"];
  const present = judgeExtra.filter((k) => s[k] !== undefined || r?.[k] !== undefined);
  if (present.length) {
    for (const k of present) console.log(`${k}:`, JSON.stringify(s[k] ?? r[k]));
  } else {
    console.log("score reasoning / judge_flags / primary_gap / likely_root_cause: (not persisted in this report —");
    console.log("  run-golden-eval stores only the 6 numeric scores; extend results.push to persist `judged` fully to capture these next run)");
  }

  // --- gate (esp. e-002) ---
  if (r?.gate) {
    console.log(`\nGATE: passed=${r.gate.passed}`);
    if (r.gate.failures?.length) {
      console.log("  failures:");
      for (const f of r.gate.failures) console.log(`    - ${f}`);
    }
  }

  // --- retrieval metrics + matcher/chunk debug ---
  if (r?.retrieval) console.log("\nRETRIEVAL METRICS:", JSON.stringify(r.retrieval));
  else console.log("\nRETRIEVAL METRICS: (none — no gold label, or skipped because live_fact_dependent)");
  const chunks = r?.retrievalDebug || [];
  if (chunks.length) {
    console.log(`RETRIEVED CHUNKS (top ${Math.min(8, chunks.length)} of ${chunks.length}):`);
    for (const ch of chunks.slice(0, 8)) {
      console.log(`  - score=${N(ch.score)} src=${N(ch.source_id ?? ch.source_label)} title=${N(ch.title)} kind=${N(ch.kind)}`);
    }
  } else {
    console.log("RETRIEVED CHUNKS: (none stored)");
  }
}

console.log(`\n${hr("=")}`);
console.log("Done. (read-only — no network, no writes)");
