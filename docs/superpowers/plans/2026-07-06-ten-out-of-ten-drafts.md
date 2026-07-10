# 10/10 Drafts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lukke gabet mellem AI-drafts og medarbejder-svar ved at (a) shippe den udeployede guard-backlog og (b) bygge det manglende lærings-loop over de 96 major-edit før/efter-par, så hver rettelse fra en medarbejder bliver til en konkret, reviewet forbedring.

**Architecture:** Data-fundamentet findes allerede: `drafts`-tabellen har `ai_draft_text` + `final_sent_text` pr. sendt draft (96 major_edit, 12 minor, 56 no_edit), og `feedback_suggestions`-tabellen + shape-helperen (`apps/web/lib/server/feedback-suggestions.js`) er bygget. Det der mangler er (1) en **distiller** der LLM-klassificerer major-edit-par til root-causes og skriver aktionable suggestions, (2) en **review-flade** (API + panel) så suggestions kan godkendes/afvises (i dag: 87 suggestions, 0 reviewed), og (3) en **export** af godkendte golden-case-suggestions til eval-golden-settet. Retrieval-recall og Ship24 er selvstændige subsystemer og får egne planer (Task 8).

**Tech Stack:** Next.js 14 App Router (JS), Supabase (service_role + `resolveAuthScope`/`applyScope`), Node-scripts i `supabase/scripts/` (env fra `apps/web/.env.local`), OpenAI via `OPENAI_MODEL` (default gpt-4o), node:test i `tests/*.test.mjs`.

## Global Constraints

- Alle fixes skal generalisere på tværs af webshops — ALDRIG hardcode shop-specifik logik (AceZone er test-fixture, ikke special case).
- Alle nye queries mod mail-/draft-tabeller SKAL workspace-scopes via `resolveAuthScope` + `applyScope` (`apps/web/lib/server/workspace-auth.js`) — RLS er ikke aktiv på mail-tabellerne.
- `feedback_suggestions` er inert by design: suggestions muterer ALDRIG knowledge, prompts eller eval automatisk. `status='applied'` sættes kun af et kontrolleret apply-flow.
- Ingen rå kunde-/draft-tekst i `evidence_json` (enforced af `FORBIDDEN_EVIDENCE_KEYS` i `feedback-suggestions.js`) — rå tekst bliver i `drafts`/`mail_messages`.
- Edge-function deploys til prod kræver `--use-api`; `postmark-inbound` deployes altid med `--no-verify-jwt`.
- Commit tidligt og hyppigt.

---

## Fase 0 — Ship den udeployede backlog (ingen ny kode, størst umiddelbar effekt)

### Task 1: Deploy READINESS-6 guard-fixes

Natte-proben fandt hallucinerede tracking-links, pronomen-faktura-løfter og ugroundede OOS-claims der passerer de DEPLOYEDE guards. Fixene (READINESS-6a–6f) er committet lokalt men ikke deployet — de matcher de modificerede filer i working tree (`return-tracking-attribution.ts`, `tracking-writer`, `writer-invoice-promise`, `unsupported-commitment-check`, `fact-resolver.ts`, `writer.ts`, `pipeline.ts`, `support-voice.ts` m.fl.).

**Files:**
- Ingen nye — deploy af eksisterende ændringer i `supabase/functions/generate-draft-v2/` + `supabase/functions/_shared/support-voice.ts` + `supabase/functions/refine-draft/`.

- [ ] **Step 1: Kør alle stage-tests lokalt**

Run: `cd supabase/functions && deno test --allow-all generate-draft-v2/ _shared/support-voice.test.ts`
Expected: PASS på alt undtagen den kendte pre-eksisterende action-decision exchange-failure (den er en ejer-beslutning, ikke en blocker — noter den i commit-beskeden hvis den stadig fejler).

- [ ] **Step 2: Commit working tree**

```bash
git add supabase/functions apps/web/app/api/threads tests/email-signature.test.mjs
git commit -m "fix(guards): READINESS-6 night-probe fixes + support-voice module"
```

- [ ] **Step 3: Deploy**

```bash
supabase functions deploy generate-draft-v2 --use-api
supabase functions deploy refine-draft --use-api
```

- [ ] **Step 4: Verificér mod prod**

Run: `set -a && source apps/web/.env.local && set +a && node supabase/scripts/run-golden-eval.mjs --tier edge`
Expected: Alle edge-gates PASS (exit 0). Ved regression: rul tilbage via redeploy af forrige commit.

- [ ] **Step 5: Verificér support-voice i praksis** — generér 1 draft via eval-flowet på en tracking-ticket og bekræft at draften ikke indeholder "tak for din henvendelse"/"vores system"/team-handoff-sprog.

### Task 2: Merge/deploy Slice O (PR #74) og Q2b-1 return-address selector

Begge er TDD-grønne på branches, ikke deployet. Slice O fjerner robot-filler deterministisk (samme mål som support-voice — verificér at de to ikke dobbelt-behandler); Q2b-1 fixer g-034 (forkert returadresse pr. land).

- [ ] **Step 1:** Rebase PR #74 mod main efter Task 1, kør `deno test --allow-all` på de berørte stages, merge.
- [ ] **Step 2:** Samme for Q2b-1-branchen (return-address selector).
- [ ] **Step 3:** `supabase functions deploy generate-draft-v2 --use-api` og genkør `run-golden-eval.mjs --tier edge`.
- [ ] **Step 4:** Commit + notér i `docs/superpowers/plans/`-checklisten at backloggen er lukket.

---

## Fase 1 — Major-edit distiller (gør de 96 rettelser til aktionable diagnoser)

I dag er alle 87 suggestions `eval_golden_case_suggestion` med `root_cause='insufficient_data'` — detektoren diagnosticerer ikke. Distilleren læser `drafts`-rækker med `edit_classification='major_edit'`, sammenligner `ai_draft_text` mod `final_sent_text` med LLM, klassificerer til en af de eksisterende `ROOT_CAUSES` og skriver en `feedback_suggestions`-række via den eksisterende shape-helper. Output: et root-cause-histogram der fortæller præcis hvor de 96 rettelser kommer fra (tone vs. manglende viden vs. tracking vs. policy).

### Task 3: Pure distiller-helper med tests

**Files:**
- Create: `apps/web/lib/server/major-edit-distiller.js`
- Test: `tests/major-edit-distiller.test.mjs`

**Interfaces:**
- Consumes: `shapeSuggestionRow` fra `apps/web/lib/server/feedback-suggestions.js` (eksisterende), `ROOT_CAUSES`, `SUGGESTION_TYPES`.
- Produces: `buildDistillerPrompt({ aiDraftText, finalSentText, ticketCategory })` → `{ system, user }`; `parseDistillerResponse(jsonText)` → `{ root_cause, suggestion_type, proposed_change_summary, confidence }` (kaster ved ukendt root_cause/type); `buildSuggestionFromDraftRow({ draftRow, classification })` → insert-row via `shapeSuggestionRow` med `dedup_key = "distill:" + draftRow.draft_id`.

- [ ] **Step 1: Skriv failing tests**

```js
// tests/major-edit-distiller.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDistillerPrompt,
  parseDistillerResponse,
  buildSuggestionFromDraftRow,
} from "../apps/web/lib/server/major-edit-distiller.js";

test("prompt includes both drafts and constrains root causes", () => {
  const { system, user } = buildDistillerPrompt({
    aiDraftText: "AI-UDKAST",
    finalSentText: "MEDARBEJDER-SVAR",
    ticketCategory: "tracking",
  });
  assert.match(user, /AI-UDKAST/);
  assert.match(user, /MEDARBEJDER-SVAR/);
  assert.match(system, /style_tone/);
  assert.match(system, /missing_knowledge/);
});

test("parse rejects unknown root_cause", () => {
  assert.throws(() =>
    parseDistillerResponse(JSON.stringify({
      root_cause: "vibes",
      suggestion_type: "writer_style_rule_suggestion",
      proposed_change_summary: "x",
      confidence: 0.9,
    }))
  );
});

test("parse accepts valid classification", () => {
  const out = parseDistillerResponse(JSON.stringify({
    root_cause: "style_tone",
    suggestion_type: "writer_style_rule_suggestion",
    proposed_change_summary: "Draften reciterede hele returpolitikken; medarbejderen sendte kun adressen.",
    confidence: 0.8,
  }));
  assert.equal(out.root_cause, "style_tone");
});

test("suggestion row carries ids but no raw text, and is idempotent per draft", () => {
  const draftRow = {
    draft_id: "d-1", thread_id: "11111111-1111-1111-1111-111111111111",
    shop_id: "22222222-2222-2222-2222-222222222222",
    workspace_id: "33333333-3333-3333-3333-333333333333",
    ticket_category: "returns", edit_delta_pct: 71.2,
    ai_draft_text: "RÅ AI-TEKST", final_sent_text: "RÅ SENDT TEKST",
  };
  const classification = {
    root_cause: "missing_knowledge",
    suggestion_type: "knowledge_gap_suggestion",
    proposed_change_summary: "Mangler chunk om byttemærkat for udenlandske ordrer.",
    confidence: 0.7,
  };
  const row = buildSuggestionFromDraftRow({ draftRow, classification });
  assert.equal(row.dedup_key, "distill:d-1");
  assert.equal(row.status, "suggested");
  assert.ok(!JSON.stringify(row.evidence_json).includes("RÅ AI-TEKST"));
  assert.equal(row.evidence_json.edit_delta_pct, 71.2);
});
```

- [ ] **Step 2: Kør tests, verificér FAIL**

Run: `node --test tests/major-edit-distiller.test.mjs`
Expected: FAIL — "Cannot find module .../major-edit-distiller.js"

- [ ] **Step 3: Implementér helperen**

```js
// apps/web/lib/server/major-edit-distiller.js
//
// Pure helpers for the major-edit distiller. No Supabase client, no OpenAI
// client — the script in supabase/scripts/distill-major-edits.mjs does I/O.
import {
  ROOT_CAUSES,
  SUGGESTION_TYPES,
  shapeSuggestionRow,
} from "./feedback-suggestions.js";

export function buildDistillerPrompt({ aiDraftText, finalSentText, ticketCategory }) {
  const system = [
    "Du analyserer hvorfor en supportmedarbejder omskrev et AI-udkast markant, på tværs af vilkårlige webshops.",
    "Klassificér den PRIMÆRE årsag som præcis én af: " + [...ROOT_CAUSES].join(", ") + ".",
    "Vælg suggestion_type som præcis én af: " + [...SUGGESTION_TYPES].join(", ") + ".",
    "Svar KUN med JSON: {\"root_cause\", \"suggestion_type\", \"proposed_change_summary\", \"confidence\"}.",
    "proposed_change_summary: 1-2 sætninger på dansk, parafraseret — citér ALDRIG kundens eller medarbejderens tekst ordret, og medtag ingen navne/emails.",
  ].join("\n");
  const user = [
    `Ticket-kategori: ${ticketCategory || "ukendt"}`,
    "--- AI-UDKAST ---", String(aiDraftText || ""),
    "--- MEDARBEJDERENS SENDTE SVAR ---", String(finalSentText || ""),
  ].join("\n");
  return { system, user };
}

export function parseDistillerResponse(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!ROOT_CAUSES.has(parsed.root_cause)) {
    throw new Error(`unknown root_cause: ${parsed.root_cause}`);
  }
  if (!SUGGESTION_TYPES.has(parsed.suggestion_type)) {
    throw new Error(`unknown suggestion_type: ${parsed.suggestion_type}`);
  }
  const summary = String(parsed.proposed_change_summary || "").trim();
  if (!summary) throw new Error("empty proposed_change_summary");
  const confidence = Number(parsed.confidence);
  return {
    root_cause: parsed.root_cause,
    suggestion_type: parsed.suggestion_type,
    proposed_change_summary: summary,
    confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0.5,
  };
}

export function buildSuggestionFromDraftRow({ draftRow, classification }) {
  return shapeSuggestionRow({
    shop_id: draftRow.shop_id,
    workspace_id: draftRow.workspace_id,
    thread_id: draftRow.thread_id,
    draft_id: draftRow.draft_id,
    suggestion_type: classification.suggestion_type,
    root_cause: classification.root_cause,
    confidence: classification.confidence,
    proposed_change_summary: classification.proposed_change_summary,
    evidence_json: {
      source: "major_edit_distiller",
      ticket_category: draftRow.ticket_category ?? null,
      edit_delta_pct: draftRow.edit_delta_pct ?? null,
      edit_classification: "major_edit",
    },
    dedup_key: `distill:${draftRow.draft_id}`,
  });
}
```

> NB: Tjek `shapeSuggestionRow`'s faktiske signatur i `feedback-suggestions.js` (linje ~70-169) før implementering og tilpas feltnavne — helperen validerer selv types/root-causes og strip'er forbidden evidence-keys; genimplementér IKKE den validering her.

- [ ] **Step 4: Kør tests, verificér PASS** — `node --test tests/major-edit-distiller.test.mjs`
- [ ] **Step 5: Commit** — `git commit -m "feat(feedback): major-edit distiller helpers"`

### Task 4: Distiller-script mod prod-data

**Files:**
- Create: `supabase/scripts/distill-major-edits.mjs`

**Interfaces:**
- Consumes: Task 3-helpers; env `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL` (source `apps/web/.env.local` som de andre scripts).
- Produces: `feedback_suggestions`-rows (upsert på `dedup_key`) + histogram på stdout.

- [ ] **Step 1: Skriv scriptet**

```js
// supabase/scripts/distill-major-edits.mjs
//
// Classify every major_edit draft pair into a root cause and write an
// actionable feedback_suggestions row (idempotent via dedup_key).
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/distill-major-edits.mjs --limit 5 --dry-run   # smoke
//   node supabase/scripts/distill-major-edits.mjs                       # full
import { createClient } from "@supabase/supabase-js";
import {
  buildDistillerPrompt,
  parseDistillerResponse,
  buildSuggestionFromDraftRow,
} from "../../apps/web/lib/server/major-edit-distiller.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 500;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const model = process.env.OPENAI_MODEL || "gpt-4o";

const { data: rows, error } = await supabase
  .from("drafts")
  .select("draft_id, thread_id, shop_id, workspace_id, ticket_category, edit_delta_pct, ai_draft_text, final_sent_text")
  .eq("edit_classification", "major_edit")
  .eq("status", "sent")
  .not("ai_draft_text", "is", null)
  .not("final_sent_text", "is", null)
  .order("created_at", { ascending: false })
  .limit(limit);
if (error) throw error;

const histogram = {};
for (const draftRow of rows) {
  const { system, user } = buildDistillerPrompt({
    aiDraftText: draftRow.ai_draft_text,
    finalSentText: draftRow.final_sent_text,
    ticketCategory: draftRow.ticket_category,
  });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const body = await res.json();
  let classification;
  try {
    classification = parseDistillerResponse(body.choices[0].message.content);
  } catch (e) {
    console.warn(`skip ${draftRow.draft_id}: ${e.message}`);
    continue;
  }
  histogram[classification.root_cause] = (histogram[classification.root_cause] || 0) + 1;
  const row = buildSuggestionFromDraftRow({ draftRow, classification });
  if (!dryRun) {
    const { error: upsertErr } = await supabase
      .from("feedback_suggestions")
      .upsert(row, { onConflict: "dedup_key" });
    if (upsertErr) throw upsertErr;
  }
  console.log(`${draftRow.draft_id}\t${classification.root_cause}\t${classification.proposed_change_summary}`);
}
console.log("\nRoot-cause histogram:", JSON.stringify(histogram, null, 2));
```

- [ ] **Step 2: Smoke-test dry-run** — `node supabase/scripts/distill-major-edits.mjs --limit 5 --dry-run`. Expected: 5 klassifikationer + histogram, ingen DB-writes.
- [ ] **Step 3: Spot-tjek de 5** manuelt mod de faktiske draft-par (læses via SQL) — er root_cause plausibel? Justér system-prompten hvis >1 af 5 er skæve.
- [ ] **Step 4: Fuld kørsel** — `node supabase/scripts/distill-major-edits.mjs`. Expected: ~96 rows upserted, histogram printet. **Histogrammet er en hovedleverance** — gem det i `docs/superpowers/2026-07-distill-histogram.md` og lad det styre prioriteringen af efterfølgende fixes.
- [ ] **Step 5: Commit** — `git commit -m "feat(feedback): distill-major-edits script + first histogram"`

---

## Fase 2 — Review-flade (fra 0 reviewed til et kørende loop)

### Task 5: API-route til list + review af suggestions

**Files:**
- Create: `apps/web/app/api/feedback-suggestions/route.js` (GET liste)
- Create: `apps/web/app/api/feedback-suggestions/[suggestionId]/route.js` (PATCH review)
- Test: `tests/feedback-suggestions-route.test.mjs` (pure validation-helper)

**Interfaces:**
- Consumes: `resolveAuthScope`/`applyScope` fra `@/lib/server/workspace-auth`; auth-mønster kopieres 1:1 fra `apps/web/app/api/threads/[threadId]/draft-stats/route.js:1-45`.
- Produces: `GET /api/feedback-suggestions?status=suggested` → `{ suggestions: [...] }` sorteret på confidence desc; `PATCH /api/feedback-suggestions/:id` body `{ status: "approved"|"rejected"|"reviewed", review_note? }` → opdateret række med `reviewer_user_id` + `reviewed_at`.

- [ ] **Step 1: Failing test for review-payload-validering** (pure helper `validateReviewPatch` i `apps/web/lib/server/feedback-suggestions.js` — genbrug `SUGGESTION_STATUSES`; afvis `applied` og `suggested` som PATCH-mål):

```js
// tests/feedback-suggestions-route.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { validateReviewPatch } from "../apps/web/lib/server/feedback-suggestions.js";

test("accepts approve with note", () => {
  const out = validateReviewPatch({ status: "approved", review_note: "god golden case" });
  assert.deepEqual(out, { status: "approved", review_note: "god golden case" });
});
test("rejects applied via review endpoint", () => {
  assert.throws(() => validateReviewPatch({ status: "applied" }));
});
test("rejects unknown status", () => {
  assert.throws(() => validateReviewPatch({ status: "yolo" }));
});
```

- [ ] **Step 2: Verificér FAIL** — `node --test tests/feedback-suggestions-route.test.mjs`
- [ ] **Step 3: Implementér `validateReviewPatch`** i `feedback-suggestions.js`:

```js
export function validateReviewPatch({ status, review_note } = {}) {
  const allowed = new Set(["reviewed", "approved", "rejected"]);
  if (!allowed.has(status)) throw new Error(`invalid review status: ${status}`);
  const note = review_note == null ? undefined : String(review_note).slice(0, MAX_SUMMARY_LEN);
  return note === undefined ? { status } : { status, review_note: note };
}
```

- [ ] **Step 4: Verificér PASS + implementér routes.** GET: service-client, `resolveAuthScope`, dernæst `applyScope(query, scope)` på `from("feedback_suggestions").select("*").eq("status", statusParam).order("confidence", { ascending: false }).limit(100)`. PATCH: samme scope-tjek, dernæst `update({ ...validateReviewPatch(body), reviewer_user_id: clerkUserId, reviewed_at: new Date().toISOString() }).eq("id", suggestionId)` — og verificér at rækken matcher scope FØR update (hent + scope-tjek, ellers 404). Kopiér env/klient-boilerplate fra draft-stats-routen ordret.
- [ ] **Step 5: Manuel verifikation** — `curl` GET/PATCH lokalt mod dev-serveren med en rigtig suggestion-id; bekræft `reviewed_at` sættes.
- [ ] **Step 6: Commit** — `git commit -m "feat(feedback): review API for feedback_suggestions"`

### Task 6: Minimal review-UI

**Files:**
- Create: `apps/web/components/FeedbackReviewPanel.jsx`
- Modify: den side hvor EvalPanel/insights allerede rendres (find med `grep -rn "EvalPanel" apps/web/app` og tilføj panelet samme sted).

- [ ] **Step 1: Byg panelet** — client component: fetch `GET /api/feedback-suggestions?status=suggested`, render liste med `root_cause`-badge, `proposed_change_summary`, confidence, `thread_id`-link til inbox-tråden, og tre knapper (Godkend / Afvis / Senere) der PATCH'er. Følg eksisterende Tailwind/Radix-mønstre fra EvalPanel. Optimistisk fjernelse fra listen ved review.
- [ ] **Step 2: Manuel verifikation i browser** — reviewér 5 rigtige suggestions end-to-end; bekræft i SQL at `status`/`reviewer_user_id`/`reviewed_at` er sat.
- [ ] **Step 3: Commit** — `git commit -m "feat(feedback): FeedbackReviewPanel review surface"`
- [ ] **Step 4 (proces, ikke kode):** Aftal en kadence — 10 min. review pr. dag indtil backloggen på ~180 suggestions (87 + ~96 nye) er nede. Uden denne vane er loopet dødt igen.

### Task 7: Export af godkendte golden-cases til eval-settet

**Files:**
- Create: `supabase/scripts/export-approved-golden-cases.mjs`

**Interfaces:**
- Consumes: `feedback_suggestions` med `status='approved'` og `suggestion_type='eval_golden_case_suggestion'`; eksisterende golden-set-format i `supabase/eval/golden-set.acezone.json` (læs formatet derfra — genbrug feltnavne præcist).
- Produces: appender nye cases til golden-settet (dedup på thread_id) og sætter `status='applied'` + `follow_up_task_ref` på de eksporterede suggestions.

- [ ] **Step 1: Skriv scriptet** — hent approved golden-case-suggestions, slå tråd + sendt svar op (`drafts.final_sent_text` som ground truth-anker, samme princip som eval-harnessens "sidste agent-svar"), byg case-objekt i golden-set-format, append hvis thread_id ikke findes, skriv filen, opdatér suggestion-status til `applied` (dette script ER det kontrollerede apply-flow for netop denne type). `--dry-run` first, som suggest-routen.
- [ ] **Step 2: Dry-run + diff** — `node supabase/scripts/export-approved-golden-cases.mjs --dry-run` og gennemse den viste diff af golden-settet.
- [ ] **Step 3: Kør + commit** golden-set-ændringen sammen med scriptet; kør `run-golden-eval.mjs --limit 2` som smoke.
- [ ] **Step 4: Commit** — `git commit -m "feat(eval): export approved golden-case suggestions into golden set"`

---

## Fase 3 — De to store selvstændige subsystemer (egne planer)

### Task 8: Skriv to opfølgningsplaner (styret af Task 4-histogrammet)

Disse er bevidst IKKE detaljeret her — de er selvstændige subsystemer, og histogrammet fra Task 4 afgør rækkefølgen:

- [ ] **Step 1: `docs/superpowers/plans/2026-07-XX-retrieval-recall.md`** — hvis `missing_knowledge`/`incorrect_policy` dominerer histogrammet. Byg på golden-eval/gold-labels-tooling og dongle-læringen (fix scoring/matcher, ikke lexical injection). Slice 2B (compat-abstention) hører til her.
- [ ] **Step 2: `docs/superpowers/plans/2026-07-XX-ship24-outbound-tracking.md`** — hvis `live_fact_tracking` dominerer. Spec'en er færdig (Ship24 `/tracking/search` som read-only fallback efter carrier-overdragelse; AfterShip fravalgt). Husk 3PL-reglen: fulfilled ≠ shipped.
- [ ] **Step 3:** Kør planerne i histogram-rækkefølge.

---

## Succeskriterium og måling

- [ ] **Ugentlig måling** (gem som `supabase/scripts/edit-stats.sql` eller kør ad hoc):

```sql
select edit_classification, count(*),
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from drafts
where status = 'sent' and edit_classification is not null
  and created_at > now() - interval '14 days'
group by 1;
```

**Baseline i dag (all-time):** major_edit 59 %, minor 7 %, no_edit 34 %.
**Mål for "10/10":** `no_edit + minor_edit ≥ 80 %` over en rullende 14-dages periode, OG golden-eval edge-gates grønne. Når det er nået: første kunde ud af test-mode.
