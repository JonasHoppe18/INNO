-- Cached thread translation payloads for internal inbox review.

create table if not exists public.thread_translations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.mail_threads(id) on delete cascade,
  source_type text not null check (source_type in ('conversation', 'draft')),
  target_language text not null,
  source_hash text not null,
  translated_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint thread_translations_unique_source
    unique (thread_id, source_type, target_language, source_hash)
);

create index if not exists thread_translations_workspace_thread_idx
  on public.thread_translations (workspace_id, thread_id, source_type, target_language, updated_at desc);

create or replace function public.set_thread_translations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_thread_translations_updated_at on public.thread_translations;
create trigger trg_thread_translations_updated_at
before update on public.thread_translations
for each row
execute function public.set_thread_translations_updated_at();

alter table public.thread_translations enable row level security;

drop policy if exists thread_translations_select_scoped on public.thread_translations;
drop policy if exists thread_translations_modify_scoped on public.thread_translations;

create policy thread_translations_select_scoped
on public.thread_translations
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = thread_translations.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy thread_translations_modify_scoped
on public.thread_translations
for all
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = thread_translations.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = thread_translations.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);
