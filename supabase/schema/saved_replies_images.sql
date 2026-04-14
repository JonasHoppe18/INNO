alter table if exists public.saved_replies
  add column if not exists image_filename text,
  add column if not exists image_mime_type text,
  add column if not exists image_content_base64 text,
  add column if not exists image_size_bytes integer,
  add column if not exists image_attachments_json jsonb;
