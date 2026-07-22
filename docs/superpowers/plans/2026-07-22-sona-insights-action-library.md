# Sona Insights Action Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Actions" tab to the per-ticket Sona Insights panel that lets an agent manually trigger 4 of the 5 core Shopify order actions (update shipping address, cancel order, refund order, start return) on the ticket's matched order, executing immediately through the existing AI-approval execution path.

**Architecture:** A new thin API route creates a `thread_actions` row from agent-entered form data (reusing a pure validation/mapping library), then the client seeds `pendingOrderUpdateByThread` with that row and calls the existing `handleOrderUpdateDecision("accepted")` — the same function that already drives the AI-approval flow's Shopify execution, test-mode handling, and `ActionCard` rendering. No changes are made to `order-updates/accept/route.js` or `useThreadActions.js`.

**Tech Stack:** Next.js 14 App Router API routes, React (SonaInsightsModal.jsx client component), Supabase (service-role client), Vitest for unit tests, shadcn/ui primitives (Dialog, Select, Input, Textarea, Label, Button) already present in `apps/web/components/ui/`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-sona-insights-action-library-design.md` — read it before starting.
- Scope is 4 action types only: `update_shipping_address`, `cancel_order`, `refund_order`, `initiate_return` (inserted as `create_return_case` — see Task 1). `create_exchange_request` is explicitly out of scope for this plan.
- All 4 actions are always clickable regardless of the shop's `action_modes` setting — that setting only gates the AI, not a human-initiated action from this tab.
- No changes to `apps/web/app/api/threads/[threadId]/order-updates/accept/route.js` or `apps/web/lib/inbox/useThreadActions.js`.
- `thread_actions.order_id` must be the order's numeric Shopify ID (`order.adminId` from the customer-lookup order shape); `order_number` must be `order.id` (the customer-lookup shape's display order number). Do not swap these.
- Every commit must leave `npm run lint` and the relevant `vitest` suite passing.

---

## File Structure

- **Create** `apps/web/lib/inbox/manual-actions.js` — pure validation/mapping functions (order resolution, per-action-type field validation, `thread_actions` insert-shape building). No React, no Supabase — fully unit-testable.
- **Create** `apps/web/lib/inbox/__tests__/manual-actions.test.js` — Vitest coverage for the above.
- **Create** `apps/web/app/api/threads/[threadId]/actions/manual/route.js` — POST endpoint: auth, scope resolution, calls into `manual-actions.js`, inserts the `thread_actions` row, returns it.
- **Create** `apps/web/components/inbox/ManualActionDialog.jsx` — the parameter-form dialog for all 4 action types (one component, switched by `actionType`, matching the design's per-action field table).
- **Modify** `apps/web/components/inbox/SonaInsightsModal.jsx` — new "Actions" tab: order header, disabled/empty states, the 4-row action list, wiring to `ManualActionDialog` and to the two new props below.
- **Modify** `apps/web/components/inbox/InboxSplitView.jsx` — pass `setPendingOrderUpdateByThread` and `handleOrderUpdateDecision` into `<SonaInsightsModal>` (both already exist in this file's scope today).

---

### Task 1: Manual action validation/mapping library

**Files:**
- Create: `apps/web/lib/inbox/manual-actions.js`
- Test: `apps/web/lib/inbox/__tests__/manual-actions.test.js`

**Interfaces:**
- Produces: `MANUAL_ACTION_TYPES: string[]`, `RETURN_REASONS: string[]`, `resolveMatchedOrder(orders: Array|null|undefined): object|null`, `buildManualActionInsert({ actionType: string, order: {id, adminId}|null, formPayload: object }): { ok: true, insert: { action_type, order_id, order_number, payload } } | { ok: false, error: string }`.
- Consumes: nothing (pure module).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/inbox/__tests__/manual-actions.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  buildManualActionInsert,
  resolveMatchedOrder,
  MANUAL_ACTION_TYPES,
  RETURN_REASONS,
} from "../manual-actions.js";

const order = { id: "#4538", adminId: "5891234567891" };

describe("resolveMatchedOrder", () => {
  it("returns the first order when present", () => {
    expect(resolveMatchedOrder([order, { id: "#9" }])).toBe(order);
  });

  it("returns null when there are no orders", () => {
    expect(resolveMatchedOrder([])).toBeNull();
    expect(resolveMatchedOrder(null)).toBeNull();
    expect(resolveMatchedOrder(undefined)).toBeNull();
  });
});

describe("MANUAL_ACTION_TYPES", () => {
  it("excludes create_exchange_request", () => {
    expect(MANUAL_ACTION_TYPES).not.toContain("create_exchange_request");
    expect(MANUAL_ACTION_TYPES).toEqual([
      "update_shipping_address",
      "cancel_order",
      "refund_order",
      "initiate_return",
    ]);
  });
});

describe("buildManualActionInsert", () => {
  it("rejects an unsupported action type", () => {
    const result = buildManualActionInsert({
      actionType: "create_exchange_request",
      order,
      formPayload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when there is no matched order", () => {
    const result = buildManualActionInsert({ actionType: "cancel_order", order: null, formPayload: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/matched order/i);
  });

  it("rejects an order missing adminId or id", () => {
    const result = buildManualActionInsert({
      actionType: "cancel_order",
      order: { id: "#4538" },
      formPayload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("builds a cancel_order insert with an empty payload, mapping order fields correctly", () => {
    const result = buildManualActionInsert({ actionType: "cancel_order", order, formPayload: {} });
    expect(result).toEqual({
      ok: true,
      insert: {
        action_type: "cancel_order",
        order_id: "5891234567891",
        order_number: "#4538",
        payload: {},
      },
    });
  });

  it("requires address1, zip, city and country for update_shipping_address", () => {
    const result = buildManualActionInsert({
      actionType: "update_shipping_address",
      order,
      formPayload: { address1: "", zip: "8000", city: "Aarhus", country: "DK" },
    });
    expect(result.ok).toBe(false);
  });

  it("builds an update_shipping_address insert, omitting blank optional fields", () => {
    const result = buildManualActionInsert({
      actionType: "update_shipping_address",
      order,
      formPayload: {
        name: "Jonas Hoppe",
        address1: "Main St 1",
        address2: "",
        zip: "8000",
        city: "Aarhus",
        country: "DK",
      },
    });
    expect(result.ok).toBe(true);
    expect(result.insert.payload).toEqual({
      shipping_address: {
        name: "Jonas Hoppe",
        address1: "Main St 1",
        zip: "8000",
        city: "Aarhus",
        country: "DK",
      },
    });
  });

  it("requires a positive amount for refund_order", () => {
    const result = buildManualActionInsert({ actionType: "refund_order", order, formPayload: { amount: 0 } });
    expect(result.ok).toBe(false);
    const negative = buildManualActionInsert({ actionType: "refund_order", order, formPayload: { amount: -5 } });
    expect(negative.ok).toBe(false);
  });

  it("builds a refund_order insert, coercing string amounts to numbers", () => {
    const result = buildManualActionInsert({
      actionType: "refund_order",
      order,
      formPayload: { amount: "199.50", note: "Damaged in transit" },
    });
    expect(result.ok).toBe(true);
    expect(result.insert.payload).toEqual({ amount: 199.5, note: "Damaged in transit" });
  });

  it("maps initiate_return to action_type create_return_case", () => {
    const result = buildManualActionInsert({
      actionType: "initiate_return",
      order,
      formPayload: { reason: "wrong_item" },
    });
    expect(result.ok).toBe(true);
    expect(result.insert.action_type).toBe("create_return_case");
    expect(result.insert.payload.reason).toBe("WRONG_ITEM");
  });

  it("rejects an invalid return reason", () => {
    const result = buildManualActionInsert({
      actionType: "initiate_return",
      order,
      formPayload: { reason: "because" },
    });
    expect(result.ok).toBe(false);
  });

  it("exposes the full return reason enum", () => {
    expect(RETURN_REASONS).toEqual([
      "COLOR",
      "DEFECTIVE",
      "NOT_AS_DESCRIBED",
      "OTHER",
      "SIZE_TOO_LARGE",
      "SIZE_TOO_SMALL",
      "STYLE",
      "UNKNOWN",
      "UNWANTED",
      "WRONG_ITEM",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/inbox/__tests__/manual-actions.test.js`
Expected: FAIL — `Cannot find module '../manual-actions.js'`

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/inbox/manual-actions.js`:

```js
export const MANUAL_ACTION_TYPES = [
  "update_shipping_address",
  "cancel_order",
  "refund_order",
  "initiate_return",
];

export const RETURN_REASONS = [
  "COLOR",
  "DEFECTIVE",
  "NOT_AS_DESCRIBED",
  "OTHER",
  "SIZE_TOO_LARGE",
  "SIZE_TOO_SMALL",
  "STYLE",
  "UNKNOWN",
  "UNWANTED",
  "WRONG_ITEM",
];

const asString = (value) => (typeof value === "string" ? value.trim() : "");

const asPositiveNumber = (value) => {
  const num = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(num) && num > 0 ? num : null;
};

export function resolveMatchedOrder(orders) {
  const list = Array.isArray(orders) ? orders : [];
  return list[0] || null;
}

export function buildManualActionInsert({ actionType, order, formPayload = {} }) {
  const type = asString(actionType);
  if (!MANUAL_ACTION_TYPES.includes(type)) {
    return { ok: false, error: `Unsupported manual action type: ${actionType}` };
  }

  const orderAdminId = asString(order?.adminId);
  const orderNumber = asString(order?.id);
  if (!orderAdminId || !orderNumber) {
    return { ok: false, error: "No matched order to act on." };
  }

  if (type === "update_shipping_address") {
    const address1 = asString(formPayload?.address1);
    const zip = asString(formPayload?.zip);
    const city = asString(formPayload?.city);
    const country = asString(formPayload?.country);
    if (!address1 || !zip || !city || !country) {
      return { ok: false, error: "Address line 1, zip, city and country are required." };
    }
    const name = asString(formPayload?.name);
    const address2 = asString(formPayload?.address2);
    return {
      ok: true,
      insert: {
        action_type: "update_shipping_address",
        order_id: orderAdminId,
        order_number: orderNumber,
        payload: {
          shipping_address: {
            ...(name ? { name } : {}),
            address1,
            ...(address2 ? { address2 } : {}),
            zip,
            city,
            country,
          },
        },
      },
    };
  }

  if (type === "cancel_order") {
    return {
      ok: true,
      insert: {
        action_type: "cancel_order",
        order_id: orderAdminId,
        order_number: orderNumber,
        payload: {},
      },
    };
  }

  if (type === "refund_order") {
    const amount = asPositiveNumber(formPayload?.amount);
    if (!amount) {
      return { ok: false, error: "A refund amount greater than 0 is required." };
    }
    const note = asString(formPayload?.note);
    return {
      ok: true,
      insert: {
        action_type: "refund_order",
        order_id: orderAdminId,
        order_number: orderNumber,
        payload: { amount, ...(note ? { note } : {}) },
      },
    };
  }

  // type === "initiate_return"
  const reason = asString(formPayload?.reason).toUpperCase();
  if (!RETURN_REASONS.includes(reason)) {
    return { ok: false, error: "A valid return reason is required." };
  }
  const note = asString(formPayload?.note);
  return {
    ok: true,
    insert: {
      // The execution route branches on the legacy literal "create_return_case",
      // not the CORE_ACTIONS alias "initiate_return" — see accept/route.js.
      action_type: "create_return_case",
      order_id: orderAdminId,
      order_number: orderNumber,
      payload: { reason, ...(note ? { note } : {}) },
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/inbox/__tests__/manual-actions.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/inbox/manual-actions.js apps/web/lib/inbox/__tests__/manual-actions.test.js
git commit -m "feat(inbox): add manual action validation/mapping library"
```

---

### Task 2: `POST /api/threads/[threadId]/actions/manual` endpoint

**Files:**
- Create: `apps/web/app/api/threads/[threadId]/actions/manual/route.js`

**Interfaces:**
- Consumes: `buildManualActionInsert` from `apps/web/lib/inbox/manual-actions.js` (Task 1); `CORE_ACTIONS` from `apps/web/lib/action-modes.js`; `resolveAuthScope`/`applyScope` from `apps/web/lib/server/workspace-auth.js`.
- Produces: `POST` handler returning `201 { action: { id: string, actionType: string, detail: string, payload: object, createdAt: string } }` on success, or `{ error: string }` with an appropriate status on failure. This `action` shape matches what `pendingOrderUpdateByThread[threadId]` entries look like elsewhere in the app (`id`, `detail`, `actionType`, `payload`, `createdAt`).

- [ ] **Step 1: Write the implementation**

Create `apps/web/app/api/threads/[threadId]/actions/manual/route.js`:

```js
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import { CORE_ACTIONS } from "@/lib/action-modes";
import { buildManualActionInsert } from "@/lib/inbox/manual-actions";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || ""
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

const asString = (value) => (typeof value === "string" ? value.trim() : "");

function actionLabel(actionType) {
  return CORE_ACTIONS.find((action) => action.type === actionType)?.label || actionType;
}

export async function POST(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const threadId = asString(params?.threadId);
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // validated below
  }
  const actionType = asString(body?.actionType);
  const order = body?.order && typeof body.order === "object" ? body.order : null;
  const formPayload = body?.formPayload && typeof body.formPayload === "object" ? body.formPayload : {};

  const built = buildManualActionInsert({ actionType, order, formPayload });
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.workspaceId) {
    return NextResponse.json(
      { error: "Manual actions require a workspace-scoped account." },
      { status: 400 }
    );
  }

  let threadQuery = serviceClient.from("mail_threads").select("id").eq("id", threadId);
  threadQuery = applyScope(threadQuery, scope);
  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError) {
    return NextResponse.json({ error: threadError.message }, { status: 500 });
  }
  if (!thread?.id) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertError } = await serviceClient
    .from("thread_actions")
    .insert({
      workspace_id: scope.workspaceId,
      user_id: scope.supabaseUserId ?? null,
      thread_id: thread.id,
      action_type: built.insert.action_type,
      action_key: `manual_${built.insert.action_type}_${thread.id}_${Date.now()}`,
      status: "pending",
      source: "manual",
      detail: `Manually triggered by agent: ${actionLabel(actionType)}`,
      payload: built.insert.payload,
      order_id: built.insert.order_id,
      order_number: built.insert.order_number,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id, action_type, detail, payload, created_at")
    .maybeSingle();
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      action: {
        id: String(inserted.id),
        actionType: inserted.action_type,
        detail: inserted.detail,
        payload: inserted.payload,
        createdAt: inserted.created_at,
      },
    },
    { status: 201 }
  );
}
```

- [ ] **Step 2: Lint**

Run: `cd apps/web && npx eslint app/api/threads/\[threadId\]/actions/manual/route.js`
Expected: no errors.

- [ ] **Step 3: Manual smoke test in dev**

Start the dev server (`npm run dev` in `apps/web`), sign in, open a ticket with a matched Shopify order in Sona Insights, and from the browser console on that page run:

```js
fetch(`/api/threads/${window.__SONA_DEBUG_THREAD_ID__ || "<paste a real thread id>"}/actions/manual`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    actionType: "cancel_order",
    order: { id: "#TEST", adminId: "0000000000" },
    formPayload: {},
  }),
}).then((r) => r.json()).then(console.log);
```

Expected: either a `201` with an `action` object (if a thread with that id/scope exists), or a `404`/`400` with a clear error — not a 500. This step only verifies the endpoint is wired and reachable; full end-to-end execution is verified in Task 5's manual walkthrough once the UI can drive it with a real order.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/threads/\[threadId\]/actions/manual/route.js
git commit -m "feat(inbox): add manual actions API endpoint"
```

---

### Task 3: Wire `handleOrderUpdateDecision` and its setter into `SonaInsightsModal`

**Files:**
- Modify: `apps/web/components/inbox/InboxSplitView.jsx`

**Interfaces:**
- Consumes: `setPendingOrderUpdateByThread` (local `useState` setter, already declared at `InboxSplitView.jsx:1045`) and `handleOrderUpdateDecision` (destructured from `useThreadActions()` at `InboxSplitView.jsx:2586`) — both already exist in this file's scope; this task only threads them into a new prop on `<SonaInsightsModal>`.
- Produces: `SonaInsightsModal` now receives `onSeedPendingOrderUpdate` and `onOrderUpdateDecision` props (Task 4 consumes these).

- [ ] **Step 1: Add the two props to the `<SonaInsightsModal>` call**

In `apps/web/components/inbox/InboxSplitView.jsx`, find the `<SonaInsightsModal` element (around line 3840):

```jsx
        <SonaInsightsModal
          open={insightsOpen}
          onOpenChange={setInsightsOpen}
          actions={actions}
          draftId={draftLogId}
          threadId={selectedThread?.id || null}
          draftLoading={draftLogLoading}
          customerLookup={customerLookup}
          customerLookupLoading={customerLookupLoading}
          customerLookupError={customerLookupError}
          onCustomerRefresh={refreshCustomerLookup}
          customerLookupParams={customerLookupParams}
          onOpenTicket={handleOpenPreviousTicket}
```

Change to:

```jsx
        <SonaInsightsModal
          open={insightsOpen}
          onOpenChange={setInsightsOpen}
          actions={actions}
          draftId={draftLogId}
          threadId={selectedThread?.id || null}
          draftLoading={draftLogLoading}
          customerLookup={customerLookup}
          customerLookupLoading={customerLookupLoading}
          customerLookupError={customerLookupError}
          onCustomerRefresh={refreshCustomerLookup}
          customerLookupParams={customerLookupParams}
          onOpenTicket={handleOpenPreviousTicket}
          onSeedPendingOrderUpdate={setPendingOrderUpdateByThread}
          onOrderUpdateDecision={handleOrderUpdateDecision}
```

(Leave every other prop and the rest of the element unchanged — only these two lines are new, inserted right after `onOpenTicket`.)

- [ ] **Step 2: Lint**

Run: `cd apps/web && npx eslint components/inbox/InboxSplitView.jsx`
Expected: no new errors (the two new props are unused by `SonaInsightsModal` until Task 4 — this will not error since they're just extra props on a component that ignores unknown props, but confirm no lint rule flags it before moving on).

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/inbox/InboxSplitView.jsx
git commit -m "feat(inbox): thread order-update decision handler into SonaInsightsModal"
```

---

### Task 4: `ManualActionDialog` component

**Files:**
- Create: `apps/web/components/inbox/ManualActionDialog.jsx`

**Interfaces:**
- Consumes: `RETURN_REASONS` from `apps/web/lib/inbox/manual-actions.js` (Task 1); UI primitives `Dialog`/`DialogContent`/`DialogDescription`/`DialogFooter`/`DialogHeader`/`DialogTitle` from `@/components/ui/dialog`, `Button` from `@/components/ui/button`, `Input` from `@/components/ui/input`, `Label` from `@/components/ui/label`, `Textarea` from `@/components/ui/textarea`, `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` from `@/components/ui/select`.
- Produces: `export function ManualActionDialog({ actionType: string|null, order: object|null, threadId: string, onClose: () => void, onSubmitted: (action: { id, actionType, detail, payload, createdAt }) => void })`. Renders `null` when `actionType` is falsy. On successful submit, calls `onSubmitted(action)` with the API response's `action` object and does not close itself — the caller (Task 5) is responsible for clearing `actionType` in its own `onSubmitted` handler.

- [ ] **Step 1: Write the implementation**

Create `apps/web/components/inbox/ManualActionDialog.jsx`:

```jsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RETURN_REASONS } from "@/lib/inbox/manual-actions";

const ACTION_TITLES = {
  update_shipping_address: "Update shipping address",
  cancel_order: "Cancel unfulfilled order",
  refund_order: "Refund order",
  initiate_return: "Start return",
};

const RETURN_REASON_LABELS = {
  COLOR: "Wrong color",
  DEFECTIVE: "Defective",
  NOT_AS_DESCRIBED: "Not as described",
  OTHER: "Other",
  SIZE_TOO_LARGE: "Size too large",
  SIZE_TOO_SMALL: "Size too small",
  STYLE: "Style",
  UNKNOWN: "Unknown",
  UNWANTED: "No longer wanted",
  WRONG_ITEM: "Wrong item",
};

function emptyFieldsForType(actionType, order) {
  if (actionType === "update_shipping_address") {
    return {
      name: order?.shippingAddress?.name || "",
      address1: order?.shippingAddress?.address1 || "",
      address2: order?.shippingAddress?.address2 || "",
      zip: order?.shippingAddress?.zip || "",
      city: order?.shippingAddress?.city || "",
      country: order?.shippingAddress?.country || "",
    };
  }
  if (actionType === "refund_order") {
    return { amount: order?.total || "", note: "" };
  }
  if (actionType === "initiate_return") {
    return { reason: "", note: "" };
  }
  return {};
}

export function ManualActionDialog({ actionType, order, threadId, onClose, onSubmitted }) {
  const [fields, setFields] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setFields(emptyFieldsForType(actionType, order));
    setError("");
  }, [actionType, order]);

  const setField = (key) => (eventOrValue) => {
    const value = eventOrValue?.target ? eventOrValue.target.value : eventOrValue;
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const confirmLabel = useMemo(() => {
    if (actionType === "refund_order") {
      const amount = Number(fields?.amount);
      return Number.isFinite(amount) && amount > 0
        ? `Refund ${amount.toFixed(2)} ${order?.currency || ""}`.trim()
        : "Refund order";
    }
    if (actionType === "cancel_order") {
      return `Cancel order ${order?.id || ""}`.trim();
    }
    if (actionType === "update_shipping_address") return "Update address";
    if (actionType === "initiate_return") return "Start return";
    return "Confirm";
  }, [actionType, fields?.amount, order?.currency, order?.id]);

  if (!actionType) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/threads/${threadId}/actions/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType,
          order: { id: order?.id, adminId: order?.adminId },
          formPayload: fields,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not start the action.");
      }
      onSubmitted?.(payload.action);
    } catch (submitError) {
      setError(submitError?.message || "Could not start the action.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {ACTION_TITLES[actionType]}
            {order?.id ? ` — ${order.id}` : ""}
          </DialogTitle>
          <DialogDescription>This runs immediately against Shopify once you confirm.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {actionType === "update_shipping_address" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-address-name">Name</Label>
                <Input id="manual-address-name" value={fields.name || ""} onChange={setField("name")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-address-1">Address line 1</Label>
                <Input id="manual-address-1" value={fields.address1 || ""} onChange={setField("address1")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-address-2">Address line 2</Label>
                <Input id="manual-address-2" value={fields.address2 || ""} onChange={setField("address2")} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="manual-address-zip">Zip</Label>
                  <Input id="manual-address-zip" value={fields.zip || ""} onChange={setField("zip")} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="manual-address-city">City</Label>
                  <Input id="manual-address-city" value={fields.city || ""} onChange={setField("city")} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-address-country">Country</Label>
                <Input id="manual-address-country" value={fields.country || ""} onChange={setField("country")} />
              </div>
            </>
          ) : null}

          {actionType === "cancel_order" ? (
            <p className="text-sm text-muted-foreground">
              This cancels order {order?.id} in Shopify. Only unfulfilled orders can be cancelled.
            </p>
          ) : null}

          {actionType === "refund_order" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-refund-amount">Amount ({order?.currency || "order currency"})</Label>
                <Input
                  id="manual-refund-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={fields.amount ?? ""}
                  onChange={setField("amount")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-refund-note">Note (optional)</Label>
                <Textarea id="manual-refund-note" value={fields.note || ""} onChange={setField("note")} />
              </div>
            </>
          ) : null}

          {actionType === "initiate_return" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-return-reason">Reason</Label>
                <Select value={fields.reason || ""} onValueChange={setField("reason")}>
                  <SelectTrigger id="manual-return-reason">
                    <SelectValue placeholder="Select a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {RETURN_REASONS.map((reason) => (
                      <SelectItem key={reason} value={reason}>
                        {RETURN_REASON_LABELS[reason] || reason}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="manual-return-note">Note (optional)</Label>
                <Textarea id="manual-return-note" value={fields.note || ""} onChange={setField("note")} />
              </div>
            </>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Lint**

Run: `cd apps/web && npx eslint components/inbox/ManualActionDialog.jsx`
Expected: no errors. (This component is not yet imported anywhere — that's Task 5 — so no runtime check is possible yet.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/inbox/ManualActionDialog.jsx
git commit -m "feat(inbox): add ManualActionDialog parameter forms"
```

---

### Task 5: "Actions" tab in `SonaInsightsModal`

**Files:**
- Modify: `apps/web/components/inbox/SonaInsightsModal.jsx`

**Interfaces:**
- Consumes: `ManualActionDialog` (Task 4), `resolveMatchedOrder`/`MANUAL_ACTION_TYPES` from `apps/web/lib/inbox/manual-actions.js` (Task 1), `CORE_ACTIONS` from `@/lib/action-modes`, `onSeedPendingOrderUpdate`/`onOrderUpdateDecision` props (Task 3).
- Produces: a third tab, `value="manual-actions"`, alongside the existing `"actions"` (Overview) and `"customer"` tabs.

- [ ] **Step 1: Add new imports and the new props**

In `apps/web/components/inbox/SonaInsightsModal.jsx`, the import block currently reads (lines 1-19):

```js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCustomerLookup } from "@/hooks/useCustomerLookup";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SonaActivityContent } from "@/components/inbox/SonaActivityContent";
import { CustomerTab } from "@/components/inbox/CustomerTab";
import { ChevronRight, ExternalLink, Truck, X } from "lucide-react";
import { TicketMetadataPanel } from "@/components/inbox/TicketMetadataPanel";
import { TrackingCard } from "@/components/inbox/TrackingCard";
import { SonaLogo } from "@/components/ui/SonaLogo";
```

Add two new imports after the `SonaLogo` import:

```js
import { SonaLogo } from "@/components/ui/SonaLogo";
import { ManualActionDialog } from "@/components/inbox/ManualActionDialog";
import { CORE_ACTIONS } from "@/lib/action-modes";
import { MANUAL_ACTION_TYPES, resolveMatchedOrder } from "@/lib/inbox/manual-actions";
```

Below the existing module-level constants (near `const asString = ...` / `const DISPLAY_TIMEZONE = ...`, lines 21-22), add:

```js
const MANUAL_CORE_ACTIONS = CORE_ACTIONS.filter((action) => MANUAL_ACTION_TYPES.includes(action.type));
```

- [ ] **Step 2: Add the two new props to the component signature**

Find (line 251):

```js
export function SonaInsightsModal({
  open,
  onOpenChange,
  actions,
  draftId,
  threadId,
  customerLookup,
  customerLookupLoading,
  customerLookupError,
  onCustomerRefresh,
  customerLookupParams,
  onOpenTicket,
  returnTrackingActionState = null,
}) {
```

Change to:

```js
export function SonaInsightsModal({
  open,
  onOpenChange,
  actions,
  draftId,
  threadId,
  customerLookup,
  customerLookupLoading,
  customerLookupError,
  onCustomerRefresh,
  customerLookupParams,
  onOpenTicket,
  returnTrackingActionState = null,
  onSeedPendingOrderUpdate,
  onOrderUpdateDecision,
}) {
```

- [ ] **Step 3: Add local state for the active manual action**

Find (lines 265-274):

```js
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [returnTrackingDetail, setReturnTrackingDetail] = useState(null);
  const [returnTrackingLoading, setReturnTrackingLoading] = useState(false);
  const containerElRef = useRef(null);
  const containerRef = useCallback((node) => {
    containerElRef.current = node;
  }, []);
  const [sonaLogOpen, setSonaLogOpen] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
```

Add one new line after `const [diagnostic, setDiagnostic] = useState(null);`:

```js
  const [activeManualAction, setActiveManualAction] = useState(null);
```

- [ ] **Step 4: Resolve the matched order and Shopify-availability flag**

Find (lines 286-293):

```js
  const effectiveLookup = customerLookup ?? internalLookup;
  const effectiveLookupLoading = customerLookup != null ? customerLookupLoading : internalLookupLoading;
  const effectiveLookupError = customerLookup != null ? customerLookupError : internalLookupError;
  const effectiveRefresh = onCustomerRefresh ?? internalLookupRefresh;
  const trackingOrder = useMemo(() => {
    const orders = Array.isArray(effectiveLookup?.orders) ? effectiveLookup.orders : [];
    return orders.find((order) => order?.tracking?.number || order?.tracking?.url) || null;
  }, [effectiveLookup?.orders]);
```

Add two new `useMemo`s directly after this block (before `const returnTrackingCandidate = ...`):

```js
  const matchedOrder = useMemo(
    () => resolveMatchedOrder(effectiveLookup?.orders),
    [effectiveLookup?.orders]
  );
  const hasShopifyShop = Boolean(effectiveLookup?.shopDomain);
```

(`effectiveLookup?.shopDomain` is the field `/api/inbox/customer-lookup` sets when it successfully resolves a connected Shopify shop for this thread — see `apps/web/app/api/inbox/customer-lookup/route.js`'s `data.shopDomain`. There is no reliable `shop_id` field on this payload despite one being referenced elsewhere in this file for an unrelated prop — don't reuse that reference as a signal.)

- [ ] **Step 5: Change the tab list from 2 to 3 columns and add the new tab trigger**

Find (lines 440-444):

```jsx
        <Tabs defaultValue="actions" className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden">
          <TabsList className="grid w-full min-w-0 grid-cols-2">
            <TabsTrigger value="actions">Overview</TabsTrigger>
            <TabsTrigger value="customer">Customer</TabsTrigger>
          </TabsList>
```

Change to:

```jsx
        <Tabs defaultValue="actions" className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden">
          <TabsList className="grid w-full min-w-0 grid-cols-3">
            <TabsTrigger value="actions">Overview</TabsTrigger>
            <TabsTrigger value="customer">Customer</TabsTrigger>
            <TabsTrigger value="manual-actions">Actions</TabsTrigger>
          </TabsList>
```

- [ ] **Step 6: Add the new `TabsContent` after the Customer tab**

Find the end of the `Tabs` block (lines 645-655):

```jsx
          <TabsContent value="customer" className="min-w-0 flex-1 overflow-y-auto">
            <CustomerTab
              data={effectiveLookup}
              loading={effectiveLookupLoading}
              error={effectiveLookupError}
              onRefresh={effectiveRefresh}
              lookupParams={customerLookupParams}
              onOpenTicket={onOpenTicket}
            />
          </TabsContent>
        </Tabs>
```

Change to:

```jsx
          <TabsContent value="customer" className="min-w-0 flex-1 overflow-y-auto">
            <CustomerTab
              data={effectiveLookup}
              loading={effectiveLookupLoading}
              error={effectiveLookupError}
              onRefresh={effectiveRefresh}
              lookupParams={customerLookupParams}
              onOpenTicket={onOpenTicket}
            />
          </TabsContent>
          <TabsContent value="manual-actions" className="min-w-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-3 p-1">
              {!hasShopifyShop ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Actions is only available for Shopify shops.
                </p>
              ) : (
                <>
                  {matchedOrder ? (
                    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
                      <span className="font-medium text-foreground">Order {matchedOrder.id}</span>
                      <span className="ml-2 text-muted-foreground">{matchedOrder.status}</span>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No order found on this ticket — find the customer/order under the Customer tab.
                    </p>
                  )}
                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    {MANUAL_CORE_ACTIONS.map((action) => (
                      <button
                        key={action.type}
                        type="button"
                        disabled={!matchedOrder}
                        onClick={() => setActiveManualAction(action.type)}
                        className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-4 text-left last:border-b-0 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-muted/60"
                      >
                        <div className="grid gap-1">
                          <p className="text-sm font-medium text-foreground">{action.label}</p>
                          <p className="text-sm text-muted-foreground">{action.description}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <ManualActionDialog
              actionType={activeManualAction}
              order={matchedOrder}
              threadId={threadId}
              onClose={() => setActiveManualAction(null)}
              onSubmitted={(action) => {
                setActiveManualAction(null);
                if (!action || !threadId) return;
                onSeedPendingOrderUpdate?.((prev) => ({
                  ...prev,
                  [threadId]: {
                    id: action.id,
                    detail: action.detail,
                    actionType: action.actionType,
                    payload: action.payload,
                    createdAt: action.createdAt,
                  },
                }));
                onOrderUpdateDecision?.("accepted");
              }}
            />
          </TabsContent>
        </Tabs>
```

- [ ] **Step 7: Lint**

Run: `cd apps/web && npx eslint components/inbox/SonaInsightsModal.jsx`
Expected: no errors.

- [ ] **Step 8: Manual browser verification**

1. Start the dev server: `cd apps/web && npm run dev`.
2. Sign in, open a ticket whose customer/order has already been resolved (so the Customer tab shows at least one order) — or open one with no resolvable order to check the empty state.
3. Open Sona Insights on that ticket, click the new "Actions" tab.
4. **No order case:** confirm the "No order found..." message appears and all 4 rows are visibly disabled (greyed out, not clickable).
5. **Matched order case:** confirm the order header shows the order number/status, and all 4 rows are enabled regardless of what the shop's Settings → Action permissions currently has configured for that action type (per the design's Scope section — `action_modes` must NOT gate these rows).
6. Click "Cancel unfulfilled order" — confirm the dialog opens with the order number in the title and a "Cancel order #…" button. Click the dialog's own Cancel button and confirm it closes without submitting.
7. Click "Update shipping address" — confirm the address fields are pre-filled from the order's current shipping address (compare against what the Customer tab shows for the same order).
8. Click "Refund order" — confirm the amount field is pre-filled with the order total and the button label updates live as you edit the amount (e.g. typing `50` shows "Refund 50.00 <currency>").
9. Click "Start return" — confirm the reason dropdown lists all 10 reasons.
10. Pick a **test-mode-safe** action (or ensure the workspace is in test mode first, per `workspace_return_settings`/test-mode conventions used elsewhere in this app) and submit one action end-to-end. Confirm: the dialog closes, a toast appears ("Applying action..." then a result), and the action shows up as an `ActionCard` in the main ticket thread — this proves the `pendingOrderUpdateByThread` seeding + `handleOrderUpdateDecision("accepted")` reuse from Task 3/5 actually renders through to the existing card without a manual page refresh.
11. Take a screenshot of the populated Actions tab and the resulting `ActionCard` for the record.

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/inbox/SonaInsightsModal.jsx
git commit -m "feat(inbox): add Actions tab to Sona Insights panel"
```

---

### Task 6: Full test suite and lint pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full web lint**

Run: `cd apps/web && npm run lint`
Expected: no errors introduced by this plan's changes (pre-existing unrelated warnings, if any, are out of scope).

- [ ] **Step 2: Run the full Vitest suite**

Run: `cd apps/web && npx vitest run`
Expected: all tests pass, including the new `lib/inbox/__tests__/manual-actions.test.js`.

- [ ] **Step 3: Re-confirm the Task 5 manual browser walkthrough end to end** (steps 4–10 from Task 5, Step 8) in case any later task touched shared state.

- [ ] **Step 4: Commit (only if any fixups were needed)**

```bash
git add -A
git commit -m "fix(inbox): address lint/test fixups for action library"
```

If nothing needed fixing, skip this commit.

---

## Deferred (not in this plan)

- `create_exchange_request` ("Exchange or replacement") — needs a Shopify line-item/replacement-variant picker; no variant-search API exists in this codebase today. Follow-up plan once that API exists.
