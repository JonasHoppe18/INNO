# Sona Draft Quality Foundation — Design Spec
**Dato:** 2026-04-24  
**Status:** Til review

---

## Problemformulering

Sona genererer allerede gode svar når AI'en har specifik information (fx troubleshooting via knowledge base). Problemet opstår i tre scenarier:

1. **Manglende Shopify-data** — refund-beløb, fradrag, dato og årsag sendes ikke til AI'en. Den ser kun `financial_status: "partially_refunded"` og svarer generisk.
2. **Tabte fakta i lange tråde** — AI'en glemmer hvad der allerede er aftalt/udført og tilbyder det igen, eller svarer uden reference til tidligere beskeder.
3. **Rå historik truncates** — Gamle beskeder skæres væk tilfældigt fremfor at bevare de vigtigste fakta.

---

## Designmål

- Et nyt svar skal aldrig genopfinde fakta der allerede er etableret i tråden
- Refund/ordre-svar skal altid indeholde præcise tal og datoer fra Shopify — aldrig generiske policy-estimater
- En ny webshop der konfigurerer tone + policies + knowledge skal få gode svar fra dag 1
- Arkitekturen skal skalere til alle inquiry-typer uden hardcoding per shop

---

## De tre søjler

### Søjle 1: Enriched Order Context

**Problem:** `buildOrderSummary` ignorerer Shopify's `refunds[]`-array, `note`, `tags`, og `customer`-data.

**Løsning:** Udvid order context til at inkludere:

```
ORDRE #1234
Status: Delvist refunderet | Leveret
Bestilt: 22. apr 2026 | Total: 399 DKK | Nuværende total: 349 DKK

VARER:
- 1× Sony WH-1000XM5 (sort) [variant_id=...]

REFUNDERINGER:
- 27. apr 2026: 50 DKK refunderet
  Note: Fradrag — åbnet emballage (headset taget ud af original indpakning)
  Transaktionsstatus: success | Behandlet af betalingsgateway

LEVERING:
- GLS, trackingnummer: 12345678, status: Leveret 20. apr 2026

KUNDE:
- 3 ordrer i alt, 1.247 DKK samlet købt
```

**Implementering:**
- Tilføj `refunds[]` parsing til `buildOrderSummary` i `_shared/shopify.ts`
- Inkluder refund transactions (amount, status, processed_at, gateway)
- Inkluder refund_line_items (hvilke varer, hvilken mængde, subtotal)
- Inkluder adjustment_reason / note fra refund
- Inkluder `customer.orders_count` og `customer.total_spent`
- Inkluder `order.note` og `order.tags`
- Beregn "nuværende total" = `total_price - sum(refunds)`

---

### Søjle 2: Thread State (persistent per tråd)

**Problem:** AI'en har ingen hukommelse af hvad der er etableret, aftalt eller lovet i tråden.

**Løsning:** Et JSON-objekt gemt i `mail_threads.agent_state` (ny JSONB-kolonne) og opdateret efter hvert svar.

**Schema:**
```json
{
  "version": 1,
  "established_facts": {
    "refund_approved": true,
    "refund_amount": "50 DKK",
    "deduction_reason": "åbnet emballage",
    "refund_processed_date": "2026-04-27",
    "return_received": true,
    "order_cancelled": false
  },
  "actions_taken": [
    {
      "type": "refund_order",
      "amount": "50 DKK",
      "date": "2026-04-22",
      "status": "completed",
      "note": "Fradrag for åbnet emballage"
    }
  ],
  "commitments_made": [
    "Informeret om 2-5 hverdages behandlingstid (besked 2)",
    "Returnpolitik-link sendt (besked 1)"
  ],
  "open_items": [],
  "last_updated_at": "2026-04-24T10:00:00Z",
  "message_count": 3
}
```

**Opdateringsregler:**
- Opdateres deterministisk når en action eksekveres (type, beløb, dato kopieres direkte)
- Opdateres med et letvægts LLM-kald efter draft-generering der ekstraher nye fakta fra svaret
- `commitments_made` bygges ved at identificere løfter i genereret svar ("du kan forvente...", "vi sender...")
- `open_items` ryddes når kunden bekræfter løsning

**Injiceres i prompt som:**
```
ETABLEREDE FAKTA I DENNE SAG:
- Refund godkendt: ja (50 DKK)
- Fradrag: åbnet emballage
- Refund behandlet: 27. apr 2026
- Returnvare modtaget: ja

ALLEREDE KOMMUNIKERET TIL KUNDEN:
- Behandlingstid 2-5 hverdage (besked 2)
- Returnpolitik-link (besked 1)

ÅBNE PUNKTER: ingen
```

**Regel til AI:** "Du MÅ IKKE gentage information fra 'Allerede kommunikeret'. Henvis til det i stedet."

---

### Søjle 3: Conversation Summarization

**Problem:** Lange tråde truncates hårdt ved MAX_CONTEXT_TOKENS=8000 — vigtige ældre beskeder forsvinder.

**Løsning:** Erstat hård truncation med to-lags historik:

```
SAMTALEOVERSIGT (kondenseret):
Besked 1 (22. apr): Kunde spurgte om returstatus for ordre #1234 (headset)
Besked 2 (23. apr): Vi bekræftede modtagelse og informerede om policy + fradrag
Besked 3 (24. apr): Kunde spurgte hvornår pengene er på kontoen

SENESTE BESKEDER (fuld tekst):
[Besked 3 — fuld tekst]
[Besked 4 — fuld tekst]
```

**Implementering:**
- Kondensering sker via letvægts LLM-kald (gpt-4o-mini, ~100 tokens output) efter besked 3+ i tråden
- Gemmes i `mail_threads.conversation_summary` (ny tekstkolonne) og opdateres ved hver ny besked
- Fuld tekst bevares for de 3 seneste beskeder altid
- Thread State supplerer summaryen med faktuelle ankerpunkter

---

## Inquiry Type Matrix

For hver henvendelsestype: hvad skal AI'en have adgang til, og hvad er succeskriteriet.

### 1. Refund / Penge tilbage
**AI skal have:**
- Shopify `refunds[]` med beløb, dato, fradrag, note
- Betalingsgateway + forventet behandlingstid (fra shop-konfiguration eller Shopify-data)
- Thread State: om refund allerede er kommunikeret

**Succes:** Præcist beløb, præcis dato, klar forklaring på eventuelle fradrag — ingen generiske estimater.

Behandlingstid er altid typisk 2-5 hverdage (standard bank-behandlingstid, ikke konfigurerbar). Det afgørende er at AI'en kender `transactions[].processed_at`-datoen fra Shopify, så den kan beregne en konkret forventningsdato fremfor at sige "op til 14 dage".

**Succes-eksempel:**
> "Refunderingen på 349 DKK er godkendt og behandlet den 27. april. Det tager typisk 2-5 hverdage — du kan forvente dem på din konto senest den 2. maj."

---

### 2. Retur-initiering
**AI skal have:**
- Return settings (adresse, window, shipping mode, label method, item condition)
- Shopify ordre-status + fulfillment-dato (til at tjekke om inden for window)
- Om kunden har sendt retur allerede (thread state)

**Succes:** Præcise instruktioner matchende shop's returnpolitik — aldrig opfundet proces

---

### 3. Tracking / Levering
**AI skal have:**
- Shopify fulfillments + tracking numbers/URLs
- Webshipper tracking (status, events, pickup point)
- Estimeret leveringsdato hvis tilgængelig

**Succes:** Præcis carrier, trackingnummer som klikbart link, seneste status-event — ikke bare "din pakke er på vej"

---

### 4. Ordreændring (adresse, varer, leveringsmetode)
**AI skal have:**
- Fulfillment-status (er ordren allerede pakket/sendt?)
- Automation flags (må vi faktisk ændre?)
- Thread State: er ændring allerede foretaget?

**Succes:** Klar besked om det er muligt + hvad vi gør (eller klart afslag med forklaring)

---

### 5. Annullering
**AI skal have:**
- Fulfillment-status
- Financial status (allerede betalt? refund nødvendig?)
- Automation flags

**Succes:** Bekræfter annullering hvis mulig, eller forklarer præcist hvorfor ikke

---

### 6. Produktspørgsmål (størrelse, kompatibilitet, specs)
**AI skal have:**
- Knowledge base (produktbeskrivelser, FAQ, størrelsesguide)
- Shopify product data (varianter, tilgængelighed)

**Succes:** Konkret svar baseret på knowledge — aldrig "du kan se mere på vores hjemmeside"

---

### 7. Reklamation / Defekt produkt
**AI skal have:**
- Warranty policy (fra knowledge base)
- Ordre-data (hvornår købt, hvilket produkt)
- Exchange/return settings

**Succes:** Klart næste skridt (ombytning, retur, billede-dokumentation) matchende policy

---

### 8. Teknisk support / Troubleshooting
**AI skal have:**
- Produktspecifik knowledge (troubleshooting-guides, FAQ)
- Thread State: hvilke trin er allerede forsøgt

**Succes:** Relevante troubleshooting-trin baseret på knowledge, aldrig gentagelse af allerede forsøgte løsninger

---

### 9. Betaling / Faktura
**AI skal have:**
- Shopify financial data (betalingsmetode, beløb, transaktioner)
- Eventuelle refunds

**Succes:** Præcist svar på hvad der er betalt/trukket og hvornår

---

### 10. Generelle spørgsmål (åbningstider, politikker, kontakt)
**AI skal have:**
- Shop FAQ i knowledge base
- Pinned policies fra shops-tabel

**Succes:** Direkte svar fra knowledge — eskalér aldrig unødigt

---

## Shop Konfigurationsmodel

Hvad en shop SKAL konfigurere for gode svar:

| Felt | Hvor | Vigtighed |
|---|---|---|
| Tone / persona | shops.tone_instructions | Kritisk |
| Returnpolitik (window, adresse, shipping mode) | return_settings | Kritisk |
| Betalingsgateway-navn (til kundevenlig tekst) | shops.payment_gateway | Medium |
| Knowledge base (FAQ, produktguides, troubleshooting) | agent_knowledge | Høj |
| Automatiske actions (on/off) | agent_automation | Valgfri |

Hvad der har gode defaults:
- Sprogdetektering (automatisk)
- Inquiry routing (automatisk)
- Actions (default: manuel godkendelse)
- Max svar-længde (300-400 ord)

**Nyt felt:** `shops.refund_processing_days` — antal hverdage fra refund behandlet til pengene er på kundens konto (bruges til at beregne konkret dato fremfor generisk "op til 14 dage").

---

## Prompt Arkitektur (ny rækkefølge)

Prompten bygges i denne faste rækkefølge med klare overskrifter:

```
[SYSTEM ROLE + PERSONA]
Du er support-assistent for {shop_name}. {tone_instructions}

[ABSOLUT REGLER]
- Svar altid på {language}
- Brug kun fakta fra konteksten nedenfor — aldrig gæt
- Gentag ikke information fra "ALLEREDE KOMMUNIKERET"

[ORDRE KONTEKST]
{enriched_order_context}

[ETABLEREDE FAKTA I SAG]
{thread_state.established_facts}

[ALLEREDE KOMMUNIKERET]
{thread_state.commitments_made}

[ÅBNE PUNKTER]
{thread_state.open_items}

[RELEVANT VIDEN]
{knowledge_chunks}

[RETURNPOLITIK]
{pinned_policy}

[SAMTALEOVERSIGT]
{conversation_summary}

[SENESTE BESKEDER]
{last_3_messages_full_text}

[WORKFLOW REGLER]
{workflow_specific_rules}

[OPGAVE]
Skriv et svar til kundens seneste besked. Vær specifik og konkret.
```

---

## Database Migrations

### 1. `mail_threads.agent_state` (JSONB)
```sql
ALTER TABLE mail_threads 
ADD COLUMN agent_state JSONB DEFAULT '{}';

CREATE INDEX idx_mail_threads_agent_state 
ON mail_threads USING GIN (agent_state);
```

### 2. `mail_threads.conversation_summary` (TEXT)
```sql
ALTER TABLE mail_threads 
ADD COLUMN conversation_summary TEXT;
```

---

## Hvad vi IKKE gør (scope boundary)

- Ingen automatisk synkronisering af Shopify-policies til knowledge base (manuelt)
- Ingen ML-baseret intent-forbedring (eksisterende case assessment bevares)
- Ingen ændring af action-execution pipeline
- Ingen ny UI til thread state (debug-view i agent_logs er nok)
- Ingen per-shop similarity-thresholds (global default bevares)

---

## Succeskriterier

1. Refund-svar inkluderer altid præcist beløb, eventuelle fradrag og beregnet forventningsdato
2. Svar i tråd nr. 5+ gentager ikke information fra tidligere svar
3. Troubleshooting-svar foreslår aldrig trin kunden allerede har prøvet (per thread state)
4. En ny shop med konfigureret persona + return settings + 10 knowledge-artikler får acceptable svar på 80%+ af henvendelser

---

## Implementeringsrækkefølge

1. **Enriched Order Context** — størst immediate impact, ingen DB-migration
2. **Thread State** — DB-migration + update-logik + prompt-integration
4. **Conversation Summarization** — bygger ovenpå thread state
5. **Prompt omstrukturering** — samler det hele
