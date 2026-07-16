-- Conversation context has been written by the application for multi-turn
-- reply examples, but the column was missing from the checked-in base schema.
-- Make fresh and drifted environments match the production ingestion contract.
alter table public.ticket_examples
  add column if not exists conversation_context text;

comment on column public.ticket_examples.conversation_context is
  'PII-scrubbed customer/agent turns strictly preceding customer_msg.';

-- PostgreSQL cannot change a RETURNS TABLE shape with CREATE OR REPLACE. The
-- vector extension may live in `extensions`, `public`, or another administrator
-- selected schema, so discover and identifier-quote that schema instead of
-- trusting search_path for the vector argument type or distance operator.
do $migration$
declare
  vector_schema text;
begin
  select n.nspname
    into vector_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'vector';

  if vector_schema is null then
    raise exception 'pgvector extension is required for match_ticket_examples';
  end if;

  execute format(
    'drop function if exists public.match_ticket_examples(%I.vector, integer, uuid, text)',
    vector_schema
  );

  execute format($function_sql$
    create function public.match_ticket_examples(
      query_embedding  %1$I.vector,
      match_count      integer default 3,
      filter_shop_id   uuid default null,
      filter_intent    text default null
    )
    returns table (
      id                   bigint,
      shop_id              uuid,
      customer_msg         text,
      agent_reply          text,
      subject              text,
      intent               text,
      language             text,
      csat_score           smallint,
      conversation_context text,
      similarity           double precision
    )
    language plpgsql stable security invoker
    set search_path = pg_catalog
    as $function_body$
    begin
      return query
      select
        te.id,
        te.shop_id,
        te.customer_msg,
        te.agent_reply,
        te.subject,
        te.intent,
        te.language,
        te.csat_score,
        te.conversation_context,
        1 - (
          te.embedding OPERATOR(%1$I.<=>) query_embedding
        ) as similarity
      from public.ticket_examples te
      where
        (filter_shop_id is null or te.shop_id = filter_shop_id)
        and (filter_intent is null or te.intent = filter_intent)
        -- Legacy Zendesk rows paired the first customer and first agent turns
        -- and are unsafe as few-shot examples. The controlled refresh adds
        -- this tag only after final-agent anchoring, PII redaction and a fresh
        -- embedding.
        and (
          te.source_provider <> 'zendesk'
          or coalesce(te.tags, '{}'::text[])
            @> array['final_agent_anchor_v1']::text[]
        )
        and te.embedding is not null
      order by te.embedding OPERATOR(%1$I.<=>) query_embedding
      limit greatest(match_count, 1);
    end;
    $function_body$;
  $function_sql$, vector_schema);
end
$migration$;
