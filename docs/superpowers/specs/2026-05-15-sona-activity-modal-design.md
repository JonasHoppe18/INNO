# Sona Activity Modal — Diagnostic Transparency Layer

**Date:** 2026-05-15
**Status:** Approved for implementation

---

## Problem

AI drafts are not good enough because of three compounding issues:

- **A — Missing knowledge:** Merchants haven't uploaded the right data, or don't know what's missing
- **B — Retrieval failures:** The AI has relevant knowledge but doesn't surface it for a given ticket
- **C — No visibility:** There's no way to see what the AI retrieved or why it wrote what it wrote, so A and B can't be diagnosed

The existing "Sona activity" card opens a modal that says "No actions recorded." It must be replaced with a useful diagnostic view.

---

## Solution

Expand the Sona Activity modal to show four sections that explain exactly what happened during draft generation. This gives agents and merchants the information they need to both understand the draft and improve the knowledge base.

---

## Sections

### 1. Why this draft
A plain-language explanation of what intent was detected and what Sona found or couldn't find. Sourced from the planner's intent classification and the verifier's `likely_root_cause` / `missing_for_10` output.

### 2. Knowledge used
Expandable list of KB chunks that were retrieved from `agent_knowledge`. Each item shows:
- Chunk title (collapsed)
- Relevance score as a color-coded pill: green ≥ 0.80, amber < 0.80
- Truncated preview text (collapsed)
- Full content + metadata (type, source, updated date) on expand

Accordion uses CSS grid-rows transition — smooth and interruptible.

### 3. Similar previous emails
Expandable list of matched `ticket_examples`. Each item shows:
- Subject + date (collapsed)
- Similarity score
- Full customer message + agent reply on expand

Neutral styling — no color, distinguishable from KB chunks by section label only.

### 4. Missing knowledge
Gaps detected by the pipeline's gap-detection stage (`agent_logs` with `step_name = 'knowledge_gap_detected'`). Each gap shows:
- Gap title (what's missing)
- Hint text suggesting what to add
- **"Add to knowledge base"** button — opens a small inline form (within the same modal, below the gap item) pre-filled with the gap hint as a starting point. On save it calls `POST /api/knowledge/snippets` and dismisses the form. Does not navigate away from the thread.

This is the only section with amber color, intentionally signaling that action is required.

---

## Design

- **Font:** Inter
- **Color palette:** Sona's neutral gray system throughout. Two exceptions with intentional meaning:
  - Score pills: green (≥ 0.80) / amber (< 0.80) — communicates retrieval quality at a glance
  - Gap section background: amber — signals something needs doing
- **Cards:** `border-radius: 10px`, `border: 1px solid var(--border)`, white background
- **Modal:** `border-radius: 16px`, `box-shadow` with three layers, sticky header with `backdrop-filter: blur`
- **Modal entry animation:** scale 0.96 → 1 + opacity 0 → 1, 220ms `cubic-bezier(0.23, 1, 0.32, 1)`
- **Accordion:** CSS `grid-template-rows: 0fr → 1fr` transition, 200ms ease-out (interruptible, no JS height measurement)
- **Chevron:** rotates 90° on open, 180ms ease-out
- **Stagger:** section items fade up with 40ms offsets
- **Active states:** buttons scale to 0.97 on press, 120ms ease

---

## Data Requirements

| Section | Source | Status |
|---------|--------|--------|
| Why this draft | Planner intent + verifier `likely_root_cause` / `missing_for_10` | Exists in `eval_results`, needs to be stored per live draft |
| Knowledge used | `retrieval_traces` table (query, matched_chunks JSONB) | Table exists, needs to be written per draft in pipeline |
| Similar previous emails | `ticket_examples` matches from retriever stage | Retrieved in pipeline, needs to be stored in `retrieval_traces` or draft payload |
| Missing knowledge | `agent_logs` with `step_name = 'knowledge_gap_detected'` | Exists |

The main gap: `retrieval_traces` is populated inconsistently. The pipeline needs to write a trace row for every draft, including matched KB chunks, ticket examples, relevance scores, and the planner reasoning.

---

## Changes Required

### Pipeline (`generate-draft-v2`)
- After the retriever stage, write a `retrieval_traces` row with:
  - `matched_chunks`: array of `{ id, title, content, score, source_type, updated_at }`
  - `matched_tickets`: array of `{ id, subject, customer_msg, agent_reply, score, created_at }`
- After the planner stage, store `intent + reasoning` in the draft payload or `agent_logs`
- Verifier already outputs `likely_root_cause` — ensure it's stored on the draft record

### API (`/api/threads/[threadId]/insights`)
- Extend to join `retrieval_traces` for the draft
- Return: `reasoning`, `kb_chunks`, `ticket_examples`, `knowledge_gaps`

### UI (`SonaInsightsModal.jsx` + existing dialog)
- Replace "No actions recorded" dialog content with the four-section layout
- The existing `ActionsTimeline` remains accessible via a separate "View pipeline steps" collapse at the bottom for advanced users

---

## Out of Scope
- Fixing retrieval quality (B) — that's a separate engineering task once visibility (C) reveals the pattern
- Knowledge upload UI improvements — separate spec
- Eval system changes
