# Acezone Feedback Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 confirmed bugs reported by Acezone: "Solved" ticket pops back, Postmark emails silently dropped, AI deflects customers to "contact support", AI over-solves feedback/update emails, and AI mixes product guides across headset models.

**Architecture:** Four independent changes — one frontend fix (InboxSplitView), one shared Supabase function fix (inbox-filter), two prompt-only changes (writer.ts), and one intent-enum expansion (planner.ts + pipeline.ts). No DB schema changes. No new API endpoints. Writer.ts changes are grouped into a single task since all three prompt additions go in the same file.

**Tech Stack:** Next.js 14 (React, no test framework for UI), Deno + Supabase Edge Functions, `jsr:@std/assert@1` for Deno tests, TypeScript.

---

## Files changed

| File | What changes |
|------|-------------|
| `apps/web/components/inbox/InboxSplitView.jsx` | Add `pendingUpdateThreadIds` ref; guard server-sync `useEffect` |
| `supabase/functions/_shared/inbox-filter.ts` | Split broad patterns to subject-only check |
| `supabase/functions/_shared/inbox-filter.test.ts` | New — tests for the split pattern logic |
| `supabase/functions/generate-draft-v2/stages/writer.ts` | Add 3 prompt rules to system prompt |
| `supabase/functions/generate-draft-v2/stages/planner.ts` | Add `"update"` intent to enum + rules |
| `supabase/functions/generate-draft-v2/pipeline.ts` | Extend `"thanks"` checks to include `"update"` |

---

## Task 1: Fix "Solved" ticket pops back

**Files:**
- Modify: `apps/web/components/inbox/InboxSplitView.jsx:943` (add ref near other state declarations)
- Modify: `apps/web/components/inbox/InboxSplitView.jsx:1419-1448` (guard useEffect)
- Modify: `apps/web/components/inbox/InboxSplitView.jsx:3667-3737` (handleTicketStateChange)

**Context:** A `useEffect` at line 1419 syncs `ticketStateByThread` from server data whenever `derivedThreads` changes. If a realtime event fires between the optimistic write and the PATCH response, the effect overwrites the optimistic "Solved" with the stale server "Open". The fix is a `pendingUpdateThreadIds` Set (via `useRef`) that prevents the sync for threads with in-flight updates.

- [ ] **Step 1: Add the pending-updates ref**

  In `InboxSplitView.jsx`, immediately after line 943 (`const [ticketStateByThread, setTicketStateByThread] = useState({});`), add:

  ```jsx
  const pendingUpdateThreadIds = useRef(new Set());
  ```

- [ ] **Step 2: Guard the server-sync useEffect**

  In the `useEffect` starting at line 1419, inside the `derivedThreads.forEach` callback, add a guard immediately after the `isLocalThreadId` check (after the current line `if (!thread?.id || isLocalThreadId(thread.id)) return;`):

  ```jsx
  if (pendingUpdateThreadIds.current.has(thread.id)) return;
  ```

  The `forEach` callback should now read:

  ```jsx
  derivedThreads.forEach((thread) => {
    if (!thread?.id || isLocalThreadId(thread.id)) return;
    if (pendingUpdateThreadIds.current.has(thread.id)) return;  // ← new line
    const normalizedStatus = normalizeStatus(thread.status) || "New";
    // ... rest unchanged
  });
  ```

- [ ] **Step 3: Track pending updates in handleTicketStateChange**

  In `handleTicketStateChange` (starts at line 3667), capture the thread ID and register it as pending before the `fetch` call. Add the capture at the top of the function, and add `.finally()` to clean up:

  Replace this block (lines 3719–3734):

  ```jsx
        fetch("/api/inbox/thread-status", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: selectedThreadId,
            ...payload,
          }),
        })
          .then(async (response) => {
            if (response.ok) return;
            const data = await response.json().catch(() => null);
            throw new Error(data?.error || "Could not update ticket status.");
          })
          .catch((error) => {
            toast.error(error.message || "Could not update ticket status.");
          });
  ```

  With:

  ```jsx
        const pendingThreadId = selectedThreadId;
        pendingUpdateThreadIds.current.add(pendingThreadId);
        fetch("/api/inbox/thread-status", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: pendingThreadId,
            ...payload,
          }),
        })
          .then(async (response) => {
            if (response.ok) return;
            const data = await response.json().catch(() => null);
            throw new Error(data?.error || "Could not update ticket status.");
          })
          .catch((error) => {
            toast.error(error.message || "Could not update ticket status.");
          })
          .finally(() => {
            pendingUpdateThreadIds.current.delete(pendingThreadId);
          });
  ```

- [ ] **Step 4: Verify manually**

  Start the dev server (`npm run dev` in `apps/web`), open the inbox, mark a ticket as "Solved", and confirm it disappears from the list without flickering back. Also test changing priority/assignee while a new email arrives.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/components/inbox/InboxSplitView.jsx
  git commit -m "fix(inbox): prevent Solved status reverting on concurrent realtime events"
  ```

---

## Task 2: Fix Postmark spam filter false positives

**Files:**
- Modify: `supabase/functions/_shared/inbox-filter.ts`
- Create: `supabase/functions/_shared/inbox-filter.test.ts`

**Context:** `SUBJECT_PATTERNS` (including `/\bsale\b/i` and `/\bdiscount\b/i`) are applied to `subject + snippet + body`. A customer email mentioning "the Black Friday sale" in its body gets silently dropped. Fix: move broad terms to a subject-only check; keep `unsubscribe` and `newsletter` on the full combined text.

- [ ] **Step 1: Write failing tests**

  Create `supabase/functions/_shared/inbox-filter.test.ts`:

  ```typescript
  import { assertEquals } from "jsr:@std/assert@1";
  import { shouldSkipInboxMessage } from "./inbox-filter.ts";

  Deno.test("sale in body does not filter legitimate customer email", () => {
    assertEquals(
      shouldSkipInboxMessage({
        from: "customer@example.com",
        subject: "Problem with my order",
        body: "I bought this during the Black Friday sale and it arrived broken.",
      }),
      false,
    );
  });

  Deno.test("sale in subject filters promotional email", () => {
    assertEquals(
      shouldSkipInboxMessage({
        from: "promo@store.com",
        subject: "Big summer sale — 50% off everything",
        body: "Check out our deals",
      }),
      true,
    );
  });

  Deno.test("discount in body does not filter customer asking about discount code", () => {
    assertEquals(
      shouldSkipInboxMessage({
        from: "customer@example.com",
        subject: "My order question",
        body: "I used a discount code but it didn't apply correctly.",
      }),
      false,
    );
  });

  Deno.test("newsletter in body still filters bulk email", () => {
    assertEquals(
      shouldSkipInboxMessage({
        from: "news@brand.com",
        subject: "June update",
        body: "You are receiving this newsletter because you subscribed.",
      }),
      true,
    );
  });

  Deno.test("list-unsubscribe header still filters bulk email", () => {
    assertEquals(
      shouldSkipInboxMessage({
        from: "bulk@brand.com",
        subject: "Weekly digest",
        body: "Your weekly summary",
        headers: [{ name: "List-Unsubscribe", value: "<mailto:unsub@brand.com>" }],
      }),
      true,
    );
  });

  Deno.test("klaviyo sender still filtered", () => {
    assertEquals(
      shouldSkipInboxMessage({
        from: "noreply@klaviyo.com",
        subject: "Abandoned cart",
        body: "You left something behind",
      }),
      true,
    );
  });

  Deno.test("marketing in subject filters promotional email", () => {
    assertEquals(
      shouldSkipInboxMessage({
        from: "team@brand.com",
        subject: "Our marketing update for May",
        body: "Here's what we've been up to",
      }),
      true,
    );
  });
  ```

- [ ] **Step 2: Run tests — expect failures on sale/discount body tests**

  ```bash
  cd /Users/jonashoppe/Developer/INNO/supabase
  deno test functions/_shared/inbox-filter.test.ts
  ```

  Expected: the "sale in body" and "discount in body" tests FAIL (they currently return `true` but should return `false`).

- [ ] **Step 3: Implement the fix**

  Replace the entire content of `supabase/functions/_shared/inbox-filter.ts` with:

  ```typescript
  type EmailHeader = { name: string; value: string };

  // Broad terms — tested against subject line ONLY to avoid false positives
  // on customer emails that mention "sale" or "discount" in their message body.
  const SUBJECT_ONLY_PATTERNS = [
    /\bpromo\b/i,
    /\bpromotion\b/i,
    /\bmarketing\b/i,
    /\bdiscount\b/i,
    /\bsale\b/i,
    /\bemail preferences\b/i,
  ];

  // Safe to test against combined text — these signals are reliable even in body/footer context.
  const COMBINED_PATTERNS = [
    /unsubscribe/i,
    /newsletter/i,
  ];

  const SENDER_PATTERNS = [
    /mailchimp/i,
    /sendgrid/i,
    /klaviyo/i,
    /campaign-?monitor/i,
    /constantcontact/i,
    /mailerlite/i,
    /mailgun/i,
    /sparkpost/i,
    /postmarkapp/i,
  ];

  function normalizeHeaders(headers?: EmailHeader[] | Record<string, string> | null) {
    if (!headers) return {} as Record<string, string>;
    if (Array.isArray(headers)) {
      return headers.reduce<Record<string, string>>((acc, header) => {
        if (!header?.name) return acc;
        acc[header.name.toLowerCase()] = header.value ?? "";
        return acc;
      }, {});
    }
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value ?? ""]),
    );
  }

  export function shouldSkipInboxMessage({
    from,
    subject,
    snippet,
    body,
    headers,
  }: {
    from: string;
    subject?: string | null;
    snippet?: string | null;
    body?: string | null;
    headers?: EmailHeader[] | Record<string, string> | null;
  }): boolean {
    const normalizedHeaders = normalizeHeaders(headers);
    if (normalizedHeaders["list-unsubscribe"]) return true;

    const subjectOnly = (subject ?? "").toLowerCase();
    if (SUBJECT_ONLY_PATTERNS.some((pattern) => pattern.test(subjectOnly))) return true;

    const combined = `${subject ?? ""}\n${snippet ?? ""}\n${body ?? ""}`.toLowerCase();
    if (COMBINED_PATTERNS.some((pattern) => pattern.test(combined))) return true;

    const fromLower = (from ?? "").toLowerCase();
    if (SENDER_PATTERNS.some((pattern) => pattern.test(fromLower))) return true;

    return false;
  }
  ```

- [ ] **Step 4: Run tests — expect all pass**

  ```bash
  cd /Users/jonashoppe/Developer/INNO/supabase
  deno test functions/_shared/inbox-filter.test.ts
  ```

  Expected: `ok | 7 passed | 0 failed`

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/functions/_shared/inbox-filter.ts supabase/functions/_shared/inbox-filter.test.ts
  git commit -m "fix(inbox-filter): scope broad spam patterns to subject-only to prevent false positives"
  ```

---

## Task 3: Fix writer.ts system prompt (3 rules)

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/writer.ts`

**Context:** Three missing rules in the v2 writer prompt that exist in or are needed based on observed AI behavior: (1) never deflect to "contact support", (2) handle thanks/update intents with brief acknowledgement only, (3) never mix product-specific guides across headset models.

All three additions go into the `systemPrompt` template literal inside `runWriter`.

- [ ] **Step 1: Add "Du ER kundesupporten" rule to ABSOLUTTE REGLER**

  In `writer.ts`, find the ABSOLUTTE REGLER block. The last rule in the block is (around line 803):

  ```typescript
  - Spørg ALDRIG efter telefonnummer — det bruges ikke i vores support-workflow. Brug ordrenummer og email.
  ```

  Add this rule immediately after it (before the blank line that leads to `Returner KUN gyldigt JSON.`):

  ```typescript
  - Du ER kundesupporten. Henvis ALDRIG kunden til "kundesupport", "teknisk support", "vores team", "en specialist" eller lignende — kunden kontakter dig allerede. Kan problemet ikke løses remote, tilbyd garanti, RMA eller retur — aldrig afvis til en unavngivet tredjepart.
  ```

- [ ] **Step 2: Add INTENT-ADFÆRD section**

  Find the ÅBNING section (around line 814). After the ÅBNING block ends (after the line `- Tracking og simple admin-sager: gå STRAKS til svaret. Ingen indledning.`), add a new section:

  ```typescript
  INTENT-ADFÆRD:
  - "thanks" / "update": Skriv KUN 1-2 sætningers anerkendelse. Ingen spørgsmål, ingen troubleshooting, ingen handlingsforslag. Eksempel: "Godt at høre! Vi er altid klar hvis der opstår noget."
  - "other" (ingen pending_asks, ingen open_questions): Anerkend og afslut kortfattet. Forsøg ikke at løse noget der ikke er et problem.
  ```

- [ ] **Step 3: Add PRODUKTSPECIFICITET rule to VIDENSBASE section**

  Find the VIDENSBASE section (around line 844). After the last rule in the block (`- Fjern interne labels som "(Engelsk)", "(Dansk)" fra KB-indhold.`), add:

  ```typescript
  VIDENSBASE — PRODUKTSPECIFICITET:
  - Hvis KB indeholder guides/macros til specifikke produktmodeller, brug KUN det der matcher det produkt kunden nævner.
  - Nævner kunden intet specifikt produkt: spørg om modelnavn KUN hvis det er afgørende for svaret — ellers svar generisk.
  - Bland ALDRIG trin, macros eller specifikationer på tværs af produktmodeller.
  ```

- [ ] **Step 4: Verify no syntax errors**

  ```bash
  cd /Users/jonashoppe/Developer/INNO/supabase
  deno check functions/generate-draft-v2/stages/writer.ts
  ```

  Expected: no output (clean type-check).

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/functions/generate-draft-v2/stages/writer.ts
  git commit -m "fix(writer): add contact-support rule, intent-behaviour guidance, and product-specificity rule"
  ```

---

## Task 4: Add "update" intent to planner and pipeline

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/planner.ts`
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts`

**Context:** Soft status-update emails ("package arrived, all good", "issue resolved itself") land as `"other"` today. Adding `"update"` as a first-class intent makes the planner classify them explicitly, and the pipeline can then treat them identically to `"thanks"` (simple model, no facts/queries/skills/actions).

- [ ] **Step 1: Verify existing tests pass before changing anything**

  ```bash
  cd /Users/jonashoppe/Developer/INNO/supabase
  deno test functions/generate-draft-v2/pipeline_test.ts
  ```

  Expected: `ok | 4 passed | 0 failed`. These tests cover `applyAutomationConstraints` and `shouldDeferDraftUntilActionDecision` — neither is touched by this task, but confirming a clean baseline before editing is good practice. The model-selection function (`selectWriterModel`) is internal and not testable without LLM calls; type-check in Step 5 is sufficient.

- [ ] **Step 2: Add "update" to planner.ts enum**

  In `planner.ts`, find the `PLANNER_SCHEMA` JSON Schema enum array (around line 36–46):

  ```typescript
  enum: [
    "tracking",
    "return",
    "refund",
    "exchange",
    "address_change",
    "product_question",
    "complaint",
    "thanks",
    "other",
  ],
  ```

  Add `"update"` after `"thanks"`:

  ```typescript
  enum: [
    "tracking",
    "return",
    "refund",
    "exchange",
    "address_change",
    "product_question",
    "complaint",
    "thanks",
    "update",
    "other",
  ],
  ```

- [ ] **Step 3: Update the schema string and rules in planner.ts**

  Find the `systemPrompt` string (around line 74). Update the schema comment line (line ~79):

  ```
  "primary_intent": "tracking|return|refund|exchange|address_change|product_question|complaint|thanks|other",
  ```

  Change to:

  ```
  "primary_intent": "tracking|return|refund|exchange|address_change|product_question|complaint|thanks|update|other",
  ```

  Then find the rules block for `"thanks"` (around line 99–122). After the line:

  ```
  - Message is ONLY expressing gratitude (...) → ALWAYS "thanks". ...
  ```

  Add a new rule immediately after:

  ```
  - Message is a pure status update with no open problem — customer confirms package arrived, issue resolved itself, or just provides a heads-up with nothing to act on → ALWAYS "update". Like "thanks", do NOT look at order context. A pure update is always "update".
  ```

  Then after the three `"thanks"` rules (required_facts, sub_queries, skills_to_consider must be empty), add matching rules for `"update"`:

  ```
  - For "update" intent: required_facts MUST be empty [] — no order lookup needed
  - For "update" intent: sub_queries MUST be empty [] — no knowledge retrieval needed
  - For "update" intent: skills_to_consider MUST be empty []
  ```

- [ ] **Step 4: Update pipeline.ts — three spots**

  **Spot 1** — model selection (around line 203). Change:

  ```typescript
  if (intent === "thanks") return SIMPLE_MODEL;
  ```

  To:

  ```typescript
  if (intent === "thanks" || intent === "update") return SIMPLE_MODEL;
  ```

  **Spot 2** — knowledge gap logic (around line 254). Change:

  ```typescript
  if (chunkCount === 0 && !["thanks", "other"].includes(intent)) {
  ```

  To:

  ```typescript
  if (chunkCount === 0 && !["thanks", "update", "other"].includes(intent)) {
  ```

  **Spot 3** — `plannerIntentMap` (around line 1082). After `thanks: "OTHER",` add:

  ```typescript
  update: "OTHER",
  ```

- [ ] **Step 5: Type-check both files**

  ```bash
  cd /Users/jonashoppe/Developer/INNO/supabase
  deno check functions/generate-draft-v2/stages/planner.ts
  deno check functions/generate-draft-v2/pipeline.ts
  ```

  Expected: no output (clean type-check).

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/functions/generate-draft-v2/stages/planner.ts \
          supabase/functions/generate-draft-v2/pipeline.ts
  git commit -m "feat(planner): add 'update' intent for status-update emails — treated as thanks in pipeline"
  ```

---

## Task 5: Deploy

**Note:** `inbox-filter.ts` is a shared module imported by `postmark-inbound`. Redeploy `postmark-inbound` to pick up the change. `generate-draft-v2` must also be redeployed.

- [ ] **Step 1: Deploy postmark-inbound**

  ```bash
  supabase functions deploy postmark-inbound --no-verify-jwt
  ```

- [ ] **Step 2: Deploy generate-draft-v2**

  ```bash
  supabase functions deploy generate-draft-v2 --no-verify-jwt
  ```

- [ ] **Step 3: Smoke-test in production**

  Send a test email from a customer address with "sale" in the body. Verify it appears in the inbox within ~60 seconds. Mark it as "Solved". Verify it disappears without popping back.
