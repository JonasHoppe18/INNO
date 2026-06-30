-- Feedback-1a: append-only draft feedback event capture.
--
-- A measurement sidecar for the draft lifecycle. Existing draft_generations /
-- drafts remain the source of truth for the pipeline trace and raw reply text;
-- this table records only ids + classification + numeric metrics so the
-- lifecycle sequence (generated → inserted → edited → regenerated → sent /
-- discarded) can be reconstructed and measured.
--
-- Append-only by construction: only service_role may write; authenticated users
-- get workspace-scoped read access and NO insert/update/delete policy.
--
-- This migration is purely additive. It does not touch generate-draft behavior,
-- prompts, knowledge, Shopify, or any auto-promotion path. No call sites are
-- wired in Feedback-1a.

create extension if not exists pgcrypto;

create table if not exists public.draft_feedback_events (
  id              uuid primary key default gen_random_uuid(),
  generation_id   uuid references public.draft_generations(id) on delete set null,
  draft_id        text,
  thread_id       uuid references public.mail_threads(id) on delete cascade,
  shop_id         uuid not null references public.shops(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  agent_user_id   text,
  event_type      text not null,
  routing_hint    text,
  block_send_recommended boolean,
  edit_classification    text,
  edit_distance   integer,
  edit_delta_pct  numeric,
  payload_json    jsonb not null default '{}'::jsonb,
  dedup_key       text not null,
  created_at      timestamptz not null default now(),

  constraint draft_feedback_events_event_type_check check (
    event_type in (
      'draft_generated',
      'draft_inserted',
      'draft_edited',
      'draft_sent',
      'draft_sent_without_edit',
      'draft_sent_with_edit',
      'draft_discarded',
      'draft_regenerated',
      'safety_block_shown',
      'safety_block_overridden'
    )
  ),
  constraint draft_feedback_events_edit_class_check check (
    edit_classification is null
    or edit_classification in ('no_edit', 'minor_edit', 'major_edit')
  ),
  constraint draft_feedback_events_routing_hint_check check (
    routing_hint is null
    or routing_hint in ('auto', 'review', 'block')
  )
);

-- Idempotency: the deterministic dedup_key collapses retries / fallback resends
-- to a single row. A second insert raises 23505, which emitDraftEvent treats as
-- a successful no-op.
create unique index if not exists draft_feedback_events_dedup_key_uidx
  on public.draft_feedback_events (dedup_key);

create index if not exists draft_feedback_events_generation_id_idx
  on public.draft_feedback_events (generation_id, created_at desc)
  where generation_id is not null;

create index if not exists draft_feedback_events_thread_id_idx
  on public.draft_feedback_events (thread_id, created_at desc);

create index if not exists draft_feedback_events_shop_created_idx
  on public.draft_feedback_events (shop_id, created_at desc);

create index if not exists draft_feedback_events_workspace_type_idx
  on public.draft_feedback_events (workspace_id, event_type, created_at desc);

alter table public.draft_feedback_events enable row level security;

drop policy if exists draft_feedback_events_service_role on public.draft_feedback_events;
drop policy if exists draft_feedback_events_select_scoped on public.draft_feedback_events;

-- service_role: full access (every insertion point uses the service client).
create policy draft_feedback_events_service_role
  on public.draft_feedback_events
  for all
  to service_role
  using (true)
  with check (true);

-- authenticated: workspace-scoped read only. No insert/update/delete policy is
-- defined, so the table is append-only and forge-proof from the client side.
-- workspace_id is NOT NULL here, so unlike draft_generations the policy needs no
-- shop-owner fallback branch.
create policy draft_feedback_events_select_scoped
  on public.draft_feedback_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = draft_feedback_events.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  );
