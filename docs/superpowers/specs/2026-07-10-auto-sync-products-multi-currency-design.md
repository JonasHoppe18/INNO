# Auto-sync produkter + korrekt valuta pr. kunde

**Dato:** 2026-07-10
**Status:** Godkendt design — klar til implementeringsplan

## Problem

To sammenhængende mangler i produkt-/prisdata:

1. **Manuel sync.** Webshoppen skal trykke "Sync products" i Knowledge-UI'et hver gang de ændrer noget i Shopify (opretter et produkt, ændrer pris osv.). Nye produkter kommer ikke ind i Sona automatisk.
2. **Forkert valuta.** AceZones base-valuta i Shopify er **EUR**, og Admin `/products.json` returnerer kun base-valutaen. Sona citerer derfor EUR-tal (eller fejl-labeler dem som "kr"), selvom en dansk kunde forventer DKK. Storefronten viser rene DKK-priser (A-Blaze €199 = **1.499 kr**, ikke en FX-omregning ≈ 1.484), hvilket viser at shoppen har et **DKK-marked med egne rundede priser i Shopify Markets**.

Målet er at (a) produkter synkes automatisk ved ændringer i Shopify, og (b) Sona citerer prisen i kundens valuta — DKK til danske kunder, EUR til eurozone-kunder — når henvendelsen handler om pris.

## Beslutninger (afklaret med bruger)

- **Prisvaluta-kilde:** Shopify Markets presentment-priser (de faktiske rundede priser shoppen selv har sat), IKKE FX-omregning. Forudsætter at shoppen har det pågældende marked konfigureret; ellers graceful fallback.
- **Valuta uden ordre (førkøb):** Udled fra kundens sprog (dansk → DKK), fallback til shoppens primær-marked. Ved tilknyttet ordre bruges ordrens faktiske valuta (findes allerede i fact-resolver).
- **Pris-lokalisering:** Struktureret vej — writeren ser kun den korrekte valuta (ikke "begge priser + direktiv"), for at undgå at writeren citerer forkert valuta.

## Eksisterende infrastruktur (genbruges)

- `supabase/functions/shopify-connect/index.ts` → `registerShopUpdateWebhook()` registrerer allerede en `shop/update`-webhook mod `${APP_URL}/api/webhooks/shopify` (create + 422-fallback-update-mønster).
- `apps/web/app/api/webhooks/shopify/route.ts` → HMAC-verificeret webhook-handler der dispatcher på `x-shopify-topic`, slår shop op på domæne, returnerer altid 200 til Shopify.
- `apps/web/app/api/knowledge/sync-products/route.js` → bulk-sync: REST `/products.json` → `mapShopifyProductToNormalizedProduct` → `buildProductContext` → embed → upsert `shop_products` + `agent_knowledge`.
- `apps/web/lib/server/commerce/normalize-product.ts` → normalisering; `toShopProductRow` med `price_amount`, `currency`, `min_price`, `max_price`, `is_placeholder_price`.
- GraphQL Admin API bruges allerede (`shopify-orders`, `order-updates/accept`, `automation-actions`) — præcedens for presentment-query.
- `generate-draft-v2/stages/fact-resolver.ts` → resolver allerede ordrens `currency` (presentment) og kundens forsendelsesland for ordre-tilknyttede sager.

## Arkitektur

### Del A — Auto-sync via webhooks

1. **Registrering.** Generaliser webhook-registreringen i `shopify-connect` fra én topic til en liste: `shop/update`, `products/create`, `products/update`, `products/delete`. Samme idempotente create + 422-list-update-mønster pr. topic.
2. **Selv-healing for eksisterende shops.** Allerede-forbundne shops (AceZone) har ikke de nye webhooks. `sync-products`-ruten kalder samme registrerings-funktion (idempotent, 422-safe), så næste manuelle "Sync products" registrerer de manglende topics. Derefter er sync automatisk.
3. **Handler-dispatch.** Udvid `/api/webhooks/shopify/route.ts`:
   - `products/create`, `products/update` → hent presentment-priser for produktet + upsert ét produkt.
   - `products/delete` → fjern `shop_products`-rækken + tilhørende `agent_knowledge`-chunk (no-op hvis ukendt).
   - Ukendte topics → 200 + ignoreret (findes).
4. **Delt per-produkt-modul (isolation).** Træk per-produkt-behandlingen ud af bulk-sync-ruten i et nyt modul, fx `apps/web/lib/server/commerce/sync-one-product.js`:
   - Input: normaliseret produkt + creds + serviceClient.
   - Ansvar: normalize → hent presentment-priser → `buildProductContext` → embed → upsert `shop_products` (inkl. `presentment_prices`) + `agent_knowledge`.
   - Bruges af både bulk-sync (loop) og webhook-handler (ét produkt).

### Del B — Presentment/multi-currency

1. **Schema.** Migration tilføjer `shop_products.presentment_prices jsonb` — map `{"EUR":"199.00","DKK":"1499.00"}` — samt `shops.primary_market_currency text` (shoppens primær-markedsvaluta, udfyldt fra Shopify Markets-kaldet under sync). Bruges som fallback-valuta i resolveren.
2. **Sync — presentment-fetch.** For hvert produkt ét GraphQL-kald (`productVariants(first:...) { presentmentPrices(first:10) { price { amount currencyCode } } }`) → alle aktive presentment-valutaer på én gang → aggregeres til produktets `presentment_prices`-map (primær-variantens priser, plus min/max hvis relevant). Fejl/manglende → tom map, base-pris beholdes.
3. **Draft-tid — valuta-resolver.** Nyt isoleret modul `resolveCustomerCurrency(context)`:
   - Ordre tilknyttet → ordrens valuta (fra fact-resolver).
   - Ellers → udled fra kundens sprog (dansk → DKK; sprog→marked-map).
   - Fallback → `shops.primary_market_currency`; hvis ukendt → base-valuta.
4. **Pris-lokalisering.** Efter retrieval matches hver produkt-chunk til sin `shop_products`-række (via `handle`/produkt-id i chunk-metadata). Prislinjen i det context der gives til writeren omskrives til den resolvede valuta fra `presentment_prices`-map'en, og writeren får et direktiv "Angiv priser i <valuta>". Mangler valutaen i map'en → base-pris med korrekt label. Writeren ser dermed kun én, korrekt valuta.

## Data flow

```
Shopify-ændring
   │  (webhook: products/create|update|delete)
   ▼
/api/webhooks/shopify  ──►  sync-one-product  ──►  shop_products.presentment_prices
   │                                              └►  agent_knowledge (base-label chunk)
   ▼
(manuel "Sync products" gør det samme i bulk + re-registrerer webhooks)

Indgående kundemail → generate-draft-v2
   │
   ├─ resolveCustomerCurrency()  (ordre-valuta > sprog > hjemmemarked)
   ├─ pris-lokalisering: chunk → shop_products → presentment_prices[valuta]
   ▼
writer citerer prisen i kundens valuta
```

## Fejlhåndtering

- GraphQL presentment-fetch fejler eller mangler den ønskede valuta → behold base-pris, korrekt label (aldrig blank eller forkert pris).
- Webhook HMAC-fejl → 401. Alt andet (ukendt shop, manglende token, sync-fejl) → 200 + struktureret log, så Shopify ikke retry'er i en storm.
- `products/delete` for ukendt produkt → no-op, 200.
- Valuta-resolver uden noget signal → shoppens primær-marked; hvis ukendt → base-valuta.

## Test

- **`sync-one-product`** (unit): normalize + presentment-map-aggregering + delete-sti.
- **`resolveCustomerCurrency`** (unit): prioritet ordre-valuta > sprog > hjemmemarked, plus fallbacks ved manglende signal.
- **Pris-lokalisering** (unit): chunk→produkt-match via handle, korrekt presentment-pris valgt, manglende valuta → base-fallback med label.
- **Webhook-dispatch** (unit/integration): topic-routing (create/update/delete), HMAC, altid-200-adfærd.

## Scope-afgrænsning (YAGNI)

- Ingen FX-konvertering — kun shoppens egne Markets-priser.
- Ingen ny UI; "Sync products"-knappen bevares (self-heal + fallback).
- Ingen GDPR/compliance-webhooks (ikke en public app store-app-kontekst her).
- Ingen ændring af RLS/tenancy-model; alt scopes på eksplicit `shop_id` som i dag.

## Åbne afhængigheder / risici

- Forudsætter at shoppen faktisk har mål-markedet (DKK) i Shopify Markets; ellers falder vi tilbage til base-valuta (accepteret).
- Presentment-fetch tilføjer ét GraphQL-kald pr. produkt i sync — acceptabelt for AceZones katalog-størrelse; kan batches senere hvis kataloget vokser.
- Pris-lokaliseringen rører retrieval/context-laget (følsomt) — holdes i et isoleret, testbart modul og påvirker kun prislinjen i produkt-context.
