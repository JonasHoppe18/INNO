-- One inbound message may be delivered or processed more than once. Core
-- auto-actions use a deterministic key, so only one pipeline invocation may
-- acquire the execution row and mutate the external commerce system.
create unique index if not exists thread_actions_unique_auto_execution_idx
  on public.thread_actions (thread_id, action_key)
  where source = 'automation'
    and left(action_key, 5) = 'auto_';
