// supabase/scripts/probe-recall.mjs
//
// Cheap retrieval-only recall probe. Calls the DEPLOYED generate-draft-v2 for
// each labeled golden case and checks whether any gold snippet identity appears
// in the matcher candidate pool. Skips the LLM judge entirely (far cheaper than
// a full eval run).
//
// Scores recall TWICE per case:
//   raw      — against every gold identity as labeled
//   reachable — against only gold identities the AI retriever can actually fetch
//               (excludes saved_reply + shopify_policy, which are filtered by
//                design: see match_agent_knowledge RPC + CLAUDE.md pinned-policy)
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/probe-recall.mjs            # all labeled cases
//   node supabase/scripts/probe-recall.mjs g-013 g-035
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadGoldenSet, computeRetrievalMetrics } from "./lib/golden-eval-core.mjs";
import { generateDraftV2 } from "../../apps/web/lib/server/eval-runner.js";

const SET_PATH = "supabase/eval/golden-set.acezone.json";
const GOLD_LABELS_PATH = "supabase/eval/gold-labels.acezone.json";
const SHOP = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";
const UNREACHABLE_PROVIDERS = new Set(["saved_reply", "shopify_policy"]);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Build identity -> reachable? map from the shop's knowledge.
const { data: kb } = await sb
  .from("agent_knowledge")
  .select("source_provider, metadata")
  .eq("shop_id", SHOP)
  .neq("source_type", "ticket");
const reachableById = new Map();
for (const r of kb || []) {
  const m = r.metadata || {};
  const title = String(m.title || m.name || m.label || "").trim().toLowerCase();
  const id = String(m.source_id ?? title).trim().toLowerCase();
  if (!id) continue;
  const ok = !UNREACHABLE_PROVIDERS.has(r.source_provider || "");
  reachableById.set(id, (reachableById.get(id) || false) || ok);
}
const isReachable = (id) => reachableById.get(String(id).trim().toLowerCase()) === true;

const argIds = new Set(process.argv.slice(2));
const set = JSON.parse(readFileSync(SET_PATH, "utf8"));
const gold = JSON.parse(readFileSync(GOLD_LABELS_PATH, "utf8"));
const goldById = new Map(gold.labels.map((l) => [l.id, l.correct_snippet_ids || []]));
const cases = loadGoldenSet(set, {}).filter(
  (c) => goldById.has(c.id) && (argIds.size === 0 || argIds.has(c.id)),
);

let rawHits = 0, rawScored = 0;
let reachHits = 0, reachScored = 0;
let droppedAll = 0; // cases whose entire gold became unreachable

for (const c of cases) {
  const g = goldById.get(c.id) || [];
  if (g.length === 0) continue; // abstain case — not a recall case
  try {
    const gen = await generateDraftV2(SHOP, c.subject || "", c.body, {
      excludeExternalTicketId: c.source_thread_id || undefined,
    });
    const rawM = computeRetrievalMetrics(g, gen.matcherDebug);
    rawScored++;
    if (rawM.recall_at_k === 1) rawHits++;

    const gReach = g.filter(isReachable);
    let reachStr = "";
    if (gReach.length === 0) {
      droppedAll++;
      reachStr = "reachable=ALL-UNREACHABLE";
    } else {
      const rm = computeRetrievalMetrics(gReach, gen.matcherDebug);
      reachScored++;
      if (rm.recall_at_k === 1) reachHits++;
      reachStr = `reachable=${rm.recall_at_k}`;
    }
    console.log(`  [${c.id}] raw=${rawM.recall_at_k} ${reachStr}`);
  } catch (err) {
    console.error(`  [${c.id}] ERROR: ${err.message}`);
  }
}

console.log(`\nRaw recall:       ${rawHits}/${rawScored} = ${(rawHits / rawScored).toFixed(2)}`);
console.log(
  `Reachable recall: ${reachHits}/${reachScored} = ${(reachHits / reachScored).toFixed(2)}` +
    `  (${droppedAll} cases had only unreachable gold)`,
);
