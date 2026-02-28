-- Workspace-only RLS for custom inboxes.
-- Backfills legacy user-scoped rows into a workspace when possible.

with latest_membership as (
  select
    p.user_id,
    wm.workspace_id,
    row_number() over (
      partition by p.user_id
      order by wm.created_at desc nulls last
    ) as rn
  from public.profiles p
  join public.workspace_members wm
    on wm.clerk_user_id = p.clerk_user_id
)
update public.workspace_inboxes wi
set
  workspace_id = lm.workspace_id,
  updated_at = now()
from latest_membership lm
where wi.workspace_id is null
  and wi.user_id = lm.user_id
  and lm.rn = 1;

alter table public.workspace_inboxes enable row level security;

drop policy if exists workspace_inboxes_select_scoped on public.workspace_inboxes;
drop policy if exists workspace_inboxes_modify_scoped on public.workspace_inboxes;

create policy workspace_inboxes_select_scoped
on public.workspace_inboxes
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_inboxes.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy workspace_inboxes_modify_scoped
on public.workspace_inboxes
for all
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_inboxes.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_inboxes.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);
