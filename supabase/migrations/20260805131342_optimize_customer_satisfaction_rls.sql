-- Keep the workspace-scoped settings policies efficient and unambiguous.
drop policy if exists workspace_customer_satisfaction_settings_select_scoped
  on public.workspace_customer_satisfaction_settings;
drop policy if exists workspace_customer_satisfaction_settings_modify_scoped
  on public.workspace_customer_satisfaction_settings;

create policy workspace_customer_satisfaction_settings_scoped
  on public.workspace_customer_satisfaction_settings
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members membership
      where membership.workspace_id = workspace_customer_satisfaction_settings.workspace_id
        and membership.clerk_user_id = ((select auth.jwt()) ->> 'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members membership
      where membership.workspace_id = workspace_customer_satisfaction_settings.workspace_id
        and membership.clerk_user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

drop index if exists public.workspace_customer_satisfaction_settings_updated_idx;
