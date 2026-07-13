# Ungrounded kapabilitets-afvisnings-guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Når Sonas draft selvsikkert påstår en ugrundet kapabilitets-/tilbuds-grænse ("vi tilbyder ikke X", "det kan vi ikke", "we don't offer X"), erstat den sætning deterministisk med en "ejer sagen"-hedge i svarets sprog og flag til review — uden ekstra LLM-kald.

**Architecture:** Udvid det eksisterende `unsupported-negative-claim-check.ts` med en ny `unsupported_capability_claim`-familie (detektion + eksisterende grounding-allowlist). Tilføj et nyt rent modul `capability-refusal-rewrite.ts` der erstatter de ugrundede capability-sætninger med en sprogmatchet hedge. Wire i `pipeline.ts` lige efter det eksisterende check (post-writer, ~linje 3167): ved capability-violations omskrives `finalDraft` og `requires_review` bevares.

**Tech Stack:** Deno edge function (`generate-draft-v2`), colocated Deno-tests (`deno test --no-check --allow-env`).

**Spec:** `docs/superpowers/specs/2026-07-13-capability-refusal-guard-design.md`.

## Global Constraints

- Kun `unsupported_capability_claim`-violations omskrives. De øvrige negative-claim-familier (compatibility/fit/availability/purchasability) forbliver FLAG-ONLY, uændret.
- En capability-benægtelse er kun tilladt (compliant, ingen omskrivning) hvis grounddet af en retrieved chunk med `usable_as` ∈ {policy, procedure, saved_reply, background} der indeholder matchende benægtelses-ordlyd OG deler et indholdsord (stopword-filtreret token-overlap) med draft-sætningen. Ticket_examples tæller IKKE (indgår ikke i `retrieved_chunks`).
- Detektion er sætnings-scopet og konservativ: usikkerheds-fraser ("jeg kan ikke bekræfte", "jeg kan ikke se lagerstatus", "I can't confirm") må ALDRIG matche capability-familien.
- Begge nye enheder er RENE (ingen I/O, kaster aldrig); tomme/manglende inputs → no-op (uændret draft, compliant). Fail-safe.
- Hedge-tekst: `da` → "Det undersøger jeg og vender tilbage til dig om." ; alle andre sprog → "Let me look into that and get back to you."
- Test-runner: `deno test --no-check --allow-env <fil>`. Typecheck: `deno check` fra `supabase/`; de ENESTE præeksisterende fejl er `_shared/shopify-credentials.ts:36` (TS2769) og `_shared/tracking/providers/gls/tracking.ts:204` (TS2339) — ingen NYE fejl.
- Deploy: `supabase functions deploy generate-draft-v2 --project-ref ikuupzjaxzvatdnmyzoy --use-api`. Prod-verifikation via dry-run (skriver intet).
- Isoleret worktree fra `main` (hovedmappen har brugerens uncommittede arbejde).

## Grounded kontraktflader (verificeret 2026-07-13)

- `stages/unsupported-negative-claim-check.ts`: `checkUnsupportedNegativeClaims(input: { draft_text; structured_facts?; facts?; retrieved_chunks? }): { compliant; violations: Array<{ type: UnsupportedNegativeClaimViolationType; excerpt: string }>; requires_review: boolean }`. Har `FAMILIES: ClaimFamily[]` (hver `{ violationType, patterns: RegExp[] }`), `CHUNK_NEGATION_PATTERNS: RegExp[]`, `OVERLAP_STOPWORDS: Set<string>`, og en intern grounding-funktion der pr. violation tjekker kilder A/B/C. `UnsupportedNegativeClaimViolationType` er en union — den nye værdi `"unsupported_capability_claim"` tilføjes dér.
- `pipeline.ts:3167`: `const unsupportedNegativeClaimCheck = checkUnsupportedNegativeClaims({ draft_text: finalDraft ?? "", structured_facts: structuredFactsProvenance, facts: facts.facts, retrieved_chunks: retrieved.chunks });` fulgt af `if (unsupportedNegativeClaimCheck.requires_review) { finalRoutingHint = "review"; blockSendRecommended = true; ... }`. `finalDraft` (string|null) og `replyLanguage` (string, defineret ~linje 2069) er i scope her.

---

### Task 1: Capability-familie i detektionen

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/unsupported-negative-claim-check.ts`
- Test: `supabase/functions/generate-draft-v2/stages/unsupported-negative-claim-check.test.ts` (findes muligvis; ellers opret)

**Interfaces:**
- Produces: `checkUnsupportedNegativeClaims` returnerer nu også violations med `type: "unsupported_capability_claim"`; `UnsupportedNegativeClaimViolationType`-unionen inkluderer den værdi.

- [ ] **Step 1: Skriv de fejlende tests**

Tilføj i test-filen (opret med samme header-stil som andre stages-tests hvis den ikke findes: `// @ts-nocheck` + `import { assert, assertEquals } from "jsr:@std/assert@1";` + `import { checkUnsupportedNegativeClaims } from "./unsupported-negative-claim-check.ts";`):

```ts
Deno.test("capability refusal without grounding is flagged", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "Hi there, unfortunately we don't offer individual mic clips for the A-Spire Wireless separately.",
    retrieved_chunks: [],
  });
  assert(r.violations.some((v) => v.type === "unsupported_capability_claim"), JSON.stringify(r.violations));
  assertEquals(r.requires_review, true);
});

Deno.test("Danish capability refusals are flagged", () => {
  for (const draft of [
    "Desværre har vi ikke mulighed for at kontakte Maxgaming direkte.",
    "Det kan vi desværre ikke tilbyde.",
    "Vi sælger ikke mic clips separat.",
  ]) {
    const r = checkUnsupportedNegativeClaims({ draft_text: draft, retrieved_chunks: [] });
    assert(r.violations.some((v) => v.type === "unsupported_capability_claim"), draft);
  }
});

Deno.test("uncertainty phrasing never triggers the capability family", () => {
  for (const draft of [
    "Jeg kan ikke se lagerstatus lige nu, så jeg vender tilbage.",
    "I can't confirm the current stock status right now.",
    "Det undersøger jeg og vender tilbage til dig om.",
  ]) {
    const r = checkUnsupportedNegativeClaims({ draft_text: draft, retrieved_chunks: [] });
    assertEquals(r.violations.some((v) => v.type === "unsupported_capability_claim"), false, draft);
  }
});

Deno.test("capability refusal grounded by a KB chunk is allowed", () => {
  const r = checkUnsupportedNegativeClaims({
    draft_text: "We don't sell the mic clip separately.",
    retrieved_chunks: [{
      content: "Spare parts: the mic clip is not sold separately; it ships attached to the headset.",
      usable_as: "policy", source_provider: "manual_text", source_label: "spare parts",
    } as any],
  });
  assertEquals(r.violations.some((v) => v.type === "unsupported_capability_claim"), false, JSON.stringify(r.violations));
});
```

- [ ] **Step 2: Kør — verificér FAIL**

Run: `deno test --no-check --allow-env supabase/functions/generate-draft-v2/stages/unsupported-negative-claim-check.test.ts`
Expected: de nye tests fejler (capability-familien findes ikke endnu).

- [ ] **Step 3: Implementér**

Læs filen. (a) Tilføj `"unsupported_capability_claim"` til `UnsupportedNegativeClaimViolationType`-unionen. (b) Tilføj en ny `ClaimFamily` til `FAMILIES`:

```ts
  {
    violationType: "unsupported_capability_claim",
    patterns: [
      // EN — confident "the shop doesn't/can't offer/provide/sell/do X"
      /\bwe\s+(?:do\s+not|don['’]t|can\s?not|cannot|can['’]t)\s+(?:currently\s+)?(?:offer|provide|sell|support|do)\b/i,
      /\bwe\s+(?:do\s+not|don['’]t)\s+have\s+[^.?!]*\b(?:for\s+purchase|separately|available\s+separately)\b/i,
      /\b(?:is|are)\s+not\s+sold\s+separately\b/i,
      /\bnot\s+available\s+for\s+purchase\b/i,
      /\bunable\s+to\b/i,
      /\bnot\s+possible\b/i,
      // DA — "vi tilbyder/sælger/har/kan/yder (desværre) ikke ...", "det kan vi ikke", "vi har ikke mulighed for"
      /\bvi\s+(?:tilbyder|sælger|yder|har|kan)\s+(?:desværre\s+|i\s+øjeblikket\s+)?ikke\b/i,
      /\bdet\s+kan\s+vi\s+(?:desværre\s+)?ikke\b/i,
      /\bvi\s+har\s+ikke\s+mulighed\s+for\b/i,
      /\bdet\s+er\s+(?:desværre\s+)?ikke\s+muligt\b/i,
      /\bsælges\s+ikke\s+separat\b/i,
    ],
  },
```

VIGTIGT: `\bvi\s+(?:...|kan)\s+...ikke\b` må IKKE ramme "jeg kan ikke se/bekræfte" — bemærk patterns kræver `vi` (ikke `jeg`) og et tilbuds-verbum/`mulighed`/`muligt`; verificér mod Step 1's usikkerheds-tests. (c) Tilføj til `CHUNK_NEGATION_PATTERNS` (så en KB-chunk kan grunde en capability-benægtelse): `/\bnot\s+sold\s+separately\b/i` (findes måske allerede — undgå dublet), `/\bwe\s+(?:do\s+not|don['’]t)\s+(?:offer|provide|sell)\b/i`, `/\bsælges\s+ikke\s+separat\b/i`, `/\btilbyder\s+ikke\b/i`, `/\bvi\s+sælger\s+ikke\b/i`. (d) Tilføj negations-/tilbuds-ord til `OVERLAP_STOPWORDS` så overlap kommer fra et rigtigt produktord: `"offer","provide","sell","support","separately","tilbyder","sælger","yder","mulighed","muligt","vi"`. (e) Sørg for at grounding-kilde C KUN accepterer chunks hvor `usable_as` ∈ {policy, procedure, saved_reply, background} — hvis den nuværende C-logik ikke allerede filtrerer på usable_as, tilføj det filter (læs den eksisterende grounding-funktion og match dens stil; hvis den allerede kun får retrieved_chunks der ekskluderer ticket_examples, gør filteret eksplicit i en kommentar).

- [ ] **Step 4: Kør — verificér PASS** (alle tests i filen, inkl. de præeksisterende): samme kommando som Step 2. Expected: alle grønne.

- [ ] **Step 5: Typecheck + commit**

Run (fra `supabase/`): `deno check functions/generate-draft-v2/stages/unsupported-negative-claim-check.ts` → kun de 2 præeksisterende fejl.
```bash
git add supabase/functions/generate-draft-v2/stages/unsupported-negative-claim-check.ts supabase/functions/generate-draft-v2/stages/unsupported-negative-claim-check.test.ts
git commit -m "feat(draft): detect ungrounded capability-refusal claims"
```

---

### Task 2: Hedge-omskriver `capability-refusal-rewrite.ts`

**Files:**
- Create: `supabase/functions/generate-draft-v2/stages/capability-refusal-rewrite.ts`
- Test: `supabase/functions/generate-draft-v2/stages/capability-refusal-rewrite.test.ts`

**Interfaces:**
- Consumes: violation-shape `{ type: string; excerpt: string }` fra Task 1.
- Produces: `rewriteCapabilityRefusals(input: { draft: string; violations: Array<{ type: string; excerpt: string }>; language: string }): { draft: string; rewritten: boolean }`.

- [ ] **Step 1: Skriv de fejlende tests**

```ts
// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { rewriteCapabilityRefusals } from "./capability-refusal-rewrite.ts";

const HEDGE_EN = "Let me look into that and get back to you.";
const HEDGE_DA = "Det undersøger jeg og vender tilbage til dig om.";

Deno.test("replaces the capability sentence with an English hedge, keeps neighbors", () => {
  const draft = "Hi there. Unfortunately we don't offer individual mic clips separately. Let me know if there's anything else.";
  const out = rewriteCapabilityRefusals({
    draft,
    violations: [{ type: "unsupported_capability_claim", excerpt: "we don't offer individual mic clips separately" }],
    language: "en",
  });
  assertEquals(out.rewritten, true);
  assert(out.draft.includes("Hi there."));
  assert(out.draft.includes("Let me know if there's anything else."));
  assert(out.draft.includes(HEDGE_EN));
  assert(!out.draft.toLowerCase().includes("we don't offer individual mic clips"));
});

Deno.test("Danish hedge for da language", () => {
  const draft = "Hej. Desværre har vi ikke mulighed for at kontakte Maxgaming direkte. Mvh";
  const out = rewriteCapabilityRefusals({
    draft,
    violations: [{ type: "unsupported_capability_claim", excerpt: "vi har ikke mulighed for at kontakte Maxgaming direkte" }],
    language: "da",
  });
  assertEquals(out.rewritten, true);
  assert(out.draft.includes(HEDGE_DA));
  assert(out.draft.includes("Hej."));
  assert(out.draft.includes("Mvh"));
  assert(!out.draft.includes("ikke mulighed for at kontakte Maxgaming"));
});

Deno.test("only capability violations are rewritten; other families ignored", () => {
  const draft = "The A-Rise is out of stock right now.";
  const out = rewriteCapabilityRefusals({
    draft,
    violations: [{ type: "unsupported_negative_availability_claim", excerpt: "out of stock" }],
    language: "en",
  });
  assertEquals(out.rewritten, false);
  assertEquals(out.draft, draft);
});

Deno.test("no capability violations is a no-op", () => {
  const draft = "Sure, I can help with that.";
  const out = rewriteCapabilityRefusals({ draft, violations: [], language: "en" });
  assertEquals(out.rewritten, false);
  assertEquals(out.draft, draft);
});

Deno.test("two capability violations in one sentence collapse to a single hedge", () => {
  const draft = "We don't offer that and we can't do it either. Thanks.";
  const out = rewriteCapabilityRefusals({
    draft,
    violations: [
      { type: "unsupported_capability_claim", excerpt: "We don't offer that" },
      { type: "unsupported_capability_claim", excerpt: "we can't do it either" },
    ],
    language: "en",
  });
  assertEquals(out.rewritten, true);
  assertEquals((out.draft.match(/Let me look into that/g) || []).length, 1);
  assert(out.draft.includes("Thanks."));
});
```

- [ ] **Step 2: Kør — verificér FAIL** (modul findes ikke): `deno test --no-check --allow-env supabase/functions/generate-draft-v2/stages/capability-refusal-rewrite.test.ts`

- [ ] **Step 3: Implementér**

```ts
// Deterministic, LLM-free hedge rewrite: replaces a draft sentence that made an
// UNGROUNDED capability/offer refusal with an owns-the-case hedge. Only acts on
// "unsupported_capability_claim" violations — other negative-claim families stay
// flag-only. Pure; never throws; no-op when nothing matches.

const HEDGES: Record<string, string> = {
  da: "Det undersøger jeg og vender tilbage til dig om.",
};
const HEDGE_DEFAULT = "Let me look into that and get back to you.";

function hedgeFor(language: string): string {
  const lang = String(language ?? "").trim().toLowerCase().slice(0, 2);
  return HEDGES[lang] ?? HEDGE_DEFAULT;
}

// Split into sentences while keeping their trailing delimiter+space so the
// draft can be reassembled with structure preserved. ø/å-safe (unicode-agnostic
// split on sentence-final punctuation followed by whitespace).
function splitSentences(text: string): string[] {
  const parts: string[] = [];
  const re = /[^.!?]*[.!?]+[\s]*|[^.!?]+$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    parts.push(m[0]);
  }
  return parts.length ? parts : [text];
}

export function rewriteCapabilityRefusals(input: {
  draft: string;
  violations: Array<{ type: string; excerpt: string }>;
  language: string;
}): { draft: string; rewritten: boolean } {
  const draft = String(input?.draft ?? "");
  const excerpts = (input?.violations ?? [])
    .filter((v) => v?.type === "unsupported_capability_claim")
    .map((v) => String(v?.excerpt ?? "").trim())
    .filter((e) => e.length > 0);
  if (!draft || excerpts.length === 0) return { draft, rewritten: false };

  const hedge = hedgeFor(input.language);
  const sentences = splitSentences(draft);
  let rewritten = false;

  const out = sentences.map((sentence) => {
    const hit = excerpts.some((e) => sentence.includes(e));
    if (!hit) return sentence;
    rewritten = true;
    // Preserve the sentence's trailing whitespace so paragraph structure holds.
    const trailingWs = sentence.match(/\s*$/)?.[0] ?? "";
    const leadingWs = sentence.match(/^\s*/)?.[0] ?? "";
    return `${leadingWs}${hedge}${trailingWs}`;
  });

  if (!rewritten) return { draft, rewritten: false };
  return { draft: out.join(""), rewritten: true };
}
```

- [ ] **Step 4: Kør — verificér PASS**: samme kommando som Step 2. Expected: 5/5.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-draft-v2/stages/capability-refusal-rewrite.ts supabase/functions/generate-draft-v2/stages/capability-refusal-rewrite.test.ts
git commit -m "feat(draft): deterministic hedge rewrite for capability refusals"
```

---

### Task 3: Wire i pipeline + deploy + live verifikation

**Files:**
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts` (import + wiring ved ~linje 3167)

**Interfaces:**
- Consumes: `checkUnsupportedNegativeClaims` (udvidet, Task 1), `rewriteCapabilityRefusals` (Task 2).

- [ ] **Step 1: Tilføj import (ved de andre stage-imports, ~linje 103)**

```ts
import { rewriteCapabilityRefusals } from "./stages/capability-refusal-rewrite.ts";
```

- [ ] **Step 2: Wire ved det eksisterende check (~linje 3167)**

Lige EFTER `const unsupportedNegativeClaimCheck = checkUnsupportedNegativeClaims({...});` og dens `if (unsupportedNegativeClaimCheck.requires_review) {...}`-blok, tilføj:

```ts
    // Deterministic backstop: an ungrounded capability/offer refusal ("we don't
    // offer X", "det kan vi ikke") is rewritten to an owns-the-case hedge so the
    // draft behaves like an employee who investigates instead of inventing a
    // limit. Only capability-family violations are rewritten; the review flag is
    // already set above. No LLM cost.
    const capabilityRewrite = rewriteCapabilityRefusals({
      draft: finalDraft ?? "",
      violations: unsupportedNegativeClaimCheck.violations,
      language: replyLanguage,
    });
    if (capabilityRewrite.rewritten) {
      finalDraft = capabilityRewrite.draft;
      finalRoutingHint = "review";
      blockSendRecommended = true;
      console.warn("[generate-draft-v2] ungrounded capability refusal rewritten to owns-the-case hedge");
    }
```

VIGTIGT — verificér FØR du skriver: (a) at `finalDraft` er `let` (ikke `const`) på deklarationsstedet, så reassignment er lovlig; hvis den er `const`, find det rigtige mutérbare draft-felt der bliver til `response.draft_text` (grep `draft_text:` i return-objektet og spor hvilken variabel der sættes) og omskriv den i stedet. (b) At dette punkt (~3167) ligger FØR draften kopieres ind i response-objektet — ellers flyt wiringen til lige før den endelige `draft_text:`-tildeling. Dokumentér i rapporten hvilken variabel du satte og hvorfor den propagerer til svaret.

- [ ] **Step 3: Typecheck**

Run (fra `supabase/`): `deno check functions/generate-draft-v2/pipeline.ts` → kun de 2 præeksisterende fejl, ingen nye.

- [ ] **Step 4: Kør Task 1+2-tests (uændrede) + commit**

```bash
deno test --no-check --allow-env supabase/functions/generate-draft-v2/stages/unsupported-negative-claim-check.test.ts supabase/functions/generate-draft-v2/stages/capability-refusal-rewrite.test.ts
git add supabase/functions/generate-draft-v2/pipeline.ts
git commit -m "feat(draft): wire capability-refusal hedge rewrite into pipeline"
```

- [ ] **Step 5: Deploy**

Run: `supabase functions deploy generate-draft-v2 --project-ref ikuupzjaxzvatdnmyzoy --use-api`

- [ ] **Step 6: Live verifikationsmatrix (dry-runs — skriver intet)**

Kald `POST https://ikuupzjaxzvatdnmyzoy.supabase.co/functions/v1/generate-draft-v2` med `Authorization: Bearer <anon-nøgle fra Supabase MCP get_publishable_keys for ikuupzjaxzvatdnmyzoy>` + `Content-Type: application/json`, body `{"thread_id":"<id>","shop_id":"38df5fef-2a23-47f3-803e-39f2d6f1ed99","dry_run":true}`:

| Case | thread_id | Forventet |
|---|---|---|
| Mic-clips (SKAL ændres) | f587bf4c-ad9a-4ff1-8d80-805fcf041cac | Ingen "we don't have/offer ... separately"; i stedet hedge ("Let me look into that...") |
| Maxgaming (SKAL ændres) | 17bfed8e-a400-4353-8abf-0e758d16f948 | Ingen "vi har ikke mulighed for at kontakte Maxgaming"; hedge indsat |
| Fragt-B (BØR ændres) | 5acd0904-d71f-4f45-bdd4-b766755c304f | De ugrundede "we do not offer pickup/delivery instructions"-benægtelser erstattet af hedge (bemærk: bekræftelsen "packages do not require a signature" kan stå hvis den ikke matcher capability-patterns — dokumentér faktisk udfald) |
| Headset-fejl (MÅ IKKE ændres) | 49c234cc-a848-431a-969c-44f356a014a0 | Troubleshooting-trin uændrede (ingen capability-benægtelse) |
| Swiss troubleshoot (MÅ IKKE ændres) | 259b76c1-6f48-46fe-899f-f0f1f155bde9 | Troubleshooting-trin uændrede |

- [ ] **Step 7: Rapportér matrix-resultaterne**

Rapportér alle 5 cases' faktiske drafts (før→efter hvor relevant). Hvis en "SKAL ændres"-case IKKE ændrede sig: aflæs `d.provenance` / kør den syntetiske eval-mode-replika for at se om check'et overhovedet fandt en violation (var sætningen faktisk grounddet af en chunk?) og rapportér evidensen — udvidelse af patterns er en beslutning til mennesket, ikke noget denne plan autoriserer. Ingen kode-commit i dette step medmindre en ren bugfix i Task 1-2-koden afdækkes.

## Self-Review (udført ved planskrivning)

- **Spec-dækning:** capability-familie + grounding-filter (Task 1); hedge-omskriver m. sprogmatch + kun-capability + no-op (Task 2); wiring post-check + requires_review bevaret (Task 3); live-matrix inkl. regressioner (Task 3 Step 6). Alle spec-sektioner dækket.
- **Placeholders:** Task 1 Step 3 (c)/(e) beder implementeren verificere mod eksisterende kode med kendte referencepunkter (CHUNK_NEGATION_PATTERNS, grounding-kilde C) — eksplicitte verifikationer, ikke TBD. Task 3 Step 2 har en eksplicit finalDraft-mutabilitets-verifikation med fallback-instruks.
- **Typekonsistens:** `rewriteCapabilityRefusals`-signatur ens i Task 2-def og Task 3-brug; violation-shape `{type,excerpt}` ens; `"unsupported_capability_claim"`-literalet ens i Task 1 (detektion), Task 2 (filter) og testene.
