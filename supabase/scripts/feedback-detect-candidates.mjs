// supabase/scripts/feedback-detect-candidates.mjs
//
// Feedback-2a-2: DRY-RUN deterministic candidate detector for feedback_suggestions.
//
// Finds sent drafts that were heavily human-edited (Rule 1: major_edit OR
// edit_delta_pct >= 0.5) and prints the would-be feedback_suggestions rows. It
// INSERTS NOTHING. There is no apply path yet — `--apply` hard-fails with
// "not implemented" (that is Feedback-2a-3, a separately-approved slice).
//
// Privacy: it selects only ids / enums / numbers / timestamps. No reply/body
// columns are selected at all, so no raw bodies are pulled, printed, or stored.
// The reply-length metric is deferred to the apply slice (2a-3), which can
// compute it server-side without returning the text.
//
// Run (read-only):
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/feedback-detect-candidates.mjs --workspace <workspace_id>
//   node supabase/scripts/feedback-detect-candidates.mjs --workspace <ws> --limit 5 --sample 3
//
// Exit code: 0 on success. Non-zero on misconfiguration or if --apply is passed.

import { createClient } from "@supabase/supabase-js";
import { buildFeedbackCandidateSuggestion } from "../../apps/web/lib/server/feedback-candidate-detector.js";

// Node < 22 has no native WebSocket; supabase-js initializes realtime in its
// constructor. We only do table reads, but the constructor still needs a
// WebSocket ctor — provide one from the already-present `ws` package when the
// runtime lacks it. No-op on Node 22+.
if (!globalThis.WebSocket) {
  try {
    const { WebSocket: WsWebSocket } = await import("ws");
    globalThis.WebSocket = WsWebSocket;
  } catch {
    /* fall through; createClient may still work on newer runtimes */
  }
}

function parseArgs(argv) {
  const opts = { sample: 5, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace") opts.workspace = argv[++i];
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--sample") opts.sample = Number(argv[++i]);
    else if (a === "--apply") opts.apply = true;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// Guard: there is intentionally no write path in Feedback-2a-2.
if (opts.apply) {
  console.error("--apply is not implemented in Feedback-2a-2 (dry-run only). Insertion is a separate, approved slice (2a-3).");
  process.exit(2);
}

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SERVICE_ROLE_KEY. Source apps/web/.env.local first.");
  process.exit(1);
}
if (!opts.workspace) {
  console.error("Usage: --workspace <workspace_id> [--limit N] [--sample N]");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Resolve the workspace's shop (drafts.shop_id may be null; the table is 1:1
// workspace->shop). If not 1:1 or unresolved, candidates without their own
// shop_id will skip via the helper's missing_scope guard.
const { data: shops, error: shopErr } = await supabase
  .from("shops")
  .select("id")
  .eq("workspace_id", opts.workspace);
if (shopErr) {
  console.error("shop lookup failed:", shopErr.message);
  process.exit(1);
}
const resolvedShopId = shops?.length === 1 ? shops[0].id : null;

// Read-only: select ONLY ids / enums / numbers / timestamps. No reply/body
// column is selected — PostgREST cannot compute a length server-side, and
// pulling the text just to measure it would violate the no-body rule. The
// reply-length metric is therefore left null in the dry run and added in 2a-3.
let query = supabase
  .from("drafts")
  .select("id, shop_id, thread_id, message_id, status, edit_classification, edit_delta_pct, edit_distance, created_at")
  .eq("workspace_id", opts.workspace)
  .eq("status", "sent")
  .or("edit_classification.eq.major_edit,edit_delta_pct.gte.0.5")
  .order("edit_delta_pct", { ascending: false });
if (opts.limit) query = query.limit(opts.limit);

const { data: rows, error } = await query;
if (error) {
  console.error("drafts query failed:", error.message);
  process.exit(1);
}

const candidates = [];
let veryHigh = 0;
let skipped = 0;
for (const raw of rows || []) {
  const row = {
    id: raw.id,
    workspace_id: opts.workspace,
    shop_id: raw.shop_id || resolvedShopId,
    thread_id: raw.thread_id,
    message_id: raw.message_id,
    status: raw.status,
    edit_classification: raw.edit_classification,
    edit_delta_pct: raw.edit_delta_pct,
    edit_distance: raw.edit_distance,
    final_sent_len: null, // deferred to 2a-3 (server-side length, no body pulled)
    sent_at: raw.created_at ? String(raw.created_at).slice(0, 10) : null,
  };
  // Coupling is deferred (Rule 3/4) — always 'none' in 2a-2.
  const res = buildFeedbackCandidateSuggestion(row, { couplingReliable: false });
  if (res.excluded) continue;
  if (!res.ok) {
    skipped++;
    continue;
  }
  if (res.row.evidence_json.very_high_rewrite) veryHigh++;
  candidates.push(res.row);
}

console.log("=== Feedback-2a-2 DRY RUN (no inserts) ===");
console.log(`workspace:        ${opts.workspace}`);
console.log(`resolved shop_id: ${resolvedShopId ?? "(not 1:1 — per-draft only)"}`);
console.log(`candidates:       ${candidates.length}`);
console.log(`  very_high (>=0.75): ${veryHigh}`);
console.log(`  skipped (missing scope): ${skipped}`);
console.log("");

// Redacted samples: dedup_key + classification + scalars only. No bodies.
const sample = candidates.slice(0, Math.max(0, opts.sample || 0));
if (sample.length) {
  console.log(`--- sample (${sample.length}) ---`);
  for (const r of sample) {
    console.log(
      JSON.stringify({
        dedup_key: r.dedup_key,
        suggestion_type: r.suggestion_type,
        root_cause: r.root_cause,
        status: r.status,
        evidence: r.evidence_json,
      }),
    );
  }
}
console.log("");
console.log("Dry run complete. Nothing was written. Use a separately-approved 2a-3 slice to persist.");
