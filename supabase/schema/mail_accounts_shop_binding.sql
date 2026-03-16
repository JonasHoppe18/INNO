alter table if exists public.mail_accounts
  add column if not exists shop_id uuid references public.shops(id) on delete set null;

create index if not exists mail_accounts_shop_id_idx
  on public.mail_accounts (shop_id);
