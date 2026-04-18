# Inline Translation + Composer Globe

**Date:** 2026-04-19
**Status:** Approved

## Overview

Two related features that make language handling first-class in the inbox:

1. **Per-message "Show translation" toggle** — inline translation directly on customer messages, no modal required.
2. **Globe icon in composer** — auto-detects the customer's language, lets agents change the reply language, triggers draft regeneration.

---

## Architecture

### DB Migration

```sql
ALTER TABLE mail_threads ADD COLUMN IF NOT EXISTS customer_language text;
```

Stores ISO-639-1 code (`"da"`, `"en"`, `"de"`, etc.) or `null` for unknown. Scoped per thread.

### Language Detection

**New threads (postmark-inbound):**
After parsing the first inbound customer message, a GPT-4o-mini detect call identifies the customer's language and writes it to `mail_threads.customer_language`. Only customer messages are considered (`from_me = false`, not internal notes).

**Existing threads (lazy backfill):**
The existing `/api/inbox/threads/[threadId]/translation` endpoint already returns `originalLanguage` per message. On the first translation request, if `customer_language` is null, the API patches the thread with the detected value from the conversation items.

### Translation Cache (InboxSplitView)

```
translationCache: Record<threadId, {
  loading: boolean,
  items: Array<{ id: string, translatedText: string, originalLanguage: string }>,
  draft: { translatedText: string } | null,
}>
```

- Shared between the per-message toggle and the existing "More → Translation" modal.
- First toggle or modal open fetches from the existing endpoint and populates the cache.
- Subsequent interactions in the same thread use the cache — no duplicate API calls.

---

## Feature 1: Per-message Translation Toggle

### Where it appears
Only on customer messages (`from_me === false`), not internal notes or outbound support messages.

### UX
```
[original message text]

Show translation ↕
---
[translated text, shown inline below]
```

- "Show translation" toggles to "Hide translation" when expanded.
- Translated text appears as a subtle secondary block below the original.
- Loading state: small spinner / skeleton while first fetch completes.

### MessageBubble changes
Two new props:
- `translatedText?: string` — the translated text from cache, passed down from InboxSplitView
- `translationLoading?: boolean` — true while the thread's translation is being fetched

MessageBubble manages its own `showTranslation: boolean` state (toggle).

### InboxSplitView changes
- Holds `translationCache` state.
- Exposes `onRequestTranslation(threadId)` handler: fetches endpoint if not cached, sets loading flag, stores result.
- Passes `translatedText` and `translationLoading` to each MessageBubble based on `message.id` match in cache.

### Existing modal
"More → Translation" is kept unchanged. It also reads from the same cache, so opening it after a per-message toggle costs no additional API call.

---

## Feature 2: Globe in Composer

### Placement
New button in the composer toolbar, after the existing pen/lightning/attachment icons:

```
[📎] [⚡] [✏️]  ...  [⊕ Danish ∨]   [Generate draft]   [Reply to customer ∨] [→]
```

### Auto-detection
- `InboxSplitView` reads `thread.customer_language` from loaded thread data.
- Passes it to `Composer` as `detectedLanguage` prop.
- Composer uses it as the initial `replyLanguage` state.
- Fallback: workspace `support_language` → `"en"`.

### Language dropdown
Clicking the globe button opens a small popover listing the 7 supported languages from `languages.js`:
`en, da, de, es, fr, sv, no`

The current language is highlighted. Selecting a different language triggers the change flow below.

### Language change flow

| Composer state | Behaviour |
|---|---|
| Draft is empty | Update `replyLanguage` state silently |
| Draft has content | Show confirm: *"Regenerate draft in [Language]?"* → confirm → call `onGenerateDraft` with new language |

The confirm dialog is skipped if the agent clicks the same language that is already selected.

### Draft generation changes
`onGenerateDraft` receives an optional `replyLanguage` parameter.
`generate-draft-unified` accepts a `reply_language` field in the request body that overrides the workspace `support_language` in the LLM prompt.

---

## Data Flow Summary

```
postmark-inbound
  → detect customer language
  → write mail_threads.customer_language

InboxSplitView
  → load thread (customer_language already present)
  → pass detectedLanguage → Composer
  → hold translationCache
  → on first toggle/modal open: fetch /translation, populate cache
  → pass translatedText + translationLoading → MessageBubble[]

Composer
  → replyLanguage state (default: detectedLanguage)
  → Globe button → language popover
  → on change: confirm if draft exists → onGenerateDraft(language)

MessageBubble
  → showTranslation toggle state
  → renders translated text when toggled on
```

---

## Out of Scope

- Auto-translating new incoming messages in real time (push/realtime).
- Translating agent-written draft text back to a third language.
- Language detection for Gmail/Outlook polling paths (postmark-inbound only for now).
- Changing the language of the existing "More → Translation" modal target language from within the modal itself.
