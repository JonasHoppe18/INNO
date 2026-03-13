alter table public.mail_messages
  add column if not exists clean_body_text text,
  add column if not exists clean_body_html text,
  add column if not exists quoted_body_text text,
  add column if not exists quoted_body_html text;

update public.mail_messages
set
  clean_body_text = coalesce(clean_body_text, body_text),
  clean_body_html = coalesce(clean_body_html, body_html)
where clean_body_text is null
   or clean_body_html is null;
