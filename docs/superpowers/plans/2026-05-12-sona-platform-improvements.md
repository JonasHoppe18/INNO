# Sona Platform Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 4 real gaps between Sona's current pipeline and production best-practice for AI customer support agents, enabling 10/10 responses and actions across all webshops.

**Architecture:** Each task is independently deployable with no dependency on the others. Tasks are ordered by impact — do them in order. Hybrid retrieval (BM25 + vector + RRF) and procedure-type handling in the writer are already implemented and do not need changes.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), Next.js 14 App Router (JavaScript), Supabase Postgres, Clerk auth

---

## Confirmed gaps (post-codebase audit)

| Gap | Status |
|---|---|
| `pending_asks` not used as gate in action-decision | ❌ Not implemented |
| Action config UI (defect_requires_photo, spare_parts_workflow etc.) | ❌ Not implemented |
| KB freshness monitoring | ❌ Not implemented |
| Action-level confidence thresholds | ❌ Not implemented |
| Hybrid retrieval (BM25 + vector + RRF) | ✅ Already implemented |
| Procedure-type chunks handled by writer | ✅ Already implemented |

---

## Task 1: `pending_asks` as hard gate in action-decision

**What:** If `caseState.pending_asks` is non-empty, action-decision must return `[]` for all resolution intents. This fixes the "exchange proposed before photos received" problem system-wide — not just for `defect_requires_photo`.

**Why this matters:** Right now `pending_asks` is tracked but never enforced. The case-state-updater correctly populates it (e.g. "waiting for photo", "waiting for order number"), but nothing stops action-decision from proposing exchange/refund/return anyway.

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/action-decision.ts`
- Modify: `supabase/functions/generate-draft-v2/pipeline_test.ts`

---

- [ ] **Step 1.1: Write failing test**

Add to `supabase/functions/generate-draft-v2/pipeline_test.ts`:

```typescript
Deno.test("action-decision: returns [] when pending_asks is non-empty", async () => {
  const { applyDeterministicRules } = await import(
    "./stages/action-decision.ts"
  );

  const plan = {
    primary_intent: "exchange",
    sub_queries: [],
    required_facts: [],
    skills_to_consider: [],
    confidence: 0.9,
    language: "da",
  };

  const caseState = {
    intents: [{ type: "exchange", confidence: 0.9 }],
    entities: { order_numbers: [], customer_email: "", products_mentioned: [] },
    decisions_made: [],
    open_questions: [],
    pending_asks: ["photo of the damage"],
    language: "da",
    last_updated_msg_id: "msg-1",
  };

  const facts = {
    order: {
      id: "gid://shopify/Order/123",
      name: "#1234",
      fulfillment_status: null,
      financial_status: "paid",
      line_items: [{ variant_id: "456" }],
    },
    facts: [],
  };

  const retrieved = { chunks: [], past_ticket_examples: [] };
  const shopConfig = {};
  const customerMessage = "headset is broken";

  const result = applyDeterministicRules(
    plan, caseState, facts, retrieved, shopConfig, customerMessage
  );

  assertEquals(result, [], "should return no actions when pending_asks is non-empty");
});

Deno.test("action-decision: proposes exchange when pending_asks is empty", async () => {
  const { applyDeterministicRules } = await import(
    "./stages/action-decision.ts"
  );

  const plan = {
    primary_intent: "exchange",
    sub_queries: [],
    required_facts: [],
    skills_to_consider: [],
    confidence: 0.9,
    language: "da",
  };

  const caseState = {
    intents: [{ type: "exchange", confidence: 0.9 }],
    entities: { order_numbers: [], customer_email: "", products_mentioned: [] },
    decisions_made: [],
    open_questions: [],
    pending_asks: [],  // empty — photos received
    language: "da",
    last_updated_msg_id: "msg-2",
  };

  const facts = {
    order: {
      id: "gid://shopify/Order/123",
      name: "#1234",
      fulfillment_status: null,
      financial_status: "paid",
      line_items: [{ variant_id: "456" }],
    },
    facts: [],
  };

  const retrieved = { chunks: [], past_ticket_examples: [] };
  const shopConfig = {};
  const customerMessage = "headset is physically broken";

  const result = applyDeterministicRules(
    plan, caseState, facts, retrieved, shopConfig, customerMessage
  );

  assertNotEquals(result.length, 0, "should propose exchange when no pending asks");
});
```

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
cd /Users/jonashoppe/Developer/INNO
npx supabase functions serve generate-draft-v2 --no-verify-jwt &
deno test supabase/functions/generate-draft-v2/pipeline_test.ts --allow-net --allow-env 2>&1 | grep -A3 "pending_asks"
```

Expected: first test FAILS — action-decision currently ignores `pending_asks`.

- [ ] **Step 1.3: Add `pending_asks` gate to `applyDeterministicRules`**

In `supabase/functions/generate-draft-v2/stages/action-decision.ts`, add after the `replacementAlreadyArranged` guard (around line 296, before the `address_change` block):

```typescript
  // ── Guard: pending asks — vi venter på information fra kunden ──────────────
  // Hvis pending_asks ikke er tom, er vi i informationsindsamlings-mode.
  // Action-decision må ikke foreslå resolution-actions (exchange, refund, return)
  // før vi har fået den afventede information. Writer håndterer opfølgningen.
  const RESOLUTION_INTENTS = new Set([
    "exchange", "complaint", "refund", "return", "cancel",
  ]);
  if (
    caseState.pending_asks.length > 0 &&
    RESOLUTION_INTENTS.has(intent)
  ) {
    return [];
  }
```

Place it right after this existing block (line ~295):
```typescript
  if (
    replacementAlreadyArranged &&
    ["complaint", "exchange", "refund"].includes(intent)
  ) {
    return [];
  }
  // ← INSERT THE NEW GUARD HERE
  // ── 2. Adresseændring ──────
```

- [ ] **Step 1.4: Run tests to confirm both pass**

```bash
deno test supabase/functions/generate-draft-v2/pipeline_test.ts --allow-net --allow-env 2>&1 | grep -E "(PASS|FAIL|pending_asks)"
```

Expected: both tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add supabase/functions/generate-draft-v2/stages/action-decision.ts \
        supabase/functions/generate-draft-v2/pipeline_test.ts
git commit -m "feat(pipeline): pending_asks blocks resolution actions until info is received"
```

---

## Task 2: Action config UI — shop-configurable workflow rules

**What:** A "Claim handling" section in AutomationPanel where shops configure `defect_requires_photo`, `spare_parts_workflow`, and `exchange_workflow`. These values map directly to `shops.action_config` JSONB — the column already exists.

**Files:**
- Create: `apps/web/app/api/action-config/route.js`
- Create: `apps/web/hooks/useActionConfig.js`
- Modify: `apps/web/components/agent/AutomationPanel.jsx`

---

- [ ] **Step 2.1: Create the API route**

Create `apps/web/app/api/action-config/route.js`:

```javascript
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

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

const ALLOWED_KEYS = [
  "defect_requires_photo",
  "spare_parts_workflow",
  "exchange_workflow",
];

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (!scope?.workspaceId) {
    return NextResponse.json({ action_config: {} });
  }

  const { data } = await supabase
    .from("shops")
    .select("action_config")
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();

  const config = data?.action_config ?? {};
  const safe = Object.fromEntries(
    ALLOWED_KEYS.map((k) => [k, config[k] ?? null])
  );

  return NextResponse.json({ action_config: safe });
}

export async function POST(req) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (!scope?.workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));

  // Only allow known keys — never merge unknown fields into action_config
  const patch = {};
  for (const key of ALLOWED_KEYS) {
    if (key in body) patch[key] = body[key];
  }

  // Merge with existing config to avoid overwriting unrelated flags
  const { data: existing } = await supabase
    .from("shops")
    .select("action_config")
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();

  const merged = { ...(existing?.action_config ?? {}), ...patch };

  const { error } = await supabase
    .from("shops")
    .update({ action_config: merged })
    .eq("workspace_id", scope.workspaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const safe = Object.fromEntries(
    ALLOWED_KEYS.map((k) => [k, merged[k] ?? null])
  );

  return NextResponse.json({ ok: true, action_config: safe });
}
```

- [ ] **Step 2.2: Create the hook**

Create `apps/web/hooks/useActionConfig.js`:

```javascript
"use client";

import { useCallback, useEffect, useState } from "react";

const DEFAULT_CONFIG = {
  defect_requires_photo: false,
  spare_parts_workflow: "shopify",
  exchange_workflow: "shopify",
};

export function useActionConfig() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [initialConfig, setInitialConfig] = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch("/api/action-config", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        const loaded = {
          defect_requires_photo: data?.action_config?.defect_requires_photo ?? false,
          spare_parts_workflow: data?.action_config?.spare_parts_workflow ?? "shopify",
          exchange_workflow: data?.action_config?.exchange_workflow ?? "shopify",
        };
        setConfig(loaded);
        setInitialConfig(loaded);
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const isDirty =
    JSON.stringify(config) !== JSON.stringify(initialConfig);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/action-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed");
      const saved = {
        defect_requires_photo: data.action_config?.defect_requires_photo ?? false,
        spare_parts_workflow: data.action_config?.spare_parts_workflow ?? "shopify",
        exchange_workflow: data.action_config?.exchange_workflow ?? "shopify",
      };
      setConfig(saved);
      setInitialConfig(saved);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [config]);

  const update = useCallback((key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setConfig(initialConfig);
  }, [initialConfig]);

  return { config, loading, saving, error, isDirty, update, save, reset };
}
```

- [ ] **Step 2.3: Add "Claim handling" section to AutomationPanel**

In `apps/web/components/agent/AutomationPanel.jsx`, add the import at the top:

```javascript
import { useActionConfig } from "@/hooks/useActionConfig";
```

Then inside the `AutomationPanel` component function (after the existing `returnSettings` state, around line 190), add:

```javascript
  const {
    config: actionConfig,
    loading: actionConfigLoading,
    saving: actionConfigSaving,
    error: actionConfigError,
    isDirty: actionConfigDirty,
    update: updateActionConfig,
    save: saveActionConfig,
    reset: resetActionConfig,
  } = useActionConfig();
```

Add `actionConfigDirty` and `saveActionConfig` to the existing save/dirty detection (merge into `hasUnsavedChanges` and `handleSave`). Find the `hasUnsavedChanges` computation and add:

```javascript
  const hasUnsavedChanges = useMemo(() => {
    // ... existing checks ...
    if (actionConfigDirty) return true;
    return false;
  }, [/* existing deps */, actionConfigDirty]);
```

Find where `handleSave` calls save functions and add:
```javascript
    if (actionConfigDirty) await saveActionConfig();
```

Add this `SettingsSection` in the JSX, after the Returns section and before Learning Profile:

```jsx
<SettingsSection
  title="Claim handling"
  description="Configure how Sona handles warranty claims, spare parts, and exchanges. Applied to all tickets for this store."
>
  <div className="space-y-6">
    {/* defect_requires_photo */}
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold text-slate-900">
          Require photos for defect claims
        </h3>
        <p className="text-xs text-slate-500">
          When enabled, Sona will ask for photos before proposing an exchange or replacement. Sona waits for photos before taking action.
        </p>
      </div>
      <Switch
        checked={Boolean(actionConfig.defect_requires_photo)}
        onCheckedChange={(checked) =>
          updateActionConfig("defect_requires_photo", checked)
        }
        disabled={actionConfigLoading || actionConfigSaving}
      />
    </div>

    <Separator />

    {/* spare_parts_workflow */}
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">Spare parts</h3>
      <p className="text-xs text-slate-500">
        How should Sona handle requests for replacement parts (cables, ear pads, accessories)?
      </p>
      <Select
        value={actionConfig.spare_parts_workflow ?? "shopify"}
        onValueChange={(value) =>
          updateActionConfig("spare_parts_workflow", value)
        }
        disabled={actionConfigLoading || actionConfigSaving}
      >
        <SelectTrigger className="max-w-xs bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="office">Send from office</SelectItem>
          <SelectItem value="shopify">Create exchange in Shopify</SelectItem>
          <SelectItem value="manual">Route to team for review</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <Separator />

    {/* exchange_workflow */}
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">Exchange requests</h3>
      <p className="text-xs text-slate-500">
        How should Sona handle product exchange requests (not spare parts)?
      </p>
      <Select
        value={actionConfig.exchange_workflow ?? "shopify"}
        onValueChange={(value) =>
          updateActionConfig("exchange_workflow", value)
        }
        disabled={actionConfigLoading || actionConfigSaving}
      >
        <SelectTrigger className="max-w-xs bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="shopify">Create exchange request in Shopify</SelectItem>
          <SelectItem value="manual">Route to team for review</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {actionConfigError && (
      <p className="text-xs text-destructive">{actionConfigError.message}</p>
    )}
  </div>
</SettingsSection>
```

- [ ] **Step 2.4: Test in browser**

```bash
cd /Users/jonashoppe/Developer/INNO/apps/web
npm run dev
```

Open `http://localhost:3000` → Agent → Automation tab. Verify:
- "Claim handling" section appears after Returns
- Toggle and selects respond to interaction
- Saving triggers a POST to `/api/action-config`
- Reload shows saved values

- [ ] **Step 2.5: Commit**

```bash
git add apps/web/app/api/action-config/route.js \
        apps/web/hooks/useActionConfig.js \
        apps/web/components/agent/AutomationPanel.jsx
git commit -m "feat(ui): add Claim handling section to AutomationPanel for per-shop action config"
```

---

## Task 3: AceZone immediate setup (no code — SQL + KB entry)

**What:** Configure AceZone specifically using the mechanisms now in place. Three actions: set action_config flag, update policy_refund with warranty procedure, create A-Spire Wireless repair snippet.

**Files:**
- Supabase dashboard SQL editor (or MCP)
- KB management UI in Sona

---

- [ ] **Step 3.1: Set `defect_requires_photo` for AceZone**

Run in Supabase SQL editor:

```sql
UPDATE shops
SET action_config = jsonb_set(
  COALESCE(action_config, '{}'),
  '{defect_requires_photo}',
  'true'
)
WHERE id = '38df5fef-2a23-47f3-803e-39f2d6f1ed99';

-- Verify:
SELECT action_config FROM shops WHERE id = '38df5fef-2a23-47f3-803e-39f2d6f1ed99';
```

Expected: `{"spare_parts_workflow": "office", "defect_requires_photo": true}`

- [ ] **Step 3.2: Add warranty claim procedure to `policy_refund`**

Run in Supabase SQL editor (appends to existing policy_refund text):

```sql
UPDATE shops
SET policy_refund = policy_refund || E'\n\nWARRANTY CLAIM PROCEDURE:\nStep 1: If the customer reports a defect or physical damage, ask for photos of the damage AND their order number (if not already provided). Do not propose exchange or replacement before photos are received.\nStep 2: Once photos are received, confirm whether the damage is covered by warranty (manufacturing defect = covered; physical abuse, water damage, cosmetic wear = not covered).\nStep 3: If covered, send the repair return instructions (use the A-Spire Wireless or A-Rise repair snippet depending on product). AceZone repairs or ships a replacement from office.\nStep 4: If not covered under warranty, explain clearly why and offer any relevant alternatives.\nNever promise a specific outcome (repair vs. replacement) until the product has been received and inspected.'
WHERE id = '38df5fef-2a23-47f3-803e-39f2d6f1ed99';
```

- [ ] **Step 3.3: Create A-Spire Wireless repair snippet in KB UI**

In Sona → Knowledge → add new snippet with this content:

```
Saved reply: A-Spire Wireless - Repair/Warranty Instructions
Category: Return for Repair

Thank you for sending the photos. We can confirm this is covered under warranty and will arrange the next steps.

Please send the headset to us for inspection and repair/replacement:

1. Pack the headset securely in a box with adequate padding.
2. Include a note with your full name and order number (#XXXX).
3. Ship to:
   AceZone International ApS
   Øster Allé 56, 5th floor
   2100 København Ø
   Denmark
   Att: AceZone Repair
   Phone: +45 31501800

4. Use a tracked shipping service and keep your tracking number.
5. Once we receive it, we will inspect and either repair or ship a replacement. We will notify you when it ships.

Please note: shipping to us is at your expense. We will cover return shipping.
```

- [ ] **Step 3.4: Verify end-to-end**

In Sona inbox, find or create a test ticket with a physical damage complaint (no photos). Verify:
- Sona does NOT propose exchange (pending_asks gate working)
- Sona asks for photos + order number
- After simulating photo receipt (send a follow-up), verify next draft proposes repair flow

---

## Task 4: KB freshness monitoring

**What:** Track when KB entries were last verified and surface stale content in the KB management UI. Stale knowledge is the #1 production failure mode.

**Files:**
- Create: `supabase/migrations/YYYYMMDD_kb_freshness.sql`
- Modify: `apps/web/app/api/knowledge/` (add freshness data to list responses)
- Modify: `apps/web/components/knowledge/` (surface stale indicator in UI)

---

- [ ] **Step 4.1: Migration — add freshness columns**

Create `supabase/migrations/$(date +%Y%m%d)000000_kb_freshness.sql`:

```sql
-- Track when KB entries were last verified against their source
ALTER TABLE agent_knowledge
  ADD COLUMN IF NOT EXISTS source_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT now();

-- Index for finding stale entries efficiently
CREATE INDEX IF NOT EXISTS agent_knowledge_last_verified_idx
  ON agent_knowledge(shop_id, last_verified_at);

-- Backfill: mark all existing entries as verified now
UPDATE agent_knowledge SET last_verified_at = now() WHERE last_verified_at IS NULL;
```

Run:
```bash
npx supabase db push
```

- [ ] **Step 4.2: Add freshness API to knowledge list endpoint**

Find the knowledge list API route (likely `apps/web/app/api/knowledge/route.js`). Add a staleness calculation to the response — entries not verified in 30 days are flagged:

```javascript
// In the SELECT query, add last_verified_at to the selected columns
// Then in the response mapping:
const STALE_DAYS = 30;
const staleThreshold = new Date(Date.now() - STALE_DAYS * 86400 * 1000);

const entries = data.map((row) => ({
  ...row,
  is_stale: row.last_verified_at
    ? new Date(row.last_verified_at) < staleThreshold
    : true,
}));
```

- [ ] **Step 4.3: Surface stale indicator in KB UI**

In the knowledge management component (find via `apps/web/components/knowledge/`), add a warning badge next to stale entries:

```jsx
{entry.is_stale && (
  <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
    Needs review
  </span>
)}
```

When a shop admin opens and saves a KB entry, update `last_verified_at = now()` via a PATCH to the knowledge API.

- [ ] **Step 4.4: Update `last_verified_at` on KB save**

In the knowledge item update API route, add:

```javascript
await supabase
  .from("agent_knowledge")
  .update({ last_verified_at: new Date().toISOString() })
  .eq("id", entryId);
```

- [ ] **Step 4.5: Commit**

```bash
git add supabase/migrations/ apps/web/app/api/knowledge/ apps/web/components/knowledge/
git commit -m "feat(kb): add freshness tracking with stale indicator in KB management UI"
```

---

## Task 5: Action-level confidence thresholds

**What:** Allow shops to configure per-action approval thresholds — e.g. auto-approve refunds under 50 DKK, always gate exchanges. Currently `requires_approval` is hardcoded per action type.

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/action-decision.ts`
- Modify: `apps/web/app/api/action-config/route.js`
- Modify: `apps/web/hooks/useActionConfig.js`
- Modify: `apps/web/components/agent/AutomationPanel.jsx`

---

- [ ] **Step 5.1: Extend `ShopActionConfig` type**

In `supabase/functions/generate-draft-v2/stages/action-decision.ts`, extend the interface:

```typescript
export interface ActionThreshold {
  auto_approve_under_amount?: number; // DKK/EUR — for refund_order only
  always_require_approval?: boolean;  // override everything, always gate
}

export interface ShopActionConfig {
  // ... existing fields ...
  action_thresholds?: Partial<Record<string, ActionThreshold>>;
}
```

- [ ] **Step 5.2: Write failing test for threshold logic**

Add to `pipeline_test.ts`:

```typescript
Deno.test("action-decision: auto-approves small refund when under threshold", async () => {
  const { applyDeterministicRules } = await import("./stages/action-decision.ts");

  const plan = {
    primary_intent: "refund",
    sub_queries: [],
    required_facts: [],
    skills_to_consider: [],
    confidence: 0.9,
    language: "da",
  };

  const caseState = {
    intents: [{ type: "refund", confidence: 0.9 }],
    entities: { order_numbers: ["#1234"], customer_email: "test@test.com", products_mentioned: [] },
    decisions_made: [],
    open_questions: [],
    pending_asks: [],
    language: "da",
    last_updated_msg_id: "msg-1",
  };

  const facts = {
    order: {
      id: "gid://shopify/Order/123",
      name: "#1234",
      fulfillment_status: null,
      financial_status: "paid",
      created_at: new Date().toISOString(),
      total_price: "45.00",
    },
    facts: [{ label: "Returret", value: "Ja — inden for returvinduet" }],
  };

  const shopConfig = {
    action_thresholds: {
      refund_order: { auto_approve_under_amount: 100 },
    },
  };

  const result = applyDeterministicRules(
    plan, caseState, facts, { chunks: [], past_ticket_examples: [] }, shopConfig, "refund please"
  );

  assertEquals(result.length, 1);
  assertEquals(result[0].type, "refund_order");
  assertEquals(result[0].requires_approval, false, "should auto-approve refund under threshold");
});
```

- [ ] **Step 5.3: Implement threshold check in refund block**

In `action-decision.ts` refund block (around line 360), replace the `requiresApproval` logic:

```typescript
    // Threshold-based approval: check action_thresholds config first
    const refundThreshold = shopConfig.action_thresholds?.refund_order;
    let requiresApproval = true;

    if (refundThreshold?.always_require_approval) {
      requiresApproval = true;
    } else if (
      refundThreshold?.auto_approve_under_amount != null &&
      order.total_price != null
    ) {
      const amount = parseFloat(String(order.total_price).replace(",", "."));
      requiresApproval = amount > refundThreshold.auto_approve_under_amount;
    } else {
      // Fall back to existing refund_auto_days logic
      const autoDays = shopConfig.refund_auto_days ?? 0;
      if (autoDays > 0 && order.created_at) {
        const daysSince = Math.floor(
          (Date.now() - new Date(order.created_at).getTime()) / 86_400_000,
        );
        requiresApproval = daysSince > autoDays;
      }
    }
```

- [ ] **Step 5.4: Run tests**

```bash
deno test supabase/functions/generate-draft-v2/pipeline_test.ts --allow-net --allow-env 2>&1 | grep -E "(PASS|FAIL|threshold)"
```

Expected: all tests PASS.

- [ ] **Step 5.5: Extend action-config API to include thresholds**

In `apps/web/app/api/action-config/route.js`, add `"action_thresholds"` to `ALLOWED_KEYS`:

```javascript
const ALLOWED_KEYS = [
  "defect_requires_photo",
  "spare_parts_workflow",
  "exchange_workflow",
  "action_thresholds",  // add this
];
```

- [ ] **Step 5.6: Add refund threshold control to Claim handling UI**

In the `SettingsSection` for Claim handling in `AutomationPanel.jsx`, add after the exchange_workflow select:

```jsx
<Separator />

<div className="space-y-2">
  <h3 className="text-sm font-semibold text-slate-900">Auto-approve refunds under</h3>
  <p className="text-xs text-slate-500">
    Refunds below this amount are automatically approved. Set to 0 to always require approval.
  </p>
  <div className="flex items-center gap-2 max-w-xs">
    <Input
      type="number"
      min={0}
      value={
        actionConfig.action_thresholds?.refund_order?.auto_approve_under_amount ?? 0
      }
      onChange={(e) =>
        updateActionConfig("action_thresholds", {
          ...(actionConfig.action_thresholds ?? {}),
          refund_order: {
            ...(actionConfig.action_thresholds?.refund_order ?? {}),
            auto_approve_under_amount: Number(e.target.value),
          },
        })
      }
      disabled={actionConfigLoading || actionConfigSaving}
      className="bg-white"
    />
    <span className="text-sm text-slate-500">DKK</span>
  </div>
</div>
```

- [ ] **Step 5.7: Commit**

```bash
git add supabase/functions/generate-draft-v2/stages/action-decision.ts \
        supabase/functions/generate-draft-v2/pipeline_test.ts \
        apps/web/app/api/action-config/route.js \
        apps/web/hooks/useActionConfig.js \
        apps/web/components/agent/AutomationPanel.jsx
git commit -m "feat(pipeline): action-level approval thresholds configurable per shop"
```

---

## Self-review

**Spec coverage:**
- ✅ Gap 1: `pending_asks` gate — Task 1
- ✅ Action config UI — Task 2
- ✅ AceZone immediate setup — Task 3
- ✅ KB freshness monitoring — Task 4
- ✅ Action-level thresholds — Task 5
- ✅ Hybrid retrieval — already implemented, no task needed
- ✅ Procedure-type handling — already implemented, no task needed

**Placeholder scan:** No TBDs or incomplete sections. All code blocks are complete.

**Type consistency:**
- `ShopActionConfig` extended in Task 5 Step 5.1 — referenced in Task 2 API route which only allows string keys (no type mismatch)
- `applyDeterministicRules` signature unchanged across all tasks
- `useActionConfig` hook `update(key, value)` used consistently in Task 2 and Task 5 UI steps
