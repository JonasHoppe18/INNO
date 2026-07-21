# Knowledge Document Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the knowledge document editor (`KnowledgeDocumentEditorCard` + its editor internals) from a single scrolling card into a two-panel layout: a left section outline (scroll-spy navigation) and a center canvas with a sticky format toolbar and a sticky status/action header.

**Architecture:** Extract the existing Tiptap setup from `KnowledgeDocsEditor.jsx` into a reusable hook (`useKnowledgeDocsEditor`) plus two presentational pieces (`KnowledgeDocsToolbar`, `KnowledgeDocsCanvas`). Add a pure, unit-tested markdown outline parser (`knowledge-doc-outline.js`) that both the new `KnowledgeDocumentOutline` panel and the scroll-spy logic consume. Rewire `KnowledgeDocumentEditorCard.jsx` to compose these pieces inside a self-contained scrollable region (not the page/dashboard-shell scroll), so `position: sticky` has a deterministic scrolling ancestor.

**Tech Stack:** Next.js 14 App Router, React 18, Tiptap (`@tiptap/react`, `@tiptap/markdown`, `@tiptap/starter-kit`), Tailwind CSS, vitest (pure-logic tests only — this repo has no React Testing Library / component-test setup, see Global Constraints).

## Global Constraints

- Scope is the document editor only (`KnowledgeDocumentEditorCard`, `KnowledgeDocsEditor`, and their direct callers). Do NOT touch `KnowledgePageClient.jsx` (the knowledge hub) — out of scope per spec.
- No new editor capabilities (images, tables, etc.) — same Tiptap extensions as today.
- No right-hand metadata rail, no drag-to-reorder of sections — explicitly deferred per spec.
- The H2-heading toggle button in the toolbar stays a single toggle button — do NOT turn it into a Paragraph/Heading dropdown or expose H1/H3 in the toolbar.
- `vitest` in this repo only runs `**/__tests__/**/*.test.js` (see `apps/web/vitest.config.mjs`) — there is no component-test runner (no React Testing Library anywhere in the repo). Only pure, framework-free logic gets automated tests in this plan; DOM/Tiptap-wiring changes are verified via `npm run lint`, `npm run build`, and explicit manual dev-server steps instead of invented component tests.
- Follow existing code style: `"use client"` at the top of client components, relative imports (`./Foo`) for sibling files in `components/knowledge/`, `@/lib/...` for lib imports, Tailwind utility classes (no CSS modules), `cn()` from `@/lib/utils` for conditional classes.
- All commands below run from the repo root `/Users/jonashoppe/Developer/INNO/.claude/worktrees/ecstatic-ellis-6a36d0` unless noted; `npm` commands run with `--prefix apps/web`.

---

## File Structure

**New files:**
- `apps/web/lib/knowledge/knowledge-doc-outline.js` — pure markdown outline parsing + active-section math.
- `apps/web/lib/knowledge/__tests__/knowledge-doc-outline.test.js` — vitest tests for the above.
- `apps/web/lib/knowledge/use-knowledge-docs-editor.js` — Tiptap setup hook (extracted from `KnowledgeDocsEditor.jsx`), now also assigns stable DOM anchor ids to H2 nodes.
- `apps/web/components/knowledge/KnowledgeDocsToolbar.jsx` — format toolbar (extracted from `KnowledgeDocsEditor.jsx`).
- `apps/web/components/knowledge/KnowledgeDocsCanvas.jsx` — Tiptap `EditorContent` wrapper with prose styling (extracted from `KnowledgeDocsEditor.jsx`).
- `apps/web/components/knowledge/KnowledgeDocumentOutline.jsx` — new left-panel section outline component.

**Modified files:**
- `apps/web/components/knowledge/KnowledgeDocumentEditorCard.jsx` — rewired into the two-panel layout; owns the scroll container, scroll-spy, and section-jump behavior.
- `apps/web/components/knowledge/KnowledgeProductDetail.jsx` — demotes "View legacy snippets" from a competing header button to a small secondary link.
- `apps/web/app/globals.css` — adds the section-jump highlight-flash animation, following the existing `@keyframes` + `.animate-*` + reduced-motion convention already in this file.

**Deleted files:**
- `apps/web/components/knowledge/KnowledgeDocsEditor.jsx` — superseded by the hook + `KnowledgeDocsToolbar` + `KnowledgeDocsCanvas`.

---

### Task 1: Section outline parsing + active-section logic

**Files:**
- Create: `apps/web/lib/knowledge/knowledge-doc-outline.js`
- Test: `apps/web/lib/knowledge/__tests__/knowledge-doc-outline.test.js`

**Interfaces:**
- Produces: `sectionAnchorId(index: number): string` — returns `"knowledge-doc-section-<index>"`.
- Produces: `parseKnowledgeDocumentOutline(markdown: string): Array<{ id: string, index: number, title: string }>` — H2-only, in document order.
- Produces: `getActiveSectionId({ sectionTops: Array<{ id: string, top: number }>, scrollTop: number, offset?: number }): string | null`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/knowledge/__tests__/knowledge-doc-outline.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  getActiveSectionId,
  parseKnowledgeDocumentOutline,
  sectionAnchorId,
} from "../knowledge-doc-outline.js";

describe("parseKnowledgeDocumentOutline", () => {
  it("extracts H2 headings in order with stable anchor ids", () => {
    const markdown = [
      "# A-Blaze — Product Support",
      "",
      "## Product overview",
      "",
      "Some text.",
      "",
      "### Not a section",
      "",
      "## Cable and adapter compatibility",
    ].join("\n");

    expect(parseKnowledgeDocumentOutline(markdown)).toEqual([
      { id: "knowledge-doc-section-0", index: 0, title: "Product overview" },
      { id: "knowledge-doc-section-1", index: 1, title: "Cable and adapter compatibility" },
    ]);
  });

  it("ignores H1 and H3 headings", () => {
    const markdown = "# Title\n### Subsection\nBody text";
    expect(parseKnowledgeDocumentOutline(markdown)).toEqual([]);
  });

  it("returns an empty array for empty or missing markdown", () => {
    expect(parseKnowledgeDocumentOutline("")).toEqual([]);
    expect(parseKnowledgeDocumentOutline(undefined)).toEqual([]);
  });

  it("ignores a heading marker with no title text", () => {
    expect(parseKnowledgeDocumentOutline("## \nBody")).toEqual([]);
  });
});

describe("sectionAnchorId", () => {
  it("builds a stable, index-based anchor id", () => {
    expect(sectionAnchorId(0)).toBe("knowledge-doc-section-0");
    expect(sectionAnchorId(3)).toBe("knowledge-doc-section-3");
  });
});

describe("getActiveSectionId", () => {
  const sectionTops = [
    { id: "knowledge-doc-section-0", top: 0 },
    { id: "knowledge-doc-section-1", top: 400 },
    { id: "knowledge-doc-section-2", top: 900 },
  ];

  it("returns the first section before any scrolling has happened", () => {
    expect(getActiveSectionId({ sectionTops, scrollTop: 0, offset: 32 })).toBe(
      "knowledge-doc-section-0",
    );
  });

  it("returns the last section whose top is within the scroll threshold", () => {
    expect(getActiveSectionId({ sectionTops, scrollTop: 420, offset: 32 })).toBe(
      "knowledge-doc-section-1",
    );
  });

  it("returns the final section once scrolled past its top", () => {
    expect(getActiveSectionId({ sectionTops, scrollTop: 1000, offset: 0 })).toBe(
      "knowledge-doc-section-2",
    );
  });

  it("returns null when there are no sections", () => {
    expect(getActiveSectionId({ sectionTops: [], scrollTop: 0 })).toBeNull();
  });

  it("is resilient to unsorted input", () => {
    const shuffled = [sectionTops[2], sectionTops[0], sectionTops[1]];
    expect(getActiveSectionId({ sectionTops: shuffled, scrollTop: 420, offset: 32 })).toBe(
      "knowledge-doc-section-1",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix apps/web run test -- knowledge-doc-outline`
Expected: FAIL — `Cannot find module '../knowledge-doc-outline.js'` (or similar resolution error), since the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/knowledge/knowledge-doc-outline.js`:

```js
const SECTION_ANCHOR_PREFIX = "knowledge-doc-section-";

// Line-based heading scan. Knowledge documents in this editor are prose,
// lists, and headings — not code documentation — so a "## " line inside a
// code fence is not an expected input and is intentionally not special-cased.
const H2_LINE_PATTERN = /^##(?!#)\s+(.+?)\s*#*\s*$/;

export function sectionAnchorId(index) {
  return `${SECTION_ANCHOR_PREFIX}${index}`;
}

export function parseKnowledgeDocumentOutline(markdown) {
  const lines = String(markdown || "").split("\n");
  const sections = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(H2_LINE_PATTERN);
    if (!match) continue;
    const title = match[1].trim();
    if (!title) continue;
    sections.push({
      id: sectionAnchorId(sections.length),
      index: sections.length,
      title,
    });
  }
  return sections;
}

export function getActiveSectionId({ sectionTops, scrollTop, offset = 0 }) {
  const items = Array.isArray(sectionTops)
    ? sectionTops.filter((item) => item && typeof item.id === "string")
    : [];
  if (!items.length) return null;

  const sorted = [...items].sort((a, b) => Number(a.top) - Number(b.top));
  const threshold = Number(scrollTop || 0) + Number(offset || 0);

  let active = sorted[0].id;
  for (const item of sorted) {
    if (Number(item.top) <= threshold) {
      active = item.id;
    } else {
      break;
    }
  }
  return active;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix apps/web run test -- knowledge-doc-outline`
Expected: PASS — all `describe` blocks green (11 assertions across 3 `describe` groups).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/knowledge/knowledge-doc-outline.js apps/web/lib/knowledge/__tests__/knowledge-doc-outline.test.js
git commit -m "feat(knowledge): add pure section-outline parsing and scroll-spy math"
```

---

### Task 2: Extract the Tiptap editor hook with section anchor ids

**Files:**
- Create: `apps/web/lib/knowledge/use-knowledge-docs-editor.js`
- Modify (read-only reference, no edits yet): `apps/web/components/knowledge/KnowledgeDocsEditor.jsx` (this task copies its editor-setup logic; the file itself is deleted in Task 7 once nothing imports it)

**Interfaces:**
- Consumes: `sectionAnchorId(index: number): string` from `apps/web/lib/knowledge/knowledge-doc-outline.js` (Task 1).
- Consumes: `parseKnowledgeDocumentMarkdownPaste` from `apps/web/lib/knowledge/knowledge-doc-markdown-paste.js` (existing).
- Consumes: `normalizeKnowledgeDocumentMarkdown` from `apps/web/lib/knowledge/knowledge-doc-markdown-roundtrip.js` (existing).
- Produces: `useKnowledgeDocsEditor({ value: string, onChange: (markdown: string) => void }): { editor: Editor | null }` — the same Tiptap `editor` instance previously created inline in `KnowledgeDocsEditor.jsx`, with the addition that every H2 node in the rendered DOM gets `id = sectionAnchorId(indexAmongH2s)` after creation, after every update, and after external content syncs.

There is no automated test for this task (see Global Constraints — no Tiptap/DOM component-test infra in this repo). Verification is `npm run lint` plus a manual check in Task 5 once the hook is wired into the page.

- [ ] **Step 1: Create the hook**

Create `apps/web/lib/knowledge/use-knowledge-docs-editor.js`:

```js
"use client";

import { useEffect } from "react";
import { useEditor } from "@tiptap/react";
import { Fragment, Slice } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { parseKnowledgeDocumentMarkdownPaste } from "@/lib/knowledge/knowledge-doc-markdown-paste";
import { normalizeKnowledgeDocumentMarkdown } from "@/lib/knowledge/knowledge-doc-markdown-roundtrip";
import { sectionAnchorId } from "@/lib/knowledge/knowledge-doc-outline";

const extensions = [
  StarterKit.configure({
    heading: {
      levels: [1, 2, 3],
    },
    link: {
      openOnClick: false,
      autolink: true,
    },
  }),
  Markdown,
];

function assignSectionAnchorIds(editor) {
  if (!editor) return;
  const headings = editor.view.dom.querySelectorAll("h2");
  headings.forEach((heading, index) => {
    heading.id = sectionAnchorId(index);
  });
}

export function useKnowledgeDocsEditor({ value, onChange }) {
  const editor = useEditor({
    extensions,
    content: value || "",
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "min-h-[520px] px-8 py-7 outline-none",
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain") || "";
        const pastedContent = parseKnowledgeDocumentMarkdownPaste(text);
        if (!pastedContent) return false;

        event.preventDefault();
        const nodes = pastedContent.map((node) => view.state.schema.nodeFromJSON(node));
        const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
    onCreate({ editor: createdEditor }) {
      assignSectionAnchorIds(createdEditor);
    },
    onUpdate({ editor: updatedEditor }) {
      onChange?.(normalizeKnowledgeDocumentMarkdown(updatedEditor.getMarkdown()));
      assignSectionAnchorIds(updatedEditor);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const next = String(value || "");
    if (normalizeKnowledgeDocumentMarkdown(editor.getMarkdown()) === next) return;
    editor.commands.setContent(next, {
      contentType: "markdown",
      emitUpdate: false,
    });
    assignSectionAnchorIds(editor);
  }, [editor, value]);

  return { editor };
}
```

- [ ] **Step 2: Lint**

Run: `npm --prefix apps/web run lint -- --file lib/knowledge/use-knowledge-docs-editor.js`
Expected: no errors. (If the `--file` flag isn't supported by the installed `next lint` version, run the full `npm --prefix apps/web run lint` instead — expected: no new errors attributable to this file.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/knowledge/use-knowledge-docs-editor.js
git commit -m "refactor(knowledge): extract Tiptap setup into useKnowledgeDocsEditor hook"
```

---

### Task 3: Extract the toolbar and canvas components

**Files:**
- Create: `apps/web/components/knowledge/KnowledgeDocsToolbar.jsx`
- Create: `apps/web/components/knowledge/KnowledgeDocsCanvas.jsx`

**Interfaces:**
- Consumes: `SECTION_HEADING_LEVEL`, `SECTION_HEADING_TOOLTIP` from `apps/web/lib/knowledge/knowledge-doc-editor-config.js` (existing).
- Consumes: `cn` from `@/lib/utils` (existing).
- Produces: `KnowledgeDocsToolbar({ editor: Editor | null }): JSX.Element` — same 6 actions as before (Bold, Italic, H2 section toggle, bullet list, ordered list, link), same button behavior.
- Produces: `KnowledgeDocsCanvas({ editor: Editor | null }): JSX.Element` — renders `<EditorContent editor={editor} />` with the existing prose styling, plus `scroll-mt-28` on H2 so `scrollIntoView` (Task 5) doesn't tuck a section under the sticky header.

No automated test (presentational Tiptap-consuming components — see Global Constraints). Verified via `npm run lint` now and manual check in Task 5.

- [ ] **Step 1: Create the toolbar component**

Create `apps/web/components/knowledge/KnowledgeDocsToolbar.jsx`:

```jsx
"use client";

import {
  Bold,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SECTION_HEADING_LEVEL,
  SECTION_HEADING_TOOLTIP,
} from "@/lib/knowledge/knowledge-doc-editor-config";

function ToolbarButton({ active, disabled, label, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100",
        active && "border-gray-200 bg-gray-100 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function KnowledgeDocsToolbar({ editor }) {
  const disabled = !editor;

  const setLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href || "";
    const url = window.prompt("Link URL", previousUrl);
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-gray-50/80 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/60">
      <ToolbarButton
        label="Bold"
        icon={Bold}
        disabled={disabled}
        active={editor?.isActive("bold")}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label="Italic"
        icon={Italic}
        disabled={disabled}
        active={editor?.isActive("italic")}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label={SECTION_HEADING_TOOLTIP}
        icon={Heading2}
        disabled={disabled}
        active={editor?.isActive("heading", { level: SECTION_HEADING_LEVEL })}
        onClick={() => editor?.chain().focus().toggleHeading({ level: SECTION_HEADING_LEVEL }).run()}
      />
      <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-800" />
      <ToolbarButton
        label="Bullet list"
        icon={List}
        disabled={disabled}
        active={editor?.isActive("bulletList")}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="Ordered list"
        icon={ListOrdered}
        disabled={disabled}
        active={editor?.isActive("orderedList")}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        label="Link"
        icon={Link}
        disabled={disabled}
        active={editor?.isActive("link")}
        onClick={setLink}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create the canvas component**

Create `apps/web/components/knowledge/KnowledgeDocsCanvas.jsx`:

```jsx
"use client";

import { EditorContent } from "@tiptap/react";
import { cn } from "@/lib/utils";

export function KnowledgeDocsCanvas({ editor }) {
  return (
    <EditorContent
      editor={editor}
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert",
        "[&_.ProseMirror_h1]:mb-5 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-semibold",
        "[&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:mt-7 [&_.ProseMirror_h2]:border-b [&_.ProseMirror_h2]:pb-2 [&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:scroll-mt-28 dark:[&_.ProseMirror_h2]:border-gray-800",
        "[&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-5 [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold",
        "[&_.ProseMirror_p]:my-3 [&_.ProseMirror_p]:leading-7",
        "[&_.ProseMirror_ul]:my-3 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6",
        "[&_.ProseMirror_ol]:my-3 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6",
        "[&_.ProseMirror_li]:my-1 [&_.ProseMirror_li>p]:my-1",
        "[&_.ProseMirror_a]:text-indigo-600 [&_.ProseMirror_a]:underline dark:[&_.ProseMirror_a]:text-indigo-400",
        "[&_.ProseMirror]:text-[14px] [&_.ProseMirror]:text-gray-800 dark:[&_.ProseMirror]:text-gray-100",
      )}
    />
  );
}
```

- [ ] **Step 3: Lint**

Run: `npm --prefix apps/web run lint`
Expected: no new errors attributable to `KnowledgeDocsToolbar.jsx` or `KnowledgeDocsCanvas.jsx`. (`KnowledgeDocsEditor.jsx` still exists and is still wired into `KnowledgeDocumentEditorCard.jsx` at this point, so the app still builds — these two new files are not imported anywhere yet.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/knowledge/KnowledgeDocsToolbar.jsx apps/web/components/knowledge/KnowledgeDocsCanvas.jsx
git commit -m "refactor(knowledge): extract toolbar and canvas from KnowledgeDocsEditor"
```

---

### Task 4: Section outline panel component

**Files:**
- Create: `apps/web/components/knowledge/KnowledgeDocumentOutline.jsx`

**Interfaces:**
- Consumes: the `{ id, index, title }` shape produced by `parseKnowledgeDocumentOutline` (Task 1) as its `sections` prop — this task does not import that function, it only relies on the shape.
- Consumes: `Skeleton` from `@/components/ui/skeleton` (existing), `cn` from `@/lib/utils` (existing).
- Produces: `KnowledgeDocumentOutline({ sections: Array<{ id: string, title: string }>, activeSectionId: string | null, onSelectSection: (id: string) => void, loading?: boolean }): JSX.Element`.

No automated test (presentational component, no RTL infra — see Global Constraints). Verified via `npm run lint` now and visually in Task 5's manual check.

- [ ] **Step 1: Create the component**

Create `apps/web/components/knowledge/KnowledgeDocumentOutline.jsx`:

```jsx
"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function KnowledgeDocumentOutline({
  sections,
  activeSectionId,
  onSelectSection,
  loading = false,
}) {
  if (loading) {
    return (
      <div className="h-full space-y-2 rounded-xl border bg-card p-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }

  const items = Array.isArray(sections) ? sections : [];

  return (
    <div className="flex h-full flex-col rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sections
          </h3>
          <span className="text-xs text-muted-foreground">{items.length}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Each section heading below becomes a focused knowledge unit the AI retrieves from.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-xs text-muted-foreground">
          Add a section heading to structure this guide.
        </p>
      ) : (
        <nav className="flex-1 overflow-y-auto p-2">
          {items.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelectSection?.(section.id)}
              title={section.title}
              className={cn(
                "block w-full truncate rounded-md px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                activeSectionId === section.id && "bg-muted font-medium text-foreground",
              )}
            >
              {section.title}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npm --prefix apps/web run lint`
Expected: no new errors attributable to `KnowledgeDocumentOutline.jsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/knowledge/KnowledgeDocumentOutline.jsx
git commit -m "feat(knowledge): add KnowledgeDocumentOutline left-panel component"
```

---

### Task 5: Rewire KnowledgeDocumentEditorCard into the two-panel layout

**Files:**
- Modify: `apps/web/components/knowledge/KnowledgeDocumentEditorCard.jsx` (full rewrite of the body; data-loading logic and API calls are unchanged)
- Modify: `apps/web/app/globals.css` (append the section-highlight animation)

**Interfaces:**
- Consumes: `useKnowledgeDocsEditor` from `@/lib/knowledge/use-knowledge-docs-editor` (Task 2) — `{ editor }`.
- Consumes: `parseKnowledgeDocumentOutline`, `getActiveSectionId` from `@/lib/knowledge/knowledge-doc-outline` (Task 1).
- Consumes: `KnowledgeDocsToolbar` (Task 3), `KnowledgeDocsCanvas` (Task 3), `KnowledgeDocumentOutline` (Task 4).
- Consumes: `getKnowledgeDocumentPreviewBlockedReason`, `buildKnowledgeDocumentSimulationHref` from `@/lib/knowledge/knowledge-doc-preview-actions` (existing, unchanged).
- Consumes: `SnippetPreviewModal` from `./SnippetPreviewModal` (existing, unchanged).
- Produces: `KnowledgeDocumentEditorCard` keeps its existing exported prop signature — `{ shopId, onShopId, category, documentType, title, description, helperText, allowPublish }` — unchanged, so `KnowledgeProductDetail.jsx` and `KnowledgeCategoryDetail.jsx` need no prop-shape changes.

- [ ] **Step 1: Add the section-highlight animation to globals.css**

Read `apps/web/app/globals.css` around the existing `@keyframes inbox-drop-pulse` block (search for `inbox-drop-pulse`) to confirm the insertion point, then add immediately after that block's closing `@media (prefers-reduced-motion: reduce) { ... }`:

```css
/* Knowledge doc section jump — brief flash when navigating to a section via the outline. */
@keyframes knowledge-doc-section-flash {
  0% {
    background-color: hsl(var(--primary) / 0.14);
  }
  100% {
    background-color: transparent;
  }
}

.animate-knowledge-doc-section-flash {
  animation: knowledge-doc-section-flash 900ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .animate-knowledge-doc-section-flash {
    animation: none;
  }
}
```

- [ ] **Step 2: Rewrite KnowledgeDocumentEditorCard.jsx**

Replace the full contents of `apps/web/components/knowledge/KnowledgeDocumentEditorCard.jsx` with:

```jsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  buildKnowledgeDocumentSimulationHref,
  getKnowledgeDocumentPreviewBlockedReason,
} from "@/lib/knowledge/knowledge-doc-preview-actions";
import {
  getActiveSectionId,
  parseKnowledgeDocumentOutline,
} from "@/lib/knowledge/knowledge-doc-outline";
import { useKnowledgeDocsEditor } from "@/lib/knowledge/use-knowledge-docs-editor";
import { SnippetPreviewModal } from "./SnippetPreviewModal";
import { KnowledgeDocumentOutline } from "./KnowledgeDocumentOutline";
import { KnowledgeDocsToolbar } from "./KnowledgeDocsToolbar";
import { KnowledgeDocsCanvas } from "./KnowledgeDocsCanvas";

const EDITOR_SCROLL_HEIGHT_CLASS = "max-h-[75vh] min-h-[420px]";
const SECTION_SCROLL_SPY_OFFSET = 32;
const SECTION_HIGHLIGHT_CLASS = "animate-knowledge-doc-section-flash";
const SECTION_HIGHLIGHT_DURATION_MS = 900;

function statusLabel({ isDirty, document }) {
  if (isDirty) return "Unsaved changes";
  if (document?.has_unpublished_changes) return "Unpublished changes";
  if (document?.published_at) return "Published";
  return "Saved";
}

export function KnowledgeDocumentEditorCard({
  shopId,
  onShopId,
  category,
  documentType,
  title,
  description,
  helperText = "Use section headings to organise the guide. Each section heading becomes a focused knowledge section for the AI.",
  allowPublish = true,
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [document, setDocument] = useState(null);
  const [value, setValue] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [activeSectionId, setActiveSectionId] = useState(null);

  const scrollRootRef = useRef(null);
  const sectionsRef = useRef([]);

  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/knowledge/documents?category=${encodeURIComponent(category)}&document_type=${encodeURIComponent(documentType)}${shopId ? `&shop_id=${encodeURIComponent(shopId)}` : ""}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not load document.");
      setDocument(data.document);
      setValue(data.document?.draft_markdown || "");
      setSavedValue(data.document?.draft_markdown || "");
      if (data?.shop_id) onShopId?.(data.shop_id);
    } catch (err) {
      setError(err.message || "Could not load document.");
    } finally {
      setLoading(false);
    }
  }, [shopId, onShopId, category, documentType]);

  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  const { editor } = useKnowledgeDocsEditor({
    value,
    onChange: (markdown) => {
      setValue(markdown);
      setPreviewError("");
    },
  });

  const sections = useMemo(() => parseKnowledgeDocumentOutline(value), [value]);

  useEffect(() => {
    sectionsRef.current = sections;
    setActiveSectionId((current) => {
      if (current && sections.some((section) => section.id === current)) return current;
      return sections[0]?.id || null;
    });
  }, [sections]);

  useEffect(() => {
    const container = scrollRootRef.current;
    if (!container) return undefined;

    const handleScroll = () => {
      const currentSections = sectionsRef.current;
      if (!currentSections.length) {
        setActiveSectionId(null);
        return;
      }
      const containerTop = container.getBoundingClientRect().top;
      const sectionTops = currentSections
        .map((section) => {
          const el = window.document.getElementById(section.id);
          if (!el) return null;
          return {
            id: section.id,
            top: el.getBoundingClientRect().top - containerTop + container.scrollTop,
          };
        })
        .filter(Boolean);
      const nextActive = getActiveSectionId({
        sectionTops,
        scrollTop: container.scrollTop,
        offset: SECTION_SCROLL_SPY_OFFSET,
      });
      setActiveSectionId(nextActive);
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = useCallback((sectionId) => {
    const container = scrollRootRef.current;
    const target = window.document.getElementById(sectionId);
    if (!container || !target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add(SECTION_HIGHLIGHT_CLASS);
    window.setTimeout(() => {
      target.classList.remove(SECTION_HIGHLIGHT_CLASS);
    }, SECTION_HIGHLIGHT_DURATION_MS);
    setActiveSectionId(sectionId);
  }, []);

  const isDirty = value !== savedValue;
  const previewBlockedReason = getKnowledgeDocumentPreviewBlockedReason({
    documentId: document?.id,
    isDirty,
  });
  const canPreview = !previewBlockedReason;
  const currentStatus = statusLabel({ isDirty, document });

  const saveDraft = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/knowledge/documents", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(shopId ? { shop_id: shopId } : {}),
          category,
          document_type: documentType,
          title,
          draft_markdown: value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save document.");
      setDocument(data.document);
      setSavedValue(data.document?.draft_markdown || value);
      setPreviewError("");
      toast.success("Knowledge document saved");
    } catch (err) {
      setError(err.message || "Could not save document.");
      toast.error(err.message || "Could not save document.");
    } finally {
      setSaving(false);
    }
  };

  const publishDraft = async () => {
    setPublishing(true);
    setError("");
    try {
      const res = await fetch("/api/knowledge/documents", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(shopId ? { shop_id: shopId } : {}),
          action: "publish",
          category,
          document_type: documentType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not publish document.");
      setDocument(data.document);
      setSavedValue(data.document?.draft_markdown || value);
      setValue(data.document?.draft_markdown || value);
      toast.success("Knowledge document published");
    } catch (err) {
      setError(err.message || "Could not publish document.");
      toast.error(err.message || "Could not publish document.");
    } finally {
      setPublishing(false);
    }
  };

  const openTicketPreview = () => {
    if (!canPreview) {
      setPreviewError(previewBlockedReason);
      toast.error(previewBlockedReason);
      return;
    }
    setPreviewError("");
    setPreviewOpen(true);
  };

  const openSimulation = () => {
    if (!canPreview) {
      setPreviewError(previewBlockedReason);
      toast.error(previewBlockedReason);
      return;
    }
    setPreviewError("");
    router.push(buildKnowledgeDocumentSimulationHref(document.id));
  };

  if (loading) {
    return (
      <div className="flex gap-6">
        <div className="hidden w-60 shrink-0 md:block">
          <KnowledgeDocumentOutline
            loading
            sections={[]}
            activeSectionId={null}
            onSelectSection={() => {}}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-card">
          <div className="space-y-2 border-b px-6 py-5">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="space-y-2 px-6 py-5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-6">
        <div className="hidden w-60 shrink-0 md:block">
          <KnowledgeDocumentOutline
            sections={sections}
            activeSectionId={activeSectionId}
            onSelectSection={scrollToSection}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-card">
          <div ref={scrollRootRef} className={cn("overflow-y-auto", EDITOR_SCROLL_HEIGHT_CLASS)}>
            <div className="sticky top-0 z-20 bg-card">
              <div className="flex flex-col gap-4 border-b px-6 py-5 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{title}</h2>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {currentStatus}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openTicketPreview}
                      title={previewBlockedReason || "Run an A/B preview against a ticket"}
                    >
                      Test against ticket
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openSimulation}
                      title={previewBlockedReason || "Open simulation with this draft document preview"}
                    >
                      Simulate conversation
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {allowPublish && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={publishDraft}
                        disabled={publishing || isDirty || !document?.id}
                      >
                        {publishing ? "Publishing..." : "Publish"}
                      </Button>
                    )}
                    <Button type="button" size="sm" onClick={saveDraft} disabled={saving || !isDirty}>
                      {saving ? "Saving..." : "Save changes"}
                    </Button>
                  </div>
                </div>
              </div>
              <KnowledgeDocsToolbar editor={editor} />
            </div>
            <div className="px-6 py-5">
              <p className="mb-3 text-xs text-muted-foreground">{helperText}</p>
              {error && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  {error}
                </div>
              )}
              {previewError && (
                <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                  {previewError}
                </div>
              )}
              <KnowledgeDocsCanvas editor={editor} />
            </div>
          </div>
        </div>
      </div>
      {document?.id && (
        <SnippetPreviewModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          previewDocumentId={document.id}
          previewTitle={title}
        />
      )}
    </>
  );
}
```

Note: `document` here is the component's own state variable (same as in the original file, pre-existing shadowing of the global `document`), which is why every DOM lookup in this file explicitly uses `window.document.getElementById(...)` rather than bare `document.getElementById(...)`.

- [ ] **Step 3: Lint**

Run: `npm --prefix apps/web run lint`
Expected: no new errors attributable to `KnowledgeDocumentEditorCard.jsx` or `globals.css`.

- [ ] **Step 4: Manual verification in the dev server**

The dev server for this repo is started via the Browser pane (`preview_start` with a `.claude/launch.json` entry named e.g. `"web"` running `npm run dev --prefix apps/web` on its configured port) — do not start it with the plain `Bash` tool.

Once running, navigate to a product's knowledge document (e.g. `/knowledge/product-questions/<some-product-id>`) and confirm:
1. Left panel lists every `## `-level section in the loaded document, in order, with a count matching the number of sections.
2. Clicking a section in the outline smooth-scrolls the canvas to that heading and briefly flashes its background (the `knowledge-doc-section-flash` animation).
3. Scrolling the canvas manually updates the highlighted item in the outline to match the section currently in view.
4. The status pill + Test/Simulate/Publish/Save row and the format toolbar both stay pinned to the top of the card while the canvas scrolls underneath them.
5. Typing in the canvas still updates the outline (add a new `## ` line, confirm it appears in the left panel; delete it, confirm it disappears).
6. Save changes / Publish / Test against ticket / Simulate conversation all still work exactly as before (unchanged network calls — confirm via `read_network_requests` or toasts).
7. On a narrow viewport (`resize_window` to `mobile` preset) the outline panel hides (`hidden md:block`) and the canvas remains usable full-width.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/knowledge/KnowledgeDocumentEditorCard.jsx apps/web/app/globals.css
git commit -m "feat(knowledge): two-panel document editor with section outline and sticky header"
```

---

### Task 6: Demote "View legacy snippets" in KnowledgeProductDetail

**Files:**
- Modify: `apps/web/components/knowledge/KnowledgeProductDetail.jsx`

**Interfaces:**
- No new interfaces — purely a JSX/markup change within the existing component. `KnowledgeProductDetail`'s own exported signature (`{ productId, productTitle }`) is unchanged.

- [ ] **Step 1: Rewrite the header markup**

In `apps/web/components/knowledge/KnowledgeProductDetail.jsx`, replace the block from the `return (` of the non-legacy view (the second `return`, currently lines 52–88) with:

```jsx
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
        >
          <Link href="/knowledge/product-questions">
            <ArrowLeft className="h-4 w-4" />
            Back to products
          </Link>
        </Button>
        <button
          type="button"
          onClick={() => setView("legacy")}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          View legacy snippets
        </button>
      </div>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold leading-tight">{productTitle || "Product"}</h1>
        <p className="text-sm text-muted-foreground">
          Maintain this product&apos;s support document. Legacy snippets remain available as reference.
        </p>
      </div>
      <KnowledgeDocumentEditorCard
        shopId={shopId}
        onShopId={setShopId}
        category={PRODUCT_SUPPORT_CATEGORY}
        documentType={productSupportDocumentTypeForScope(productScope)}
        title={`${productTitle || "Product"} — Product Support`}
        description="Product-specific support guide with troubleshooting sections. Publish to make it live for the AI."
        helperText="Create section headings for the topics relevant to this product. Each section heading becomes a focused knowledge section for the AI."
        allowPublish={true}
      />
    </div>
  );
}
```

The rest of the file (imports, the `view === "legacy"` early return, the `productScope`/`headerIcon` computations) is unchanged.

- [ ] **Step 2: Lint**

Run: `npm --prefix apps/web run lint`
Expected: no new errors attributable to `KnowledgeProductDetail.jsx`.

- [ ] **Step 3: Manual verification in the dev server**

On a product's knowledge page, confirm "View legacy snippets" now renders as a small text link at the top-right of the breadcrumb row (not a prominent bordered button), and clicking it still switches to the legacy `SnippetTwoPanel` view exactly as before.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/knowledge/KnowledgeProductDetail.jsx
git commit -m "style(knowledge): demote legacy-snippets link so it doesn't compete with editor actions"
```

---

### Task 7: Remove the superseded editor file and do a full regression pass

**Files:**
- Delete: `apps/web/components/knowledge/KnowledgeDocsEditor.jsx`

**Interfaces:** None — this task only removes dead code and verifies the whole app still builds and tests pass.

- [ ] **Step 1: Confirm nothing still imports the old file**

Run: `grep -rn "KnowledgeDocsEditor" apps/web --include="*.jsx" --include="*.js"`
Expected: no matches (Task 5 already replaced the only import site in `KnowledgeDocumentEditorCard.jsx` with `KnowledgeDocsToolbar` + `KnowledgeDocsCanvas` + `useKnowledgeDocsEditor`).

- [ ] **Step 2: Delete the file**

```bash
git rm apps/web/components/knowledge/KnowledgeDocsEditor.jsx
```

- [ ] **Step 3: Run the full test suite**

Run: `npm --prefix apps/web run test`
Expected: PASS — including the `knowledge-doc-outline.test.js` suite from Task 1 and every pre-existing suite (e.g. `knowledge-doc-chunks.test.ts`-style suites are Deno/node:test and not part of this vitest run per `vitest.config.mjs`; the vitest run covers `**/__tests__/**/*.test.js`).

- [ ] **Step 4: Run the production build**

Run: `npm --prefix apps/web run build`
Expected: build succeeds with no type/import errors — this is the strongest automated signal that the hook/toolbar/canvas extraction and the deleted file are wired correctly end-to-end.

- [ ] **Step 5: Manual regression pass across all three consumers**

Using the Browser pane against the running dev server:
1. `/knowledge/product-questions/<product-id>` — product support document (verified in Task 5; re-confirm after the delete).
2. `/knowledge/returns` — `KnowledgeCategoryDetail` renders `KnowledgeDocumentEditorCard` for the returns policy document; confirm the two-panel layout, outline, and sticky header all work there too.
3. `/knowledge/general` — `KnowledgeCategoryDetail` renders `KnowledgeDocumentEditorCard` for the general knowledge document; same confirmation.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(knowledge): remove superseded KnowledgeDocsEditor after two-panel rollout"
```

---

## Plan Self-Review Notes

- **Spec coverage:** Two-panel layout (Tasks 4–5) · left outline as read-only scroll-spy navigation, no drag-reorder (Task 1 + 4, explicitly excluded in Global Constraints) · sticky format toolbar including the kept H2 single-toggle button (Tasks 3, 5) · sticky action header with status pill + Save/Publish/Test/Simulate (Task 5) · legacy-snippets demoted (Task 6) · empty/loading states for the outline (Task 4) and the card (Task 5) · no right rail, no new editor capabilities, no hub changes (Global Constraints + confirmed no edits to `KnowledgePageClient.jsx` anywhere in this plan).
- **Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code or an exact command with expected output.
- **Type/name consistency:** `sectionAnchorId`, `parseKnowledgeDocumentOutline`, `getActiveSectionId` (Task 1) are imported with identical names and signatures in Task 2 (`use-knowledge-docs-editor.js`) and Task 5 (`KnowledgeDocumentEditorCard.jsx`). `useKnowledgeDocsEditor({ value, onChange }) → { editor }` (Task 2) is called identically in Task 5. `KnowledgeDocsToolbar({ editor })` and `KnowledgeDocsCanvas({ editor })` (Task 3) match their usage in Task 5. `KnowledgeDocumentOutline({ sections, activeSectionId, onSelectSection, loading })` (Task 4) matches its usage in Task 5.
