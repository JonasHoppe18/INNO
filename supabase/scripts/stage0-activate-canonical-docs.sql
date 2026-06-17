-- =============================================================================
-- STAGE 0 — Activate AceZone canonical Knowledge Docs (DO NOT RUN UNTIL APPROVED)
-- =============================================================================
-- Promotes the 8 canonical knowledge_documents and their 64 agent_knowledge
-- chunks to the live AI source for AceZone, so that the soft-disable retrieval
-- filter (migration 20260617000000) can subsequently be used to archive the 83
-- legacy manual_text snippets WITHOUT creating a coverage gap.
--
-- Shop: AceZone  38df5fef-2a23-47f3-803e-39f2d6f1ed99
--
-- ⚠️ WARNING: Do not apply the soft-disable filter migration
-- (20260617000000_knowledge_soft_disable_filter.sql) in production before these
-- canonical docs are activated/published, because current canonical doc chunks
-- may have active_for_ai=false. Run THIS activation script first.
--
-- Ordering requirement: run this in the SAME maintenance window as deploying
-- migration 20260617000000. The migration alone would drop the 64 chunks
-- (active_for_ai=false today) from retrieval; this script flips them on.
--
-- This file is a PLAN. It is NOT applied automatically. Run the verification
-- SELECTs first, confirm counts (8 docs / 64 chunks), then run inside a
-- transaction and verify before COMMIT.
-- -----------------------------------------------------------------------------

\set acezone '38df5fef-2a23-47f3-803e-39f2d6f1ed99'

-- ---- 0. PRE-CHECK (read-only) -----------------------------------------------
-- Expect: 8 docs, all published_at IS NULL.
SELECT count(*) AS docs, count(*) FILTER (WHERE published_at IS NULL) AS unpublished
FROM public.knowledge_documents
WHERE shop_id = '38df5fef-2a23-47f3-803e-39f2d6f1ed99';

-- Expect: 64 chunks, all active_for_ai=false / environment='preview'.
SELECT count(*) AS chunks,
       count(*) FILTER (WHERE metadata->>'active_for_ai' = 'false') AS inactive,
       count(*) FILTER (WHERE metadata->>'environment' = 'preview') AS preview
FROM public.agent_knowledge
WHERE shop_id = '38df5fef-2a23-47f3-803e-39f2d6f1ed99'
  AND source_provider = 'knowledge_document';

-- ---- 1. ACTIVATION (mutating — wrap in a transaction) -----------------------
BEGIN;

-- 1a. Publish parent docs.
UPDATE public.knowledge_documents
SET published_at = now(),
    published_markdown = COALESCE(published_markdown, draft_markdown),
    has_unpublished_changes = false,
    updated_at = now()
WHERE shop_id = '38df5fef-2a23-47f3-803e-39f2d6f1ed99'
  AND published_at IS NULL;

-- 1b. Activate the chunks: active_for_ai=true, environment='production'.
UPDATE public.agent_knowledge
SET metadata = metadata
      || jsonb_build_object('active_for_ai', true)
      || jsonb_build_object('environment', 'production')
WHERE shop_id = '38df5fef-2a23-47f3-803e-39f2d6f1ed99'
  AND source_provider = 'knowledge_document'
  AND (
        metadata->>'active_for_ai' IS DISTINCT FROM 'true'
     OR metadata->>'environment'   IS DISTINCT FROM 'production'
      );

-- ---- 2. POST-CHECK inside the transaction -----------------------------------
-- Expect: 64 active production chunks, 0 remaining preview/inactive.
SELECT count(*) AS chunks,
       count(*) FILTER (WHERE metadata->>'active_for_ai' = 'true') AS active,
       count(*) FILTER (WHERE metadata->>'environment' = 'production') AS production
FROM public.agent_knowledge
WHERE shop_id = '38df5fef-2a23-47f3-803e-39f2d6f1ed99'
  AND source_provider = 'knowledge_document';

-- Verify the numbers above, then:
--   COMMIT;
-- or, if anything is off:
--   ROLLBACK;
COMMIT;

-- NOTE: This script deliberately does NOT touch manual_text snippets. Archiving
-- those is Stage 1 and happens only after this activation is verified in prod.
