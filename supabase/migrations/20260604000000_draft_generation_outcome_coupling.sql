-- Phase 1.1: make draft_generations outcome coupling unambiguous.
--
-- 1. rejected_at: preview rejection must NOT overwrite completed_at (the pipeline
--    completion timestamp). It gets its own column instead.
-- 2. draft_previews.generation_id: explicit FK link from a preview row back to the
--    draft_generations row it was produced from, so rejection feedback couples by
--    id instead of heuristically matching on final_draft_text.
--
-- drafts intentionally does NOT get a generation_id column: drafts.draft_id already
-- holds the pipeline's per-run UUID (also stored in draft_generations.draft_id), so
-- the save-edit flow couples via that existing unique link. Adding a generation_id
-- to drafts would require the generate-draft-v2 pipeline to write a new column,
-- which is out of scope for this change.

alter table public.draft_generations
  add column if not exists rejected_at timestamptz;

alter table public.draft_previews
  add column if not exists generation_id uuid
    references public.draft_generations(id) on delete set null;

create index if not exists draft_previews_generation_id_idx
  on public.draft_previews (generation_id)
  where generation_id is not null;
