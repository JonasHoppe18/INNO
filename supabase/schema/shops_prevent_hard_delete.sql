-- Prevent physical deletion of shops rows.
-- The application already models Shopify disconnects via `uninstalled_at`.
-- Hard deletes are dangerous because several dependent tables use
-- `references public.shops(id) on delete cascade`, which can wipe knowledge/history.

create or replace function public.prevent_shops_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete on public.shops is disabled. Set uninstalled_at instead.'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_prevent_shops_hard_delete on public.shops;

create trigger trg_prevent_shops_hard_delete
before delete on public.shops
for each row
execute function public.prevent_shops_hard_delete();
