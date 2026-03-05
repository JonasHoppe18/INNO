-- Policy summary persistence on shops.
-- Keeps a compact policy snapshot available for prompt pinning.

alter table public.shops
  add column if not exists policy_privacy text;

alter table public.shops
  add column if not exists policy_summary_json jsonb not null default '{}'::jsonb;

alter table public.shops
  add column if not exists policy_summary_version integer not null default 1;

alter table public.shops
  add column if not exists policy_summary_updated_at timestamptz;

create or replace function public.refresh_shop_policy_summary()
returns trigger
language plpgsql
as $$
declare
  combined text;
  return_days_match text[];
  return_days integer;
  shipping_paid_by text;
  summary jsonb;
  should_refresh boolean;
begin
  should_refresh := tg_op = 'INSERT'
    or new.policy_refund is distinct from old.policy_refund
    or new.policy_shipping is distinct from old.policy_shipping
    or new.policy_terms is distinct from old.policy_terms
    or new.policy_privacy is distinct from old.policy_privacy;

  if not should_refresh then
    return new;
  end if;

  -- Do not overwrite explicit app-generated summaries in the same write.
  if tg_op = 'UPDATE'
     and new.policy_summary_json is distinct from old.policy_summary_json
     and new.policy_summary_updated_at is distinct from old.policy_summary_updated_at then
    return new;
  end if;

  combined := trim(
    concat_ws(
      E'\n\n',
      coalesce(new.policy_refund, ''),
      coalesce(new.policy_shipping, ''),
      coalesce(new.policy_terms, ''),
      coalesce(new.policy_privacy, '')
    )
  );

  select regexp_match(combined, '(?i)(?:within|up to|under|in)\s+([0-9]{1,3})\s*(?:day|days)')
  into return_days_match;

  if return_days_match is not null and array_length(return_days_match, 1) >= 1 then
    return_days := nullif(return_days_match[1], '')::integer;
    if return_days is not null and (return_days < 1 or return_days > 365) then
      return_days := null;
    end if;
  else
    return_days := null;
  end if;

  if combined ~* '(customer(?:s)?\s+(?:must|will|is responsible|are responsible)\s+pay|customer(?:s)?\s+(?:is|are)\s+responsible\s+for\s+return\s+shipping|buyer pays return shipping|return shipping(?: costs| fee| fees)?\s+(?:are|is)?\s*(?:paid by|borne by)\s+the customer)' then
    shipping_paid_by := 'customer';
  elsif combined ~* '(we\s+(?:pay|cover)\s+return shipping|seller pays return shipping|return shipping(?: costs| fee| fees)?\s+(?:are|is)?\s*(?:paid by|covered by)\s+(?:us|the merchant|the store))' then
    shipping_paid_by := 'merchant';
  else
    shipping_paid_by := 'unknown';
  end if;

  summary := jsonb_build_object(
    'return_window_days', return_days,
    'return_instructions_short', left(coalesce(new.policy_refund, 'Follow the store policy. If unclear, ask one question.'), 600),
    'return_address', '',
    'return_contact_email', coalesce(substring(combined from '(?i)([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})'), ''),
    'return_shipping_paid_by', shipping_paid_by,
    'refund_conditions_short', left(coalesce(new.policy_refund, 'Follow the store policy. If unclear, ask one question.'), 600),
    'warranty_duration_regions_short', left(coalesce(new.policy_terms, ''), 600),
    'last_modified_date', null
  );

  new.policy_summary_json := summary;
  new.policy_summary_version := coalesce(nullif(new.policy_summary_version, 0), 1);
  new.policy_summary_updated_at := now();

  return new;
end;
$$;

drop trigger if exists trg_refresh_shop_policy_summary on public.shops;

create trigger trg_refresh_shop_policy_summary
before insert or update of policy_refund, policy_shipping, policy_terms, policy_privacy, policy_summary_json
on public.shops
for each row
execute function public.refresh_shop_policy_summary();
