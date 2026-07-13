# Human tone + order-name greeting + partial address-change action — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Drafts greet by the customer's real name, sound human (no AI openers), and propose the Shopify address change even on a partial correction.

**Tech Stack:** Deno / TypeScript, Supabase Edge Functions.

## Global Constraints
- Deno tests: `deno test --no-check --allow-env <file>`. Only 2 known pre-existing `deno check` errors (`_shared/shopify-credentials.ts:36`, `_shared/tracking/providers/gls/tracking.ts:204`) — no new ones.
- Address changes are proposals with `requires_approval: true`. NEVER auto-execute.
- Greeting falls back to neutral whenever identity is uncertain.
- Keep the compact (gpt-5) and classic (gpt-4o) writer rule sets in sync.

---

### Task A: Order-email match is sufficient for the greeting name

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/customer-name-resolution.ts` (the `verified_order_customer` matcher, ~line 121-140)
- Test: `supabase/functions/generate-draft-v2/stages/customer-name-resolution.test.ts` (append)

**Interfaces:** No signature change. Behavior: an exact `orderEmail === senderEmail` now yields `first_name` from the order (source `verified_order_customer`, high confidence) even when the name is not a token of the email local part.

- [ ] **Step 1: Write failing test**

```ts
Deno.test("order-email match alone yields the order first name (concatenated local part)", () => {
  const r = resolveCustomerName({
    latestCustomerMessage: "Hello, i made an error in my shipping address, order #4845.",
    senderEmail: "simonboutrup@gmail.com",
    senderDisplayName: null,
    orderCustomerName: "Simon Boutrup",
    orderCustomerEmail: "simonboutrup@gmail.com",
    recentCustomerMessages: [],
  });
  assertEquals(r.first_name, "Simon");
  assertEquals(r.source, "verified_order_customer");
});

Deno.test("order name is NOT used when the order email differs from the sender", () => {
  const r = resolveCustomerName({
    latestCustomerMessage: "Hi, question about order #4845.",
    senderEmail: "someone.else@gmail.com",
    senderDisplayName: null,
    orderCustomerName: "Simon Boutrup",
    orderCustomerEmail: "simonboutrup@gmail.com",
    recentCustomerMessages: [],
  });
  assertEquals(r.first_name === "Simon", false);
});
```

- [ ] **Step 2: Run tests, verify the first FAILS** (concatenated local part rejected today), the second passes.

- [ ] **Step 3: Implement** — in the matcher (after the `orderEmail !== senderEmail` early-return, ~line 126) insert:

```ts
  // An exact order↔sender email match is sufficient on its own: the emailer IS
  // the order customer. Fixes concatenated locals ("simonboutrup") that don't
  // tokenize to the first name.
  if (orderEmail && senderEmail && orderEmail === senderEmail) return true;
```

Leave the existing displayName / `emailLocalParts` heuristic below it as the fallback for when there is no order email to match.

- [ ] **Step 4: Run tests, verify pass** + run the whole file so existing name-resolution tests stay green.
- [ ] **Step 5: Commit** — `fix(draft): trust order name for greeting on exact email match`

---

### Task B: Human tone — ban robotic openers

**Files:**
- Modify: `supabase/functions/generate-draft-v2/stages/writer.ts` (both the compact gpt-5 rule block and the classic gpt-4o rule block — locate by the existing rule lists, e.g. the `- BILLEDER/VEDHÆFTNINGER:` / `- TEKNISK TROUBLESHOOTING:` bullets around lines 1481-1509 and 1608-1612)

**Interfaces:** Prompt-only. No code contract change.

- [ ] **Step 1: Read both rule blocks** so the new rule is added to BOTH and matches each block's language/format.

- [ ] **Step 2: Add the tone rule** to each block, e.g. (Danish, matching the surrounding bullets):

```
- MENNESKELIG TONE: Skriv som en rutineret kollega, ikke en bot. Åbn ALDRIG med robot-floskler som "I can help you with…", "I'd be happy to assist…", "I can assist you with…", "I'm here to help…", "Jeg kan hjælpe dig med…", "Jeg vil med glæde assistere…". Gå direkte til sagen og ejerskab: fx "Selvfølgelig — jeg retter adressen på #4845 for dig." / "Of course — I'll get that address on #4845 sorted for you." Kunden må ikke kunne mærke at det er en AI.
```

Keep wording faithful to each block's existing tone; do not duplicate an equivalent rule if one already exists — strengthen it instead.

- [ ] **Step 3: Typecheck** — `deno check supabase/functions/generate-draft-v2/stages/writer.ts` (only the 2 pre-existing errors).
- [ ] **Step 4: Commit** — `feat(draft): ban robotic AI openers, model human colleague tone`

(Verified end-to-end in Task C's dry-run matrix.)

---

### Task C: Propose the address change on a partial correction

**Files:**
- Modify: `supabase/functions/generate-draft-v2/pipeline.ts` (new helper near `parseReplacementShippingAddress` ~line 922; wire into the `address_change` proposal block ~line 1999-2034)
- Test: `supabase/functions/generate-draft-v2/pipeline-address-correction.test.ts` (new, pure helper)

**Interfaces:**
- Produces: `parsePartialAddressCorrection(message: string, existingShipping: Record<string, unknown>): { name, address1, address2, zip, city, country, phone } | null` — returns a COMPLETE corrected address built from `existingShipping` with a localised edit applied, or `null` when the edit can't be confidently localised.

- [ ] **Step 1: Write failing tests**

```ts
Deno.test("clears address2 when the customer asks to remove line-2 junk", () => {
  const r = parsePartialAddressCorrection(
    'There is a "7 1tv" on address line 2 or something like that it has to be removed',
    { first_name: "Simon", last_name: "Boutrup", address1: "Testvej 5", address2: "7 1tv", zip: "2100", city: "København", country: "Denmark" },
  );
  assertEquals(r?.address1, "Testvej 5");
  assertEquals(r?.address2, null);
  assertEquals(r?.zip, "2100");
  assertEquals(r?.city, "København");
});

Deno.test("returns null when no order shipping address exists to correct", () => {
  assertEquals(parsePartialAddressCorrection("remove line 2", {}), null);
});

Deno.test("returns null when the correction can't be localised to a field", () => {
  assertEquals(
    parsePartialAddressCorrection("something is wrong with my address", {
      address1: "Testvej 5", zip: "2100", city: "København", country: "Denmark",
    }),
    null,
  );
});
```

- [ ] **Step 2: Run tests, verify they fail.**

- [ ] **Step 3: Implement the helper.** Logic:
  - Require `existingShipping` to already contain a complete address (`address1` + `zip` + `city`); else return `null`.
  - Detect a line-2 removal: message matches `/\b(?:address\s*line\s*2|line\s*2|address2|adresselinje\s*2|linje\s*2|second line)\b/i` AND `/\b(?:remove|removed|delete|clear|slet|fjern|skal væk|should be empty|tom)\b/i` → return `{ ...existing normalized, address2: null }`.
  - (Keep the first version scoped to the address2-removal case — the most common correction. Any other/ambiguous phrasing → `null`, so the pipeline falls back to today's behavior and the writer asks the customer to confirm the full corrected address.)
  - Return the full field set (name from existing first/last, address1/zip/city/country/phone copied from existing, address2 as edited).

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Wire into the address_change block** (pipeline.ts ~2006). After the existing `parseReplacementShippingAddress` attempt, if it produced no complete address, try `parsePartialAddressCorrection(latestBody, facts.order.shipping_address || {})`; if that returns a complete address, use it to build the SAME `update_shipping_address` proposal (`requires_approval: true`, reason e.g. "Delvis adresserettelse på uafsendt ordre"). Do not change auto-execution behavior.

- [ ] **Step 6: Typecheck** — `deno check supabase/functions/generate-draft-v2/pipeline.ts` (only 2 pre-existing errors).
- [ ] **Step 7: Commit** — `feat(draft): propose address-change action on partial corrections`

---

### Task D: Deploy + live verification

- [ ] **Step 1: Deploy** from worktree root: `supabase functions deploy generate-draft-v2 --project-ref ikuupzjaxzvatdnmyzoy --use-api`.
- [ ] **Step 2: Dry-run** the T-051050 thread (find its id: subject "Error in shipping address" / customer simonboutrup@gmail.com). Confirm: greeting "Hi Simon,"; opening not robotic; an `update_shipping_address` proposal present (requires_approval) with address2 cleared. Capture draft_text + proposals verbatim.
- [ ] **Step 3: Regression** — dry-run one non-address thread (e.g. a troubleshooting case) to confirm greeting/tone changes didn't break it.
- [ ] **Step 4: Report** observed drafts.

## Self-Review
- A → greeting; B → tone; C → action; all three defects from T-051050 covered. ✓
- No auto-execution introduced (C uses requires_approval). ✓
