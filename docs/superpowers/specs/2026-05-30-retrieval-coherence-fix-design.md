# Retrieval Coherence Fix — Design Spec

**Dato:** 2026-05-30
**Status:** Godkendt til implementering (afventer plan)
**Forudsætning:** `2026-05-30-retrieval-coherence-measurement-design.md` (målingen) er bygget og kørende.

## Problem

Coherence-målingen på de retrieval-tunge intents (complaint + product_question, 12 cases) viser
`grab_bag_rate = 0.58`: over halvdelen af de svar hvor pipelinen SKAL vælge én sammenhængende
guide trækker i stedet en blanding. Inspektion af de værste cases viser **to distinkte fejlmønstre**:

### Flavor 1 — Topical scatter inden for det rigtige produkt
Eksempel `g-021` / `g-020` (product_question, A-Spire): alle 4 chunks er korrekt om A-Spire,
men det er 4 *forskellige* snippets, hver om et andet sub-emne (firmware fejler, EQ-ændring,
settings-app, IEM-kort). Ingen dominerer klart, så den eksisterende 60%-relevance-floor +
"altid mindst 3"-regel lader alle 4 passere. Den eksisterende Q&A title-match override fyrede
ikke (intet enkelt title-overlap vandt klart nok).

### Flavor 2 — Junk fallback når intet matcher
Eksempel `g-025` (product_question): der findes ingen relevant viden, så retrieval returnerer
generisk støj — "kan jeg komme forbi kontoret", "hvilket headset skal jeg vælge", Terms of
Service, Privacy Policy. Den **relative** floor (60% af top) kan ikke fange dette, fordi *alle*
scores er lige lave.

### Rodårsag (teknisk)
1. Ranking kører på **RRF fusion-scores** (`1/(60+rank)`), som kasserer den absolutte cosine-
   similarity. Variablen `chunk.similarity` i retrieveren er i dag fusion-scoren, IKKE cosine.
   Den ægte cosine (`1 - (embedding <=> query)`) returneres af `match_agent_knowledge` men
   smides væk ved `base.similarity = r.score`.
2. `product_question` har `knowledgeBudget = 4`, og floor+min-3 trimmer ikke løst-relaterede
   søskende-snippets fra.
3. Der er ingen mekanisme der committer til ÉN kilde/guide når én klart ejer spørgsmålet.

## Mål

Reducér `grab_bag_rate` på de retrieval-relevante intents **uden at sænke `overall_10`**.
`grab_bag_rate` er en *proxy* — den ægte målestok er send-ready korrekthed (`overall_10`).
Ingen regel shipper medmindre den beviseligt holder eller hæver `overall_10` på 12-case-harnessen
uden per-case regressioner.

**Generalisering:** Begge fejlmønstre er universelle (enhver shop med produktkatalog + snippets
rammer Flavor 1; enhver shop får spørgsmål uden for sin KB → Flavor 2). Reglerne er principielle,
ikke AceZone-specifikke hacks.

## Ikke i scope
- KB tagging-UI / auto-chunking (Sektion 1 i `2026-05-19-knowledge-retrieval-architecture-design.md`) — separat spor.
- Ændringer i writer-prompt, planner eller fact-resolver.
- Cross-encoder re-ranker / LLM-baseret chunk-selektion.
- Ændringer i `match_agent_knowledge` RPC (similarity returneres allerede).

---

## Arkitektur

Al logik lever i `supabase/functions/generate-draft-v2/stages/retriever.ts`. Hver mekanisme er
**uafhængigt flag-gated** via `eval_options`, så vi kan A/B-teste hver enkelt isoleret på
coherence-harnessen. Flags defaulter til **off** indtil eval beviser de hjælper; derefter sættes
default til on og flag bevares som kill-switch.

Flag-passthrough: `pipeline.ts` videresender `eval_options` til retrieveren (samme mønster som
de eksisterende `writer_model` / `disable_escalation` flags). Når et flag er udeladt = nuværende
produktionsadfærd, så produktionen er upåvirket indtil vi bevidst flipper default.

```
eval_options: {
  retrieval_abs_floor?: number | null,   // Mekanisme 1: absolut cosine-gulv (null = off)
  retrieval_pq_budget?: number | null,   // Mekanisme 2: override knowledgeBudget for product_question
  retrieval_issue_tiebreak?: boolean,    // Mekanisme 2: issue-type tiebreak
  retrieval_source_consolidate?: boolean // Mekanisme 3: dominant-source consolidation
}
```

---

## Mekanisme 1 — Absolut relevance-floor (fixer Flavor 2)

### Data flow
1. Den vektor-baserede gren af `runQueryPair` får `similarity` (cosine) på hver række fra RPC'en.
   BM25-grenen har ingen similarity.
2. I `rrfFusion`: bevar den **maksimale cosine-similarity** set for hvert chunk-id på tværs af
   lister, som et nyt felt `vectorSimilarity` på det fusede objekt (separat fra fusion-`score`).
   BM25-kun chunks får `vectorSimilarity = null`.
3. På `RetrievedChunk` tilføjes `vector_similarity: number | null` (carry-through; allerede delvist
   nødvendigt for coherence-observability).

### Regel
Efter scoring/dedup/budget, hvis flaget `retrieval_abs_floor` er sat (fx `0.30`):
- **Block-level gate:** Hvis den bedste chunks `vector_similarity` er `< retrieval_abs_floor`
  (eller `null`), returnér **tom** knowledge-chunk-liste. Writeren eskalerer / siger "jeg har ikke
  den information" i stedet for at digte ud fra støj. (`past_ticket_examples` påvirkes ikke.)
- Start-tærskel `0.30`, tunet på harnessen. Eksakt værdi fastlægges empirisk i plan-fasen.

### Hvorfor block-level og ikke per-chunk
Per-chunk floor risikerer at droppe gode chunks når én legitim chunk ligger lige under tærsklen.
Block-level gate rammer kun det rene "intet matcher"-tilfælde (g-025: alle ~0.0-0.1 cosine), som er
det vi faktisk vil fange. Per-chunk varianten kan tilføjes senere hvis eval viser behov.

### Risiko
For høj tærskel → dropper legitime svar (falsk eskalering). For lav → fanger ikke junk. Mitigeres
ved at tune mod harnessen: vi vil se eskalering på g-025-lignende cases MEN ikke på cases hvor et
korrekt svar findes. Per-case regressionstjek er gaten.

---

## Mekanisme 2 — Single-best commit (fixer Flavor 1)

To dele, begge tunet empirisk:

### 2a — Strammere budget for product_question
`knowledgeBudget` for `product_question` gøres konfigurerbar via `retrieval_pq_budget` (default i
eval: prøv `2` og `3`). I dag er den `4`. Trimning til 2-3 fjerner de løst-relaterede søskende-
snippets der ikke er det egentlige svar. complaint er allerede `2`.

### 2b — Issue-type tiebreak
Når der efter budget stadig er ≥2 chunks, og **præcis én** chunk har et `chunk_issue_types`-tag der
matcher kundens detekterede issue-terms (`extractIssueTerms`) OG deler produkt, så committes til den
ene chunk (analogt med den eksisterende Q&A title-match override, men på den eksplicitte issue-tag-
sti i stedet for title-lexical). Kun når præcis én matcher — ellers ingen ændring. Gated af
`retrieval_issue_tiebreak`.

### Hvorfor ikke bare sænke title-match-tærsklerne
At sænke den eksisterende overrides tærskler (`0.35` / `1.6x`) globalt risikerer falsk single-snippet-
selektion på cases hvor den i dag korrekt afstår. Issue-tag-tiebreaket er mere præcist fordi det
kræver et eksplicit admin-tag-match, ikke blot lexical title-overlap.

---

## Mekanisme 3 — Dominant-source consolidation (future-proofing)

Når ≥2 retrieverede chunks deler samme **ikke-null** `source_id` (en multi-chunk guide) og den guides
samlede score dominerer (sum af fusion-scores ≥ alle andre source-grupper), så tag alle dens chunks
(op til budget) og drop spredningen fra andre kilder. Gated af `retrieval_source_consolidate`.

Påvirker IKKE AceZone (single-chunk snippets, `source_id` null) — men er fixet for "fremtidig kunde
med velstruktureret long-form KB" (CLAUDE.md-målet om at arkitekturen holder på tværs af shops).
Inkluderes for at undgå at vi skal røre retrieveren igen når den slags KB onboardes.

---

## Eval-metodologi

1. Deploy v2 med alle flags tilgængelige (default off → produktion uændret).
2. For hver mekanisme isoleret: kør `node supabase/scripts/run-golden-eval.mjs --intent complaint,product_question`
   med mekanismens flag sat (via en lille tilføjelse til runneren der sender `eval_options`, ELLER
   midlertidigt default-on under test).
3. Accept-kriterium pr. mekanisme: `grab_bag_rate` ned **og** `overall_10` holder/stiger **og** ingen
   per-case regressioner på de relevante intents.
4. Behold kun mekanismer der består. Kombinér de beståede, kør samlet, og re-baseline coherence.
5. Til sidst: kør det fulde 44-case sæt for at bekræfte ingen regression på de øvrige intents.

## Filer der røres
- `supabase/functions/generate-draft-v2/stages/retriever.ts` — fusion carry-through af cosine,
  abs-floor gate, konfigurerbar budget, issue-tiebreak, source-consolidation. Alt flag-gated.
- `supabase/functions/generate-draft-v2/pipeline.ts` — `eval_options` passthrough til retriever.
- `supabase/scripts/run-golden-eval.mjs` (+ `apps/web/lib/server/eval-runner.js`) — evt. CLI-flag
  til at sende `eval_options` så hver mekanisme kan A/B-testes uden redeploy.

## Implementeringsrækkefølge
1. Carry cosine-similarity gennem fusion (fundament for Mek. 1; også renere observability).
2. Mekanisme 1 (abs-floor) — højeste-tillid, mest general.
3. Mekanisme 2a (budget) → 2b (issue-tiebreak).
4. Mekanisme 3 (source-consolidation).
5. Eval-passthrough + per-mekanisme A/B, behold beståede, re-baseline.
