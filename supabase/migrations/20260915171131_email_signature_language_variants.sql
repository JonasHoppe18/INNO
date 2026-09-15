-- Store optional employee sign-off variants by normalized language code.
-- The existing profile signature remains the default fallback.
alter table public.workspace_email_signatures
  add column if not exists language_signatures jsonb not null default '{}'::jsonb;

alter table public.workspace_email_signatures
  drop constraint if exists workspace_email_signatures_language_signatures_object;

alter table public.workspace_email_signatures
  add constraint workspace_email_signatures_language_signatures_object
  check (jsonb_typeof(language_signatures) = 'object');
