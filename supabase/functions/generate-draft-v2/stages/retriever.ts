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

  // source_type === "ticket" = historiske supporttickets brugt til few-shot
  // Alle andre source_types (document, snippet) er regular knowledge
  const pastTicketChunks = allChunks
    .filter((c) => c.source_type === "ticket" && (c.similarity as number) > 0.5)
    .slice(0, 3);

  const regularChunks: RetrievedChunk[] = allChunks
    .filter((c) => c.source_type !== "ticket")
    .slice(0, 8)
    .map((c) => ({
      id: c.id as string,
      content: c.content as string,
      kind: (c.source_type as string) ?? "knowledge",
      source_label: (c.source_provider ?? c.source_type ?? "knowledge") as string,
      similarity: c.similarity as number,
    }));

  // past_tickets: content = agent reply, metadata.customer_msg = kunde-besked
  // Ældre imports kan have Q:/A: format i content — vi parser begge formater
  const pastTicketExamples = pastTicketChunks
    .map((c) => {
      const metadata = (c.metadata as Record<string, string>) ?? {};
      const content = (c.content as string) ?? "";
      // Nyt format: customer_msg i metadata, agent reply i content
      if (metadata.customer_msg) {
        return { customer_msg: metadata.customer_msg, agent_reply: content };
      }
      // Gammelt format: "Q: ...\n...\n\nA: ..."
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
