import { assertEquals } from "jsr:@std/assert@1";
import {
  buildRetrievalCandidateDiagnostics,
  buildRetrievalCandidateDiagnosticsBestEffort,
  type RetrievedChunk,
} from "./retriever.ts";

function row(id: string | number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content: "short diagnostic fixture content that must not be copied",
    source_type: "manual_text",
    source_provider: "manual_text",
    similarity: 0.82,
    metadata: {
      title: "Dongle pairing guide",
      question: "How do I pair the dongle?",
      products: ["a-spire wireless"],
      issue_types: ["connectivity"],
      usable_as: "procedure",
    },
    ...overrides,
  };
}

function chunk(
  id: string | number,
  overrides: Partial<RetrievedChunk> = {},
): RetrievedChunk {
  return {
    id: String(id),
    content: "selected chunk excerpt content",
    kind: "manual_text",
    source_label: "manual_text: Dongle pairing guide",
    similarity: 0.5,
    usable_as: "procedure",
    risk_flags: [],
    applies_to_all_products: false,
    chunk_issue_types: ["connectivity"],
    source_title: "Dongle pairing guide",
    source_provider: "knowledge_document",
    document_category: "product_support",
    document_type: "product_support",
    products: ["a-spire wireless"],
    vector_similarity: 0.82,
    question: "How do I pair the dongle?",
    ...overrides,
  };
}

Deno.test("buildRetrievalCandidateDiagnostics stores raw ranks, RRF score, score breakdown, and matcher state", () => {
  const c1 = chunk(9007199254740993n.toString(), { similarity: 0.4 });
  const c2 = chunk("42", { similarity: 0.3, usable_as: "policy" });
  const diagnostics = buildRetrievalCandidateDiagnostics({
    plannerQueries: ["planner query"],
    fallbackQueries: [{ text: "fallback query", productAgnostic: true }],
    queryDefs: [
      { text: "planner query", productAgnostic: false },
      { text: "fallback query", productAgnostic: true },
    ],
    queryPairs: [
      {
        vector: [
          row(c1.id, { similarity: 0.91 }),
          row(c2.id, { similarity: 0.7 }),
        ],
        bm25: [row(c2.id, { similarity: undefined })],
      },
      {
        vector: [],
        bm25: [row(c1.id, { similarity: undefined })],
      },
    ],
    fusedRaw: [
      { id: c1.id, score: 0.032, vectorSimilarity: 0.91, chunk: row(c1.id) },
      { id: c2.id, score: 0.028, vectorSimilarity: 0.7, chunk: row(c2.id) },
    ],
    scoredChunks: [c1, c2],
    candidatesPostDedupe: [c1, c2],
    matcherPool: [c1, c2],
    matcherDebug: {
      candidates: [{
        id: c1.id,
        source_id: null,
        title: "Dongle pairing guide",
      }],
      ranked: [{
        id: c1.id,
        source_id: null,
        title: "Dongle pairing guide",
        relevance: 1,
      }],
      selected_ids: [c1.id],
      abstained: false,
      fell_back: false,
    },
    finalChunks: [c1],
    scoreBreakdown: (candidate) => ({
      base_score: candidate.similarity,
      product_boost: 0.1,
      issue_type_boost: 0.06,
      lexical_issue_boost: 0.02,
      product_support_doc_boost: 0,
      general_policy_boost: 0,
      power_reset_boost: 0,
      source_type_boost: 0.04,
      usable_as_boost: candidate.usable_as === "policy" ? 0.02 : 0,
      cross_product_penalty: 0,
      final_score: candidate.similarity + 0.22,
    }),
  });

  assertEquals(diagnostics.planner_queries, ["planner query"]);
  assertEquals(diagnostics.fallback_queries, [
    { query: "fallback query", product_agnostic: true },
  ]);
  assertEquals(diagnostics.query_results[0].chunk_id, c1.id);
  assertEquals(typeof diagnostics.query_results[0].chunk_id, "string");
  assertEquals(diagnostics.query_results[0].raw_rank, 1);
  assertEquals(diagnostics.query_results[0].raw_score, 0.91);
  assertEquals(diagnostics.query_results[0].usable_as, "procedure");
  assertEquals(diagnostics.query_results[0].title, "Dongle pairing guide");
  assertEquals(
    diagnostics.query_results[0].question,
    "How do I pair the dongle?",
  );
  assertEquals(diagnostics.query_results[0].products, ["a-spire wireless"]);
  assertEquals(diagnostics.query_results[0].issue_types, ["connectivity"]);

  assertEquals(diagnostics.merged_candidates_pre_score[0], {
    chunk_id: c1.id,
    vector_rank: 1,
    bm25_rank: 1,
    rrf_score: 0.032,
  });
  assertEquals(diagnostics.merged_candidates_pre_score[1], {
    chunk_id: c2.id,
    vector_rank: 2,
    bm25_rank: 1,
    rrf_score: 0.028,
  });

  assertEquals(diagnostics.scored_candidates_pre_dedupe[0], {
    chunk_id: c1.id,
    base_score: 0.4,
    product_boost: 0.1,
    issue_type_boost: 0.06,
    lexical_issue_boost: 0.02,
    product_support_doc_boost: 0,
    general_policy_boost: 0,
    power_reset_boost: 0,
    source_type_boost: 0.04,
    usable_as_boost: 0,
    cross_product_penalty: 0,
    final_score: 0.62,
  });
  assertEquals(diagnostics.candidates_post_dedupe, [c1.id, c2.id]);
  assertEquals(diagnostics.matcher_pool_top15, [c1.id, c2.id]);
  assertEquals(diagnostics.matcher_selected_ids, [c1.id]);
  assertEquals(diagnostics.matcher_abstain, false);
  assertEquals(diagnostics.final_selected_ids, [c1.id]);
  assertEquals(diagnostics.final_chunks[0], {
    id: c1.id,
    title: "Dongle pairing guide",
    usable_as: "procedure",
    source_type: "manual_text",
    source_provider: "knowledge_document",
    category: "product_support",
    document_category: "product_support",
    document_type: "product_support",
    score: 0.4,
    base_score: 0.4,
    final_score: 0.62,
    vector_similarity: 0.82,
    excerpt: "selected chunk excerpt content",
    selected_by_policy_fallback: false,
    fallback_ranking_score: null,
    fallback_overlap_reason: null,
  });
});

Deno.test("buildRetrievalCandidateDiagnostics stores only short final chunk excerpts", () => {
  const c = chunk("1", {
    content: "short excerpt start " + "x".repeat(200) +
      " unique-tail-that-must-not-appear",
  });
  const diagnostics = buildRetrievalCandidateDiagnostics({
    plannerQueries: [],
    fallbackQueries: [],
    queryDefs: [{ text: "query", productAgnostic: false }],
    queryPairs: [{ vector: [row("1")], bm25: [] }],
    fusedRaw: [{
      id: "1",
      score: 0.01,
      vectorSimilarity: 0.9,
      chunk: row("1"),
    }],
    scoredChunks: [c],
    candidatesPostDedupe: [c],
    matcherPool: [c],
    finalChunks: [c],
    scoreBreakdown: () => ({
      base_score: 0,
      product_boost: 0,
      issue_type_boost: 0,
      lexical_issue_boost: 0,
      product_support_doc_boost: 0,
      general_policy_boost: 0,
      power_reset_boost: 0,
      source_type_boost: 0,
      usable_as_boost: 0,
      cross_product_penalty: 0,
      final_score: 0,
    }),
  });

  assertEquals(
    JSON.stringify(diagnostics).includes("short excerpt start"),
    true,
  );
  assertEquals(
    JSON.stringify(diagnostics).includes("unique-tail-that-must-not-appear"),
    false,
  );
  assertEquals(
    JSON.stringify(diagnostics).includes("short diagnostic fixture content"),
    false,
  );
});

Deno.test("buildRetrievalCandidateDiagnostics serializes fallback final chunk audit fields", () => {
  const c = chunk("fb-1", {
    content: "Warranty claims require proof of purchase and issue evidence.",
    source_title: "Warranty claims",
    source_label: "knowledge_document: Warranty claims",
    similarity: 0.42,
    vector_similarity: 0.77,
    usable_as: "policy",
    kind: "document",
  });
  const diagnostics = buildRetrievalCandidateDiagnostics({
    plannerQueries: ["warranty claim procedure"],
    fallbackQueries: [],
    queryDefs: [{ text: "warranty claim procedure", productAgnostic: false }],
    queryPairs: [{ vector: [row("fb-1")], bm25: [] }],
    fusedRaw: [{
      id: "fb-1",
      score: 0.42,
      vectorSimilarity: 0.77,
      chunk: row("fb-1"),
    }],
    scoredChunks: [c],
    candidatesPostDedupe: [c],
    matcherPool: [c],
    matcherDebug: {
      candidates: [{ id: c.id, source_id: null, title: "Warranty claims" }],
      ranked: [],
      selected_ids: [c.id],
      abstained: true,
      fell_back: false,
      policy_fallback: true,
      policy_fallback_count: 1,
      policy_fallback_score_basis: "retrieval_score_plus_lexical_intent",
      policy_fallback_details: [{
        chunk_id: c.id,
        ranking_score: 0.5,
        overlap_reason: "title_question:2",
        title_question_overlap: 2,
        content_overlap: 1,
        issue_tag_overlap: 0,
      }],
    },
    finalChunks: [c],
    scoreBreakdown: () => ({
      base_score: 0.42,
      product_boost: 0,
      issue_type_boost: 0,
      lexical_issue_boost: 0.04,
      product_support_doc_boost: 0,
      general_policy_boost: 0,
      power_reset_boost: 0,
      source_type_boost: 0,
      usable_as_boost: 0.02,
      cross_product_penalty: 0,
      final_score: 0.48,
    }),
  });

  assertEquals(diagnostics.final_chunks[0], {
    id: "fb-1",
    title: "Warranty claims",
    usable_as: "policy",
    source_type: "document",
    source_provider: "knowledge_document",
    category: "product_support",
    document_category: "product_support",
    document_type: "product_support",
    score: 0.42,
    base_score: 0.42,
    final_score: 0.48,
    vector_similarity: 0.77,
    excerpt: "Warranty claims require proof of purchase and issue evidence.",
    selected_by_policy_fallback: true,
    fallback_ranking_score: 0.5,
    fallback_overlap_reason: "title_question:2",
  });
});

Deno.test("product_scoring block is present when resolved products are passed", () => {
  const c1 = chunk("1", { products: ["a-spire wireless"] });
  const c2 = chunk("2", { products: ["a-spire"] });
  const diagnostics = buildRetrievalCandidateDiagnostics({
    plannerQueries: [],
    fallbackQueries: [],
    queryDefs: [{ text: "query", productAgnostic: false }],
    queryPairs: [{ vector: [row("1"), row("2")], bm25: [] }],
    fusedRaw: [
      { id: "1", score: 0.02, vectorSimilarity: 0.9, chunk: row("1") },
      { id: "2", score: 0.01, vectorSimilarity: 0.8, chunk: row("2") },
    ],
    scoredChunks: [c1, c2],
    candidatesPostDedupe: [c1, c2],
    matcherPool: [c1, c2],
    finalChunks: [c1],
    mentionedProductsResolved: ["a-spire wireless"],
    scoreBreakdown: (candidate) => ({
      base_score: candidate.similarity,
      product_boost: candidate.id === "1" ? 0.1 : 0,
      issue_type_boost: 0,
      lexical_issue_boost: 0,
      product_support_doc_boost: 0,
      general_policy_boost: 0,
      power_reset_boost: 0,
      source_type_boost: 0,
      usable_as_boost: 0,
      cross_product_penalty: candidate.id === "2" ? 0.12 : 0,
      final_score: candidate.similarity,
    }),
  });
  assertEquals(diagnostics.product_scoring?.product_match_source, "metadata");
  assertEquals(diagnostics.product_scoring?.mentioned_products_resolved, [
    "a spire wireless",
  ]);
  assertEquals(diagnostics.product_scoring?.per_chunk[0], {
    chunk_id: "1",
    chunk_products_normalized: ["a spire wireless"],
    product_boost: 0.1,
    cross_product_penalty: 0,
  });
  assertEquals(
    diagnostics.product_scoring?.per_chunk[1].cross_product_penalty,
    0.12,
  );
});

Deno.test("product_scoring block omitted when resolved products absent", () => {
  const c = chunk("1");
  const diagnostics = buildRetrievalCandidateDiagnostics({
    plannerQueries: [],
    fallbackQueries: [],
    queryDefs: [{ text: "query", productAgnostic: false }],
    queryPairs: [{ vector: [row("1")], bm25: [] }],
    fusedRaw: [{
      id: "1",
      score: 0.01,
      vectorSimilarity: 0.9,
      chunk: row("1"),
    }],
    scoredChunks: [c],
    candidatesPostDedupe: [c],
    matcherPool: [c],
    finalChunks: [c],
    scoreBreakdown: () => ({
      base_score: 0,
      product_boost: 0,
      issue_type_boost: 0,
      lexical_issue_boost: 0,
      product_support_doc_boost: 0,
      general_policy_boost: 0,
      power_reset_boost: 0,
      source_type_boost: 0,
      usable_as_boost: 0,
      cross_product_penalty: 0,
      final_score: 0,
    }),
  });
  assertEquals(diagnostics.product_scoring, undefined);
});

Deno.test("buildRetrievalCandidateDiagnosticsBestEffort does not throw", () => {
  const diagnostics = buildRetrievalCandidateDiagnosticsBestEffort(() => {
    throw new Error("diagnostics fixture failure");
  });
  assertEquals(diagnostics, undefined);
});
