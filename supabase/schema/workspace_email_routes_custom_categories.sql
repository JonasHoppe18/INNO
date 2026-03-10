-- Enable dynamic workspace-specific routing categories.

alter table public.mail_threads
  drop constraint if exists mail_threads_classification_key_check;

alter table public.mail_threads
  add constraint mail_threads_classification_key_check
  check (
    classification_key is null
    or length(btrim(classification_key)) > 0
  );
