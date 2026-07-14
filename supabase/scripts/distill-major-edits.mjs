// supabase/scripts/distill-major-edits.mjs
//
// Feedback Loop v1: classify major_edit draft pairs
// (drafts.ai_draft_text vs drafts.final_sent_text) into a root cause via LLM
// and print the resulting suggestion candidates + a root-cause histogram.
//
// Default is dry-run (no writes). --apply upserts feedback_suggestions rows,
// idempotent on dedup_key (distill:<draft_id>). Apply was gated until the
// dry-run quality check on 25 real pairs was approved (2026-07-06).
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/distill-major-edits.mjs --limit 5 --dry-run
//   node supabase/scripts/distill-major-edits.mjs --limit 200 --apply
import { createClient } from "@supabase/supabase-js";
import {
  buildDistillerPrompt,
  parseDistillerResponse,
  buildSuggestionFromDraftRow,
} from "../../apps/web/lib/server/major-edit-distiller.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 25;
if (!Number.isFinite(limit) || limit <= 0) {
  console.error("distill-major-edits: --limit must be a positive number");
  process.exit(2);
}

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error(
    "distill-major-edits: missing env — source apps/web/.env.local first (needs SUPABASE url, service role key, OPENAI_API_KEY)",
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const model = process.env.OPENAI_MODEL || "gpt-4o";

const { data: rows, error } = await supabase
  .from("drafts")
  .select(
    "draft_id, thread_id, shop_id, workspace_id, ticket_category, edit_delta_pct, ai_draft_text, final_sent_text",
  )
  .eq("edit_classification", "major_edit")
  .eq("status", "sent")
  .not("ai_draft_text", "is", null)
  .not("final_sent_text", "is", null)
  .order("created_at", { ascending: false })
  .limit(limit);
if (error) throw error;

console.log(
  `distill-major-edits ${apply ? "APPLY" : "DRY-RUN"} — ${rows.length} major_edit pairs, model=${model}\n`,
);

const histogram = {};
let skipped = 0;
let written = 0;
for (const draftRow of rows) {
  const { system, user } = buildDistillerPrompt({
    aiDraftText: draftRow.ai_draft_text,
    finalSentText: draftRow.final_sent_text,
    ticketCategory: draftRow.ticket_category,
  });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const body = await res.json();

  let classification;
  try {
    classification = parseDistillerResponse(body.choices[0].message.content);
  } catch (e) {
    skipped += 1;
    console.warn(`skip ${draftRow.draft_id}: ${e.message}`);
    continue;
  }

  const built = buildSuggestionFromDraftRow({ draftRow, classification });
  if (!built.ok) {
    skipped += 1;
    console.warn(
      `skip ${draftRow.draft_id}: ${built.skipped || built.errors?.join("; ")}`,
    );
    continue;
  }

  if (apply) {
    const { error: upsertErr } = await supabase
      .from("feedback_suggestions")
      .upsert(built.row, { onConflict: "dedup_key" });
    if (upsertErr) throw upsertErr;
    written += 1;
  }

  histogram[classification.root_cause] =
    (histogram[classification.root_cause] || 0) + 1;
  console.log(
    [
      built.row.dedup_key,
      classification.root_cause,
      classification.suggestion_type,
      `conf=${classification.confidence}`,
      classification.proposed_change_summary,
    ].join("\t"),
  );
}

console.log(`\nRoot-cause histogram (${rows.length - skipped} classified, ${skipped} skipped):`);
console.log(JSON.stringify(histogram, null, 2));
console.log(
  apply
    ? `\nAPPLY: ${written} feedback_suggestions rows upserted (dedup_key distill:*).`
    : "\nDRY-RUN: no database writes performed.",
);
