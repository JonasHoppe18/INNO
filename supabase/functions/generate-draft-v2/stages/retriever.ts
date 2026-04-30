// supabase/functions/generate-draft-v2/stages/retriever.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { Plan } from "./planner.ts";

export interface RetrievedChunk {
  id: string;
  content: string;
  kind: string;
  source_label: string;
  similarity: number;
}

export interface RetrieverResult {
  chunks: RetrievedChunk[];
  past_ticket_examples: Array<{ customer_msg: string; agent_reply: string }>;
}

export interface RetrieverInput {
  plan: Plan;
  shop_id: string;
  supabase: SupabaseClient;
}

async function embedText(text: string): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });
  if (!resp.ok) throw new Error(`Embedding error: ${resp.status}`);
  const data = await resp.json();
  return data.data[0].embedding;
}

function sanitiseBm25Query(query: string): string {
  return query
    .replace(/[<>():!&|*\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

// Reciprocal Rank Fusion over multiple ranked lists.
// k=60 dampens high-rank advantage.
function rrfFusion(
  lists: Array<Array<Record<string, unknown>>>,
  k = 60,
): Array<{ id: string; score: number; chunk: Record<string, unknown> }> {
  const scores = new Map<string, { score: number; chunk: Record<string, unknown> }>();

  for (const list of lists) {
    list.forEach((item, rank) => {
      const id = item.id as string;
      const existing = scores.get(id) ?? { score: 0, chunk: item };
      existing.score += 1 / (k + rank + 1);
      existing.chunk = item;
      scores.set(id, existing);
    });
  }

  return [...scores.values()].sort((a, b) => b.score - a.score);
}

// Run vector + BM25 for a single query string. Returns two ranked lists.
async function runQueryPair(
  query: string,
  shop_id: string,
  supabase: SupabaseClient,
): Promise<{ vector: Array<Record<string, unknown>>; bm25: Array<Record<string, unknown>> }> {
  const [vectorResult, bm25Result] = await Promise.allSettled([
    (async () => {
      const embedding = await embedText(query);
      const { data, error } = await supabase.rpc("match_agent_knowledge", {
        query_embedding: embedding,
        match_count: 20,
        filter_shop_id: shop_id,
      });
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    })(),
    (async () => {
      const safeQuery = sanitiseBm25Query(query);
      if (!safeQuery) return [];
      const { data, error } = await supabase
        .from("agent_knowledge")
        .select("id, content, source_type, source_provider, metadata")
        .eq("shop_id", shop_id)
        .textSearch("content", safeQuery, { type: "websearch" })
        .limit(15);
      if (error) {
        console.warn("[retriever] BM25 search error:", error.message);
        return [];
      }
      return (data ?? []) as Array<Record<string, unknown>>;
    })(),
  ]);

  return {
    vector: vectorResult.status === "fulfilled" ? vectorResult.value : [],
    bm25: bm25Result.status === "fulfilled" ? bm25Result.value : [],
  };
}

export async function runRetriever(
  { plan, shop_id, supabase }: RetrieverInput,
): Promise<RetrieverResult> {
  const queries = plan.sub_queries.filter(Boolean).slice(0, 3);
  if (queries.length === 0) return { chunks: [], past_ticket_examples: [] };

  // Run all queries + ticket lookup in parallel
  const [queryPairs, ticketResult] = await Promise.all([
    Promise.all(queries.map((q) => runQueryPair(q, shop_id, supabase))),
    // Dedicated ticket_examples lookup via own RPC — separate vector index, typed columns
    (async () => {
      try {
        const embedding = await embedText(queries[0]);
        const intent = plan.primary_intent !== "other" ? plan.primary_intent : null;

        // Try with intent filter first — more relevant tone examples
        const { data, error } = await supabase.rpc("match_ticket_examples", {
          query_embedding: embedding,
          match_count: 3,
          filter_shop_id: shop_id,
          filter_intent: intent,
        });
        if (error) {
          console.warn("[retriever] ticket_examples lookup error:", error.message);
          return [];
        }

        // Fall back to no intent filter if shop has few labelled tickets
        if ((!data || data.length === 0) && intent) {
          const { data: fallback } = await supabase.rpc("match_ticket_examples", {
            query_embedding: embedding,
            match_count: 3,
            filter_shop_id: shop_id,
            filter_intent: null,
          });
          return (fallback ?? []) as Array<{ customer_msg: string; agent_reply: string; similarity: number }>;
        }

        return (data ?? []) as Array<{ customer_msg: string; agent_reply: string; similarity: number }>;
      } catch (err) {
        console.warn("[retriever] ticket_examples lookup failed:", err);
        return [];
      }
    })(),
  ]);

  // Fuse knowledge chunks (policies, FAQs, product info) — tickets handled separately
  const allLists: Array<Array<Record<string, unknown>>> = [];
  for (const pair of queryPairs) {
    if (pair.vector.length > 0) allLists.push(pair.vector);
    if (pair.bm25.length > 0) allLists.push(pair.bm25);
  }

  const fused = rrfFusion(allLists);

  const regularChunks: RetrievedChunk[] = fused
    .slice(0, 8)
    .map((r) => ({
      id: r.chunk.id as string,
      content: r.chunk.content as string,
      kind: (r.chunk.source_type as string) ?? "knowledge",
      source_label: (r.chunk.source_provider ?? r.chunk.source_type ?? "knowledge") as string,
      similarity: r.score,
    }));

  // Past ticket examples — directly from typed ticket_examples table
  const pastTicketExamples = ticketResult
    .filter((t) => t.agent_reply && t.agent_reply.length > 20)
    .map((t) => ({ customer_msg: t.customer_msg, agent_reply: t.agent_reply }));

  console.log(
    `[retriever] queries=${queries.length} knowledge=${regularChunks.length} past_tickets=${pastTicketExamples.length}`,
  );

  return {
    chunks: regularChunks,
    past_ticket_examples: pastTicketExamples,
  };
}
