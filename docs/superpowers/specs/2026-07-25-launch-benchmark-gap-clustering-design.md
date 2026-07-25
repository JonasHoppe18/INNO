# Launch-benchmark og videnshuls-klyngning

**Dato:** 2026-07-25
**Status:** Godkendt design — klar til implementeringsplan
**Anledning:** AceZone tager Sona i brug om ca. én uge (ultimo juli 2026)

## Problem

To målinger af Sonas kvalitet modsiger hinanden, og forskellen afgør hvordan lanceringen forløber.

| Kilde | Måling | Resultat |
|---|---|---|
| Produktion, uge 20/7 (`draft_feedback_events`) | Sendt uredigeret | **81%** (13 af 16) |
| Eval 22/7 (`eval_results`, 25 cases) | `send_ready` | **4%** — snit `overall_10` = 5,72 |
| Eval 18/7 (`eval_results`, 20 cases) | `send_ready` | **15%** — snit `overall_10` = 5,90 |

Alle 45 eval-rækker har `anchor_class = 'comparable'` og `excluded_from_aggregate = false`. Forskellen skyldes altså ikke anchor-støj.

**Begge tal er sande — de måler forskellige populationer.** AceZone arbejder i dag primært i Zendesk og bruger kun Sona på de tråde de tør. Af 221 genererede drafts (30/6–25/7) blev kun 61 sendt; på trådniveau fik 119 tråde en draft, men kun 51 fik et svar sendt gennem Sona. De 81% er overlevelses-bias på et selvvalgt, nemt udsnit. Evalen kører på rigtige løste Zendesk-tickets — inklusive de svære.

Om en uge flytter de svære tråde ind i Sona. **Lanceringspopulationen er den hvor vi i dag scorer 5,72/10 med 4% send-ready.**

To konsekvenser:

1. Den valgte målestok (uredigeret send-rate) vil **falde i uge 1 uden at noget er blevet ringere**. Uden et populationsuafhængigt referencetal kan et populationsskift ikke skelnes fra en regression.
2. Der er én uge til at lukke så mange huller som muligt — og i dag findes der ingen prioriteret liste over hvilke huller der findes.

Eval-harnessens egen rodårsagsfordeling over de 45 cases: `facts` 19, `intent` 14, `eval_harness` 12. `primary_gap` er fritekst og derfor ikke aggregerbar: 15 rækker gav 15 unikke strenge ("missing info about backorders", "missing steps for driver update", …).

Læringssløjfens udgangsside er samtidig stoppet til: `feedback_suggestions` indeholder **185 rækker, alle med status `suggested`, ingen reviewet**. Den hyppigste root_cause er `insufficient_data` (89 af 185, 48%) — distilleren kan ikke afgøre sagen ud fra draft + endeligt svar alene. Flere rå diffs i den kø gør derfor tilstanden værre, ikke bedre. Aggregering før review er en forudsætning, ikke en forbedring.

## Mål

Ved ugens udgang skal der findes:

1. Et **frosset launch-benchmark** på 150 cases, samplet så det ligner den population AceZone bringer ind — med en målt baseline.
2. En **rangeret klyngerapport** med 10–15 temaer, hvert klassificeret som videnshul / retrieval-miss / intent-miss, med eksempel-tickets og udkast til knowledge-tekst.
3. Mulighed for at genkøre præcis samme 150 cases efter ændringer, så forbedring måles på uændret population.

**Målsætning.** De nuværende tal (4% send-ready, 5,72 snit) stammer fra 25 cases og er en *indikation*, ikke benchmark-baselinen. Den rigtige baseline er første kørsel over de 150 frosne cases, og målet fastsættes relativt til den:

> `send_ready`-andel skal mindst **firedobles** fra baseline, og snit `overall_10` stige med mindst **1,0**, målt på samme 150 cases.

Fordelingen på `likely_root_cause` skal flytte sig ved at `facts` falder mest — det er den kategori authoring kan lukke på en uge. `intent` er kodearbejde og forventes ikke løst inden lancering. Målet er bevidst ikke "80% send-ready": dommeren flager selv 27% af cases (12 af 45) som `eval_harness`-støj, hvilket lægger et loft over hvad der overhovedet er opnåeligt på denne målestok.

## Beslutninger (afklaret med bruger 2026-07-25)

- **Målestok:** andel drafts sendt uden redigering. Alt måles mod den.
- **Retning:** engangs-backfill + aggregering. En *kontinuerlig* Zendesk-pull blev fravalgt — dens præmis (at AceZone svarer i Zendesk) forsvinder ved adoption om en uge.
- **Output:** både et styringstal og klassificerede diffs. De to halvdele er værdiløse hver for sig.
- **Benchmark-størrelse:** 150 cases.
- **Ude af scope:** action-scoring (spor B), kontinuerlig Zendesk-pull, oprydning i de 185 eksisterende `feedback_suggestions`, samt dag-1-oprydning (støjdrafts + `pending` forward_email). Se "Anbefalet sideløbende arbejde".

## Omkostning og køretid (målt, ikke estimeret)

Fra `draft_generations`, 200 rigtige generationer sidste 21 dage:

| | |
|---|---|
| Median pr. generation | $0,0223 |
| p90 | $0,0330 |
| Input-tokens (snit) | 9.440 |
| Output-tokens (snit) | 138 |

Plus dommer (~5k input / 400 output, gpt-4o) ≈ $0,015.

- **Pr. case: ~$0,037** (p90 ~$0,048)
- **150 cases: ~$5,6 ≈ 38 kr pr. kørsel**; to kørsler (før/efter) **~75 kr**, værst ~100 kr
- Klyngelaget (150 embeddings + ~15 navngivningskald): under 1 kr

**Den bindende begrænsning er tid, ikke penge.** Snit-latency i `eval_results` er 17.587 ms pr. case (min 3.407, max 42.484). 150 cases sekventielt ≈ 45 min, oveni 150 sekventielle Zendesk `comments.json`-kald i harvesten. Parallelitet er et krav, ikke en optimering.

## Eksisterende infrastruktur (grounded 2026-07-25)

- **`apps/web/app/api/eval/zendesk-tickets/route.js`** — henter solved+closed tickets via Zendesk API, filtrerer non-support på `NON_SUPPORT_PATTERNS`, henter comments pr. ticket, bygger `publicConversation` med roller, ankrer ground truth på det **sidste** offentlige agent-svar og bruger forudgående turns som historik (leak-fri, jf. `project_historical_ticket_infra_audit`). Credentials fra `integrations` (provider `zendesk`, `credentials_enc`), workspace-scopet via `resolveAuthScope`.
- **`apps/web/app/api/eval/run/worker/route.ts`** — `scoreZendesk()` / `scoreEmail()` / `scoreThread()`, kalder `judgeWithOpenAI` og skriver `correctness, completeness, tone, actionability, overall, overall_10, send_ready, primary_gap, missing_for_10, likely_root_cause, judge_flags, anchor_class`.
- **`eval_results`** — indeholder allerede alt det klyngelaget skal bruge: `draft_content`, `human_reply`, `zendesk_ticket_id`, `primary_gap`, `missing_for_10`, `likely_root_cause`, `sources`, `proposed_actions`, `action_decision`, `excluded_from_aggregate`, `eval_run_id`, `source_item_key`.
- **`gold_eval_cases` / `gold_eval_runs` / `gold_eval_results`** — frossen benchmark-mekanik findes. I dag 33 cases, frosset 2026-06-04, 10 kørsler (senest 18/7). Sættet ligger før stort set alle juli-fixene.
- **`apps/web/lib/server/major-edit-distiller.js`** — rene helpers (`buildDistillerPrompt`, `parseDistillerResponse`, `buildSuggestionFromDraftRow`), **al I/O i `supabase/scripts/distill-major-edits.mjs`**. Mønsteret der skal følges.
- **`supabase/scripts/probe-recall.mjs`** — recall-probe mod `agent_knowledge`. Bruges til at verificere videnshuls-klassifikationen.
- **`apps/web/components/agent/FeedbackSuggestionsPanel.jsx`** — review-UI findes.

## Arkitektur

Tre komponenter. Kun én er ny kode.

### 1. Harvest — udvid `zendesk-tickets`-ruten

Tre konkrete mangler i den nuværende rute:

- `limit` er hardcapped til 150 og `per_page` til 100, og der hentes kun **ét sorteret vindue** af de nyeste solved+closed tickets. Ingen paginering, intet tidsinterval. Skal understøtte paginering og et `since`/`until`-interval, så puljen dækker ~6 måneder i stedet for den seneste måned.
- Comments hentes med ét sekventielt kald pr. ticket (N+1). Skal køre med begrænset parallelitet (foreslået: 5 samtidige) med respekt for Zendesk rate limits.
- `NON_SUPPORT_PATTERNS` fanger faktura/betaling, men **ikke** transportør-notifikationer. DHL-forsendelsesadviseringer alene udgør 24 beskeder på 14 dage. Filteret udvides med transportør- og kontonotifikationsmønstre, så støj ikke æder sample-budgettet.

Output: en kandidatpulje på ~400 støjfiltrerede tickets.

### 2. Stratificeret udvælgelse → frosne cases

Ikke tilfældig udvælgelse. Puljen stratificeres, så benchmark'et afspejler den population AceZone faktisk bringer ind — inklusive de svære. Formålet er at undgå at gentage overlevelses-biasen i ny form.

Stratificeringsnøglen er **`classifyInboundRouting`s kategori** kørt over ticket-emne + første kundebesked. Den vælges frem for Zendesk-tags, fordi den er den samme klassifikation pipelinen selv bruger i produktion — så benchmark-fordelingen kan sammenlignes direkte med den løbende trådfordeling i `mail_threads`. Hver kategoris andel i de 150 sættes til dens andel i kandidatpuljen, med et gulv på 5 cases pr. kategori, så små men dyre kategorier ikke forsvinder.

150 udvalgte cases skrives til `gold_eval_cases` **med snapshot af ticket-body og menneskesvar**, ikke kun `zendesk_ticket_id`. Det er den fejl der gjorde de 33 cases fra 4. juni sværere at stole på. Live Shopify-opslag driver stadig — accepteret og noteret som kendt støjkilde.

### 3. Klyngelaget — eneste nye komponent

Følger repoets etablerede opdeling:

- **`apps/web/lib/server/gap-clusterer.js`** — rene helpers, ingen Supabase- eller OpenAI-klient. Bygger klynge-input fra `eval_results`-rækker, parser og validerer LLM-navngivning, afgør klyngetype.
- **`supabase/scripts/cluster-eval-gaps.mjs`** — al I/O: læser `eval_results`, kalder embeddings + LLM, kører recall-probe, skriver rapport.

Datastrøm:

```
eval_results (150 rækker)
  │  filtrér: likely_root_cause = 'eval_harness' ekskluderes fra klyngning,
  │           men tælles og rapporteres
  ▼
embed(primary_gap + " " + missing_for_10)
  ▼
agglomerativ klyngning, cosine-afstand, afstandstærskel
(ikke k-means: antallet af temaer er ukendt på forhånd og
 skal falde ud af data, ikke sættes som parameter)
  ▼
LLM navngiver hver klynge + formulerer hvad der konkret mangler
  ▼
TYPE-BESTEMMELSE  ← kritisk, se nedenfor
  ▼
rangeret klyngerapport (markdown)
```

**Type-bestemmelse må ikke stole på LLM'ens ord alene.** For hver klynge LLM'en foreslår som *videnshul* køres et recall-probe mod `agent_knowledge` (`probe-recall.mjs`). Findes indholdet i basen, omklassificeres klyngen automatisk til *retrieval-miss*. Uden dette skridt bruges ugen på at skrive viden der allerede står i basen — præcis det mønster `project_knowledge_gap_classification` dokumenterer, hvor distillerens `missing_knowledge` i praksis var retrieval-misses.

De tre typer har adskilte fixes:

| Type | Fix | Hvem |
|---|---|---|
| Videnshul | Skriv knowledge | Menneske — ugens hovedarbejde |
| Retrieval-miss | Matcher/scoring | Kode |
| Intent-miss | Planner/prompt | Kode |

Knowledge-udkast skal følge `project_knowledge_frontload_concise_cap`: concise-mode capper chunks ved 600 tegn, så afgørende linjer hører til i sektionstoppen.

## Metrik

To tal med hver sin opgave. De må ikke blandes sammen.

**Styringstal — launch-benchmark.** De 150 frosne cases, kørt før og efter hver ændring. Populationen er låst, så tallet er immunt over for populationsskift. Primært `send_ready`-andel, sekundært snit `overall_10`, altid segmenteret på `likely_root_cause`. Baseline i dag: **5,72/10, 4% send-ready** (25 comparable cases, 22/7).

**Sundhedstal — produktions-send-rate.** Andel sendt uredigeret. Ikke et styringstal: det bevæger sig med populationen og forventes at falde i uge 1. Skal altid aflæses sammen med trådtype.

## Fejlhåndtering og risici

**Klyngelaget producerer ubrugelige klynger.** Det er uafklaret om fritekst-`primary_gap` klynger pænt. Afværges ved at køre klyngelaget på de **25 eksisterende cases fra 22/7 først** — nul eval-omkostning, data findes. Pilotkørslen har to formål: at kalibrere afstandstærsklen, og at afgøre om metoden overhovedet holder.

Acceptkriterie før 150-kørslen: mindst 60% af cases lander i en navngiven klynge med ≥3 medlemmer. Med 25 cases betyder det i praksis 4–6 klynger; kalibrer tærsklen efter det, ikke efter et ønsket antal på 150. Nås kriteriet ikke, omarbejdes klynge-inputtet — første alternativ er at embedde `reasoning` frem for `primary_gap`, som er kortere og mere formelagtig — før der bruges penge på en fuld kørsel.

**Forkert type-bestemmelse.** Se recall-probe-verifikationen ovenfor. Dette er designets vigtigste enkeltmekanisme.

**Evalens egen støj.** 12 af 45 rækker har `likely_root_cause = 'eval_harness'`. Dertil kommer at mutation-løste tickets (annullering/refusion) giver falske "kan ikke finde ordre"-misses mod nuværende Shopify-tilstand (`project_eval_resolved_ticket_staleness`). Disse cases ekskluderes fra klyngning, men **tælles og rapporteres eksplicit**, så det er synligt hvor stor en del af billedet der er lagt til side.

**Køretid.** 45 min pr. kørsel plus harvest. Kræver parallelitet i worker-ruten og i comments-hentningen.

## Test

- `gap-clusterer.js` er rene funktioner over `eval_results`-rækker og unit-testes med fixtures, som `major-edit-distiller.js`.
- Snapshot-test på klynge-**tildeling**, ikke på klynge-**navne** — navngivningen er et LLM-kald og ikke deterministisk.
- Type-bestemmelsen testes med en stubbet recall-probe: en klynge LLM'en kalder videnshul, men hvor proben finder indhold, skal komme ud som retrieval-miss.
- Harvest-udvidelsen: test at det udvidede `NON_SUPPORT_PATTERNS` filtrerer transportør-notifikationer uden at fjerne ægte support-tickets om forsendelse.

## Anbefalet sideløbende arbejde (ikke i denne spec)

Dag-1-oprydning, som er lille og meget synlig første gang AceZone åbner Sona:

- Drafts genereres på notifikationsstøj (DHL, PostNord, kontoadgang-mails).
- 63 `forward_email`-actions står urørte i `pending` (`thread_actions`, seneste 25/7).
- Af 93 action-rækker på 60 dage er kun 8 rigtige commerce-actions (2 `update_shipping_address` applied, 6 cancel-events). Actions er reelt uafprøvede i produktion.
