// supabase/scripts/feedback-detect-candidates.mjs
//
// Feedback-2a-2/2a-3: deterministic candidate detector for feedback_suggestions.
//
// Finds sent drafts that were heavily human-edited (Rule 1: major_edit OR
// edit_delta_pct >= 0.5) and shapes review-only feedback_suggestions rows.
//
// DRY-RUN IS THE DEFAULT and writes nothing. Pass --apply to persist rows
// (insert-only, idempotent via dedup_key ON CONFLICT DO NOTHING — existing rows
// are never updated and status is never changed; rows are always 'suggested').
//
// Privacy: it selects only ids / enums / numbers / timestamps. No reply/body
// columns are selected at all, so no raw bodies are pulled, printed, or stored.
// PostgREST cannot compute length() server-side via the column selector, so the
// reply-length metric (final_sent_len) is left null — privacy beats completeness.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/feedback-detect-candidates.mjs --workspace <ws>            # dry run
//   node supabase/scripts/feedback-detect-candidates.mjs --workspace <ws> --limit 5  # safety cap
//   node supabase/scripts/feedback-detect-candidates.mjs --workspace <ws> --apply    # persist
//
// Exit code: 0 on success; non-zero on misconfiguration or apply failure.

import { createClient } from "@supabase/supabase-js";
import {
  buildFeedbackCandidateSuggestion,
  applyFeedbackCandidates,
} from "../../apps/web/lib/server/feedback-candidate-detector.js";

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

// Dry-run is the DEFAULT. Writes happen only when --apply is passed explicitly.
const isApply = opts.apply === true;

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
    final_sent_len: null, // kept null: no body-free server-side length via PostgREST
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

console.log(`=== Feedback-2a-3 ${isApply ? "APPLY" : "DRY RUN (no inserts)"} ===`);
console.log(`workspace:        ${opts.workspace}`);
console.log(`resolved shop_id: ${resolvedShopId ?? "(not 1:1 — per-draft only)"}`);
console.log(`candidates:       ${candidates.length}`);
console.log(`  very_high (>=0.75): ${veryHigh}`);
console.log(`  skipped (missing scope): ${skipped}`);

// Apply only when explicitly requested. Insert-only + idempotent via dedup_key
// (ON CONFLICT DO NOTHING); existing rows are never updated and status is never
// changed. All writes use the service-role client.
const result = await applyFeedbackCandidates(candidates, {
  dryRun: !isApply,
  upsert: (upsertRows, options) =>
    supabase.from("feedback_suggestions").upsert(upsertRows, options).select("id, dedup_key"),
});

if (isApply) {
  if (result.error) {
    console.error("apply failed:", result.error.message);
    process.exit(1);
  }
  console.log(`  rows attempted:    ${result.attempted}`);
  console.log(`  rows inserted:     ${result.inserted}`);
  console.log(`  duplicates skipped: ${result.duplicates}`);
}
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
console.log(
  isApply
    ? "Apply complete (insert-only, idempotent via dedup_key)."
    : "Dry run complete. Nothing was written. Pass --apply to persist (review-only rows).",
);
