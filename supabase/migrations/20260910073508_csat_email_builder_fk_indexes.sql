-- Cover the foreign keys used by CSAT template and response-token cascades.
create index if not exists csat_email_template_versions_template_idx
  on public.csat_email_template_versions (template_id);

create index if not exists csat_survey_tokens_thread_idx
  on public.csat_survey_tokens (thread_id);
