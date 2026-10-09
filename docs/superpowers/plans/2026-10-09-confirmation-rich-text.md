# Confirmation Rich Text (C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirmation emails can be built from ordinary rich-text blocks with variables anywhere. Legacy message-block designs send unchanged.

**Architecture:**
- A full design compiles to complete HTML with sender tokens and a `<!--sona:full-design-->` marker. Its text version is derived from that HTML.
- The web and the sender (`renderCustomerConfirmation` and `composeConfirmation`) both branch on the marker, and the full-design branch fills tokens HTML-escaped.

**Tech Stack:** Next.js 14, Templatical 0.34.3, Deno (postmark-inbound), vitest, deno test.

**Spec:** `docs/superpowers/specs/2026-10-09-confirmation-rich-text-design.md`

## Global Constraints

- Legacy designs (with `{{content}}`) must render exactly as before. The existing tests must stay green unchanged.
- Allowed variables: `customer.first_name`, `customer.full_name`, `store.name`, `conversation.subject`, `ticket.reference`. They are allowed only in `title` and `paragraph` content.
- Token values are HTML-escaped in the HTML and left raw in the text.
- Dev only. postmark-inbound is deployed to dev only after merge, from main, with `--no-verify-jwt`.

## Review Focus

- A `<script>` customer name in a full design must arrive escaped in the HTML.
- A layout without `{{content}}` and without the marker (a legacy edge case) must keep appending content.
- A full design with no ticket number: no `[]` in the subject, an empty token, and text lines that mention it are dropped.
- A paragraph with an unknown variable or a variable in a button URL is rejected.
- The marker must never appear in sent HTML.

---

### Task 1: `htmlToPlainText` (`apps/web/lib/confirmation/plain-text.js`)
Tests first: paragraphs → blank-line separated, `<br>` → newline, `<a href="u">t</a>` → `t (u)`, entities decoded (`&amp; &lt; &gt; &quot; &#39; &nbsp;`), style/head removed, blank lines collapsed, the MJML wrapper ignored.

### Task 2: Normalize and compile (`apps/web/lib/server/confirmation-email.js`)
Tests first, in `confirmation-email.test.js`:
- 0 message blocks is ok and 2 are rejected
- allowed variables in a paragraph pass, an unknown one is rejected, and one in a button is rejected
- compiling without a message block gives HTML with `{{customer_first_name}}`, `{{team_name}}` and the marker, with no `{{content}}`, and the text contains the tokens
Implement with markers for all mapped tokens, the 0/1 rule, and the full-design compile path.

### Task 3: Web `renderCustomerConfirmation` full-design branch
Tests first: an escaped name, a colored span preserved, the footer store name, the reference present and absent, the marker removed. Legacy cases unchanged.

### Task 4: Deno `composeConfirmation` full-design branch
The same cases as Task 3 in `customer-confirmation.test.ts`. Implement it, and keep `index.ts` call sites unchanged: tokens are passed as values, not pre-filled. Run `deno test` and `deno check`.

### Task 5: Templates and designer
- Tests first:
  - all four templates have 0 message blocks and use paragraphs
  - they save and send "Your ticket number: T-50001" and "Demo Store"/"Example Store"
- Implement the paragraph-based templates.
- Remove the message block from the palette, drop the required-block gate (`countBlocks` is no longer required for publish), and update the fallback and default draft (`createConfirmationContent`).

### Task 6: Verify
Check in Chrome against dev: back up the draft, apply Branded, color a word, add a store-name footer, Preview, then restore the backup. Then run `next build`, restart dev, and open the PR.
