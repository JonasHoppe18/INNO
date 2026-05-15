import { assertEquals } from "jsr:@std/assert@1";
import { buildRetrievalLogPayload } from "./retrieval-log.ts";

Deno.test("buildRetrievalLogPayload truncates chunk content to 600 chars", () => {
  const longContent = "x".repeat(800);
  const result = buildRetrievalLogPayload(
    "thread-1",
    [{ id: "c1", content: longContent, source_label: "Policy", similarity: 0.9, kind: "policy", usable_as: "policy", risk_flags: [] }],
    [],
  );
  const parsed = JSON.parse(result.step_detail);
  assertEquals(parsed.kb_chunks[0].content.length, 600);
});

Deno.test("buildRetrievalLogPayload caps at 8 chunks", () => {
  const chunks = Array.from({ length: 12 }, (_, i) => ({
    id: `c${i}`, content: "hello", source_label: "X", similarity: 0.8,
    kind: "policy", usable_as: "policy" as const, risk_flags: [],
  }));
  const result = buildRetrievalLogPayload("thread-1", chunks, []);
  const parsed = JSON.parse(result.step_detail);
  assertEquals(parsed.kb_chunks.length, 8);
});

Deno.test("buildRetrievalLogPayload caps ticket_examples at 3", () => {
  const tickets = Array.from({ length: 5 }, (_, i) => ({
    customer_msg: "msg", agent_reply: "reply",
    subject: `Ticket ${i}`, score: 0.8,
    csat_score: null, conversation_context: null,
  }));
  const result = buildRetrievalLogPayload("thread-1", [], tickets);
  const parsed = JSON.parse(result.step_detail);
  assertEquals(parsed.ticket_examples.length, 3);
});

Deno.test("buildRetrievalLogPayload truncates customer_msg to 400 chars", () => {
  const longMsg = "y".repeat(600);
  const tickets = [{ customer_msg: longMsg, agent_reply: "reply", subject: null, score: 0.7, csat_score: null, conversation_context: null }];
  const result = buildRetrievalLogPayload("thread-1", [], tickets);
  const parsed = JSON.parse(result.step_detail);
  assertEquals(parsed.ticket_examples[0].customer_msg.length, 400);
});
