-- Trusted public, customer-facing storefront domain for a shop (e.g.
-- "www.acezone.io"). Distinct from shop_domain, which is the internal Shopify
-- Admin host (*.myshopify.com) and must never be shown to customers.
--
-- Used by resolvePublicStorefrontDomain() to safely build public product page
-- URLs (https://<public_storefront_domain>/products/<handle>) from a trusted
-- Shopify product handle — without leaking myshopify URLs or letting the model
-- fabricate a domain. Nullable: when unset, Sona uses the safe "no secure
-- product link" fallback. No backfill — values are set per shop separately.
alter table public.shops
  add column if not exists public_storefront_domain text;
