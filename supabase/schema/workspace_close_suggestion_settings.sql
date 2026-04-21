alter table public.workspaces
  add column if not exists close_suggestion_delay_hours integer not null default 336;

update public.workspaces
set close_suggestion_delay_hours = 336
where close_suggestion_delay_hours is null
   or close_suggestion_delay_hours < 1
   or close_suggestion_delay_hours > 720;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspaces_close_suggestion_delay_hours_check'
      and conrelid = 'public.workspaces'::regclass
  ) then
    alter table public.workspaces
      add constraint workspaces_close_suggestion_delay_hours_check
      check (close_suggestion_delay_hours between 1 and 720);
  end if;
end $$;
