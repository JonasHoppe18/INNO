# Ungrounded kapabilitets-afvisnings-guard

**Dato:** 2026-07-13
**Status:** Godkendt design — klar til implementeringsplan

## Problem

Målt på rigtig AceZone-trafik er det hyppigste kvalitetsbrud at Sona **selvsikkert påstår en kapabilitets-/tilbuds-/proces-grænse den ikke kan belægge**: "we don't offer individual mic clips", "vi har ikke mulighed for at kontakte Maxgaming", "we do not offer pickup or delivery instructions". En rigtig kundeservicemedarbejder siger aldrig "det gør vi ikke" om noget hun ikke har tjekket — hun ejer sagen og vender tilbage. Dette mønster ligger bag mic-clips-, Maxgaming- og fragt-sagerne på én gang og er generelt på tværs af webshops.

Det eksisterende `unsupported-negative-claim-check.ts` fanger *nogle* negative påstande (kompatibilitet, fit, tilgængelighed, købbarhed) men (a) dækker ikke kapabilitets-/tilbuds-familien, og (b) **flagger kun** til review — det løfter ikke selve svaret. Owns-the-case-blokken (shipped v345) forebygger via et writer-direktiv, men writeren emitterer stadig afvisningen selvsikkert i praksis.

## Mål

Deterministisk backstop der: opdager ugrundede kapabilitets-afvisninger i draften, **omskriver** den fornærmende sætning til en "ejer sagen"-hedge i svarets sprog, og flagger til review. Ingen ekstra LLM-omkostning. Grounddede afvisninger (en kilde siger det eksplicit) bevares urørt.

## Beslutninger (afklaret med bruger 2026-07-13)

- **Handling ved fund:** omskriv til hedge + sæt `requires_review` (ikke kun flag; ikke regenerering). Deterministisk, sprogmatchet.
- **Grounding-kilde:** KB-/policy-/procedure-/saved_reply-chunks der eksplicit indeholder matchende benægtelses-ordlyd + deler et indholdsord med sætningen. **Et historisk `ticket_example` alene tæller IKKE som grounding** — ét gammelt agent-svar kan være forkert/forældet; sådanne sager hedges (og gap-loggen fanger behovet for en rigtig KB-linje).

## Eksisterende infrastruktur (grounded 2026-07-13)

- `supabase/functions/generate-draft-v2/stages/unsupported-negative-claim-check.ts`: `checkUnsupportedNegativeClaims(input)` → `{ compliant, violations: Array<{type, excerpt}>, requires_review }`. Har `FAMILIES` (sætnings-scopede regex pr. violation-type), `CHUNK_NEGATION_PATTERNS` (ordlyd der grunder en benægtelse i en chunk), token-overlap-heuristik med `OVERLAP_STOPWORDS`, og grounding-kilder A (struktureret compat-provenance), B (live stock-fact m. negativ state), C (retrieved chunk m. negations-ordlyd + indholdsord-overlap). Konservativt sætnings-scopet: usikkerheds-fraser ("jeg kan ikke bekræfte/se lagerstatus") matcher aldrig fordi de bruger et andet verbum.
- Wired i `pipeline.ts` (`checkUnsupportedNegativeClaims` importeret linje ~103; resultatet lægges i response under `unsupported_negative_claim_check`; `requires_review` → routing til review).
- Reply-sprog: pipelinen resolver allerede svar-sproget (bruges af writeren + language-checks) — genbrug det til hedge-sproget.
- `RetrievedChunk` har `usable_as` (policy/procedure/saved_reply/background/...) og `source_provider`/`source_label`.

## Arkitektur

To rene, isolerede enheder + wiring:

### 1. Detektion — udvid `unsupported-negative-claim-check.ts`

Ny `ClaimFamily` med `violationType: "unsupported_capability_claim"`, sætnings-scopede regex (konservative — targeter specifikke konstruktioner, ikke bare "ikke"/"not"):

- **EN:** `we (do not|don't|can not|cannot|can't) (currently )?(offer|provide|sell|support|do)`, `not (something we|able to)`, `unable to`, `not possible`, `(is|are) not sold separately`, `we (do not|don't) have .* (for purchase|separately|available separately)`.
- **DA:** `vi (tilbyder|sælger|har|kan|yder) (desværre |i øjeblikket )?ikke`, `det kan vi (desværre )?ikke`, `vi har ikke mulighed for`, `det er ikke muligt`, `sælges ikke separat`, `det gør vi ikke`.

Tilføj matchende ordlyd til `CHUNK_NEGATION_PATTERNS` (så en KB-chunk der faktisk siger fx "not sold separately" / "sælges ikke separat" / "we don't offer" grunder påstanden) og relevante negationsord til `OVERLAP_STOPWORDS`. Grounding-kilde C skal KUN tælle chunks med `usable_as` ∈ {policy, procedure, saved_reply, background} — IKKE ticket_examples (som ikke indgår i `retrieved_chunks` alligevel, men gøres eksplicit). Returtypen udvides med den nye violation-type; øvrige familier og deres flag-only-adfærd er uændrede.

### 2. Omskrivning — nyt rent modul `capability-refusal-rewrite.ts`

`rewriteCapabilityRefusals(input: { draft: string; violations: Array<{ type: string; excerpt: string }>; language: string }): { draft: string; rewritten: boolean }`.

- Filtrerer violations til KUN `unsupported_capability_claim` (de øvrige familier forbliver flag-only — de er produkt-fakta-påstande der ofte grundes af live-fakta, og en hedge dér kan være dårligere end den korrekte påstand).
- For hver capability-violation: find sætningen i draften der indeholder `excerpt` (simpel sætnings-split på `[.!?]` fulgt af whitespace/linjeskift, ø/å-sikker), og erstat HELE den sætning med en sprogmatchet hedge. Sproget → hedge-tekst: `da` → "Det undersøger jeg og vender tilbage til dig om." ; ellers (default/en) → "Let me look into that and get back to you." (udvid map med sv/de/etc. hvis trivielt; ellers engelsk fallback).
- Dedupliker: hvis flere violations rammer samme sætning, erstattes den én gang. Bevar alle andre sætninger + whitespace-struktur. `rewritten: false` + uændret draft hvis ingen capability-violations.

### 3. Wiring i `pipeline.ts`

Efter den eksisterende `checkUnsupportedNegativeClaims`-kørsel (post-writer): hvis resultatet indeholder `unsupported_capability_claim`-violations, kald `rewriteCapabilityRefusals({ draft: draftText, violations, language: resolvedReplyLanguage })`, og hvis `rewritten` → sæt draften til den omskrevne tekst FØR den endelige language/style-post-processing (så hedge også normaliseres) og bevar `requires_review = true`. Ellers uændret. Aldrig i en sti der kaster (rene funktioner, defensive).

## Data flow

```
writer → draft
      → checkUnsupportedNegativeClaims (udvidet m. capability-familie)
         ├─ ingen capability-violation → uændret
         └─ ugrundet capability-violation
              → rewriteCapabilityRefusals (erstat sætning m. sprogmatchet hedge)
              → draft opdateret + requires_review=true
      → eksisterende language/style-finalisering
```

## Fejlhåndtering

- Begge nye enheder er rene, kaster aldrig; tomme/manglende inputs → no-op (uændret draft, compliant). Fail-safe = eksisterende adfærd.
- Grounddede afvisninger (kilde siger det) omskrives ALDRIG.

## Test

- **Detektion (unit):** capability-patterns rammer de reelle fraser (mic-clips/Maxgaming/fragt-B-ordlyd, EN+DA); usikkerheds-fraser ("jeg kan ikke se lagerstatus") rammer IKKE; grounddet af en KB-chunk m. matchende ordlyd+overlap → compliant; ticket_example tæller ikke.
- **Omskrivning (unit):** erstatter kun capability-sætningen, bevarer nabosætninger + whitespace; sprogmatch (da/en); flere violations i samme sætning → én erstatning; no-op når ingen capability-violation.
- **Live dry-run:** mic-clips (f587bf4c), Maxgaming (17bfed8e), fragt-B (5acd0904) → afvisning erstattet af hedge, requires_review sat. Regression: A (49c234cc) + C (259b76c1) troubleshooting-svar UÆNDREDE (ingen capability-benægtelse dér).

## Scope-afgrænsning (YAGNI)

- Omskrivning KUN for capability-familien; de øvrige negative-claim-familier forbliver flag-only (uændret).
- Ingen LLM-regenerering; deterministisk sætnings-erstatning.
- Ingen ny UI, ingen nye DB-kolonner. `requires_review`-flaget genbruger eksisterende routing.
- Ticket_examples som grounding-kilde for capability-påstande er bevidst udeladt (kan genovervejes hvis for aggressivt i praksis).

## Succeskriterier

- Mic-clips/Maxgaming/fragt-B producerer "ejer sagen"-hedge i stedet for en selvsikker ugrundet afvisning, flagget til review.
- Troubleshooting-svar (A/C) og grounddede afvisninger er uændrede.
- Ingen ny LLM-omkostning pr. draft.
