alter table public.profiles
  add column if not exists theme_preference text;

alter table public.profiles
  alter column theme_preference set default 'light';

update public.profiles
set theme_preference = 'light'
where theme_preference is null
   or lower(theme_preference) not in ('light', 'dark');

update public.profiles
set theme_preference = lower(theme_preference)
where theme_preference is not null;

alter table public.profiles
  alter column theme_preference set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_theme_preference_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_theme_preference_check
      check (theme_preference in ('light', 'dark'));
  end if;
end $$;
