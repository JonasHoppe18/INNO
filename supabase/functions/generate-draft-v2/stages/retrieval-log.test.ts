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
