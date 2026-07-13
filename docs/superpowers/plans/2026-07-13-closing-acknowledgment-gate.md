# Closing-acknowledgment gate — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On a pure closing acknowledgment for an already-handled thread, generate no draft and flag the thread ready-to-close.

**Tech Stack:** Deno / TypeScript, Supabase Edge Functions.

## Global Constraints
- Deno tests: `deno test --no-check --allow-env <file>`. Only 2 known pre-existing `deno check` errors (`_shared/shopify-credentials.ts:36`, `_shared/tracking/providers/gls/tracking.ts:204`) — no new ones.
- Precision-first: any missing/uncertain signal ⇒ `suggestClose:false` (do NOT close).
- Suggest only: set `close_pending = true`; NEVER force `status:"resolved"`.
- The `close_pending` DB write must be guarded by `!isDryRun` (never mutate the thread on a dry-run/eval).
- No new migration (`close_pending` column exists).

---

### Task 1: Pure `assessConversationClosing` stage

**Files:**
- Create: `supabase/functions/generate-draft-v2/stages/conversation-closing.ts`
- Test: `supabase/functions/generate-draft-v2/stages/conversation-closing.test.ts`

**Interfaces — Produces:**
```ts
export function assessConversationClosing(input: {
  intent: string;
  latestCustomerText: string;
  priorAgentResolution: boolean;
  openAsksCount: number;
}): { suggestClose: boolean; reason: string | null };
```

- [ ] **Step 1: Write failing tests**

```ts
const base = { intent: "thanks", latestCustomerText: "Yes thanks", priorAgentResolution: true, openAsksCount: 0 };

Deno.test("pure thanks on a handled thread suggests close", () => {
  const r = assessConversationClosing(base);
  assertEquals(r.suggestClose, true);
});

Deno.test("thanks with a new problem does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, latestCustomerText: "Thanks, but the address is still wrong" }).suggestClose, false);
});

Deno.test("thanks with a question does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, latestCustomerText: "Thanks! When will it ship?" }).suggestClose, false);
});

Deno.test("no prior agent resolution does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, priorAgentResolution: false }).suggestClose, false);
});

Deno.test("open asks present does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, openAsksCount: 1 }).suggestClose, false);
});

Deno.test("negative 'thanks for nothing' does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, latestCustomerText: "thanks for nothing, this is terrible" }).suggestClose, false);
});

Deno.test("non-thanks intent does NOT close", () => {
  assertEquals(assessConversationClosing({ ...base, intent: "refund" }).suggestClose, false);
});

Deno.test("Danish pure tak suggests close", () => {
  assertEquals(assessConversationClosing({ ...base, latestCustomerText: "Perfekt, mange tak!" }).suggestClose, true);
});
```

- [ ] **Step 2: Run tests, verify they fail.**

- [ ] **Step 3: Implement.** Pure, fail-safe. All of the following must hold for `suggestClose:true`, else `{suggestClose:false, reason}`:
  - `intent` (lowercased, trimmed) ∈ `{"thanks","update"}`.
  - `priorAgentResolution === true`.
  - `openAsksCount === 0`.
  - Text gate on `latestCustomerText` (trimmed; treat empty as no-close):
    - length ≤ 200.
    - no `?`.
    - NO new-ask / unresolved markers (case-insensitive, word-ish boundaries): `\b(but|however|men|dog|også|also|kan i|can you|could you|would you|hvornår|when|where|hvor|still|endnu|desværre|problem|virker ikke|doesn'?t work|not work|wrong|forkert|fejl|issue|mangler|missing|refund|return|cancel|instead)\b`.
    - NOT negative: no `\b(terrible|awful|useless|disappointed|angry|for nothing|elendig|dårlig|utilfreds|skuffet)\b`.
  - Return a `reason` string on the negative path naming the first failed check (e.g. `"has_question"`, `"new_ask_marker"`, `"no_prior_resolution"`, `"open_asks"`, `"intent_not_closing"`, `"negative_sentiment"`), and `reason:"pure_closing_acknowledgment"` on success.

- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(draft): pure closing-acknowledgment assessor`

---

### Task 2: `statusOnClosingAcknowledgment` transition

**Files:**
- Modify: `supabase/functions/_shared/thread-status/transitions.ts`
- Test: `supabase/functions/_shared/thread-status/transitions.test.ts` (append)

**Interfaces — Produces:** `export function statusOnClosingAcknowledgment(): { close_pending: true }` — a minimal patch that flags ready-to-close without changing `status`. Match the shape/style of the existing `statusOnInboundCustomerMessage` (read it first; return only the fields it makes sense to patch — here `close_pending: true`).

- [ ] **Step 1: Write failing test** asserting `statusOnClosingAcknowledgment().close_pending === true` and that it does NOT set `status:"resolved"`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the function next to `statusOnInboundCustomerMessage`.
- [ ] **Step 4: Run the whole transitions.test.ts, verify green.**
- [ ] **Step 5: Commit** — `feat(status): closing-acknowledgment ready-to-close transition`

---

### Task 3: Pipeline wiring

**Files:**
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts`

**Interfaces — Consumes:** `assessConversationClosing` (Task 1), `statusOnClosingAcknowledgment` (Task 2), existing `completeSkippedGeneration(skipReason, extra?)`.

- [ ] **Step 1:** Import both new functions.

- [ ] **Step 2:** After the planner (so `plan.primary_intent` exists) and case-state load (so `caseState` exists), and AFTER the existing Gate block, compute:
```ts
const priorAgentResolution =
  (Array.isArray(caseState?.decisions_made) && caseState.decisions_made.length > 0) ||
  (thread as { status?: string }).status === "waiting_customer";
const closing = assessConversationClosing({
  intent: plan.primary_intent,
  latestCustomerText: latestBody ?? "",
  priorAgentResolution,
  openAsksCount: Array.isArray(caseState?.pending_asks) ? caseState.pending_asks.length : 0,
});
if (closing.suggestClose) {
  if (!isDryRun && thread_id) {
    await supabase.from("mail_threads")
      .update({ ...statusOnClosingAcknowledgment(), updated_at: new Date().toISOString() })
      .eq("id", thread_id);
    await supabase.from("agent_logs").insert({
      workspace_id: workspaceId ?? null,
      step_name: "draft_closing_suggested",
      step_detail: JSON.stringify({ thread_id, intent: plan.primary_intent, reason: closing.reason }),
      status: "info",
    });
  }
  return await completeSkippedGeneration("closing_acknowledgment");
}
```
Place this so it runs BEFORE the writer/retrieval work (as early as possible after intent + case-state are known, to save the LLM cost). READ the surrounding code to confirm variable names in scope: `plan`, `caseState`, `latestBody`, `isDryRun`, `thread_id`, `thread`, `workspaceId`, `supabase`.

- [ ] **Step 3:** Typecheck `deno check supabase/functions/generate-draft-v2/pipeline.ts` — only the 2 pre-existing errors.
- [ ] **Step 4:** Re-run Task 1 + Task 2 test suites — green.
- [ ] **Step 5: Commit** — `feat(draft): skip draft + flag ready-to-close on closing acknowledgment`

---

### Task 4: Deploy + live verification

- [ ] **Step 1: Deploy** from worktree root: `supabase functions deploy generate-draft-v2 --project-ref ikuupzjaxzvatdnmyzoy --use-api`.
- [ ] **Step 2: Verify (dry-run, email_data)** with the anon Bearer + shop `38df5fef-2a23-47f3-803e-39f2d6f1ed99`:
  - Closing case — `email_data.body` = a "Yes thanks" that QUOTES a prior agent reply (so case-state sees prior resolution), e.g. body: `"Yes thanks\n\nDen 13. jul skrev AceZone Support: Hi Simon, I have now changed it to the following: ..."`. Expect `skipped:true`, `skip_reason:"closing_acknowledgment"`, `draft_text:null`.
  - Control — `email_data.body` = `"Thanks, but the address is still wrong on #4845"` → expect a normal draft (NOT skipped).
  - Control — a plain support question → normal draft.
  Since dry-run does NOT write `close_pending`, verify the CLOSE decision via `skipped`/`skip_reason` in the response (the DB write is `!isDryRun`-guarded; that path is covered by reasoning + the unit test, not the dry-run).
- [ ] **Step 3: Report** the three results verbatim.

## Self-Review
- Safeguards 1–3 → Task 1; safeguard 5 (suggest+log) → Task 3; transition → Task 2. ✓
- No hard-close, no migration, dry-run guarded. ✓
