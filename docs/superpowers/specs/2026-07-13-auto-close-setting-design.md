# Auto-close setting — design

**Date:** 2026-07-13
**Status:** approved (Jonas, 2026-07-13)

## Goal

Give each workspace one explicit switch that decides whether Sona may CLOSE
tickets automatically, defaulting to OFF (suggest only). Remove the redundant
hours-based "Auto close (hours)" control.

## Background

The `workspaces.auto_close_mode` column already exists (migration
20260703100000): values `'approve'` (default) and `'auto'`. The lifecycle tick
and the 14-day stale-resolve already branch on it (`'auto'` → hard-resolve,
`'approve'` → flag `close_pending` for approval). The new closing-acknowledgment
gate currently ALWAYS flags `close_pending` regardless of the mode.

So "allow auto-close, default off" IS `auto_close_mode`. This work surfaces it
as a toggle, makes the closing gate respect it, and removes the now-redundant
`close_suggestion_delay_hours` ("Auto close (hours)") field.

## Model — one master switch

`auto_close_mode` becomes the single master switch for ALL automatic closing:
- **`'approve'` (default / toggle OFF):** every auto-close mechanism only
  SUGGESTS — flags `close_pending` for one-click human approval. Nothing closes
  on its own.
- **`'auto'` (toggle ON):** mechanisms hard-resolve (`status='resolved'`).

Mechanisms covered: the closing-acknowledgment gate (thanks on a handled
thread), the day-based lifecycle tick, and the 14-day inbox stale-resolve (last
two already respect the column — no change needed there).

## Changes

### A. Edge — closing gate respects `auto_close_mode` (`pipeline.ts`)
The pipeline already fetches the workspace row for `test_mode`
(`.from("workspaces").eq("id", workspaceId)` ~line 1247). Extend that select to
include `auto_close_mode`. In the closing block (added earlier):
- `auto_close_mode === 'auto'` → set the thread `status='resolved'`,
  `close_pending=false` (hard close), still skip the draft + log.
- otherwise (`'approve'`/default/missing) → current behavior: `close_pending=true`.
Fail-safe: any missing/unknown value ⇒ treat as `'approve'` (suggest only).
Use a new transition helper `statusOnAutoResolvedAcknowledgment(): { status:
"resolved"; close_pending: false }` alongside the existing
`statusOnClosingAcknowledgment()`.

### B. Web — settings toggle (`SettingsPanel.jsx` + `/api/settings/test-mode/route.js`)
- Ticket-lifecycle section: **REMOVE** the "Auto close (hours)" `StoreTeamRow`
  (bound to `closeSuggestionDelayHours`) and its state/handlers/props.
- **ADD** a boolean toggle row "Allow automatic closing" — description e.g.
  "When on, Sona closes resolved/acknowledged tickets automatically. When off
  (default) it only flags them for one-click approval." Bound to
  `auto_close_mode`: ON = `'auto'`, OFF = `'approve'`.
- Settings API route: add `auto_close_mode` to the GET select + the POST update
  (normalize to `'auto'|'approve'`, default `'approve'`); DROP all
  `close_suggestion_delay_hours` handling (select, normalize, update, defaults).
- Surgical: touch ONLY the lifecycle rows / the fields listed here — the file
  has unrelated uncommitted work in other sections that must merge cleanly.

### C. Web — drop `close_suggestion_delay_hours` from `inbox/live/route.js`
Remove the `getAutoCloseDelayHours` select/usage (the only remaining reader).
If it feeds a client-side "suggest close after N hours" hint, remove that hint
path too (the day-based tick + the new toggle supersede it). Verify nothing else
imports the removed helper.

## Verification
- Edge (dry-run can't verify the write; use unit + a real trigger): with
  `auto_close_mode='approve'` a closing "thanks" → `close_pending=true` (as
  today). With `auto_close_mode='auto'` → thread `status='resolved'`,
  `close_pending=false`, still no draft. Toggle a test workspace and trigger the
  gate on a handled thread; check the DB.
- Web: toggle renders, default OFF, saves `auto_close_mode`; "Auto close (hours)"
  gone; settings save round-trips; no console errors; `close_suggestion_delay_hours`
  no longer referenced anywhere (grep clean).

## Non-goals
- No new migration (`auto_close_mode` exists).
- No change to `auto_close_days` / the 14-day `needs_attention_stale_days`
  parameter (kept; it already respects `auto_close_mode`).
- Do not touch the unrelated uncommitted SettingsPanel sections.
