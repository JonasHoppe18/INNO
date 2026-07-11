# "Ejer sagen"-fallback (Del 2 af dag-ét-viden-spec'en) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Når intet grounder kundens kerne-spørgsmål, skal Sonas draft anerkende spørgsmålet og love at undersøge og vende tilbage — aldrig opfinde en afvisning, kapabilitets-grænse eller tredjepart.

**Architecture:** Ny ren stage (`grounding-coverage.ts`) vurderer pre-writer om sagen er ungroundet ud fra pipelinens eksisterende signaler (matcher-selected chunks, verificerede fakta, struktureret provenance, matcher-abstention hvor tilgængelig). Ved ungroundet injiceres et "owns-the-case"-direktiv som ny blok i det eksisterende `internalRulesBlock`-array (samme mønster som `priceBlock`/`subjectAnchorBlock`), og et struktureret gap-event logges til `agent_logs` (aldrig i dry-run/eval). To-vejs-adfærden (kunde-hul vs videns-hul) arbitreres af den eksisterende `missing_required_fields`-mekanik via direktiv-teksten.

**Tech Stack:** Deno edge function (`generate-draft-v2`), colocated Deno-tests (`deno test --no-check --allow-env`), Supabase `agent_logs`.

**Spec:** `docs/superpowers/specs/2026-07-11-history-import-and-owns-the-case-design.md` (Del 2). Del 1 (historik-import) har sin egen plan.

## Global Constraints

- Fallbacken må KUN ændre output når vurderingen siger ungroundet — de stærke sager (Anna-garanti-syntetisk, Kasper-feedback 9a3a8d24, pris-DKK-syntetisk) skal producere uændret adfærd (verificeres i Task 3).
- `assessGroundingCoverage` er en REN funktion: ingen I/O, ingen exceptions — defensive null-checks; mangler inputs returneres `{ ungrounded: false, ... }` (fail-safe = eksisterende adfærd).
- Gap-log skrives ALDRIG når `isDryRun === true` (pipeline.ts:1039 `const isDryRun = isNoWriteDraftRun(...)`) — samme no-write-regel som resten af pipelinen.
- Direktivet må ALDRIG bede writeren stille et informationsspørgsmål (kunde-hul håndteres af eksisterende `missing_required_fields`-mekanik) og skal give feedback-anerkendelses-instruktionen (Kasper-fixet, deployet v343) forrang.
- Ingen ændringer af de deterministiske negative-claim-checks, ingen nye `mail_threads`-kolonner.
- Test-runner: `deno test --no-check --allow-env <fil>`. Typecheck: `deno check` fra `supabase/`-mappen; de ENESTE præeksisterende fejl er `_shared/shopify-credentials.ts:36` (TS2769) og `_shared/tracking/providers/gls/tracking.ts:204` (TS2339) — ingen NYE fejl må introduceres.
- Deploy: `supabase functions deploy generate-draft-v2 --project-ref ikuupzjaxzvatdnmyzoy --use-api` (fra repo-roden eller worktree). Prod-verifikation via dry-run-kald (se Task 3) — dry-run skriver intet.
- Implementering sker i en ISOLERET worktree fra `main` — hovedmappen har brugerens uncommittede arbejde (mailbox/settings-filer) og må ikke røres.

## Grounded kontraktflader (verificeret mod koden 2026-07-11 — brug disse, stol ikke på ældre linjenumre blindt; grep hvis noget er flyttet)

- `pipeline.ts:1799`-området: `const internalRulesBlock = [ internalRules.block || "", returnTrackingAttribution?.blockText || "", compatibilityBlock || "", comparisonBlock || "", priceBlock || "", subjectAnchorBlock || "" ].filter(Boolean).join("\n\n") || undefined;` — den nye blok tilføjes som 7. element.
- I scope på det sted: `retrieved` (med `retrieved.chunks` = matcher-selected chunk-sæt og `retrieved.matcher_debug?.abstained` — matcher_debug KAN være undefined i ikke-eval-kørsler, design fail-safe), `facts` (fact-resolver-resultat, `facts.facts: ResolvedFact[]`), `structuredFactsProvenance: StructuredFactProvenance[]` (defineret ~1588), `plan.primary_intent`, `caseState` (med `caseState.open_questions: string[]`), `latestBody`, `supabase`, `workspaceId`, `thread_id`, `isDryRun`.
- `agent_logs`-insert-mønster (fire-and-forget med .then-fejllog) findes ~1855-1875 (`buildRetrievalLogPayload`-blokken) — kopiér formen: `supabase.from("agent_logs").insert({ workspace_id: workspaceId ?? null, ... , created_at: new Date().toISOString() }).then(({ error }) => { if (error) console.warn(...); });`
- `RetrievedChunk.usable_as` findes på chunks (værdier bl.a. "policy", "procedure", "saved_reply", "background").

---

### Task 1: Ren stage — `grounding-coverage.ts` (vurdering + direktiv-builder)

**Files:**
- Create: `supabase/functions/generate-draft-v2/stages/grounding-coverage.ts`
- Test: `supabase/functions/generate-draft-v2/stages/grounding-coverage.test.ts`

**Interfaces:**
- Consumes: intet fra andre tasks.
- Produces:
  - `assessGroundingCoverage(input: { intent?: string | null; chunkCount?: number | null; matcherAbstained?: boolean | null; verifiedFactsCount?: number | null; structuredFactsCount?: number | null }): { ungrounded: boolean; reason: string | null }`
  - `buildOwnsTheCaseBlock(input: { customerAsk?: string | null; intent?: string | null }): string` — returnerer altid en ikke-tom direktiv-streng (kaldes kun når ungrounded).

- [ ] **Step 1: Skriv de fejlende tests**

`grounding-coverage.test.ts`:

```ts
// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { assessGroundingCoverage, buildOwnsTheCaseBlock } from "./grounding-coverage.ts";

Deno.test("ungrounded when nothing grounds the ask (no chunks, no facts)", () => {
  const r = assessGroundingCoverage({
    intent: "other", chunkCount: 0, matcherAbstained: false,
    verifiedFactsCount: 0, structuredFactsCount: 0,
  });
  assertEquals(r.ungrounded, true);
  assert(typeof r.reason === "string" && r.reason.length > 0);
});

Deno.test("matcher abstention marks ungrounded even when fallback chunks exist", () => {
  const r = assessGroundingCoverage({
    intent: "product_question", chunkCount: 3, matcherAbstained: true,
    verifiedFactsCount: 0, structuredFactsCount: 0,
  });
  assertEquals(r.ungrounded, true);
});

Deno.test("grounded when chunks matched (no abstention)", () => {
  const r = assessGroundingCoverage({
    intent: "warranty", chunkCount: 4, matcherAbstained: false,
    verifiedFactsCount: 0, structuredFactsCount: 0,
  });
  assertEquals(r.ungrounded, false);
});

Deno.test("grounded when live facts answer even without chunks", () => {
  const r = assessGroundingCoverage({
    intent: "tracking", chunkCount: 0, matcherAbstained: false,
    verifiedFactsCount: 2, structuredFactsCount: 0,
  });
  assertEquals(r.ungrounded, false);
});

Deno.test("thanks/update never trigger; missing inputs are fail-safe", () => {
  assertEquals(assessGroundingCoverage({ intent: "thanks", chunkCount: 0 }).ungrounded, false);
  assertEquals(assessGroundingCoverage({ intent: "update", chunkCount: 0 }).ungrounded, false);
  assertEquals(assessGroundingCoverage({}).ungrounded, false); // no signals at all -> fail-safe
  assertEquals(assessGroundingCoverage({ intent: "other" }).ungrounded, false); // counts undefined -> fail-safe
});

Deno.test("directive forbids invented refusals and includes the customer's ask", () => {
  const block = buildOwnsTheCaseBlock({ customerAsk: "Kan I kontakte Maxgaming?", intent: "complaint" });
  assert(block.includes("Kan I kontakte Maxgaming?"));
  assert(/opfind ALDRIG|ALDRIG en afvisning/i.test(block));
  assert(/undersøger .* vender tilbage|undersøger det og vender tilbage/i.test(block));
  assert(/missing_required_fields/.test(block)); // arbitration hook til kunde-hul
  assert(/feedback/i.test(block)); // precedence for feedback-acknowledge (Kasper-fixet)
});

Deno.test("directive works without a customerAsk", () => {
  const block = buildOwnsTheCaseBlock({ customerAsk: null, intent: "other" });
  assert(block.length > 50);
  assert(!block.includes("null"));
});
```

- [ ] **Step 2: Kør testen — verificér den fejler**

Run: `deno test --no-check --allow-env supabase/functions/generate-draft-v2/stages/grounding-coverage.test.ts`
Expected: FAIL (modul findes ikke).

- [ ] **Step 3: Implementér modulet**

```ts
// supabase/functions/generate-draft-v2/stages/grounding-coverage.ts
//
// Pre-writer, PURE assessment: is the customer's core ask grounded by
// anything the pipeline actually resolved this turn? When it is not, the
// writer historically INVENTED polite refusals ("vi har ikke mulighed for
// at kontakte Maxgaming", "we don't have individual mic clips") instead of
// behaving like an employee who owns the case. This stage detects the
// ungrounded state so the pipeline can inject an owns-the-case directive.
//
// Fail-safe by design: missing/undefined inputs => grounded (existing
// behavior unchanged). Never throws, no I/O, shop-agnostic.

const NEVER_TRIGGER_INTENTS = new Set(["thanks", "update"]);

export type GroundingCoverage = {
  ungrounded: boolean;
  reason: string | null;
};

export function assessGroundingCoverage(input: {
  intent?: string | null;
  chunkCount?: number | null;
  matcherAbstained?: boolean | null;
  verifiedFactsCount?: number | null;
  structuredFactsCount?: number | null;
}): GroundingCoverage {
  const intent = String(input?.intent ?? "").trim().toLowerCase();
  if (!intent || NEVER_TRIGGER_INTENTS.has(intent)) {
    return { ungrounded: false, reason: null };
  }
  // Fail-safe: signals must be PRESENT numbers/booleans to count as evidence
  // of absence. Undefined counts mean "unknown" -> grounded.
  const chunkCount = typeof input?.chunkCount === "number" ? input.chunkCount : null;
  const verifiedFactsCount =
    typeof input?.verifiedFactsCount === "number" ? input.verifiedFactsCount : null;
  const structuredFactsCount =
    typeof input?.structuredFactsCount === "number" ? input.structuredFactsCount : null;
  const matcherAbstained = input?.matcherAbstained === true;

  if (chunkCount === null || verifiedFactsCount === null || structuredFactsCount === null) {
    return { ungrounded: false, reason: null };
  }

  const hasFacts = verifiedFactsCount > 0 || structuredFactsCount > 0;
  if (hasFacts) return { ungrounded: false, reason: null };

  if (chunkCount === 0) {
    return { ungrounded: true, reason: "no_chunks_no_facts" };
  }
  if (matcherAbstained) {
    // The precision matcher looked at the candidates and concluded none of
    // them actually answers the ask — fallback chunks may still be present
    // but are topic-adjacent, not grounding.
    return { ungrounded: true, reason: "matcher_abstained_no_facts" };
  }
  return { ungrounded: false, reason: null };
}

export function buildOwnsTheCaseBlock(input: {
  customerAsk?: string | null;
  intent?: string | null;
}): string {
  const ask = String(input?.customerAsk ?? "").trim();
  const askLine = ask ? `Kundens konkrete spørgsmål: "${ask.slice(0, 200)}"` : "";
  return [
    "VIDENS-HUL — intet i shoppens viden eller live-data grounder svaret på kundens kerne-spørgsmål.",
    askLine,
    "Opfør dig som en medarbejder der EJER sagen:",
    "1. Hvis missing_required_fields angiver manglende kunde-oplysninger, så følg den mekanik uændret (stil KUN det spørgsmål).",
    "2. Ellers: anerkend kundens spørgsmål konkret, svar på den del der FAKTISK er groundet (delvist svar er fint), og skriv at du undersøger resten og vender tilbage hurtigst muligt.",
    "3. Opfind ALDRIG en afvisning, begrænsning, kapabilitet eller tredjepart. Sig IKKE 'det kan vi ikke', 'det tilbyder vi ikke' eller 'kontakt X i stedet', medmindre en kilde i konteksten eksplicit siger det.",
    "4. Deler kunden blot feedback uden at bede om noget, har feedback-anerkendelses-instruktionen forrang over denne.",
  ].filter(Boolean).join("\n");
}
```

- [ ] **Step 4: Kør testen — verificér den passerer**

Run: `deno test --no-check --allow-env supabase/functions/generate-draft-v2/stages/grounding-coverage.test.ts`
Expected: PASS, 7/7, pristine output.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-draft-v2/stages/grounding-coverage.ts supabase/functions/generate-draft-v2/stages/grounding-coverage.test.ts
git commit -m "feat(draft): pure grounding-coverage assessment + owns-the-case directive builder"
```

---

### Task 2: Pipeline-wiring + gap-log

**Files:**
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts` (import; beregning + blok før `internalRulesBlock`-arrayet ~1799; gap-log)

**Interfaces:**
- Consumes: `assessGroundingCoverage`, `buildOwnsTheCaseBlock` (Task 1) — signaturer som defineret dér.
- Produces: `ownsTheCaseBlock`-streng i `internalRulesBlock`; `agent_logs`-event `draft_ungrounded_gap` i ikke-dry-run.

- [ ] **Step 1: Tilføj import øverst i pipeline.ts (ved de andre stage-imports)**

```ts
import { assessGroundingCoverage, buildOwnsTheCaseBlock } from "./stages/grounding-coverage.ts";
```

- [ ] **Step 2: Beregn coverage + blok LIGE FØR `internalRulesBlock`-arrayet (~linje 1799; efter subjectAnchorBlock-blokken)**

```ts
    // Owns-the-case fallback: when nothing grounds the customer's core ask,
    // instruct the writer to acknowledge + investigate instead of inventing a
    // refusal. Pure assessment; fail-safe (missing signals => grounded).
    let ownsTheCaseBlock = "";
    const groundingCoverage = assessGroundingCoverage({
      intent: plan.primary_intent,
      chunkCount: Array.isArray(retrieved.chunks) ? retrieved.chunks.length : null,
      matcherAbstained: retrieved.matcher_debug?.abstained === true,
      verifiedFactsCount: Array.isArray(facts.facts) ? facts.facts.length : null,
      structuredFactsCount: structuredFactsProvenance.length,
    });
    if (groundingCoverage.ungrounded) {
      ownsTheCaseBlock = buildOwnsTheCaseBlock({
        customerAsk: caseState.open_questions?.[0] ?? null,
        intent: plan.primary_intent,
      });
      console.log(
        `[generate-draft-v2] grounding-coverage: ungrounded (${groundingCoverage.reason}) — owns-the-case directive injected`,
      );
      if (!isDryRun) {
        supabase.from("agent_logs").insert({
          workspace_id: workspaceId ?? null,
          event: "draft_ungrounded_gap",
          status: "info",
          step_detail: JSON.stringify({
            thread_id: thread_id ?? null,
            intent: plan.primary_intent,
            reason: groundingCoverage.reason,
            customer_ask: caseState.open_questions?.[0] ?? null,
          }),
          created_at: new Date().toISOString(),
        }).then(({ error }) => {
          if (error) {
            console.warn("[pipeline] draft_ungrounded_gap log failed:", error.message);
          }
        });
      }
    }
```

VIGTIGT: Læs det omkringliggende `agent_logs`-insert (buildRetrievalLogPayload-blokken ~1855-1875) og match dets FAKTISKE kolonnenavne (fx om event-feltet hedder `event` eller noget andet, og om `step_detail` er text/jsonb) — kopiér formen derfra frem for at stole blindt på snippet'et ovenfor. Justér snippet'et til de reelle kolonner.

- [ ] **Step 3: Tilføj blokken som 7. element i arrayet**

```ts
    const internalRulesBlock = [
      internalRules.block || "",
      returnTrackingAttribution?.blockText || "",
      compatibilityBlock || "",
      comparisonBlock || "",
      priceBlock || "",
      subjectAnchorBlock || "",
      ownsTheCaseBlock || "",
    ].filter(Boolean).join("\n\n") || undefined;
```

- [ ] **Step 4: Typecheck**

Run (fra `supabase/`): `deno check functions/generate-draft-v2/pipeline.ts`
Expected: KUN de 2 præeksisterende fejl (shopify-credentials.ts:36, gls/tracking.ts:204) — ingen nye.

- [ ] **Step 5: Kør Task 1-testene igen (uændrede) + commit**

```bash
deno test --no-check --allow-env supabase/functions/generate-draft-v2/stages/grounding-coverage.test.ts
git add supabase/functions/generate-draft-v2/pipeline.ts
git commit -m "feat(draft): wire owns-the-case fallback into pipeline + gap logging"
```

---

### Task 3: Deploy + live verifikationsmatrix

**Files:** ingen kodeændringer (deploy + verifikation). Evt. justering af trigger i `grounding-coverage.ts` hvis matrixen kræver det (se Step 4).

**Interfaces:**
- Consumes: alt fra Task 1-2, deployet.

- [ ] **Step 1: Deploy**

```bash
supabase functions deploy generate-draft-v2 --project-ref ikuupzjaxzvatdnmyzoy --use-api
```

- [ ] **Step 2: Kør verifikationsmatrixen (dry-runs — skriver intet)**

Kald `POST https://ikuupzjaxzvatdnmyzoy.supabase.co/functions/v1/generate-draft-v2` med `Authorization: Bearer <anon-nøglen>` (hent med Supabase MCP `get_publishable_keys` for projekt `ikuupzjaxzvatdnmyzoy`) og `Content-Type: application/json`:

| Case | Payload | Forventet |
|---|---|---|
| Mic-clips (SKAL ændres) | `{"thread_id":"f587bf4c-ad9a-4ff1-8d80-805fcf041cac","shop_id":"38df5fef-2a23-47f3-803e-39f2d6f1ed99","dry_run":true}` | INGEN opfunden afvisning ("we don't have...") — i stedet anerkend + undersøger/vender tilbage, evt. bed om ordrenummer via missing_required_fields |
| Daniel/Maxgaming (BØR ændres — dokumentér faktisk udfald) | `{"thread_id":"17bfed8e-a400-4353-8abf-0e758d16f948","shop_id":"38df5fef-2a23-47f3-803e-39f2d6f1ed99","dry_run":true}` | Ingen "vi har ikke mulighed for at kontakte Maxgaming"-påstand; ejer sagen. Hvis triggeren IKKE fyrer her (topic-adjacente chunks grounder), notér det i rapporten — det er accepteret v1-udfald |
| Kasper-feedback (MÅ IKKE ændres) | `{"thread_id":"9a3a8d24-6631-4614-855e-80646e6503ff","shop_id":"38df5fef-2a23-47f3-803e-39f2d6f1ed99","dry_run":true}` | Stadig feedback-anerkendelse (tak/produktteam), INGEN billede-anmodning, INGEN "undersøger og vender tilbage"-boilerplate der fortrænger feedback-svaret |
| Anna-garanti-syntetisk (MÅ IKKE ændres) | eval-mode: `{"shop_id":"38df5fef-2a23-47f3-803e-39f2d6f1ed99","dry_run":true,"email_data":{"subject":"A-Spire Wireless","from_email":"mailer@shopify.com","from_name":"Shopify","body":"You received a new message from your online store's contact form.\n\nCountry Code:\nDK\n\nName:\nAnna\n\nEmail:\nanna@example.com\n\nWhat Is Your Request Regarding?:\nA-Spire Wireless\n\nWhat Do You Need Help With?:\nOther\n\nBody:\nMit A-Spire Wireless headset er knækket i venstre side efter normal brug. Kan I sende mig et nyt i garanti?"}}` | Warranty-flow uændret: ombytning under garanti + beder om ordrenummer/købssted + foto |
| Pris-DKK-syntetisk (MÅ IKKE ændres) | eval-mode: samme form, Body: `Hej, hvad koster A-Blaze headsettet?` + `Country Code:\nDK` | Stadig "1499,00 DKK" |

- [ ] **Step 3: Bekræft gap-log-adfærd**

Dry-runs må IKKE have skrevet `draft_ungrounded_gap`-events. Verificér med Supabase MCP `execute_sql`:
`select count(*) from agent_logs where event='draft_ungrounded_gap';` → forventet 0 efter kun dry-runs. (Justér kolonnenavn hvis Task 2 Step 2's inspektion viste andet.)

- [ ] **Step 4: Hvis mic-clip-casen IKKE ændrede sig**

Diagnostisér med den syntetiske eval-mode-replika (eval-mode returnerer `retrieval_debug` inkl. `matcher.abstained`): `{"shop_id":"38df5fef-2a23-47f3-803e-39f2d6f1ed99","dry_run":true,"email_data":{"subject":"Spare Parts - Mic Clip","from_email":"kunde@example.com","from_name":"Kunde","body":"Hi there, can you please send me a few of these plastic mic clips that come attached to the A-Spire Wireless?"}}` — aflæs `retrieval_debug.matcher.abstained` og chunk-antal. Hvis abstained=false og chunks>0 (dvs. matcheren "matcher" topic-adjacente accessory-chunks), er v1-triggeren for konservativ for denne case: rapportér udfaldet med evidensen og STOP — udvidelse af triggeren er en beslutning til mennesket, ikke noget denne plan autoriserer.

- [ ] **Step 5: Rapportér matrix-resultaterne + commit evt. dokumentationsnote**

Rapportér alle 5 cases' faktiske drafts (før/efter hvor relevant). Ingen kode-commit i dette step medmindre Step 4 afdækkede en ren bugfix i Task 1-koden (fx felt-navnefejl) — i så fald: fix, kør tests, commit `fix(draft): ...`.

## Self-Review (udført ved planskrivning)

- **Spec-dækning:** detektion (Task 1), to-vejs-adfærd via missing_required_fields-arbitration + feedback-forrang (Task 1 direktiv-tekst), internalRulesBlock-injektion (Task 2), gap-log med no-write i dry-run (Task 2), regression-værn + verifikationsmatrix (Task 3), fail-safe-kontrakt (Task 1 tests). Del 1 (import) er bevidst IKKE i denne plan.
- **Placeholders:** Task 2 Step 2 beder implementer verificere agent_logs-kolonnenavne mod nabo-insertet — det er en eksplicit verifikation med kendt referencepunkt, ikke en TBD. Task 3 Step 4 definerer præcist diagnose-procedure + stop-kriterium.
- **Typekonsistens:** `assessGroundingCoverage`/`buildOwnsTheCaseBlock`-signaturer identiske i Task 1-def og Task 2-brug; `GroundingCoverage.reason` bruges i log og console.
