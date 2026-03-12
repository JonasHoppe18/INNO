-- Lightweight inbound email routing config per workspace.

create table if not exists public.workspace_email_routes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category_key text not null,
  label text not null,
  forward_to_email text,
  mode text not null default 'manual_approval' check (mode in ('manual_approval', 'auto_forward')),
  is_active boolean not null default false,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_email_routes_workspace_category_unique unique (workspace_id, category_key)
);

create index if not exists workspace_email_routes_workspace_idx
  on public.workspace_email_routes (workspace_id, sort_order asc, created_at desc);

-- Ensure each workspace has baseline routing categories.
create or replace function public.seed_default_workspace_email_routes()
returns trigger
language plpgsql
as $$
begin
  insert into public.workspace_email_routes (
    workspace_id,
    category_key,
    label,
    mode,
    is_active,
    is_default,
    sort_order
  )
  values
    (new.id, 'invoice', 'Invoice', 'manual_approval', false, true, 10),
    (new.id, 'job', 'Job', 'manual_approval', false, true, 20),
    (new.id, 'partnership', 'Partnership', 'manual_approval', false, true, 30)
  on conflict (workspace_id, category_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_seed_default_workspace_email_routes on public.workspaces;
create trigger trg_seed_default_workspace_email_routes
after insert on public.workspaces
for each row
execute function public.seed_default_workspace_email_routes();

insert into public.workspace_email_routes (
  workspace_id,
  category_key,
  label,
  mode,
  is_active,
  is_default,
  sort_order
)
select
  w.id as workspace_id,
  defaults.category_key,
  defaults.label,
  'manual_approval' as mode,
  false as is_active,
  true as is_default,
  defaults.sort_order
from public.workspaces w
cross join (
  values
    ('invoice', 'Invoice', 10),
    ('job', 'Job', 20),
    ('partnership', 'Partnership', 30)
) as defaults(category_key, label, sort_order)
on conflict (workspace_id, category_key) do nothing;

alter table public.mail_threads
  add column if not exists classification_key text,
  add column if not exists classification_confidence numeric,
  add column if not exists classification_reason text;

alter table public.mail_threads
  drop constraint if exists mail_threads_classification_key_check;

alter table public.mail_threads
  add constraint mail_threads_classification_key_check
  check (
    classification_key is null
    or length(btrim(classification_key)) > 0
  );

create index if not exists mail_threads_workspace_classification_idx
  on public.mail_threads (workspace_id, classification_key, updated_at desc);

alter table public.workspace_email_routes enable row level security;

drop policy if exists workspace_email_routes_select_scoped on public.workspace_email_routes;
drop policy if exists workspace_email_routes_modify_scoped on public.workspace_email_routes;

create policy workspace_email_routes_select_scoped
on public.workspace_email_routes
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_routes.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy workspace_email_routes_modify_scoped
on public.workspace_email_routes
for all
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_routes.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_routes.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);
