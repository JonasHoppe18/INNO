-- Greenfield support-agent retrieval experiment only.
-- Added because real-data lexical retrieval failed natural-language support queries.
-- This is deliberately separate from V2/V3 knowledge tables, RPCs, and embeddings.

create extension if not exists vector with schema public;

alter table public.greenfield_knowledge_chunks
  add column if not exists embedding vector(1536);

create index if not exists greenfield_knowledge_chunks_embedding_idx
  on public.greenfield_knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

create or replace function public.greenfield_search_knowledge_semantic(
  p_workspace_id uuid,
  p_query_embedding vector(1536),
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
  chunk_id uuid,
  chunk_index integer,
  chunk_content text,
  score double precision,
  match_reason text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ranked_chunks as (
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
      c.id as chunk_id,
      c.chunk_index,
      c.content as chunk_content,
      1 - (c.embedding <=> p_query_embedding) as score,
      row_number() over (
        partition by r.id
        order by c.embedding <=> p_query_embedding, c.chunk_index
      ) as row_rank
    from public.greenfield_knowledge_records r
    join public.greenfield_knowledge_chunks c
      on c.record_id = r.id
     and c.workspace_id = r.workspace_id
    where r.workspace_id = p_workspace_id
      and r.knowledge_type <> 'live_operational'
      and (p_knowledge_types is null or r.knowledge_type = any(p_knowledge_types))
      and (r.expires_at is null or r.expires_at > now())
      and c.embedding is not null
  )
  select
    id,
    workspace_id,
    knowledge_type,
    authority,
    title,
    content,
    structured_data,
    source_kind,
    source_id,
    source_uri,
    source_label,
    content_hash,
    published_at,
    observed_at,
    expires_at,
    metadata,
    chunk_id,
    chunk_index,
    chunk_content,
    score,
    'semantic'::text as match_reason
  from ranked_chunks
  where row_rank = 1
  order by score desc, observed_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

grant execute on function public.greenfield_search_knowledge_semantic(uuid, vector, text[], integer)
  to authenticated, service_role;
