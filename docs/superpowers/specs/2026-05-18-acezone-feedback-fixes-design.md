# Design: Acezone Feedback Fixes (2026-05-18)

## Context

Acezone (first customer) reported 6 issues on 2026-05-13. This spec covers the 5 technical fixes
bundled in a single plan. Knowledge setup documentation was excluded at customer's request.

**Issues addressed:**
1. "Solved" ticket pops back and lags
2. Some Postmark emails never received (spam filter false positives)
3. AI tells customer to "contact customer support"
4. Feedback / status-update emails → AI always tries to solve something
5. Headset confusion — AI mixes macros and guides across models

---

## Fix 1: "Solved" ticket pops back

**File:** `apps/web/components/inbox/InboxSplitView.jsx`

**Root cause:** A `useEffect` at line 1419 syncs `ticketStateByThread` from server data whenever
`derivedThreads` changes. If any realtime event arrives (e.g. new email) before the PATCH to
`/api/inbox/thread-status` has settled, the effect sees the server still reporting `"Open"` while
the optimistic state says `"Solved"` — and overwrites it. The ticket pops back into the list.

**Fix:** Add a `pendingUpdateThreadIds` Set via `useRef`. In `handleTicketStateChange`, add the
thread ID to the set before the fetch and remove it in `.then()` / `.catch()`. In the `useEffect`
at line 1419, skip any thread whose ID is in `pendingUpdateThreadIds`.

```
handleTicketStateChange("Solved")
  → ticketStateByThread[id] = "Solved"   (optimistic)
  → pendingUpdateThreadIds.add(id)
  → PATCH fires

(realtime INSERT fires → derivedThreads changes → useEffect runs)
  → id is in pendingUpdateThreadIds → SKIP

PATCH succeeds
  → pendingUpdateThreadIds.delete(id)
  → Realtime UPDATE arrives with confirmed "Solved" → upsertThread updates liveThreads
  → useEffect runs again, server now says "Solved" → no change needed
```

**Scope:** Frontend only — no API or DB changes.

---

## Fix 2: Postmark emails not received (spam filter false positives)

**File:** `supabase/functions/_shared/inbox-filter.ts`

**Root cause:** `SUBJECT_PATTERNS` (including `/\bsale\b/i` and `/\bdiscount\b/i`) are tested
against the full combined text — `subject + snippet + body`. A legitimate customer email
mentioning "the sale" or "discount code" in its body is silently filtered as `spam_filter`.
The customer never gets a reply; the agent never sees the ticket.

**Fix:** Split the patterns into two groups:

- `SUBJECT_ONLY_PATTERNS`: broad terms (`sale`, `discount`, `promo`, `promotion`, `marketing`,
  `email preferences`) — tested against **subject only**.
- `COMBINED_PATTERNS`: precise signals (`unsubscribe`, `newsletter`) — tested against combined
  text as today (these are safe in body context too, e.g. `list-unsubscribe` header footers).

Headers (`list-unsubscribe`) and sender patterns remain unchanged — they are already precise.

**Scope:** `inbox-filter.ts` only. No DB or pipeline changes.

---

## Fix 3: AI tells customer to "contact customer support"

**File:** `supabase/functions/generate-draft-v2/stages/writer.ts`

**Root cause:** The v2 writer system prompt is missing the "YOU ARE THE SUPPORT TEAM" rule that
existed in the legacy `generate-draft-unified`. Without it, the model occasionally falls back to
generic deflection ("please contact our support team / a technician").

**Fix:** Add one rule to the `ABSOLUTTE REGLER` block in the writer system prompt:

```
- Du ER kundesupporten. Henvis ALDRIG kunden til "kundesupport", "teknisk support",
  "vores team", "en specialist" eller lignende — kunden kontakter dig allerede.
  Hvis problemet ikke kan løses remote, tilbyd garanti, RMA eller retur —
  aldrig afvis til en unavngivet tredjepart.
```

**Scope:** `writer.ts` system prompt only. No pipeline or DB changes.

---

## Fix 4: Feedback / status-update emails — AI tries to solve a non-problem

**Files:**
- `supabase/functions/generate-draft-v2/stages/writer.ts`
- `supabase/functions/generate-draft-v2/stages/planner.ts`

**Root cause:** The planner correctly classifies pure thank-you messages as `"thanks"`, but soft
update messages ("package arrived, all good", "issue resolved itself") land as `"other"`. Neither
`"thanks"` nor `"other"` intents have explicit writer guidance — the writer defaults to trying to
solve something.

**Fix:**

1. **planner.ts** — add `"update"` as a valid `primary_intent` value for pure status updates
   (package received, problem self-resolved, no action needed). Pipeline treats it identically
   to `"thanks"` (simple model, empty facts/queries/skills).

2. **writer.ts system prompt** — add an `INTENT-ADFÆRD` section:

```
INTENT-ADFÆRD:
- "thanks" / "update": Skriv KUN 1-2 sætningers anerkendelse. Ingen spørgsmål,
  ingen troubleshooting, ingen handlingsforslag. Eksempel: "Godt at høre! Vi er
  altid klar hvis der opstår noget."
- "other" (ingen pending_asks, ingen open_questions): Anerkend og afslut.
  Forsøg ikke at løse noget der ikke er et problem.
```

**Scope:** `planner.ts` intent enum + description, `writer.ts` system prompt, `pipeline.ts` (three spots):
- Line 203: `if (intent === "thanks")` → extend to include `"update"`
- Line 254: `["thanks", "other"]` allowlist → add `"update"`
- `plannerIntentMap` (line ~1073): add `"update": "OTHER"`

No DB changes.

---

## Fix 5: Headset confusion — AI mixes macros and guides across models

**File:** `supabase/functions/generate-draft-v2/stages/writer.ts`

**Root cause:** The retriever scores knowledge chunks lexically based on product terms from the
customer message. When the customer refers to "headset" generically, chunks from all headset
models are returned — including macros and guides that belong to a different model. The writer
prompt does not warn against mixing product-specific content.

**Fix:** Add a `VIDENSBASE — PRODUKTSPECIFICITET` rule to writer.ts:

```
VIDENSBASE — PRODUKTSPECIFICITET:
- Hvis KB indeholder guides/macros til specifikke produktmodeller, brug KUN det der
  matcher det produkt kunden nævner.
- Nævner kunden intet specifikt produkt: spørg om modelnavn KUN hvis det er
  afgørende for svaret — ellers svar generisk.
- Bland ALDRIG trin, macros eller specifikationer på tværs af produktmodeller.
```

**Acezone action (outside code):** Knowledge chunks should have explicit product names in their
titles (e.g. "Macro Guide — Model X", not "Macro Guide"). This reduces retrieval ambiguity and
is a best-practice to communicate to the customer separately.

**Scope:** `writer.ts` system prompt only. No retriever or DB changes.

---

## Files changed

| File | Change |
|------|--------|
| `apps/web/components/inbox/InboxSplitView.jsx` | Add `pendingUpdateThreadIds` ref; guard `useEffect` sync |
| `supabase/functions/_shared/inbox-filter.ts` | Split patterns into subject-only vs combined |
| `supabase/functions/generate-draft-v2/stages/writer.ts` | Add 3 prompt rules (contact-support, intent-adfærd, produktspecificitet) |
| `supabase/functions/generate-draft-v2/stages/planner.ts` | Add `"update"` intent value |
| `supabase/functions/generate-draft-v2/pipeline.ts` | Extend `"thanks"` checks to include `"update"` (lines 203, 254, plannerIntentMap) |

## Deploy note

`postmark-inbound` and `generate-draft-v2` must be deployed with `--no-verify-jwt`.
`inbox-filter.ts` is a shared module — redeploy `postmark-inbound` after changing it.
