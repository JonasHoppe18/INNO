// supabase/scripts/build-gold-labels.mjs
//
// One-time: propose gold retrieval labels for the committed golden set.
// For each golden case, an LLM is shown the customer message + every distinct
// shop snippet and proposes correct_snippet_ids (snippet identities) — empty
// when NO snippet should be used (e.g. g-020 dongle purchase). A human then
// reviews/corrects the output file; it is committed as ground truth.
//
// Identity = source_id when present, else title (matches the retriever/eval
// convention). Output ids are these identities.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/build-gold-labels.mjs
//   node supabase/scripts/build-gold-labels.mjs --shop 38df5fef-... --limit 3
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  parseArgs,
  loadGoldenSet,
  knowledgeIdentityFromMetadata,
} from "./lib/golden-eval-core.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = "gpt-4o-mini";
const SET_PATH = "supabase/eval/golden-set.acezone.json";
const OUT_PATH = "supabase/eval/gold-labels.acezone.json";

if (!SUPABASE_URL || !SERVICE_ROLE || !OPENAI_KEY) {
  console.error("Missing env. Run: set -a && source apps/web/.env.local && set +a");
  process.exit(1);
}

const opts = parseArgs(process.argv.slice(2));
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
const set = JSON.parse(readFileSync(SET_PATH, "utf8"));
const cases = loadGoldenSet(set, { tier: opts.tier, limit: opts.limit, intent: opts.intent });

// Fetch all knowledge chunks for the shop, scoped explicitly by shop_id.
const { data: rows, error } = await supabase
  .from("agent_knowledge")
  .select("id, content, source_type, metadata")
  .eq("shop_id", opts.shop)
  .neq("source_type", "ticket");
if (error) {
  console.error("agent_knowledge fetch failed:", error.message);
  process.exit(1);
}

// Collapse chunks into distinct snippets by identity (source_id || title).
const snippets = new Map();
for (const r of rows || []) {
  const meta = r.metadata && typeof r.metadata === "object" ? r.metadata : {};
  const title = String(
    meta.title || meta.name || meta.label || meta.section_heading ||
      meta.normalized_heading || "",
  ).trim();
  const identity = knowledgeIdentityFromMetadata(meta);
  if (!identity) continue;
  if (!snippets.has(identity)) {
    snippets.set(identity, {
      identity,
      title: title || "(untitled)",
      question: meta.question ? String(meta.question) : null,
      text: String(r.content || "").slice(0, 600),
    });
  }
}
const snippetList = [...snippets.values()];
console.log(`Loaded ${snippetList.length} distinct snippets for shop ${opts.shop}`);

// Each snippet is referenced by a stable 1-based number; the model returns
// numbers (robust) and we map them back to identities below.
const catalog = snippetList
  .map((s, i) =>
    `[${i + 1}] Title: ${s.title}` +
    (s.question ? `\n    Question: ${s.question}` : "") +
    `\n    Excerpt: ${s.text}`
  )
  .join("\n\n");

const SYSTEM = "You build a retrieval ground-truth set for a customer-support AI. " +
  "Given a customer message and a numbered catalog of knowledge snippets, decide " +
  "which snippet(s) actually ANSWER the customer's specific request — match on " +
  "meaning, across languages. A snippet that is merely the same TOPIC does not " +
  "count. If NO snippet answers the request, return an empty list (this is correct " +
  "and expected). " +
  "IMPORTANT: the knowledge base contains multiple generations of the same content " +
  "(legacy FAQ snippets AND curated document sections). When several catalog entries " +
  "are content-equivalent answers to the request, include ALL of them — retrieval is " +
  "correct if it finds ANY equivalent. Do not pick just the FAQ-style variant.";

async function callOpenAI(body, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        throw new Error(`OpenAI ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      }
      return await resp.json();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

async function proposeForCase(c) {
  const userPrompt =
    `Customer message:\n${c.body}\n\nNumbered snippet catalog:\n${catalog}\n\n` +
    `Return JSON: {"correct_snippet_numbers": number[], "rationale": string}. ` +
    `Use the [N] numbers shown in the catalog. Empty array if nothing truly answers it.`;
  const data = await callOpenAI({
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  // Map the returned 1-based numbers back to snippet identities.
  const ids = [...new Set(
    (parsed.correct_snippet_numbers || [])
      .map((n) => snippetList[Number(n) - 1]?.identity)
      .filter((x) => typeof x === "string" && x.length > 0),
  )];
  return { ids, rationale: String(parsed.rationale || "") };
}

const labels = [];
for (const c of cases) {
  try {
    const { ids, rationale } = await proposeForCase(c);
    labels.push({
      id: c.id,
      correct_snippet_ids: ids,
      rationale,
      _proposed_by: MODEL,
      _needs_human_review: true,
    });
    console.log(`  [${c.id}] proposed ${ids.length} snippet(s)`);
  } catch (err) {
    labels.push({ id: c.id, correct_snippet_ids: [], rationale: "", _error: err.message });
    console.error(`  [${c.id}] ERROR: ${err.message}`);
  }
}

writeFileSync(
  OUT_PATH,
  JSON.stringify(
    { shop_id: opts.shop, generated_at: new Date().toISOString(), labels },
    null,
    2,
  ),
);
console.log(`\nWrote ${labels.length} draft labels to ${OUT_PATH}. REVIEW BY HUMAN before use.`);
