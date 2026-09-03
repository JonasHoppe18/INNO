-- Greenfield support-agent experiment only.
-- This schema is intentionally separate from agent_knowledge, ticket_examples,
-- and the V2/V3 retrieval tables. Do not apply to a production project yet.

create extension if not exists vector;

create table if not exists public.greenfield_knowledge_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  knowledge_type text not null check (knowledge_type in (
    'policy', 'product', 'live_operational', 'historic_support', 'brand', 'procedural'
  )),
  authority text not null check (authority in (
    'authoritative', 'operational', 'reference', 'example', 'guidance'
  )),
  title text not null,
  content text not null,
  structured_data jsonb not null default '{}'::jsonb,
  source_kind text not null,
  source_id text not null,
  source_uri text,
  source_label text,
  content_hash text not null,
  published_at timestamptz,
  observed_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, content_hash)
);

create table if not exists public.greenfield_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  record_id uuid not null references public.greenfield_knowledge_records(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  search_document tsvector generated always as (
    to_tsvector('simple'::regconfig, content)
  ) stored,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (record_id, chunk_index),
  check (workspace_id is not null)
);

create table if not exists public.greenfield_knowledge_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_kind text not null,
  source_id text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  records_seen integer not null default 0,
  records_written integer not null default 0,
  chunks_written integer not null default 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists greenfield_knowledge_records_workspace_type_idx
  on public.greenfield_knowledge_records (workspace_id, knowledge_type, authority);
create index if not exists greenfield_knowledge_records_freshness_idx
  on public.greenfield_knowledge_records (workspace_id, observed_at desc, expires_at);
create index if not exists greenfield_knowledge_chunks_search_idx
  on public.greenfield_knowledge_chunks using gin (search_document);
create index if not exists greenfield_knowledge_chunks_workspace_idx
  on public.greenfield_knowledge_chunks (workspace_id, record_id);
create index if not exists greenfield_knowledge_chunks_embedding_idx
  on public.greenfield_knowledge_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100)
  where embedding is not null;
create or replace function public.greenfield_knowledge_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_greenfield_knowledge_updated_at
  on public.greenfield_knowledge_records;
create trigger trg_greenfield_knowledge_updated_at
before update on public.greenfield_knowledge_records
for each row execute function public.greenfield_knowledge_updated_at();

alter table public.greenfield_knowledge_records enable row level security;
alter table public.greenfield_knowledge_chunks enable row level security;
alter table public.greenfield_knowledge_ingestion_jobs enable row level security;

drop policy if exists greenfield_records_service_role on public.greenfield_knowledge_records;
create policy greenfield_records_service_role on public.greenfield_knowledge_records
  for all to service_role using (true) with check (workspace_id is not null);
drop policy if exists greenfield_records_scoped_read on public.greenfield_knowledge_records;
create policy greenfield_records_scoped_read on public.greenfield_knowledge_records
  for select to authenticated using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = greenfield_knowledge_records.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  );

drop policy if exists greenfield_chunks_service_role on public.greenfield_knowledge_chunks;
create policy greenfield_chunks_service_role on public.greenfield_knowledge_chunks
  for all to service_role using (true) with check (workspace_id is not null);
drop policy if exists greenfield_chunks_scoped_read on public.greenfield_knowledge_chunks;
create policy greenfield_chunks_scoped_read on public.greenfield_knowledge_chunks
  for select to authenticated using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = greenfield_knowledge_chunks.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  );

drop policy if exists greenfield_jobs_service_role on public.greenfield_knowledge_ingestion_jobs;
create policy greenfield_jobs_service_role on public.greenfield_knowledge_ingestion_jobs
  for all to service_role using (true) with check (workspace_id is not null);

comment on column public.greenfield_knowledge_chunks.embedding is
  'Optional semantic retrieval vector; text retrieval remains the default experiment path.';

create or replace function public.greenfield_search_knowledge(
  p_workspace_id uuid,
  p_query text,
  p_knowledge_types text[] default null,
  p_limit integer default 5
)
returns table (
  id uuid,
  workspace_id uuid,
  knowledge_type text,
  authority text,
  title text,
  content text,
  structured_data jsonb,
  source_kind text,
  source_id text,
  source_uri text,
  source_label text,
  content_hash text,
  published_at timestamptz,
  observed_at timestamptz,
  expires_at timestamptz,
  metadata jsonb,
  chunks jsonb,
  score double precision,
  match_reason text
)
language sql
stable
security invoker
as $$
  with ranked as (
    select
      r.id,
      r.workspace_id,
      r.knowledge_type,
      r.authority,
      r.title,
      r.content,
      r.structured_data,
      r.source_kind,
      r.source_id,
      r.source_uri,
      r.source_label,
      r.content_hash,
      r.published_at,
      r.observed_at,
      r.expires_at,
      r.metadata,
      jsonb_agg(c.content order by c.chunk_index) as chunks,
      max(ts_rank_cd(c.search_document, websearch_to_tsquery('simple', coalesce(p_query, ''))))
        * case r.authority
            when 'authoritative' then 1.00
            when 'operational' then 0.98
            when 'reference' then 0.88
            when 'guidance' then 0.78
            else 0.55
          end as score,
      case when lower(r.title) like '%' || lower(coalesce(p_query, '')) || '%' then 'title' else 'lexical' end as match_reason
    from public.greenfield_knowledge_records r
    join public.greenfield_knowledge_chunks c
      on c.record_id = r.id and c.workspace_id = r.workspace_id
    where r.workspace_id = p_workspace_id
      and r.knowledge_type <> 'live_operational'
      and (p_knowledge_types is null or r.knowledge_type = any(p_knowledge_types))
      and (r.expires_at is null or r.expires_at > now())
      and c.search_document @@ websearch_to_tsquery('simple', coalesce(p_query, ''))
    group by r.id
  )
  select *
  from ranked
  order by score desc, observed_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

grant execute on function public.greenfield_search_knowledge(uuid, text, text[], integer)
  to authenticated, service_role;
