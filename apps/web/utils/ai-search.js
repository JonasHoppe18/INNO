import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service config missing.");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function embedQuery(query) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing.");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: query,
      model: OPENAI_EMBEDDING_MODEL,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.error?.message || `OpenAI returned ${res.status}`;
    throw new Error(message);
  }
  const vector = json?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("Embedding not returned.");
  return vector;
}

export async function findRelevantProducts(query, shopId) {
  const supabase = createServiceClient();
  const embedding = await embedQuery(query);
  const { data, error } = await supabase.rpc("match_products", {
    query_embedding: embedding,
    match_threshold: 0.2,
    match_count: 5,
    filter_shop_id: shopId,
  });
  if (error) throw error;
  if (!Array.isArray(data) || !data.length) return "";
  return data
    .map((item) => {
      const price = item.price ? `Price: ${item.price}` : "";
      return `Product: ${item.title}. ${price} Details: ${item.description || ""}`;
    })
    .join("\n");
}
