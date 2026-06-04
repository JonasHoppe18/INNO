-- Phase 2: gold-eval foundation.
--
-- A small, hand-curated gold dataset + a stage-by-stage result store so future
-- draft-quality changes can be measured objectively against a fixed reference set.
--
-- Why NEW tables instead of reusing existing eval tables:
--   - eval_results is LLM-judge shaped (correctness/completeness/tone 1-5 + overall_10);
--     it has no generation_id, no per-stage intent/retrieval/facts/action fields. It
--     can't carry the deterministic stage-by-stage signals this dataset needs.
--   - ticket_examples are STYLE examples (good human replies for few-shot/tone). They
--     must NOT be blended with gold evals, which are graded test cases.
-- So gold eval gets its own self-contained trio (runs / cases / results), independent
-- of the worker-driven eval_runs/eval_results path.
--
-- RLS mirrors draft_generations: service_role full access; authenticated scoped via
-- workspace_members, with a shops-owner fallback when workspace_id is null.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- gold_eval_cases — the hand-curated reference cases.
-- ---------------------------------------------------------------------------
create table if not exists public.gold_eval_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  shop_id uuid not null references public.shops(id) on delete cascade,

  title text not null,
  category text,

  customer_message text not null,
  thread_history_json jsonb,
  order_context_json jsonb,

  expected_intent text,
  required_facts_json jsonb,
  gold_knowledge_chunk_ids jsonb,
  expected_resolution text,
  expected_action_json jsonb,
  ideal_reply text,
  autopilot_allowed boolean not null default false,

  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gold_eval_cases_shop_active_idx
  on public.gold_eval_cases (shop_id, is_active);

create index if not exists gold_eval_cases_workspace_active_idx
  on public.gold_eval_cases (workspace_id, is_active)
  where workspace_id is not null;

-- ---------------------------------------------------------------------------
-- gold_eval_runs — one row per batch execution of the gold runner.
-- ---------------------------------------------------------------------------
create table if not exists public.gold_eval_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  shop_id uuid not null references public.shops(id) on delete cascade,

  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  pipeline_version text not null default 'v2',
  case_count integer,
  summary_json jsonb,
  notes text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists gold_eval_runs_shop_created_idx
  on public.gold_eval_runs (shop_id, created_at desc);

-- ---------------------------------------------------------------------------
-- gold_eval_results — one row per case per run. Stage-by-stage outcomes.
-- Deterministic *_correct flags are nullable: null = not auto-graded (needs
-- manual assessment); booleans = the deterministic check's verdict. This keeps
-- automatic signals and manual judgement cleanly separable.
-- ---------------------------------------------------------------------------
create table if not exists public.gold_eval_results (
  id uuid primary key default gen_random_uuid(),
  eval_case_id uuid not null references public.gold_eval_cases(id) on delete cascade,
  eval_run_id uuid not null references public.gold_eval_runs(id) on delete cascade,
  generation_id uuid references public.draft_generations(id) on delete set null,

  actual_intent text,
  intent_correct boolean,

  retrieved_chunk_ids jsonb,
  retrieval_hit_at_k jsonb,

  facts_json jsonb,
  facts_correct boolean,

  actual_resolution text,
  resolution_correct boolean,

  actual_action_json jsonb,
  action_correct boolean,

  final_draft_text text,

  answer_completeness_score numeric,
  tone_score numeric,
  send_ready_score numeric,
  verifier_confidence numeric,

  total_latency_ms integer,
  input_tokens integer,
  output_tokens integer,

  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists gold_eval_results_run_idx
  on public.gold_eval_results (eval_run_id, created_at desc);

create index if not exists gold_eval_results_case_idx
  on public.gold_eval_results (eval_case_id, created_at desc);

create index if not exists gold_eval_results_generation_idx
  on public.gold_eval_results (generation_id)
  where generation_id is not null;

-- ---------------------------------------------------------------------------
-- RLS — same shape as draft_generations.
-- ---------------------------------------------------------------------------
alter table public.gold_eval_cases enable row level security;
alter table public.gold_eval_runs enable row level security;
alter table public.gold_eval_results enable row level security;

-- service_role: full access on all three.
drop policy if exists gold_eval_cases_service_role on public.gold_eval_cases;
create policy gold_eval_cases_service_role on public.gold_eval_cases
  for all to service_role using (true) with check (true);

drop policy if exists gold_eval_runs_service_role on public.gold_eval_runs;
create policy gold_eval_runs_service_role on public.gold_eval_runs
  for all to service_role using (true) with check (true);

drop policy if exists gold_eval_results_service_role on public.gold_eval_results;
create policy gold_eval_results_service_role on public.gold_eval_results
  for all to service_role using (true) with check (true);

-- authenticated SELECT: scoped by workspace membership, shops-owner fallback.
drop policy if exists gold_eval_cases_select_scoped on public.gold_eval_cases;
create policy gold_eval_cases_select_scoped on public.gold_eval_cases
  for select to authenticated
  using (
    (
      workspace_id is not null
      and exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = gold_eval_cases.workspace_id
          and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
      )
    )
    or (
      workspace_id is null
      and exists (
        select 1 from public.shops s
        where s.id = gold_eval_cases.shop_id
          and (
            s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
            or exists (
              select 1 from public.profiles p
              where p.user_id = s.owner_user_id
                and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
            )
          )
      )
    )
  );

drop policy if exists gold_eval_runs_select_scoped on public.gold_eval_runs;
create policy gold_eval_runs_select_scoped on public.gold_eval_runs
  for select to authenticated
  using (
    (
      workspace_id is not null
      and exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = gold_eval_runs.workspace_id
          and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
      )
    )
    or (
      workspace_id is null
      and exists (
        select 1 from public.shops s
        where s.id = gold_eval_runs.shop_id
          and (
            s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
            or exists (
              select 1 from public.profiles p
              where p.user_id = s.owner_user_id
                and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
            )
          )
      )
    )
  );

-- results inherit scope from their run.
drop policy if exists gold_eval_results_select_scoped on public.gold_eval_results;
create policy gold_eval_results_select_scoped on public.gold_eval_results
  for select to authenticated
  using (
    exists (
      select 1 from public.gold_eval_runs r
      where r.id = gold_eval_results.eval_run_id
        and (
          (
            r.workspace_id is not null
            and exists (
              select 1 from public.workspace_members wm
              where wm.workspace_id = r.workspace_id
                and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
            )
          )
          or (
            r.workspace_id is null
            and exists (
              select 1 from public.shops s
              where s.id = r.shop_id
                and (
                  s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
                  or exists (
                    select 1 from public.profiles p
                    where p.user_id = s.owner_user_id
                      and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
                  )
                )
            )
          )
        )
    )
  );
