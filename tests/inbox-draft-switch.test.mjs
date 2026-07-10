import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("all inbox ticket detail loads opt out of mutable draft caching", () => {
  const detailRoute = read("../apps/web/app/api/inbox/threads/[threadId]/detail/route.js");
  const draftRoute = read("../apps/web/app/api/threads/[threadId]/draft/route.js");
  const inboxData = read("../apps/web/hooks/useInboxData.js");
  const selection = read("../apps/web/lib/inbox/useThreadSelection.js");
  const actions = read("../apps/web/lib/inbox/useThreadActions.js");

  assert.match(detailRoute, /Cache-Control": "private, no-store/);
  assert.match(draftRoute, /Cache-Control": "private, no-store/);
  assert.match(inboxData, /fetch\(`\/api\/inbox\/threads\/\$\{threadId\}\/detail`, \{[\s\S]*?cache: "no-store"/);
  assert.match(selection, /fetch\(`\/api\/inbox\/threads\/\$\{encodeURIComponent\(threadId\)\}\/detail`, \{[\s\S]*?cache: "no-store"/);
  assert.match(actions, /fetch\(`\/api\/threads\/\$\{threadId\}\/draft`, \{[\s\S]*?cache: "no-store"/);
});

test("workspace tabs route selection through the draft-safe ticket switch handler", () => {
  const inbox = read("../apps/web/components/inbox/InboxSplitView.jsx");

  assert.match(
    inbox,
    /onSelectTab=\{\(threadId\) =>\s*handleSelectThreadInWorkspace\(threadId, \{ newTab: false \}\)/,
  );
  assert.doesNotMatch(inbox, /onSelectTab=\{setSelectedThreadId\}/);
});

test("ticket navigation shares the composer refs and cannot delete an empty transient value", () => {
  const composer = read("../apps/web/lib/inbox/useComposerState.js");
  const inbox = read("../apps/web/components/inbox/InboxSplitView.jsx");

  assert.match(composer, /draftValueRef,\s*\n\s*draftLastSavedRef,/);
  assert.doesNotMatch(composer, /const draftValueRef = useRef\(""\)/);
  assert.doesNotMatch(composer, /const draftLastSavedRef = useRef\(\{\}\)/);
  assert.match(
    composer,
    /useLayoutEffect\(\(\) => \{\s*draftValueRef\.current = draftValue;/,
  );
  assert.match(composer, /allowDelete = false/);
  assert.match(composer, /const draftClearRequestedByThreadRef = useRef\(new Set\(\)\)/);
  assert.match(
    composer,
    /allowDelete && draftClearRequestedByThreadRef\.current\.has\(threadId\)/,
  );
  assert.match(
    inbox,
    /void saveThreadDraft\(\{\s*immediate: true,\s*threadIdOverride: previousThreadId,/,
  );
  assert.match(inbox, /onDraftBlur=\{[\s\S]*?allowDelete: true,/);
});

test("the server confirms and exposes the canonical AI draft before success", () => {
  const pipeline = read("../supabase/functions/generate-draft-v2/pipeline.ts");
  const draftRoute = read("../apps/web/app/api/threads/[threadId]/draft/route.js");
  const detailRoute = read("../apps/web/app/api/inbox/threads/[threadId]/detail/route.js");

  assert.match(
    pipeline,
    /const \{ error: aiDraftPersistError \} = await supabase\s*\.from\("mail_messages"\)\s*\.update\(\{ ai_draft_text: finalDraft, updated_at: nowIso \}\)/,
  );
  assert.match(pipeline, /failed to persist ai_draft_text/);
  assert.doesNotMatch(
    pipeline,
    /ai_draft_text: finalDraft, updated_at: nowIso \}\)\s*\.eq\([^\n]+\)\s*\.then\(/,
  );
  assert.match(draftRoute, /async function loadLatestAiDraft/);
  assert.match(draftRoute, /savedDraft \|\|[\s\S]*?loadLatestAiDraft/);
  assert.match(detailRoute, /async function loadLatestAiDraft/);
  assert.match(detailRoute, /savedDraft \|\|[\s\S]*?loadLatestAiDraft/);
});
