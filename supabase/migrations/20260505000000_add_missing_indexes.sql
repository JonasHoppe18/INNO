-- Fix high Disk IO: add missing indexes on hot tables.
-- mail_threads and mail_messages had only primary keys, causing sequential
-- scans on every inbox load, thread view, and email dedup lookup.

-- mail_threads: primary inbox query (user sees their inbox)
CREATE INDEX IF NOT EXISTS mail_threads_user_updated_idx
  ON public.mail_threads (user_id, updated_at DESC);

-- mail_threads: mailbox-scoped inbox view
CREATE INDEX IF NOT EXISTS mail_threads_mailbox_updated_idx
  ON public.mail_threads (mailbox_id, updated_at DESC);

-- mail_threads: thread dedup lookup via provider_thread_id in postmark-inbound
CREATE INDEX IF NOT EXISTS mail_threads_provider_thread_idx
  ON public.mail_threads (provider, provider_thread_id);

-- mail_threads: status-filtered inbox (open/pending tickets)
CREATE INDEX IF NOT EXISTS mail_threads_user_status_idx
  ON public.mail_threads (user_id, status, updated_at DESC);

-- mail_messages: fetch messages in a thread (thread view)
CREATE INDEX IF NOT EXISTS mail_messages_thread_created_idx
  ON public.mail_messages (thread_id, created_at DESC);

-- mail_messages: dedup lookup by provider_message_id in postmark-inbound
CREATE INDEX IF NOT EXISTS mail_messages_provider_msg_idx
  ON public.mail_messages (provider, provider_message_id);

-- mail_messages: mailbox-scoped message history
CREATE INDEX IF NOT EXISTS mail_messages_mailbox_created_idx
  ON public.mail_messages (mailbox_id, created_at DESC);
