# Major-edit distiller — root-cause histogram (2026-07-14)

Fuld kørsel af `supabase/scripts/distill-major-edits.mjs --limit 200 --apply` over alle
major-edit draft-par (`drafts.ai_draft_text` vs `drafts.final_sent_text`, status=sent).
98 par klassificeret, 0 skipped, 98 `feedback_suggestions`-rækker upserted
(`dedup_key = distill:<draft_id>`). Model: gpt-4o, temperature 0.

## Histogram

| Root cause | Antal | Andel |
|---|---|---|
| missing_knowledge | 38 | 39 % |
| incorrect_policy | 21 | 21 % |
| live_fact_tracking | 16 | 16 % |
| product_specific | 9 | 9 % |
| too_verbose | 3 | 3 % |
| refund_return_nuance | 3 | 3 % |
| style_tone | 2 | 2 % |
| unclear_intent | 2 | 2 % |
| insufficient_data | 2 | 2 % |
| compatibility | 1 | 1 % |
| other | 1 | 1 % |

## Konklusioner (styrer prioritering, jf. 10/10-planens Task 8)

1. **60 % er viden/policy** (missing_knowledge + incorrect_policy): medarbejdernes
   rettelser handler overvejende om fakta Sona ikke havde eller havde forkert —
   ikke om formuleringer. Retrieval-recall-planen er næste store indsats
   (Task 8 Step 1), sammen med udfyldning af ægte authoring-gaps
   (fejlfindingstrin pr. produkt, garanti-/reparationsprocesser, firmware-app-procedurer
   går igen i klassifikationerne).
2. **16 % er live_fact_tracking**: forsendelsesstatus/leveringsdatoer som drafts enten
   hallucinerede eller manglede. Bekræfter Ship24-planens relevans (Task 8 Step 2).
3. **Tone er IKKE hovedproblemet**: style_tone + too_verbose = 5 %. "Lyder som AI"-
   fornemmelsen skal løses, men den målbare edit-årsag er faktuel. Gårsdagens
   tone-fixes (greeting, robot-åbnere) adresserer fornemmelsen; histogrammet siger
   at korrekthed er dér de fleste major-edits kommer fra.
4. Bemærk staleness-forbeholdet fra `project_eval_resolved_ticket_staleness`:
   nogle live_fact-klassifikationer afspejler at medarbejderen kunne slå live status
   op — ikke at pipelinen kunne have vidst det på draft-tidspunktet.

## Næste skridt

- Fase 2 (review-flade): reviewér de 98 distill-suggestions + 87 ældre
  (`insufficient_data`-detektoren) — godkendte golden-cases eksporteres til eval-settet.
- Skriv `docs/superpowers/plans/2026-07-XX-retrieval-recall.md` (histogram-vinderen).
- Produkt-sync + presentment-valuta lukkes uafhængigt (korrekthedslofter for
  lager/pris-svar, rammer ikke dette histogram fordi de spørgsmål sjældent når send).
