# Sona Insights Redesign — Design Spec
Date: 2026-04-26

## Overview

Redesign the existing `SonaInsightsModal` slide-out panel to surface AI-generated structured ticket metadata. The "Sona Actions" tab becomes the primary surface for ticket intelligence: issue summary, detected product, tags, category, and solution summary. The existing pipeline log (ActionsTimeline) is preserved but collapsed behind a disclosure button.

All UI text is in English.

## Motivation

Acezone (first customer) currently fills structured ticket metadata manually in Zendesk (type of product, issue description, type of request, solution). Sona should fill this automatically so agents get immediate context and data is available for future analytics and reporting.

## Scope

- Redesign `SonaInsightsModal` — "Sona Actions" tab content
- AI auto-populates all structured fields at ingest and at ticket close
- Manual override on all fields, stored with source (ai/manual)
- Data stored structured for future analytics
- Tags management page and `ThreadTagsBar` remain as-is

## Out of scope

- Analytics/reporting UI (future work — data is stored ready for it)
- Removing `ThreadTagsBar` from the ticket view
- Changes to the "Customer" tab

---

## UI Design

### Panel structure (unchanged)

The `SonaInsightsModal` is a slide-out `<aside>` panel to the right of the ticket conversation. It keeps its two-tab layout:

- **Tab 1: Sona Actions** *(redesigned)*
- **Tab 2: Customer** *(unchanged)*

### Sona Actions tab — layout

Fields are displayed as a clean card with labeled rows. All fields are AI-filled and show a Sparkles icon when set by AI. Clicking a field value opens an inline edit mode.

```
┌─────────────────────────────────────┐
│ Summary                             │
│ Customer reports a loose microphone │
│ and connectivity issues with their  │
│ A-Spire Wireless headset.      ✏️   │
├─────────────────────────────────────┤
│ Product                             │
│ [A-Spire Wireless ✦]          ✏️   │
├─────────────────────────────────────┤
│ Tags                                │
│ [a-spire_wireless ✦] [return ✦] +  │
├─────────────────────────────────────┤
│ Category                            │
│ Return for swap               ✏️   │
├─────────────────────────────────────┤
│ Solution                            │
│ — (empty until ticket solved)       │
└─────────────────────────────────────┘

▼ What did Sona do?
  [collapsed ActionsTimeline]
```

### Field details

| Field | Display | Edit behaviour |
|---|---|---|
| **Summary** | Plain text, 2-3 lines | Inline textarea, saves on blur |
| **Product** | Chip/badge with product name | Searchable dropdown of `shop_products` |
| **Tags** | Coloured chips with ✦ for AI-set | Same add/remove UX as current `ThreadTagsBar` |
| **Category** | Human-readable label from `classification_key` | Read-only (set by AI routing, not overridable here) |
| **Solution** | Plain text, shown after ticket solved | Inline textarea, saves on blur |

### "What did Sona do?" disclosure

A `<details>`-style collapsible at the bottom of the tab. Collapsed by default. Contains the existing `ActionsTimeline` component unchanged.

---

## Data Model

### New columns on `mail_threads`

```sql
ALTER TABLE mail_threads
  ADD COLUMN IF NOT EXISTS issue_summary TEXT,
  ADD COLUMN IF NOT EXISTS detected_product_id UUID REFERENCES shop_products(id) ON DELETE SET NULL;
```

`solution_summary TEXT` already exists (migration `mail_threads_solution_summary.sql`).

### Existing tables used

| Table | Usage |
|---|---|
| `thread_tag_assignments` | AI and manual tag assignments, `source: 'ai' \| 'manual'` |
| `workspace_tags` | Tag definitions with `ai_prompt`, `color`, `category` |
| `shop_products` | Product lookup for detected_product_id |
| `mail_threads.classification_key` | Category (read-only in panel) |
| `mail_threads.solution_summary` | Solution field |

---

## AI Generation

### At ingest — `generate-draft-unified`

Add a new step after draft generation that writes structured metadata:

1. **Issue summary** — prompt the LLM to produce 1-2 English sentences describing what the customer wants. Store in `mail_threads.issue_summary`.
2. **Product detection** — fetch active `shop_products` for the shop (name + id). Ask LLM to match the email to one product or return null. Store matched id in `mail_threads.detected_product_id`.
3. **Tag assignment** — fetch active `workspace_tags` with their `ai_prompt` descriptions. Ask LLM which tags apply. Write to `thread_tag_assignments` with `source: 'ai'`. (Infrastructure already exists; wiring is missing.)

All three can be generated in a single additional LLM call alongside the existing draft call, or appended to the existing prompt response schema — whichever causes less latency. Preferred: extend the existing JSON response schema so no extra round-trip is needed.

### At ticket close

When the frontend sets status to "Solved":
- `POST /api/threads/[threadId]/solution-summary` — server fetches the full thread messages, calls OpenAI to generate a 1-2 sentence English solution summary, saves to `mail_threads.solution_summary`.
- If a solution summary already exists (agent wrote it manually), skip generation.

### Source tracking

- Tags set by AI: `thread_tag_assignments.source = 'ai'`
- Tags added manually: `source = 'manual'`
- If agent edits `issue_summary` or `solution_summary`, a `_source` sibling field is not needed — the edit itself is the override. No extra column required.
- Product set by AI vs. manually overridden: no source column needed for now.

---

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/threads/[threadId]/metadata` | Fetch issue_summary, detected_product, tags, solution_summary for the panel |
| `PATCH` | `/api/threads/[threadId]/metadata` | Update issue_summary, detected_product_id, solution_summary manually |
| `POST` | `/api/threads/[threadId]/solution-summary` | Trigger AI generation of solution summary at close |
| `GET/POST/DELETE` | `/api/threads/[threadId]/tags` | Already exists — unchanged |

---

## Manual override behaviour

- **Summary / Solution**: inline textarea in the panel, auto-saves on blur via `PATCH /metadata`.
- **Product**: clicking the chip opens a searchable dropdown of `shop_products`. Selecting saves immediately.
- **Tags**: same add/remove UX as current `ThreadTagsBar`. Manually added tags get `source: 'manual'`. Manually removed AI tags are deleted from `thread_tag_assignments`.

---

## Components affected

| File | Change |
|---|---|
| `components/inbox/SonaInsightsModal.jsx` | Replace tab 1 content with new `TicketMetadataPanel` component; wrap existing `ActionsTimeline` in collapsible |
| `components/inbox/TicketMetadataPanel.jsx` | New component — renders all five fields |
| `supabase/functions/generate-draft-unified/index.ts` | Extend LLM response schema + write issue_summary, detected_product_id, tag assignments |
| `apps/web/app/api/threads/[threadId]/metadata/route.js` | New API route |
| `apps/web/app/api/threads/[threadId]/solution-summary/route.js` | New API route |
| `supabase/schema/mail_threads_ticket_metadata.sql` | New migration adding issue_summary + detected_product_id columns |

---

## Acceptance criteria

- [ ] Sona Actions tab shows Summary, Product, Tags, Category, Solution fields
- [ ] AI populates Summary, Product, and Tags automatically when a new ticket arrives
- [ ] AI generates Solution summary when ticket is marked Solved
- [ ] Agent can manually edit Summary, Product, Tags, and Solution
- [ ] Manual edits persist after panel close and page reload
- [ ] Existing ActionsTimeline is accessible via "What did Sona do?" collapsible
- [ ] Customer tab is unchanged
- [ ] All UI text is in English
- [ ] Tags in panel and ThreadTagsBar stay in sync (same data source)
