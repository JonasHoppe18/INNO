-- Multi-currency support: store Shopify Markets presentment prices per product
-- and the shop's primary market currency for the draft-time currency resolver.

alter table public.shop_products
  add column if not exists presentment_prices jsonb not null default '{}'::jsonb;

comment on column public.shop_products.presentment_prices is
  'Map of presentment currency code -> primary-variant price string, e.g. {"EUR":"199.00","DKK":"1499.00"}. Populated from Shopify Markets via GraphQL. Empty when Markets is not configured.';

alter table public.shops
  add column if not exists primary_market_currency text;

comment on column public.shops.primary_market_currency is
  'The shop''s primary Shopify Market currency (e.g. "DKK"). Fallback currency for the draft-time currency resolver when there is no order and no language signal.';
