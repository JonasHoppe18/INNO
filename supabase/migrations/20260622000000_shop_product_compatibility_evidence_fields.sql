-- Slice F — evidence/review metadata for SUGGESTED product compatibility.
--
-- Mirrors 20260620120000_shop_product_specs_evidence_fields.sql: lets the
-- website/product compatibility extractor record WHY a row was suggested
-- (evidence excerpt + source URL + source type + when) and supports a later
-- human approval flow (reviewed_at/by/note) to promote suggested -> confirmed.
-- `condition` captures scope qualifiers (e.g. "only Switch 2", "chat audio
-- only") so a narrow fact never silently becomes blanket compatibility.
--
-- Additive and nullable: existing rows and the runtime are unaffected. The
-- runtime (product-compatibility.ts) serves confirmed-only rows and never reads
-- these columns, so behavior does not change. NOT applied as part of Slice F.

alter table public.shop_product_compatibility
  add column if not exists evidence_text text null,
  add column if not exists source_url    text null,
  add column if not exists source_type   text null,   -- body_html | metafield | file_ocr | ocr_chart | page | manual
  add column if not exists condition     text null,   -- e.g. "only Switch 2", "chat audio only"
  add column if not exists extracted_at  timestamptz null,
  add column if not exists reviewed_at   timestamptz null,
  add column if not exists reviewed_by   text null,
  add column if not exists review_note   text null;
