-- Public, unauthenticated logo assets for outbound email signatures.
-- Uploads are performed only by the workspace-scoped application API.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-email-signature-assets',
  'workspace-email-signature-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
