-- Workspace media library: images uploaded once and reused across email designs.
-- Files live in the public bucket so email clients can load them; rows are
-- soft-deleted so sent emails and saved designs keep their images.
create table if not exists public.workspace_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  storage_path text not null unique,
  public_url text not null,
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/gif')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists workspace_media_library_idx
  on public.workspace_media (workspace_id, created_at desc, id desc)
  where deleted_at is null;

alter table public.workspace_media enable row level security;

create policy workspace_media_select_scoped
  on public.workspace_media
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members membership
      where membership.workspace_id = workspace_media.workspace_id
        and membership.clerk_user_id = (select auth.jwt() ->> 'sub')
    )
  );

-- Brand logos uploaded before the library existed become library images.
insert into public.workspace_media (workspace_id, storage_path, public_url, file_name, content_type, size_bytes, created_at)
select
  w.id,
  o.name,
  w.brand_logo_url,
  'Logo',
  o.metadata ->> 'mimetype',
  (o.metadata ->> 'size')::integer,
  coalesce(o.created_at, now())
from public.workspaces w
join storage.objects o
  on o.bucket_id = 'workspace-email-signature-assets'
 and o.name = split_part(w.brand_logo_url, '/public/workspace-email-signature-assets/', 2)
where w.brand_logo_url is not null
  and o.metadata ->> 'mimetype' in ('image/png', 'image/jpeg', 'image/gif')
on conflict (storage_path) do nothing;
