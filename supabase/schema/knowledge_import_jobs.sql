-- Background import jobs for one-time migration of external helpdesk history.

create table if not exists public.knowledge_import_jobs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  workspace_id uuid references public.workspaces(id),
  user_id uuid references auth.users(id),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  cursor jsonb not null default '{}'::jsonb,
  max_tickets int not null default 1000 check (max_tickets > 0),
  batch_size int not null default 50 check (batch_size > 0),
  imported_count int not null default 0,
  skipped_count int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.knowledge_import_jobs
  drop constraint if exists knowledge_import_jobs_provider_check;

create index if not exists knowledge_import_jobs_provider_status_idx
  on public.knowledge_import_jobs (provider, status, updated_at asc);

create index if not exists knowledge_import_jobs_shop_idx
  on public.knowledge_import_jobs (shop_id, created_at desc);

create unique index if not exists knowledge_import_jobs_active_unique
  on public.knowledge_import_jobs (provider, shop_id)
  where status in ('queued', 'running');

alter table public.knowledge_import_jobs enable row level security;

drop policy if exists knowledge_import_jobs_select_scoped on public.knowledge_import_jobs;
drop policy if exists knowledge_import_jobs_modify_scoped on public.knowledge_import_jobs;

create policy knowledge_import_jobs_select_scoped
on public.knowledge_import_jobs
for select
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = knowledge_import_jobs.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    workspace_id is null
    and (
      user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
      or exists (
        select 1
        from public.profiles p
        where p.user_id = knowledge_import_jobs.user_id
          and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
      )
    )
  )
);

create policy knowledge_import_jobs_modify_scoped
on public.knowledge_import_jobs
for all
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = knowledge_import_jobs.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    workspace_id is null
    and (
      user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
      or exists (
        select 1
        from public.profiles p
        where p.user_id = knowledge_import_jobs.user_id
          and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
      )
    )
  )
)
with check (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = knowledge_import_jobs.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    workspace_id is null
    and (
      user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
      or exists (
        select 1
        from public.profiles p
        where p.user_id = knowledge_import_jobs.user_id
          and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
      )
    )
  )
);
