-- Track when shop policies (refund / shipping / etc.) were last synced from
-- Shopify so the Knowledge UI can show "Last synced N ago" next to the policy
-- editor. Distinct from updated_at which fires on any row update including
-- manual edits.
alter table public.shops
  add column if not exists policy_synced_at timestamptz;
