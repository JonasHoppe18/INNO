-- Stage 4B-1: platform-neutral product data foundation.
--
-- shop_products has been an embedding/retrieval cache. This migration promotes
-- it to a reliable, platform-NEUTRAL runtime product source by adding normalized
-- Sona fields that any commerce provider (Shopify, WooCommerce, Magento, custom)
-- can populate. Provider/payload-specific parsing stays in sync/provider code;
-- the columns below are generic.
--
-- Additive only. No data rewrite. The legacy shop_id-based unique constraint and
-- the (NULL) shop_id column are intentionally left in place — they are vestigial
-- (shop_id is NULL and FKs auth.users) and their removal is a separate cleanup.
-- Tenant scoping for product data uses shop_ref_id (-> shops.id).

alter table public.shop_products
  -- Stable product identity / linking
  add column if not exists handle text,
  add column if not exists product_url text,
  -- Lifecycle + availability (normalized across platforms)
  add column if not exists status text,
  add column if not exists available boolean,
  -- Typed pricing (legacy `price` text column is kept for back-compat)
  add column if not exists price_amount numeric,
  add column if not exists currency text,
  add column if not exists min_price numeric,
  add column if not exists max_price numeric,
  -- Safety / curation signals
  add column if not exists is_placeholder_price boolean not null default false,
  add column if not exists recommendable boolean not null default true,
  -- Freshness / staleness tracking
  add column if not exists product_updated_at timestamptz,
  add column if not exists synced_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  -- Original platform payload for audit/debugging/backfill
  add column if not exists raw jsonb;

-- Correct uniqueness for shop_ref_id-based upserts used by the product sync
-- (onConflict: shop_ref_id, external_id, platform). The pre-existing
-- shop_products_shop_id_external_id_platform_key unique constraint is on the
-- vestigial NULL shop_id column and does not serve these upserts; it is left
-- untouched here on purpose.
create unique index if not exists shop_products_shop_ref_external_platform_key
  on public.shop_products (shop_ref_id, external_id, platform);
