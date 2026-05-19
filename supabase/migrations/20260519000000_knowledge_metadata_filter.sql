-- Extend match_agent_knowledge with optional metadata filters.
-- filter_products: only return chunks whose metadata.products overlaps with the array
--   (OR: chunks with no products tag pass through — they are universal content like policies)
-- filter_issue_types: same logic for issue types
-- Also excludes saved_reply chunks from AI retrieval — they are agent-only templates.

CREATE OR REPLACE FUNCTION public.match_agent_knowledge(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_shop_id uuid DEFAULT NULL,
  filter_products text[] DEFAULT NULL,
  filter_issue_types text[] DEFAULT NULL
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
    AND ak.source_provider != 'saved_reply'
    AND (
      filter_products IS NULL
      OR array_length(filter_products, 1) = 0
      OR (ak.metadata -> 'products') IS NULL
      OR jsonb_array_length(COALESCE(ak.metadata -> 'products', '[]'::jsonb)) = 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(ak.metadata -> 'products') p
        WHERE p = ANY(filter_products)
      )
    )
    AND (
      filter_issue_types IS NULL
      OR array_length(filter_issue_types, 1) = 0
      OR (ak.metadata -> 'issue_types') IS NULL
      OR jsonb_array_length(COALESCE(ak.metadata -> 'issue_types', '[]'::jsonb)) = 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(ak.metadata -> 'issue_types') it
        WHERE it = ANY(filter_issue_types)
      )
    )
  ORDER BY ak.embedding <=> query_embedding
  LIMIT GREATEST(match_count, 1);
END;
$$;
