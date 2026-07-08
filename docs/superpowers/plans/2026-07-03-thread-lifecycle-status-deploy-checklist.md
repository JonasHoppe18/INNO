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

## Plan 2 — Queue workspace UI verification (post-migration)

This section covers `worktree-queue-workspace-ui` (12 tasks, not yet merged), which built the
visible queue workspace UI — sidebar restructure, status tabs, reason badges, waiting groups,
approve-close group, send-to-next — on top of the lifecycle backend above. It depends on the
migrations in step 2 having landed to show anything beyond zero-state.

**Browser-testing limitation, read this first:** every task on this branch verified its UI work
via unit tests (`view-model.js`'s 64 vitest cases), ESLint, and `next build`, plus manual static
code tracing (declaration-order analysis, hand-tracing pure functions against constructed inputs)
— never via an actual browser render. The sandbox's embedded preview browser tool was confirmed
non-functional (stuck on a placeholder page) across repeated attempts throughout this branch's
development, so no task could load `/inbox` and look at it. This makes a real human click-through
of `/inbox` the single most valuable thing to do before or immediately after merging this branch
— even before the Plan 1 migration runs — to catch any purely-visual/layout issue that static
analysis cannot.

- [ ] **12. Confirm sidebar counts show real, non-zero numbers matching actual data**
  Check `needsAttentionCount`, `mineCount`, `waitingCustomerCount`, `waitingThirdPartyCount`, and
  the per-inbox counts in the sidebar against the workspace's real thread data. Pre-migration
  these all read `0` because the lifecycle columns they aggregate don't exist yet — this step is
  the first confirmation they populate correctly once step 2's migration has run.

- [ ] **13. Confirm the Needs attention tab's queue ordering is correct against real data**
  Expect oldest customer-wait-time first. The ordering logic (`view-model.js`) was verified with
  constructed fixtures in unit tests only; no real, mixed-age thread set has ever driven it before
  now.

- [ ] **14. Confirm reason badges show real stored reasons, not just the unread fallback**
  Open a thread with `attention_reason = 'customer_replied'` and confirm the badge reads "Customer
  replied" (not the generic "New" fallback used when no reason is stored). Pre-migration every
  thread lacks `attention_reason`, so only the fallback path has ever rendered in practice.

- [ ] **15. Confirm the Waiting tab splits correctly into "Waiting on customer" / "Waiting on third party"**
  Requires a real thread with `waiting_reason = 'waiting_third_party'`. Pre-migration every thread
  defaults into the "customer" group (there's no `waiting_reason` data to disagree with that
  default), so the third-party branch of the grouping logic has never actually been exercised
  against real data — only against constructed unit-test fixtures.

- [ ] **16. Confirm wake countdowns render correctly for a thread with a real `wake_at` value**
  Expect a "wakes in N days" label whose N matches the stored timestamp. No real `wake_at` value
  has existed to render against before this migration lands, so this is the first live check of
  the countdown formatting.

- [ ] **17. Confirm the "Approve close" group and its Approve / Keep-waiting actions work end-to-end**
  Force a real `close_pending` thread by backdating a thread's `status_changed_at` (per step 10's
  tick-verification approach) and either waiting for the next scheduled tick or manually invoking
  `tick_thread_lifecycle()`, then confirm the group appears in the UI and both buttons produce the
  expected status change against the live DB. This exercises UI code that so far has only been
  covered by unit tests against a hand-built `close_pending` fixture, never a thread flagged by the
  real tick function.

- [ ] **18. Confirm send-to-next actually advances through a real multi-thread queue in the browser**
  Send a reply and confirm focus moves to the next thread in the queue, repeated across several
  sends. This branch's manual verification of `selectNext` was limited to static code tracing (see
  the note above) — this is the first real browser confirmation of this behavior.

- [ ] **19. Confirm sidebar Settings links navigate with client-side routing and show active-state highlighting**
  Click each Settings group link and confirm no full page reload occurs (client-side
  `next/link` transition) and that the active item is highlighted correctly. Task 11 fixed a
  missing-active-state bug here via code review; it has not been confirmed by an actual click in a
  browser.
