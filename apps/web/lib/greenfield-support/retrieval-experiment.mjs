/**
 * Greenfield retrieval bake-off primitives.
 *
 * This file is intentionally not imported by the support-agent response path.
 * It measures semantic retrieval independently, then combines the existing
 * lexical candidates with semantic candidates using only deterministic code.
 */

export const DEFAULT_GREENFIELD_EMBEDDING_MODEL = "text-embedding-3-small";
export const GREENFIELD_EMBEDDING_DIMENSIONS = 1536;

const AUTHORITY_WEIGHT = {
  authoritative: 1,
  operational: 0.98,
  reference: 0.88,
  guidance: 0.78,
  example: 0.55,
};

function cleanString(value) {
  return String(value ?? "").trim();
}

export function rowToKnowledgeRecord(row) {
  return {
    id: cleanString(row.id),
    workspaceId: cleanString(row.workspace_id),
    knowledgeType: row.knowledge_type,
    authority: row.authority,
    title: cleanString(row.title),
    content: cleanString(row.content),
    structuredData: row.structured_data ?? {},
    sourceKind: cleanString(row.source_kind),
    sourceId: cleanString(row.source_id),
    sourceUri: row.source_uri ?? null,
    sourceLabel: row.source_label ?? null,
    contentHash: cleanString(row.content_hash),
    publishedAt: row.published_at ?? null,
    observedAt: row.observed_at ?? null,
    expiresAt: row.expires_at ?? null,
    metadata: row.metadata ?? {},
    chunks: Array.isArray(row.chunks) ? row.chunks : [cleanString(row.content)],
  };
}

export function rowToLexicalHit(row) {
  return {
    record: rowToKnowledgeRecord(row),
    score: Number(row.score ?? 0),
    matchReason: row.match_reason ?? "lexical",
  };
}

export function rowToSemanticHit(row) {
  return {
    record: rowToKnowledgeRecord(row),
    chunk: {
      id: cleanString(row.chunk_id),
      index: Number(row.chunk_index ?? 0),
      content: cleanString(row.chunk_content),
    },
    score: Number(row.score ?? 0),
    matchReason: row.match_reason ?? "semantic",
  };
}

function embeddingErrorMessage(payload, status) {
  const message = payload?.error?.message;
  return message ? `Embedding request failed: ${message}` : `Embedding request failed (${status}).`;
}

/** Call the official OpenAI Embeddings API without adding another dependency. */
export async function embedTexts(texts, options = {}) {
  const inputs = Array.isArray(texts) ? texts.map((text) => String(text ?? "")) : [];
  if (!inputs.length) return { embeddings: [], model: options.model ?? DEFAULT_GREENFIELD_EMBEDDING_MODEL, usage: null, durationMs: 0 };
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing.");
  const model = options.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_GREENFIELD_EMBEDDING_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = performance.now();
  const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: inputs, encoding_format: "float" }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(embeddingErrorMessage(payload, response.status));
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const embeddings = data
    .slice()
    .sort((left, right) => Number(left?.index ?? 0) - Number(right?.index ?? 0))
    .map((item) => item?.embedding);
  if (embeddings.length !== inputs.length || embeddings.some((embedding) => !Array.isArray(embedding))) {
    throw new Error("Embedding response did not contain one vector per input.");
  }
  return {
    embeddings,
    model: payload?.model ?? model,
    usage: payload?.usage ?? null,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export async function embedText(text, options = {}) {
  const result = await embedTexts([text], options);
  return {
    embedding: result.embeddings[0],
    model: result.model,
    usage: result.usage,
    durationMs: result.durationMs,
  };
}

export async function searchSemantic(serviceClient, request, options = {}) {
  const embeddingResult = request.embedding
    ? { embedding: request.embedding, model: options.model ?? null, usage: null, durationMs: 0 }
    : await embedText(request.query, options);
  const startedAt = performance.now();
  const { data, error } = await serviceClient.rpc("greenfield_search_knowledge_semantic", {
    p_workspace_id: request.workspaceId,
    p_query_embedding: embeddingResult.embedding,
    p_knowledge_types: request.knowledgeTypes ?? null,
    p_limit: request.limit ?? 5,
  });
  if (error) throw new Error(error.message);
  return {
    hits: (Array.isArray(data) ? data : []).map(rowToSemanticHit),
    embedding: embeddingResult.embedding,
    model: embeddingResult.model,
    usage: embeddingResult.usage,
    embeddingMs: embeddingResult.durationMs,
    searchMs: Math.round(performance.now() - startedAt),
  };
}

function tokens(value) {
  return cleanString(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

/** Generic title/entity signal; it does not contain merchant-specific names. */
export function titleEntityOverlap(query, title) {
  const queryTokens = [...new Set(tokens(query).filter((token) => token.length > 2))];
  if (!queryTokens.length) return 0;
  const titleTokens = new Set(tokens(title));
  return queryTokens.filter((token) => titleTokens.has(token)).length / queryTokens.length;
}

function freshnessScore(record, now = Date.now()) {
  const timestamp = Date.parse(record.observedAt || record.publishedAt || "");
  if (!Number.isFinite(timestamp)) return 0.5;
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  return Math.max(0.35, 1 - ageDays / 365);
}

/**
 * Small deterministic hybrid: equal normalized lexical/semantic contribution,
 * then the existing authority/freshness preference and a generic title signal.
 */
export function combineHybrid(query, lexicalHits, semanticHits, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit ?? 5), 20));
  const now = options.now ?? Date.now();
  const lexicalMax = Math.max(0, ...lexicalHits.map((hit) => Number(hit.score ?? 0)));
  const byRecord = new Map();

  for (const hit of lexicalHits) {
    byRecord.set(hit.record.id, {
      record: hit.record,
      lexicalScore: Number(hit.score ?? 0),
      semanticScore: null,
      chunk: null,
    });
  }
  for (const hit of semanticHits) {
    const current = byRecord.get(hit.record.id);
    byRecord.set(hit.record.id, {
      record: current?.record ?? hit.record,
      lexicalScore: current?.lexicalScore ?? null,
      semanticScore: Number(hit.score ?? 0),
      chunk: hit.chunk,
    });
  }

  return [...byRecord.values()]
    .map((candidate) => {
      const normalizedLexical = lexicalMax > 0 && candidate.lexicalScore != null
        ? candidate.lexicalScore / lexicalMax
        : 0;
      const semanticScore = candidate.semanticScore == null
        ? 0
        : Math.max(0, Math.min(1, candidate.semanticScore));
      const baseScore = (normalizedLexical + semanticScore) / 2;
      const authorityMultiplier = AUTHORITY_WEIGHT[candidate.record.authority] ?? 0.55;
      const freshnessMultiplier = 0.75 + freshnessScore(candidate.record, now) * 0.25;
      const entityTitleBoost = titleEntityOverlap(query, candidate.record.title) * 0.2;
      return {
        ...candidate,
        score: baseScore * authorityMultiplier * freshnessMultiplier + entityTitleBoost,
        normalizedLexical,
        authorityMultiplier,
        freshnessMultiplier,
        entityTitleBoost,
        matchReason: candidate.lexicalScore != null && candidate.semanticScore != null
          ? "lexical+semantic"
          : candidate.semanticScore != null
            ? "semantic"
            : "lexical",
      };
    })
    .sort((left, right) => (
      right.score - left.score
      || (right.semanticScore ?? -1) - (left.semanticScore ?? -1)
      || (right.lexicalScore ?? -1) - (left.lexicalScore ?? -1)
    ))
    .slice(0, limit);
}

