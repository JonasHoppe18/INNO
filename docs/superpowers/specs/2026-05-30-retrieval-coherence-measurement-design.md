# Retrieval Coherence Measurement — Design Spec

**Dato:** 2026-05-30
**Status:** Til review
**Relateret:** `2026-05-19-knowledge-retrieval-architecture-design.md` (fixen), `2026-05-30-golden-eval-set-design.md` (infrastrukturen)

## Problem

`generate-draft-v2` udvælger knowledge-chunks per chunk, uafhængigt scoret, uden nogen guide-, produkt- eller emne-sammenhæng. Budgettet (2 chunks for `complaint`/`technical_support`, ellers 4) fyldes derfor ofte med fragmenter fra urelaterede kilder.

Bekræftet i ægte v2-logs (`agent_logs.step_name='retrieval_completed'`, AceZone workspace `60c990b1-0d05-4019-b906-5a9fc3d70101`, seneste ~40 drafts):

- **Grab-bag:** log 48872 → `Privacy policy | Shipping | Terms and Conditions | Warranty and Returns policy` (fire forskellige policy-dokumenter, ét fragment fra hver).
- **Product-scatter:** log 49130 → `Bluetooth shutdown | Headset not charging | mic A-Spire | 1 earcup A-blaze` (fire symptomer på tværs af to produkter).
- **Emne-scatter:** log 48806 → `Damages | Address doesn't register | Order number needed | Audio bad A-blaze`.
- **Modeksempel (godt):** log 49205 → `My microphone doesn't work for A-blaze | My microphone sounds pulsating for A-blaze` (sammenhængende, samme produkt + emne).

Den egentlige diagnose er **topical/product-scatter**, ikke kun "to troubleshooting-guides blandes".

## Hvorfor måle før vi fixer

`2026-05-19`-designet beskriver fixen (fokuserede chunks + `products`/`issue_types`-scoping) og er markeret "Godkendt til implementering", men der findes **intet objektivt mål** for hvor udbredt scatter er, eller om en ændring reducerer det. Uden et tal kan vi ikke sige om en fix virker — kun fornemme det.

Dette design tilføjer målelaget: en deterministisk coherence-metrik på golden-settet, som bliver baseline for retrieval-arbejdet — på samme måde som golden-eval'en allerede giver draft-kvalitet i tal.

**Eksplicit ikke-mål:** Dette design ændrer IKKE udvælgelseslogikken i retrieveren. Kun instrumentering + analyse. Ingen adfærdsændring i produktion.

## Mål

Et reproducerbart coherence-tal pr. golden-case og som aggregat, der kvantificerer grab-bag/scatter i v2's writer-facing knowledge-sæt — klar som before/after-baseline for den efterfølgende fix.

---

## Sektion 1 — Instrumentering af v2-responsen

Retrieveren kender allerede det endelige writer-facing chunk-sæt (`regularChunks` returneret fra `runRetriever`). I dag opsummeres det kun til `agent_logs` via `buildRetrievalLogPayload` og til `console`. Vi eksponerer det også på edge-function-responsen — men **kun når kaldet er et eval-kald**, så produktion er upåvirket.

### 1.1 Nyt eval-gated felt

Når `eval_options` er sat (eval-kald), inkluderer `generate-draft-v2`-responsen et nyt felt:

```json
"retrieval_debug": {
  "chunks": [
    {
      "id": 3188,
      "title": "Warranty and Returns policy",
      "source_id": "…",
      "chunk_index": 2,
      "chunk_count": 7,
      "score": 0.499,
      "kind": "document",
      "usable_as": "knowledge",
      "products": ["a-spire"],
      "issue_types": ["warranty", "return"]
    }
  ]
}
```

- Felterne kommer 1:1 fra `RetrievedChunk` (allerede tilgængelige i retrieveren: `id`, `source_label`→`title`, `similarity`→`score`, `usable_as`, `kind`, `content`). `source_id`, `chunk_index`, `chunk_count`, `products`, `issue_types` læses fra chunkens `metadata` (allerede hentet i retrieveren).
- Feltet er **kun** med når `eval_options` findes på request. Produktions-kald (postmark-inbound sætter ikke `eval_options`) får uændret response.
- Ingen ekstra DB-skrivning, ingen PII ud over hvad der allerede logges.

### 1.2 Hvor i koden

- `pipeline.ts` (`runDraftV2Pipeline`): har allerede `regularChunks` fra retriever-stadiet (bruges til `buildRetrievalLogPayload`). Tilføj `retrieval_debug` til pipeline-resultatet når `eval_options` er sat.
- `index.ts`: returnerer allerede `{ ...result, latency_ms }` — `retrieval_debug` flyder automatisk med ud.

---

## Sektion 2 — Capture i golden-runneren

`apps/web/lib/server/eval-runner.js` → `generateDraftV2(...)` parser i dag `data.reply`/`data.actions`/`data.sources`. Tilføj:

```js
const retrievalDebug =
  data?.retrieval_debug && Array.isArray(data.retrieval_debug.chunks)
    ? data.retrieval_debug.chunks
    : [];
return { draft, actions, confidence, sources, routingHint, retrievalDebug, latencyMs: … };
```

`eval_options` sættes allerede på alle eval-kald (linje 239), så feltet kommer altid med i golden-runs.

---

## Sektion 3 — Coherence-metrikker (pure logic)

Ny pure funktion i `supabase/scripts/lib/golden-eval-core.mjs` (unit-testet via `node:test`, ingen I/O — samme mønster som `runGates`/`computeAggregate`):

```
computeCoherence(chunks) -> {
  n_chunks,
  distinct_sources,        // antal distinkte source_id (fallback: title hvis source_id mangler)
  distinct_products,       // antal distinkte produkter på tværs af chunks' products[]
  top_source_share,        // største andel chunks fra én source_id (1.0 = perfekt fokus)
  is_grab_bag              // true hvis distinct_sources >= 3 ELLER distinct_products >= 2
}
```

**Definitioner (eksplicitte, så de er deterministiske):**
- `distinct_sources`: antal unikke `source_id`. Hvis `source_id` er null (snippets), brug `title` som identitet.
- `distinct_products`: union af alle chunks' `products[]`; chunks med tom `products` (policy/generel) tæller ikke som et produkt. Antal unikke produktnavne i unionen.
- `top_source_share`: `max(count per source_id) / n_chunks`. Hvis `n_chunks === 0` → `1.0` (intet at blande).
- `is_grab_bag`: `distinct_sources >= 3 || distinct_products >= 2`. Tærsklerne er bevidst håndsat ud fra de observerede logs (rene sager har 1 source / 1 produkt; scatter-sager har 3-4 sources eller 2 produkter). Tærsklerne kan justeres når vi ser fordelingen på hele golden-settet.

**Aggregat** (udvid `computeAggregate`): tilføj `coherence`-blok til summary:
```
coherence: {
  grab_bag_rate,            // andel cases med is_grab_bag=true
  avg_distinct_sources,
  avg_distinct_products,
  avg_top_source_share,
  per_case: { <id>: { is_grab_bag, distinct_sources, distinct_products } }
}
```

## Sektion 4 — Rapportering i runneren

`run-golden-eval.mjs`:
- Kald `computeCoherence(gen.retrievalDebug)` pr. case, gem på result-objektet.
- Print en coherence-sektion i konsol-outputtet (grab_bag_rate + de værste cases sorteret efter `distinct_sources`).
- Skriv coherence pr. case + aggregat i per-run JSON-rapporten (`supabase/eval/runs/<stamp>.json`) — allerede gitignored.
- **Ingen** baseline-fil-ændring i denne omgang: coherence rapporteres, men gater ikke. (Vi etablerer tærskler først efter vi har set fordelingen.)

---

## Datakontrakt & edge cases

- **Tom retrieval_debug** (ingen chunks, fx routing/escalation-sag): `computeCoherence([])` → `n_chunks=0`, `distinct_sources=0`, `distinct_products=0`, `top_source_share=1.0`, `is_grab_bag=false`. Ingen crash.
- **source_id mangler** (snippets/manual_text): fald tilbage til `title` som identitet, så scatter stadig fanges på titel-niveau (som i de observerede logs).
- **products mangler/tom**: tæller ikke mod `distinct_products`. Policy-tunge svar straffes derfor på `distinct_sources`, ikke på produkt-scatter.
- **Bagudkompatibilitet:** Hvis v2 endnu ikke er redeployet med feltet, er `retrievalDebug=[]` → coherence rapporteres som tomt, golden-eval'en kører videre uændret. Måling og draft-scoring er afkoblet.

## Test

- `golden-eval-core.test.mjs`: nye `node:test`-cases for `computeCoherence` (perfekt fokus, 2-produkt-scatter, 3-source grab-bag, tom input, manglende source_id-fallback) + udvidet `computeAggregate`-test der bekræfter coherence-aggregatet.
- Manuel verifikation: kør `node supabase/scripts/run-golden-eval.mjs --limit 3` efter redeploy; bekræft at hver case har et `retrieval_debug`-sæt og en coherence-blok i rapporten.

## Leverance / definition of done

1. v2 returnerer `retrieval_debug` på eval-kald (og kun der). Redeployet med `npx supabase functions deploy generate-draft-v2`.
2. Golden-runneren fanger feltet og beregner coherence pr. case + aggregat.
3. Unit-tests grønne.
4. Én fuld golden-run giver et `grab_bag_rate`-tal + liste over værste scatter-cases → vores måle-baseline før retrieval-fixen.

## Hvad dette IKKE gør (næste fase)

Selve fixen (guide-aware/produkt-scoped udvælgelse) hører under `2026-05-19`-designet og tages som separat arbejde, målt mod den baseline dette design producerer.
