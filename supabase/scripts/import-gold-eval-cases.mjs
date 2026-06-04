// supabase/scripts/import-gold-eval-cases.mjs
//
// Import hand-curated gold-eval cases from a JSON seed file into gold_eval_cases.
// This is the least-complex import path: edit a JSON file, run this script.
//
// Format: see supabase/eval/gold-eval-cases.example.json. Each case maps 1:1 to a
// gold_eval_cases row. shop_id comes from the file's top-level "shop_id" unless
// overridden by --shop. Idempotency: a case is matched to an existing row by
// (shop_id, title); by default an existing match is SKIPPED. Pass --replace to
// update the matched row instead.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/import-gold-eval-cases.mjs --file supabase/eval/gold-eval-cases.example.json
//   node supabase/scripts/import-gold-eval-cases.mjs --file <path> --shop <shop_id> --replace --dry-run
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing env. Run: set -a && source apps/web/.env.local && set +a");
  process.exit(1);
}

function parseArgs(argv) {
  const out = { file: null, shop: null, workspace: null, replace: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") out.file = argv[++i];
    else if (a === "--shop") out.shop = argv[++i];
    else if (a === "--workspace") out.workspace = argv[++i];
    else if (a === "--replace") out.replace = true;
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.file) {
  console.error("Usage: node import-gold-eval-cases.mjs --file <path> [--shop <id>] [--workspace <id>] [--replace] [--dry-run]");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(opts.file, "utf8"));
const fileShopId = opts.shop || raw.shop_id;
if (!fileShopId || fileShopId === "00000000-0000-0000-0000-000000000000") {
  console.error("No real shop_id. Pass --shop <id> or set a real shop_id in the file.");
  process.exit(1);
}

const cases = Array.isArray(raw.cases) ? raw.cases : [];
if (cases.length === 0) {
  console.error("No cases in file.");
  process.exit(1);
}

function toRow(c) {
  return {
    shop_id: fileShopId,
    workspace_id: opts.workspace || c.workspace_id || null,
    title: c.title,
    category: c.category ?? null,
    customer_message: c.customer_message,
    thread_history_json: c.thread_history_json ?? null,
    order_context_json: c.order_context_json ?? null,
    expected_intent: c.expected_intent ?? null,
    secondary_intents: c.secondary_intents ?? [],
    grading_mode: c.grading_mode ?? "content_only",
    required_facts_json: c.required_facts_json ?? null,
    gold_knowledge_chunk_ids: c.gold_knowledge_chunk_ids ?? null,
    expected_resolution: c.expected_resolution ?? null,
    expected_action_json: c.expected_action_json ?? null,
    ideal_reply: c.ideal_reply ?? null,
    autopilot_allowed: c.autopilot_allowed === true,
    notes: c.notes ?? null,
    is_active: c.is_active !== false,
    benchmark_status: c.benchmark_status ?? null,
    manual_reviewed: c.manual_reviewed === true,
    review_notes: c.review_notes ?? null,
  };
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

let inserted = 0;
let updated = 0;
let skipped = 0;

const OPTIONAL_COLUMNS = [
  "secondary_intents",
  "grading_mode",
  "benchmark_status",
  "manual_reviewed",
  "review_notes",
];
const optionalColumns = new Set(OPTIONAL_COLUMNS);

async function detectOptionalColumns() {
  for (;;) {
    if (optionalColumns.size === 0) return;
    const { error } = await supabase
      .from("gold_eval_cases")
      .select([...optionalColumns].join(","))
      .limit(1);
    if (!error) return;
    const message = String(error.message || "");
    let removed = false;
    for (const col of [...optionalColumns]) {
      if (message.includes(`gold_eval_cases.${col}`) || message.includes(`'${col}'`)) {
        optionalColumns.delete(col);
        removed = true;
      }
    }
    if (!removed) {
      console.warn(`Optional eval-metadata column check failed: ${message}`);
      return;
    }
  }
}

await detectOptionalColumns();
if (optionalColumns.size !== OPTIONAL_COLUMNS.length) {
  console.warn(
    `Optional eval-metadata columns unavailable in DB; omitting: ${
      OPTIONAL_COLUMNS.filter((col) => !optionalColumns.has(col)).join(", ")
    }`,
  );
}

function rowForDb(row) {
  const out = { ...row };
  for (const col of OPTIONAL_COLUMNS) {
    if (!optionalColumns.has(col)) delete out[col];
  }
  return out;
}

for (const c of cases) {
  if (!c.title || !c.customer_message) {
    console.warn(`Skipping case without title/customer_message: ${JSON.stringify(c.external_id || c.title || "?")}`);
    skipped++;
    continue;
  }
  const row = toRow(c);

  const { data: existing, error: selErr } = await supabase
    .from("gold_eval_cases")
    .select("id")
    .eq("shop_id", fileShopId)
    .eq("title", row.title)
    .maybeSingle();
  if (selErr) {
    console.error(`Lookup failed for "${row.title}": ${selErr.message}`);
    process.exit(1);
  }

  if (existing?.id && !opts.replace) {
    console.log(`SKIP (exists): ${row.title}`);
    skipped++;
    continue;
  }

  if (opts.dryRun) {
    console.log(`${existing?.id ? "WOULD UPDATE" : "WOULD INSERT"}: ${row.title}`);
    existing?.id ? updated++ : inserted++;
    continue;
  }

  if (existing?.id) {
    const { error } = await supabase
      .from("gold_eval_cases")
      .update({ ...rowForDb(row), updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) {
      console.error(`Update failed for "${row.title}": ${error.message}`);
      process.exit(1);
    }
    console.log(`UPDATED: ${row.title}`);
    updated++;
  } else {
    const { error } = await supabase.from("gold_eval_cases").insert(rowForDb(row));
    if (error) {
      console.error(`Insert failed for "${row.title}": ${error.message}`);
      process.exit(1);
    }
    console.log(`INSERTED: ${row.title}`);
    inserted++;
  }
}

console.log(`\nDone. inserted=${inserted} updated=${updated} skipped=${skipped} (shop=${fileShopId})`);
