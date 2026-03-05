alter table if exists public.agent_knowledge
  add column if not exists source_id text;

alter table if exists public.agent_knowledge
  add column if not exists chunk_index integer;

create unique index if not exists agent_knowledge_scope_source_chunk_uidx
  on public.agent_knowledge (workspace_id, shop_id, source_provider, source_id, chunk_index);

create index if not exists agent_knowledge_workspace_shop_provider_idx
  on public.agent_knowledge (workspace_id, shop_id, source_provider);
