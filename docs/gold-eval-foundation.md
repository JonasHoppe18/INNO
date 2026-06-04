# Gold Eval Foundation

Håndkureret eval-datasæt og deterministisk runner til måling af draft-kvalitetsændringer over tid.

## Arkitektur

```
gold_eval_cases     ← håndkurerede referencecases (inputdata + forventede resultater)
gold_eval_runs      ← én batch-kørsel (metadata + summary)
gold_eval_results   ← ét resultat pr. case pr. kørsel (stage-by-stage scores)
```

Systemet er fuldt adskilt fra de eksisterende eval-tabeller:
- `eval_runs` / `eval_results` — LLM-judge-drevet (correctness/completeness/tone 1-5 + overall_10); bruges af worker-evalueringsflowet.
- `ticket_examples` — style-eksempler til few-shot-prompting. Må aldrig blandes med gold evals.

## Schema

### `gold_eval_cases`

| Felt | Type | Beskrivelse |
|------|------|-------------|
| id | uuid | PK |
| workspace_id | uuid | Workspace-scope (nullable; shops-owner fallback) |
| shop_id | uuid | Shop-scope (required) |
| title | text | Kort navn på casen (bruges til dedup ved import) |
| category | text | fx `tracking`, `technical_support`, `return` |
| customer_message | text | Kundens besked — selve input til pipelinen |
| thread_history_json | jsonb | Evt. tidligere beskeder (conversation_history til eval-mode) |
| order_context_json | jsonb | Ordredata der er relevant for casen |
| expected_intent | text | Primær pipeline-intent-label pipelinen bør producere (fx `order_status`, `refund_request`) — altid single-label |
| secondary_intents | jsonb | Ikke-primære operationelle behov i samme besked (fx en `refund_request` der også bærer et `exchange_request`-fallback). Default `[]`. Holdes adskilt fra `expected_intent` så intent-grading forbliver single-label |
| grading_mode | text | `content_only` ⇒ casen kan graded på beskedindhold alene. `order_context_required` ⇒ kræver anonymiseret ordrekontekst før facts/action kan graded; indtil enrichment lander er sådanne cases stadig brugbare til intent- + retrieval-grading. Constrained til disse to værdier |
| required_facts_json | jsonb | Liste over facts der skal være til stede i svaret |
| gold_knowledge_chunk_ids | jsonb | Liste af `agent_knowledge.id`-værdier der bør retrieved. **`agent_knowledge.id` er BIGINT, ikke uuid** — chunk-ids lagres som JSON-tal (fx `[3758, 3964]`). jsonb lagrer dem løsfrit; der er ingen uuid-cast i denne sti. Runneren sammenligner ids som normaliserede strenge (`String(id)`) så tal/streng-JSON-former matcher identisk, og JS holder aldrig et bigint som float |
| expected_resolution | text | Fritekst beskrivelse af det korrekte outcome |
| expected_action_json | jsonb | Den action pipelinen forventes at foreslå |
| ideal_reply | text | Et idealt draft (reference for manuel vurdering) |
| autopilot_allowed | boolean | Om casen må afvikles i autopilot-mode |
| notes | text | Kommentarer til casen |
| is_active | boolean | `false` ⇒ casen springes over i kørslerne |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `gold_eval_runs`

| Felt | Type | Beskrivelse |
|------|------|-------------|
| id | uuid | PK |
| shop_id / workspace_id | uuid | Scope |
| status | text | `running` \| `completed` \| `failed` |
| pipeline_version | text | Altid `v2` |
| case_count | integer | Antal cases i batchen |
| summary_json | jsonb | Kompakt summary (se Section 6 nedenfor) |
| created_at / completed_at | timestamptz | |

### `gold_eval_results`

| Felt | Type | Automatisk? | Beskrivelse |
|------|------|-------------|-------------|
| eval_case_id | uuid | — | FK til gold_eval_cases |
| eval_run_id | uuid | — | FK til gold_eval_runs |
| generation_id | uuid | ja | Kobler til draft_generations-trace |
| actual_intent | text | ja | Hvad pipelinen faktisk returnerede |
| intent_correct | boolean \| null | **ja** | Deterministisk: normaliseret sammenligning |
| retrieved_chunk_ids | jsonb | ja | Rangordnede retrieved chunk-ids fra retrieval_debug |
| retrieval_hit_at_k | jsonb | **ja** | `{ hit_at_1, hit_at_3, hit_at_5, hit_at_10, recall_at_5, first_hit_rank, gold_count, retrieved_count }` |
| facts_json | jsonb | ja | Fra draft_generations.facts_json (hvis instrumenteret) |
| facts_correct | boolean \| null | **manuel** | Null = ikke autogradet |
| actual_resolution | text | — | Til manuel udfyldning |
| resolution_correct | boolean \| null | **manuel** | |
| actual_action_json | jsonb | ja | Foreslåede actions fra svaret |
| action_correct | boolean \| null | **manuel** | |
| final_draft_text | text | ja | Det genererede draft |
| answer_completeness_score | numeric \| null | **manuel/LLM** | |
| tone_score | numeric \| null | **manuel/LLM** | |
| send_ready_score | numeric \| null | **manuel/LLM** | |
| verifier_confidence | numeric | ja | Pipelinens verifier confidence |
| total_latency_ms | integer | ja | Latency fra response (eller draft_generations hvis instrumenteret) |
| input_tokens / output_tokens | integer \| null | ja | Kun tilgængeligt hvis pipeline er instrumenteret og skriver draft_generations |
| error_message | text \| null | ja | Hvis pipelinen fejlede |

**Automatiske scorer** (sættes af runneren uden LLM):
- `intent_correct` — normaliseret streng-sammenligning
- `retrieval_hit_at_k` — gold chunk-ids mod faktisk retrieved

**Manuelle scorer** (kræver menneskelig eller LLM-vurdering):
- `facts_correct`, `resolution_correct`, `action_correct`
- `answer_completeness_score`, `tone_score`, `send_ready_score`

## Oprette cases

### Seed-fil → import-script (anbefalet)

1. Kopier `supabase/eval/gold-eval-cases.example.json` til `supabase/eval/gold-eval-cases.<shop-slug>.json`.
2. Udfyld cases. Vigtige felter:
   - `expected_intent` skal matche pipeline-intent-vocabulary (`order_status`, `return`, `complaint`, `exchange` m.fl.).
   - `gold_knowledge_chunk_ids` skal indeholde rigtige `agent_knowledge.id`-værdier som **JSON-tal** (`agent_knowledge.id` er bigint — fx `[3758, 3964]`, ikke uuid-strenge). Find dem:
     ```sql
     select id, source_label, source_type from agent_knowledge
     where shop_id = '<shop_id>' order by created_at desc limit 50;
     ```
   - `grading_mode` skal være `content_only` eller `order_context_required`. Brug `order_context_required` når facts/action først kan graded efter ordrekontekst er koblet på — casen er stadig brugbar til intent + retrieval indtil da.
   - `secondary_intents` er en valgfri liste af ikke-primære operationelle behov i samme besked (default `[]`).
3. Kør importeren:
   ```bash
   set -a && source apps/web/.env.local && set +a
   node supabase/scripts/import-gold-eval-cases.mjs \
     --file supabase/eval/gold-eval-cases.<shop-slug>.json \
     --shop <shop_id>
   ```
   Brug `--replace` til at opdatere eksisterende cases (match på `shop_id` + `title`).
   Brug `--dry-run` for at se hvad der ville ske uden at skrive.

## Køre eval-runneren

```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/run-gold-eval.mjs --shop <shop_id> [--workspace <id>] [--limit N]
```

**Hvad sker der:**
1. Aktive `gold_eval_cases` for shoppen hentes.
2. Hver case køres igennem `generate-draft-v2` i **eval-mode** (`email_data`/`eval_payload`). Det garanterer at ingen kundetabeller (`mail_threads`, `mail_messages`, `drafts` m.fl.) skrives.
3. Deterministiske checks beregnes (intent, retrieval hit@k).
4. En `gold_eval_results`-række indsættes pr. case.
5. `gold_eval_runs.summary_json` opdateres med den kompakte summary.

## Summary output

```
Gold eval run <run_id>
  cases:               30
  intent accuracy:     83.3% (graded 24)
  retrieval hit@5:     75.0% (graded 20)
  cases missing facts: 5
  avg confidence:      0.82
  avg latency ms:      1240
  avg input tokens:    n/a
  avg output tokens:   n/a
  failed:              1
    - <case_id>: intent_mismatch
```

`n/a` for tokens betyder at den deployede pipeline-version ikke skriver `draft_generations` endnu (pre-instrumentation).

## Aflæse resultater

```sql
-- Seneste run for en shop
select id, status, case_count, summary_json, created_at
from gold_eval_runs
where shop_id = '<shop_id>'
order by created_at desc
limit 5;

-- Alle resultater i et specifikt run
select
  c.title,
  r.actual_intent,
  r.intent_correct,
  r.retrieval_hit_at_k->>'hit_at_5'  as hit_at_5,
  r.verifier_confidence,
  r.total_latency_ms,
  r.error_message
from gold_eval_results r
join gold_eval_cases c on c.id = r.eval_case_id
where r.eval_run_id = '<run_id>'
order by c.title;

-- Alle aktive gold cases for en shop
select id, title, category, expected_intent, is_active, created_at
from gold_eval_cases
where shop_id = '<shop_id>' and is_active = true
order by category, title;
```

## Sammenligne to eval-runs

```sql
-- Sammenlign de to seneste runs (intent accuracy + retrieval hit@5)
with runs as (
  select id, created_at,
         rank() over (order by created_at desc) as rk
  from gold_eval_runs
  where shop_id = '<shop_id>'
  limit 2
),
a as (select * from runs where rk = 2),   -- ældre run
b as (select * from runs where rk = 1)    -- nyeste run
select
  c.title,
  c.expected_intent,
  ra.intent_correct       as prev_intent_ok,
  rb.intent_correct       as curr_intent_ok,
  (ra.retrieval_hit_at_k->>'hit_at_5')::boolean as prev_hit5,
  (rb.retrieval_hit_at_k->>'hit_at_5')::boolean as curr_hit5,
  ra.verifier_confidence  as prev_conf,
  rb.verifier_confidence  as curr_conf
from gold_eval_cases c
join gold_eval_results ra on ra.eval_case_id = c.id and ra.eval_run_id = (select id from a)
join gold_eval_results rb on rb.eval_case_id = c.id and rb.eval_run_id = (select id from b)
where c.shop_id = '<shop_id>'
order by c.title;
```

## Udvælge de første 30 AceZone-cases

Anbefalede kriterier for en repræsentativ initial-suite:

1. **Dæk de vigtigste intents** (fra eksisterende `eval_results`):
   ```sql
   select coalesce(metadata->>'primary_intent', 'unknown') as intent, count(*)
   from eval_results
   group by 1 order by 2 desc limit 20;
   ```
2. **Prioritér cases med lav score** — disse er de sværeste og mest diagnostisk værdifulde.
3. **Inkludér sprogopdeling** — dansk/engelsk i ~60/40 (matcher produktionstraffiken).
4. **Inkludér edge cases** — address_change, exchange, manglende ordredata.
5. **Inkludér tracked cases** — cases hvor retrieval er kritisk (fx garantipolitik, return-window) og gold_knowledge_chunk_ids kan sættes.
6. **Ekskludér mutation-resolved tickets** — ordre der er annulleret/refunderet siden oprettelsen vil give false negatives i Shopify-opslag.

Kig i `supabase/eval/golden-set.acezone.json` for inspiration — de eksisterende file-baserede cases kan genbruges direkte ved at kopiere `body`/`intent`/`source_thread_id` over i gold-eval-formatet.

## Kendte begrænsninger

- **Tokens er n/a** indtil den instrumenterede `generate-draft-v2` er deployet (Phase 1 edge-function-redeploy er ikke udført endnu). Latency kommer fra client-side måling.
- **Ingen LLM-judge endnu** — `facts_correct`, `resolution_correct`, `action_correct`, og tone/completeness/send-ready-scores sættes ikke automatisk. De kræver manuel vurdering eller et separat LLM-judge-lag (planlagt som næste fase).
- **Retrieval hit@k kræver rigtige chunk-ids** — `gold_knowledge_chunk_ids` skal udfyldes med faktiske `agent_knowledge.id`-værdier (bigint JSON-tal, fx `3758`), ellers er graded=0 for retrieval. Runneren normaliserer både gold- og retrieved-ids via `String(id)`, så tal- og streng-former matcher identisk uden bigint-præcisionstab.
- **Intent-matching er exact** (normaliseret string) — aliases understøttes ikke. Sørg for at `expected_intent` bruger pipeline-vocabulary.
