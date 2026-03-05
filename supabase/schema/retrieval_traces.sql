-- Retrieval trace observability for draft generation.
-- Stores compact per-draft retrieval diagnostics (no raw email body).

create table if not exists public.retrieval_traces (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  draft_id text,
  thread_id text,
  message_id text,
  category text,
  query_hash text not null,
  context_budget_tokens integer not null,
  max_retrieval_chunks integer not null,
  knowledge_min_similarity double precision,
  product_min_similarity double precision,
  included_context_tokens integer not null default 0,
  dropped_context_reason text,
  dropped_context_reasons jsonb not null default '[]'::jsonb,
  policy_summary_included boolean not null default false,
  policy_excerpt_included boolean not null default false,
  policy_summary_tokens integer not null default 0,
  data jsonb not null default '{}'::jsonb
);

alter table public.retrieval_traces
  add column if not exists dropped_context_reasons jsonb not null default '[]'::jsonb;

alter table public.retrieval_traces
  add column if not exists policy_summary_included boolean not null default false;

alter table public.retrieval_traces
  add column if not exists policy_excerpt_included boolean not null default false;

alter table public.retrieval_traces
  add column if not exists policy_summary_tokens integer not null default 0;

create index if not exists retrieval_traces_shop_created_idx
  on public.retrieval_traces (shop_id, created_at desc);

create index if not exists retrieval_traces_workspace_created_idx
  on public.retrieval_traces (workspace_id, created_at desc);

alter table public.retrieval_traces enable row level security;

drop policy if exists retrieval_traces_select_scoped on public.retrieval_traces;

create policy retrieval_traces_select_scoped
on public.retrieval_traces
for select
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = retrieval_traces.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    workspace_id is null
    and exists (
      select 1
      from public.shops s
      where s.id = retrieval_traces.shop_id
        and (
          s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
          or exists (
            select 1
            from public.profiles p
            where p.user_id = s.owner_user_id
              and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
          )
        )
    )
  )
);

-- Retention helper for scheduled cleanup.
create or replace function public.delete_old_retrieval_traces(retention_days integer default 30)
returns bigint
language plpgsql
security definer
as $$
declare
  deleted_count bigint;
begin
  delete from public.retrieval_traces
  where created_at < now() - make_interval(days => greatest(retention_days, 1));

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Example manual cleanup query (can be run by cron/job):
-- select public.delete_old_retrieval_traces(30);
