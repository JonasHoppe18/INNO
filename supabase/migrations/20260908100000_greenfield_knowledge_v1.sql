-- Greenfield Knowledge V1, development validation only.
-- A source is first-class and may deterministically produce many canonical
-- records. This migration does not alter agent_knowledge, V2/V3 tables, mail,
-- or production conversation state.

create table if not exists public.greenfield_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_kind text not null,
  source_id text not null,
  source_version integer not null default 1 check (source_version > 0),
  title text not null,
  raw_content text not null default '',
  normalized_content text not null default '',
  source_uri text,
  source_label text,
  content_hash text not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, source_kind, source_id)
);

alter table public.greenfield_knowledge_records
  add column if not exists source_uuid uuid references public.greenfield_knowledge_sources(id) on delete set null,
  add column if not exists source_version integer,
  add column if not exists source_content_hash text,
  add column if not exists source_location jsonb,
  add column if not exists source_record_key text,
  add column if not exists task_key text,
  add column if not exists customer_aliases text[] not null default '{}'::text[];

create unique index if not exists greenfield_knowledge_records_source_record_uidx
  on public.greenfield_knowledge_records (workspace_id, source_id, source_record_key);
create index if not exists greenfield_knowledge_records_source_uuid_idx
  on public.greenfield_knowledge_records (workspace_id, source_uuid);
create index if not exists greenfield_knowledge_records_task_idx
  on public.greenfield_knowledge_records (workspace_id, task_key);

create index if not exists greenfield_knowledge_sources_scope_idx
  on public.greenfield_knowledge_sources (workspace_id, updated_at desc);
create index if not exists greenfield_knowledge_sources_hash_idx
  on public.greenfield_knowledge_sources (workspace_id, content_hash);

drop trigger if exists trg_greenfield_knowledge_sources_updated_at
  on public.greenfield_knowledge_sources;
create trigger trg_greenfield_knowledge_sources_updated_at
before update on public.greenfield_knowledge_sources
for each row execute function public.greenfield_knowledge_updated_at();

alter table public.greenfield_knowledge_sources enable row level security;

drop policy if exists greenfield_sources_service_role on public.greenfield_knowledge_sources;
create policy greenfield_sources_service_role on public.greenfield_knowledge_sources
  for all to service_role using (true) with check (workspace_id is not null);
drop policy if exists greenfield_sources_scoped_read on public.greenfield_knowledge_sources;
create policy greenfield_sources_scoped_read on public.greenfield_knowledge_sources
  for select to authenticated using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = greenfield_knowledge_sources.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  );

comment on table public.greenfield_knowledge_sources is
  'Greenfield V1 canonical source registry; one source may produce many reviewable records.';
comment on column public.greenfield_knowledge_records.structured_data is
  'Canonical structured knowledge. For procedures, procedure.blocks preserves source order and semantic block kind.';
