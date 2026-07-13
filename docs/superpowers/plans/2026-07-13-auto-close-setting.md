# Auto-close setting — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** One master `auto_close_mode` toggle (default OFF=approve) gates all automatic closing; closing gate respects it; remove "Auto close (hours)".

## Global Constraints
- Deno tests: `deno test --no-check --allow-env <file>`. Only 2 known pre-existing `deno check` errors (`_shared/shopify-credentials.ts:36`, `gls/tracking.ts:204`).
- No new migration (`workspaces.auto_close_mode` exists: `'approve'`|`'auto'`, default `'approve'`).
- Fail-safe: unknown/missing `auto_close_mode` ⇒ treat as `'approve'` (suggest only, never auto-close).
- SettingsPanel.jsx / settings route edits must be SURGICAL (lifecycle rows + listed fields only) — the file has unrelated uncommitted work that must merge cleanly. Never reformat untouched regions.

---

### Task 1: Edge — closing gate respects `auto_close_mode`

**Files:**
- Modify: `supabase/functions/_shared/thread-status/transitions.ts` (+ test)
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts`

**Interfaces — Produces:** `export function statusOnAutoResolvedAcknowledgment(): { status: "resolved"; close_pending: false }` next to the existing `statusOnClosingAcknowledgment()`.

- [ ] **Step 1:** Add `statusOnAutoResolvedAcknowledgment` + a transitions.test.ts test (`status==="resolved"`, `close_pending===false`). Run the file, green.
- [ ] **Step 2:** In `pipeline.ts`, extend the existing workspace fetch (the `.from("workspaces").select(...).eq("id", workspaceId)` used for test_mode, ~line 1247) to also select `auto_close_mode`. Capture it into a variable (e.g. `const autoCloseMode = String(<workspaceRow>?.auto_close_mode ?? "approve");`). READ that block to get the real variable name holding the workspace row.
- [ ] **Step 3:** In the closing block (`if (closing.suggestClose) { ... }`, ~line 1548), replace the single `statusOnClosingAcknowledgment()` update with a branch:
```ts
const closePatch = autoCloseMode === "auto"
  ? statusOnAutoResolvedAcknowledgment()
  : statusOnClosingAcknowledgment();
if (!isDryRun && thread_id) {
  await supabase.from("mail_threads")
    .update({ ...closePatch, updated_at: new Date().toISOString() })
    .eq("id", thread_id);
  await supabase.from("agent_logs").insert({
    workspace_id: workspaceId ?? null,
    step_name: "draft_closing_suggested",
    step_detail: JSON.stringify({ thread_id, intent: plan.primary_intent, reason: closing.reason, auto_close_mode: autoCloseMode }),
    status: "info",
  });
}
return await completeSkippedGeneration("closing_acknowledgment");
```
Import `statusOnAutoResolvedAcknowledgment`.
- [ ] **Step 4:** `deno check pipeline.ts` (2 pre-existing only). Re-run `transitions.test.ts` + `conversation-closing.test.ts` green.
- [ ] **Step 5: Commit** — `feat(draft): closing gate hard-resolves when auto_close_mode=auto`

---

### Task 2: Web — settings toggle + remove "Auto close (hours)"

**Files:**
- Modify: `apps/web/components/settings/SettingsPanel.jsx`
- Modify: `apps/web/app/api/settings/test-mode/route.js`

- [ ] **Step 1: Settings API route.** In `getWorkspaceSettings` select, add `auto_close_mode`, drop `close_suggestion_delay_hours`. In the returned object add `auto_close_mode: (data?.auto_close_mode === "auto" ? "auto" : "approve")`, remove the `close_suggestion_delay_hours` key. In POST: read `body?.auto_close_mode`, normalize to `"auto"|"approve"` (default `"approve"`), include it in the `.update({...})`; remove `closeSuggestionDelayHours` read + the `close_suggestion_delay_hours` update key + `normalizeCloseSuggestionDelayHours` + related error-string checks + `DEFAULT_CLOSE_SUGGESTION_DELAY_HOURS`. Leave `needs_attention_stale_days` untouched.
- [ ] **Step 2: SettingsPanel.jsx — remove hours row.** Delete the "Auto close (hours)" `StoreTeamRow` (label `"Auto close (hours)"`, ~line 460-478) and remove its state/prop/handler wiring: `closeSuggestionDelayHours`, `onCloseSuggestionDelayHoursChange`, `normalizeCloseSuggestionDelayHours`, `nextCloseSuggestionDelayHours`, and any `close_suggestion_delay_hours` references in this file (payload build ~line 3558, 3375, 3570). Grep the file for `loseSuggestion` and remove every match cleanly.
- [ ] **Step 3: SettingsPanel.jsx — add toggle.** In the Ticket-lifecycle section (where the hours row was), add a boolean toggle row "Allow automatic closing", description "When on, Sona closes resolved/acknowledged tickets automatically. When off (default) it only flags them for one-click approval." Wire a state `autoCloseMode` ('auto'|'approve') sourced from the loaded settings (default 'approve'), a handler that flips it, include `auto_close_mode: autoCloseMode` in the settings save payload. Use the existing toggle/switch primitive already used elsewhere in this file (find one — e.g. the test_mode switch — and mirror its markup). Keep `disabled={!hasWorkspaceScope}` like the sibling rows.
- [ ] **Step 4:** `cd apps/web && npm run build` succeeds (or at least the file lints/compiles). Grep the whole repo: `close_suggestion_delay_hours` only remains in migrations (historical) — not in web/edge runtime. (inbox/live handled in Task 3.)
- [ ] **Step 5: Commit** — `feat(web): auto-close toggle (auto_close_mode); remove Auto close (hours)`

---

### Task 3: Web — drop `close_suggestion_delay_hours` from `inbox/live`

**Files:** Modify `apps/web/app/api/inbox/live/route.js`

- [ ] **Step 1:** Remove the `getAutoCloseDelayHours` function (select of `close_suggestion_delay_hours`, ~line 42-49), its call site, and any `normalizeAutoCloseDelayHours` import/use and downstream field it populated in the response. If the value fed a response field consumed by the client, remove that field (and confirm no client code hard-depends on it — grep `autoCloseDelayHours`/`auto_close_delay` in `apps/web`).
- [ ] **Step 2:** `npm run build` clean. Repo grep: `close_suggestion_delay_hours` appears ONLY in `supabase/migrations/*` now.
- [ ] **Step 3: Commit** — `chore(web): drop unused close_suggestion_delay_hours reader`

---

### Task 4: Deploy edge + verify

- [ ] **Step 1:** Deploy `supabase functions deploy generate-draft-v2 --project-ref ikuupzjaxzvatdnmyzoy --use-api` from worktree root.
- [ ] **Step 2:** Verify against a handled "thanks" thread by temporarily setting the workspace's `auto_close_mode` and triggering the real (non-dry-run) gate:
  - Set the AceZone workspace `auto_close_mode='auto'`, trigger the gate on a handled-thanks thread → thread `status='resolved'`, `close_pending=false`, no draft.
  - Set it back to `auto_close_mode='approve'`, re-trigger → `close_pending=true`, `status` unchanged.
  - RESTORE the workspace to its original `auto_close_mode` value afterward (record it first).
  (Web toggle + hours-removal are user-deployed on the droplet; verify visually there.)
- [ ] **Step 3: Report** DB states for both modes.

## Self-Review
- Master switch = auto_close_mode → Task 1 (gate) + Task 2 (UI); hours removed → Tasks 2+3; fail-safe approve → Task 1 Step 3. ✓
- Surgical web edits, no migration. ✓
