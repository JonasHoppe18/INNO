create extension if not exists pgcrypto;

create table if not exists public.draft_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  thread_id uuid references public.mail_threads(id) on delete cascade,
  message_id uuid references public.mail_messages(id) on delete set null,
  draft_id text,
  pipeline_version text not null default 'v2',
  created_at timestamptz not null default now(),
  completed_at timestamptz,

  case_state_json jsonb,
  planner_output_json jsonb,
  facts_json jsonb,
  retrieved_chunk_ids jsonb,
  retrieval_trace_json jsonb,
  ticket_example_ids jsonb,
  resolution_plan_json jsonb,
  action_decision_json jsonb,
  verifier_output_json jsonb,

  writer_model text,
  writer_prompt_version text,
  writer_prompt_hash text,
  writer_input_tokens integer,
  writer_output_tokens integer,
  writer_cost_usd numeric,
  writer_latency_ms integer,

  total_input_tokens integer,
  total_output_tokens integer,
  total_cost_usd numeric,
  total_latency_ms integer,

  final_draft_text text,
  employee_sent_text text,
  edit_classification text check (edit_classification in ('no_edit', 'minor_edit', 'major_edit')),
  edit_distance numeric,
  rejection_reason text,

  skip_reason text,
  error_stage text,
  error_message text
);

create index if not exists draft_generations_workspace_id_idx
  on public.draft_generations (workspace_id, created_at desc);

create index if not exists draft_generations_thread_id_idx
  on public.draft_generations (thread_id, created_at desc);

create index if not exists draft_generations_message_id_idx
  on public.draft_generations (message_id, created_at desc);

create index if not exists draft_generations_created_at_idx
  on public.draft_generations (created_at desc);

create index if not exists draft_generations_draft_id_idx
  on public.draft_generations (draft_id)
  where draft_id is not null;

alter table public.draft_generations enable row level security;

drop policy if exists draft_generations_service_role on public.draft_generations;
drop policy if exists draft_generations_select_scoped on public.draft_generations;
drop policy if exists draft_generations_insert_scoped on public.draft_generations;
drop policy if exists draft_generations_update_scoped on public.draft_generations;

create policy draft_generations_service_role
on public.draft_generations
for all
to service_role
using (true)
with check (true);

create policy draft_generations_select_scoped
on public.draft_generations
for select
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = draft_generations.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    workspace_id is null
    and exists (
      select 1
      from public.shops s
      where s.id = draft_generations.shop_id
        and (
          s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
          or exists (
            select 1
            from public.profiles p
            where p.user_id = s.owner_user_id
              and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
          )
        )
    )
  )
);

create policy draft_generations_insert_scoped
on public.draft_generations
for insert
to authenticated
with check (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = draft_generations.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    workspace_id is null
    and exists (
      select 1
      from public.shops s
      where s.id = draft_generations.shop_id
        and (
          s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
          or exists (
            select 1
            from public.profiles p
            where p.user_id = s.owner_user_id
              and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
          )
        )
    )
  )
);

create policy draft_generations_update_scoped
on public.draft_generations
for update
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = draft_generations.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    workspace_id is null
    and exists (
      select 1
      from public.shops s
      where s.id = draft_generations.shop_id
        and (
          s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
          or exists (
            select 1
            from public.profiles p
            where p.user_id = s.owner_user_id
              and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
          )
        )
    )
  )
)
with check (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = draft_generations.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  )
  or (
    workspace_id is null
    and exists (
      select 1
      from public.shops s
      where s.id = draft_generations.shop_id
        and (
          s.owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
          or exists (
            select 1
            from public.profiles p
            where p.user_id = s.owner_user_id
              and p.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
          )
        )
    )
  )
);
