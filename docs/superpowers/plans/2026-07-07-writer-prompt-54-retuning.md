# Writer-prompt re-tuning til gpt-5.4-familien

**Mål (Jonas, 2026-07-07):** Væk fra gpt-4o + send-ready >50%. Kandidat: gpt-5.4-mini (writer) + gpt-5.4 (eskalering).

## Målt status (pilot-set, 8 scorede cases, judge gpt-4o-mini)

| Iteration | gpt-4o (vagt) | 5.4-mini |
|---|---|---|
| Baseline (fuld-run subset) | 7.12 | 6.25 |
| Lever 1: positiv-grounding-modvægt (b59eccb, BEHOLDT) | 7.12 | 6.50 |
| Lever 2+3: "levér alt dækket indhold" (REVERTERET) | 7.12 | 6.00 |

Fuld-golden reference: gpt-4o 7.08/30% send-ready; 5.4-mini-low 6.70/14%; medium værre (6.32 — overtænker).

## Diagnose (draft-diffs 4o vs mini, runs 12-43-53 vs 13-13-55)
1. Mini over-generaliserer ABSOLUTTE FORBUD-listerne → hedger DÆKKEDE fakta (g-021: "kan ikke bekræfte version 146" hvor knowledge dokumenterer det). Lever 1 hjælper (+0.25).
2. Mini under-bruger valgt knowledge (g-016: bad om kundens forslag i stedet for at levere collab-info).
3. Mini-drafts ~30% kortere (300 vs 424 tegn median).
4. LÆRE fra lever 2+3: additive instruktioner gør mini VÆRRE (dumper ufokuseret). Små modeller kræver FÆRRE konkurrerende regler, ikke flere.

## Iteration 3: strukturel prompt-variant (per-model-gating)

**Mekanisme (trin 1, ren refaktor — byte-identisk output):**
- Ekstrahér de statiske regelsektioner (writer.ts ~1895-1965: HOLDNING / SÅDAN SVARER DU / BRUG DÆKKEDE / ABSOLUTTE FORBUD / BESLUTNINGSREGLER / AFSLUTNING — inkl. `${actionResult}`-interpolationen) til `buildCoreRulesBlock({ variant, replyLanguage, actionResult, languageCorrectionInstruction })`.
- Samme for den anden prompt-variant (~1967-1990).
- variant: "classic" (nuværende tekst, uændret) | "compact".
- Gating: `shouldUseResponsesApi(resolvedModel)` → compact; ellers classic. Prod-4o forbliver byte-identisk.
- Verifikation af trin 1: fuld testsuite + snapshot-sammenligning af genereret prompt for fikseret input før/efter.

**Compact-tekst (trin 2, udkast — skrives til hvordan små modeller læser):**
```
DE 5 VIGTIGSTE REGLER (i prioriteret rækkefølge — ved konflikt vinder lavere nummer):
1. SANDHED: Brug KUN fakta fra "Verificerede fakta" og den valgte knowledge. Står et faktum dér, så sig det direkte og selvsikkert. Står det der IKKE, så opfind det aldrig — spørg om det ene der mangler.
2. LØS SAGEN: Du er en erfaren kollega med mandat. Led med beslutningen/svaret i første sætning. Ingen "vi vender tilbage" medmindre du reelt afventer noget eksternt.
3. FØLG DIREKTIV-BLOKKENE: Blokke markeret # (ordre-match, FEJLFINDINGS-GUIDE, AKTIVT FLOW, refund-status m.fl.) er bindende instruktioner for netop denne sag — følg dem præcist.
4. SPROG OG TONE: Kun ${replyLanguage}. Menneskelig kollega-tone; aldrig "vores system"/proces-sprog; ingen fyld-indledninger; sig hver pointe én gang.
5. LÆNGDE: Kort ved transaktionelle svar (2-4 sætninger). Komplet ved guides/faktasvar (alle relevante trin/fakta fra den valgte knowledge — udelad aldrig dækkede trin).

OPSLAGSREGLER (gælder når situationen opstår):
[destillat af BESLUTNINGSREGLER + kanal/billede/afslutning — én linje per regel, grupperet]
```
Pointen: 5 prioriterede regler erstatter ~40 ligestillede; edge-case-reglerne flyttes til et opslagsafsnit modellen kun aktiverer ved match. Direktiv-blokkene (dynamiske) er uændrede — de bærer allerede sags-specifik logik.

**Måleprotokol:** pilot-set × {mini-compact, 4o-classic-vagt} per ændring; fuld golden ved mini-pilot ≥ 7.0; secret-skifte (OPENAI_MODEL=gpt-5.4-mini, OPENAI_ADVANCED_MODEL=gpt-5.4) først efter fuld-golden ≥ 7.0 og send-ready ≥ 30%; derefter smoke på Mark/Mikkel/Daniel-replays.

**Værktøj:** `node supabase/scripts/run-golden-eval.mjs --set supabase/eval/pilot-set.acezone.json --writer-model gpt-5.4-mini --strong-model gpt-5.4` (+ evt. `--writer-effort`). Judge-diagnose-felter persisteres i runs.
