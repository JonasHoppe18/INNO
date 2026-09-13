-- DEV-only review queue for aggregate historical support patterns.
-- Suggestions are not knowledge and are deliberately excluded from every
-- Greenfield retrieval path until a merchant publishes a canonical record.

create table if not exists public.greenfield_procedure_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  suggestion_key text not null,
  title text not null,
  trigger text not null,
  customer_phrasing_examples text[] not null default '{}'::text[],
  recommended_steps jsonb not null default '[]'::jsonb,
  escalation_condition text not null default '',
  policy_dependencies text[] not null default '{}'::text[],
  action_permission_note text not null default '',
  historical_evidence_count integer not null default 0 check (historical_evidence_count >= 0),
  confidence text not null check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  status text not null default 'suggested' check (status in ('suggested', 'reviewed', 'dismissed', 'published')),
  provenance jsonb not null default '{}'::jsonb,
  published_knowledge_record_id uuid references public.greenfield_knowledge_records(id) on delete set null,
  reviewed_at timestamptz,
  dismissed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, suggestion_key),
  check (jsonb_typeof(recommended_steps) = 'array'),
  check (jsonb_typeof(provenance) = 'object')
);

create index if not exists greenfield_procedure_suggestions_scope_idx
  on public.greenfield_procedure_suggestions (workspace_id, status, updated_at desc);

drop trigger if exists trg_greenfield_procedure_suggestions_updated_at
  on public.greenfield_procedure_suggestions;
create trigger trg_greenfield_procedure_suggestions_updated_at
before update on public.greenfield_procedure_suggestions
for each row execute function public.greenfield_knowledge_updated_at();

alter table public.greenfield_procedure_suggestions enable row level security;

drop policy if exists greenfield_procedure_suggestions_service_role
  on public.greenfield_procedure_suggestions;
create policy greenfield_procedure_suggestions_service_role
  on public.greenfield_procedure_suggestions
  for all to service_role
  using (true)
  with check (workspace_id is not null);

drop policy if exists greenfield_procedure_suggestions_scoped_read
  on public.greenfield_procedure_suggestions;
create policy greenfield_procedure_suggestions_scoped_read
  on public.greenfield_procedure_suggestions
  for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = greenfield_procedure_suggestions.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  );

comment on table public.greenfield_procedure_suggestions is
  'Aggregate historical support suggestions; never retrieved by the Greenfield agent until published as canonical Knowledge V1.';
