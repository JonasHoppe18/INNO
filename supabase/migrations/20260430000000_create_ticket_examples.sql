-- Dedicated table for past ticket examples used as few-shot tone anchors in the v2 writer.
-- Intentionally separate from agent_knowledge (policies, FAQs, product info) so:
--   - ticket vectors don't compete with knowledge vectors in the same index
--   - columns are typed (not buried in JSONB metadata)
--   - quality signals (csat_score, intent) are filterable at DB level
--   - each shop's data is fully isolated via RLS + shop_id

CREATE TABLE IF NOT EXISTS public.ticket_examples (
  id                   BIGSERIAL PRIMARY KEY,
  shop_id              UUID        NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  workspace_id         UUID        REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_provider      TEXT        NOT NULL,
  external_ticket_id   TEXT        NOT NULL,
  customer_msg         TEXT        NOT NULL,
  agent_reply          TEXT        NOT NULL,
  subject              TEXT,
  intent               TEXT,
  language             TEXT,
  csat_score           SMALLINT,
  tags                 TEXT[]      DEFAULT '{}',
  embedding            vector(1536),
  imported_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ticket_examples_dedup UNIQUE (shop_id, source_provider, external_ticket_id)
);

CREATE INDEX IF NOT EXISTS ticket_examples_embedding_idx
  ON public.ticket_examples
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS ticket_examples_shop_id_idx
  ON public.ticket_examples (shop_id);

CREATE INDEX IF NOT EXISTS ticket_examples_shop_intent_idx
  ON public.ticket_examples (shop_id, intent)
  WHERE intent IS NOT NULL;

ALTER TABLE public.ticket_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_examples_service_role" ON public.ticket_examples
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "ticket_examples_select_scoped" ON public.ticket_examples
  FOR SELECT TO authenticated
  USING (
    (workspace_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = ticket_examples.workspace_id
        AND wm.clerk_user_id = COALESCE(auth.jwt() ->> 'sub', '')
    ))
    OR
    (workspace_id IS NULL AND EXISTS (
      SELECT 1 FROM shops s
      WHERE s.id = ticket_examples.shop_id
        AND (
          s.owner_user_id::text = COALESCE(auth.jwt() ->> 'supabase_user_id', '')
          OR EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.user_id = s.owner_user_id
              AND p.clerk_user_id = COALESCE(auth.jwt() ->> 'sub', '')
          )
        )
    ))
  );

CREATE OR REPLACE FUNCTION public.match_ticket_examples(
  query_embedding  vector,
  match_count      INT     DEFAULT 3,
  filter_shop_id   UUID    DEFAULT NULL,
  filter_intent    TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id             BIGINT,
  shop_id        UUID,
  customer_msg   TEXT,
  agent_reply    TEXT,
  subject        TEXT,
  intent         TEXT,
  language       TEXT,
  csat_score     SMALLINT,
  similarity     DOUBLE PRECISION
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    te.id,
    te.shop_id,
    te.customer_msg,
    te.agent_reply,
    te.subject,
    te.intent,
    te.language,
    te.csat_score,
    1 - (te.embedding <=> query_embedding) AS similarity
  FROM public.ticket_examples te
  WHERE
    (filter_shop_id IS NULL OR te.shop_id = filter_shop_id)
    AND (filter_intent IS NULL OR te.intent = filter_intent)
    AND te.embedding IS NOT NULL
  ORDER BY te.embedding <=> query_embedding
  LIMIT GREATEST(match_count, 1);
END;
$$;
