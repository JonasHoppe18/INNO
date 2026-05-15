import type { RetrievedChunk, RetrieverResult } from "./retriever.ts";

export interface RetrievalLogPayload {
  step_name: "retrieval_completed";
  step_detail: string;
  status: "info";
}

export function buildRetrievalLogPayload(
  thread_id: string,
  chunks: RetrievedChunk[],
  ticket_examples: RetrieverResult["past_ticket_examples"],
): RetrievalLogPayload {
  return {
    step_name: "retrieval_completed",
    status: "info",
    step_detail: JSON.stringify({
      thread_id,
      kb_chunks: chunks.slice(0, 8).map((c) => ({
        id: c.id,
        // title aliased from source_label for UI display
        title: c.source_label,
        content: c.content.slice(0, 600),
        score: c.similarity,
        usable_as: c.usable_as,
        kind: c.kind,
      })),
      ticket_examples: ticket_examples.slice(0, 3).map((t) => ({
        subject: t.subject ?? null,
        score: t.score,
        customer_msg: t.customer_msg.slice(0, 400),
        agent_reply: t.agent_reply.slice(0, 600),
      })),
    }),
  };
}
