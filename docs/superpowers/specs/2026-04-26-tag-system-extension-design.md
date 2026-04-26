# Tag System Extension — Design Spec
Date: 2026-04-26

## Problem

The current tag system has two structural issues:

1. **Two decoupled systems.** `EMAIL_CATEGORIES` (used for AI pipeline routing) and `workspace_tags` (used in the UI and auto-tagging) are not linked. `extractThreadCategoryFromTags()` in routes.ts matches tag names against `EMAIL_CATEGORIES` exactly — but `autoTagThread` creates free-form tags ("shipping", "billing") on workspaces with no tags, so routing silently falls back to "General" for all tickets.

2. **No default tags on new workspaces.** Nothing seeds tags when a workspace is created, so every new customer starts with broken routing and free-form AI-generated tags.

Additionally, the current `EMAIL_CATEGORIES` list is missing categories relevant to Shopify support: wrong item received, missing item in parcel, complaints, fraud/disputes, warranty claims, and gift card issues.

## Approach

Approach A (full fix):
- Extend `EMAIL_CATEGORIES` with 6 new categories
- Add dedicated workflow files for each new category
- Seed 16 default `workspace_tags` for all workspaces (migration for existing, clerk-webhook for new)
- Fix `autoTagThread` so the "no tags" fallback seeds defaults instead of creating free-form tags

## Changes

### 1. `supabase/functions/_shared/email-category.ts`

**New categories added to `EMAIL_CATEGORIES`:**

| Name | Intent |
|---|---|
| `Wrong item` | Customer received a different product than ordered. Goal is correction, not a general exchange/swap. |
| `Missing item` | A product was missing from the parcel entirely. |
| `Complaint` | General dissatisfaction with no specific actionable request. |
| `Fraud / dispute` | Chargeback, unauthorized purchase, suspicious activity. |
| `Warranty` | Customer is claiming a defect under warranty. |
| `Gift card` | Gift card balance, activation, or redemption issue. |

**Keyword patterns** (both EN and DA) added to `CATEGORY_KEYWORDS` for all 6.

**OpenAI system prompt** in `classifyWithOpenAI` updated with precise descriptions that disambiguate:
- `Wrong item` vs `Exchange` — both involve wrong product, but wrong item = received error, exchange = wants different variant
- `Missing item` vs `Tracking` — tracking = parcel not arrived, missing item = parcel arrived but incomplete
- `Fraud / dispute` vs `Payment` — payment = billing issue, fraud = unauthorized or disputed charge
- `Warranty` vs `Technical support` — tech support = fix the product, warranty = replace under claim
- `Complaint` vs `General` — complaint = expressed dissatisfaction, general = neutral inquiry

No changes needed to `extractThreadCategoryFromTags()` in routes.ts — it already matches on exact `EMAIL_CATEGORIES` names.

### 2. New workflow files

Location: `supabase/functions/generate-draft-unified/workflows/categories/`

| File | Draft strategy |
|---|---|
| `wrong-item.ts` | Ask for order number, confirm what was ordered vs received, offer reshipping of correct item |
| `missing-item.ts` | Ask for photo of package contents + packing slip, offer reshipping of missing item or partial refund |
| `complaint.ts` | Empathy-first tone, acknowledge frustration explicitly, ask open question: what would make this right |
| `fraud-dispute.ts` | Neutral/formal tone, never admit liability, request documentation, escalate to human review |
| `warranty.ts` | Ask for proof of purchase + description of defect, state coverage window, initiate warranty flow |
| `gift-card.ts` | Ask for card code/number, check activation/balance, offer replacement on confirmed error |

All files follow existing pattern: export a `build<Category>Draft(category)` function returning a `WorkflowRoute`.

**`routes.ts` updates:**
- Import all 6 new builders
- Add cases to `categoryToWorkflow()` switch
- Add cases to `buildWorkflowRoute()` switch

### 3. Default workspace tag seed

**16 standard tags** (10 existing EMAIL_CATEGORIES + 6 new), grouped by semantic category:

| Tag name | Color | Group |
|---|---|---|
| Tracking | `#3b82f6` (blue) | Shipping |
| Missing item | `#3b82f6` (blue) | Shipping |
| Address change | `#3b82f6` (blue) | Shipping |
| Return | `#f97316` (orange) | Returns |
| Exchange | `#f97316` (orange) | Returns |
| Wrong item | `#f97316` (orange) | Returns |
| Refund | `#eab308` (yellow) | Billing |
| Payment | `#eab308` (yellow) | Billing |
| Fraud / dispute | `#ef4444` (red) | Billing |
| Gift card | `#eab308` (yellow) | Billing |
| Cancellation | `#64748b` (slate) | Order |
| Product question | `#8b5cf6` (purple) | Product |
| Technical support | `#8b5cf6` (purple) | Product |
| Warranty | `#8b5cf6` (purple) | Product |
| Complaint | `#ef4444` (red) | Feedback |
| General | `#64748b` (slate) | Other |

Each tag has an `ai_prompt` field — a short English instruction for `autoTagThread`:

```
Tracking       → "Customer is asking where their shipment is, wants a tracking number, or reports a delivery problem."
Missing item   → "Customer says their parcel arrived but one or more items were missing from the package."
Address change → "Customer wants to change or correct the shipping address on an existing order."
Return         → "Customer explicitly wants to send a product back."
Exchange       → "Customer wants to swap for a different size or color of the same product."
Wrong item     → "Customer received a different product than what they ordered."
Refund         → "Customer wants their money back."
Payment        → "Billing, invoice, receipt, or failed/double charge issue."
Fraud/dispute  → "Customer suspects unauthorized purchase, has filed a chargeback, or reports suspicious activity."
Gift card      → "Customer has an issue with a gift card: activation, balance, or redemption."
Cancellation   → "Customer wants to cancel an existing order."
Product question → "Pre-purchase or general product information question."
Technical support → "Product is not working and customer wants help fixing it, not replacing it."
Warranty       → "Customer is claiming a product defect under warranty."
Complaint      → "Customer is expressing general dissatisfaction without a specific actionable request."
General        → "Does not fit any of the above categories."
```

**Seed mechanism:**

1. **SQL migration** (`supabase/schema/workspace_tags_default_seed.sql`): Inserts all 16 tags for every workspace that currently has 0 rows in `workspace_tags`. Uses `INSERT ... ON CONFLICT DO NOTHING` so it's idempotent.

2. **`supabase/functions/clerk-webhook/index.ts`**: Extract a shared `seedDefaultWorkspaceTags(supabase, workspaceId)` helper. Call it when a new workspace is created (after the workspace row is inserted).

3. **`supabase/functions/_shared/autoTagThread.ts`**: Remove the "no tags" free-form generation path. Replace with: if `workspaceTags.length === 0`, call `seedDefaultWorkspaceTags` then re-fetch tags, then proceed with normal per-tag evaluation. This ensures any workspace that slips through without seeding self-repairs on first inbound email.

### 4. Shared seed helper

New file: `supabase/functions/_shared/seedDefaultWorkspaceTags.ts`

Exports `seedDefaultWorkspaceTags(supabase, workspaceId)`. Contains the 16 tag definitions as a typed constant and does a single bulk upsert with `onConflict: "workspace_id,name", ignoreDuplicates: true`. Used by both clerk-webhook and autoTagThread.

## Data flow after this change

```
Inbound email
  → postmark-inbound
  → autoTagThread(workspaceId, threadId, subject, body)
      → fetch workspace_tags (always seeded now)
      → OpenAI evaluates ticket against per-tag ai_prompts
      → assigns ≤2 tags with source: "ai"
  → generate-draft-unified
      → extractThreadCategoryFromTags(tags)   ← tag.name matches EMAIL_CATEGORIES exactly
      → categoryToWorkflow()
      → buildWorkflowRoute()                  ← routes to specialized workflow
      → draft generated with correct context
```

## Out of scope

- UI changes to the tag settings page (the new tags appear automatically via the existing TagsSettings component)
- Changing existing workflow files
- Any changes to the LEGACY_EMAIL_CATEGORY_MAP beyond what's needed for new categories

## Files changed

| File | Change |
|---|---|
| `supabase/functions/_shared/email-category.ts` | Add 6 categories, keyword patterns, OpenAI prompt descriptions |
| `supabase/functions/_shared/seedDefaultWorkspaceTags.ts` | New — shared seed helper |
| `supabase/functions/_shared/autoTagThread.ts` | Replace "no tags" path with seed + evaluate |
| `supabase/functions/generate-draft-unified/workflows/categories/wrong-item.ts` | New |
| `supabase/functions/generate-draft-unified/workflows/categories/missing-item.ts` | New |
| `supabase/functions/generate-draft-unified/workflows/categories/complaint.ts` | New |
| `supabase/functions/generate-draft-unified/workflows/categories/fraud-dispute.ts` | New |
| `supabase/functions/generate-draft-unified/workflows/categories/warranty.ts` | New |
| `supabase/functions/generate-draft-unified/workflows/categories/gift-card.ts` | New |
| `supabase/functions/generate-draft-unified/workflows/routes.ts` | Import + switch cases for 6 new categories |
| `supabase/functions/clerk-webhook/index.ts` | Call seedDefaultWorkspaceTags on workspace creation |
| `supabase/schema/workspace_tags_default_seed.sql` | New — migration to seed existing workspaces |
