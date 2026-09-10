-- Minimal Shopify return facts for business-impact analytics.
--
-- Return reasons are stored as normalized labels/handles only. We deliberately
-- do not persist customer notes or the raw Shopify return payload.

create extension if not exists pgcrypto;

create table if not exists public.commerce_returns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  external_return_id text not null,
  external_order_id text not null,
  returned_at timestamptz not null,
  status text,
  synced_at timestamptz not null default now(),
  unique (shop_id, external_return_id)
);

create index if not exists commerce_returns_workspace_returned_idx
  on public.commerce_returns (workspace_id, returned_at desc);
create index if not exists commerce_returns_order_idx
  on public.commerce_returns (shop_id, external_order_id);

create table if not exists public.commerce_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.commerce_returns(id) on delete cascade,
  external_line_item_id text,
  quantity integer not null default 1,
  reason_handle text,
  reason text,
  created_at timestamptz not null default now(),
  constraint commerce_return_items_quantity_check check (quantity > 0)
);

create index if not exists commerce_return_items_return_idx
  on public.commerce_return_items (return_id);
create index if not exists commerce_return_items_reason_idx
  on public.commerce_return_items (reason_handle)
  where reason_handle is not null;

alter table public.commerce_returns enable row level security;
alter table public.commerce_return_items enable row level security;

revoke all on public.commerce_returns from anon, authenticated;
revoke all on public.commerce_return_items from anon, authenticated;
