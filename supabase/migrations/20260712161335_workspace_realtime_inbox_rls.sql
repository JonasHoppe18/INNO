-- Inbox state belongs to the workspace. Postgres Changes applies SELECT RLS
-- before delivering a row, so every workspace member needs read access to the
-- shared thread/message rows even though writes continue through scoped server
-- routes using the service role.

drop policy if exists "mail_threads_select_workspace_members"
on public.mail_threads;

create policy "mail_threads_select_workspace_members"
on public.mail_threads
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = mail_threads.workspace_id
      and membership.clerk_user_id = (select auth.jwt() ->> 'sub')
  )
);

drop policy if exists "mail_messages_select_workspace_members"
on public.mail_messages;

create policy "mail_messages_select_workspace_members"
on public.mail_messages
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = mail_messages.workspace_id
      and membership.clerk_user_id = (select auth.jwt() ->> 'sub')
  )
);
