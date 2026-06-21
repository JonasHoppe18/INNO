-- Stage 4B-3-2d: evidence/review metadata for suggested product specs.
--
-- Lets product-page extraction store WHY a spec was suggested (evidence excerpt
-- + source URL + when) and supports a later human approval flow
-- (reviewed_at/by/note) to promote suggested -> confirmed. Additive and
-- nullable: existing rows and the runtime (which serves confirmed specs and
-- never reads these columns) are unaffected.

alter table public.shop_product_specs
  add column if not exists evidence_text text null,
  add column if not exists source_url text null,
  add column if not exists extracted_at timestamptz null,
  add column if not exists reviewed_at timestamptz null,
  add column if not exists reviewed_by text null,
  add column if not exists review_note text null;
