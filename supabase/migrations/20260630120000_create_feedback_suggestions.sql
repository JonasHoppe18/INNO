-- Feedback-2a-1: review-only learning-loop suggestions.
--
-- An inert backlog of improvement suggestions derived from human edits. Nothing
-- here goes live automatically: rows are written by a future detector (2a-2) via
-- service_role, reviewed by a human (2c), and only ever turned into a controlled
-- follow-up task — never auto-applied to knowledge / prompts / eval / Shopify.
--
-- Tenancy + RLS mirror shop_product_compatibility (workspace members or shop
-- owner). Writes are service_role only; authenticated access is SELECT-only.
-- Review UPDATEs (status / reviewer fields) are deliberately deferred to a
-- controlled server route in 2c, because Postgres RLS cannot restrict WHICH
-- columns an UPDATE touches — a naive FOR UPDATE policy would let a workspace
-- member set status='applied' or rewrite root_cause/evidence_json.
--
-- Purely additive. No data writes.

create extension if not exists pgcrypto;

create table if not exists public.feedback_suggestions (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  generation_id   uuid references public.draft_generations(id) on delete set null,
  draft_id        text,
  thread_id       uuid references public.mail_threads(id) on delete set null,
  suggestion_type text not null,
  root_cause      text not null,
  confidence      numeric,
  evidence_json   jsonb not null default '{}'::jsonb,
  proposed_change_summary text,
  status          text not null default 'suggested',
  reviewer_user_id text,
  review_note     text,
  follow_up_task_ref text,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  updated_at      timestamptz not null default now(),
  dedup_key       text not null,

  constraint feedback_suggestions_type_check check (
    suggestion_type in (
      'knowledge_gap_suggestion',
      'knowledge_doc_update_suggestion',
      'eval_golden_case_suggestion',
      'writer_style_rule_suggestion',
      'safety_guardrail_suggestion',
      'product_compatibility_data_suggestion'
    )
  ),
  constraint feedback_suggestions_root_cause_check check (
    root_cause in (
      'style_tone',
      'too_verbose',
      'missing_knowledge',
      'incorrect_policy',
      'compatibility',
      'live_fact_tracking',
      'refund_return_nuance',
      'product_specific',
      'unclear_intent',
      'other',
      'insufficient_data'
    )
  ),
  constraint feedback_suggestions_status_check check (
    status in ('suggested', 'reviewed', 'approved', 'rejected', 'applied')
  ),
  constraint feedback_suggestions_confidence_check check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  constraint feedback_suggestions_summary_len_check check (
    proposed_change_summary is null or char_length(proposed_change_summary) <= 600
  )
);

-- Idempotency: one suggestion per (candidate, type).
create unique index if not exists feedback_suggestions_dedup_key_uidx
  on public.feedback_suggestions (dedup_key);

create index if not exists feedback_suggestions_ws_status_idx
  on public.feedback_suggestions (workspace_id, status, created_at desc);

create index if not exists feedback_suggestions_ws_type_cause_idx
  on public.feedback_suggestions (workspace_id, suggestion_type, root_cause);

create index if not exists feedback_suggestions_shop_created_idx
  on public.feedback_suggestions (shop_id, created_at desc);

create index if not exists feedback_suggestions_generation_id_idx
  on public.feedback_suggestions (generation_id, created_at desc)
  where generation_id is not null;

create index if not exists feedback_suggestions_thread_id_idx
  on public.feedback_suggestions (thread_id, created_at desc)
  where thread_id is not null;

create or replace function public.set_feedback_suggestions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_feedback_suggestions_updated_at on public.feedback_suggestions;
create trigger trg_feedback_suggestions_updated_at
before update on public.feedback_suggestions
for each row
execute function public.set_feedback_suggestions_updated_at();

alter table public.feedback_suggestions enable row level security;

drop policy if exists feedback_suggestions_service_role on public.feedback_suggestions;
drop policy if exists feedback_suggestions_select_scoped on public.feedback_suggestions;

-- service_role: full access (detector writes, future review route).
create policy feedback_suggestions_service_role
  on public.feedback_suggestions
  for all
  to service_role
  using (true)
  with check (true);

-- authenticated: workspace-scoped SELECT only. No INSERT/UPDATE/DELETE policy —
-- all writes go through service_role. Mirrors shop_product_compatibility's
-- membership/owner scoping.
create policy feedback_suggestions_select_scoped
  on public.feedback_suggestions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.shops s
      where s.id = feedback_suggestions.shop_id
        and (
          (
            s.workspace_id is not null
            and exists (
              select 1
              from public.workspace_members wm
              where wm.workspace_id = s.workspace_id
                and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
            )
          )
          or s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
        )
    )
  );
