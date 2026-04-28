-- Migration: add_draft_preview_pipeline
-- Tilføjer infrastruktur til shadow preview systemet (v2 pipeline on-demand kørsel)

-- Tilføj pipeline_version til drafts table for at skelne legacy vs. ny pipeline
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS pipeline_version TEXT DEFAULT 'legacy';

-- Tabel til shadow preview resultater (den nye pipeline kører on-demand)
CREATE TABLE IF NOT EXISTS draft_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES mail_threads(id) ON DELETE CASCADE,
  message_id UUID REFERENCES mail_messages(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  draft_text TEXT,
  proposed_actions JSONB DEFAULT '[]',
  verifier_confidence FLOAT,
  sources JSONB DEFAULT '[]',
  latency_ms INTEGER,
  cost_usd FLOAT,
  outcome TEXT CHECK (outcome IN ('adopted', 'rejected', 'edited_then_adopted', 'pending')),
  edit_distance INTEGER,
  pipeline_version TEXT DEFAULT 'v2',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for hurtige opslag
CREATE INDEX IF NOT EXISTS draft_previews_thread_id_idx ON draft_previews(thread_id);
CREATE INDEX IF NOT EXISTS draft_previews_shop_id_idx ON draft_previews(shop_id);
CREATE INDEX IF NOT EXISTS draft_previews_created_at_idx ON draft_previews(created_at DESC);

-- RLS policies: kun shop-ejere (via supabase_user_id eller clerk fallback) kan se og skrive previews
ALTER TABLE draft_previews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "draft_previews_select_own"
  ON draft_previews FOR SELECT
  USING (
    shop_id IN (
      SELECT id FROM public.shops
      WHERE owner_user_id::text = coalesce(auth.jwt()->>'supabase_user_id', '')
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = public.shops.owner_user_id
          AND p.clerk_user_id = coalesce(auth.jwt()->>'sub', '')
      )
    )
  );

CREATE POLICY "draft_previews_insert_own"
  ON draft_previews FOR INSERT
  WITH CHECK (
    shop_id IN (
      SELECT id FROM public.shops
      WHERE owner_user_id::text = coalesce(auth.jwt()->>'supabase_user_id', '')
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = public.shops.owner_user_id
          AND p.clerk_user_id = coalesce(auth.jwt()->>'sub', '')
      )
    )
  );

CREATE POLICY "draft_previews_update_own"
  ON draft_previews FOR UPDATE
  USING (
    shop_id IN (
      SELECT id FROM public.shops
      WHERE owner_user_id::text = coalesce(auth.jwt()->>'supabase_user_id', '')
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = public.shops.owner_user_id
          AND p.clerk_user_id = coalesce(auth.jwt()->>'sub', '')
      )
    )
  );
