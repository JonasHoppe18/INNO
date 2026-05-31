import { assertEquals } from "jsr:@std/assert@1";
import { resolveKnowledgeBudget } from "./retriever-coherence.ts";

Deno.test("complaint keeps budget 2", () => {
  assertEquals(resolveKnowledgeBudget("complaint", null), 2);
});

Deno.test("technical_support keeps budget 2", () => {
  assertEquals(resolveKnowledgeBudget("technical_support", null), 2);
});

Deno.test("product_question defaults to 4 when no override", () => {
  assertEquals(resolveKnowledgeBudget("product_question", null), 4);
});

Deno.test("product_question override applies only to that intent", () => {
  assertEquals(resolveKnowledgeBudget("product_question", 2), 2);
  assertEquals(resolveKnowledgeBudget("product_question", 3), 3);
});

Deno.test("override does not affect non-product_question intents", () => {
  assertEquals(resolveKnowledgeBudget("complaint", 3), 2);
  assertEquals(resolveKnowledgeBudget("refund", 3), 4);
});

Deno.test("invalid override is ignored", () => {
  assertEquals(resolveKnowledgeBudget("product_question", 0), 4);
  assertEquals(resolveKnowledgeBudget("product_question", -1), 4);
});

import { applyAbsoluteFloor } from "./retriever-coherence.ts";

const chunk = (vs: number | null) =>
  ({ id: "x", vector_similarity: vs } as unknown as Parameters<typeof applyAbsoluteFloor>[0][number]);

Deno.test("null threshold leaves list unchanged", () => {
  const list = [chunk(0.1), chunk(0.05)];
  assertEquals(applyAbsoluteFloor(list, null).length, 2);
});

Deno.test("best below threshold drops whole block", () => {
  const list = [chunk(0.12), chunk(0.05)];
  assertEquals(applyAbsoluteFloor(list, 0.30), []);
});

Deno.test("best at/above threshold keeps list", () => {
  const list = [chunk(0.45), chunk(0.10)];
  assertEquals(applyAbsoluteFloor(list, 0.30).length, 2);
});

Deno.test("best with null vector_similarity drops block", () => {
  const list = [chunk(null), chunk(0.9)];
  assertEquals(applyAbsoluteFloor(list, 0.30), []);
});

Deno.test("empty list stays empty", () => {
  assertEquals(applyAbsoluteFloor([], 0.30), []);
});

import { applyIssueTiebreak } from "./retriever-coherence.ts";

const ic = (id: string, issues: string[]) =>
  ({ id, chunk_issue_types: issues });

Deno.test("exactly one issue-match collapses to that chunk", () => {
  const list = [ic("a", ["audio"]), ic("b", ["firmware"]), ic("c", ["pairing"])];
  const out = applyIssueTiebreak(list, ["firmware"]);
  assertEquals(out.length, 1);
  assertEquals(out[0].id, "b");
});

Deno.test("two issue-matches leave list unchanged", () => {
  const list = [ic("a", ["firmware"]), ic("b", ["firmware"]), ic("c", ["pairing"])];
  assertEquals(applyIssueTiebreak(list, ["firmware"]).length, 3);
});

Deno.test("zero issue-matches leave list unchanged", () => {
  const list = [ic("a", ["audio"]), ic("b", ["battery"])];
  assertEquals(applyIssueTiebreak(list, ["firmware"]).length, 2);
});

Deno.test("single-element list is never collapsed further", () => {
  const list = [ic("a", ["firmware"])];
  assertEquals(applyIssueTiebreak(list, ["firmware"]).length, 1);
});

Deno.test("empty issue terms leave list unchanged", () => {
  const list = [ic("a", ["audio"]), ic("b", ["firmware"])];
  assertEquals(applyIssueTiebreak(list, []).length, 2);
});

import { consolidateDominantSource } from "./retriever-coherence.ts";

const sc = (id: string, sourceId: string | null, score: number) =>
  ({ id, source_id: sourceId, similarity: score });

Deno.test("all null source_id leaves list unchanged", () => {
  const list = [sc("a", null, 0.08), sc("b", null, 0.07), sc("c", null, 0.06)];
  assertEquals(consolidateDominantSource(list).length, 3);
});

Deno.test("dominant multi-chunk guide wins and drops others", () => {
  const list = [
    sc("a", "guide-1", 0.08),
    sc("b", "guide-1", 0.07),
    sc("c", "guide-2", 0.06),
    sc("d", null, 0.05),
  ];
  const out = consolidateDominantSource(list);
  assertEquals(out.map((c) => c.id), ["a", "b"]);
});

Deno.test("single-chunk groups never consolidate", () => {
  const list = [sc("a", "guide-1", 0.08), sc("b", "guide-2", 0.07)];
  assertEquals(consolidateDominantSource(list).length, 2);
});

Deno.test("tie between two multi-chunk groups leaves list unchanged", () => {
  const list = [
    sc("a", "guide-1", 0.06),
    sc("b", "guide-1", 0.06),
    sc("c", "guide-2", 0.06),
    sc("d", "guide-2", 0.06),
  ];
  assertEquals(consolidateDominantSource(list).length, 4);
});

Deno.test("consolidate empty list stays empty", () => {
  assertEquals(consolidateDominantSource([]).length, 0);
});
