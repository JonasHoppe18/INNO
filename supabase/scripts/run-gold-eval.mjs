// supabase/scripts/run-gold-eval.mjs
//
// Run the DB-backed gold eval for a shop: loads active gold_eval_cases, runs each
// through generate-draft-v2 in EVAL MODE (no customer-table writes), stores a
// gold_eval_results row per case, and prints the compact summary.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/run-gold-eval.mjs --shop <shop_id> [--workspace <id>] [--limit N]
import { createClient } from "@supabase/supabase-js";
import { generateDraftV2 } from "../../apps/web/lib/server/eval-runner.js";
import { runGoldEval } from "../../apps/web/lib/server/gold-eval-runner.js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing env. Run: set -a && source apps/web/.env.local && set +a");
  process.exit(1);
}

function parseArgs(argv) {
  const out = { shop: null, workspace: null, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--shop") out.shop = argv[++i];
    else if (a === "--workspace") out.workspace = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]) || null;
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.shop) {
  console.error("Usage: node run-gold-eval.mjs --shop <shop_id> [--workspace <id>] [--limit N]");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

const { runId, summary } = await runGoldEval({
  serviceClient: supabase,
  shopId: opts.shop,
  workspaceId: opts.workspace,
  limit: opts.limit,
  generate: generateDraftV2,
});

const pct = (v) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const num = (v) => (v == null ? "n/a" : Math.round(v));

console.log(`\nGold eval run ${runId}`);
console.log(`  cases:               ${summary.total_cases}`);
console.log(`  intent accuracy:     ${pct(summary.intent_accuracy)} (graded ${summary.intent_graded})`);
console.log(`  retrieval hit@5:     ${pct(summary.retrieval_hit_at_5)} (graded ${summary.retrieval_graded})`);
console.log(`  retrieval ungraded:  ${summary.retrieval_ungraded}`);
console.log(`  missing gold chunks: ${summary.cases_missing_expected_chunks}`);
console.log(`  avg confidence:      ${summary.avg_verifier_confidence ?? "n/a"}`);
console.log(`  avg latency ms:      ${num(summary.avg_latency_ms)}`);
console.log(`  avg input tokens:    ${num(summary.avg_input_tokens)}`);
console.log(`  avg output tokens:   ${num(summary.avg_output_tokens)}`);
console.log(`  failed:              ${summary.failed_count}`);
for (const f of summary.failed_cases) {
  console.log(`    - ${f.eval_case_id}: ${f.reason}`);
}
