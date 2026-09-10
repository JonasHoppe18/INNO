-- Sona-owned customer identity. The identity is scoped to a workspace and
-- deliberately does not depend on a commerce provider such as Shopify.

create table if not exists public.workspace_customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  normalized_email text not null,
  name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_customers_normalized_email_check
    check (
      normalized_email = lower(btrim(normalized_email))
      and normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint workspace_customers_workspace_email_unique
    unique (workspace_id, normalized_email),
  constraint workspace_customers_workspace_id_id_unique
    unique (workspace_id, id)
);

create index if not exists workspace_customers_workspace_updated_idx
  on public.workspace_customers (workspace_id, updated_at desc);

alter table public.mail_threads
  add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mail_threads_customer_same_workspace_fkey'
      and conrelid = 'public.mail_threads'::regclass
  ) then
    alter table public.mail_threads
      add constraint mail_threads_customer_same_workspace_fkey
      foreign key (workspace_id, customer_id)
      references public.workspace_customers (workspace_id, id)
      on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mail_threads_customer_requires_workspace'
      and conrelid = 'public.mail_threads'::regclass
  ) then
    alter table public.mail_threads
      add constraint mail_threads_customer_requires_workspace
      check (customer_id is null or workspace_id is not null);
  end if;
end $$;

create index if not exists mail_threads_workspace_customer_idx
  on public.mail_threads (workspace_id, customer_id, last_message_at desc)
  where customer_id is not null;

create or replace function public.workspace_customers_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_workspace_customers_touch_updated_at
  on public.workspace_customers;
create trigger trg_workspace_customers_touch_updated_at
before update on public.workspace_customers
for each row execute function public.workspace_customers_touch_updated_at();

alter table public.workspace_customers enable row level security;

drop policy if exists workspace_customers_service_role on public.workspace_customers;
create policy workspace_customers_service_role
on public.workspace_customers
for all
to service_role
using (true)
with check (workspace_id is not null);

drop policy if exists workspace_customers_select_workspace_members on public.workspace_customers;
create policy workspace_customers_select_workspace_members
on public.workspace_customers
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_customers.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

grant select on table public.workspace_customers to authenticated;

comment on table public.workspace_customers is
  'Sona-owned customer identity, unique per workspace and normalized email.';

comment on column public.workspace_customers.normalized_email is
  'Trimmed, lowercased email address; provider-specific rewriting is not applied.';
