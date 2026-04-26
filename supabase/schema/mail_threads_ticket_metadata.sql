-- supabase/schema/mail_threads_ticket_metadata.sql
ALTER TABLE mail_threads
  ADD COLUMN IF NOT EXISTS issue_summary TEXT,
  ADD COLUMN IF NOT EXISTS detected_product_id BIGINT REFERENCES shop_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS mail_threads_detected_product_idx
  ON mail_threads(detected_product_id)
  WHERE detected_product_id IS NOT NULL;
