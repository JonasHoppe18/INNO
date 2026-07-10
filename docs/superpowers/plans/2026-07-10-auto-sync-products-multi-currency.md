# Auto-sync produkter + korrekt valuta pr. kunde — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produkter synkes automatisk til Sona ved ændringer i Shopify (webhooks), og drafts citerer priser i kundens valuta (DKK til danske kunder, EUR til eurozone) via Shopify Markets presentment-priser.

**Architecture:** Genbruger eksisterende webhook-infra (`shopify-connect` registrerer topics → `/api/webhooks/shopify` verificerer HMAC + dispatcher). Per-produkt-sync-logik ekstraheres til et delt modul brugt af både bulk-sync og webhook-handler. Presentment-priser hentes via GraphQL og gemmes i en `presentment_prices` JSONB-map på `shop_products`. Ved draft-tid resolves kundens valuta og en pris-direktiv-blok injiceres til writeren — samme mønster som de eksisterende `compatibilityBlock`/`comparisonBlock`.

**Tech Stack:** Next.js 14 route handlers (Node), Supabase Postgres (JSONB), Supabase Edge Functions (Deno), Shopify Admin REST + GraphQL, OpenAI embeddings. Tests: Deno (`deno test --no-check`), colocated `*.test.ts`.

## Global Constraints

- **Base-valuta ≠ presentment-valuta:** Admin `/products.json` returnerer KUN base-valuta. DKK/andre valutaer SKAL komme fra Shopify Markets (GraphQL `presentmentPrices`), aldrig FX-omregning.
- **Aldrig blank/forkert pris:** Mangler en presentment-valuta → fald tilbage til base-pris med korrekt label.
- **Webhooks svarer altid 200 til Shopify** (undtagen HMAC-fejl → 401), ellers retry-storme. HMAC verificeres mod `SHOPIFY_CLIENT_SECRET`.
- **Al knowledge scopes på eksplicit `shop_id`** — aldrig implicit scope.
- **Shopify API-version:** `process.env.SHOPIFY_API_VERSION || "2024-07"` (web) / `SHOPIFY_API_VERSION`-konstant (edge). Brug den eksisterende konstant, hardcode ikke.
- **Test-runner:** `deno test --no-check <fil>` for `*.test.ts` (både `apps/web/lib/**` og `supabase/functions/**`). Web route-integration køres ikke i CI — dæk logik i rene moduler.
- **Deploy:** `generate-draft-v2` og `shopify-connect` er edge functions (`supabase functions deploy <navn> --use-api`). `apps/web` deployes separat (droplet: git pull + npm build + pm2 restart). Web- og edge-ændringer skal kunne shippes uafhængigt.

---

### Task 1: DB-migration — presentment_prices + primary_market_currency

**Files:**
- Create: `supabase/migrations/20260710120000_product_presentment_prices.sql`

**Interfaces:**
- Produces: kolonne `shop_products.presentment_prices jsonb` (default `'{}'::jsonb`), kolonne `shops.primary_market_currency text` (nullable).

- [ ] **Step 1: Skriv migrationen**

```sql
-- Multi-currency support: store Shopify Markets presentment prices per product
-- and the shop's primary market currency for the draft-time currency resolver.

alter table public.shop_products
  add column if not exists presentment_prices jsonb not null default '{}'::jsonb;

comment on column public.shop_products.presentment_prices is
  'Map of presentment currency code -> primary-variant price string, e.g. {"EUR":"199.00","DKK":"1499.00"}. Populated from Shopify Markets via GraphQL. Empty when Markets is not configured.';

alter table public.shops
  add column if not exists primary_market_currency text;

comment on column public.shops.primary_market_currency is
  'The shop''s primary Shopify Market currency (e.g. "DKK"). Fallback currency for the draft-time currency resolver when there is no order and no language signal.';
```

- [ ] **Step 2: Verificér SQL-syntaks lokalt (dry parse)**

Run: `grep -c "add column if not exists" supabase/migrations/20260710120000_product_presentment_prices.sql`
Expected: `2`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260710120000_product_presentment_prices.sql
git commit -m "feat(db): add presentment_prices + primary_market_currency columns"
```

> **Deploy-note (ikke et kodeskridt):** Migrationen skal køres mod prod FØR web-koden der læser/skriver kolonnerne deployes (jf. lifecycle-incident: deploy aldrig kode der afhænger af en ukørt migration). Kør via Supabase MCP `apply_migration` eller `supabase db push`.

---

### Task 2: normalize-product — presentment_prices-plumbing

**Files:**
- Modify: `apps/web/lib/server/commerce/normalize-product.ts` (NormalizedProduct + ShopProductRow interfaces + `mapShopifyProductToNormalizedProduct` + `toShopProductRow`)
- Test: `apps/web/lib/server/commerce/normalize-product.test.ts`

**Interfaces:**
- Consumes: intet nyt.
- Produces: `NormalizedProduct.presentment_prices: Record<string,string>`; `ShopProductRow.presentment_prices: Record<string,string>`; `mapShopifyProductToNormalizedProduct(product, opts)` accepterer nu `opts.presentmentPrices?: Record<string,string>`; `toShopProductRow` mapper feltet igennem.

- [ ] **Step 1: Skriv den fejlende test**

Tilføj i `normalize-product.test.ts`:

```ts
Deno.test("mapShopifyProductToNormalizedProduct threads presentment prices through", () => {
  const n = mapShopifyProductToNormalizedProduct(
    { id: 1, title: "A-Blaze", variants: [{ price: "199.00" }] },
    { currency: "EUR", presentmentPrices: { EUR: "199.00", DKK: "1499.00" } },
  );
  assertEquals(n.presentment_prices, { EUR: "199.00", DKK: "1499.00" });
  const row = toShopProductRow(n, { shopRefId: "s1", syncedAt: "2026-07-10T00:00:00Z" });
  assertEquals(row.presentment_prices, { EUR: "199.00", DKK: "1499.00" });
});

Deno.test("presentment prices default to empty object when not provided", () => {
  const n = mapShopifyProductToNormalizedProduct(
    { id: 1, title: "X", variants: [{ price: "10.00" }] },
    { currency: "EUR" },
  );
  assertEquals(n.presentment_prices, {});
});
```

- [ ] **Step 2: Kør testen — verificér den fejler**

Run: `deno test --no-check apps/web/lib/server/commerce/normalize-product.test.ts`
Expected: FAIL (`presentment_prices` findes ikke på output).

- [ ] **Step 3: Tilføj feltet til interfaces**

I `NormalizedProduct` (efter `is_placeholder_price: boolean;` linje 42):

```ts
  is_placeholder_price: boolean;
  presentment_prices: Record<string, string>;
```

I `ShopProductRow` (efter `is_placeholder_price: boolean;` linje 69):

```ts
  is_placeholder_price: boolean;
  presentment_prices: Record<string, string>;
```

- [ ] **Step 4: Sæt feltet i `mapShopifyProductToNormalizedProduct` og `toShopProductRow`**

I `mapShopifyProductToNormalizedProduct`s returnerede objekt, tilføj (ved siden af `currency: opts.currency ?? null`):

```ts
    presentment_prices:
      opts.presentmentPrices && typeof opts.presentmentPrices === "object"
        ? opts.presentmentPrices
        : {},
```

Udvid `opts`-typen på funktionen med `presentmentPrices?: Record<string, string>`.

I `toShopProductRow`s returnerede row, tilføj (ved siden af `currency: normalized.currency`):

```ts
    presentment_prices: normalized.presentment_prices ?? {},
```

- [ ] **Step 5: Kør testen — verificér den passerer**

Run: `deno test --no-check apps/web/lib/server/commerce/normalize-product.test.ts`
Expected: PASS (alle tests, inkl. de to nye).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/server/commerce/normalize-product.ts apps/web/lib/server/commerce/normalize-product.test.ts
git commit -m "feat(commerce): thread presentment_prices through normalizer + row"
```

---

### Task 3: GraphQL presentment-price + primær-marked-fetcher

**Files:**
- Create: `apps/web/lib/server/commerce/shopify-presentment.ts`
- Test: `apps/web/lib/server/commerce/shopify-presentment.test.ts`

**Interfaces:**
- Produces:
  - `parsePresentmentPrices(graphqlJson: unknown): Record<string,string>` — ren parser der uddrager primær-variantens presentment-priser fra et Shopify GraphQL-svar til en `{ CUR: "amount" }`-map.
  - `async fetchPresentmentPrices(args: { domain: string; accessToken: string; productId: string; apiVersion: string }): Promise<Record<string,string>>` — kalder GraphQL, returnerer map (tom ved fejl).
  - `async fetchPrimaryMarketCurrency(args: { domain: string; accessToken: string; apiVersion: string }): Promise<string | null>` — henter shoppens primær-markedsvaluta (tom → null).

- [ ] **Step 1: Skriv den fejlende test (ren parser)**

`shopify-presentment.test.ts`:

```ts
// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import { parsePresentmentPrices } from "./shopify-presentment.ts";

Deno.test("parsePresentmentPrices maps currency code to amount from first variant", () => {
  const json = {
    data: {
      product: {
        variants: {
          edges: [
            {
              node: {
                presentmentPrices: {
                  edges: [
                    { node: { price: { amount: "199.00", currencyCode: "EUR" } } },
                    { node: { price: { amount: "1499.00", currencyCode: "DKK" } } },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  };
  assertEquals(parsePresentmentPrices(json), { EUR: "199.00", DKK: "1499.00" });
});

Deno.test("parsePresentmentPrices returns empty object on malformed input", () => {
  assertEquals(parsePresentmentPrices(null), {});
  assertEquals(parsePresentmentPrices({ data: {} }), {});
});
```

- [ ] **Step 2: Kør testen — verificér den fejler**

Run: `deno test --no-check apps/web/lib/server/commerce/shopify-presentment.test.ts`
Expected: FAIL (modul findes ikke).

- [ ] **Step 3: Implementér modulet**

```ts
// Shopify Markets presentment-price fetcher. Admin REST returns only the base
// currency; the shop's per-market (e.g. DKK) prices live behind GraphQL. We
// read the FIRST variant's presentment prices as the product's price map.

/** Extract { currencyCode: amount } from a Shopify GraphQL product response. */
export function parsePresentmentPrices(graphqlJson: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const product = (graphqlJson as any)?.data?.product;
  const firstVariant = product?.variants?.edges?.[0]?.node;
  const edges = firstVariant?.presentmentPrices?.edges;
  if (!Array.isArray(edges)) return out;
  for (const edge of edges) {
    const price = edge?.node?.price;
    const code = String(price?.currencyCode ?? "").trim().toUpperCase();
    const amount = String(price?.amount ?? "").trim();
    if (code && amount) out[code] = amount;
  }
  return out;
}

export async function fetchPresentmentPrices(args: {
  domain: string;
  accessToken: string;
  productId: string;
  apiVersion: string;
}): Promise<Record<string, string>> {
  const { domain, accessToken, productId, apiVersion } = args;
  const numericId = String(productId).replace(/\D/g, "");
  if (!numericId) return {};
  const query = `query {
    product(id: "gid://shopify/Product/${numericId}") {
      variants(first: 1) {
        edges { node { presentmentPrices(first: 20) {
          edges { node { price { amount currencyCode } } }
        } } }
      }
    }
  }`;
  try {
    const res = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return {};
    const json = await res.json().catch(() => null);
    return parsePresentmentPrices(json);
  } catch {
    return {};
  }
}

export async function fetchPrimaryMarketCurrency(args: {
  domain: string;
  accessToken: string;
  apiVersion: string;
}): Promise<string | null> {
  const { domain, accessToken, apiVersion } = args;
  const query = `query { markets(first: 20) { edges { node {
    primary
    currencySettings { baseCurrency { currencyCode } }
  } } } }`;
  try {
    const res = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const edges = (json as any)?.data?.markets?.edges ?? [];
    const primary = edges.find((e: any) => e?.node?.primary)?.node
      ?? edges[0]?.node;
    const code = primary?.currencySettings?.baseCurrency?.currencyCode;
    return code ? String(code).trim().toUpperCase() : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Kør testen — verificér den passerer**

Run: `deno test --no-check apps/web/lib/server/commerce/shopify-presentment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/commerce/shopify-presentment.ts apps/web/lib/server/commerce/shopify-presentment.test.ts
git commit -m "feat(commerce): Shopify Markets presentment-price + primary-market fetcher"
```

---

### Task 4: Ekstrahér delt per-produkt-sync-modul

**Files:**
- Create: `apps/web/lib/server/commerce/sync-one-product.js`
- Test: `apps/web/lib/server/commerce/sync-one-product.test.ts`
- Modify: `apps/web/app/api/knowledge/sync-products/route.js` (importér de ekstraherede rene funktioner + kald orchestrator i loop)

**Interfaces:**
- Consumes: `mapShopifyProductToNormalizedProduct`, `toShopProductRow` (Task 2); `fetchPresentmentPrices` (Task 3).
- Produces:
  - `stripHtml(v)`, `buildProductContext(product, { currency })`, `chunkText(text, size?, overlap?)`, `buildKnowledgeHash(product, context)` — rene funktioner, flyttet fra route.
  - `async upsertProductKnowledge({ serviceClient, creds, product, currency, presentmentPrices, embedText })` — sletter tidligere chunks for produktet og indsætter nye (ét produkt). Returnerer `{ indexed: boolean }`.

- [ ] **Step 1: Skriv den fejlende test (rene funktioner)**

`sync-one-product.test.ts`:

```ts
// @ts-nocheck
import { assertEquals, assert } from "jsr:@std/assert@1";
import { buildProductContext, chunkText, stripHtml } from "./sync-one-product.js";

Deno.test("buildProductContext labels prices with currency", () => {
  const ctx = buildProductContext(
    { title: "A-Blaze", variants: [{ title: "Default", price: "199.00" }] },
    { currency: "EUR" },
  );
  assert(ctx.includes("Price: EUR 199.00"));
  assert(ctx.includes("Product: A-Blaze"));
});

Deno.test("stripHtml removes tags and collapses whitespace", () => {
  assertEquals(stripHtml("<p>Hej   <b>der</b></p>"), "Hej der");
});

Deno.test("chunkText returns empty for blank input", () => {
  assertEquals(chunkText(""), []);
});
```

- [ ] **Step 2: Kør testen — verificér den fejler**

Run: `deno test --no-check apps/web/lib/server/commerce/sync-one-product.test.ts`
Expected: FAIL (modul findes ikke).

- [ ] **Step 3: Opret modulet med de flyttede rene funktioner + orchestrator**

Flyt `stripHtml`, `buildProductContext`, `chunkText`, `buildKnowledgeHash` VERBATIM fra `sync-products/route.js` (linje 27-38, 155-227) ind i `sync-one-product.js` og `export` dem. Tilføj orchestratoren:

```js
import { createHash } from "node:crypto";

// ... (stripHtml, buildProductContext, chunkText, buildKnowledgeHash — flyttet fra route, eksporteret)

/**
 * Sync ONE product's knowledge chunks. Deletes prior chunks for the product
 * then inserts fresh embedded chunks. Shared by the bulk sync route and the
 * Shopify product webhook. `embedText` is injected so callers control the
 * OpenAI dependency (and tests can stub it).
 */
export async function upsertProductKnowledge({
  serviceClient,
  creds,
  product,
  currency,
  embedText,
}) {
  const productId = String(product?.id ?? "").trim();
  if (!productId) return { indexed: false };

  const context = buildProductContext(product, { currency });
  const chunks = chunkText(context);
  if (!chunks.length) return { indexed: false };

  await serviceClient
    .from("agent_knowledge")
    .delete()
    .eq("shop_id", creds.shop_id)
    .eq("source_provider", "shopify_product")
    .eq("metadata->>product_id", productId);

  const contentHash = buildKnowledgeHash(product, context);
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const embedding = await embedText(chunk);
    const { error } = await serviceClient.from("agent_knowledge").insert({
      workspace_id: creds.workspace_id,
      shop_id: creds.shop_id,
      content: chunk,
      source_type: "document",
      source_provider: "shopify_product",
      metadata: {
        product_id: productId,
        title: String(product?.title || "").trim(),
        currency: currency || null,
        content_hash: contentHash,
        chunk_index: chunkIndex,
        chunk_count: chunks.length,
        issue_types: ["product_specs"],
      },
      embedding,
    });
    if (error) throw new Error(error.message);
  }
  return { indexed: true };
}
```

- [ ] **Step 4: Skriv fake-client-test for orchestratoren**

Tilføj i `sync-one-product.test.ts`:

```ts
import { upsertProductKnowledge } from "./sync-one-product.js";

function fakeClient(calls) {
  return {
    from(table) {
      return {
        delete() { return this; },
        eq() { return this; },
        insert(row) { calls.push({ table, row }); return { error: null }; },
      };
    },
  };
}

Deno.test("upsertProductKnowledge inserts chunks with product_id metadata", async () => {
  const calls = [];
  const res = await upsertProductKnowledge({
    serviceClient: fakeClient(calls),
    creds: { shop_id: "s1", workspace_id: "w1" },
    product: { id: 42, title: "A-Blaze", variants: [{ price: "199.00" }] },
    currency: "EUR",
    embedText: async () => [0.1, 0.2],
  });
  assertEquals(res.indexed, true);
  assert(calls.length >= 1);
  assertEquals(calls[0].row.metadata.product_id, "42");
  assertEquals(calls[0].row.metadata.currency, "EUR");
});
```

- [ ] **Step 5: Kør testen — verificér alt passerer**

Run: `deno test --no-check apps/web/lib/server/commerce/sync-one-product.test.ts`
Expected: PASS.

- [ ] **Step 6: Opdatér bulk-route til at bruge de delte funktioner**

I `sync-products/route.js`: slet de nu-flyttede lokale definitioner af `stripHtml`, `buildProductContext`, `chunkText`, `buildKnowledgeHash`, og importér i stedet:

```js
import {
  buildProductContext,
  chunkText,
  buildKnowledgeHash,
  upsertProductKnowledge,
  stripHtml,
} from "@/lib/server/commerce/sync-one-product";
```

I `syncShopify`s loop, erstat den inline delete+chunk+insert-blok (linje 289-336) med et kald til orchestratoren (behold `unchanged`-hash-optimeringen ovenfor):

```js
    const previousHash = existingHashes.get(productId);
    if (previousHash && previousHash === contentHash) {
      unchanged += 1;
      continue;
    }
    const { indexed: didIndex } = await upsertProductKnowledge({
      serviceClient, creds, product, currency, embedText,
    });
    if (didIndex) indexed += 1; else unchanged += 1;
```

- [ ] **Step 7: Verificér route stadig parser**

Run: `node --check apps/web/app/api/knowledge/sync-products/route.js`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/server/commerce/sync-one-product.js apps/web/lib/server/commerce/sync-one-product.test.ts apps/web/app/api/knowledge/sync-products/route.js
git commit -m "refactor(commerce): extract shared per-product sync module"
```

---

### Task 5: Presentment + primær-marked + webhook-selfheal i bulk-sync

**Files:**
- Create: `apps/web/lib/server/commerce/shopify-webhooks.js`
- Test: `apps/web/lib/server/commerce/shopify-webhooks.test.ts`
- Modify: `apps/web/app/api/knowledge/sync-products/route.js` (`syncShopify`: hent presentment-priser pr. produkt + primær-marked, kald webhook-registrering)

**Interfaces:**
- Consumes: `fetchPresentmentPrices`, `fetchPrimaryMarketCurrency` (Task 3).
- Produces:
  - `PRODUCT_WEBHOOK_TOPICS: string[]` = `["products/create","products/update","products/delete"]`.
  - `async ensureShopifyWebhooks({ domain, accessToken, apiVersion, appUrl, topics }): Promise<void>` — idempotent (create; 422 → list + update-adresse), fejler aldrig hårdt.

- [ ] **Step 1: Skriv den fejlende test**

`shopify-webhooks.test.ts`:

```ts
// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import { PRODUCT_WEBHOOK_TOPICS, ensureShopifyWebhooks } from "./shopify-webhooks.js";

Deno.test("PRODUCT_WEBHOOK_TOPICS covers create/update/delete", () => {
  assertEquals(PRODUCT_WEBHOOK_TOPICS, [
    "products/create", "products/update", "products/delete",
  ]);
});

Deno.test("ensureShopifyWebhooks POSTs one create per topic", async () => {
  const posted = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posted.push(JSON.parse(init.body).webhook.topic);
    return { ok: true, status: 201, json: async () => ({}) };
  };
  try {
    await ensureShopifyWebhooks({
      domain: "x.myshopify.com", accessToken: "t", apiVersion: "2024-07",
      appUrl: "https://app.example.com", topics: ["products/create", "products/delete"],
    });
  } finally { globalThis.fetch = origFetch; }
  assertEquals(posted, ["products/create", "products/delete"]);
});
```

- [ ] **Step 2: Kør testen — verificér den fejler**

Run: `deno test --no-check apps/web/lib/server/commerce/shopify-webhooks.test.ts`
Expected: FAIL (modul findes ikke).

- [ ] **Step 3: Implementér registrerings-modulet**

Port `registerShopUpdateWebhook`-mønsteret fra `shopify-connect/index.ts` (create → 422 list+update) til Node, parameteriseret på topic-liste:

```js
export const PRODUCT_WEBHOOK_TOPICS = [
  "products/create", "products/update", "products/delete",
];

async function ensureOneWebhook({ apiBase, headers, topic, address }) {
  const createRes = await fetch(`${apiBase}/webhooks.json`, {
    method: "POST", headers,
    body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
  });
  if (createRes.ok || createRes.status === 201) return;
  if (createRes.status !== 422) return; // best-effort: log-less skip on other errors
  const listRes = await fetch(`${apiBase}/webhooks.json?topic=${encodeURIComponent(topic)}`, { headers });
  if (!listRes.ok) return;
  const listData = await listRes.json().catch(() => null);
  const existing = (listData?.webhooks ?? []).find((w) => w.topic === topic);
  if (!existing || existing.address === address) return;
  await fetch(`${apiBase}/webhooks/${existing.id}.json`, {
    method: "PUT", headers,
    body: JSON.stringify({ webhook: { address } }),
  });
}

export async function ensureShopifyWebhooks({ domain, accessToken, apiVersion, appUrl, topics }) {
  if (!appUrl) return;
  const apiBase = `https://${domain}/admin/api/${apiVersion}`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };
  const address = `${appUrl.replace(/\/$/, "")}/api/webhooks/shopify`;
  for (const topic of topics) {
    try { await ensureOneWebhook({ apiBase, headers, topic, address }); }
    catch (_e) { /* non-fatal */ }
  }
}
```

- [ ] **Step 4: Kør testen — verificér den passerer**

Run: `deno test --no-check apps/web/lib/server/commerce/shopify-webhooks.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire presentment + primær-marked + selfheal ind i `syncShopify`**

I `sync-products/route.js`, tilføj imports:

```js
import { fetchPresentmentPrices, fetchPrimaryMarketCurrency } from "@/lib/server/commerce/shopify-presentment";
import { ensureShopifyWebhooks, PRODUCT_WEBHOOK_TOPICS } from "@/lib/server/commerce/shopify-webhooks";
```

I `syncShopify` (efter `const currency = await fetchShopCurrency(...)`, linje 251):

```js
  const primaryMarketCurrency = await fetchPrimaryMarketCurrency({
    domain, accessToken: creds.access_token, apiVersion: SHOPIFY_API_VERSION,
  });
```

I produkt-loopet, efter `normalized` bygges, hent presentment-priser og læg dem på normalized inden `toShopProductRow`:

```js
    const presentmentPrices = await fetchPresentmentPrices({
      domain, accessToken: creds.access_token, productId, apiVersion: SHOPIFY_API_VERSION,
    });
    const normalized = mapShopifyProductToNormalizedProduct(product, {
      publicStorefrontDomain: creds.public_storefront_domain,
      currency,
      presentmentPrices,
    });
```

Efter loopet (og efter `updateShopProductOverview`), persistér primær-marked + registrér webhooks (self-heal):

```js
  if (primaryMarketCurrency) {
    await serviceClient.from("shops")
      .update({ primary_market_currency: primaryMarketCurrency })
      .eq("id", creds.shop_id);
  }
  await ensureShopifyWebhooks({
    domain, accessToken: creds.access_token, apiVersion: SHOPIFY_API_VERSION,
    appUrl: (process.env.APP_URL || "").trim(), topics: PRODUCT_WEBHOOK_TOPICS,
  });
```

- [ ] **Step 6: Verificér route parser**

Run: `node --check apps/web/app/api/knowledge/sync-products/route.js`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/server/commerce/shopify-webhooks.js apps/web/lib/server/commerce/shopify-webhooks.test.ts apps/web/app/api/knowledge/sync-products/route.js
git commit -m "feat(sync): fetch presentment prices + primary market, self-heal product webhooks"
```

---

### Task 6: Generalisér webhook-registrering i edge `shopify-connect`

**Files:**
- Modify: `supabase/functions/shopify-connect/index.ts` (`registerShopUpdateWebhook` → registrér også produkt-topics)

**Interfaces:**
- Consumes: intet nyt.
- Produces: nye shops får `shop/update` + `products/create|update|delete` registreret ved connect.

- [ ] **Step 1: Generalisér funktionen til en topic-liste**

Omdøb `registerShopUpdateWebhook` → `registerShopifyWebhooks` og loop over topics. Behold create → 422 list+update-logikken, men kør den pr. topic:

```ts
const WEBHOOK_TOPICS = [
  "shop/update", "products/create", "products/update", "products/delete",
];

async function registerShopifyWebhooks(domain: string, accessToken: string): Promise<void> {
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  if (!appUrl) {
    console.warn("[webhook] APP_URL ikke sat — springer webhook-registrering over");
    return;
  }
  const webhookAddress = `${appUrl}/api/webhooks/shopify`;
  const apiBase = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  };
  for (const topic of WEBHOOK_TOPICS) {
    try {
      const createRes = await fetch(`${apiBase}/webhooks.json`, {
        method: "POST", headers,
        body: JSON.stringify({ webhook: { topic, address: webhookAddress, format: "json" } }),
      });
      if (createRes.ok || createRes.status === 201) continue;
      if (createRes.status !== 422) {
        console.warn(`[webhook] kunne ikke registrere ${topic}: ${createRes.status}`);
        continue;
      }
      const listRes = await fetch(`${apiBase}/webhooks.json?topic=${encodeURIComponent(topic)}`, { headers });
      if (!listRes.ok) continue;
      const listData = await listRes.json().catch(() => null) as any;
      const existing = (listData?.webhooks ?? []).find((w: any) => w.topic === topic);
      if (!existing || existing.address === webhookAddress) continue;
      await fetch(`${apiBase}/webhooks/${existing.id}.json`, {
        method: "PUT", headers,
        body: JSON.stringify({ webhook: { address: webhookAddress } }),
      });
    } catch (err) {
      console.warn(`[webhook] ${topic} fejlede:`, (err as any)?.message ?? err);
    }
  }
}
```

Opdatér kaldstedet (linje ~290): `registerShopUpdateWebhook(domain, accessToken)` → `registerShopifyWebhooks(domain, accessToken)`.

- [ ] **Step 2: Typecheck edge-funktionen**

Run: `deno check supabase/functions/shopify-connect/index.ts`
Expected: ingen fejl (eller kun præeksisterende ikke-relaterede).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/shopify-connect/index.ts
git commit -m "feat(shopify-connect): register product webhooks at connect time"
```

> **Deploy-note:** `supabase functions deploy shopify-connect --use-api`. Ikke kritisk for AceZone (self-heal i Task 5 dækker eksisterende shops); gavner nye shops.

---

### Task 7: Webhook-handler dispatch af produkt-topics

**Files:**
- Modify: `apps/web/app/api/webhooks/shopify/route.ts` (dispatch `products/create|update|delete` efter HMAC + shop-lookup)

**Interfaces:**
- Consumes: `upsertProductKnowledge` (Task 4), `fetchPresentmentPrices` (Task 3), `mapShopifyProductToNormalizedProduct`+`toShopProductRow` (Task 2), `credsFromShopRow` (findes i `shopify-policy-sync`).
- Produces: produkt-webhooks muterer `shop_products` + `agent_knowledge`.

- [ ] **Step 1: Tilføj produkt-topic-håndtering FØR `shop/update`-grenen**

I `route.ts`, efter HMAC-verificering + `serviceClient`-oprettelse, men behold at `shop/update` stadig virker. Erstat den tidlige `if (topic !== "shop/update")`-guard (linje 65-68) med en produkt-dispatch, og flyt shop-lookup op så begge grene deler den. Konkret — indsæt efter shop-lookup-blokken (efter linje 98, hvor `shopRow` er verificeret):

```ts
  const PRODUCT_TOPICS = new Set(["products/create", "products/update", "products/delete"]);
  if (PRODUCT_TOPICS.has(topic)) {
    try {
      const payload = JSON.parse(rawBody);
      const creds = credsFromShopRow(shopRow); // { shop_id, workspace_id, shop_domain, access_token }
      const productId = String(payload?.id ?? "").trim();
      if (!productId) return NextResponse.json({ ok: true, note: "no product id" });

      if (topic === "products/delete") {
        await serviceClient.from("agent_knowledge").delete()
          .eq("shop_id", creds.shop_id)
          .eq("source_provider", "shopify_product")
          .eq("metadata->>product_id", productId);
        await serviceClient.from("shop_products").delete()
          .eq("shop_ref_id", creds.shop_id)
          .eq("external_id", productId);
        return NextResponse.json({ ok: true, topic, product_id: productId, deleted: true });
      }

      // create/update: refetch presentment prices (webhook payload lacks them),
      // then upsert one product's knowledge + structured row.
      const domain = String(creds.shop_domain || shopDomain).replace(/^https?:\/\//, "");
      const currency = String(payload?.variants?.[0]?.price_currency || "").trim().toUpperCase() || null;
      const presentmentPrices = await fetchPresentmentPrices({
        domain, accessToken: creds.access_token, productId, apiVersion: SHOPIFY_API_VERSION,
      });
      await upsertProductKnowledge({
        serviceClient, creds, product: payload, currency, embedText,
      });
      const normalized = mapShopifyProductToNormalizedProduct(payload, { currency, presentmentPrices });
      const row = toShopProductRow(normalized, { shopRefId: creds.shop_id, syncedAt: new Date().toISOString() });
      const rowWithEmbedding = {
        ...row,
        embedding: await embedText(`Product: ${row.title}. Details: ${row.description || "No details."}`),
      };
      await serviceClient.from("shop_products").upsert(rowWithEmbedding, {
        onConflict: "shop_ref_id,external_id,platform",
      });
      return NextResponse.json({ ok: true, topic, product_id: productId, indexed: true });
    } catch (err) {
      console.error(JSON.stringify({ event: "shopify.webhook.product_error", topic, error: (err as Error)?.message }));
      return NextResponse.json({ ok: false, error: (err as Error)?.message }); // still 200
    }
  }

  if (topic !== "shop/update") {
    return NextResponse.json({ ok: true, topic, note: "ignored" });
  }
```

Add imports at top of `route.ts`:

```ts
import { upsertProductKnowledge } from "@/lib/server/commerce/sync-one-product";
import { fetchPresentmentPrices } from "@/lib/server/commerce/shopify-presentment";
import { mapShopifyProductToNormalizedProduct, toShopProductRow } from "@/lib/server/commerce/normalize-product";
```

Define local `embedText` + `SHOPIFY_API_VERSION` (mirror the sync route's constants + `embedText` helper — copy the `embedText` function and `SHOPIFY_API_VERSION`/`OPENAI_*` consts from `sync-products/route.js` lines 23-25, 132-153 into this file, or extract into `sync-one-product.js` and import; prefer importing `embedText` — add `export` to it in `sync-one-product.js` and its OpenAI env reads).

> **Sub-note:** To avoid duplicating `embedText`, add it as an exported helper in `sync-one-product.js` (it only needs `OPENAI_API_KEY`/`OPENAI_EMBEDDING_MODEL` from `process.env`) and import it in both the sync route and this webhook. Verify `credsFromShopRow` returns `shop_id`/`access_token`/`shop_domain`/`workspace_id`; if its field names differ, map them into the `creds` shape shown above.

- [ ] **Step 2: Verify credsFromShopRow shape**

Run: `grep -n "export function credsFromShopRow" -A 15 apps/web/lib/server/shopify-policy-sync.js`
Expected: shows returned fields. Map them into `{ shop_id, workspace_id, shop_domain, access_token }` at the call site (adjust names as needed — do NOT assume).

- [ ] **Step 3: Verificér route parser**

Run: `node --check apps/web/app/api/webhooks/shopify/route.ts 2>&1 || echo "check .ts via tsc in build"`
Expected: no syntax error (TS types resolved at build).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/webhooks/shopify/route.ts apps/web/lib/server/commerce/sync-one-product.js
git commit -m "feat(webhooks): auto-sync one product on Shopify products/* webhooks"
```

---

### Task 8: Draft-tid valuta-resolver

**Files:**
- Create: `supabase/functions/generate-draft-v2/stages/customer-currency.ts`
- Test: `supabase/functions/generate-draft-v2/stages/customer-currency.test.ts`

**Interfaces:**
- Produces: `resolveCustomerCurrency(input: { orderCurrency?: string | null; customerLanguage?: string | null; primaryMarketCurrency?: string | null; baseCurrency?: string | null }): string | null` — prioritet: ordre-valuta → sprog-map → primær-marked → base → null.

- [ ] **Step 1: Skriv den fejlende test**

`customer-currency.test.ts`:

```ts
// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import { resolveCustomerCurrency } from "./customer-currency.ts";

Deno.test("order currency wins over everything", () => {
  assertEquals(resolveCustomerCurrency({
    orderCurrency: "SEK", customerLanguage: "da", primaryMarketCurrency: "DKK", baseCurrency: "EUR",
  }), "SEK");
});

Deno.test("Danish language maps to DKK when no order", () => {
  assertEquals(resolveCustomerCurrency({
    customerLanguage: "da", primaryMarketCurrency: "DKK", baseCurrency: "EUR",
  }), "DKK");
});

Deno.test("falls back to primary market, then base", () => {
  assertEquals(resolveCustomerCurrency({ customerLanguage: "en", primaryMarketCurrency: "DKK" }), "DKK");
  assertEquals(resolveCustomerCurrency({ baseCurrency: "EUR" }), "EUR");
  assertEquals(resolveCustomerCurrency({}), null);
});
```

- [ ] **Step 2: Kør testen — verificér den fejler**

Run: `deno test --no-check supabase/functions/generate-draft-v2/stages/customer-currency.test.ts`
Expected: FAIL (modul findes ikke).

- [ ] **Step 3: Implementér resolveren**

```ts
// Draft-time currency resolution. We quote a price only in a currency we can
// justify: the customer's actual order currency first, then a language→market
// inference, then the shop's primary market, then base. Never invents an FX
// rate — the amount itself comes from Shopify Markets presentment prices.

const LANGUAGE_TO_CURRENCY: Record<string, string> = {
  da: "DKK", sv: "SEK", nb: "NOK", nn: "NOK", no: "NOK",
  de: "EUR", fr: "EUR", nl: "EUR", es: "EUR", it: "EUR", fi: "EUR",
  en: "", // ambiguous — do not infer a currency from English
};

function norm(v: string | null | undefined): string {
  return String(v ?? "").trim().toUpperCase();
}

export function resolveCustomerCurrency(input: {
  orderCurrency?: string | null;
  customerLanguage?: string | null;
  primaryMarketCurrency?: string | null;
  baseCurrency?: string | null;
}): string | null {
  const order = norm(input.orderCurrency);
  if (order) return order;

  const lang = String(input.customerLanguage ?? "").trim().toLowerCase().slice(0, 2);
  const fromLang = norm(LANGUAGE_TO_CURRENCY[lang]);
  if (fromLang) return fromLang;

  const market = norm(input.primaryMarketCurrency);
  if (market) return market;

  const base = norm(input.baseCurrency);
  return base || null;
}
```

- [ ] **Step 4: Kør testen — verificér den passerer**

Run: `deno test --no-check supabase/functions/generate-draft-v2/stages/customer-currency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-draft-v2/stages/customer-currency.ts supabase/functions/generate-draft-v2/stages/customer-currency.test.ts
git commit -m "feat(draft): customer currency resolver (order > language > market > base)"
```

---

### Task 9: Pris-lokaliserings-direktivblok

**Files:**
- Create: `supabase/functions/generate-draft-v2/stages/price-localization.ts`
- Test: `supabase/functions/generate-draft-v2/stages/price-localization.test.ts`

**Interfaces:**
- Consumes: `resolveCustomerCurrency` (Task 8).
- Produces:
  - `isPriceQuestion(text: string): boolean` — cheap cue (pris/koster/hvad koster/how much/price/cost).
  - `buildPriceLocalizationBlock(input: { text: string; currency: string | null; products: Array<{ title: string; presentment_prices: Record<string,string>; price: string | null; base_currency: string | null }> }): string` — returnerer et writer-direktiv der navngiver hvert relevant produkts pris i `currency` (fra `presentment_prices[currency]`), ellers base-pris med label. Tom streng hvis ikke et prisspørgsmål eller ingen produkter.

- [ ] **Step 1: Skriv den fejlende test**

`price-localization.test.ts`:

```ts
// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { isPriceQuestion, buildPriceLocalizationBlock } from "./price-localization.ts";

Deno.test("isPriceQuestion detects Danish + English price cues", () => {
  assert(isPriceQuestion("Hvad koster A-Blaze?"));
  assert(isPriceQuestion("what is the price of the headset"));
  assert(!isPriceQuestion("Hvornår er den på lager?"));
});

Deno.test("block quotes the resolved currency from presentment map", () => {
  const block = buildPriceLocalizationBlock({
    text: "Hvad koster A-Blaze?",
    currency: "DKK",
    products: [{ title: "A-Blaze", presentment_prices: { EUR: "199.00", DKK: "1499.00" }, price: "199.00", base_currency: "EUR" }],
  });
  assert(block.includes("DKK"));
  assert(block.includes("1499.00"));
  assert(!block.includes("199.00 EUR")); // must not quote the base when DKK exists
});

Deno.test("block falls back to base price + label when currency missing", () => {
  const block = buildPriceLocalizationBlock({
    text: "price of A-Blaze",
    currency: "SEK",
    products: [{ title: "A-Blaze", presentment_prices: { EUR: "199.00" }, price: "199.00", base_currency: "EUR" }],
  });
  assert(block.includes("EUR"));
  assert(block.includes("199.00"));
});

Deno.test("empty when not a price question", () => {
  assertEquals(buildPriceLocalizationBlock({ text: "Hej", currency: "DKK", products: [] }), "");
});
```

- [ ] **Step 2: Kør testen — verificér den fejler**

Run: `deno test --no-check supabase/functions/generate-draft-v2/stages/price-localization.test.ts`
Expected: FAIL (modul findes ikke).

- [ ] **Step 3: Implementér blokken**

```ts
// Injects a writer directive that states each relevant product's price in the
// customer's resolved currency, drawn from Shopify Markets presentment prices.
// Mirrors compatibilityBlock/comparisonBlock: detect → look up shop_products →
// build directive. The writer thus only ever sees ONE correct-currency price.

const PRICE_CUE_RE =
  /\b(pris|priser|koster|kostede|hvad\s+koster|hvor\s+meget|price|cost|how\s+much)\b/i;

export function isPriceQuestion(text: string): boolean {
  return PRICE_CUE_RE.test(String(text ?? ""));
}

export function buildPriceLocalizationBlock(input: {
  text: string;
  currency: string | null;
  products: Array<{
    title: string;
    presentment_prices: Record<string, string>;
    price: string | null;
    base_currency: string | null;
  }>;
}): string {
  if (!isPriceQuestion(input.text)) return "";
  const currency = String(input.currency ?? "").trim().toUpperCase();
  const named = input.products
    .filter((p) =>
      p.title && input.text.toLowerCase().includes(p.title.toLowerCase())
    )
    .map((p) => {
      const map = p.presentment_prices ?? {};
      if (currency && map[currency]) return `- ${p.title}: ${map[currency]} ${currency}`;
      const base = String(p.base_currency ?? "").trim().toUpperCase();
      if (p.price) return `- ${p.title}: ${p.price} ${base}`.trimEnd();
      return `- ${p.title}: pris ikke tilgængelig`;
    });
  if (!named.length) return "";
  const label = currency || (named.length ? "" : "");
  return [
    `PRISER — angiv produktpriser i ${label || "produktets valuta"} og brug PRÆCIST disse tal (ingen omregning, ingen gæt):`,
    ...named,
  ].join("\n");
}
```

- [ ] **Step 4: Kør testen — verificér den passerer**

Run: `deno test --no-check supabase/functions/generate-draft-v2/stages/price-localization.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-draft-v2/stages/price-localization.ts supabase/functions/generate-draft-v2/stages/price-localization.test.ts
git commit -m "feat(draft): price-localization directive block"
```

---

### Task 10: Wire pris-lokalisering ind i pipelinen

**Files:**
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts` (byg blokken ved siden af `comparisonBlock`, føj til writer-direktiverne)

**Interfaces:**
- Consumes: `buildPriceLocalizationBlock`, `isPriceQuestion` (Task 9); `resolveCustomerCurrency` (Task 8); `detectReplyLanguageFromText` (findes i `stages/language.ts`).
- Produces: writeren modtager pris-direktivet når kunden spørger om pris.

- [ ] **Step 1: Tilføj imports øverst i pipeline.ts**

```ts
import { resolveCustomerCurrency } from "./stages/customer-currency.ts";
import { buildPriceLocalizationBlock, isPriceQuestion } from "./stages/price-localization.ts";
```

(`detectReplyLanguageFromText` importeres allerede fra `./stages/language.ts` — genbrug.)

- [ ] **Step 2: Byg blokken lige efter `comparisonBlock`-blokken (efter linje ~1700)**

```ts
    let priceBlock = "";
    if (isPriceQuestion(latestBody ?? "")) {
      const { data: shopRow } = await supabase
        .from("shops")
        .select("primary_market_currency, currency")
        .eq("id", shop_id)
        .maybeSingle();
      const { data: priceRows } = await supabase
        .from("shop_products")
        .select("title, presentment_prices, price, currency")
        .eq("shop_ref_id", shop_id);
      const currency = resolveCustomerCurrency({
        orderCurrency: orderCurrencyForDraft ?? null,
        customerLanguage: detectReplyLanguageFromText(latestBody ?? ""),
        primaryMarketCurrency: shopRow?.primary_market_currency ?? null,
        baseCurrency: shopRow?.currency ?? null,
      });
      priceBlock = buildPriceLocalizationBlock({
        text: latestBody ?? "",
        currency,
        products: (Array.isArray(priceRows) ? priceRows : []).map((r: any) => ({
          title: r.title,
          presentment_prices: r.presentment_prices ?? {},
          price: r.price ?? null,
          base_currency: r.currency ?? null,
        })),
      });
    }
```

> **`orderCurrencyForDraft`:** brug den allerede-resolvede ordrevaluta hvis den findes i scope (fact-resolver-outputtet). Hvis der ikke er en tydelig variabel i scope, sæt `const orderCurrencyForDraft = null;` lige før blokken — resolveren falder da tilbage på sprog/marked. IKKE en placeholder: null er en gyldig, dækket sti (Task 8-test bekræfter fallback).

- [ ] **Step 3: Føj `priceBlock` til writer-direktiverne**

Find hvor `compatibilityBlock`/`comparisonBlock` samles ind i writer-input (søg efter `comparisonBlock` i writer-kaldet) og tilføj `priceBlock` samme sted, fx:

```ts
    const extraDirectives = [compatibilityBlock, comparisonBlock, priceBlock]
      .filter(Boolean)
      .join("\n\n");
```

(Match det eksisterende mønster — hvis blokkene i dag konkateneres direkte i writer-prompten, tilføj `priceBlock` i samme kæde.)

- [ ] **Step 4: Typecheck pipelinen**

Run: `deno check supabase/functions/generate-draft-v2/pipeline.ts`
Expected: ingen NYE fejl relateret til ændringen.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-draft-v2/pipeline.ts
git commit -m "feat(draft): wire price-localization block into pipeline"
```

> **Deploy-note:** `supabase functions deploy generate-draft-v2 --use-api`. Kør EFTER migrationen (Task 1) er kørt mod prod, så `shop_products.presentment_prices`/`shops.primary_market_currency` findes.

---

## Deploy-rækkefølge (efter alle tasks)

1. **Kør migration** (Task 1) mod prod (`apply_migration`).
2. **Deploy web** (Tasks 2-5, 7): droplet git pull + npm build + pm2 restart.
3. **Kør "Sync products"** i Knowledge-UI → henter presentment-priser, sætter `primary_market_currency`, self-healer produkt-webhooks for AceZone.
4. **Deploy edge** `shopify-connect` (Task 6) + `generate-draft-v2` (Task 10) med `--use-api`.
5. Verificér: opret et testprodukt i Shopify → tjek at det dukker op i `shop_products` uden manuel sync; send en test-prisforespørgsel → draft citerer DKK.

## Self-Review

- **Spec-dækning:** Del A (webhooks) → Tasks 5,6,7; self-heal → Task 5; delt modul → Task 4. Del B (presentment) → Tasks 1,2,3,5; resolver → Task 8; pris-lokalisering → Tasks 9,10; primær-marked-fallback → Tasks 1,5,10. Fejlhåndtering (altid-200, tom-map-fallback) → Tasks 5,7,9. Test → hver task. Alle spec-sektioner dækket.
- **Type-konsistens:** `presentment_prices: Record<string,string>` konsistent i normalizer (Task 2), row, webhook (Task 7), pris-blok (Task 9). `resolveCustomerCurrency`-signatur ens i Task 8-def og Task 10-kald. `upsertProductKnowledge`-signatur ens i Task 4-def og Task 7-kald. `ensureShopifyWebhooks`/`PRODUCT_WEBHOOK_TOPICS` ens i Task 5.
- **Placeholders:** `orderCurrencyForDraft` er eksplicit adresseret (null-fallback er en dækket sti, ikke en TODO). `credsFromShopRow`-feltnavne verificeres i Task 7 Step 2 før brug. Ingen "TBD/handle edge cases".
