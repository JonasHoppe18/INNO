# Inline Translation + Composer Globe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-message "Show translation" toggle to the inbox and a globe icon in the composer that auto-detects the customer's language and can regenerate the draft in a chosen language.

**Architecture:** A new `customer_language` column on `mail_threads` is populated by `postmark-inbound` via a lightweight GPT-4o-mini detect call. The translation API lazily backfills it for older threads. InboxSplitView holds a translation cache shared by MessageBubble toggles and the existing modal. The composer globe reads `customer_language` from thread data and, on language change, calls `onGenerateDraft` with a `replyLanguage` override that flows through to `generate-draft-unified`.

**Tech Stack:** Next.js 14 (App Router), Supabase Edge Functions (Deno/TypeScript), React 18, Tailwind CSS, Radix UI, Lucide React icons, gpt-4o-mini (language detection), existing `/api/inbox/threads/[threadId]/translation` endpoint.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/schema/customer_language.sql` | Create | DB migration |
| `supabase/functions/_shared/detect-language.ts` | Create | Lightweight GPT-4o-mini language detector |
| `supabase/functions/postmark-inbound/index.ts` | Modify | Detect + store customer_language on new threads |
| `apps/web/app/api/inbox/threads/[threadId]/translation/route.js` | Modify | Lazy backfill customer_language on first translation |
| `apps/web/lib/server/inbox-data.js` | Modify | Add customer_language to thread select query |
| `apps/web/components/inbox/InboxSplitView.jsx` | Modify | Translation cache, pass detectedLanguage + translation props |
| `apps/web/components/inbox/MessageBubble.jsx` | Modify | "Show translation" toggle |
| `apps/web/components/inbox/Composer.jsx` | Modify | Globe button, replyLanguage state, language popover |
| `apps/web/app/api/threads/[threadId]/generate-draft/route.js` | Modify | Pass reply_language to generate-draft-unified |
| `supabase/functions/generate-draft-unified/index.ts` | Modify | Accept reply_language override |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/schema/customer_language.sql`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/schema/customer_language.sql
alter table public.mail_threads
  add column if not exists customer_language text;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `mcp__claude_ai_Supabase__apply_migration` tool with project_id `ikuupzjaxzvatdnmyzoy` and the SQL above.

- [ ] **Step 3: Verify column exists**

Run SQL via MCP:
```sql
select column_name from information_schema.columns
where table_name = 'mail_threads' and column_name = 'customer_language';
```
Expected: one row returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema/customer_language.sql
git commit -m "feat: add customer_language column to mail_threads"
```

---

## Task 2: Shared language detect utility

**Files:**
- Create: `supabase/functions/_shared/detect-language.ts`

- [ ] **Step 1: Create the file**

```typescript
// supabase/functions/_shared/detect-language.ts

const SUPPORTED = new Set(["en", "da", "de", "es", "fr", "sv", "no"]);

/**
 * Calls GPT-4o-mini to detect the ISO-639-1 language code of the given text.
 * Returns a supported code (en/da/de/es/fr/sv/no) or "unknown".
 * Skips the call and returns "unknown" if text is shorter than 10 chars.
 */
export async function detectCustomerLanguage(
  text: string,
  openaiApiKey: string,
): Promise<string> {
  const cleaned = String(text || "").trim();
  if (!cleaned || cleaned.length < 10 || !openaiApiKey) return "unknown";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 5,
        messages: [
          {
            role: "system",
            content:
              "Respond ONLY with the ISO-639-1 language code (e.g. 'da', 'en', 'de'). No other text.",
          },
          {
            role: "user",
            content: `Detect language: ${cleaned.slice(0, 400)}`,
          },
        ],
      }),
    });
    if (!res.ok) return "unknown";
    const json = await res.json().catch(() => null);
    const code = String(json?.choices?.[0]?.message?.content || "")
      .trim()
      .toLowerCase()
      .slice(0, 2);
    return SUPPORTED.has(code) ? code : "unknown";
  } catch {
    return "unknown";
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/detect-language.ts
git commit -m "feat: add shared detectCustomerLanguage utility"
```

---

## Task 3: postmark-inbound — detect and store customer_language

**Files:**
- Modify: `supabase/functions/postmark-inbound/index.ts`

Find the section right after the thread is inserted or updated (around line 1519 — after `await supabase.from("mail_threads").update(updatePayload).eq("id", threadId)`).

- [ ] **Step 1: Import detect-language at the top of the file**

Add to the imports block at the top of `supabase/functions/postmark-inbound/index.ts`:

```typescript
import { detectCustomerLanguage } from "../_shared/detect-language.ts";
```

- [ ] **Step 2: Read OPENAI_API_KEY in postmark-inbound**

Near the other `Deno.env.get` calls at the top of the file, add:

```typescript
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
```

- [ ] **Step 3: Add language detection after thread write**

After `await supabase.from("mail_threads").update(updatePayload).eq("id", threadId);` (around line 1519), add:

```typescript
  // Detect and store customer language (fire-and-forget, non-blocking)
  if (createdNewThread && cleanBodyText) {
    detectCustomerLanguage(cleanBodyText, OPENAI_API_KEY).then((lang) => {
      if (lang !== "unknown") {
        supabase
          .from("mail_threads")
          .update({ customer_language: lang })
          .eq("id", threadId)
          .then(() => null)
          .catch(() => null);
      }
    }).catch(() => null);
  }
```

> `cleanBodyText` is the parsed body text already available in postmark-inbound. Check the exact variable name in the file — it may be `parsedBodies.cleanBodyText` or similar. Adjust accordingly.

- [ ] **Step 4: Verify the variable name**

Search `postmark-inbound/index.ts` for `cleanBodyText` or the equivalent plain-text body variable used when inserting `mail_messages`. Use that variable in the detect call above.

- [ ] **Step 5: Deploy**

```bash
npx supabase functions deploy postmark-inbound --no-verify-jwt
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/postmark-inbound/index.ts
git commit -m "feat: detect and store customer_language on new threads in postmark-inbound"
```

---

## Task 4: Translation API — lazy backfill customer_language

**Files:**
- Modify: `apps/web/app/api/inbox/threads/[threadId]/translation/route.js`

The GET handler already translates all conversation items and returns `originalLanguage` per item. After a successful translation response, patch `customer_language` on the thread if it's currently null.

- [ ] **Step 1: Find the GET handler's thread query**

In `route.js`, locate `getScopedThread` (around line 161). It currently selects `"id, workspace_id"`. Change to also select `customer_language`:

```javascript
async function getScopedThread(serviceClient, scope, threadId) {
  const { data: thread, error } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, workspace_id, customer_language")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (error || !thread?.id) {
    return null;
  }
  return thread;
}
```

- [ ] **Step 2: Add lazy backfill after successful translation**

In the GET handler, after the translation response is assembled and before `return NextResponse.json(...)`, add:

```javascript
  // Lazy backfill: store detected language from first customer item
  if (!thread.customer_language) {
    const firstCustomerItem = conversationItems.find(
      (item) => item.role === "customer" && item.originalLanguage && item.originalLanguage !== "unknown"
    );
    if (firstCustomerItem?.originalLanguage) {
      await serviceClient
        .from("mail_threads")
        .update({ customer_language: firstCustomerItem.originalLanguage })
        .eq("id", threadId)
        .catch(() => null);
    }
  }
```

> `conversationItems` is the array built from the OpenAI response. Verify the exact variable name in the GET handler and adjust if needed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/inbox/threads/[threadId]/translation/route.js
git commit -m "feat: lazy backfill customer_language from translation API"
```

---

## Task 5: inbox-data.js — include customer_language in thread select

**Files:**
- Modify: `apps/web/lib/server/inbox-data.js`

- [ ] **Step 1: Add customer_language to the withCustomerFields select string**

In `inbox-data.js` around line 98, the select string for `withCustomerFields = true` is a long comma-separated string. Append `, customer_language` to it:

```javascript
"id, user_id, mailbox_id, provider, provider_thread_id, subject, snippet, customer_name, customer_email, customer_last_inbound_at, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, classification_key, classification_confidence, classification_reason, created_at, updated_at, customer_language"
```

Also add it to the `withCustomerFields = false` string:

```javascript
"id, user_id, mailbox_id, provider, provider_thread_id, subject, snippet, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, classification_key, classification_confidence, classification_reason, created_at, updated_at, customer_language"
```

- [ ] **Step 2: Add customer_language to the fallback error regex**

Line ~108 has a regex that checks if the error is about missing customer columns. Add `customer_language` to it so it also falls back gracefully:

```javascript
  if (
    error &&
    /customer_name|customer_email|customer_last_inbound_at|customer_language/i.test(String(error.message || ""))
  ) {
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/server/inbox-data.js
git commit -m "feat: include customer_language in thread select query"
```

---

## Task 6: InboxSplitView — translation cache + pass props

**Files:**
- Modify: `apps/web/components/inbox/InboxSplitView.jsx`

- [ ] **Step 1: Add translationCache state**

Near the other `useState` declarations (around line 811), add:

```javascript
const [translationCache, setTranslationCache] = useState({});
// Shape: { [threadId]: { loading: boolean, items: Array<{id, translatedText, originalLanguage}>, draft: {translatedText} | null } }
```

- [ ] **Step 2: Add fetchTranslation handler**

Add a new `useCallback` handler after `handleGenerateDraft`:

```javascript
const fetchTranslationForThread = useCallback(async (threadId) => {
  if (!threadId) return;
  setTranslationCache((prev) => {
    if (prev[threadId]?.items || prev[threadId]?.loading) return prev;
    return { ...prev, [threadId]: { loading: true, items: [], draft: null } };
  });
  try {
    const res = await fetch(
      `/api/inbox/threads/${encodeURIComponent(threadId)}/translation`,
      { method: "GET", cache: "no-store", credentials: "include" }
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || "Translation failed.");
    setTranslationCache((prev) => ({
      ...prev,
      [threadId]: {
        loading: false,
        items: Array.isArray(payload?.conversation?.items) ? payload.conversation.items : [],
        draft: payload?.draft || null,
      },
    }));
  } catch {
    setTranslationCache((prev) => ({
      ...prev,
      [threadId]: { loading: false, items: [], draft: null },
    }));
  }
}, []);
```

- [ ] **Step 3: Refactor TranslationModal to use the cache**

Currently `TranslationModal` fetches its own data. Change it to accept `translationData` and `translationLoading` props instead. Find where `<TranslationModal>` is rendered (around line 3920) and change:

```jsx
<TranslationModal
  open={translationModalOpen}
  onOpenChange={(open) => {
    setTranslationModalOpen(open);
    if (open && selectedThreadId && !translationCache[selectedThreadId]?.items?.length) {
      fetchTranslationForThread(selectedThreadId);
    }
  }}
  threadId={selectedThreadId}
  translationData={translationCache[selectedThreadId] || null}
/>
```

Then update `TranslationModal` to accept and use these props instead of fetching internally (Task 6b below).

- [ ] **Step 4: Pass detectedLanguage to Composer**

Find where `<Composer>` (or `onGenerateDraft`) is passed around line 3885. Add:

```jsx
detectedLanguage={selectedThread?.customer_language || null}
```

where `selectedThread` is `derivedThreads.find((t) => t.id === selectedThreadId)`.

- [ ] **Step 5: Derive translatedText per message and pass to MessageBubble**

Find where `MessageBubble` is rendered (search for `<MessageBubble` in InboxSplitView). Pass translation props:

```jsx
translatedText={
  translationCache[selectedThreadId]?.items?.find((item) => item.id === message.id)
    ?.translatedText || null
}
translationLoading={translationCache[selectedThreadId]?.loading || false}
onRequestTranslation={() => {
  if (!translationCache[selectedThreadId]?.items?.length && !translationCache[selectedThreadId]?.loading) {
    fetchTranslationForThread(selectedThreadId);
  }
}}
```

- [ ] **Step 6: Update TranslationModal to accept pre-fetched data**

In `apps/web/components/inbox/TranslationModal.jsx`, replace the internal fetch with props:

```jsx
export function TranslationModal({ open, onOpenChange, threadId, translationData }) {
  const loading = translationData?.loading || false;
  const data = translationData?.items?.length ? {
    conversation: { items: translationData.items },
    draft: translationData.draft,
    targetLanguage: "en",
  } : null;
  const error = (!loading && translationData && !translationData.items?.length) ? "Could not load translation." : "";

  // ... rest of render using loading/data/error directly, no useEffect/fetch
```

Remove the `useCallback fetchTranslation`, `useEffect`, and all internal state. The modal now only renders — it does not fetch.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/inbox/InboxSplitView.jsx apps/web/components/inbox/TranslationModal.jsx
git commit -m "feat: add translation cache to InboxSplitView, share with modal and message bubbles"
```

---

## Task 7: MessageBubble — Show translation toggle

**Files:**
- Modify: `apps/web/components/inbox/MessageBubble.jsx`

- [ ] **Step 1: Add new props to the component signature**

In `MessageBubble`, find the function signature and add:

```javascript
// Add these to props:
// translatedText?: string | null
// translationLoading?: boolean
// onRequestTranslation?: () => void
// fromMe?: boolean  (already likely present — check)
```

- [ ] **Step 2: Add showTranslation local state**

Inside the component body:

```javascript
const [showTranslation, setShowTranslation] = useState(false);
```

- [ ] **Step 3: Add toggle handler**

```javascript
const handleToggleTranslation = () => {
  if (!showTranslation && !translatedText) {
    onRequestTranslation?.();
  }
  setShowTranslation((prev) => !prev);
};
```

- [ ] **Step 4: Render the toggle button and translated text**

Only show the toggle on customer messages (not `from_me`). Find where the message body text is rendered (the main content area). After the body, add:

```jsx
{!fromMe && (
  <div className="mt-2">
    <button
      type="button"
      onClick={handleToggleTranslation}
      className="inline-flex items-center gap-1 text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
    >
      <Globe className="h-3 w-3" />
      {showTranslation ? "Hide translation" : "Show translation"}
    </button>

    {showTranslation && (
      <div className="mt-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
        {translationLoading ? (
          <div className="flex items-center gap-2 text-[12px] text-gray-400">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-gray-600" />
            Translating…
          </div>
        ) : translatedText ? (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700">
            {translatedText}
          </p>
        ) : (
          <p className="text-[12px] text-gray-400">Translation not available.</p>
        )}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Import Globe icon**

Add to the lucide-react import at the top of `MessageBubble.jsx`:

```javascript
import { ..., Globe } from "lucide-react";
```

- [ ] **Step 6: Verify fromMe prop**

Search for how `MessageBubble` is called in `InboxSplitView.jsx` to confirm the prop name for "sent by agent". It may be `fromMe`, `from_me`, or `isOutbound`. Use the same name in the toggle condition above.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/inbox/MessageBubble.jsx
git commit -m "feat: add Show translation toggle to customer message bubbles"
```

---

## Task 8: Composer — Globe button and replyLanguage

**Files:**
- Modify: `apps/web/components/inbox/Composer.jsx`

- [ ] **Step 1: Add detectedLanguage to Composer props**

In the `Composer` function signature (around line 141), add:

```javascript
detectedLanguage = null,
onReplyLanguageChange = null,
```

- [ ] **Step 2: Add replyLanguage state**

Inside Composer, near the other `useState` calls:

```javascript
const [replyLanguage, setReplyLanguage] = useState(detectedLanguage || "en");
const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
```

Also add a `useEffect` to update state when `detectedLanguage` changes (thread switch):

```javascript
useEffect(() => {
  if (detectedLanguage) setReplyLanguage(detectedLanguage);
}, [detectedLanguage]);
```

- [ ] **Step 3: Import Globe and Popover components**

At the top of `Composer.jsx`:

```javascript
import { Globe } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  SUPPORTED_SUPPORT_LANGUAGE_CODES,
  SUPPORT_LANGUAGE_LABELS,
} from "@/lib/translation/languages";
```

- [ ] **Step 4: Add handleLanguageChange**

```javascript
const handleLanguageChange = (lang) => {
  setLanguagePickerOpen(false);
  if (lang === replyLanguage) return;
  const hasDraftContent = Boolean(String(value || "").trim());
  if (hasDraftContent) {
    const label = SUPPORT_LANGUAGE_LABELS[lang] || lang;
    const confirmed = window.confirm(`Regenerate draft in ${label}?`);
    if (!confirmed) return;
  }
  setReplyLanguage(lang);
  onReplyLanguageChange?.(lang);
  if (hasDraftContent && onGenerateDraft) {
    onGenerateDraft(lang);
  }
};
```

- [ ] **Step 5: Render the Globe button in the toolbar**

Find the toolbar area in the Composer JSX — the row with attachment, lightning, and pen icons (around line 1200+). Add the globe button **before** the "Generate draft" button:

```jsx
{!isNote && (
  <Popover open={languagePickerOpen} onOpenChange={setLanguagePickerOpen}>
    <PopoverTrigger asChild>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors"
      >
        <Globe className="h-3.5 w-3.5" />
        {SUPPORT_LANGUAGE_LABELS[replyLanguage] || replyLanguage}
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-40 p-1">
      {SUPPORTED_SUPPORT_LANGUAGE_CODES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => handleLanguageChange(code)}
          className={`w-full rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-gray-50 transition-colors ${
            code === replyLanguage ? "font-medium text-gray-900" : "text-gray-600"
          }`}
        >
          {SUPPORT_LANGUAGE_LABELS[code]}
        </button>
      ))}
    </PopoverContent>
  </Popover>
)}
```

- [ ] **Step 6: Update onGenerateDraft signature**

In the Composer function signature, `onGenerateDraft` is currently `= null`. Its callers (keyboard shortcut, button click) should pass `replyLanguage`:

```javascript
// Find all calls to onGenerateDraft() in Composer.jsx and change to:
onGenerateDraft?.(replyLanguage)
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/inbox/Composer.jsx
git commit -m "feat: add globe language picker to composer with draft regeneration"
```

---

## Task 9: generate-draft API route — pass reply_language

**Files:**
- Modify: `apps/web/app/api/threads/[threadId]/generate-draft/route.js`

- [ ] **Step 1: Read reply_language from POST body**

In the POST handler, find where `body` is parsed from `request.json()`. Add:

```javascript
const replyLanguage = typeof body?.reply_language === "string"
  ? body.reply_language.trim().toLowerCase().slice(0, 2)
  : null;
```

- [ ] **Step 2: Pass reply_language to generate-draft-unified**

Find the `body: JSON.stringify({...})` call around line 219. Add `reply_language` to it:

```javascript
body: JSON.stringify({
  shop_id: effectiveMailbox.shop_id,
  provider,
  force_process: true,
  ...(replyLanguage ? { reply_language: replyLanguage } : {}),
  email_data: { ... },
}),
```

- [ ] **Step 3: Update handleGenerateDraft in InboxSplitView to forward language**

In `InboxSplitView.jsx`, `handleGenerateDraft` calls `POST /api/threads/${threadId}/generate-draft` with an empty body. Update it to accept an optional `language` parameter and pass it:

```javascript
const handleGenerateDraft = useCallback(async (replyLanguage) => {
  // ...existing guard checks...
  const res = await fetch(`/api/threads/${threadId}/generate-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(replyLanguage ? { reply_language: replyLanguage } : {}),
  });
  // ...rest unchanged...
}, [selectedThreadId, manualDraftGeneratingByThread]);
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/threads/[threadId]/generate-draft/route.js apps/web/components/inbox/InboxSplitView.jsx
git commit -m "feat: pass reply_language through generate-draft API route"
```

---

## Task 10: generate-draft-unified — reply_language override

**Files:**
- Modify: `supabase/functions/generate-draft-unified/index.ts`

- [ ] **Step 1: Read reply_language from request body**

In the `Deno.serve` handler (around line 3879), after `const emailData: EmailData = body?.email_data ?? {};`, add:

```typescript
const replyLanguageOverride: string | null =
  typeof body?.reply_language === "string" &&
  /^[a-z]{2}$/.test(body.reply_language.trim())
    ? body.reply_language.trim().toLowerCase()
    : null;
```

- [ ] **Step 2: Apply override in resolvePreferredReplyLanguage**

Find the call to `resolvePreferredReplyLanguage` (around line 6017):

```typescript
const languageHint = resolvePreferredReplyLanguage({
  replyStrategyLanguage: replyStrategyArtifact?.language || null,
  caseAssessmentLanguage: caseAssessment?.language || null,
  fallbackLanguageHint: inferLanguageHint(emailData.subject || "", emailData.body || ""),
});
```

Change to:

```typescript
const languageHint = replyLanguageOverride || resolvePreferredReplyLanguage({
  replyStrategyLanguage: replyStrategyArtifact?.language || null,
  caseAssessmentLanguage: caseAssessment?.language || null,
  fallbackLanguageHint: inferLanguageHint(emailData.subject || "", emailData.body || ""),
});
```

- [ ] **Step 3: Deploy**

```bash
npx supabase functions deploy generate-draft-unified
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-draft-unified/index.ts
git commit -m "feat: accept reply_language override in generate-draft-unified"
```

---

## Task 11: Manual verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify Show translation toggle**

Open a ticket with a non-English customer message. Confirm:
- "Show translation" button appears under the customer message body
- Clicking it triggers loading state, then shows translated text
- "Hide translation" collapses it
- Opening "More → Translation" modal reuses cached data (no second network call — check Network tab)

- [ ] **Step 3: Verify Globe auto-detect**

Open a ticket where the customer wrote in Danish. Confirm:
- Globe button shows "Danish" by default
- Switching to "English" with an empty draft: language updates silently, no confirm dialog
- Switching with a draft in the box: confirm dialog appears, confirming triggers draft regeneration

- [ ] **Step 4: Verify language in generated draft**

Switch globe to "German", click "Generate draft". Confirm the draft arrives in German.

- [ ] **Step 5: Verify new inbound thread detection**

Send a test email in a non-English language to the inbound address. Wait for postmark-inbound to process it. Check DB:
```sql
select id, subject, customer_language from mail_threads order by created_at desc limit 5;
```
Confirm `customer_language` is populated.

- [ ] **Step 6: Final commit**

```bash
git commit --allow-empty -m "chore: inline translation + globe feature complete"
```
