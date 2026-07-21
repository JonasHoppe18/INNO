# Knowledge Document Editor Redesign — Design

**Date:** 2026-07-21
**Scope:** The product support **document editor** (`KnowledgeDocsEditor` + `KnowledgeDocumentEditorCard`), reached via `KnowledgeProductDetail`. NOT the broader knowledge hub (`KnowledgePageClient`).
**Inspiration:** Mobbin — GitBook, Craft, Zendesk, Front, Intercom, ClickUp document editors (two/three-panel patterns with section outline + rich canvas + action header).

## Problem

The current editor is a single centered card: a title/description header with Test/Simulate/Publish/Save buttons, an inline format toolbar, and stacked sections in one scrolling column. In documents with several sections (already 4+ on real products) there is no way to see the document's structure or jump between sections, and the action buttons scroll out of reach.

Crucially, **each H2 heading is a focused knowledge section that the AI chunks and retrieves from.** Section structure is therefore semantically meaningful, not just visual — but the current UI makes it invisible.

## Approach: Two-panel editor

A full-width workspace replacing the single card:

```
┌─────────────────────────────────────────────────────────┐
│  ← Back to products      A-Blaze — Product Support        │  breadcrumb + title
├───────────────┬─────────────────────────────────────────┤
│               │ [status ·  Save  Publish  Test  Simulate] │  sticky action-bar
│  OUTLINE      ├─────────────────────────────────────────┤
│  (sections)   │  sticky format toolbar                    │
│               │                                           │
│  • Product…   │   writing canvas (Tiptap)                 │
│  • Cable…     │                                           │
│  • Bluetooth… │                                           │
│  • Headset…   │                                           │
└───────────────┴─────────────────────────────────────────┘
```

- Left column: ~240px fixed section outline.
- Center: writing canvas, comfortable max-width (~720px) so line length stays readable, with a sticky format toolbar and a sticky action header above it.
- No right metadata rail (the metadata — status + publish/test actions — is thin and lives in the action header instead).

Chosen over one-panel (does not solve navigation) and three-panel (a third column steals canvas width for thin content and is the largest build for least extra value).

## Components

### 1. Section outline (left)
- Live-parsed list of all **H2 sections** from the editor content.
- Click a section → smooth-scroll to it in the canvas + brief highlight.
- Scroll-spy: the section currently in view is marked active as the user scrolls.
- Header: "Sections" + count, plus a subtle hint that each section is an AI knowledge unit.
- Empty state: "Add a section heading to structure this guide."
- **Read-only navigation only** in this version. Drag-to-reorder is explicitly out of scope (future enhancement).

### 2. Canvas + toolbar (center)
- Same Tiptap editor and markdown model — no functional editor changes.
- Format toolbar becomes **sticky** at the top of the canvas so it follows on long scroll.
- Toolbar contents unchanged: Bold, Italic, **H2 section heading (single toggle button, kept — not a dropdown)**, bullet list, ordered list, link. Slightly more breathing room and clearer active state.
- Keep the existing grey top hint ("Create section headings…").
- Preserve current prose typography rhythm (largely already in the prose styling).

### 3. Sticky action header (top of right column)
Consolidates what today sits scattered in the card header:
- **Status pill** (left): Published / Unpublished changes / Unsaved changes / Saved — reuses the existing `statusLabel({ isDirty, document })` logic, rendered as a pill.
- **Actions** (right): Save · Publish · Test against ticket · Simulate conversation — unchanged behavior, grouped and sticky so they are always in reach.
- "View legacy snippets" demoted to a discreet secondary/overflow placement so it does not compete with primary actions.

### 4. Empty & loading states
- Loading: skeletons for both outline and canvas (reuse existing `Skeleton`).
- Empty document: canvas shows a light placeholder structure inviting the first section; outline shows its empty state.

## Data flow

Unchanged. The outline derives purely from the editor's current markdown/content (parse H2 headings client-side). Save/Publish/Test/Simulate keep their existing endpoints and handlers in `KnowledgeDocumentEditorCard`. The editor still emits normalized markdown via `onChange`.

The one new interface: the editor needs to expose its section headings (and their scroll anchors) to the parent so the outline can render and drive scroll. This can be a lightweight parse of `value` (markdown H2 lines) shared between the outline and the editor, with the editor assigning stable ids/anchors to its H2 nodes for scroll-into-view.

## Out of scope (YAGNI)
- No right metadata rail.
- No drag-to-reorder of sections.
- No new editor capabilities (images, tables, etc.).
- No changes to the knowledge hub (`KnowledgePageClient`).
- No changes to chunking/retrieval or the H1/H2/H3 model.

## Testing
- Outline parsing: given markdown with N H2 sections, the outline lists exactly those N, in order; ignores H1/H3.
- Scroll-spy/active-section logic is unit-testable as a pure function (given scroll position + section offsets → active index).
- Existing save/publish/preview behavior unchanged — covered by existing tests; verify no regression.
- Manual verification in the running app (dev server) that toolbar and action header stay sticky, outline jumps work, and empty/loading states render.
