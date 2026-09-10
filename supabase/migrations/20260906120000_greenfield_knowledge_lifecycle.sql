-- Greenfield support-agent lifecycle only.
-- Lifecycle is stored in the existing metadata envelope so this does not
-- create a second knowledge store or alter V2/V3 knowledge tables.

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
set search_path = public, pg_temp
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
      and coalesce(r.metadata ->> 'lifecycle_status', 'published') = 'published'
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
      and coalesce(r.metadata ->> 'lifecycle_status', 'published') = 'published'
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

grant execute on function public.greenfield_search_knowledge(uuid, text, text[], integer)
  to authenticated, service_role;
grant execute on function public.greenfield_search_knowledge_semantic(uuid, vector, text[], integer)
  to authenticated, service_role;
