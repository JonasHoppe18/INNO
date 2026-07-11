# Dag-ét-viden + "Ejer sagen"-fallback

**Dato:** 2026-07-11
**Status:** Godkendt design — klar til implementeringsplan

## Baggrund og mål

Benchmark mod Wilmo (wilmo.ai) viste at deres kvalitet hviler på tre strukturelle søjler: fuld historik-træning fra dag ét, actions udført end-to-end, og gradueret autonomi pr. kategori. Sonas drafts på rigtig AceZone-trafik ligger på ~6/10 i snit — men fordelingen er skæv: sager med groundede fakta + klar policy-sti rammer 8-8,5/10 (medarbejder-niveau), mens sager uden grounding falder til 3-5/10 fordi writeren **opfinder afvisninger** ("vi har ikke mulighed for at kontakte Maxgaming", "we don't have individual mic clips") i stedet for at opføre sig som en medarbejder der ejer sagen.

Dette design dækker de to højest-prioriterede setup-fixes (besluttet 2026-07-11):

1. **Del 1 — Fuld historik-import:** enhver ny webshop (og AceZone nu) får hele sin support-historik ind som few-shot-materiale fra dag ét — Wilmos dag-ét-våben.
2. **Del 2 — "Ejer sagen"-fallback:** når intet grounder kundens kerne-spørgsmål, skal Sona aldrig digte — den skal enten stille ét præcist spørgsmål (kunde-hul) eller love at undersøge og vende tilbage (videns-hul), og hullet skal logges struktureret.

**Rækkefølge:** Del 2 implementeres først (lille, ren edge-deploy, rammer 3 af 4 svage draft-mønstre). Del 1 bagefter (web-app + job-infrastruktur).

## Beslutninger (afklaret med bruger)

- **Fallback-adfærd:** To-vejs afhængigt af hullet. Kunde-info mangler → ét præcist spørgsmål (eksisterende `missing_required_fields`-mekanik). Shoppens viden mangler → "det undersøger jeg og vender tilbage" + intern flagging + struktureret gap-log. Aldrig opfundne afvisninger.
- **Import-dybde:** Fuld Zendesk-historik → tone-lanen (`ticket_examples`) med eksisterende LLM-redaktion. Videns-destillering fra historikken er et SEPARAT senere projekt (ikke i scope).
- **Omkostningsdisciplin:** Importen viser estimeret engangsomkostning FØR kørsel og kræver eksplicit bekræftelse (jf. eval-cost-princippet: ingen dyre kørsler uden aftale).

## Eksisterende infrastruktur (grounded 2026-07-11)

- `apps/web/app/api/knowledge/import-zendesk/route.ts` — den SUNDE import-lane: har allerede LLM-baseret GDPR-redaktion pr. ticket (drop-on-failure: fejler redaktion droppes ticketen, rå PII gemmes aldrig) og skriver til `ticket_examples`. Importerede oprindeligt ~75 AceZone-tickets i én batch.
- `apps/web/lib/server/knowledge-import.ts` — ConnectCards-lanen: historik-import er allerede eksplicit DEAKTIVERET med guard ("temporarily disabled pending redaction/review onboarding flow") fordi den skrev uredigeret indhold til `agent_knowledge`. Den forbliver deaktiveret; dette design rører den ikke.
- `knowledge_import_jobs`-tabellen findes (bygget til ConnectCards-lanen, ubrugt) — genbruges til job-fremdrift.
- `ticket_examples` (AceZone: 286 rækker i dag) — writerens few-shot tone-lane, med eget vector-index (`match_ticket_examples` RPC). Retrieveren ekskluderer allerede pr. eksternt ticket-id ved eval (data-leak-værn).
- `generate-draft-v2/pipeline.ts` — beregner allerede `knowledge_gaps` (udækkede kunde-spørgsmål) og har snippet-matcher-abstention + `live_facts`-provenance. Directive-blokke injiceres via `internalRulesBlock`-arrayet (mønster: `compatibilityBlock`, `comparisonBlock`, `priceBlock`, `subjectAnchorBlock`).
- Writer-stadiets deterministiske checks (`unsupported-negative-claim-check` m.fl.) forbliver uændrede som sidste værn.

## Del 2 — "Ejer sagen"-fallback (implementeres først)

### Detektion: `groundingCoverage`

Ny ren, deterministisk vurdering i pipelinen efter retrieval + fact-resolution, før writeren:

- **Ungroundet** = kundens primære spørgsmål optræder i `knowledge_gaps` OG intet live-fakta/struktureret direktiv adresserede det OG snippet-matcheren abstainede / ingen chunk dækker emnet.
- Implementeringsplanen pinner de præcise felter (knowledge_gaps-beregningen, matcher-abstention-flag, live_facts-listen) ved at læse pipeline-koden — spec'en fastlægger KUN kontrakten: vurderingen er ren (ingen I/O), tager pipelinens eksisterende outputs som input, og returnerer `{ ungrounded: boolean, gapKind: "customer_info" | "shop_knowledge" | null, gapSummary: string | null }`.
- `gapKind`-skelnen: hvis `missing_required_fields`-mekanikken allerede har identificeret manglende kunde-felter → `customer_info` (eksisterende adfærd fortsætter uændret: stil spørgsmålet). Ellers → `shop_knowledge`.

### Adfærd ved `shop_knowledge`-hul

1. **Writer-direktiv** (ny blok i `internalRulesBlock`-arrayet, samme mønster som søskende-blokkene): anerkend kundens spørgsmål konkret; sig at det undersøges og at vi vender tilbage; giv det svar der FAKTISK er groundet (delvise svar er tilladt); opfind ALDRIG en afvisning, kapabilitets-grænse eller tredjepart; stil IKKE et informationsspørgsmål (hullet er ikke kundens at lukke).
2. **Intern flagging:** `routing_hint` forbliver "review" (eksisterende mekanik — draften auto-sendes ikke). Der skrives IKKE nye kolonner på `mail_threads` (YAGNI).
3. **Struktureret gap-log:** én `agent_logs`-række (event `draft_ungrounded_gap`, step_detail med gapSummary + thread_id + intent) — fødekilde til det senere læringsloop. Skrives IKKE i dry-run/eval-mode (samme no-write-regel som resten af pipelinen).

### Regression-værn

- Fyrer KUN når `groundingCoverage.ungrounded === true` — groundede sager (Anna-garanti, Kasper-feedback, pris-svar) må ikke ændre output.
- Verifikation: dry-runs mod dagens kendte sager. SKAL ændre sig: Daniel/Maxgaming (T-050887-tråden), mic-clips (f587bf4c). MÅ IKKE ændre sig: Anna-garanti-syntetisk, Kasper (9a3a8d24), pris-DKK-syntetisk.
- Unit-tests (Deno, colocated) for `groundingCoverage`-beslutningen og direktiv-bygningen.

## Del 1 — Fuld historik-import

### Job-model

- Udvid `import-zendesk`-ruten med en job-baseret, resumérbar import: én `knowledge_import_jobs`-række pr. import (felter: total, importeret, droppet (redaktion fejlede), skippet (dublet/kvalitetsfilter), cursor, status running/completed/failed). Implementeringsplanen verificerer tabellens faktiske kolonner og tilpasser.
- Kørsel i chunks: ét API-kald behandler ~50 tickets og returnerer job-status + næste cursor; UI'et poller/fortsætter til `completed`. Ingen lange requests, afbrudt import genoptages fra cursor.

### Dedupe + kvalitetsfilter

- Skip tickets hvis eksterne Zendesk-id allerede findes i `ticket_examples` (de eksisterende 286 bevares; gen-kørsel er idempotent).
- Kun tickets med et rigtigt agent-svar (>20 tegn, ikke auto-replies) — samme kvalitetsregel som retrieveren håndhæver i dag.

### Omkostningsestimat + bekræftelse

- Nyt estimat-trin før kørsel: hent totalt ticket-antal fra Zendesk, beregn forventet redaktions-/embedding-omkostning (redaktor-model pr. ticket + embedding pr. par), vis i UI, kræv eksplicit bekræftelse (`confirm: true`) før jobbet starter.

### Redaktion og sikkerhed (uændrede principper)

- Eksisterende redaktor genbruges uændret: fejler redaktion → ticket droppes. Rå PII skrives aldrig.
- Al skrivning shop-scoped (`shop_id`) som i dag. ConnectCards-lanens historik-guard forbliver på plads.

### UI

- Minimal udvidelse af den eksisterende Knowledge-side-knap: estimat → bekræft → fremdriftsbjælke (importeret/droppet/skippet af total) → færdig. Ingen ny side.

## Data flow

```
Del 1: Zendesk (fuld historik) → estimat+bekræft → chunks á 50 → redaktion (drop-on-fail)
        → dedupe/kvalitetsfilter → ticket_examples (embedded, shop-scoped)
        → writerens few-shot tone-lane (eksisterende retriever-mekanik, uændret)

Del 2: retrieval+facts → groundingCoverage (ren vurdering)
        ├─ groundet → uændret pipeline
        ├─ customer_info-hul → eksisterende missing_required_fields-spørgsmål
        └─ shop_knowledge-hul → owns-the-case-direktiv + agent_logs gap-event
```

## Fejlhåndtering

- Import: Zendesk-API-fejl mid-job → job står som running med cursor intakt, næste kald genoptager; permanent fejl markerer jobbet failed med fejlbesked. Redaktions-fejl pr. ticket → drop + tæl, aldrig abort af hele jobbet.
- Fallback: `groundingCoverage` er ren og kan ikke kaste; mangler dens inputs (defensive null-checks) → `ungrounded: false` (fail-safe: eksisterende adfærd).

## Test

- **Del 2:** Deno unit-tests for coverage-beslutning (groundet/kunde-hul/videns-hul/tomme inputs) + direktiv-tekst; live dry-run-verifikationssæt som beskrevet under regression-værn.
- **Del 1:** Unit-tests for rene helpers (dedupe-filter, kvalitetsfilter, estimat-beregning, cursor-fremdrift); manuel verifikation af fuld kørsel mod AceZones Zendesk med estimat-bekræftelse.

## Scope-afgrænsning (YAGNI)

- Ingen videns-destillering fra historikken (separat senere projekt).
- Kun Zendesk som kilde (Gorgias/Dixa senere hvis behov).
- Ingen nye mail_threads-kolonner, ingen ny UI-side, ingen ændring af negative-claim-checks.
- Læringsloop-review-flowet (approve→apply) er IKKE i scope her — men gap-loggen fra Del 2 designes som dets fødekilde.

## Succeskriterier

- Del 2: Daniel/Maxgaming- og mic-clips-sagerne producerer "ejer sagen"-svar uden opfundne afvisninger; de stærke sager er uændrede; gap-events optræder i agent_logs.
- Del 1: AceZones fulde Zendesk-historik importeret (fra 286 → alt der passerer kvalitetsfilteret), idempotent gen-kørsel, omkostning godkendt før kørsel.
