-- Make match_agent_knowledge respect soft-disable flags in metadata.
-- A row is excluded from AI retrieval when ANY of the following is set:
--   metadata.archived       = 'true'
--   metadata.disabled_for_ai = 'true'
--   metadata.active_for_ai   = 'false'
-- Defaults are permissive: a missing field means the row stays active, so
-- existing rows that carry none of these flags are unaffected.
--
-- ⚠️ WARNING: Do not apply the soft-disable filter migration in production
-- before canonical docs are activated/published, because current canonical doc
-- chunks may have active_for_ai=false.
--
-- IMPORTANT (Stage 0 ordering): canonical knowledge_document chunks currently
-- carry active_for_ai=false / environment='preview'. Applying this migration to
-- production BEFORE those chunks are promoted (active_for_ai=true,
-- environment='production') would drop all 64 canonical doc chunks from
-- retrieval. Do NOT push this migration to prod until the docs-live DB update
-- runs in the same window. See the accompanying Stage 0 activation SQL.
--
-- Preserves the product/issue_type overlap filters from
-- 20260519000000_knowledge_metadata_filter.sql and the ticket/saved_reply
-- exclusions.

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
    -- Soft-disable flags (permissive defaults — missing field = active).
    -- Safe text comparison: avoids ::boolean casts that would error on any
    -- non-boolean string. "true"/"false" handled case-insensitively; any other
    -- value falls back to the permissive default (row stays active).
    AND lower(COALESCE(ak.metadata ->> 'archived', 'false')) <> 'true'
    AND lower(COALESCE(ak.metadata ->> 'disabled_for_ai', 'false')) <> 'true'
    AND lower(COALESCE(ak.metadata ->> 'active_for_ai', 'true')) <> 'false'
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
