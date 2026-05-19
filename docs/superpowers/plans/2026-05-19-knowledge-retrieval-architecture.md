# Knowledge & Retrieval Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve draft quality to consistently 9-10/10 by making retrieval fetch only relevant knowledge through metadata filtering, separating saved replies from AI knowledge, and cleaning up the writer prompt.

**Architecture:** The `match_agent_knowledge` Supabase RPC gains optional `filter_products` and `filter_issue_types` parameters. The retriever passes these based on the detected product and intent. Chunks without tags pass through always (universal content like policies). Saved replies are excluded from AI retrieval entirely. The writer prompt is consolidated from ~97 lines to ~60 without losing rules.

**Tech Stack:** Supabase Postgres (pgvector RPC), Deno Edge Functions (TypeScript), Next.js 14 App Router (TypeScript/JSX)

**Spec:** `docs/superpowers/specs/2026-05-19-knowledge-retrieval-architecture-design.md`

---

## File Map

| File | Change |
|------|--------|
| `supabase/migrations/20260519000000_knowledge_metadata_filter.sql` | Create — extend RPC with filter params + exclude saved_reply |
| `supabase/functions/generate-draft-v2/stages/retriever.ts` | Modify — add metadata filter, fallback, tighter budget/floor |
| `supabase/functions/generate-draft-v2/stages/writer.ts` | Modify — consolidate system prompt (~97 → ~60 lines) |
| `apps/web/app/api/knowledge/snippets/route.ts` | Modify — accept `products` + `issue_types` in POST/PUT |
| `apps/web/app/api/knowledge/tag-suggest/route.ts` | Create — LLM endpoint that suggests tags for a chunk |
| `apps/web/components/knowledge/KnowledgePageClient.jsx` | Modify — add tag fields to snippet add/edit dialogs |

---

## Task 1: Database migration — extend match_agent_knowledge RPC

**Files:**
- Create: `supabase/migrations/20260519000000_knowledge_metadata_filter.sql`

Current RPC signature (from `20260430000002_filter_tickets_from_knowledge_rpc.sql`):
```sql
match_agent_knowledge(query_embedding vector(1536), match_count int, filter_shop_id uuid)
```

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260519000000_knowledge_metadata_filter.sql`:

```sql
-- Extend match_agent_knowledge with optional metadata filters.
-- filter_products: only return chunks whose metadata.products overlaps with the array
--   (OR: chunks with no products tag pass through — they are universal content like policies)
-- filter_issue_types: same logic for issue types
-- Also excludes saved_reply chunks from AI retrieval — they are agent-only templates.

CREATE OR REPLACE FUNCTION public.match_agent_knowledge(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_shop_id uuid DEFAULT NULL,
  filter_products text[] DEFAULT NULL,
  filter_issue_types text[] DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  shop_id uuid,
  content text,
  source_type text,
  source_provider text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ak.id,
    ak.shop_id,
    ak.content,
    ak.source_type,
    ak.source_provider,
    ak.metadata,
    1 - (ak.embedding <=> query_embedding) AS similarity
  FROM public.agent_knowledge ak
  WHERE (filter_shop_id IS NULL OR ak.shop_id = filter_shop_id)
    AND ak.source_type != 'ticket'
    AND ak.source_provider != 'saved_reply'
    AND (
      filter_products IS NULL
      OR array_length(filter_products, 1) = 0
      OR (ak.metadata -> 'products') IS NULL
      OR jsonb_array_length(COALESCE(ak.metadata -> 'products', '[]'::jsonb)) = 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(ak.metadata -> 'products') p
        WHERE p = ANY(filter_products)
      )
    )
    AND (
      filter_issue_types IS NULL
      OR array_length(filter_issue_types, 1) = 0
      OR (ak.metadata -> 'issue_types') IS NULL
      OR jsonb_array_length(COALESCE(ak.metadata -> 'issue_types', '[]'::jsonb)) = 0
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(ak.metadata -> 'issue_types') it
        WHERE it = ANY(filter_issue_types)
      )
    )
  ORDER BY ak.embedding <=> query_embedding
  LIMIT GREATEST(match_count, 1);
END;
$$;
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db push
```

Expected: migration applied, no errors.

- [ ] **Step 3: Verify RPC accepts new params**

```bash
npx supabase db diff
```

Expected: no diff (migration already applied).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260519000000_knowledge_metadata_filter.sql
git commit -m "feat(db): extend match_agent_knowledge with product/issue_type filters, exclude saved_reply"
```

---

## Task 2: Retriever — metadata filter + tighter params

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever.ts`

The retriever currently calls `runQueryPair` without filters and uses `knowledgeBudget = 8` and a relevance floor of 40%. This task:
1. Adds an `INTENT_TO_ISSUE_TYPES` map
2. Passes `filterProducts` and `filterIssueTypes` through to the RPC
3. Implements fallback when 0 results with filter
4. Changes budget to 4 and floor to 60%
5. Excludes saved_reply from BM25 query (already excluded in RPC for vector)

- [ ] **Step 1: Add INTENT_TO_ISSUE_TYPES constant**

In `supabase/functions/generate-draft-v2/stages/retriever.ts`, after the `STOP_WORDS` block (around line 110), add:

```typescript
const INTENT_TO_ISSUE_TYPES: Record<string, string[]> = {
  tracking: ["tracking", "shipping"],
  return: ["return"],
  refund: ["refund", "return"],
  exchange: ["return", "physical_damage", "connectivity"],
  complaint: ["physical_damage", "connectivity", "audio", "battery", "firmware"],
  product_question: ["product_specs", "connectivity", "audio", "firmware", "battery"],
  address_change: ["shipping"],
  cancel: ["return"],
  other: [],
  thanks: [],
  update: [],
};
```

- [ ] **Step 2: Add filter params to runQueryPair signature**

Replace the current `runQueryPair` signature (around line 370):

```typescript
// BEFORE
async function runQueryPair(
  query: string,
  shop_id: string,
  supabase: SupabaseClient,
): Promise<{
  vector: Array<Record<string, unknown>>;
  bm25: Array<Record<string, unknown>>;
}>
```

With:

```typescript
// AFTER
async function runQueryPair(
  query: string,
  shop_id: string,
  supabase: SupabaseClient,
  filterProducts?: string[],
  filterIssueTypes?: string[],
): Promise<{
  vector: Array<Record<string, unknown>>;
  bm25: Array<Record<string, unknown>>;
}>
```

- [ ] **Step 3: Pass filter params to the vector RPC call**

Inside `runQueryPair`, replace the `supabase.rpc("match_agent_knowledge", ...)` call:

```typescript
// BEFORE
const { data, error } = await supabase.rpc("match_agent_knowledge", {
  query_embedding: embedding,
  match_count: 20,
  filter_shop_id: shop_id,
});
```

```typescript
// AFTER
const { data, error } = await supabase.rpc("match_agent_knowledge", {
  query_embedding: embedding,
  match_count: 20,
  filter_shop_id: shop_id,
  filter_products: filterProducts?.length ? filterProducts : null,
  filter_issue_types: filterIssueTypes?.length ? filterIssueTypes : null,
});
```

- [ ] **Step 4: Exclude saved_reply from BM25 query**

Inside `runQueryPair`, find the BM25 Supabase query (around line 395) and add `.neq("source_provider", "saved_reply")`:

```typescript
// BEFORE
const { data, error } = await supabase
  .from("agent_knowledge")
  .select("id, content, source_type, source_provider, metadata")
  .eq("shop_id", shop_id)
  .neq("source_type", "ticket")
  .textSearch("content", safeQuery, { type: "websearch" })
  .limit(15);
```

```typescript
// AFTER
const { data, error } = await supabase
  .from("agent_knowledge")
  .select("id, content, source_type, source_provider, metadata")
  .eq("shop_id", shop_id)
  .neq("source_type", "ticket")
  .neq("source_provider", "saved_reply")
  .textSearch("content", safeQuery, { type: "websearch" })
  .limit(15);
```

- [ ] **Step 5: Compute filter arrays in runRetriever and pass to queries with fallback**

In `runRetriever`, after the `queries` array is built (around line 420), add filter computation and update the `queryPairs` call:

```typescript
// Add after: const queries = uniqueStrings([...]).slice(0, 5);

const filterProducts = extractMentionedProductTerms(customerMessage || "", shop);
const intentIssueTypes = INTENT_TO_ISSUE_TYPES[plan.primary_intent] ?? [];
const detectedIssueTypes = extractIssueTerms(customerMessage || "");
const filterIssueTypes = uniqueStrings([...intentIssueTypes, ...detectedIssueTypes]);
```

Then replace the `queryPairs` resolution inside `Promise.all`:

```typescript
// BEFORE (inside Promise.all)
Promise.all(queries.map((q) => runQueryPair(q, shop_id, supabase))),
```

```typescript
// AFTER
(async () => {
  // Try with metadata filters first
  const filtered = await Promise.all(
    queries.map((q) => runQueryPair(q, shop_id, supabase, filterProducts, filterIssueTypes)),
  );
  const totalHits = filtered.reduce(
    (sum, p) => sum + p.vector.length + p.bm25.length, 0,
  );
  // Fallback to unfiltered if metadata tags not set yet on this shop's KB
  if (totalHits === 0 && (filterProducts.length > 0 || filterIssueTypes.length > 0)) {
    console.log("[retriever] metadata filter returned 0 results — falling back to unfiltered search");
    return Promise.all(queries.map((q) => runQueryPair(q, shop_id, supabase)));
  }
  return filtered;
})(),
```

- [ ] **Step 6: Change knowledgeBudget from 8 to 4**

Find `const knowledgeBudget = 8;` (around line 570) and change to:

```typescript
const knowledgeBudget = 4;
```

- [ ] **Step 7: Raise relevance floor from 40% to 60%**

Find the relevance floor filter (around line 639):

```typescript
// BEFORE
return _i < 3 || chunk.similarity >= topSimilarity * 0.4;
```

```typescript
// AFTER
return _i < 3 || chunk.similarity >= topSimilarity * 0.6;
```

- [ ] **Step 8: Deploy and smoke-test**

```bash
npx supabase functions serve generate-draft-v2
```

Send a test request with a known connectivity ticket. Verify in logs:
- `[retriever] queries=N knowledge=M` where M ≤ 4
- No `saved_reply` chunks appear in sources
- Factory reset chunks appear for connectivity tickets when tagged

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/generate-draft-v2/stages/retriever.ts
git commit -m "feat(retriever): add metadata filter, fallback, budget 4, floor 60%, exclude saved_reply"
```

---

## Task 3: Writer prompt — consolidation

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/writer.ts`

The current `systemPrompt` (lines 797–893 in writer.ts) is ~97 lines. Rules are repeated in 3+ places. This task replaces it with a consolidated ~60-line version that preserves every rule.

- [ ] **Step 1: Replace the systemPrompt string**

In `writer.ts`, find the `const systemPrompt = \`Du er en supportmedarbejder...\`` block and replace the entire string with:

```typescript
const systemPrompt = `Du er en supportmedarbejder for ${shopName}.
${
  persona
    ? `\n${persona}\n`
    : `\nVær kortfattet, direkte og hjælpsom. 2-4 sætninger er nok til simple sager. Gå straks til sagen.\n`
}
SPROG (absolut): Svar KUN på ${replyLanguage} (${langName}). Bland aldrig sprog.
${languageCorrectionInstruction ? `SPROGKORREKTION: ${languageCorrectionInstruction}` : ""}

ABSOLUTTE FORBUD:
- Du er et menneske. Aldrig "Som AI kan jeg...".
- Skriv ALDRIG signatur, navn, sign-off eller email-adresser i svaret — tilføjes automatisk.
- Brug KUN fakta fra "Verificerede fakta". Opfind aldrig priser, datoer, ordrenumre eller policies.
- ALDRIG falsk bekræftelse: skriv ALDRIG at en handling er udført medmindre actionResult bekræfter det eksplicit. Planlagte actions er forslag der venter på menneskelig godkendelse.
- ALDRIG "sender videre til teamet", "videreformidler", "kontakt kundesupport" — tag handlingen nu eller forklar præcist hvad der mangler.
- Spørg ALDRIG om telefonnummer.
- URLs som plain text — aldrig markdown [tekst](url).
- Kald ALDRIG kundens problem for "produktionsfejl" eller "fabriksfejl" — brug kundens egne ord.
${
  actionResult
    ? `
POST-ACTION (primær opgave — al anden kontekst er sekundær):
Handlingen er allerede udført i Shopify. Skriv KUN 2-3 sætninger.
- Brug PRÆTERITUM — aldrig "vil blive", "kan", "behandles", "igangsat".
- For refund/cancel: (1) beløbet ER refunderet med amount_display + ordrenavn, (2) 3-5 hverdage på kontoen.
- Ingen "tak for din besked", ingen "kontakt os hvis...", ingen genforklaring.
- FORBUDT: "vi har tilbudt", "vil blive refunderet", "hurtigst muligt", "sagen sendes videre".`
    : ""
}

FAKTA OG VIDENSBASE:
- Besvar altid kundens konkrete spørgsmål med præcise fakta — rapportér ikke blot status.
- Følg KB-procedurer FULDT UD — aldrig forkortet. Giv ALLE trin.
- Brug kun indhold fra en source hvis dens emne matcher kundens specifikke problem.
- TEKNISK TROUBLESHOOTING: Giv specifikke trin FØR du nævner ombytning/garanti. Afslut altid med: "Løser trinene ikke problemet, hjælper vi selvfølgelig videre med en garantisag." UNDTAGELSE: kunden skriver eksplicit at de HAR prøvet alle trin — spring da direkte til næste skridt.
- Bland ALDRIG trin eller specs på tværs af produktmodeller.
- RETURNERING: Returvinduet gælder kun frivillig returnering. Defekter og shop-fejl er shopens ansvar uanset frist.
- FAKTURA-REGEL: Når action er "resend_confirmation_or_invoice" — skriv som om fakturaen er vedhæftet nu (datid), hold svaret til 1-2 sætninger + lukning.

ÅBNING (absolut):
- ALDRIG: "Tak for din henvendelse", "Tak fordi du kontakter os", "Vi er kede af at høre", "I'm sorry to hear", "Thank you for reaching out".
- Start direkte med svaret. Undtagelse: tydelig frustration → ét kort empatisk ord er OK.

TONE OG SAMTALE-FASE:
- "thanks"/"update": KUN 1-2 sætningers anerkendelse. Ingen spørgsmål, ingen handlingsforslag.
- Første svar: komplet forklaring med alle relevante trin.
- Opfølgning (decisions_made ikke tom): kortere — gå direkte til det nye, gentag ikke hvad der er aftalt.
- Bekræftelse (decisions_made ikke tom, ingen åbne spørgsmål): max 2-3 sætninger.
- Sent i samtalen (4+ beskeder): kort og direkte som en kollega der kender sagen.
- Gentaget problem (⚠ i kundehistorik): anerkend det, spring standard-forklaringer over.

AFSLUTNING:
- Afventer svar/billeder: "Jeg ser frem til at høre fra dig."
- Sag løst: "God dag!"
- Frustration/forsinkelse: "Undskyld for ulejligheden og tak for din tålmodighed."
- Aldrig: "er du velkommen til at kontakte os igen".

Returner KUN gyldigt JSON — ingen markdown udenfor JSON.`;
```

- [ ] **Step 2: Deploy and test with eval**

```bash
npx supabase functions serve generate-draft-v2
```

Run 3-5 manual test cases through `POST /api/draft/preview-v2` to verify:
- No regressions on POST-ACTION cases (refund confirmation still correct)
- Troubleshooting cases still include full steps
- Language is still correct per customer

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/generate-draft-v2/stages/writer.ts
git commit -m "refactor(writer): consolidate system prompt from 97 to 60 lines, no rule removals"
```

---

## Task 4: Snippets API — accept products and issue_types metadata

**Files:**
- Modify: `apps/web/app/api/knowledge/snippets/route.ts`

The POST and PUT handlers save metadata. They need to accept `products: string[]` and `issue_types: string[]` and pass them through to `insertKnowledgeChunks`.

- [ ] **Step 1: Replace character-based chunking with semantic section chunking**

In `apps/web/app/api/knowledge/snippets/route.ts`, replace the existing `splitIntoChunks` function with `splitIntoSemanticChunks` that first splits on section boundaries, then falls back to character-based:

```typescript
function splitIntoSemanticChunks(text: string, maxChars = 2400, minChars = 150): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  // Split on section headers (##, numbered sections) or double newlines
  const sections = normalized
    .split(/\n(?=#{1,3}\s|\d+\.\s)|\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= minChars);

  if (sections.length <= 1) {
    // No clear section boundaries — fall back to character overlap chunking
    const chunks: string[] = [];
    let start = 0;
    while (start < normalized.length) {
      const end = Math.min(normalized.length, start + maxChars);
      const chunk = normalized.slice(start, end).trim();
      if (chunk) chunks.push(chunk);
      if (end >= normalized.length) break;
      start = Math.max(0, end - 200);
    }
    return chunks.filter(Boolean);
  }

  // Merge short consecutive sections and split oversized ones
  const chunks: string[] = [];
  let buffer = "";
  for (const section of sections) {
    if (buffer && (buffer.length + section.length + 2) > maxChars) {
      chunks.push(buffer.trim());
      buffer = section;
    } else {
      buffer = buffer ? `${buffer}\n\n${section}` : section;
    }
  }
  if (buffer.trim().length >= minChars) chunks.push(buffer.trim());
  return chunks.filter(Boolean);
}
```

Also update `insertKnowledgeChunks` to use `splitIntoSemanticChunks` instead of `splitIntoChunks`:

```typescript
// BEFORE (line ~315)
const chunks = splitIntoChunks(options.content, 1200, 200).slice(0, Math.max(1, limit));
```

```typescript
// AFTER
const chunks = splitIntoSemanticChunks(options.content, 2400, 150).slice(0, Math.max(1, limit));
```

- [ ] **Step 2: Accept products and issue_types in POST handler**

In the POST handler JSON branch (around line 554), after extracting `usableAs`, add:

```typescript
// After: const usableAs = ...
const products = Array.isArray(payload?.products)
  ? (payload.products as unknown[]).map((p) => String(p).toLowerCase().trim()).filter(Boolean)
  : [];
const issueTypes = Array.isArray(payload?.issue_types)
  ? (payload.issue_types as unknown[]).map((t) => String(t).toLowerCase().trim()).filter(Boolean)
  : [];
```

Then in the `insertKnowledgeChunks` metadata block (around line 592), add the new fields:

```typescript
metadata: {
  workspace_id: scope.workspaceId,
  snippet_id: snippetId,
  title,
  ...(usableAs ? { usable_as: usableAs } : {}),
  ...(category ? { category } : {}),
  ...(productId ? { product_id: productId, product_title: productTitle } : {}),
  ...(products.length ? { products } : {}),       // NEW
  ...(issueTypes.length ? { issue_types: issueTypes } : {}), // NEW
},
```

- [ ] **Step 2: Accept products and issue_types in PUT handler**

In the PUT handler (around line 648), after extracting `usableAs`, add the same extraction:

```typescript
const products = Array.isArray(payload?.products)
  ? (payload.products as unknown[]).map((p) => String(p).toLowerCase().trim()).filter(Boolean)
  : [];
const issueTypes = Array.isArray(payload?.issue_types)
  ? (payload.issue_types as unknown[]).map((t) => String(t).toLowerCase().trim()).filter(Boolean)
  : [];
```

And in the `insertKnowledgeChunks` metadata block in PUT (around line 698):

```typescript
metadata: {
  workspace_id: scope.workspaceId,
  snippet_id: snippetId,
  title,
  ...(usableAs ? { usable_as: usableAs } : {}),
  ...(category ? { category } : {}),
  ...(productId ? { product_id: productId, product_title: productTitle } : {}),
  ...(products.length ? { products } : {}),       // NEW
  ...(issueTypes.length ? { issue_types: issueTypes } : {}), // NEW
},
```

- [ ] **Step 3: Also return products and issue_types in GET handler**

In the GET handler where snippets are built (around line 400), update the snippet object:

```typescript
// BEFORE
snippets.push({
  snippet_id: snippetId,
  title: ...,
  content: ...,
  category: ...,
  product_id: ...,
  usable_as: ...,
  is_stale: false,
});
```

```typescript
// AFTER
snippets.push({
  snippet_id: snippetId,
  title: String(meta?.title || "").trim() || "Untitled snippet",
  content: String(row.content || ""),
  category: (meta?.category as string) || null,
  product_id: (meta?.product_id as string) || null,
  usable_as: VALID_USABLE_AS.includes(rawUsableAs) ? rawUsableAs : null,
  products: Array.isArray(meta?.products) ? (meta.products as string[]) : [],
  issue_types: Array.isArray(meta?.issue_types) ? (meta.issue_types as string[]) : [],
  is_stale: false,
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/knowledge/snippets/route.ts
git commit -m "feat(api): snippets POST/PUT/GET accept and return products + issue_types metadata"
```

---

## Task 5: Tag-suggest API — LLM endpoint

**Files:**
- Create: `apps/web/app/api/knowledge/tag-suggest/route.ts`

This endpoint takes a chunk of knowledge content and returns suggested `products` and `issue_types` using a fast gpt-4o-mini call.

- [ ] **Step 1: Create the route file**

Create `apps/web/app/api/knowledge/tag-suggest/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, resolveScopedShop } from "@/lib/server/workspace-auth";

export const runtime = "nodejs";

const SUPABASE_BASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const ISSUE_TYPES = [
  "connectivity", "factory_reset", "audio", "battery", "firmware",
  "microphone", "pairing", "physical_damage", "return", "refund",
  "shipping", "tracking", "product_specs", "general",
];

function createServiceClient() {
  if (!SUPABASE_BASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_BASE_URL, SUPABASE_SERVICE_KEY);
}

export async function POST(request: Request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase configuration missing." }, { status: 500 });
  }

  let scope: { workspaceId: string | null; supabaseUserId: string | null };
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not resolve scope." }, { status: 500 });
  }

  const payload = await request.json().catch(() => null);
  const content = String(payload?.content || "").trim();
  const requestedShopId = String(payload?.shop_id || "").trim();

  if (!content || content.length < 20) {
    return NextResponse.json({ products: [], issue_types: [] });
  }

  // Fetch shop's product list so we can suggest actual product names
  let productNames: string[] = [];
  try {
    const shop = await resolveScopedShop(serviceClient, scope, requestedShopId || undefined, {
      fields: "id, product_overview",
    }) as { id?: string; product_overview?: string } | null;
    if (shop?.product_overview) {
      productNames = shop.product_overview
        .split(/\r?\n/)
        .map((line: string) => line.replace(/^[-*\s]+/, "").trim().toLowerCase())
        .filter((line: string) => line.length >= 2 && line.length <= 60);
    }
  } catch {
    // Continue without product list
  }

  const productListText = productNames.length
    ? `Known products (use these exact names): ${productNames.slice(0, 20).join(", ")}`
    : "No known product list — infer product names from content if present.";

  const prompt = `You classify support knowledge chunks. Return JSON only.

${productListText}

Known issue_types: ${ISSUE_TYPES.join(", ")}

Content:
"${content.slice(0, 800)}"

Return:
{"products": ["exact-product-name-lowercase"], "issue_types": ["matching_issue_types"]}

Rules:
- products: only include products explicitly mentioned. Empty array if none.
- issue_types: include ALL types this chunk is relevant for (e.g. factory_reset is relevant for both connectivity AND audio issues).
- Return valid JSON only.`;

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 150,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      return NextResponse.json({ products: [], issue_types: [] });
    }

    const data = await resp.json();
    const raw = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    const products = Array.isArray(raw.products)
      ? raw.products.map((p: unknown) => String(p).toLowerCase().trim()).filter(Boolean)
      : [];
    const issueTypes = Array.isArray(raw.issue_types)
      ? raw.issue_types
          .map((t: unknown) => String(t).toLowerCase().trim())
          .filter((t: string) => ISSUE_TYPES.includes(t))
      : [];

    return NextResponse.json({ products, issue_types: issueTypes });
  } catch {
    return NextResponse.json({ products: [], issue_types: [] });
  }
}
```

- [ ] **Step 2: Test the endpoint manually**

```bash
curl -X POST http://localhost:3000/api/knowledge/tag-suggest \
  -H "Content-Type: application/json" \
  -d '{"content": "To do a factory reset on the A-Blaze: 1. Turn off. 2. Hold power 15s..."}'
```

Expected response:
```json
{"products": ["a-blaze"], "issue_types": ["factory_reset", "connectivity", "pairing"]}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/knowledge/tag-suggest/route.ts
git commit -m "feat(api): add tag-suggest endpoint for LLM-based KB metadata suggestions"
```

---

## Task 6: KB UI — tag fields in snippet dialogs

**Files:**
- Modify: `apps/web/components/knowledge/KnowledgePageClient.jsx`

Add two tag fields to the snippet add/edit dialog: one for products (multi-select chips from shop's product list) and one for issue types (multi-select chips from the fixed vocabulary).

- [ ] **Step 1: Add state for tag fields in the snippet dialog**

Find where snippet dialog state is initialized (search for `setSavedReplyTitle` or `snippetContent` state). Near the other snippet state variables, add:

```javascript
const [snippetProducts, setSnippetProducts] = useState([]);
const [snippetIssueTypes, setSnippetIssueTypes] = useState([]);
const [tagSuggestions, setTagSuggestions] = useState({ products: [], issue_types: [] });
const [tagSuggestLoading, setTagSuggestLoading] = useState(false);
```

- [ ] **Step 2: Add a helper to fetch tag suggestions**

Inside the component, add:

```javascript
const ISSUE_TYPE_OPTIONS = [
  "connectivity", "factory_reset", "audio", "battery", "firmware",
  "microphone", "pairing", "physical_damage", "return", "refund",
  "shipping", "tracking", "product_specs", "general",
];

async function fetchTagSuggestions(content) {
  if (!content || content.length < 30) return;
  setTagSuggestLoading(true);
  try {
    const res = await fetch("/api/knowledge/tag-suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, shop_id: shopId }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setTagSuggestions(data);
  } finally {
    setTagSuggestLoading(false);
  }
}
```

- [ ] **Step 3: Add tag UI to the snippet add dialog**

Find the snippet dialog form (search for `snippet-content` label). After the content textarea, add:

```jsx
{/* Products */}
<div className="space-y-1.5">
  <div className="flex items-center justify-between">
    <Label className="text-xs font-medium text-gray-700">Produkter</Label>
    <button
      type="button"
      onClick={() => fetchTagSuggestions(snippetContent)}
      disabled={tagSuggestLoading || !snippetContent}
      className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
    >
      {tagSuggestLoading ? "Foreslår..." : "Foreslå automatisk"}
    </button>
  </div>
  <div className="flex flex-wrap gap-1.5">
    {tagSuggestions.products.map((p) => (
      <button
        key={p}
        type="button"
        onClick={() => setSnippetProducts((prev) =>
          prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
        )}
        className={`rounded-full px-2 py-0.5 text-xs border transition-colors ${
          snippetProducts.includes(p)
            ? "bg-blue-100 border-blue-400 text-blue-800"
            : "bg-gray-50 border-gray-300 text-gray-600 hover:border-blue-300"
        }`}
      >
        {p}
      </button>
    ))}
  </div>
  <Input
    placeholder="Tilføj produkt (tryk Enter)"
    className="h-7 text-xs"
    onKeyDown={(e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = e.currentTarget.value.trim().toLowerCase();
        if (val && !snippetProducts.includes(val)) {
          setSnippetProducts((prev) => [...prev, val]);
        }
        e.currentTarget.value = "";
      }
    }}
  />
  {snippetProducts.length > 0 && (
    <div className="flex flex-wrap gap-1">
      {snippetProducts.map((p) => (
        <span key={p} className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
          {p}
          <button
            type="button"
            onClick={() => setSnippetProducts((prev) => prev.filter((x) => x !== p))}
            className="hover:text-blue-600"
          >×</button>
        </span>
      ))}
    </div>
  )}
</div>

{/* Issue types */}
<div className="space-y-1.5">
  <Label className="text-xs font-medium text-gray-700">Issue types</Label>
  <div className="flex flex-wrap gap-1.5">
    {ISSUE_TYPE_OPTIONS.map((t) => (
      <button
        key={t}
        type="button"
        onClick={() => setSnippetIssueTypes((prev) =>
          prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
        )}
        className={`rounded-full px-2 py-0.5 text-xs border transition-colors ${
          snippetIssueTypes.includes(t) || tagSuggestions.issue_types.includes(t)
            ? snippetIssueTypes.includes(t)
              ? "bg-green-100 border-green-400 text-green-800"
              : "bg-yellow-50 border-yellow-300 text-yellow-700"
            : "bg-gray-50 border-gray-300 text-gray-500 hover:border-gray-400"
        }`}
      >
        {t}
        {!snippetIssueTypes.includes(t) && tagSuggestions.issue_types.includes(t) && (
          <span className="ml-0.5 opacity-60">+</span>
        )}
      </button>
    ))}
  </div>
  <p className="text-xs text-gray-400">Gul = AI-forslag. Klik for at bekræfte.</p>
</div>
```

- [ ] **Step 4: Pass tags in the save/update calls**

Find where the snippet POST/PUT is called (search for `fetch("/api/knowledge/snippets"`). Add `products` and `issue_types` to the request body:

```javascript
// In both the create and update fetch calls, add to the body:
products: snippetProducts,
issue_types: snippetIssueTypes,
```

- [ ] **Step 5: Populate tags when editing an existing snippet**

Find where the edit dialog is opened and snippet data is loaded. After setting title/content, add:

```javascript
setSnippetProducts(snippet.products || []);
setSnippetIssueTypes(snippet.issue_types || []);
setTagSuggestions({ products: [], issue_types: [] });
```

- [ ] **Step 6: Reset tag state when dialog closes**

Find the dialog close handler and add:

```javascript
setSnippetProducts([]);
setSnippetIssueTypes([]);
setTagSuggestions({ products: [], issue_types: [] });
```

- [ ] **Step 7: Start dev server and test the UI**

```bash
cd apps/web && npm run dev
```

1. Open Knowledge page
2. Add a new snippet with content "To do a factory reset on the A-Blaze..."
3. Click "Foreslå automatisk" — verify suggested tags appear
4. Confirm tags and save
5. Edit the snippet — verify tags are pre-populated
6. Check Supabase `agent_knowledge` table to verify `metadata.products` and `metadata.issue_types` are saved

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/knowledge/KnowledgePageClient.jsx
git commit -m "feat(ui): add products + issue_types tag fields to knowledge snippet dialogs"
```

---

## Task 7: Eval — verify improvement

- [ ] **Step 1: Run eval with same ticket set as before**

Open the Eval panel in the dashboard. Run a new eval job with the same shop and ticket set used before this change. Use the same model and judge model.

- [ ] **Step 2: Compare scores**

In the eval results, compare:
- `overall_10` distribution: should shift up
- `likely_root_cause = "retrieval"` count: should drop
- `send_ready = true` rate: should increase

- [ ] **Step 3: Check the A-Blaze connectivity example specifically**

Run the A-Blaze connectivity ticket through `POST /api/draft/preview-v2`. Verify:
- Factory reset steps are included
- No audio clip request appears
- No A-Live B2B saved reply appears in sources
- Sources count ≤ 4

- [ ] **Step 4: Tag existing KB articles for test shop**

For the shop used in eval, open the Knowledge page and tag the existing articles:
- "Why is my audio quality bad for A-blaze?" → products: `a-blaze`, issue_types: `audio, factory_reset`
- "A-Blaze vs A-Spire comparison" → products: `a-blaze, a-spire-wireless`, issue_types: `product_specs`
- Any connectivity guide → products: `a-blaze`, issue_types: `connectivity, factory_reset, pairing`

Then re-run eval and compare again with tagged KB.

- [ ] **Step 5: Commit eval baseline notes**

```bash
git commit --allow-empty -m "eval: baseline scores recorded before and after knowledge retrieval architecture"
```
