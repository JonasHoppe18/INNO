-- Unified knowledge base for agent RAG (tickets + documents + snippets)
-- Idempotent migration script.

create extension if not exists vector;

create table if not exists public.agent_knowledge (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  content text not null,
  source_type text not null
    check (source_type in ('ticket', 'document', 'snippet')),
  source_provider text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_knowledge_shop_id_idx
  on public.agent_knowledge (shop_id);

create index if not exists agent_knowledge_source_type_idx
  on public.agent_knowledge (source_type);

create index if not exists agent_knowledge_created_at_idx
  on public.agent_knowledge (created_at desc);

create index if not exists agent_knowledge_embedding_hnsw_idx
  on public.agent_knowledge
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create or replace function public.match_agent_knowledge(
  query_embedding vector(1536),
  match_count int default 5,
  filter_shop_id uuid default null
)
returns table (
  id bigint,
  shop_id uuid,
  content text,
  source_type text,
  source_provider text,
  metadata jsonb,
  similarity float
)
language plpgsql
stable
as $$
begin
  return query
  select
    ak.id,
    ak.shop_id,
    ak.content,
    ak.source_type,
    ak.source_provider,
    ak.metadata,
    1 - (ak.embedding <=> query_embedding) as similarity
  from public.agent_knowledge ak
  where (filter_shop_id is null or ak.shop_id = filter_shop_id)
    and ak.source_type != 'ticket'
  order by ak.embedding <=> query_embedding
  limit greatest(match_count, 1);
end;
$$;

grant execute on function public.match_agent_knowledge(vector(1536), int, uuid)
to authenticated, service_role;
