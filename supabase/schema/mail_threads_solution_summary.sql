ALTER TABLE mail_threads
  ADD COLUMN IF NOT EXISTS solution_summary TEXT;
