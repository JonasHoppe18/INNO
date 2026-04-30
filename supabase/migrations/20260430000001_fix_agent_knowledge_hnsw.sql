-- Fix broken IVFFlat index on agent_knowledge
-- IVFFlat with lists=100 requires ~3900 rows to work correctly; we only have ~312
-- Zero results were being returned from match_agent_knowledge RPC
-- Replace with HNSW which works at any table size

DROP INDEX IF EXISTS agent_knowledge_embedding_idx;

CREATE INDEX agent_knowledge_embedding_hnsw_idx
  ON public.agent_knowledge
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
