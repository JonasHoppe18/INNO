alter table public.mail_threads
  add column if not exists customer_name text;

alter table public.mail_threads
  add column if not exists customer_email text;

alter table public.mail_threads
  add column if not exists customer_last_inbound_at timestamptz;

create index if not exists mail_threads_customer_email_idx
  on public.mail_threads (customer_email);

with ranked_inbound as (
  select
    m.thread_id,
    coalesce(m.received_at, m.sent_at, m.created_at) as msg_at,
    nullif(trim(coalesce(m.extracted_customer_name, m.from_name)), '') as customer_name,
    nullif(trim(coalesce(m.extracted_customer_email, m.from_email)), '') as customer_email,
    row_number() over (
      partition by m.thread_id
      order by coalesce(m.received_at, m.sent_at, m.created_at) desc nulls last
    ) as rn
  from public.mail_messages m
  where m.thread_id is not null
    and coalesce(m.from_me, false) = false
    and (
      nullif(trim(coalesce(m.extracted_customer_email, m.from_email)), '') is not null
      or nullif(trim(coalesce(m.extracted_customer_name, m.from_name)), '') is not null
    )
    and coalesce(lower(m.from_email), '') not like '%@acezone.io'
    and coalesce(lower(m.from_email), '') not like '%@sona-ai.dk'
)
update public.mail_threads t
set
  customer_name = coalesce(r.customer_name, t.customer_name),
  customer_email = coalesce(r.customer_email, t.customer_email),
  customer_last_inbound_at = coalesce(r.msg_at, t.customer_last_inbound_at),
  updated_at = now()
from ranked_inbound r
where r.rn = 1
  and t.id = r.thread_id
  and (
    t.customer_name is null
    or t.customer_email is null
    or t.customer_last_inbound_at is null
    or (r.msg_at is not null and r.msg_at > t.customer_last_inbound_at)
  );
