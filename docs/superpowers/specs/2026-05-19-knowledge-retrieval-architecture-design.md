# Knowledge & Retrieval Architecture — Design Spec
**Dato:** 2026-05-19  
**Status:** Godkendt til implementering

## Problem

Sona genererer for mange svar der er under 9/10. To rødder:

1. **Retrieval henter forkert knowledge** — cracking-artikler dukker op ved connectivity-sager, B2B saved replies dukker op ved teknisk support. Writer drukner i støj og blander irrelevant indhold ind.
2. **Saved replies er to ting på én gang** — agent-templates OG AI-knowledge. Det skaber støj i retrieval for alle shops.

Konkret eksempel: A-Blaze connectivity-sag. Factory reset-trin var i KB men begravet i en "audio cracking"-artikel. Retrieval hentede den artikel + en B2B saved reply + en comparison guide. Writer ignorerede factory reset og blinkede audio clip-forespørgsel ind i et connectivity-svar.

## Mål

Konsekvent 9-10/10 svar for alt der er dokumenteret i KB. Arkitekturen holder på tværs af alle shops der onboarder — ny shop med korrekt struktureret KB får høj kvalitet fra dag ét.

---

## Sektion 1 — KB-struktur

### 1.1 Fokuserede chunks

Hvert KB-entry skal have ét formål. Lang artikel med flere sektioner opdeles automatisk ved upload.

**Auto-chunking ved upload:**
- Split på headers (##, ###), nummererede sektioner, og tomme linjer mellem afsnit
- Hvert chunk må max være ~600 tokens
- Chunks der er for korte til at stå alene (<50 tokens) slås sammen med nærmeste nabo

### 1.2 Metadata-tags per chunk

To nye obligatoriske felter i `agent_knowledge.metadata`:

```json
{
  "products": ["a-blaze"],
  "issue_types": ["connectivity", "factory_reset"]
}
```

**`products`:** Liste af produktnavne der gælder for dette chunk. Tomme = gælder alle produkter (policy, generel viden).

**`issue_types`:** Liste af issue-typer chunken er relevant for. Vocabulary:
```
connectivity, factory_reset, audio, battery, firmware, 
microphone, pairing, physical_damage, return, refund, 
shipping, tracking, product_specs, general
```

### 1.3 UI — Knowledge upload flow

Når en shop uploader tekst eller PDF:
1. System chunker automatisk og viser preview af chunks
2. For hvert chunk foreslår systemet `products` og `issue_types` baseret på indhold (LLM-baseret auto-suggest, billigt kald)
3. Shop godkender eller justerer tags
4. Chunks gemmes med metadata

Shops kan redigere tags på eksisterende chunks fra Knowledge-UI.

### 1.4 Saved replies — separation

Saved replies fjernes fra `agent_knowledge`-indekset.

**Ny model:**
- Saved replies lever i deres egen sektion i UI (som i dag)
- De indekseres **ikke** i `agent_knowledge` og hentes aldrig af AI'en under draft-generering
- De er udelukkende agent-templates til manuel indsættelse

**Opt-in tone-eksempel:** Shop kan markere en saved reply som "AI tone-eksempel" — så indekseres den som `usable_as: tone_example`. Bevidst opt-in, ikke default.

**Migration:** Eksisterende saved replies i `agent_knowledge` med `source_provider='saved_reply'` ekskluderes fra retrieval via et filter i retriever. De slettes ikke fra tabellen — shops kan selv beslutte om de vil opt-in som tone-eksempler.

---

## Sektion 2 — Retrieval

### 2.1 Metadata hard filter

`match_agent_knowledge` RPC udvides med to nye parametre:

```sql
filter_products text[] DEFAULT NULL,
filter_issue_types text[] DEFAULT NULL
```

Når disse er sat, returneres kun chunks der matcher **mindst ét** element i hver liste (OR within list, AND between lists).

Retriever sender tags baseret på:
- `filter_products`: produktnavne nævnt i kundens besked (allerede detekteret via `extractMentionedProductTerms`)
- `filter_issue_types`: issue-typer fra plannerens intent + `extractIssueTerms`

**Mapping intent → issue_types:**
```
tracking        → ["tracking", "shipping"]
return          → ["return"]
refund          → ["refund", "return"]
exchange        → ["return", "physical_damage", "connectivity"]
complaint       → ["physical_damage", "connectivity", "audio", "battery"]
product_question → ["product_specs", "connectivity", "audio", "firmware"]
address_change  → ["shipping"]
```

### 2.2 Fallback

Hvis metadata-filter returnerer 0 resultater (tags ikke sat på KB endnu), falder retrieval tilbage til ren vector search uden filter. Eksisterende shops går ikke i stykker under migration.

### 2.3 Strammere parametre

| Parameter | Nuværende | Ny |
|-----------|-----------|-----|
| `knowledgeBudget` | 8 | 4 |
| Relevance floor | 40% af top score | 60% af top score |
| Saved replies i query | ja | nej (ekskluderet via `source_provider != 'saved_reply'`) |

### 2.4 Supabase migration

Ny migration tilføjer `products` og `issue_types` kolonner til `agent_knowledge.metadata` (JSONB — ingen schema-ændring nødvendig, metadata er allerede JSONB). RPC `match_agent_knowledge` opdateres med de to nye filter-parametre.

---

## Sektion 3 — Writer prompt cleanup

### 3.1 Mål

Fra ~200 linjer til ~100 linjer. Ingen substantielle regler fjernes — de konsolideres.

### 3.2 Hvad der ryddes op

| Problem | Fix |
|---------|-----|
| POST-ACTION forklaret to steder med overlap | Ét sted, klar og komplet |
| Email-adresse-forbud nævnes tre steder | Ét forbud øverst i ABSOLUTTE REGLER |
| ÅBNING og TONE har overlappende regler | Én samlet sektion |
| ABSOLUTTE REGLER og INTENT-ADFÆRD gentager "aldrig videresend" | Ét sted |
| VIDENSBASE og VIDENSBASE-PRODUKTSPECIFICITET siger det samme | Samles |

### 3.3 Prioritetsrækkefølge i ny prompt

```
1. Sprog (absolut)
2. POST-ACTION (hvis relevant — ellers spring over)
3. Absolutte forbud (email, signatur, false confirmations)
4. Svar på kundens åbne spørgsmål med fakta
5. Brug KB-procedurer fuldt ud når de findes
6. Tone og længde (spejl fase i samtalen)
7. Afslutning
```

---

## Ikke i scope

- Cross-encoder re-ranker (kan tilføjes som fase 2)
- Fine-tuning (separat spor)
- Ændringer i planner eller fact-resolver

---

## Implementeringsrækkefølge

1. **Database migration** — `match_agent_knowledge` RPC med filter-parametre
2. **Retriever** — metadata-filter + strammere parametre + saved replies ekskluderet
3. **Writer prompt** — cleanup og konsolidering
4. **KB upload flow** — auto-chunking + tag-UI
5. **Eval** — kør eval igen og sammenlign scores

Fase 1-3 kan rulles ud uafhængigt af fase 4 (fallback sikrer bagudkompatibilitet). Fase 4 er den der giver den fulde effekt for nye shops.
