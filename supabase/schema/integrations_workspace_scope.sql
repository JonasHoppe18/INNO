-- Workspace-scoped integrations (shared across team members).
-- Keeps legacy user-scoped rows working as fallback.

-- Backfill workspace_id on existing rows where possible via profiles + workspace_members.
with latest_membership as (
  select
    p.user_id,
    wm.workspace_id,
    row_number() over (
      partition by p.user_id
      order by wm.created_at desc nulls last
    ) as rn
  from public.profiles p
  join public.workspace_members wm
    on wm.clerk_user_id = p.clerk_user_id
)
update public.integrations i
set workspace_id = lm.workspace_id
from latest_membership lm
where i.workspace_id is null
  and i.user_id = lm.user_id
  and lm.rn = 1;

create unique index if not exists integrations_workspace_provider_unique_not_null
  on public.integrations (workspace_id, provider)
  where workspace_id is not null;

create unique index if not exists integrations_user_provider_unique_when_no_workspace
  on public.integrations (user_id, provider)
  where workspace_id is null;

alter table public.integrations enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'integrations'
  loop
    execute format('drop policy if exists %I on public.integrations', p.policyname);
  end loop;
end $$;

create policy integrations_select_scoped
on public.integrations
for select
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = integrations.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
  or exists (
    select 1
    from public.profiles p
    where p.user_id = integrations.user_id
      and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy integrations_modify_scoped
on public.integrations
for all
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = integrations.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
  or exists (
    select 1
    from public.profiles p
    where p.user_id = integrations.user_id
      and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = integrations.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
  or exists (
    select 1
    from public.profiles p
    where p.user_id = integrations.user_id
      and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

-- Cleanup deprecated webhook config keys on legacy integration rows.
update public.integrations
set config = coalesce(config, '{}'::jsonb) - 'webhook_url'
where provider in ('gorgias', 'freshdesk')
  and coalesce(config, '{}'::jsonb) ? 'webhook_url';
