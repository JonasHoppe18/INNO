# Sona Activity Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty "Sona activity" dialog with a four-section diagnostic modal showing why a draft was written, which KB chunks were retrieved, which previous emails matched, and what knowledge is missing.

**Architecture:** The pipeline logs a new `retrieval_completed` step with full chunk data and ticket examples after each draft. The insights API extracts these logs and returns structured `diagnostic` data. A new `SonaActivityContent` component renders the four sections, replacing the current empty dialog body in `SonaInsightsModal`.

**Tech Stack:** Deno/TypeScript (Edge Functions), Next.js 14 App Router, React 18, Supabase, Tailwind CSS, shadcn/ui primitives.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/generate-draft-v2/stages/retriever.ts` | Modify | Add `subject` + `score` to `RetrieverResult.past_ticket_examples` |
| `supabase/functions/generate-draft-v2/pipeline.ts` | Modify | Log `retrieval_completed` step after retrieval |
| `apps/web/app/api/threads/[threadId]/insights/route.js` | Modify | Extract + return structured `diagnostic` from logs |
| `apps/web/components/inbox/SonaActivityContent.jsx` | **Create** | Four-section diagnostic component |
| `apps/web/components/inbox/SonaInsightsModal.jsx` | Modify | Use `SonaActivityContent` in dialog; update card subtitle |

---

## Task 1: Add subject + score to ticket examples in retriever

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/retriever.ts:23-31` (RetrieverResult interface)
- Modify: `supabase/functions/generate-draft-v2/stages/retriever.ts:497-509` (return mapping)

- [ ] **Step 1: Update RetrieverResult interface**

In `retriever.ts`, replace lines 23–31:

```typescript
export interface RetrieverResult {
  chunks: RetrievedChunk[];
  past_ticket_examples: Array<{
    customer_msg: string;
    agent_reply: string;
    subject: string | null;
    score: number;
    csat_score: number | null;
    conversation_context: string | null;
  }>;
}
```

- [ ] **Step 2: Update return mapping to include subject and score**

In `retriever.ts`, replace lines 497–509 (the `.map()` inside the ticket lookup):

```typescript
return [...resultMap.values()]
  .filter((item) =>
    item.agent_reply && item.agent_reply.length > 20 &&
    item.score >= 0.45
  )
  .sort((a, b) => b.score - a.score)
  .slice(0, 3)
  .map((item) => ({
    customer_msg: item.customer_msg,
    agent_reply: item.agent_reply,
    subject: item.subject ?? null,
    score: item.score,
    csat_score: item.csat_score,
    conversation_context: item.conversation_context ?? null,
  }));
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/jonashoppe/Developer/INNO
npx supabase functions serve generate-draft-v2 --no-verify-jwt 2>&1 | head -20
```

Expected: no TypeScript errors (Ctrl-C after a few seconds).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-draft-v2/stages/retriever.ts
git commit -m "feat(retriever): include subject and score in ticket example results"
```

---

## Task 2: Log retrieval_completed step in pipeline

**Files:**
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts:840-860` (after retrieval completes)

- [ ] **Step 1: Write a test for the log shape**

Create `supabase/functions/generate-draft-v2/stages/retrieval-log.test.ts`:

```typescript
import { assertEquals } from "jsr:@std/assert@1";

// Pure helper we'll extract in the next step
import { buildRetrievalLogPayload } from "./retrieval-log.ts";

Deno.test("buildRetrievalLogPayload truncates chunk content to 600 chars", () => {
  const longContent = "x".repeat(800);
  const result = buildRetrievalLogPayload(
    "thread-1",
    [{ id: "c1", content: longContent, source_label: "Policy", similarity: 0.9, kind: "policy", usable_as: "policy", risk_flags: [] }],
    [],
  );
  const parsed = JSON.parse(result.step_detail);
  assertEquals(parsed.kb_chunks[0].content.length, 600);
});

Deno.test("buildRetrievalLogPayload caps at 8 chunks", () => {
  const chunks = Array.from({ length: 12 }, (_, i) => ({
    id: `c${i}`, content: "hello", source_label: "X", similarity: 0.8,
    kind: "policy", usable_as: "policy" as const, risk_flags: [],
  }));
  const result = buildRetrievalLogPayload("thread-1", chunks, []);
  const parsed = JSON.parse(result.step_detail);
  assertEquals(parsed.kb_chunks.length, 8);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jonashoppe/Developer/INNO
deno test supabase/functions/generate-draft-v2/stages/retrieval-log.test.ts 2>&1 | head -20
```

Expected: error — `retrieval-log.ts` does not exist yet.

- [ ] **Step 3: Create retrieval-log.ts helper**

Create `supabase/functions/generate-draft-v2/stages/retrieval-log.ts`:

```typescript
import type { RetrievedChunk, RetrieverResult } from "./retriever.ts";

export interface RetrievalLogPayload {
  step_name: "retrieval_completed";
  step_detail: string;
  status: "info";
}

export function buildRetrievalLogPayload(
  thread_id: string,
  chunks: RetrievedChunk[],
  ticket_examples: RetrieverResult["past_ticket_examples"],
): RetrievalLogPayload {
  return {
    step_name: "retrieval_completed",
    status: "info",
    step_detail: JSON.stringify({
      thread_id,
      kb_chunks: chunks.slice(0, 8).map((c) => ({
        id: c.id,
        title: c.source_label,
        content: c.content.slice(0, 600),
        score: c.similarity,
        usable_as: c.usable_as,
        kind: c.kind,
      })),
      ticket_examples: ticket_examples.slice(0, 3).map((t) => ({
        subject: t.subject ?? null,
        score: t.score,
        customer_msg: t.customer_msg.slice(0, 400),
        agent_reply: t.agent_reply.slice(0, 600),
      })),
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
deno test supabase/functions/generate-draft-v2/stages/retrieval-log.test.ts 2>&1
```

Expected: `ok | 2 passed | 0 failed`

- [ ] **Step 5: Insert log in pipeline.ts after retrieval**

First add a static import at the top of `pipeline.ts` alongside the other stage imports (around line 5–14):

```typescript
import { buildRetrievalLogPayload } from "./stages/retrieval-log.ts";
```

Then find the block after line 840 that starts with `if (!eval_payload && thread_id) {` and logs `draft_context_loaded`. Add the `retrieval_completed` log **inside the same guard** immediately after:

```typescript
  // After the existing draft_context_loaded log block (around line 843-858):
  if (!eval_payload && thread_id) {
    const logPayload = buildRetrievalLogPayload(
      thread_id,
      retrieved.chunks,
      retrieved.past_ticket_examples,
    );
    supabase.from("agent_logs").insert({
      draft_id: draftId,
      ...logPayload,
      created_at: new Date().toISOString(),
    }).then(({ error }) => {
      if (error) console.warn("[pipeline] retrieval_completed log failed:", error.message);
    });
  }
```

Place this block immediately after the closing `});` of the `draft_context_loaded` insert (around line 858 in the original file). It must be outside that `.then()` — at the same indentation level as the `draft_context_loaded` guard.

- [ ] **Step 6: Verify no TypeScript errors**

```bash
npx supabase functions serve generate-draft-v2 --no-verify-jwt 2>&1 | head -20
```

Expected: server starts, no type errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/generate-draft-v2/stages/retrieval-log.ts \
        supabase/functions/generate-draft-v2/stages/retrieval-log.test.ts \
        supabase/functions/generate-draft-v2/pipeline.ts
git commit -m "feat(pipeline): log retrieval_completed step with kb chunks and ticket examples"
```

---

## Task 3: Extend insights API to return structured diagnostic data

**Files:**
- Modify: `apps/web/app/api/threads/[threadId]/insights/route.js`

- [ ] **Step 1: Add parseDiagnostic helper at the top of route.js**

After the `extractThreadIdFromDetail` function (after line 38), add:

```javascript
function parseDiagnostic(logs) {
  const find = (stepName) =>
    logs.find((l) => l.step_name === stepName);

  const intentLog = find("draft_intent_assessed");
  const retrievalLog = find("retrieval_completed");
  const gapLog = find("knowledge_gap_detected");

  const intentDetail = safeParseJson(intentLog?.step_detail);
  const retrievalDetail = safeParseJson(retrievalLog?.step_detail);
  const gapDetail = safeParseJson(gapLog?.step_detail);

  const intent = intentDetail?.primary_intent ?? null;
  const kb_chunks = retrievalDetail?.kb_chunks ?? [];
  const ticket_examples = retrievalDetail?.ticket_examples ?? [];
  const knowledge_gaps = gapDetail?.gaps ?? [];

  const reasoning = buildReasoning(intent, kb_chunks, knowledge_gaps);

  return { reasoning, intent, kb_chunks, ticket_examples, knowledge_gaps };
}

function safeParseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function buildReasoning(intent, kb_chunks, knowledge_gaps) {
  if (!intent) return null;
  const parts = [`Classified as "${intent}".`];
  if (kb_chunks.length > 0) {
    parts.push(`Retrieved ${kb_chunks.length} knowledge chunk${kb_chunks.length !== 1 ? "s" : ""}.`);
  } else {
    parts.push("No matching knowledge found in the knowledge base.");
  }
  if (knowledge_gaps.length > 0) {
    const titles = knowledge_gaps
      .slice(0, 2)
      .map((g) => g.suggested_title || g.gap_type)
      .join(" and ");
    parts.push(`Missing information about: ${titles}.`);
  }
  return parts.join(" ");
}
```

- [ ] **Step 2: Call parseDiagnostic and include in response**

In the same file, replace the final return statement (line 207):

```javascript
  // Before:
  return NextResponse.json({ logs }, { status: 200 });

  // After:
  const diagnostic = parseDiagnostic(logs);
  return NextResponse.json({ logs, diagnostic }, { status: 200 });
```

- [ ] **Step 3: Test the endpoint manually**

Start the dev server and open a thread that has a draft. Check the network tab for `/api/threads/[threadId]/insights`. The response should now include a `diagnostic` key. If no `retrieval_completed` log exists yet (old drafts), `diagnostic.kb_chunks` will be `[]` — that's expected.

```bash
cd /Users/jonashoppe/Developer/INNO/apps/web
npm run dev
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/threads/[threadId]/insights/route.js
git commit -m "feat(insights-api): return structured diagnostic with kb chunks, ticket examples, and gaps"
```

---

## Task 4: Build SonaActivityContent component

**Files:**
- Create: `apps/web/components/inbox/SonaActivityContent.jsx`

- [ ] **Step 1: Create the component**

Create `apps/web/components/inbox/SonaActivityContent.jsx`:

```jsx
"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Expandable row ──────────────────────────────────────────────
function ExpandItem({ title, preview, right, children, borderClass }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", borderClass)}>
      <button
        className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/60 active:bg-muted"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          {preview && (
            <div className={cn("mt-0.5 truncate text-xs text-muted-foreground transition-opacity", open && "opacity-0")}>
              {preview}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">{right}</div>
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150", open && "rotate-90 text-foreground")}
        />
      </button>
      {/* CSS grid-rows accordion — smooth, no JS height measurement */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border bg-muted/40 px-3.5 py-3">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Score pill ──────────────────────────────────────────────────
function ScorePill({ score }) {
  const isHigh = score >= 0.8;
  return (
    <span
      className={cn(
        "rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
        isHigh
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-amber-200 bg-amber-50 text-amber-700",
      )}
    >
      {score.toFixed(2)}
    </span>
  );
}

// ── Section label ───────────────────────────────────────────────
function SectionLabel({ children, count, countClass }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80">
        {children}
      </span>
      {count != null && (
        <span
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
            countClass ?? "border-border bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </div>
  );
}

// ── "Add to KB" inline form ─────────────────────────────────────
function AddToKbForm({ gap, shopId, onSaved }) {
  const [title, setTitle] = useState(gap.suggested_title ?? "");
  const [content, setContent] = useState(gap.suggested_content_hint ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/knowledge/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), shop_id: shopId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save");
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border bg-background p-3">
      <input
        className="w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="h-20 w-full resize-none rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="Describe the policy or procedure…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={onSaved}
        >
          Cancel
        </button>
        <button
          disabled={saving || !title.trim() || !content.trim()}
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-[transform,opacity] active:scale-[0.97] disabled:opacity-50"
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save to knowledge base"}
        </button>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────
export default function SonaActivityContent({ diagnostic, shopId }) {
  const [addingGapId, setAddingGapId] = useState(null);
  const [savedGapIds, setSavedGapIds] = useState(new Set());

  if (!diagnostic) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No activity recorded for this conversation.
      </p>
    );
  }

  const { reasoning, kb_chunks = [], ticket_examples = [], knowledge_gaps = [] } = diagnostic;
  const hasContent = reasoning || kb_chunks.length || ticket_examples.length || knowledge_gaps.length;

  if (!hasContent) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No activity recorded for this conversation.
      </p>
    );
  }

  return (
    <div className="space-y-5">

      {/* Why this draft */}
      {reasoning && (
        <section>
          <SectionLabel>Why this draft</SectionLabel>
          <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm leading-relaxed text-foreground/80">
            {reasoning}
          </p>
        </section>
      )}

      {/* Knowledge used */}
      {kb_chunks.length > 0 && (
        <section>
          <SectionLabel count={kb_chunks.length}>Knowledge used</SectionLabel>
          <div className="space-y-1.5">
            {kb_chunks.map((chunk, i) => (
              <ExpandItem
                key={chunk.id ?? i}
                title={chunk.title}
                preview={`"${chunk.content.slice(0, 60)}…"`}
                right={<ScorePill score={chunk.score} />}
              >
                <p className="mb-2.5 whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
                  {chunk.content}
                </p>
                <div className="flex flex-wrap gap-3">
                  {chunk.usable_as && (
                    <span className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/70">Type</span> {chunk.usable_as}
                    </span>
                  )}
                  {chunk.kind && (
                    <span className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/70">Kind</span> {chunk.kind}
                    </span>
                  )}
                </div>
              </ExpandItem>
            ))}
          </div>
        </section>
      )}

      {/* Similar previous emails */}
      {ticket_examples.length > 0 && (
        <section>
          <SectionLabel count={ticket_examples.length}>Similar previous emails</SectionLabel>
          <div className="space-y-1.5">
            {ticket_examples.map((ticket, i) => (
              <ExpandItem
                key={i}
                title={ticket.subject ?? `Previous email ${i + 1}`}
                preview={`"${ticket.customer_msg.slice(0, 60)}…"`}
                right={
                  <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {ticket.score?.toFixed(2)}
                  </span>
                }
              >
                <div className="space-y-2">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Customer</p>
                    <p className="whitespace-pre-wrap rounded-md border border-border bg-background px-2.5 py-2 text-xs leading-relaxed text-foreground/80">
                      {ticket.customer_msg}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Your reply</p>
                    <p className="whitespace-pre-wrap rounded-md border border-border bg-background px-2.5 py-2 text-xs leading-relaxed text-foreground/80">
                      {ticket.agent_reply}
                    </p>
                  </div>
                </div>
              </ExpandItem>
            ))}
          </div>
        </section>
      )}

      {/* Missing knowledge */}
      {knowledge_gaps.length > 0 && (
        <section>
          <SectionLabel
            count={knowledge_gaps.length}
            countClass="border-amber-200 bg-amber-50 text-amber-700"
          >
            Missing knowledge
          </SectionLabel>
          <div className="space-y-2">
            {knowledge_gaps.map((gap, i) => {
              const gapId = `${gap.gap_type}-${i}`;
              const isSaved = savedGapIds.has(gapId);
              const isAdding = addingGapId === gapId;
              return (
                <div
                  key={gapId}
                  className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3"
                >
                  <p className="mb-1 text-sm font-semibold text-amber-900">
                    {gap.suggested_title || gap.gap_type}
                  </p>
                  <p className="mb-2.5 text-xs leading-relaxed text-amber-800/80">
                    {gap.suggested_content_hint}
                  </p>
                  {isSaved ? (
                    <p className="text-xs font-medium text-green-700">✓ Saved to knowledge base</p>
                  ) : isAdding ? (
                    <AddToKbForm
                      gap={gap}
                      shopId={shopId}
                      onSaved={() => {
                        setSavedGapIds((prev) => new Set([...prev, gapId]));
                        setAddingGapId(null);
                      }}
                    />
                  ) : (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition-[transform] active:scale-[0.97]"
                      onClick={() => setAddingGapId(gapId)}
                    >
                      <Plus className="h-3 w-3" />
                      Add to knowledge base
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

    </div>
  );
}
```

- [ ] **Step 2: Verify no import errors**

```bash
cd /Users/jonashoppe/Developer/INNO/apps/web
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors referencing `SonaActivityContent`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/inbox/SonaActivityContent.jsx
git commit -m "feat(inbox): add SonaActivityContent diagnostic component"
```

---

## Task 5: Wire SonaActivityContent into SonaInsightsModal

**Files:**
- Modify: `apps/web/components/inbox/SonaInsightsModal.jsx`

The dialog to replace is at lines 653–693. The insights fetch is at lines 244–256.

- [ ] **Step 1: Import SonaActivityContent and update the fetch**

At the top of `SonaInsightsModal.jsx`, add the import alongside existing imports:

```jsx
import SonaActivityContent from "@/components/inbox/SonaActivityContent";
```

Find the `useEffect` that fetches from `/api/threads/${threadId}/insights` (around line 244). It currently sets `logs`. Update it to also extract `diagnostic`:

```jsx
// Find this pattern (around line 244-256):
const res = await fetch(`/api/threads/${threadId}/insights`);
const data = await res.json();
setLogs(Array.isArray(data?.logs) ? data.logs : []);

// Replace with:
const res = await fetch(`/api/threads/${threadId}/insights`);
const data = await res.json();
setLogs(Array.isArray(data?.logs) ? data.logs : []);
setDiagnostic(data?.diagnostic ?? null);
```

Add the state declaration near the other `useState` calls in the component (around line 210–240):

```jsx
const [diagnostic, setDiagnostic] = useState(null);
```

Also reset `diagnostic` to `null` when `threadId` changes. Find the existing `useEffect` that resets `logs` when `threadId` changes (or add alongside the fetch effect):

```jsx
useEffect(() => {
  setDiagnostic(null);
}, [threadId]);
```

- [ ] **Step 2: Replace the Dialog body with SonaActivityContent**

Find the Dialog content block (lines 654–693) and replace the inner `<div className="overflow-y-auto flex-1 px-6 py-5">` content:

```jsx
// Replace the entire Dialog block (lines 653-693) with:
<Dialog open={sonaLogOpen} onOpenChange={setSonaLogOpen}>
  <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
    <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
      <DialogTitle>Sona activity</DialogTitle>
    </DialogHeader>
    <div className="overflow-y-auto flex-1 px-6 py-5">
      {logsLoading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <SonaActivityContent
          diagnostic={diagnostic}
          shopId={/* pass shopId prop — see step 3 */}
        />
      )}
    </div>
  </DialogContent>
</Dialog>
```

- [ ] **Step 3: Pass shopId to SonaActivityContent**

`SonaInsightsModal` receives `threadId` as a prop. The shopId is accessible via the `customerLookup` prop or can be fetched. Check if `customerLookup` contains a shop_id field; if it does, use `customerLookup?.shop_id`. Otherwise pass `null` — the snippet API will resolve the shop from the user's workspace scope.

Replace `shopId={/* ... */}` with:

```jsx
shopId={customerLookup?.shop_id ?? null}
```

- [ ] **Step 4: Update the activity card subtitle to show counts**

Find the subtitle text in the Sona activity card (around lines 638–645):

```jsx
// Replace:
<span className="mt-0.5 block truncate text-xs text-slate-500">
  {logsLoading
    ? "Loading decisions and sources..."
    : timelineItems.length
      ? `${timelineItems.length} step${timelineItems.length === 1 ? "" : "s"} recorded${...}`
      : "No decisions or sources recorded yet"}
</span>

// With:
<span className="mt-0.5 block truncate text-xs text-slate-500">
  {logsLoading
    ? "Loading…"
    : diagnostic
      ? [
          diagnostic.kb_chunks?.length
            ? `${diagnostic.kb_chunks.length} source${diagnostic.kb_chunks.length !== 1 ? "s" : ""}`
            : null,
          diagnostic.ticket_examples?.length
            ? `${diagnostic.ticket_examples.length} example${diagnostic.ticket_examples.length !== 1 ? "s" : ""}`
            : null,
          diagnostic.knowledge_gaps?.length
            ? `${diagnostic.knowledge_gaps.length} gap${diagnostic.knowledge_gaps.length !== 1 ? "s" : ""}`
            : null,
        ].filter(Boolean).join(" · ") || "View details"
      : "No activity recorded yet"}
</span>
```

- [ ] **Step 5: Test in browser**

Start dev server and open a thread that has been processed by the pipeline (after the pipeline change is deployed). Click "Sona activity" — the modal should show the four sections. For old tickets without a `retrieval_completed` log, it will show "No activity recorded for this conversation."

```bash
cd /Users/jonashoppe/Developer/INNO/apps/web && npm run dev
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/inbox/SonaInsightsModal.jsx
git commit -m "feat(inbox): wire SonaActivityContent into Sona activity dialog"
```

---

## Task 6: Deploy Edge Function

- [ ] **Step 1: Deploy generate-draft-v2**

```bash
cd /Users/jonashoppe/Developer/INNO
npx supabase functions deploy generate-draft-v2 --no-verify-jwt
```

Expected: `Deployed generate-draft-v2`

- [ ] **Step 2: Trigger a test draft and verify the log**

Send a test email through the system. Then in Supabase dashboard, query:

```sql
SELECT step_detail FROM agent_logs
WHERE step_name = 'retrieval_completed'
ORDER BY created_at DESC
LIMIT 1;
```

Expected: JSON with `kb_chunks` array and `ticket_examples` array.

- [ ] **Step 3: Verify in the UI**

Open a thread in the inbox whose draft was generated after the deploy. Click "Sona activity" — the modal should now show the four sections with real data.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: address issues found during live testing"
```
