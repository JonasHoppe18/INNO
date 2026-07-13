// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { isNearDuplicateExample } from "./retriever.ts";

const ov = (text: string, terms: string[]) =>
  terms.filter((t) => text.toLowerCase().includes(t.toLowerCase())).length;

Deno.test("same-product high-similarity example is a near-duplicate", () => {
  assert(isNearDuplicateExample({
    similarity: 0.9, exampleText: "mic clip for the A-Spire headset",
    queryProductTerms: ["a-spire"], overlap: ov, threshold: 0.86,
  }));
});

Deno.test("cross-product example is NOT a near-duplicate even at high similarity", () => {
  assertEquals(isNearDuplicateExample({
    similarity: 0.95, exampleText: "ear pads replacement",
    queryProductTerms: ["a-spire"], overlap: ov, threshold: 0.86,
  }), false);
});

Deno.test("no product named -> similarity alone promotes", () => {
  assert(isNearDuplicateExample({
    similarity: 0.88, exampleText: "our return window is 30 days",
    queryProductTerms: [], overlap: ov, threshold: 0.86,
  }));
});

Deno.test("below threshold is never a near-duplicate", () => {
  assertEquals(isNearDuplicateExample({
    similarity: 0.7, exampleText: "mic clip for the A-Spire",
    queryProductTerms: ["a-spire"], overlap: ov, threshold: 0.86,
  }), false);
});

Deno.test("NaN similarity is fail-safe false", () => {
  assertEquals(isNearDuplicateExample({
    similarity: NaN, exampleText: "x", queryProductTerms: [], overlap: ov, threshold: 0.86,
  }), false);
});
