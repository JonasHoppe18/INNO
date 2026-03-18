-- Harden `shops` relationships so accidental hard deletes cannot cascade-wipe
-- knowledge, import history, or retrieval traces.

alter table public.agent_knowledge
  drop constraint if exists agent_knowledge_shop_id_fkey;

alter table public.agent_knowledge
  add constraint agent_knowledge_shop_id_fkey
  foreign key (shop_id)
  references public.shops(id)
  on delete restrict;

alter table public.knowledge_import_jobs
  drop constraint if exists knowledge_import_jobs_shop_id_fkey;

alter table public.knowledge_import_jobs
  add constraint knowledge_import_jobs_shop_id_fkey
  foreign key (shop_id)
  references public.shops(id)
  on delete restrict;

alter table public.retrieval_traces
  drop constraint if exists retrieval_traces_shop_id_fkey;

alter table public.retrieval_traces
  add constraint retrieval_traces_shop_id_fkey
  foreign key (shop_id)
  references public.shops(id)
  on delete restrict;
