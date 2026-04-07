ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS human_reply TEXT,
  ADD COLUMN IF NOT EXISTS zendesk_ticket_id TEXT;
