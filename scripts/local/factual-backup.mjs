// Read-only focused backup of the two factual-correction targets (3192, 3651),
// including raw embeddings, so the factual writes can be reverted exactly.
//   set -a && source apps/web/.env.local && set +a
//   node scripts/local/factual-backup.mjs
import { createClient } from "/Users/jonashoppe/Developer/INNO/node_modules/@supabase/supabase-js/dist/main/index.js";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
const SUPA_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOP = "38df5fef-2a23-47f3-803e-39f2d6f1ed99";
const supabase = createClient(SUPA_URL, SERVICE);
const ids = [3192, 3651];
const { data, error } = await supabase
  .from("agent_knowledge")
  .select("id, content, source_type, source_provider, metadata, embedding, created_at, last_verified_at, source_hash, chunk_index, source_id")
  .eq("shop_id", SHOP)
  .in("id", ids)
  .order("id");
if (error) { console.error(error); process.exit(1); }
const out = {};
for (const r of data) {
  const emb = Array.isArray(r.embedding) ? r.embedding : JSON.parse(r.embedding || "null");
  out[r.id] = {
    ...r,
    content_md5: createHash("md5").update(r.content || "").digest("hex"),
    content_len: (r.content || "").length,
    embedding_dims: emb ? emb.length : null,
    embedding_present: !!emb,
    embedding: emb,
  };
  console.log(`${r.id} md5=${out[r.id].content_md5} len=${out[r.id].content_len} emb_present=${out[r.id].embedding_present}(${out[r.id].embedding_dims}d) source_type=${r.source_type} provider=${r.source_provider} usable_as=${r.metadata?.usable_as} last_verified_at=${r.last_verified_at}`);
}
const path = join(import.meta.dirname, "../../.local-backups/factual-correction-backup.json");
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`\nsaved ${path}  (${Object.keys(out).length} rows)`);
