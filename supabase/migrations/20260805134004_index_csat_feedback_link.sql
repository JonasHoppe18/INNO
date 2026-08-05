create index if not exists support_feedback_survey_request_idx
  on public.support_feedback (survey_request_id)
  where survey_request_id is not null;
