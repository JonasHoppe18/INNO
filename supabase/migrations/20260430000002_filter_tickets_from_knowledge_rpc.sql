-- Exclude source_type='ticket' chunks from match_agent_knowledge RPC.
-- Raw Zendesk conversations in agent_knowledge contain bad agent replies
-- that confuse the writer. Structured examples are now in ticket_examples.

CREATE OR REPLACE FUNCTION public.match_agent_knowledge(
  query_embedding vector(1536),
  match_count int default 5,
  filter_shop_id uuid default null
)
RETURNS TABLE (
  id bigint,
  shop_id uuid,
  content text,
  source_type text,
  source_provider text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ak.id,
    ak.shop_id,
    ak.content,
    ak.source_type,
    ak.source_provider,
    ak.metadata,
    1 - (ak.embedding <=> query_embedding) AS similarity
  FROM public.agent_knowledge ak
  WHERE (filter_shop_id IS NULL OR ak.shop_id = filter_shop_id)
    AND ak.source_type != 'ticket'
  ORDER BY ak.embedding <=> query_embedding
  LIMIT GREATEST(match_count, 1);
END;
$$;
