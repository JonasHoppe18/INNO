-- Workspace scope for unified agent knowledge.
-- Keeps shop_id as primary runtime scope, adds workspace_id for team visibility + RLS.

alter table public.agent_knowledge
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

-- Backfill workspace_id from the owning shop.
update public.agent_knowledge ak
set workspace_id = s.workspace_id
from public.shops s
where s.id = ak.shop_id
  and ak.workspace_id is null;

create index if not exists agent_knowledge_workspace_id_idx
  on public.agent_knowledge (workspace_id);

create index if not exists agent_knowledge_workspace_shop_idx
  on public.agent_knowledge (workspace_id, shop_id);

-- Keep workspace_id aligned with shop_id automatically.
create or replace function public.agent_knowledge_set_workspace_id()
returns trigger
language plpgsql
as $$
begin
  select s.workspace_id
    into new.workspace_id
  from public.shops s
  where s.id = new.shop_id;

  return new;
end;
$$;

drop trigger if exists trg_agent_knowledge_set_workspace_id on public.agent_knowledge;
create trigger trg_agent_knowledge_set_workspace_id
before insert or update of shop_id
on public.agent_knowledge
for each row
execute function public.agent_knowledge_set_workspace_id();

-- Ensure existing rows have workspace_id if a matching shop has one.
update public.agent_knowledge ak
set workspace_id = s.workspace_id
from public.shops s
where s.id = ak.shop_id
  and ak.workspace_id is distinct from s.workspace_id;

alter table public.agent_knowledge enable row level security;

drop policy if exists agent_knowledge_select_scoped on public.agent_knowledge;
drop policy if exists agent_knowledge_modify_scoped on public.agent_knowledge;

create policy agent_knowledge_select_scoped
on public.agent_knowledge
for select
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = agent_knowledge.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    workspace_id is null
    and exists (
      select 1
      from public.shops s
      where s.id = agent_knowledge.shop_id
        and (
          s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
          or exists (
            select 1
            from public.profiles p
            where p.user_id = s.owner_user_id
              and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
          )
        )
    )
  )
);

create policy agent_knowledge_modify_scoped
on public.agent_knowledge
for all
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = agent_knowledge.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    workspace_id is null
    and exists (
      select 1
      from public.shops s
      where s.id = agent_knowledge.shop_id
        and (
          s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
          or exists (
            select 1
            from public.profiles p
            where p.user_id = s.owner_user_id
              and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
          )
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
      where wm.workspace_id = agent_knowledge.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    workspace_id is null
    and exists (
      select 1
      from public.shops s
      where s.id = agent_knowledge.shop_id
        and (
          s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
          or exists (
            select 1
            from public.profiles p
            where p.user_id = s.owner_user_id
              and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
          )
        )
    )
  )
);

