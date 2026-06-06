import { assertEquals } from "jsr:@std/assert@1";
import {
  buildScoreBreakdown,
  normProduct,
  type RetrievedChunk,
} from "./retriever.ts";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: "1",
    content: "terse pointer",
    kind: "manual_text",
    source_label: "manual_text: Dongle note",
    similarity: 0.5,
    usable_as: "background",
    risk_flags: [],
    applies_to_all_products: false,
    chunk_issue_types: [],
    products: [],
    ...overrides,
  };
}

// ---- normProduct ----
Deno.test("normProduct lowercases, trims, collapses hyphen/space", () => {
  assertEquals(normProduct("A-Spire Wireless"), normProduct("a-spire   wireless"));
  assertEquals(normProduct(" A-Spire "), normProduct("a-spire"));
});

// ---- B2: metadata-based product_boost ----
Deno.test("metadata-tagged terse wireless chunk gets product boost", () => {
  const b = buildScoreBreakdown({
    chunk: chunk({ content: "see dongle", products: ["a-spire wireless"] }),
    mentionedProducts: ["a-spire wireless"],
    otherProducts: ["a-spire", "a-blaze"],
    issueTerms: [],
  });
  assertEquals(b.product_boost, 0.1);
  assertEquals(b.cross_product_penalty, 0);
});

Deno.test("body-text repetitions without metadata give NO product boost", () => {
  const verbose = "A-Spire Wireless ".repeat(8);
  const b = buildScoreBreakdown({
    chunk: chunk({ content: verbose, products: [] }),
    mentionedProducts: ["a-spire wireless"],
    otherProducts: ["a-spire", "a-blaze"],
    issueTerms: [],
  });
  assertEquals(b.product_boost, 0);
});

Deno.test("body-text repetitions do not inflate boost beyond single metadata match", () => {
  const verbose = "A-Spire Wireless ".repeat(8);
  const b = buildScoreBreakdown({
    chunk: chunk({ content: verbose, products: ["a-spire wireless"] }),
    mentionedProducts: ["a-spire wireless"],
    otherProducts: ["a-spire", "a-blaze"],
    issueTerms: [],
  });
  assertEquals(b.product_boost, 0.1);
});

// ---- B2: cross_product_penalty from metadata ----
Deno.test("wired chunk gets cross-product penalty on wireless query", () => {
  const b = buildScoreBreakdown({
    // metadata says a-spire (wired); customer asked about a-spire wireless
    chunk: chunk({
      content: "A-Spire does not come with a wireless Dongle",
      products: ["a-spire"],
    }),
    mentionedProducts: ["a-spire wireless"],
    otherProducts: ["a-spire", "a-blaze"],
    issueTerms: [],
  });
  assertEquals(b.product_boost, 0);
  assertEquals(b.cross_product_penalty, 0.12);
});

Deno.test("no penalty when query mentions multiple products", () => {
  const b = buildScoreBreakdown({
    chunk: chunk({ products: ["a-spire"] }),
    mentionedProducts: ["a-spire wireless", "a-blaze"],
    otherProducts: [],
    issueTerms: [],
  });
  assertEquals(b.cross_product_penalty, 0);
});

Deno.test("applies_to_all_products chunk gets general boost and no penalty", () => {
  const b = buildScoreBreakdown({
    chunk: chunk({ applies_to_all_products: true, products: [] }),
    mentionedProducts: ["a-spire wireless"],
    otherProducts: ["a-spire", "a-blaze"],
    issueTerms: [],
  });
  assertEquals(b.product_boost, 0.05);
  assertEquals(b.cross_product_penalty, 0);
});

// ---- B2: documented scenario — correct terse chunk beats wrong wired chunk ----
Deno.test("correctly-tagged terse chunk ranks above wrong wired chunk", () => {
  // gold-like: 3948 terse, correct metadata, equal base similarity
  const correct = buildScoreBreakdown({
    chunk: chunk({
      id: "3948",
      content: "Dongle doesn't connect to headset",
      products: ["a-spire wireless"],
      similarity: 0.5,
    }),
    mentionedProducts: ["a-spire wireless"],
    otherProducts: ["a-spire", "a-blaze"],
    issueTerms: [],
  });
  // wrong: 3708 wired, verbose, repeats brand name but wrong metadata
  const wrong = buildScoreBreakdown({
    chunk: chunk({
      id: "3708",
      content: "A-Spire Wireless A-Spire Wireless does not come with a Dongle",
      products: ["a-spire"],
      similarity: 0.5,
    }),
    mentionedProducts: ["a-spire wireless"],
    otherProducts: ["a-spire", "a-blaze"],
    issueTerms: [],
  });
  assertEquals(correct.final_score > wrong.final_score, true);
});

// ---- B2: other score components preserved ----
Deno.test("issue/source/usable boosts unchanged by product-source switch", () => {
  const b = buildScoreBreakdown({
    chunk: chunk({
      content: "x",
      products: ["a-spire wireless"],
      chunk_issue_types: ["connectivity"],
      usable_as: "saved_reply",
      kind: "manual_text",
      source_label: "manual_text: note",
    }),
    mentionedProducts: ["a-spire wireless"],
    otherProducts: [],
    issueTerms: ["connectivity"],
  });
  assertEquals(b.issue_type_boost, 0.06);
  assertEquals(b.source_type_boost, 0.04);
  assertEquals(b.usable_as_boost, 0.06);
});
