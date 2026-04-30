-- Rolling case state for v2 pipeline — persisteret per thread så lang-samtale
-- kontekst overlever på tværs af turns uden at truncere historik.
ALTER TABLE mail_threads
  ADD COLUMN IF NOT EXISTS case_state_json JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS mail_threads_case_state_json_idx
  ON mail_threads USING GIN (case_state_json)
  WHERE case_state_json IS NOT NULL;
