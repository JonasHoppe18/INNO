alter table public.mail_messages
  add column if not exists extracted_customer_name text,
  add column if not exists extracted_customer_email text,
  add column if not exists extracted_customer_fields jsonb,
  add column if not exists sender_identity_source text;
