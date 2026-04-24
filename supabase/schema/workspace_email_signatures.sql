-- Per-user outbound signature + HTML footer template (workspace scoped).
create table if not exists public.workspace_email_signatures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  closing_text text,
  template_html text not null default '',
  template_text_fallback text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Legacy compatibility (old schema had shop_id + unique(workspace_id, shop_id, user_id)).
alter table public.workspace_email_signatures
  drop constraint if exists workspace_email_signatures_workspace_shop_user_unique;

drop index if exists workspace_email_signatures_shop_idx;

-- If an old shop_id column exists, remove duplicates before enforcing user uniqueness.
with ranked as (
  select
    id,
    row_number() over (
      partition by workspace_id, user_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.workspace_email_signatures
)
delete from public.workspace_email_signatures wes
using ranked
where wes.id = ranked.id
  and ranked.rn > 1;

alter table public.workspace_email_signatures
  drop column if exists shop_id;

create unique index if not exists workspace_email_signatures_workspace_user_unique
  on public.workspace_email_signatures (workspace_id, user_id);

create index if not exists workspace_email_signatures_workspace_idx
  on public.workspace_email_signatures (workspace_id, updated_at desc);

create index if not exists workspace_email_signatures_user_idx
  on public.workspace_email_signatures (user_id, updated_at desc);

alter table public.workspace_email_signatures enable row level security;

drop policy if exists workspace_email_signatures_select_scoped on public.workspace_email_signatures;
drop policy if exists workspace_email_signatures_modify_own_scoped on public.workspace_email_signatures;

create policy workspace_email_signatures_select_scoped
on public.workspace_email_signatures
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_signatures.workspace_id
      and wm.clerk_user_id = auth.jwt() ->> 'sub'
  )
);

create policy workspace_email_signatures_modify_own_scoped
on public.workspace_email_signatures
for all
to authenticated
using (
  workspace_id is not null
  and user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_signatures.workspace_id
      and wm.clerk_user_id = auth.jwt() ->> 'sub'
  )
)
with check (
  workspace_id is not null
  and user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_signatures.workspace_id
      and wm.clerk_user_id = auth.jwt() ->> 'sub'
  )
);
