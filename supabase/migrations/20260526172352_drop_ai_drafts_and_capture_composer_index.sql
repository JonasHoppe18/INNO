-- Phase 4 cleanup — 2026-05-26
--
-- 1. Drop the legacy `ai_drafts` table. It was used to track draft URLs synced
--    back to Gmail/Outlook draft folders. The current pipeline writes drafts
--    directly to `mail_messages.ai_draft_text` (inbound rows) and to composer
--    rows (`is_draft=true, from_me=true`), so `ai_drafts` is unreferenced —
--    grep confirmed 0 callsites in apps/web or supabase/functions, and a row
--    count check returned 0 rows in production.
--
-- 2. Re-declare the unique composer-draft index. The live production database
--    already has this index (added out-of-band during the cross-thread
--    contamination cleanup), but it was missing from the migration history.
--    `create unique index if not exists` makes this safe for both the live
--    DB (no-op) and fresh databases (creates).

drop table if exists public.ai_drafts;

create unique index if not exists uniq_active_composer_draft_per_thread
  on public.mail_messages (thread_id)
  where is_draft = true and from_me = true;
