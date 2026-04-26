# Tag System Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend EMAIL_CATEGORIES with 6 new Shopify-relevant categories, add dedicated draft workflows for each, seed 16 default workspace_tags for all workspaces, and fix autoTagThread so routing never silently falls back to "General".

**Architecture:** New categories are added to the single source-of-truth (`email-category.ts`), matched by name in `extractThreadCategoryFromTags`, routed to new workflow files via `routes.ts`. A shared seed helper (`seedDefaultWorkspaceTags.ts`) is called from both `clerk-webhook` (new workspaces) and `autoTagThread` (self-repair fallback), plus a one-time SQL migration for existing workspaces.

**Tech Stack:** Deno/TypeScript (Supabase Edge Functions), `jsr:@std/assert@1` for tests, Supabase Postgres (migrations)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/functions/_shared/email-category.ts` | Modify | Add 6 categories, keyword patterns, OpenAI prompt descriptions |
| `supabase/functions/_shared/email-category.test.ts` | Create | Tests for new category keyword matching |
| `supabase/functions/_shared/seedDefaultWorkspaceTags.ts` | Create | Shared helper: 16 default tags definition + upsert logic |
| `supabase/functions/_shared/seedDefaultWorkspaceTags.test.ts` | Create | Tests for tag definitions |
| `supabase/functions/generate-draft-unified/workflows/types.ts` | Modify | Add 6 new WorkflowSlug values |
| `supabase/functions/generate-draft-unified/workflows/categories/wrong-item.ts` | Create | Draft workflow for wrong item received |
| `supabase/functions/generate-draft-unified/workflows/categories/missing-item.ts` | Create | Draft workflow for item missing from parcel |
| `supabase/functions/generate-draft-unified/workflows/categories/complaint.ts` | Create | Draft workflow for general complaints |
| `supabase/functions/generate-draft-unified/workflows/categories/fraud-dispute.ts` | Create | Draft workflow for fraud/chargeback |
| `supabase/functions/generate-draft-unified/workflows/categories/warranty.ts` | Create | Draft workflow for warranty claims |
| `supabase/functions/generate-draft-unified/workflows/categories/gift-card.ts` | Create | Draft workflow for gift card issues |
| `supabase/functions/generate-draft-unified/workflows/routes.ts` | Modify | Import + route 6 new categories |
| `supabase/functions/_shared/autoTagThread.ts` | Modify | Replace "no tags" free-form path with seed + evaluate |
| `supabase/functions/clerk-webhook/index.ts` | Modify | Call seedDefaultWorkspaceTags after workspace creation |
| `supabase/schema/workspace_tags_default_seed.sql` | Create | One-time migration to seed existing workspaces |

---

## Task 1: Extend EMAIL_CATEGORIES

**Files:**
- Modify: `supabase/functions/_shared/email-category.ts`

- [ ] **Step 1: Replace the EMAIL_CATEGORIES constant**

Replace lines 1-12 in `supabase/functions/_shared/email-category.ts`:

```typescript
export const EMAIL_CATEGORIES = [
  "Tracking",
  "Return",
  "Exchange",
  "Product question",
  "Technical support",
  "Payment",
  "Cancellation",
  "Refund",
  "Address change",
  "Wrong item",
  "Missing item",
  "Complaint",
  "Fraud / dispute",
  "Warranty",
  "Gift card",
  "General",
] as const;
```

- [ ] **Step 2: Add keyword patterns for the 6 new categories**

In `CATEGORY_KEYWORDS`, add these 6 entries. Insert them BEFORE the existing `"Product question"` entry so more-specific patterns match first:

```typescript
  {
    category: "Wrong item",
    patterns: [
      /wrong\s+item/i,
      /received\s+wrong/i,
      /wrong\s+product/i,
      /sent\s+me\s+the\s+wrong/i,
      /incorrect\s+item/i,
      /incorrect\s+product/i,
      /not\s+what\s+i\s+ordered/i,
      /forkert\s+vare/i,
      /forkert\s+produkt/i,
      /forkert\s+størrelse/i,
      /fik\s+forkert/i,
      /modtaget\s+forkert/i,
    ],
  },
  {
    category: "Missing item",
    patterns: [
      /missing\s+item/i,
      /missing\s+product/i,
      /item\s+missing/i,
      /not\s+in\s+(the\s+)?package/i,
      /not\s+in\s+(the\s+)?box/i,
      /only\s+received\s+part/i,
      /incomplete\s+order/i,
      /manglende\s+vare/i,
      /vare\s+mangler/i,
      /mangler\s+i\s+pakken/i,
      /ikke\s+inkluderet/i,
      /pakken\s+manglede/i,
    ],
  },
  {
    category: "Complaint",
    patterns: [
      /\bcomplaint\b/i,
      /very\s+disappointed/i,
      /extremely\s+frustrated/i,
      /unacceptable/i,
      /terrible\s+(service|experience)/i,
      /worst\s+(service|experience)/i,
      /\bklage\b/i,
      /meget\s+skuffet/i,
      /dybt\s+utilfreds/i,
      /uacceptabelt/i,
    ],
  },
  {
    category: "Fraud / dispute",
    patterns: [
      /\bfraud\b/i,
      /\bchargeback\b/i,
      /unauthorized\s+(charge|payment|purchase)/i,
      /didn'?t\s+(place|make)\s+this\s+order/i,
      /not\s+my\s+(order|purchase)/i,
      /stolen\s+(card|credit)/i,
      /\bdispute\b/i,
      /svindel/i,
      /uautoriseret\s+(betaling|køb|træk)/i,
      /har\s+ikke\s+bestilt/i,
      /ikke\s+min\s+ordre/i,
    ],
  },
  {
    category: "Warranty",
    patterns: [
      /\bwarranty\b/i,
      /\bgaranti\b/i,
      /under\s+warranty/i,
      /warranty\s+claim/i,
      /warranty\s+replacement/i,
      /covered\s+by\s+warranty/i,
      /inden\s+for\s+garanti/i,
      /garantikrav/i,
      /garantiperiode/i,
    ],
  },
  {
    category: "Gift card",
    patterns: [
      /gift\s+card/i,
      /gift\s+voucher/i,
      /\bgavekort\b/i,
      /gift\s+card\s+balance/i,
      /gift\s+card\s+code/i,
      /redeem\s+(gift|voucher)/i,
      /gift\s+card\s+not\s+working/i,
      /gavekort\s+virker\s+ikke/i,
      /gavekort\s+kode/i,
      /indløse\s+gavekort/i,
    ],
  },
```

- [ ] **Step 3: Update the OpenAI system prompt in `classifyWithOpenAI`**

Replace the `systemPrompt` constant in `classifyWithOpenAI` (currently at line ~256):

```typescript
  const systemPrompt =
    "You are an email classifier for a customer support inbox.\n" +
    "Choose exactly one category. Use descriptions to distinguish ambiguous cases.\n\n" +
    "Categories:\n" +
    "- Tracking: Customer asks where their shipment is, wants tracking number, or reports a delivery problem.\n" +
    "- Return: Customer explicitly wants to send a product back.\n" +
    "- Exchange: Customer wants to swap for a different size/color. Goal is a replacement variant, not correcting a fulfillment error.\n" +
    "- Wrong item: Customer received a completely different product than what they ordered (fulfillment error). Different from Exchange — customer did not choose the wrong item, the shop shipped the wrong one.\n" +
    "- Missing item: Customer's parcel arrived but one or more items were missing from the package. Different from Tracking — the parcel was delivered, something was just not inside.\n" +
    "- Technical support: Product is not working and customer wants help fixing it. Examples: won't power on, factory reset loop, Bluetooth won't connect, not charging, firmware issue. Customer is NOT requesting a return or swap — they want the product to work.\n" +
    "- Product question: Pre-purchase or general product information question.\n" +
    "- Payment: Billing, invoice, receipt, failed or double charge.\n" +
    "- Cancellation: Customer wants to cancel their order.\n" +
    "- Refund: Customer wants their money back (and has not yet initiated a return).\n" +
    "- Address change: Customer needs to update the shipping address on an existing order.\n" +
    "- Complaint: General dissatisfaction or frustration with no specific actionable request (not a return, refund, or exchange request — just expressing disappointment).\n" +
    "- Fraud / dispute: Customer suspects unauthorized purchase, has filed or is threatening a chargeback, or reports that someone else made the purchase.\n" +
    "- Warranty: Customer is claiming a product defect under warranty and expects coverage (replacement or repair under warranty terms). Different from Technical support — customer explicitly invokes warranty or asks about coverage.\n" +
    "- Gift card: Gift card balance, activation, redemption, or code issue.\n" +
    "- General: Anything that does not fit the above categories.\n\n" +
    "IMPORTANT: If a product is malfunctioning, not powering on, or has a hardware/firmware problem and the customer wants it fixed (not returned), classify as 'Technical support'.\n" +
    "IMPORTANT: If the customer received a different product than ordered, classify as 'Wrong item', not 'Exchange'.\n" +
    "IMPORTANT: If the parcel arrived but something was missing inside, classify as 'Missing item', not 'Tracking'.\n\n" +
    'Return ONLY JSON: { "category": "<one of the categories above, verbatim>" }.';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/email-category.ts
git commit -m "feat: extend EMAIL_CATEGORIES with 6 new Shopify support categories"
```

---

## Task 2: Test new category keyword matching

**Files:**
- Create: `supabase/functions/_shared/email-category.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { assertEquals } from "jsr:@std/assert@1";
import { categorizeEmail } from "./email-category.ts";

// Note: categorizeEmail uses keyword matching first (sync), then OpenAI (async).
// These tests exercise keyword matching only — no network calls needed.

Deno.test("Wrong item: keyword match 'received wrong item'", async () => {
  const result = await categorizeEmail({
    subject: "I received the wrong item",
    body: "My order arrived but the item inside is completely different from what I ordered.",
  });
  assertEquals(result, "Wrong item");
});

Deno.test("Wrong item: Danish 'forkert vare'", async () => {
  const result = await categorizeEmail({
    subject: "Forkert vare",
    body: "Jeg har modtaget forkert vare i min pakke.",
  });
  assertEquals(result, "Wrong item");
});

Deno.test("Missing item: keyword match 'missing item'", async () => {
  const result = await categorizeEmail({
    subject: "Item missing from my order",
    body: "My package arrived but one item is missing.",
  });
  assertEquals(result, "Missing item");
});

Deno.test("Missing item: Danish 'manglende vare'", async () => {
  const result = await categorizeEmail({
    subject: "Manglende vare",
    body: "Der mangler en vare i pakken jeg modtog i dag.",
  });
  assertEquals(result, "Missing item");
});

Deno.test("Complaint: keyword match 'very disappointed'", async () => {
  const result = await categorizeEmail({
    subject: "Very disappointed",
    body: "I am very disappointed with the service I received.",
  });
  assertEquals(result, "Complaint");
});

Deno.test("Fraud / dispute: keyword match 'unauthorized charge'", async () => {
  const result = await categorizeEmail({
    subject: "Unauthorized charge",
    body: "There was an unauthorized charge on my card from your store.",
  });
  assertEquals(result, "Fraud / dispute");
});

Deno.test("Warranty: keyword match 'warranty claim'", async () => {
  const result = await categorizeEmail({
    subject: "Warranty claim",
    body: "I would like to make a warranty claim for my defective product.",
  });
  assertEquals(result, "Warranty");
});

Deno.test("Warranty: Danish 'garanti'", async () => {
  const result = await categorizeEmail({
    subject: "Garanti",
    body: "Mit produkt er gået i stykker og er stadig inden for garantiperioden.",
  });
  assertEquals(result, "Warranty");
});

Deno.test("Gift card: keyword match", async () => {
  const result = await categorizeEmail({
    subject: "Gift card not working",
    body: "I am trying to redeem my gift card but the code is not working.",
  });
  assertEquals(result, "Gift card");
});

Deno.test("Gift card: Danish 'gavekort'", async () => {
  const result = await categorizeEmail({
    subject: "Gavekort virker ikke",
    body: "Jeg kan ikke indløse mit gavekort.",
  });
  assertEquals(result, "Gift card");
});
```

- [ ] **Step 2: Run tests**

```bash
cd supabase/functions/_shared && deno test email-category.test.ts --allow-env --allow-net=api.openai.com
```

Expected: 10 tests pass. If any fail, the keyword pattern for that category needs adjustment in email-category.ts.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/email-category.test.ts
git commit -m "test: add keyword matching tests for 6 new email categories"
```

---

## Task 3: Update WorkflowSlug type

**Files:**
- Modify: `supabase/functions/generate-draft-unified/workflows/types.ts`

- [ ] **Step 1: Add 6 new slugs to WorkflowSlug**

Replace the `WorkflowSlug` type (lines 4-14):

```typescript
export type WorkflowSlug =
  | "tracking"
  | "return"
  | "exchange"
  | "product_question"
  | "technical_support"
  | "payment"
  | "cancellation"
  | "refund"
  | "address_change"
  | "wrong_item"
  | "missing_item"
  | "complaint"
  | "fraud_dispute"
  | "warranty"
  | "gift_card"
  | "general";
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/generate-draft-unified/workflows/types.ts
git commit -m "feat: add 6 new WorkflowSlug values"
```

---

## Task 4: Create wrong-item workflow

**Files:**
- Create: `supabase/functions/generate-draft-unified/workflows/categories/wrong-item.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildWrongItemDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "wrong_item",
    promptHint:
      "WORKFLOW: Wrong item. Kunden har modtaget en forkert vare — en ekspeditionsfejl fra butikkens side. Det er IKKE en ombytning; kunden valgte ikke selv en forkert variant. Anerkend fejlen, bed om ordrenummer og bekræftelse af hvad de modtog vs. hvad de bestilte, og tilbyd reshipping af den korrekte vare.",
    systemHint:
      "Workflow er Wrong item: anerkend ekspeditionsfejlen. Foreslå reshipping af korrekt vare. Foreslå ikke refund medmindre kunden beder om det.",
    promptBlocks: [
      "WRONG ITEM WORKFLOW — følg denne rækkefølge:\n\n" +
      "STEP 1 — Anerkend fejlen med empati:\n" +
      "- Bekræft at kunden har modtaget en forkert vare. Undskyld direkte og klart.\n" +
      "- Brug ALDRIG passive formuleringer som 'det lyder som om der er sket en fejl' — vær direkte: 'Vi har desværre sendt dig den forkerte vare.'\n\n" +
      "STEP 2 — Indhent nødvendige oplysninger (KUN hvis ikke allerede givet):\n" +
      "- Ordrenummer (hvis ikke oplyst)\n" +
      "- Hvad de modtog vs. hvad de bestilte (hvis ikke klart fra emailen)\n" +
      "- Stil MAKSIMALT ét spørgsmål — kombiner om nødvendigt: 'Hvad er dit ordrenummer, og hvad modtog du i stedet?'\n\n" +
      "STEP 3 — Tilbyd løsning:\n" +
      "- Tilbyd reshipping af den korrekte vare — dette er standardløsningen.\n" +
      "- Spørg om kunden skal returnere den forkerte vare eller blot beholde den (følg butikkens returpolitik fra STRUCTURED RETURN SETTINGS).\n" +
      "- Tilbyd KUN refund hvis kunden eksplicit beder om det.\n\n" +
      "Foreslå action: lookup_order_status for at verificere ordreindhold.",
    ],
    systemRules: [
      "Dette er en ekspeditionsfejl fra butikkens side — anerkend fejlen direkte. Brug aldrig passiv sprog der antyder tvivl om fejlen.",
      "Standardløsningen er reshipping af korrekt vare. Foreslå ikke refund_order medmindre kunden eksplicit beder om det.",
      "Stil maksimalt ét samlet spørgsmål — kombiner ordrenummer og varebekræftelse i én sætning.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/generate-draft-unified/workflows/categories/wrong-item.ts
git commit -m "feat: add wrong-item draft workflow"
```

---

## Task 5: Create missing-item workflow

**Files:**
- Create: `supabase/functions/generate-draft-unified/workflows/categories/missing-item.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildMissingItemDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "missing_item",
    promptHint:
      "WORKFLOW: Missing item. Kunden modtog pakken, men en eller flere varer manglede. Det er IKKE et leveringsproblem — pakken ankom. Anerkend problemet, bed om dokumentation og tilbyd reshipping af den manglende vare.",
    systemHint:
      "Workflow er Missing item: pakken er modtaget men ufuldstændig. Anerkend problemet, indhent dokumentation, tilbyd reshipping eller delvis refund.",
    promptBlocks: [
      "MISSING ITEM WORKFLOW — følg denne rækkefølge:\n\n" +
      "STEP 1 — Anerkend problemet:\n" +
      "- Bekræft at det er frustrerende at modtage en ufuldstændig pakke. Undskyld direkte.\n" +
      "- Skriv IKKE 'det lyder som om noget mangler' — vær direkte: 'Vi er kede af at din pakke var ufuldstændig.'\n\n" +
      "STEP 2 — Indhent dokumentation (KUN hvis ikke allerede givet):\n" +
      "- Bed om foto af pakkeindholdet og pakkesedlen (hvis synlig)\n" +
      "- Bed om ordrenummer hvis det ikke fremgår\n" +
      "- Stil MAKSIMALT ét samlet spørgsmål: 'Kan du sende et foto af indholdet i pakken samt dit ordrenummer?'\n\n" +
      "STEP 3 — Tilbyd løsning:\n" +
      "- Reshipping af den manglende vare er standardløsningen.\n" +
      "- Tilbyd alternativt delvis refund af den manglende vares pris, hvis kunden foretrækker det.\n" +
      "- Tilbyd KUN fuld refund hvis kunden eksplicit beder om det.\n\n" +
      "Foreslå action: lookup_order_status for at verificere hvad der skulle have været i pakken.",
    ],
    systemRules: [
      "Pakken er modtaget — det er ikke et trackingproblem. Anerkend at indholdet var ufuldstændigt.",
      "Bed om foto og ordrenummer i ét spørgsmål — ikke to separate spørgsmål.",
      "Reshipping er standardløsningen. Delvis refund er alternativet. Fuld refund kun på kundens eksplicitte ønske.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/generate-draft-unified/workflows/categories/missing-item.ts
git commit -m "feat: add missing-item draft workflow"
```

---

## Task 6: Create complaint workflow

**Files:**
- Create: `supabase/functions/generate-draft-unified/workflows/categories/complaint.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildComplaintDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "complaint",
    promptHint:
      "WORKFLOW: Complaint. Kunden udtrykker generel utilfredshed uden en specifik actionbar anmodning. Prioritér empati og anerkendelse frem for løsningsforslag. Spørg åbent hvad der ville gøre det bedre.",
    systemHint:
      "Workflow er Complaint: empati og anerkendelse først. Ingen forhastede løsninger. Ingen defensiv tone. Spørg hvad der ville hjælpe.",
    promptBlocks: [
      "COMPLAINT WORKFLOW — følg disse principper:\n\n" +
      "1. ANERKEND frustration direkte og oprigtigt:\n" +
      "- Brug ét konkret sætning der viser du forstår kundens oplevelse.\n" +
      "- ALDRIG brug formuleringer som 'Vi beklager eventuelle ulemper' eller 'Vi er kede af at høre det' som isolerede sætninger — de er tomme.\n" +
      "- Anerkend den SPECIFIKKE frustration: 'Vi forstår at det er dybt frustrerende at [konkret problem].'\n\n" +
      "2. UNDGÅ defensiv tone:\n" +
      "- Forsvar ikke butikkens processer eller procedurer i første svar.\n" +
      "- Indrøm ikke ansvar for noget der ikke er bekræftet, men anerkend oplevelsen.\n\n" +
      "3. SPØRG åbent hvad der ville gøre det bedre:\n" +
      "- Afslut med et oprigtigt åbent spørgsmål: 'Hvad ville hjælpe mest for dig lige nu?'\n" +
      "- Foreslå IKKE konkrete løsninger (rabat, refund, erstatning) medmindre kunden specifikt har bedt om dem — det kan virke afvisende.\n\n" +
      "4. HOLD svaret kort:\n" +
      "- Maksimalt 3-4 sætninger. En klage eskaleres ikke med lange forklaringer.",
    ],
    systemRules: [
      "Empati og anerkendelse er prioritet #1. Løsningsforslag er sekundært og må ikke virke som et forsøg på at lukke klagen hurtigt.",
      "Aldrig brug isolerede standardfraser som 'Vi beklager eventuelle ulemper' — anerkend den specifikke situation.",
      "Ingen defensive forklaringer om interne processer i første svar.",
      "Svar skal være kort: 3-4 sætninger maksimalt.",
      "Slut med åbent spørgsmål om hvad der ville hjælpe — foreslå ikke konkrete løsninger medmindre kunden beder om dem.",
    ],
    allowedActionTypes: [
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/generate-draft-unified/workflows/categories/complaint.ts
git commit -m "feat: add complaint draft workflow"
```

---

## Task 7: Create fraud-dispute workflow

**Files:**
- Create: `supabase/functions/generate-draft-unified/workflows/categories/fraud-dispute.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildFraudDisputeDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "fraud_dispute",
    promptHint:
      "WORKFLOW: Fraud / dispute. Kunden rapporterer uautoriseret køb, chargeback eller mistanke om svindel. Neutral og formel tone. Indrøm ALDRIG ansvar. Bed om dokumentation. Marker til menneskelig gennemgang.",
    systemHint:
      "Workflow er Fraud/dispute: neutral og formel tone, aldrig indrøm ansvar, bed om dokumentation, eskalér til menneskelig gennemgang.",
    promptBlocks: [
      "FRAUD / DISPUTE WORKFLOW — følg disse regler strengt:\n\n" +
      "1. TON:\n" +
      "- Neutral og professionel. Hverken varm og imødekommende (som normalt) eller kold.\n" +
      "- Undgå al brug af emojis eller uformelle formuleringer.\n\n" +
      "2. INDRØM ALDRIG ANSVAR:\n" +
      "- Skriv IKKE 'vi beklager at dette er sket' i en form der antyder at butikken er skyld i den uautoriserede transaktion.\n" +
      "- Korrekt formulering: 'Vi tager din henvendelse alvorligt og vil undersøge sagen.'\n\n" +
      "3. BED OM DOKUMENTATION:\n" +
      "- Bed om ordrenummer (hvis tilgængeligt), transaktionstidspunkt og eventuel bankkorrespondance.\n" +
      "- Stil MAKSIMALT ét samlet spørgsmål.\n\n" +
      "4. INFORMER om processen:\n" +
      "- Oplys at sagen vil blive gennemgået af teamet og at kunden vil høre nærmere.\n" +
      "- Giv IKKE løfter om tilbagebetaling, annullering eller udfald — disse afgøres efter gennemgang.\n\n" +
      "5. FORESLÅ intern note til menneskelig gennemgang.",
    ],
    systemRules: [
      "Neutral og formel tone. Aldrig varm og uformel tone i fraud/dispute-sager.",
      "Indrøm aldrig ansvar for den uautoriserede transaktion. Anerkend henvendelsen, ikke fejlen.",
      "Giv ingen løfter om refund, annullering eller udfald — sagen skal gennemgås af et menneske.",
      "Foreslå altid intern note eller tag til menneskelig eskalering.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
    blockedActionTypes: [
      "refund_order",
      "cancel_order",
      "update_shipping_address",
      "initiate_return",
    ],
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/generate-draft-unified/workflows/categories/fraud-dispute.ts
git commit -m "feat: add fraud-dispute draft workflow"
```

---

## Task 8: Create warranty workflow

**Files:**
- Create: `supabase/functions/generate-draft-unified/workflows/categories/warranty.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildWarrantyDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "warranty",
    promptHint:
      "WORKFLOW: Warranty. Kunden gør krav gældende under garanti. Verificer dækningsperiode fra POLITIKKER, bed om dokumentation, og beskriv warranty-processen. Foreslå IKKE teknisk troubleshooting — kunden ønsker dækning, ikke en løsning.",
    systemHint:
      "Workflow er Warranty: følg garantibetingelserne fra POLITIKKER. Bed om købsdokument og fejlbeskrivelse. Ingen troubleshooting.",
    promptBlocks: [
      "WARRANTY WORKFLOW — følg denne struktur:\n\n" +
      "STEP 1 — Anerkend kravet:\n" +
      "- Bekræft at du har modtaget kunden garanti-henvendelse.\n" +
      "- Udtryk forståelse for at produktet ikke lever op til forventningerne.\n\n" +
      "STEP 2 — Indhent dokumentation (KUN hvis ikke allerede givet):\n" +
      "- Ordrebekræftelse eller kvittering (til verificering af købsdato)\n" +
      "- Beskrivelse af defekten — hvad er konkret galt?\n" +
      "- Foto eller video af fejlen (hvis relevant for produkttypen)\n" +
      "- Stil MAKSIMALT ét samlet spørgsmål.\n\n" +
      "STEP 3 — Henvis til garantibetingelser:\n" +
      "- Brug garantiperioden fra POLITIKKER (fx 'Vi tilbyder X års garanti på vores produkter').\n" +
      "- Hvis garantiperioden ikke fremgår af POLITIKKER: skriv 'Vi gennemgår din sag og vender tilbage med næste skridt.'\n" +
      "- Giv ALDRIG løfter om erstatning eller refund uden at have verificeret dækning.\n\n" +
      "FORESLÅ IKKE teknisk troubleshooting — kunden har eksplicit invokeret garantien og ønsker ikke en DIY-løsning.",
    ],
    systemRules: [
      "Brug garantiperioden og -betingelserne fra POLITIKKER. Opfind aldrig garantivilkår.",
      "Foreslå aldrig teknisk troubleshooting i warranty-workflow — kunden ønsker garantidækning, ikke en løsning.",
      "Giv ingen løfter om erstatning eller refund uden verificeret dækning.",
      "Maksimalt ét samlet spørgsmål om dokumentation.",
    ],
    allowedActionTypes: [
      "lookup_order_status",
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
    ],
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/generate-draft-unified/workflows/categories/warranty.ts
git commit -m "feat: add warranty draft workflow"
```

---

## Task 9: Create gift-card workflow

**Files:**
- Create: `supabase/functions/generate-draft-unified/workflows/categories/gift-card.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { EmailCategory } from "../../../_shared/email-category.ts";
import type { WorkflowRoute } from "../types.ts";

export function buildGiftCardDraft(category: EmailCategory): WorkflowRoute {
  return {
    category,
    workflow: "gift_card",
    promptHint:
      "WORKFLOW: Gift card. Kunden har et problem med et gavekort — aktivering, saldo, kode eller indløsning. Bed om gavekortets kode (hvis ikke oplyst), verificer problemet og tilbyd erstatningsgavekort ved bekræftet fejl.",
    systemHint:
      "Workflow er Gift card: bed om kode/nummer, verificer problemtype, tilbyd erstatning ved bekræftet fejl.",
    promptBlocks: [
      "GIFT CARD WORKFLOW — følg denne struktur:\n\n" +
      "STEP 1 — Identificer problemtypen:\n" +
      "Typiske problemer:\n" +
      "A) Koden virker ikke / ugyldig kode\n" +
      "B) Saldoen er forkert eller 0\n" +
      "C) Gavekortet er ikke modtaget (email-levering)\n" +
      "D) Indløsning fejler ved checkout\n\n" +
      "STEP 2 — Indhent nødvendige oplysninger (KUN hvis ikke givet):\n" +
      "- Gavekortets kode eller nummer\n" +
      "- Hvad sker der præcist (fejlmeddelelse, hvad kunden forsøgte)\n" +
      "- Stil MAKSIMALT ét spørgsmål.\n\n" +
      "STEP 3 — Tilbyd løsning:\n" +
      "- Problem A (ugyldig kode): tilbyd at udstede et erstatningsgavekort med samme saldo.\n" +
      "- Problem B (forkert saldo): undersøg og ret saldobalancen — tilbyd erstatningsgavekort hvis ikke rettes.\n" +
      "- Problem C (ikke modtaget): tilbyd at gensende gavekortet til kundens email.\n" +
      "- Problem D (checkout-fejl): spørg om de bruger koden korrekt ved checkout; tilbyd erstatningsgavekort ved bekræftet teknisk fejl.\n\n" +
      "Opfind ALDRIG politikker for gavekort der ikke fremgår af APPROVED FACTS eller KNOWLEDGE BASE.",
    ],
    systemRules: [
      "Bed om gavekortets kode i ét spørgsmål — kombiner med problemtype hvis nødvendigt.",
      "Tilbyd erstatningsgavekort ved bekræftet fejl. Indrøm ikke fejl der endnu ikke er verificeret.",
      "Opfind aldrig gavekortpolitikker eller -vilkår der ikke fremgår af POLITIKKER.",
    ],
    allowedActionTypes: [
      "add_note",
      "add_tag",
      "add_internal_note_or_tag",
      "resend_confirmation_or_invoice",
    ],
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/generate-draft-unified/workflows/categories/gift-card.ts
git commit -m "feat: add gift-card draft workflow"
```

---

## Task 10: Wire new workflows into routes.ts

**Files:**
- Modify: `supabase/functions/generate-draft-unified/workflows/routes.ts`

- [ ] **Step 1: Replace routes.ts entirely**

```typescript
import {
  EMAIL_CATEGORIES,
  LEGACY_EMAIL_CATEGORY_MAP,
  normalizeEmailCategory,
  type EmailCategory,
} from "../../_shared/email-category.ts";
import { buildAddressChangeDraft } from "./categories/address-change.ts";
import { buildCancellationDraft } from "./categories/cancellation.ts";
import { buildComplaintDraft } from "./categories/complaint.ts";
import { buildExchangeDraft } from "./categories/exchange.ts";
import { buildFraudDisputeDraft } from "./categories/fraud-dispute.ts";
import { buildGeneralDraft } from "./categories/general.ts";
import { buildGiftCardDraft } from "./categories/gift-card.ts";
import { buildMissingItemDraft } from "./categories/missing-item.ts";
import { buildPaymentDraft } from "./categories/payment.ts";
import { buildProductDraft } from "./categories/product-question.ts";
import { buildRefundDraft } from "./categories/refund.ts";
import { buildReturnDraft } from "./categories/return.ts";
import { buildTechnicalSupportDraft } from "./categories/technical-support.ts";
import { buildTrackingDraft } from "./categories/tracking.ts";
import { buildWarrantyDraft } from "./categories/warranty.ts";
import { buildWrongItemDraft } from "./categories/wrong-item.ts";
import type { WorkflowRoute, WorkflowSlug } from "./types.ts";

const EMAIL_CATEGORY_SET = new Set<string>(EMAIL_CATEGORIES);
const LEGACY_CATEGORY_TAGS = new Set<string>(Object.keys(LEGACY_EMAIL_CATEGORY_MAP));

export function extractThreadCategoryFromTags(tags: unknown): EmailCategory {
  const list = Array.isArray(tags) ? tags : [];
  for (const raw of list) {
    const tag = String(raw || "").trim();
    if (!tag || tag.startsWith("inbox:")) continue;
    if (!EMAIL_CATEGORY_SET.has(tag) && !LEGACY_CATEGORY_TAGS.has(tag)) continue;
    return normalizeEmailCategory(tag);
  }
  return "General";
}

function categoryToWorkflow(category: EmailCategory): WorkflowSlug {
  switch (category) {
    case "Tracking":
      return "tracking";
    case "Return":
      return "return";
    case "Exchange":
      return "exchange";
    case "Product question":
      return "product_question";
    case "Technical support":
      return "technical_support";
    case "Payment":
      return "payment";
    case "Cancellation":
      return "cancellation";
    case "Refund":
      return "refund";
    case "Address change":
      return "address_change";
    case "Wrong item":
      return "wrong_item";
    case "Missing item":
      return "missing_item";
    case "Complaint":
      return "complaint";
    case "Fraud / dispute":
      return "fraud_dispute";
    case "Warranty":
      return "warranty";
    case "Gift card":
      return "gift_card";
    default:
      return "general";
  }
}

export function buildWorkflowRoute(category: EmailCategory): WorkflowRoute {
  const workflow = categoryToWorkflow(category);
  switch (workflow) {
    case "tracking":
      return buildTrackingDraft(category);
    case "return":
      return buildReturnDraft(category);
    case "exchange":
      return buildExchangeDraft(category);
    case "product_question":
      return buildProductDraft(category);
    case "technical_support":
      return buildTechnicalSupportDraft(category);
    case "payment":
      return buildPaymentDraft(category);
    case "cancellation":
      return buildCancellationDraft(category);
    case "refund":
      return buildRefundDraft(category);
    case "address_change":
      return buildAddressChangeDraft(category);
    case "wrong_item":
      return buildWrongItemDraft(category);
    case "missing_item":
      return buildMissingItemDraft(category);
    case "complaint":
      return buildComplaintDraft(category);
    case "fraud_dispute":
      return buildFraudDisputeDraft(category);
    case "warranty":
      return buildWarrantyDraft(category);
    case "gift_card":
      return buildGiftCardDraft(category);
    default:
      return buildGeneralDraft();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/generate-draft-unified/workflows/routes.ts
git commit -m "feat: wire 6 new workflow categories into routes.ts"
```

---

## Task 11: Create seedDefaultWorkspaceTags helper

**Files:**
- Create: `supabase/functions/_shared/seedDefaultWorkspaceTags.ts`
- Create: `supabase/functions/_shared/seedDefaultWorkspaceTags.test.ts`

- [ ] **Step 1: Create the helper**

```typescript
import { createClient } from "jsr:@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

export type DefaultTag = {
  name: string;
  color: string;
  category: string;
  ai_prompt: string;
};

export const DEFAULT_WORKSPACE_TAGS: DefaultTag[] = [
  {
    name: "Tracking",
    color: "#3b82f6",
    category: "Shipping",
    ai_prompt: "Customer is asking where their shipment is, wants a tracking number, or reports a delivery problem.",
  },
  {
    name: "Missing item",
    color: "#3b82f6",
    category: "Shipping",
    ai_prompt: "Customer says their parcel arrived but one or more items were missing from the package.",
  },
  {
    name: "Address change",
    color: "#3b82f6",
    category: "Shipping",
    ai_prompt: "Customer wants to change or correct the shipping address on an existing order.",
  },
  {
    name: "Return",
    color: "#f97316",
    category: "Returns",
    ai_prompt: "Customer explicitly wants to send a product back.",
  },
  {
    name: "Exchange",
    color: "#f97316",
    category: "Returns",
    ai_prompt: "Customer wants to swap for a different size or color of the same product.",
  },
  {
    name: "Wrong item",
    color: "#f97316",
    category: "Returns",
    ai_prompt: "Customer received a completely different product than what they ordered — a fulfillment error.",
  },
  {
    name: "Refund",
    color: "#eab308",
    category: "Billing",
    ai_prompt: "Customer wants their money back and has not yet initiated a return.",
  },
  {
    name: "Payment",
    color: "#eab308",
    category: "Billing",
    ai_prompt: "Billing, invoice, receipt, or failed or double charge issue.",
  },
  {
    name: "Fraud / dispute",
    color: "#ef4444",
    category: "Billing",
    ai_prompt: "Customer suspects unauthorized purchase, has filed a chargeback, or reports that someone else made the purchase.",
  },
  {
    name: "Gift card",
    color: "#eab308",
    category: "Billing",
    ai_prompt: "Gift card balance, activation, redemption, or code issue.",
  },
  {
    name: "Cancellation",
    color: "#64748b",
    category: "Order",
    ai_prompt: "Customer wants to cancel an existing order.",
  },
  {
    name: "Product question",
    color: "#8b5cf6",
    category: "Product",
    ai_prompt: "Pre-purchase or general product information question.",
  },
  {
    name: "Technical support",
    color: "#8b5cf6",
    category: "Product",
    ai_prompt: "Product is not working and customer wants help fixing it, not replacing it.",
  },
  {
    name: "Warranty",
    color: "#8b5cf6",
    category: "Product",
    ai_prompt: "Customer is claiming a product defect under warranty and expects coverage — replacement or repair under warranty terms.",
  },
  {
    name: "Complaint",
    color: "#ef4444",
    category: "Feedback",
    ai_prompt: "Customer is expressing general dissatisfaction without a specific actionable request.",
  },
  {
    name: "General",
    color: "#64748b",
    category: "Other",
    ai_prompt: "Does not fit any of the other categories.",
  },
];

export async function seedDefaultWorkspaceTags(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const rows = DEFAULT_WORKSPACE_TAGS.map((tag) => ({
    workspace_id: workspaceId,
    name: tag.name,
    color: tag.color,
    category: tag.category,
    ai_prompt: tag.ai_prompt,
    is_active: true,
  }));

  const { error } = await supabase
    .from("workspace_tags")
    .upsert(rows, { onConflict: "workspace_id,name", ignoreDuplicates: true });

  if (error) {
    console.error(`seedDefaultWorkspaceTags failed for workspace ${workspaceId}:`, error.message);
  }
}
```

- [ ] **Step 2: Create tests for tag definitions**

```typescript
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { DEFAULT_WORKSPACE_TAGS } from "./seedDefaultWorkspaceTags.ts";
import { EMAIL_CATEGORIES } from "./email-category.ts";

Deno.test("DEFAULT_WORKSPACE_TAGS has 16 entries", () => {
  assertEquals(DEFAULT_WORKSPACE_TAGS.length, 16);
});

Deno.test("every EMAIL_CATEGORY has a matching default tag", () => {
  const tagNames = new Set(DEFAULT_WORKSPACE_TAGS.map((t) => t.name));
  for (const category of EMAIL_CATEGORIES) {
    assertEquals(
      tagNames.has(category),
      true,
      `Missing default tag for category: "${category}"`,
    );
  }
});

Deno.test("every default tag has a non-empty ai_prompt", () => {
  for (const tag of DEFAULT_WORKSPACE_TAGS) {
    assertEquals(
      tag.ai_prompt.trim().length > 0,
      true,
      `Tag "${tag.name}" has empty ai_prompt`,
    );
  }
});

Deno.test("every default tag has a valid hex color", () => {
  const HEX_RE = /^#[0-9a-f]{6}$/i;
  for (const tag of DEFAULT_WORKSPACE_TAGS) {
    assertMatch(tag.color, HEX_RE, `Tag "${tag.name}" has invalid color: ${tag.color}`);
  }
});

Deno.test("every default tag has a non-empty category group", () => {
  for (const tag of DEFAULT_WORKSPACE_TAGS) {
    assertEquals(
      tag.category.trim().length > 0,
      true,
      `Tag "${tag.name}" has empty category`,
    );
  }
});
```

- [ ] **Step 3: Run tests**

```bash
cd supabase/functions/_shared && deno test seedDefaultWorkspaceTags.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/seedDefaultWorkspaceTags.ts supabase/functions/_shared/seedDefaultWorkspaceTags.test.ts
git commit -m "feat: add seedDefaultWorkspaceTags shared helper with 16 default tags"
```

---

## Task 12: SQL migration for existing workspaces

**Files:**
- Create: `supabase/schema/workspace_tags_default_seed.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Seeds 16 default workspace_tags for every workspace that currently has 0 tags.
-- Safe to run multiple times: INSERT ... ON CONFLICT DO NOTHING is idempotent.

INSERT INTO workspace_tags (workspace_id, name, color, category, ai_prompt, is_active)
SELECT
  w.id AS workspace_id,
  t.name,
  t.color,
  t.category,
  t.ai_prompt,
  true AS is_active
FROM workspaces w
CROSS JOIN (
  VALUES
    ('Tracking',        '#3b82f6', 'Shipping', 'Customer is asking where their shipment is, wants a tracking number, or reports a delivery problem.'),
    ('Missing item',    '#3b82f6', 'Shipping', 'Customer says their parcel arrived but one or more items were missing from the package.'),
    ('Address change',  '#3b82f6', 'Shipping', 'Customer wants to change or correct the shipping address on an existing order.'),
    ('Return',          '#f97316', 'Returns',  'Customer explicitly wants to send a product back.'),
    ('Exchange',        '#f97316', 'Returns',  'Customer wants to swap for a different size or color of the same product.'),
    ('Wrong item',      '#f97316', 'Returns',  'Customer received a completely different product than what they ordered — a fulfillment error.'),
    ('Refund',          '#eab308', 'Billing',  'Customer wants their money back and has not yet initiated a return.'),
    ('Payment',         '#eab308', 'Billing',  'Billing, invoice, receipt, or failed or double charge issue.'),
    ('Fraud / dispute', '#ef4444', 'Billing',  'Customer suspects unauthorized purchase, has filed a chargeback, or reports that someone else made the purchase.'),
    ('Gift card',       '#eab308', 'Billing',  'Gift card balance, activation, redemption, or code issue.'),
    ('Cancellation',    '#64748b', 'Order',    'Customer wants to cancel an existing order.'),
    ('Product question','#8b5cf6', 'Product',  'Pre-purchase or general product information question.'),
    ('Technical support','#8b5cf6','Product',  'Product is not working and customer wants help fixing it, not replacing it.'),
    ('Warranty',        '#8b5cf6', 'Product',  'Customer is claiming a product defect under warranty and expects coverage — replacement or repair under warranty terms.'),
    ('Complaint',       '#ef4444', 'Feedback', 'Customer is expressing general dissatisfaction without a specific actionable request.'),
    ('General',         '#64748b', 'Other',    'Does not fit any of the other categories.')
) AS t(name, color, category, ai_prompt)
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_tags wt WHERE wt.workspace_id = w.id
)
ON CONFLICT (workspace_id, lower(name)) DO NOTHING;
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

Expected output includes the migration being applied without errors. Verify in Supabase dashboard that existing workspaces now have tags.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema/workspace_tags_default_seed.sql
git commit -m "feat: migrate existing workspaces to have 16 default workspace_tags"
```

---

## Task 13: Fix autoTagThread "no tags" path

**Files:**
- Modify: `supabase/functions/_shared/autoTagThread.ts`

- [ ] **Step 1: Replace the file**

Replace the entire file with:

```typescript
import { createClient } from "jsr:@supabase/supabase-js@2";
import { seedDefaultWorkspaceTags } from "./seedDefaultWorkspaceTags.ts";

type SupabaseClient = ReturnType<typeof createClient>;

interface AutoTagParams {
  supabase: SupabaseClient;
  workspaceId: string;
  threadId: string;
  subject: string;
  body: string;
  openaiApiKey: string;
}

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

async function callOpenAI(apiKey: string, messages: object[]): Promise<string> {
  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

export async function autoTagThread(params: AutoTagParams): Promise<void> {
  const { supabase, workspaceId, threadId, subject, body, openaiApiKey } = params;

  // Skip if thread already has AI tags to avoid double-tagging
  const { count: existing } = await supabase
    .from("thread_tag_assignments")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("source", "ai");
  if ((existing ?? 0) > 0) return;

  let { data: workspaceTags } = await supabase
    .from("workspace_tags")
    .select("id, name, ai_prompt")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  // Self-repair: seed default tags if workspace has none, then re-fetch
  if (!workspaceTags?.length) {
    await seedDefaultWorkspaceTags(supabase, workspaceId);
    const { data: seeded } = await supabase
      .from("workspace_tags")
      .select("id, name, ai_prompt")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);
    workspaceTags = seeded;
  }

  if (!workspaceTags?.length) return;

  const ticketContent = `Subject: ${subject || "(none)"}\n\n${(body || "").slice(0, 1500)}`;

  const tagList = workspaceTags
    .map((t) => {
      const rule = t.ai_prompt?.trim()
        ? `Apply when: ${t.ai_prompt.trim()}`
        : "(use your judgment based on the tag name)";
      return `- ID: ${t.id} | Name: "${t.name}" | ${rule}`;
    })
    .join("\n");

  const raw = await callOpenAI(openaiApiKey, [
    {
      role: "system",
      content:
        "You are a support ticket classifier. Given a support ticket and a list of tags with application criteria, decide which tags apply. Return JSON: { \"tag_ids\": [\"<id>\", ...] } — max 2 tags, can be empty array []. Only use IDs from the provided list.",
    },
    {
      role: "user",
      content: `${ticketContent}\n\nAvailable tags:\n${tagList}`,
    },
  ]);

  let tagIds: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    const validIds = new Set(workspaceTags.map((t) => t.id));
    tagIds = (Array.isArray(parsed.tag_ids) ? parsed.tag_ids : [])
      .filter((id): id is string => typeof id === "string" && validIds.has(id))
      .slice(0, 2);
  } catch { /* ignore */ }

  if (tagIds.length) {
    await supabase
      .from("thread_tag_assignments")
      .upsert(
        tagIds.map((id) => ({ thread_id: threadId, tag_id: id, source: "ai" })),
        { onConflict: "thread_id,tag_id", ignoreDuplicates: true },
      );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/autoTagThread.ts
git commit -m "fix: replace free-form tag generation with seed + evaluate in autoTagThread"
```

---

## Task 14: Update clerk-webhook to seed on workspace creation

**Files:**
- Modify: `supabase/functions/clerk-webhook/index.ts`

- [ ] **Step 1: Add import at the top of the file**

After the existing imports (after line 3 — the `createClient` import), add:

```typescript
import { seedDefaultWorkspaceTags } from "../_shared/seedDefaultWorkspaceTags.ts";
```

- [ ] **Step 2: Call seed after workspace creation**

Find the `organization.created` handler block (around line 616). The current block ends at:

```typescript
      const workspaceId = await upsertWorkspace(supabase, orgId, orgName);
      if (!workspaceId) {
        console.error("organization.created kunne ikke oprette workspace", {
          orgId,
          orgName,
        });
        return new Response("Kunne ikke oprette workspace", { status: 500 });
      }
```

Add the seed call immediately after the `if (!workspaceId)` block closes, before the block ends:

```typescript
      const workspaceId = await upsertWorkspace(supabase, orgId, orgName);
      if (!workspaceId) {
        console.error("organization.created kunne ikke oprette workspace", {
          orgId,
          orgName,
        });
        return new Response("Kunne ikke oprette workspace", { status: 500 });
      }
      await seedDefaultWorkspaceTags(supabase, workspaceId);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/clerk-webhook/index.ts
git commit -m "feat: seed default workspace tags on organization.created in clerk-webhook"
```

---

## Task 15: Deploy

- [ ] **Step 1: Deploy generate-draft-unified**

```bash
npx supabase functions deploy generate-draft-unified
```

- [ ] **Step 2: Deploy postmark-inbound (calls autoTagThread)**

```bash
npx supabase functions deploy postmark-inbound --no-verify-jwt
```

- [ ] **Step 3: Deploy clerk-webhook**

```bash
npx supabase functions deploy clerk-webhook
```

- [ ] **Step 4: Verify in Supabase dashboard**

- Open the `workspace_tags` table. Confirm the existing workspace has 16 tags with correct names, colors, and ai_prompts.
- Send a test email containing "wrong item" to the inbound address. Confirm the thread gets tagged with "Wrong item" (not "Exchange" or "General").
- Send a test email containing "gavekort virker ikke". Confirm tag "Gift card".
- Confirm `generate-draft-unified` routes the thread to the correct workflow by checking `agent_logs` for the workflow slug.

- [ ] **Step 5: Final commit if any last-minute fixes**

```bash
git add -A
git commit -m "fix: post-deploy corrections if any"
```
