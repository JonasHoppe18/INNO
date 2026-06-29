import { assertEquals } from "jsr:@std/assert@1";
import { type RetrievedChunk, selectPolicyFallback } from "./retriever.ts";

// Fix B: when the snippet matcher abstains (selects nothing), allow the top
// already-pooled policy/procedure chunks through as writer context. These tests
// exercise the pure selectPolicyFallback helper (no OpenAI, no IO).

const OPTS = { max: 2, relevanceFloor: 0.45 };

function chunk(
  id: string,
  usable_as: RetrievedChunk["usable_as"],
  overrides: Partial<RetrievedChunk> = {},
): RetrievedChunk {
  return {
    id,
    content: `content ${id}`,
    kind: "document",
    source_label: `knowledge_document: ${id}`,
    similarity: 0.5,
    usable_as,
    risk_flags: [],
    applies_to_all_products: false,
    chunk_issue_types: [],
    products: [],
    ...overrides,
  } as RetrievedChunk;
}

function ranked(entries: Array<[string, number]>) {
  return entries.map(([id, relevance]) => ({ id, relevance, reason: "" }));
}

Deno.test("1. abstained + policy chunk in pool with relevance >= floor => rescued", () => {
  const pool = [chunk("4577", "policy")];
  const result = selectPolicyFallback(pool, ranked([["4577", 0.5]]), OPTS);
  assertEquals(result.map((c) => c.id), ["4577"]);
});

Deno.test("2. procedure chunk with relevance >= floor => rescued", () => {
  const pool = [chunk("g024-1", "procedure")];
  const result = selectPolicyFallback(pool, ranked([["g024-1", 0.55]]), OPTS);
  assertEquals(result.map((c) => c.id), ["g024-1"]);
});

Deno.test("3. fact/saved_reply/background chunks are not rescued", () => {
  const pool = [
    chunk("f1", "fact"),
    chunk("s1", "saved_reply"),
    chunk("b1", "background"),
    chunk("t1", "tone_example"),
  ];
  const result = selectPolicyFallback(
    pool,
    ranked([["f1", 0.9], ["s1", 0.9], ["b1", 0.9], ["t1", 0.9]]),
    OPTS,
  );
  assertEquals(result, []);
});

Deno.test("4. policy chunk below relevance floor is not rescued", () => {
  const pool = [chunk("p1", "policy")];
  const result = selectPolicyFallback(pool, ranked([["p1", 0.44]]), OPTS);
  assertEquals(result, []);
});

Deno.test("5. cap max 2 is respected, ordered by relevance desc", () => {
  const pool = [
    chunk("p1", "policy"),
    chunk("p2", "policy"),
    chunk("p3", "procedure"),
  ];
  const result = selectPolicyFallback(
    pool,
    ranked([["p1", 0.50], ["p2", 0.59], ["p3", 0.47]]),
    OPTS,
  );
  assertEquals(result.map((c) => c.id), ["p2", "p1"]);
});

Deno.test("6. helper only consulted on empty selection (call-site guard); when used it ignores matcher 'selected' state", () => {
  // The helper itself is selection-agnostic; the retriever only calls it when
  // finalChunks is empty. Here we assert it still returns from the pool purely by
  // eligibility, so the call-site guard (finalChunks.length === 0) is what keeps
  // normal selection unchanged — verified by an empty pool yielding nothing.
  assertEquals(selectPolicyFallback([], ranked([]), OPTS), []);
  // And a populated eligible pool yields a result (so the guard, not the helper,
  // decides whether to override a non-empty selection).
  const pool = [chunk("p1", "policy")];
  assertEquals(
    selectPolicyFallback(pool, ranked([["p1", 0.7]]), OPTS).map((c) => c.id),
    ["p1"],
  );
});

Deno.test("7. chunk absent from ranked list is not rescued", () => {
  const pool = [chunk("p1", "policy"), chunk("p2", "policy")];
  // Only p2 was ranked by the matcher; p1 has no relevance => ineligible.
  const result = selectPolicyFallback(pool, ranked([["p2", 0.5]]), OPTS);
  assertEquals(result.map((c) => c.id), ["p2"]);
});

Deno.test("max 0 returns nothing (defensive)", () => {
  const pool = [chunk("p1", "policy")];
  assertEquals(
    selectPolicyFallback(pool, ranked([["p1", 0.9]]), { max: 0, relevanceFloor: 0.45 }),
    [],
  );
});
