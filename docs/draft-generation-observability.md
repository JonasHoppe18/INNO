# Draft generation observability

`draft_generations` is the Phase 1 observability table for `generate-draft-v2`.
It is an append/update trace for one draft-generation attempt and sits on top of
the existing production tables. It does not replace `drafts`, `draft_previews`,
`agent_logs`, `retrieval_traces`, or `thread_actions`.

## Table

The table is created by:

`supabase/migrations/20260603000000_create_draft_generations.sql`

Each row represents one `generate-draft-v2` pipeline run. The row is created as
soon as the pipeline starts, before planner, retrieval, actions, writer, or
verifier run.

Primary identifiers:

- `id`: generation id
- `workspace_id`, `shop_id`, `thread_id`, `message_id`
- `draft_id`: the existing generated draft id used by the `drafts` table
- `pipeline_version`: currently `v2`
- `created_at`, `completed_at`

## Stored artifacts

Pipeline artifacts are persisted incrementally:

- `case_state_json`: output from case-state updater
- `planner_output_json`: raw planner output after deterministic overrides
- `facts_json`: fact resolver output
- `retrieved_chunk_ids`: exact knowledge chunk ids included for the writer
- `retrieval_trace_json`: included chunk metadata and available matcher diagnostics
- `ticket_example_ids`: selected few-shot ticket example ids
- `resolution_plan_json`: compact planner/resolution summary
- `action_decision_json`: raw and effective action decision, including automation flags
- `verifier_output_json`: verifier result used for final routing/confidence
- `final_draft_text`: final customer-facing draft text when a draft is produced

Writer usage is stored when OpenAI returns usage metadata:

- `writer_model`
- `writer_prompt_hash`
- `writer_input_tokens`
- `writer_output_tokens`
- `writer_latency_ms`

`writer_prompt_hash` is a SHA-256 hash of the writer inputs. The prompt text
itself is not stored in this table.

## Nullable fields

These fields can be `null` in Phase 1:

- `workspace_id`: when a run fails before shop/workspace context is loaded
- `message_id`: when the caller did not provide a concrete message id
- `completed_at`: only if the process is terminated before the best-effort update
- `resolution_plan_json`: reserved for a fuller staged resolution planner
- `writer_prompt_version`: no central prompt version exists yet
- `writer_input_tokens`, `writer_output_tokens`: null when an OpenAI response
  does not include usage metadata
- `writer_cost_usd`, `total_cost_usd`: no central cost calculator is currently
  used by `generate-draft-v2`
- `total_input_tokens`, `total_output_tokens`: currently writer coverage only;
  planner, case-state, action-decision, verifier, and embedding usage are not
  centrally returned by their helpers yet
- `employee_sent_text`, `edit_classification`, `edit_distance`,
  `rejection_reason`: null until an employee sends, edits, or rejects a draft
- `skip_reason`: set only when the pipeline intentionally skips generation
- `error_stage`, `error_message`: set only when the pipeline throws

Retrieval drop reasons are only partially available. `generate-draft-v2`
captures selected chunks and matcher ranked/not-selected candidates when the
retriever exposes them. It does not yet have per-candidate deterministic drop
reasons for every vector/BM25 candidate.

## Debugging one generation

Start from `draft_generations.id` when available. Otherwise locate the latest
row by `thread_id`, `message_id`, or `draft_id`.

Useful read-only query:

```sql
select
  id,
  created_at,
  completed_at,
  workspace_id,
  shop_id,
  thread_id,
  message_id,
  draft_id,
  skip_reason,
  planner_output_json,
  facts_json,
  retrieved_chunk_ids,
  retrieval_trace_json,
  action_decision_json,
  verifier_output_json,
  writer_model,
  writer_input_tokens,
  writer_output_tokens,
  writer_latency_ms,
  final_draft_text,
  employee_sent_text,
  edit_classification,
  edit_distance,
  rejection_reason,
  error_stage,
  error_message
from public.draft_generations
where id = '<generation-id>';
```

## Existing tables still used

`generate-draft-v2` continues to write the existing production tables:

- `drafts`: pending/sent/superseded draft lifecycle and edit-distance tracking
- `draft_previews`: preview-v2 feedback and rejection/adoption metadata
- `agent_logs`: timeline events shown in the product and internal diagnostics
- `retrieval_traces`: existing retrieval trace table where used by older flows
- `thread_actions`: proposed and pending customer-service actions
- `mail_messages`: latest inbound message `ai_draft_text` for composer display

`draft_generations` should be treated as an observability layer for debugging
and eval dataset construction, not as the source of truth for sending mail or
executing actions.
