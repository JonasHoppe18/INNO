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

// Sanitise query for Postgres websearch_to_tsquery — remove special operators
// that could cause syntax errors in ts_query
function sanitiseBm25Query(query: string): string {
  return query
    .replace(/[<>():!&|*\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

// Reciprocal Rank Fusion over two ranked lists.
// k=60 is the standard constant that dampens high-rank advantage.
function rrfFusion(
  vectorList: Array<Record<string, unknown>>,
  bm25List: Array<Record<string, unknown>>,
  k = 60,
): Array<{ id: string; score: number; chunk: Record<string, unknown> }> {
  const scores = new Map<string, { score: number; chunk: Record<string, unknown> }>();

  const addList = (list: Array<Record<string, unknown>>) => {
    list.forEach((item, rank) => {
      const id = item.id as string;
      const existing = scores.get(id) ?? { score: 0, chunk: item };
      existing.score += 1 / (k + rank + 1);
      existing.chunk = item; // keep latest (same data anyway)
      scores.set(id, existing);
    });
  };

  addList(vectorList);
  addList(bm25List);

  return [...scores.values()].sort((a, b) => b.score - a.score);
}

export async function runRetriever(
  { plan, shop_id, supabase }: RetrieverInput,
): Promise<RetrieverResult> {
  const query = plan.sub_queries[0] ?? "";
  if (!query) return { chunks: [], past_ticket_examples: [] };

  // 1. Vector search + BM25 in parallel
  const [vectorResult, bm25Result] = await Promise.allSettled([
    (async () => {
      const embedding = await embedText(query);
      const { data, error } = await supabase.rpc("match_agent_knowledge", {
        query_embedding: embedding,
        match_count: 25,
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
        .limit(20);
      if (error) {
        console.warn("[retriever] BM25 search error:", error.message);
        return [];
      }
      return (data ?? []) as Array<Record<string, unknown>>;
    })(),
  ]);

  const vectorChunks = vectorResult.status === "fulfilled" ? vectorResult.value : [];
  const bm25Chunks = bm25Result.status === "fulfilled" ? bm25Result.value : [];

  if (vectorResult.status === "rejected") {
    console.error("[retriever] Vector search failed:", vectorResult.reason);
  }

  // 2. Fuse with RRF
  const fused = rrfFusion(vectorChunks, bm25Chunks);

  // 3. Split: past tickets (few-shot) vs regular knowledge
  const pastTicketFused = fused
    .filter((r) => r.chunk.source_type === "ticket" && (r.chunk.similarity as number ?? 0) > 0.45)
    .slice(0, 3);

  const regularFused = fused
    .filter((r) => r.chunk.source_type !== "ticket")
    .slice(0, 8);

  const regularChunks: RetrievedChunk[] = regularFused.map((r) => ({
    id: r.chunk.id as string,
    content: r.chunk.content as string,
    kind: (r.chunk.source_type as string) ?? "knowledge",
    source_label: (r.chunk.source_provider ?? r.chunk.source_type ?? "knowledge") as string,
    similarity: r.score,
  }));

  // 4. Past ticket examples — nyt format: customer_msg i metadata, agent reply i content
  //    Bagudkompatibelt med gammel Q:/A: format
  const pastTicketExamples = pastTicketFused
    .map((r) => {
      const c = r.chunk;
      const metadata = (c.metadata as Record<string, string>) ?? {};
      const content = (c.content as string) ?? "";
      if (metadata.customer_msg) {
        return { customer_msg: metadata.customer_msg, agent_reply: content };
      }
      const aIndex = content.indexOf("\n\nA: ");
      if (aIndex !== -1) {
        const customerPart = content.slice(0, aIndex).replace(/^Q:\s*/i, "").trim();
        const agentPart = content.slice(aIndex + 5).trim();
        return { customer_msg: customerPart, agent_reply: agentPart };
      }
      return { customer_msg: "", agent_reply: content };
    })
    .filter((t) => t.agent_reply.length > 20);

  return {
    chunks: regularChunks,
    past_ticket_examples: pastTicketExamples,
  };
}
