alter table public.mail_threads
  add column if not exists customer_language text;
