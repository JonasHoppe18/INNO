// FACTUAL-ONLY corrections for AceZone return/refund knowledge.
// Scope: chunk 3192 (remove fixed EUR 50 deduction) and chunk 3651 (update the
// general return address). NO retrieval-shaping (no products/canonical/archive
// changes), NO metadata changes beyond what the content edit strictly requires.
// 3192 is re-embedded (it is in the retrieval path); 3651 is a saved_reply
// (excluded from retrieval) so its embedding is irrelevant and left untouched.
//   set -a && source apps/web/.env.local && set +a
//   node scripts/local/factual-correct.mjs
import { createClient } from "/Users/jonashoppe/Developer/INNO/node_modules/@supabase/supabase-js/dist/main/index.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
const SUPA_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI = process.env.OPENAI_API_KEY;
const SHOP = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";
const supabase = createClient(SUPA_URL, SERVICE);
const backup = JSON.parse(readFileSync(join(import.meta.dirname, "../../.local-backups/factual-correction-backup.json"), "utf8"));
const md5 = (s) => createHash("md5").update(s || "").digest("hex");

async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`embed failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const v = j.data?.[0]?.embedding;
  if (!Array.isArray(v) || v.length !== 1536) throw new Error(`embed bad dims: ${v?.length}`);
  return v;
}

function replaceOnce(id, content, needle, replacement) {
  if (!content.includes(needle)) throw new Error(`ABORT ${id}: needle not found: ${JSON.stringify(needle.slice(0, 60))}`);
  const out = content.replace(needle, replacement);
  if (out === content) throw new Error(`ABORT ${id}: replacement made no change`);
  return out;
}

async function update(id, patch) {
  const { error } = await supabase.from("agent_knowledge").update(patch).eq("shop_id", SHOP).eq("id", id);
  if (error) throw new Error(`update ${id}: ${error.message}`);
}

// ---------- 3192: remove the fixed EUR 50 deduction ----------
{
  const old = backup["3192"];
  const NEEDLE = "we will thus deduct EUR 50 from the total on your receipt , under the assumption that";
  const REPLACEMENT = "we will thus apply an individual deduction based on the product's reduced value, assessed case by case (no fixed amount is promised in advance), under the assumption that";
  const newContent = replaceOnce(3192, old.content, NEEDLE, REPLACEMENT);
  if (/EUR\s*50/.test(newContent)) throw new Error("3192: EUR 50 still present after edit");
  const emb = await embed(newContent); // re-embed: 3192 is in the retrieval path
  await update(3192, { content: newContent, embedding: emb }); // metadata unchanged
  console.log(`3192 UPDATED content_md5 ${old.content_md5} -> ${md5(newContent)} len ${old.content_len}->${newContent.length} EUR50_removed=true embedding=RE-EMBEDDED(1536) metadata=UNCHANGED`);
}

// ---------- 3651: update the general return address only ----------
{
  const old = backup["3651"];
  const NEEDLE = "AceZone ApS\nNordre Fasanvej 113, 2nd floor\n2000 Frederiksberg\nDenmark";
  const REPLACEMENT = "AceZone International ApS\nØster Allé 56, 5th floor\n2100 København Ø\nDenmark";
  const newContent = replaceOnce(3651, old.content, NEEDLE, REPLACEMENT);
  if (newContent.includes("Nordre Fasanvej")) throw new Error("3651: old address still present after edit");
  await update(3651, { content: newContent }); // saved_reply: not in retrieval; embedding + metadata unchanged
  console.log(`3651 UPDATED content_md5 ${old.content_md5} -> ${md5(newContent)} len ${old.content_len}->${newContent.length} address_updated=true (saved_reply: embedding+metadata unchanged)`);
}

console.log("\nFactual corrections applied (2 rows).");
