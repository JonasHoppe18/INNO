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
