-- Drop the provider check constraint entirely.
-- Old constraint only allowed 'gmail'/'outlook', blocking postmark-inbound inserts.
-- Existing rows may have 'smtp' or other legacy values, so we just drop it.
ALTER TABLE public.mail_attachments
  DROP CONSTRAINT IF EXISTS mail_attachments_provider_check;
