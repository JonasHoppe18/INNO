-- Per-shop action configuration for the v2 pipeline.
-- Allows each shop to customise action decision behaviour without code changes.
-- Docs: see ShopActionConfig interface in generate-draft-v2/stages/action-decision.ts

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS action_config JSONB DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.shops.action_config IS
  'Per-shop action decision config. Keys: spare_parts_workflow (office|shopify|manual), spare_part_keywords (string[]), exchange_workflow (shopify|manual), defect_requires_photo (bool), address_change_auto (bool), refund_auto_days (int), disabled_actions (string[]).';

-- Set AceZone default: spare parts are shipped from office
UPDATE public.shops
  SET action_config = '{"spare_parts_workflow": "office"}'::JSONB
  WHERE shop_domain ILIKE '%acezone%';
