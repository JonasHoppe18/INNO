import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  combineHybrid,
  embedTexts,
  rowToLexicalHit,
  searchSemantic,
} from "../../apps/web/lib/greenfield-support/retrieval-experiment.mjs";

const WORKSPACE_ID = "48d4d494-b09c-49ba-920c-b9441204b87f";
const ENV_FILE = resolve(process.cwd(), "apps/web/.env.development.local");

const QUERIES = [
  {
    text: "Can I return my headset after opening the package",
    expectedSources: new Set(["acezone-support"]),
  },
  {
    text: "How long is the warranty in the EU",
    expectedSources: new Set(["acezone-support"]),
  },
  {
    text: "When will my order arrive",
    expectedSources: new Set(),
  },
  {
    text: "Is the A-Blaze compatible with PlayStation 5",
    expectedSources: new Set(["acezone-a-blaze"]),
  },
  {
    text: "Can I use the A-Rise wirelessly for competitive gaming",
    expectedSources: new Set(["acezone-a-rise"]),
  },
  {
    text: "What should I do if my headset is broken",
    expectedSources: new Set(["acezone-faq", "acezone-support"]),
  },
  {
    text: "What is AceZone focused on",
    expectedSources: new Set(["acezone-about"]),
  },
];

const NEGATIVE_QUERIES = [
  {
    text: "Does AceZone ship to Japan?",
    expectedSources: new Set(),
  },
  {
    text: "Can I return an A-Blaze after 90 days?",
    expectedSources: new Set(),
  },
  {
    text: "Does A-Spire Wireless support PlayStation 6?",
    expectedSources: new Set(),
  },
];

function loadEnvFile(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const rawValue = match[2].trim();
    process.env[match[1]] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
}

function asRecordRows(data, label) {
  if (!Array.isArray(data)) throw new Error(`${label} did not return an array.`);
  return data;
}

function elapsed(startedAt) {
  return Math.round(performance.now() - startedAt);
}

async function searchLexical(serviceClient, query) {
  const startedAt = performance.now();
  const { data, error } = await serviceClient.rpc("greenfield_search_knowledge", {
    p_workspace_id: WORKSPACE_ID,
    p_query: query,
    p_knowledge_types: null,
    p_limit: Number(process.env.GREENFIELD_BAKEOFF_TOP_K || 5),
  });
  if (error) throw new Error(error.message);
  return {
    hits: (Array.isArray(data) ? data : []).map(rowToLexicalHit),
    durationMs: elapsed(startedAt),
  };
}

function excerpt(value, maxLength = 300) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function provenance(hit) {
  return `${hit.record.sourceKind}/${hit.record.sourceId}${hit.record.sourceUri ? ` (${hit.record.sourceUri})` : ""}`;
}

function labelHit(hit, expectedSources) {
  if (!hit) return "NO RESULT";
  if (expectedSources.has(hit.record.sourceId)) return "GOOD";
  if (!expectedSources.size) return "IRRELEVANT";
  return "PARTIAL";
}

function printHits(strategy, resultHits, expectedSources, compact = false) {
  console.log(`  ${strategy}: ${resultHits.length ? "" : "NO RESULT"}`);
  (compact ? resultHits.slice(0, 1) : resultHits).forEach((hit, index) => {
    const score = Number(hit.score ?? 0).toFixed(6);
    const chunk = hit.chunk?.content || hit.record.content;
    console.log(
      `    #${index + 1} ${labelHit(hit, expectedSources)} score=${score} `
      + `source=${hit.record.sourceId} title=${JSON.stringify(hit.record.title)} `
      + `type=${hit.record.knowledgeType} authority=${hit.record.authority} `
      + `provenance=${provenance(hit)} excerpt=${JSON.stringify(excerpt(chunk))}`,
    );
  });
}

function summarize(name, cases) {
  const counts = { GOOD: 0, PARTIAL: 0, IRRELEVANT: 0, "NO RESULT": 0 };
  for (const item of cases) counts[item.label] = (counts[item.label] || 0) + 1;
  console.log(`${name}: ${JSON.stringify(counts)}`);
}

async function main() {
  loadEnvFile(ENV_FILE);
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const topK = Math.max(1, Math.min(Number(process.env.GREENFIELD_BAKEOFF_TOP_K || 5), 20));
  const compactOutput = process.env.GREENFIELD_BAKEOFF_COMPACT === "1";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey || !process.env.OPENAI_API_KEY) {
    throw new Error("Development Supabase and OpenAI environment variables are required.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: recordData, error: recordError } = await supabase
    .from("greenfield_knowledge_records")
    .select("*")
    .eq("workspace_id", WORKSPACE_ID)
    .order("source_id");
  if (recordError) throw new Error(recordError.message);
  const { data: chunkData, error: chunkError } = await supabase
    .from("greenfield_knowledge_chunks")
    .select("id,workspace_id,record_id,chunk_index,content,embedding")
    .eq("workspace_id", WORKSPACE_ID)
    .order("record_id")
    .order("chunk_index");
  if (chunkError) throw new Error(chunkError.message);

  const records = asRecordRows(recordData, "greenfield records");
  const chunks = asRecordRows(chunkData, "greenfield chunks");
  const sourceIds = [...new Set(records.map((record) => record.source_id))].sort();
  const expectedSourceIds = [
    "acezone-a-blaze",
    "acezone-a-rise",
    "acezone-a-spire-wireless",
    "acezone-about",
    "acezone-faq",
    "acezone-support",
  ];
  if (records.length !== 6 || chunks.length !== 87 || JSON.stringify(sourceIds) !== JSON.stringify(expectedSourceIds)) {
    throw new Error(`Unexpected greenfield corpus: records=${records.length}, chunks=${chunks.length}, sources=${sourceIds.join(",")}`);
  }

  const missingChunks = chunks.filter((chunk) => !chunk.embedding);
  console.log(`CORPUS: DEV Supabase greenfield tables; records=${records.length}; chunks=${chunks.length}; sources=${sourceIds.join(",")}`);
  console.log(`EMBEDDING MODEL: ${embeddingModel}; missing_vectors=${missingChunks.length}`);

  let corpusUsage = null;
  let corpusEmbeddingMs = 0;
  if (missingChunks.length) {
    const embeddingResult = await embedTexts(missingChunks.map((chunk) => chunk.content), {
      model: embeddingModel,
    });
    corpusUsage = embeddingResult.usage;
    corpusEmbeddingMs = embeddingResult.durationMs;
    for (let offset = 0; offset < missingChunks.length; offset += 12) {
      const batch = missingChunks.slice(offset, offset + 12);
      await Promise.all(batch.map(async (chunk, index) => {
        const vector = embeddingResult.embeddings[offset + index];
        const { error } = await supabase
          .from("greenfield_knowledge_chunks")
          .update({ embedding: `[${vector.join(",")}]` })
          .eq("id", chunk.id)
          .eq("workspace_id", WORKSPACE_ID);
        if (error) throw new Error(`Could not store embedding for chunk ${chunk.id}: ${error.message}`);
      }));
    }
    console.log(`CORPUS EMBEDDINGS: stored=${missingChunks.length}; api_total_tokens=${corpusUsage?.total_tokens ?? "unknown"}; api_ms=${corpusEmbeddingMs}`);
  } else {
    console.log("CORPUS EMBEDDINGS: already present; no corpus embedding API call made.");
  }

  const { data: verifyData, error: verifyError } = await supabase
    .from("greenfield_knowledge_chunks")
    .select("id,embedding")
    .eq("workspace_id", WORKSPACE_ID);
  if (verifyError) throw new Error(verifyError.message);
  const verifiedChunks = asRecordRows(verifyData, "embedding verification");
  const missingAfterWrite = verifiedChunks.filter((chunk) => !chunk.embedding).length;
  if (missingAfterWrite) throw new Error(`Embedding verification failed: ${missingAfterWrite} vectors are still missing.`);
  console.log(`CORPUS EMBEDDINGS VERIFIED: ${verifiedChunks.length}/${chunks.length} non-null vectors; no source content changed.`);

  const allCases = [...QUERIES.map((item) => ({ ...item, negative: false })), ...NEGATIVE_QUERIES.map((item) => ({ ...item, negative: true }))];
  const results = { lexical: [], semantic: [], hybrid: [] };
  let queryEmbeddingTokens = 0;
  for (const testCase of allCases) {
    const lexical = await searchLexical(supabase, testCase.text);
    const semanticStartedAt = performance.now();
    const semantic = await searchSemantic(supabase, {
      workspaceId: WORKSPACE_ID,
      query: testCase.text,
      limit: topK,
    }, { model: embeddingModel });
    const semanticTotalMs = elapsed(semanticStartedAt);
    queryEmbeddingTokens += Number(semantic.usage?.total_tokens ?? semantic.usage?.prompt_tokens ?? 0);
    const hybrid = combineHybrid(testCase.text, lexical.hits, semantic.hits, { limit: topK });

    console.log(`\nQUERY${testCase.negative ? " (NEGATIVE/UNSUPPORTED)" : ""}: ${testCase.text}`);
    console.log(`  DATA SOURCE: DEV Supabase greenfield knowledge + OpenAI ${semantic.model}; Shopify not called.`);
    console.log(`  TIMING: lexical_rpc_ms=${lexical.durationMs}; semantic_embedding_ms=${semantic.embeddingMs}; semantic_rpc_ms=${semantic.searchMs}; semantic_total_ms=${semanticTotalMs}`);
    printHits("LEXICAL", lexical.hits, testCase.expectedSources, compactOutput);
    printHits("SEMANTIC", semantic.hits, testCase.expectedSources, compactOutput);
    printHits("HYBRID", hybrid, testCase.expectedSources, compactOutput);

    results.lexical.push({ query: testCase.text, negative: testCase.negative, label: labelHit(lexical.hits[0], testCase.expectedSources), top: lexical.hits[0] });
    results.semantic.push({ query: testCase.text, negative: testCase.negative, label: labelHit(semantic.hits[0], testCase.expectedSources), top: semantic.hits[0] });
    results.hybrid.push({ query: testCase.text, negative: testCase.negative, label: labelHit(hybrid[0], testCase.expectedSources), top: hybrid[0] });
  }

  console.log("\nSUMMARY (top result manual label based on expected source/unsupported-case review)");
  summarize("LEXICAL", results.lexical);
  summarize("SEMANTIC", results.semantic);
  summarize("HYBRID", results.hybrid);
  for (const name of Object.keys(results)) {
    const negativeFalsePositives = results[name].filter((item) => item.negative && item.label !== "NO RESULT").length;
    console.log(`${name} negative_false_positives=${negativeFalsePositives}/${NEGATIVE_QUERIES.length}`);
  }
  const corpusTokens = Number(corpusUsage?.total_tokens ?? 0);
  const totalEmbeddingTokens = corpusTokens + queryEmbeddingTokens;
  const estimatedEmbeddingCostUsd = totalEmbeddingTokens * 0.02 / 1_000_000;
  console.log(`QUERY EMBEDDINGS: ${allCases.length} requests; each semantic query used one vector and hybrid reused that vector; query_api_total_tokens=${queryEmbeddingTokens}; corpus_api_total_tokens=${corpusTokens}.`);
  console.log(`ESTIMATED EMBEDDING COST: $${estimatedEmbeddingCostUsd.toFixed(6)} at $0.02/1M input tokens; excludes already-stored vectors when corpus_api_total_tokens=0.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
