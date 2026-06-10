create extension if not exists pgcrypto;

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  category text not null,
  document_type text not null,
  title text not null,
  draft_markdown text not null default '',
  published_markdown text not null default '',
  has_unpublished_changes boolean not null default false,
  published_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_documents_category_check
    check (length(btrim(category)) > 0),
  constraint knowledge_documents_document_type_check
    check (length(btrim(document_type)) > 0),
  constraint knowledge_documents_title_check
    check (length(btrim(title)) > 0),
  constraint knowledge_documents_shop_category_type_key
    unique (shop_id, category, document_type)
);

create index if not exists knowledge_documents_shop_category_idx
  on public.knowledge_documents (shop_id, category, document_type);

create or replace function public.set_knowledge_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_knowledge_documents_updated_at on public.knowledge_documents;
create trigger trg_knowledge_documents_updated_at
before update on public.knowledge_documents
for each row
execute function public.set_knowledge_documents_updated_at();

alter table public.knowledge_documents enable row level security;

drop policy if exists knowledge_documents_select_scoped on public.knowledge_documents;
drop policy if exists knowledge_documents_modify_scoped on public.knowledge_documents;

create policy knowledge_documents_select_scoped
on public.knowledge_documents
for select
to authenticated
using (
  exists (
    select 1
    from public.shops s
    where s.id = knowledge_documents.shop_id
      and (
        (
          s.workspace_id is not null
          and exists (
            select 1
            from public.workspace_members wm
            where wm.workspace_id = s.workspace_id
              and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
          )
        )
        or s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
      )
  )
);

create policy knowledge_documents_modify_scoped
on public.knowledge_documents
for all
to authenticated
using (
  exists (
    select 1
    from public.shops s
    where s.id = knowledge_documents.shop_id
      and (
        (
          s.workspace_id is not null
          and exists (
            select 1
            from public.workspace_members wm
            where wm.workspace_id = s.workspace_id
              and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
          )
        )
        or s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
      )
  )
)
with check (
  exists (
    select 1
    from public.shops s
    where s.id = knowledge_documents.shop_id
      and (
        (
          s.workspace_id is not null
          and exists (
            select 1
            from public.workspace_members wm
            where wm.workspace_id = s.workspace_id
              and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
          )
        )
        or s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
      )
  )
);
