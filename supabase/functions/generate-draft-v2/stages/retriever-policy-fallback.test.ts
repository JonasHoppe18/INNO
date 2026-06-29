import { assertEquals } from "jsr:@std/assert@1";
import { type RetrievedChunk, selectPolicyFallback } from "./retriever.ts";

// Fix B.2: when the snippet matcher abstains (selects nothing), allow the top
// already-pooled policy/procedure chunks through, gated on RETRIEVAL score
// (chunk.similarity) relative to the strongest pool candidate — NOT matcher
// relevance (which de-ranks guardrail chunks by design). Pure helper: no OpenAI.

const OPTS = { max: 2, scoreRatio: 0.6 };

function chunk(
  id: string,
  usable_as: RetrievedChunk["usable_as"],
  similarity: number,
): RetrievedChunk {
  return {
    id,
    content: `content ${id}`,
    kind: "document",
    source_label: `knowledge_document: ${id}`,
    similarity,
    usable_as,
    risk_flags: [],
    applies_to_all_products: false,
    chunk_issue_types: [],
    products: [],
  } as RetrievedChunk;
}

Deno.test("1. policy chunk with strong retrieval score is rescued (no matcher relevance needed)", () => {
  // Top pool score 0.80; policy at 0.78 clears 0.60*0.80=0.48. No ranked/relevance
  // input exists at all — the helper does not depend on it.
  const pool = [chunk("x-1", "fact", 0.80), chunk("4576", "policy", 0.78)];
  const result = selectPolicyFallback(pool, OPTS);
  assertEquals(result.map((c) => c.id), ["4576"]);
});

Deno.test("2. policy chunk rescued on strong retrieval score even though matcher de-ranked it", () => {
  // The fact that the matcher abstained (would have scored this low) is irrelevant
  // here — eligibility is purely retrieval score. Top=0.70, floor=0.42, policy=0.69.
  const pool = [chunk("top", "fact", 0.70), chunk("p1", "policy", 0.69)];
  assertEquals(selectPolicyFallback(pool, OPTS).map((c) => c.id), ["p1"]);
});

Deno.test("3. procedure chunk with strong retrieval score is rescued", () => {
  const pool = [chunk("g024", "procedure", 0.66), chunk("o", "background", 0.70)];
  // top=0.70, floor=0.42, procedure 0.66 >= floor.
  assertEquals(selectPolicyFallback(pool, OPTS).map((c) => c.id), ["g024"]);
});

Deno.test("4. policy/procedure chunk below the relative floor is not rescued", () => {
  // top=0.90, floor=0.54; policy at 0.50 is below floor.
  const pool = [chunk("strong", "fact", 0.90), chunk("weak-policy", "policy", 0.50)];
  assertEquals(selectPolicyFallback(pool, OPTS), []);
});

Deno.test("5. fact/saved_reply/background/tone_example are never rescued, even with high score", () => {
  const pool = [
    chunk("f", "fact", 0.99),
    chunk("s", "saved_reply", 0.98),
    chunk("b", "background", 0.97),
    chunk("t", "tone_example", 0.96),
  ];
  assertEquals(selectPolicyFallback(pool, OPTS), []);
});

Deno.test("6. cap max 2, ordered by retrieval score desc", () => {
  const pool = [
    chunk("p1", "policy", 0.70),
    chunk("p2", "policy", 0.85),
    chunk("p3", "procedure", 0.80),
    chunk("p4", "policy", 0.78),
  ];
  // top=0.85, floor=0.51; all four clear it; top two by score = p2(0.85), p3(0.80).
  assertEquals(selectPolicyFallback(pool, OPTS).map((c) => c.id), ["p2", "p3"]);
});

Deno.test("7. helper is selection-agnostic; call-site guard keeps normal selection unchanged", () => {
  // The retriever only invokes the helper when finalChunks is empty. The helper
  // itself just reads the pool; an empty pool yields nothing.
  assertEquals(selectPolicyFallback([], OPTS), []);
  const pool = [chunk("p1", "policy", 0.7)];
  assertEquals(selectPolicyFallback(pool, OPTS).map((c) => c.id), ["p1"]);
});

Deno.test("8. no chunks outside the supplied pool are introduced", () => {
  const pool = [chunk("p1", "policy", 0.7), chunk("p2", "procedure", 0.65)];
  const result = selectPolicyFallback(pool, OPTS);
  const poolIds = new Set(pool.map((c) => c.id));
  for (const c of result) assertEquals(poolIds.has(c.id), true);
});

Deno.test("empty / non-positive scores yield nothing (defensive)", () => {
  assertEquals(selectPolicyFallback([chunk("p", "policy", 0)], OPTS), []);
  assertEquals(
    selectPolicyFallback([chunk("p", "policy", 0.9)], { max: 0, scoreRatio: 0.6 }),
    [],
  );
});
