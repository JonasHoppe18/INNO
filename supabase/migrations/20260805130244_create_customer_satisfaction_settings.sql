-- Workspace-scoped CSAT delivery, message and branding preferences.
-- The application API is the only write path for this private configuration.

create table if not exists public.workspace_customer_satisfaction_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  enabled boolean not null default true,
  send_delay text not null default '1h' check (send_delay in ('immediately', '1h', '24h')),
  exclude_auto_resolved boolean not null default true,
  customer_only boolean not null default true,
  subject text not null default 'How did we do?',
  headline text not null default 'How was your support experience?',
  intro text not null default 'We''d love to hear how we did. Your feedback helps us make every reply better.',
  thank_you text not null default 'Thanks for helping us improve.',
  company_name text not null default '',
  sender_name text not null default '',
  footer text not null default 'You''re receiving this because your support conversation was resolved.',
  accent_color text not null default '#635bff' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_path text,
  logo_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_customer_satisfaction_settings_workspace_unique unique (workspace_id)
);

create index if not exists workspace_customer_satisfaction_settings_updated_idx
  on public.workspace_customer_satisfaction_settings (workspace_id, updated_at desc);

alter table public.workspace_customer_satisfaction_settings enable row level security;

drop policy if exists workspace_customer_satisfaction_settings_select_scoped
  on public.workspace_customer_satisfaction_settings;
create policy workspace_customer_satisfaction_settings_select_scoped
  on public.workspace_customer_satisfaction_settings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members membership
      where membership.workspace_id = workspace_customer_satisfaction_settings.workspace_id
        and membership.clerk_user_id = (select auth.jwt() ->> 'sub')
    )
  );

drop policy if exists workspace_customer_satisfaction_settings_modify_scoped
  on public.workspace_customer_satisfaction_settings;
create policy workspace_customer_satisfaction_settings_modify_scoped
  on public.workspace_customer_satisfaction_settings
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members membership
      where membership.workspace_id = workspace_customer_satisfaction_settings.workspace_id
        and membership.clerk_user_id = (select auth.jwt() ->> 'sub')
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members membership
      where membership.workspace_id = workspace_customer_satisfaction_settings.workspace_id
        and membership.clerk_user_id = (select auth.jwt() ->> 'sub')
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-assets',
  'workspace-assets',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/svg+xml']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
