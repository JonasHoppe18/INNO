create extension if not exists pgcrypto;

create table if not exists public.knowledge_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  shop_id uuid references public.shops(id) on delete cascade,
  slug text not null,
  label text not null,
  icon text not null default 'Tag',
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_categories_scope_check
    check (workspace_id is not null or shop_id is not null),
  constraint knowledge_categories_slug_check
    check (length(btrim(slug)) > 0),
  constraint knowledge_categories_label_check
    check (length(btrim(label)) > 0)
);

create unique index if not exists knowledge_categories_workspace_slug_uidx
  on public.knowledge_categories (workspace_id, slug)
  where workspace_id is not null;

create unique index if not exists knowledge_categories_shop_slug_uidx
  on public.knowledge_categories (shop_id, slug)
  where shop_id is not null;

create index if not exists knowledge_categories_workspace_sort_idx
  on public.knowledge_categories (workspace_id, sort_order, created_at);

create index if not exists knowledge_categories_shop_sort_idx
  on public.knowledge_categories (shop_id, sort_order, created_at);

alter table public.knowledge_categories enable row level security;

drop policy if exists knowledge_categories_select_scoped on public.knowledge_categories;
drop policy if exists knowledge_categories_modify_scoped on public.knowledge_categories;

create policy knowledge_categories_select_scoped
on public.knowledge_categories
for select
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = knowledge_categories.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    shop_id is not null
    and exists (
      select 1
      from public.shops s
      where s.id = knowledge_categories.shop_id
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
);

create policy knowledge_categories_modify_scoped
on public.knowledge_categories
for all
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = knowledge_categories.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    shop_id is not null
    and exists (
      select 1
      from public.shops s
      where s.id = knowledge_categories.shop_id
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
)
with check (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = knowledge_categories.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    shop_id is not null
    and exists (
      select 1
      from public.shops s
      where s.id = knowledge_categories.shop_id
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
);
