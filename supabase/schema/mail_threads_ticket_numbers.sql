alter table public.mail_threads
  add column if not exists ticket_number bigint;

-- Reserve a high range so ticket numbers do not look like fresh Shopify order numbers.
-- First generated ticket becomes 50001.

create table if not exists public.mail_thread_ticket_counters (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  last_ticket_number bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists mail_thread_ticket_counters_updated_idx
  on public.mail_thread_ticket_counters (updated_at desc);

with ranked as (
  select
    mt.id,
    row_number() over (
      partition by mt.workspace_id
      order by coalesce(mt.created_at, mt.updated_at, now()) asc, mt.id asc
    ) as next_ticket_number
  from public.mail_threads mt
  where mt.workspace_id is not null
    and mt.ticket_number is null
    and coalesce(lower(mt.classification_key), 'support') <> 'notification'
)
update public.mail_threads mt
set ticket_number = 50000 + ranked.next_ticket_number
from ranked
where ranked.id = mt.id;

insert into public.mail_thread_ticket_counters (workspace_id, last_ticket_number, updated_at)
select
  mt.workspace_id,
  max(mt.ticket_number) as last_ticket_number,
  now()
from public.mail_threads mt
where mt.workspace_id is not null
  and mt.ticket_number is not null
group by mt.workspace_id
on conflict (workspace_id)
do update set
  last_ticket_number = greatest(public.mail_thread_ticket_counters.last_ticket_number, excluded.last_ticket_number),
  updated_at = now();

create or replace function public.mail_threads_assign_ticket_number()
returns trigger
language plpgsql
as $$
declare
  v_next_ticket_number bigint;
begin
  if coalesce(new.ticket_number, 0) > 0 then
    return new;
  end if;

  if new.workspace_id is null then
    return new;
  end if;

  if coalesce(lower(new.classification_key), 'support') = 'notification' then
    return new;
  end if;

  insert into public.mail_thread_ticket_counters as counters (workspace_id, last_ticket_number, updated_at)
  values (new.workspace_id, 50001, now())
  on conflict (workspace_id)
  do update set
    last_ticket_number = counters.last_ticket_number + 1,
    updated_at = now()
  returning last_ticket_number into v_next_ticket_number;

  new.ticket_number := v_next_ticket_number;
  return new;
end;
$$;

drop trigger if exists trg_mail_threads_assign_ticket_number on public.mail_threads;
create trigger trg_mail_threads_assign_ticket_number
before insert or update of classification_key, workspace_id, ticket_number on public.mail_threads
for each row
execute function public.mail_threads_assign_ticket_number();

drop index if exists mail_threads_workspace_ticket_number_unique_idx;
create unique index if not exists mail_threads_workspace_ticket_number_unique_idx
  on public.mail_threads (workspace_id, ticket_number)
  where workspace_id is not null
    and ticket_number is not null;

create index if not exists mail_threads_workspace_ticket_number_sort_idx
  on public.mail_threads (workspace_id, ticket_number desc)
  where workspace_id is not null
    and ticket_number is not null;

alter table public.mail_threads
  drop constraint if exists mail_threads_support_requires_ticket_number;

alter table public.mail_threads
  add constraint mail_threads_support_requires_ticket_number
  check (
    workspace_id is null
    or coalesce(lower(classification_key), 'support') = 'notification'
    or ticket_number is not null
  );
