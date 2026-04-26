# Sona Insights Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Sona Insights slide-out panel so AI automatically fills structured ticket metadata (summary, product, tags, category, solution), visible in a polished "Sona Actions" tab, with the existing pipeline log collapsed behind a disclosure button.

**Architecture:** A new `generateIssueMetadata` Supabase function runs fire-and-forget at ingest alongside the existing `autoTagThread`. Two new Next.js API routes expose GET/PATCH for metadata and POST for solution generation. A new `TicketMetadataPanel` React component renders the five fields; `SonaInsightsModal` is restructured to host it in the "Sona Actions" tab.

**Tech Stack:** Next.js 14 App Router (JavaScript), Supabase Postgres, OpenAI API (`gpt-4o-mini` for metadata, configurable model for solution), Tailwind CSS, Radix UI / shadcn components, Deno (Supabase Edge Functions).

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `supabase/schema/mail_threads_ticket_metadata.sql` | Migration: add `issue_summary` + `detected_product_id` |
| Create | `supabase/functions/_shared/generateIssueMetadata.ts` | AI: generate issue_summary + detect product |
| Create | `supabase/functions/_shared/generateIssueMetadata.test.ts` | Unit tests for JSON parsing logic |
| Modify | `supabase/functions/postmark-inbound/index.ts` | Wire generateIssueMetadata fire-and-forget |
| Create | `apps/web/app/api/threads/[threadId]/metadata/route.js` | GET metadata, PATCH metadata |
| Create | `apps/web/app/api/threads/[threadId]/solution-summary/route.js` | POST: trigger AI solution summary |
| Create | `apps/web/components/inbox/TicketMetadataPanel.jsx` | UI: five metadata fields, inline edit |
| Modify | `apps/web/components/inbox/SonaInsightsModal.jsx` | Replace tab 1 content, collapse ActionsTimeline |
| Modify | `apps/web/components/inbox/InboxSplitView.jsx` | Trigger solution summary POST on ticket Solved |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/schema/mail_threads_ticket_metadata.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/schema/mail_threads_ticket_metadata.sql
ALTER TABLE mail_threads
  ADD COLUMN IF NOT EXISTS issue_summary TEXT,
  ADD COLUMN IF NOT EXISTS detected_product_id UUID REFERENCES shop_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS mail_threads_detected_product_idx
  ON mail_threads(detected_product_id)
  WHERE detected_product_id IS NOT NULL;
```

- [ ] **Step 2: Push the migration**

```bash
npx supabase db push
```

Expected output: Migration applied without errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema/mail_threads_ticket_metadata.sql
git commit -m "feat: add issue_summary and detected_product_id to mail_threads"
```

---

## Task 2: `generateIssueMetadata` — Supabase shared function

**Files:**
- Create: `supabase/functions/_shared/generateIssueMetadata.ts`
- Create: `supabase/functions/_shared/generateIssueMetadata.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// supabase/functions/_shared/generateIssueMetadata.test.ts
import { assertEquals } from "jsr:@std/assert";
import { parseIssueMetadataResponse } from "./generateIssueMetadata.ts";

Deno.test("parseIssueMetadataResponse — extracts valid fields", () => {
  const validProductIds = new Set(["prod-abc", "prod-xyz"]);
  const result = parseIssueMetadataResponse(
    JSON.stringify({
      issue_summary: "Customer reports a broken zipper on their bag.",
      detected_product_id: "prod-abc",
    }),
    validProductIds,
  );
  assertEquals(result.issue_summary, "Customer reports a broken zipper on their bag.");
  assertEquals(result.detected_product_id, "prod-abc");
});

Deno.test("parseIssueMetadataResponse — rejects product id not in list", () => {
  const validProductIds = new Set(["prod-abc"]);
  const result = parseIssueMetadataResponse(
    JSON.stringify({ issue_summary: "Some issue.", detected_product_id: "prod-unknown" }),
    validProductIds,
  );
  assertEquals(result.detected_product_id, null);
});

Deno.test("parseIssueMetadataResponse — handles invalid JSON gracefully", () => {
  const result = parseIssueMetadataResponse("not json", new Set());
  assertEquals(result.issue_summary, null);
  assertEquals(result.detected_product_id, null);
});

Deno.test("parseIssueMetadataResponse — trims and caps issue_summary at 500 chars", () => {
  const longText = "x".repeat(600);
  const result = parseIssueMetadataResponse(
    JSON.stringify({ issue_summary: longText, detected_product_id: null }),
    new Set(),
  );
  assertEquals(result.issue_summary?.length, 500);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd supabase && deno test functions/_shared/generateIssueMetadata.test.ts --allow-net --allow-env
```

Expected: Error — `parseIssueMetadataResponse` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// supabase/functions/_shared/generateIssueMetadata.ts
import { createClient } from "jsr:@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

interface GenerateIssueMetadataParams {
  supabase: SupabaseClient;
  workspaceId: string;
  threadId: string;
  subject: string;
  body: string;
  openaiApiKey: string;
}

interface ParsedMetadata {
  issue_summary: string | null;
  detected_product_id: string | null;
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
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

export function parseIssueMetadataResponse(
  raw: string,
  validProductIds: Set<string>,
): ParsedMetadata {
  try {
    const parsed = JSON.parse(raw);
    const issue_summary =
      typeof parsed.issue_summary === "string" && parsed.issue_summary.trim()
        ? parsed.issue_summary.trim().slice(0, 500)
        : null;
    const detected_product_id =
      typeof parsed.detected_product_id === "string" &&
      validProductIds.has(parsed.detected_product_id)
        ? parsed.detected_product_id
        : null;
    return { issue_summary, detected_product_id };
  } catch {
    return { issue_summary: null, detected_product_id: null };
  }
}

export async function generateIssueMetadata(
  params: GenerateIssueMetadataParams,
): Promise<void> {
  const { supabase, workspaceId, threadId, subject, body, openaiApiKey } = params;

  // Skip if already populated (avoid re-generating on reply threads)
  const { data: existing } = await supabase
    .from("mail_threads")
    .select("issue_summary")
    .eq("id", threadId)
    .maybeSingle();
  if (existing?.issue_summary) return;

  const { data: products } = await supabase
    .from("shop_products")
    .select("id, title")
    .eq("workspace_id", workspaceId)
    .limit(50);

  const productList = (products ?? [])
    .map((p: { id: string; title: string }) => `- ID: ${p.id} | Name: "${p.title}"`)
    .join("\n");

  const ticketContent = `Subject: ${subject || "(none)"}\n\n${(body || "").slice(0, 1500)}`;

  const productInstruction = productList
    ? `- "detected_product_id": The ID of the product from the list below that is mentioned in the ticket, or null if none matches clearly.\n\nAvailable products:\n${productList}`
    : '- "detected_product_id": null';

  const systemPrompt =
    `You are a support ticket analyzer. Given a support ticket, return JSON with:\n` +
    `- "issue_summary": 1-2 English sentences describing what the customer wants or what the problem is. Be specific and concise.\n` +
    productInstruction;

  const raw = await callOpenAI(openaiApiKey, [
    { role: "system", content: systemPrompt },
    { role: "user", content: ticketContent },
  ]);

  const validProductIds = new Set((products ?? []).map((p: { id: string }) => p.id));
  const { issue_summary, detected_product_id } = parseIssueMetadataResponse(raw, validProductIds);

  const updates: Record<string, string | null> = {};
  if (issue_summary) updates.issue_summary = issue_summary;
  if (detected_product_id) updates.detected_product_id = detected_product_id;

  if (Object.keys(updates).length) {
    await supabase.from("mail_threads").update(updates).eq("id", threadId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd supabase && deno test functions/_shared/generateIssueMetadata.test.ts --allow-net --allow-env
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/generateIssueMetadata.ts supabase/functions/_shared/generateIssueMetadata.test.ts
git commit -m "feat: add generateIssueMetadata shared function"
```

---

## Task 3: Wire `generateIssueMetadata` into `postmark-inbound`

**Files:**
- Modify: `supabase/functions/postmark-inbound/index.ts`

The existing `autoTagThread` call is around line 1546. Add `generateIssueMetadata` immediately after it, in the same `if` block.

- [ ] **Step 1: Add the import at the top of the file**

Find the existing import:
```typescript
import { autoTagThread } from "../_shared/autoTagThread.ts";
```

Add directly below it:
```typescript
import { generateIssueMetadata } from "../_shared/generateIssueMetadata.ts";
```

- [ ] **Step 2: Add the fire-and-forget call**

Find the existing block (around line 1545–1555):
```typescript
  // Fire-and-forget: AI auto-tagging based on email content
  if (supabase && mailbox.workspace_id && threadId && OPENAI_API_KEY) {
    const tagBody = parsedBodies?.cleanBodyText || textBody || "";
    autoTagThread({
      supabase,
      workspaceId: mailbox.workspace_id,
      threadId,
      subject,
      body: tagBody,
      openaiApiKey: OPENAI_API_KEY,
    }).catch((err: Error) => console.warn("[auto-tag] error:", err?.message));
  }
```

Replace with:
```typescript
  // Fire-and-forget: AI auto-tagging based on email content
  if (supabase && mailbox.workspace_id && threadId && OPENAI_API_KEY) {
    const tagBody = parsedBodies?.cleanBodyText || textBody || "";
    autoTagThread({
      supabase,
      workspaceId: mailbox.workspace_id,
      threadId,
      subject,
      body: tagBody,
      openaiApiKey: OPENAI_API_KEY,
    }).catch((err: Error) => console.warn("[auto-tag] error:", err?.message));

    generateIssueMetadata({
      supabase,
      workspaceId: mailbox.workspace_id,
      threadId,
      subject,
      body: tagBody,
      openaiApiKey: OPENAI_API_KEY,
    }).catch((err: Error) => console.warn("[issue-metadata] error:", err?.message));
  }
```

- [ ] **Step 3: Deploy postmark-inbound**

```bash
npx supabase functions deploy postmark-inbound --no-verify-jwt
```

Expected: Deployed successfully.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/postmark-inbound/index.ts
git commit -m "feat: wire generateIssueMetadata into postmark-inbound"
```

---

## Task 4: Metadata API route — GET and PATCH

**Files:**
- Create: `apps/web/app/api/threads/[threadId]/metadata/route.js`

The pattern follows `apps/web/app/api/threads/[threadId]/tags/route.js` exactly — same auth, same `resolveAndVerifyThread` helper, same Supabase service client setup.

- [ ] **Step 1: Create the route file**

```javascript
// apps/web/app/api/threads/[threadId]/metadata/route.js
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function resolveAndVerifyThread(serviceClient, threadId, clerkUserId, orgId) {
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    throw Object.assign(new Error("Auth scope not found."), { status: 404 });
  }
  const { data: thread, error } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, workspace_id, classification_key, issue_summary, solution_summary, detected_product_id")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (!thread?.id) throw Object.assign(new Error("Thread not found."), { status: 404 });
  return { scope, thread };
}

export async function GET(_request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const threadId = asString(params?.threadId);
  if (!threadId) return NextResponse.json({ error: "threadId is required." }, { status: 400 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase configuration missing." }, { status: 500 });

  let scope, thread;
  try {
    ({ scope, thread } = await resolveAndVerifyThread(serviceClient, threadId, clerkUserId, orgId));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  // Fetch detected product name if set
  let detected_product = null;
  if (thread.detected_product_id) {
    const { data: product } = await serviceClient
      .from("shop_products")
      .select("id, title")
      .eq("id", thread.detected_product_id)
      .maybeSingle();
    if (product) detected_product = { id: product.id, title: product.title };
  }

  // Fetch available products for the product picker
  const workspaceId = scope?.workspaceId ?? thread.workspace_id;
  const { data: products } = await serviceClient
    .from("shop_products")
    .select("id, title")
    .eq("workspace_id", workspaceId)
    .order("title")
    .limit(100);

  return NextResponse.json({
    issue_summary: thread.issue_summary ?? null,
    solution_summary: thread.solution_summary ?? null,
    classification_key: thread.classification_key ?? null,
    detected_product,
    available_products: products ?? [],
  });
}

const ALLOWED_PATCH_FIELDS = new Set(["issue_summary", "solution_summary", "detected_product_id"]);

export async function PATCH(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const threadId = asString(params?.threadId);
  if (!threadId) return NextResponse.json({ error: "threadId is required." }, { status: 400 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase configuration missing." }, { status: 500 });

  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }

  const updates = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_PATCH_FIELDS.has(key)) {
      updates[key] = value === "" ? null : value;
    }
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  try {
    await resolveAndVerifyThread(serviceClient, threadId, clerkUserId, orgId);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const { error } = await serviceClient
    .from("mail_threads")
    .update(updates)
    .eq("id", threadId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, ...updates });
}
```

- [ ] **Step 2: Verify the route loads**

```bash
cd apps/web && npm run build 2>&1 | grep -i "metadata\|error"
```

Expected: No errors related to the new route.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/threads/[threadId]/metadata/route.js
git commit -m "feat: add GET/PATCH /api/threads/[threadId]/metadata"
```

---

## Task 5: Solution Summary API route

**Files:**
- Create: `apps/web/app/api/threads/[threadId]/solution-summary/route.js`

This route fetches thread messages and calls OpenAI to generate a 1-2 sentence English solution summary, then saves it to `mail_threads.solution_summary`.

- [ ] **Step 1: Create the route file**

```javascript
// apps/web/app/api/threads/[threadId]/solution-summary/route.js
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(_request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const threadId = asString(params?.threadId);
  if (!threadId) return NextResponse.json({ error: "threadId is required." }, { status: 400 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase configuration missing." }, { status: 500 });

  if (!OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI not configured." }, { status: 500 });

  // Verify thread ownership
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }).catch(() => null);
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Auth scope not found." }, { status: 401 });
  }

  const { data: thread, error: threadError } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, solution_summary")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (threadError || !thread) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  // Skip if agent already wrote a solution manually
  if (thread.solution_summary) {
    return NextResponse.json({ solution_summary: thread.solution_summary });
  }

  // Fetch messages for context
  const { data: messages } = await serviceClient
    .from("mail_messages")
    .select("body_text, clean_body_text, from_email, created_at")
    .eq("thread_id", threadId)
    .order("created_at")
    .limit(20);

  const messageContext = (messages ?? [])
    .map((m) => {
      const body = asString(m.clean_body_text || m.body_text).slice(0, 400);
      return `[${m.from_email}]: ${body}`;
    })
    .join("\n\n");

  if (!messageContext) {
    return NextResponse.json({ error: "No messages found to summarize." }, { status: 400 });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      max_tokens: 150,
      messages: [
        {
          role: "system",
          content:
            "You are a support analyst. Given a resolved support conversation, write 1-2 English sentences summarizing how the issue was resolved. Be specific and concise. Focus on what action was taken to solve the problem.",
        },
        { role: "user", content: messageContext },
      ],
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: `OpenAI error ${res.status}` }, { status: 502 });
  }

  const json = await res.json();
  const solution_summary = asString(json?.choices?.[0]?.message?.content).slice(0, 500);

  if (!solution_summary) {
    return NextResponse.json({ error: "Could not generate summary." }, { status: 500 });
  }

  await serviceClient
    .from("mail_threads")
    .update({ solution_summary })
    .eq("id", threadId);

  return NextResponse.json({ solution_summary });
}
```

- [ ] **Step 2: Verify the route loads**

```bash
cd apps/web && npm run build 2>&1 | grep -i "solution-summary\|error"
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/threads/[threadId]/solution-summary/route.js
git commit -m "feat: add POST /api/threads/[threadId]/solution-summary"
```

---

## Task 6: `TicketMetadataPanel` component

**Files:**
- Create: `apps/web/components/inbox/TicketMetadataPanel.jsx`

- [ ] **Step 1: Create the component**

```jsx
// apps/web/components/inbox/TicketMetadataPanel.jsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

function SectionLabel({ children, isAI = false }) {
  return (
    <div className="flex items-center gap-1.5">
      {isAI && <Sparkles className="w-3 h-3 text-violet-400 shrink-0" />}
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {children}
      </span>
    </div>
  );
}

function EditableTextField({ label, value, onSave, placeholder = "—", isAI = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const textareaRef = useRef(null);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  useEffect(() => {
    if (editing && textareaRef.current) textareaRef.current.focus();
  }, [editing]);

  const handleBlur = () => {
    setEditing(false);
    const next = draft.trim();
    const current = (value ?? "").trim();
    if (next !== current) onSave(next || null);
  };

  return (
    <div className="space-y-1">
      <SectionLabel isAI={isAI && Boolean(value)}>{label}</SectionLabel>
      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`block w-full text-left rounded px-1 -mx-1 py-0.5 text-sm hover:bg-slate-50 transition-colors min-h-[28px] ${
            value ? "text-slate-800" : "text-slate-400 italic"
          }`}
        >
          {value || placeholder}
        </button>
      )}
    </div>
  );
}

function ProductField({ value, availableProducts, onSave }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const filtered = (availableProducts ?? []).filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-1">
      <SectionLabel isAI={Boolean(value)}>Product</SectionLabel>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setSearch(""); }}
          className={`block w-full text-left rounded px-1 -mx-1 py-0.5 text-sm hover:bg-slate-50 transition-colors min-h-[28px] ${
            value ? "text-slate-800" : "text-slate-400 italic"
          }`}
        >
          {value?.title || "—"}
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[200px] max-h-56 flex flex-col">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="mx-2 my-1 px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none"
            />
            <div className="overflow-y-auto flex-1">
              <button
                type="button"
                onClick={() => { onSave(null); setOpen(false); }}
                className="flex items-center w-full px-3 py-1.5 text-sm text-slate-400 italic hover:bg-slate-50"
              >
                None
              </button>
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onSave(p.id); setOpen(false); }}
                  className={`flex items-center w-full px-3 py-1.5 text-sm text-left hover:bg-slate-50 ${
                    value?.id === p.id ? "font-medium text-violet-700" : "text-slate-700"
                  }`}
                >
                  {p.title}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-400">No products found.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TagsSection({ threadId }) {
  const [assignedTags, setAssignedTags] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [adding, setAdding] = useState(null);
  const [removing, setRemoving] = useState(null);
  const dropdownRef = useRef(null);

  const fetchAssigned = useCallback(async () => {
    if (!threadId) return;
    const res = await fetch(`/api/threads/${threadId}/tags`).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (res?.ok) setAssignedTags(json.tags ?? []);
  }, [threadId]);

  const fetchAvailable = useCallback(async () => {
    const res = await fetch("/api/settings/tags").catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (res?.ok) setAvailableTags((json.tags ?? []).filter((t) => t.is_active));
  }, []);

  useEffect(() => {
    setAssignedTags([]);
    fetchAssigned();
  }, [fetchAssigned, threadId]);

  useEffect(() => { fetchAvailable(); }, [fetchAvailable]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handle = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [dropdownOpen]);

  const handleAdd = useCallback(async (tag) => {
    if (adding) return;
    setDropdownOpen(false);
    setAdding(tag.id);
    const res = await fetch(`/api/threads/${threadId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_id: tag.id }),
    }).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (res?.ok) {
      setAssignedTags((prev) =>
        prev.some((t) => t.id === json.tag.id) ? prev : [...prev, json.tag]
      );
    }
    setAdding(null);
  }, [adding, threadId]);

  const handleRemove = useCallback(async (tag) => {
    if (removing) return;
    setRemoving(tag.id);
    await fetch(`/api/threads/${threadId}/tags`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_id: tag.id }),
    }).catch(() => null);
    setAssignedTags((prev) => prev.filter((t) => t.id !== tag.id));
    setRemoving(null);
  }, [removing, threadId]);

  const assignedIds = new Set(assignedTags.map((t) => t.id));
  const unassigned = availableTags.filter((t) => !assignedIds.has(t.id));

  return (
    <div className="space-y-1">
      <SectionLabel>Tags</SectionLabel>
      <div className="flex items-center gap-1.5 flex-wrap min-h-[28px]">
        {assignedTags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-white"
            style={{ backgroundColor: tag.color }}
            title={tag.source === "ai" ? "Set by AI" : "Set manually"}
          >
            {tag.source === "ai" && <Sparkles className="w-2.5 h-2.5 opacity-80 shrink-0" />}
            {tag.name}
            <button
              type="button"
              onClick={() => handleRemove(tag)}
              disabled={removing === tag.id}
              className="ml-0.5 opacity-70 hover:opacity-100 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        {unassigned.length > 0 && (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-slate-400 border border-dashed border-slate-200 hover:border-slate-400 hover:text-slate-600 transition-colors"
            >
              + Tag
            </button>
            {dropdownOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[160px] max-h-48 overflow-y-auto">
                {unassigned.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleAdd(tag)}
                    disabled={adding === tag.id}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-slate-50"
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {assignedTags.length === 0 && unassigned.length === 0 && (
          <span className="text-sm text-slate-400 italic">—</span>
        )}
      </div>
    </div>
  );
}

export function TicketMetadataPanel({ threadId }) {
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMetadata = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/metadata`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) setMetadata(json);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    setMetadata(null);
    fetchMetadata();
  }, [fetchMetadata, threadId]);

  const handleSave = useCallback(async (field, value) => {
    const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setMetadata((prev) => {
        if (!prev) return prev;
        if (field === "detected_product_id") {
          const product = (prev.available_products ?? []).find((p) => p.id === value) ?? null;
          return { ...prev, detected_product: product };
        }
        return { ...prev, [field]: value };
      });
    }
  }, [threadId]);

  if (loading) {
    return <div className="text-sm text-slate-400 py-6 text-center">Loading…</div>;
  }

  const categoryLabel = metadata?.classification_key
    ? metadata.classification_key
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  return (
    <div className="space-y-4">
      <EditableTextField
        label="Summary"
        value={metadata?.issue_summary}
        onSave={(v) => handleSave("issue_summary", v)}
        placeholder="Click to edit"
        isAI
      />
      <ProductField
        value={metadata?.detected_product}
        availableProducts={metadata?.available_products ?? []}
        onSave={(productId) => handleSave("detected_product_id", productId)}
      />
      <TagsSection threadId={threadId} />
      <div className="space-y-1">
        <SectionLabel>Category</SectionLabel>
        <p className="text-sm text-slate-700 px-1 -mx-1 min-h-[28px] py-0.5">
          {categoryLabel || <span className="text-slate-400 italic">—</span>}
        </p>
      </div>
      <EditableTextField
        label="Solution"
        value={metadata?.solution_summary}
        onSave={(v) => handleSave("solution_summary", v)}
        placeholder="Generated when ticket is solved"
        isAI
      />
    </div>
  );
}
```

- [ ] **Step 2: Start dev server and verify no import errors**

```bash
cd apps/web && npm run dev
```

Open `http://localhost:3000` and check the browser console for errors. The component is not rendered anywhere yet — just verify no build errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/inbox/TicketMetadataPanel.jsx
git commit -m "feat: add TicketMetadataPanel component"
```

---

## Task 7: Redesign `SonaInsightsModal`

**Files:**
- Modify: `apps/web/components/inbox/SonaInsightsModal.jsx`

Replace the "Sona Actions" tab content with `TicketMetadataPanel`. Wrap the existing `ActionsTimeline` in a collapsible `<details>` element at the bottom. All the existing parsing logic above the component function stays untouched.

- [ ] **Step 1: Add the import**

At the top of `SonaInsightsModal.jsx`, add after the existing imports:

```jsx
import { TicketMetadataPanel } from "@/components/inbox/TicketMetadataPanel";
```

- [ ] **Step 2: Replace the "actions" TabsContent**

Find:
```jsx
          <TabsContent value="actions" className="min-w-0 flex-1 overflow-y-auto">
            <div className="rounded-2xl border border-border bg-card/90 p-4">
              {logsLoading || (draftLoading && !timelineItems.length) ? (
                <div className="text-sm text-muted-foreground">Loading investigation data…</div>
              ) : timelineItems.length ? (
                <ActionsTimeline items={timelineItems} />
              ) : (
                <div className="text-sm text-muted-foreground">
                  No actions required for this conversation.
                </div>
              )}
            </div>
          </TabsContent>
```

Replace with:
```jsx
          <TabsContent value="actions" className="min-w-0 flex-1 overflow-y-auto">
            <div className="space-y-5">
              <div className="rounded-2xl border border-border bg-card/90 p-4">
                <TicketMetadataPanel threadId={threadId} />
              </div>

              <details className="group">
                <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-400 hover:text-slate-600 select-none list-none">
                  <svg
                    className="w-3.5 h-3.5 transition-transform group-open:rotate-90"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  What did Sona do?
                </summary>
                <div className="mt-3 rounded-2xl border border-border bg-card/90 p-4">
                  {logsLoading || (draftLoading && !timelineItems.length) ? (
                    <div className="text-sm text-muted-foreground">Loading…</div>
                  ) : timelineItems.length ? (
                    <ActionsTimeline items={timelineItems} />
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No actions recorded for this conversation.
                    </div>
                  )}
                </div>
              </details>
            </div>
          </TabsContent>
```

- [ ] **Step 3: Rename tab trigger label**

Find:
```jsx
            <TabsTrigger value="actions">Sona Actions</TabsTrigger>
```

Replace with:
```jsx
            <TabsTrigger value="actions">Overview</TabsTrigger>
```

- [ ] **Step 4: Test in the browser**

Start dev server (`npm run dev`), open a ticket, open the Sona Insights panel (the button in the ticket toolbar). Verify:
- "Overview" tab shows Summary, Product, Tags, Category, Solution fields
- "What did Sona do?" is collapsed by default and expands to show the timeline
- "Customer" tab is unchanged

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/inbox/SonaInsightsModal.jsx
git commit -m "feat: redesign Sona Actions tab with TicketMetadataPanel"
```

---

## Task 8: Trigger solution summary when ticket is solved

**Files:**
- Modify: `apps/web/components/inbox/InboxSplitView.jsx`

When a ticket is marked Solved, fire a POST to `/api/threads/[threadId]/solution-summary` so AI generates the summary. The existing `onTicketStateChange` handler is the right place to add this.

- [ ] **Step 1: Find the ticket state change handler**

Search for `onTicketStateChange` in `InboxSplitView.jsx`. It's a function passed as a prop to `TicketDetail`. Find where the status is actually persisted — search for where `status` is written to Supabase (look for `mail_threads` `.update` with a `status` field). The handler will be a function named something like `handleTicketStateChange` or similar.

- [ ] **Step 2: Add the solution summary trigger**

`handleTicketStateChange` is at line 3011 in `InboxSplitView.jsx`. Find the existing `if (updates.status === "Solved")` block (around line 3024) and add the fire-and-forget call immediately inside it, before the existing navigation logic:

```javascript
    if (updates.status === "Solved") {
      // Trigger AI solution summary generation (fire-and-forget)
      fetch(`/api/threads/${encodeURIComponent(selectedThreadId)}/solution-summary`, {
        method: "POST",
      }).catch(() => null);

      // existing navigation logic below — leave it unchanged
      const currentIdx = filteredThreads.findIndex((t) => t.id === selectedThreadId);
      // ...rest of existing code...
    }
```

Only add the three lines before the existing navigation code. Do not change anything else in the function.

- [ ] **Step 3: Test end-to-end**

In the dev environment:
1. Open a ticket with some messages
2. Click "Mark as solved" (or change status to Solved)
3. Open the Sona Insights panel
4. After a few seconds, verify the "Solution" field populates

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/inbox/InboxSplitView.jsx
git commit -m "feat: trigger AI solution summary when ticket is marked solved"
```

---

## Task 9: Deploy and verify

- [ ] **Step 1: Build production bundle**

```bash
cd apps/web && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Deploy postmark-inbound**

Per CLAUDE.md: postmark-inbound must always be deployed with `--no-verify-jwt`.

```bash
npx supabase functions deploy postmark-inbound --no-verify-jwt
```

- [ ] **Step 3: Push DB migration to production**

```bash
npx supabase db push
```

Expected: Migration applies `issue_summary` and `detected_product_id` columns without errors.

- [ ] **Step 4: Final acceptance check**

Go through each acceptance criterion from the spec:
- [ ] Sona Actions tab (now "Overview") shows Summary, Product, Tags, Category, Solution
- [ ] A newly arrived ticket has Summary, Product, and Tags pre-filled by AI (send a test email)
- [ ] Marking a ticket Solved generates a Solution summary after a few seconds
- [ ] Editing any field and reloading the page preserves the edit
- [ ] "What did Sona do?" disclosure shows the existing ActionsTimeline
- [ ] Customer tab is unchanged
- [ ] All UI text is in English

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: Sona Insights redesign — structured ticket metadata complete"
```
