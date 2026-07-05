# Thread lifecycle status — post-merge deploy checklist

This branch (`worktree-thread-lifecycle-status`, Tasks 1–10) implements the thread lifecycle
status model entirely in code: canonical statuses (`needs_attention` / `waiting_customer` /
`waiting_third_party` / `resolved`), the legacy-UI compatibility shim, DB migrations, the
inbound/send/manual-PATCH transition wiring, the `pg_cron`-scheduled lifecycle tick, and the
extended sidebar-counts API. None of it has touched the live Supabase project or production —
every task in this branch deliberately avoided live-mutating Supabase MCP calls and deploys, per
the plan's working constraints. This checklist is the consolidated, ordered list of what a human
must do against the **real** Supabase project and Vercel deployment after this branch merges.

Do these in order. Each step depends on the ones before it.

- [ ] **1. Deploy `apps/web` to production (Vercel)**
  Must happen *before* the DB migration in step 2. The UI's compatibility shim
  (`apps/web/lib/inbox/status-model.js`'s `toLegacyUiStatus`) is what lets old and new status
  strings render correctly side by side — deploying the UI first means it can already render
  canonical lifecycle values the moment the backfill in step 2 writes them, with no window where
  the DB emits statuses the live UI doesn't understand yet.

- [ ] **2. Apply the two DB migrations, in this exact order**
  1. `supabase/migrations/20260703100000_thread_lifecycle_status.sql`
  2. `supabase/migrations/20260703110000_thread_lifecycle_tick.sql`
  The first adds the lifecycle columns, workspace auto-close config, and backfills every
  existing `mail_threads.status` value to a canonical status. The second creates the `pg_cron`
  extension and schedules `tick_thread_lifecycle()` every 15 minutes. Order matters because the
  tick function reads columns (`waiting_reason`, `wake_at`, `close_pending`, `attention_reason`,
  workspace `auto_close_days`/`auto_close_mode`) that only exist after migration 1 runs.
  `pg_cron` is only available on a real Supabase project — Task 9 confirmed empirically that it
  cannot be validated on local Postgres (`could not open extension control file
  ".../pg_cron.control"`), so this step has never been exercised end-to-end before now.

- [ ] **3. Verify the migration backfill landed cleanly**
  Run: `select status, count(*) from public.mail_threads group by status order by 2 desc;`
  Expect to see only five values: `needs_attention`, `waiting_customer`, `waiting_third_party`,
  `resolved`, `blocked`. Per Task 4's migration, every legacy string (`New`/`Open`/`Pending`/
  `Waiting`/`Solved`/`Resolved`, any case) and any null/unrecognized value maps deterministically
  into this set via an `else` fallback — no row should be able to escape it. If any other value
  appears, the migration's CASE mapping missed a legacy variant still live in production and must
  be investigated before proceeding.

  Also expect the `needs_attention` count to be noticeably SMALLER than a naive read of legacy
  open/new statuses would suggest. The migration now archives already-read, 30+ day silent
  threads straight to `resolved` during backfill (added after a live count on AceZone's data
  showed 345 such threads — old, read, dead weight that would otherwise flood the queue on day
  one). Cross-check: `select count(*) from public.mail_threads where status = 'resolved' and
  attention_reason is null and unread_count = 0;` should roughly match the number of legacy
  open/new threads that were stale and already read before the migration ran.

- [ ] **4. Deploy the updated `postmark-inbound` edge function**
  `supabase functions deploy postmark-inbound --no-verify-jwt --use-api`
  Per this repo's CLAUDE.md deploy rule (`postmark-inbound` always deploys with
  `--no-verify-jwt`) and Task 6's wiring, which replaced the old ad-hoc `"blocked"`/`"new"`/
  `"open"` string assignments with the shared, tested `statusOnInboundCustomerMessage` transition
  module. Until this deploys, inbound mail keeps writing the old legacy status strings even
  though the DB and UI are already migrated — this step is what makes new inbound threads use the
  canonical model.

- [ ] **5. Send a real test email through live Postmark and confirm the resulting thread**
  Expect `status = 'needs_attention'`, `attention_reason = 'new'`. This is the first real,
  end-to-end confirmation that the deployed edge function (step 4) produces the exact output the
  shared transition module's tests (Task 5/6, 7/7 Deno tests passing) predict — closing the loop
  between unit-tested logic and actual Postmark traffic, which no task on this branch could
  exercise locally.

- [ ] **6. Manually verify `/inbox` renders correctly against real, migrated data**
  Open a real ticket in production and confirm status labels/behavior look right — not just
  type-check/lint-clean. Task 3 explicitly deferred this: it verified the `toLegacyUiStatus`
  delegation via ESLint and code review only, because `preview_start` couldn't target this
  worktree's code and no live migrated data existed yet to render against. This is the first
  point where that gap can actually be closed.

- [ ] **7. Manually verify the send-reply flow against live data**
  Reply to a real ticket and confirm `mail_threads.status` becomes `waiting_customer` (or
  `waiting_third_party` if a third-party wait was already active). Task 7 wired
  `buildAgentReplyStatusPatch` into the send route and confirmed it via unit tests and diff
  review only — no dev server or live DB session was available in that task run, so the actual
  Supabase round-trip on send has never been observed.

- [ ] **8. Manually verify the manual status-change dropdown (thread-status PATCH) against live data**
  Include a case that sets a third-party wait with a wake date. Task 8 built and wired
  `buildManualStatusPatch` (validated status normalization, wait-state clearing, wake-date
  parsing) and locked the precedence/edge-case behavior with 18 unit tests, but explicitly
  flagged that no live UI dropdown → live Supabase round-trip was exercised. This step is that
  missing check.

- [ ] **9. Confirm the `pg_cron` job exists and is scheduled correctly**
  Run: `select jobname, schedule from cron.job where jobname = 'thread-lifecycle-tick';`
  Expect exactly one row: `thread-lifecycle-tick`, `*/15 * * * *`. Task 9 validated the
  scheduling block's idempotency (unschedule-then-reschedule) only against a hand-built stub
  `cron` schema, since real `pg_cron` isn't available locally — this is the first check against
  the actual extension installed in step 2.

- [ ] **10. Run the lifecycle-tick verification script against the live project**
  ```
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/scripts/test-lifecycle-tick.mjs
  ```
  Expect three `PASS` lines and exit code 0. This is Task 9's script (seeds a throwaway
  workspace + three threads covering wake-due, silent-past-threshold, and not-yet-due cases,
  calls `tick_thread_lifecycle()` via RPC, asserts the outcome, then cleans up). It was fixed
  post-review to clean up its seeded data even if an assertion throws, but has never been run
  against a real project — only syntax-checked (`node --check`) and reasoned about locally.

- [ ] **11. Confirm sidebar counts against a manual SQL cross-check**
  Hit `/api/inbox/sidebar-counts` and compare its `needsAttentionCount` against:
  ```sql
  select count(*) from public.mail_threads
  where (status = 'needs_attention' or close_pending = true)
    and (classification_key is null or classification_key <> 'notification')
    and workspace_id = '<the workspace under test>';
  ```
  Task 10 implemented this via two chained PostgREST `.or()` filters and verified the AND-of-ORs
  semantics by reading the `@supabase/postgrest-js` source rather than a live HTTP round-trip
  (no live DB/session was available in that task run). This step is the first real confirmation
  that the query behaves as designed against actual data.

  **Caveat:** the SQL above is reconstructed from the route's filter logic (`applyNeedsAttentionFilter`
  in `apps/web/app/api/inbox/sidebar-counts/route.js`), not copied from a query that was actually
  executed against a live database. Before trusting a mismatch as a bug, re-derive the query directly
  from that function's current source — the filter logic may have shifted since this checklist was written.

## Notes

- Steps 1–4 are infrastructure/deploy actions; steps 5–11 are verification. Do not skip a
  verification step just because the deploy step "looked fine" — several of the deferred checks
  above (3, 7, 8, 9, 10, 11) exist specifically because prior tasks could only validate their
  logic locally or via unit tests, never against the real project.
- If any step fails, stop and do not proceed to the next one — the ordering encodes real
  dependencies (e.g. running the tick script before the migration in step 2 has landed will
  simply fail with a missing-function error; deploying the edge function in step 4 before the
  migration in step 2 would have it start writing columns that don't exist yet).
