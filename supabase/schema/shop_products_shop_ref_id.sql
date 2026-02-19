-- shop_products migration notes for new relation model
-- shop_ref_id must point to public.shops(id)

-- Ensure write upserts can target a deterministic conflict key
create unique index if not exists shop_products_shop_ref_external_platform_idx
  on public.shop_products (shop_ref_id, external_id, platform);

-- Optional cleanup after backfill:
-- update public.shop_products sp
-- set shop_ref_id = s.id
-- from public.shops s
-- where sp.shop_ref_id is null
--   and sp.shop_id = s.owner_user_id;

-- Optional function update if your RPC still filters by legacy column semantics:
-- Keep parameter name for compatibility, but make sure it filters by shop_ref_id.
-- Example inside match_products:
-- where shop_ref_id = filter_shop_id
