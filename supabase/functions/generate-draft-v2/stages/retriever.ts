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

export async function runRetriever(
  { plan, shop_id, supabase }: RetrieverInput,
): Promise<RetrieverResult> {
  const query = plan.sub_queries[0] ?? "";
  if (!query) return { chunks: [], past_ticket_examples: [] };

  let embedding: number[];
  try {
    embedding = await embedText(query);
  } catch (err) {
    console.error("[retriever] Embedding failed:", err);
    return { chunks: [], past_ticket_examples: [] };
  }

  const { data: rawChunks, error } = await supabase.rpc(
    "match_agent_knowledge",
    {
      query_embedding: embedding,
      match_count: 20,
      filter_shop_id: shop_id,
    },
  );

  if (error) {
    console.error("[retriever] match_agent_knowledge error:", error);
    return { chunks: [], past_ticket_examples: [] };
  }

  const allChunks = (rawChunks ?? []) as Array<Record<string, unknown>>;

  // Separate past_ticket chunks (for few-shot) from regular knowledge
  const pastTicketChunks = allChunks
    .filter((c) => c.kind === "past_ticket" && (c.similarity as number) > 0.5)
    .slice(0, 3);

  const regularChunks: RetrievedChunk[] = allChunks
    .filter((c) => c.kind !== "past_ticket")
    .slice(0, 8)
    .map((c) => ({
      id: c.id as string,
      content: c.content as string,
      kind: c.kind as string,
      source_label: (c.provider ?? c.kind ?? "knowledge") as string,
      similarity: c.similarity as number,
    }));

  // Extract few-shot pairs from past_ticket chunks
  // past_tickets store the agent reply as content, and customer_msg in metadata
  const pastTicketExamples = pastTicketChunks
    .map((c) => {
      const metadata = (c.metadata as Record<string, string>) ?? {};
      return {
        customer_msg: metadata.customer_msg ?? "",
        agent_reply: (c.content as string) ?? "",
      };
    })
    .filter((t) => t.agent_reply.length > 20);

  return {
    chunks: regularChunks,
    past_ticket_examples: pastTicketExamples,
  };
}
