import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const inbox = read("apps/web/components/inbox/InboxSplitView.jsx");
const inboxLive = read("apps/web/app/api/inbox/live/route.js");
const sidebar = read("apps/web/components/app-sidebar.jsx");
const sidebarCounts = read("apps/web/app/api/inbox/sidebar-counts/route.js");
const statusModel = read("apps/web/lib/inbox/status-model.js");
const migration = read(
  "supabase/migrations/20260712161335_workspace_realtime_inbox_rls.sql",
);

test("inbox Realtime subscriptions are workspace scoped", () => {
  assert.match(inboxLive, /workspaceId: scope\.workspaceId \?\? null/);
  assert.match(inbox, /setCurrentWorkspaceId\(payload\?\.workspaceId \|\| null\)/);
  assert.match(inbox, /inbox-thread-updates:\$\{currentWorkspaceId\}/);
  assert.match(inbox, /inbox-message-updates:\$\{currentWorkspaceId\}/);
  assert.equal(
    (inbox.match(/filter: `workspace_id=eq\.\$\{currentWorkspaceId\}`/g) || [])
      .length,
    4,
  );
  assert.doesNotMatch(inbox, /filter: `user_id=eq\.\$\{currentSupabaseUserId\}`/);
});

test("sidebar refreshes counts for remote workspace thread changes", () => {
  assert.match(sidebarCounts, /workspaceId: scope\.workspaceId \?\? null/);
  assert.match(sidebar, /sidebar-thread-updates:\$\{currentWorkspaceId\}/);
  assert.match(sidebar, /window\.dispatchEvent\(new CustomEvent\("sona:thread-read"\)\)/);
});

test("an agent reply moves and marks the shared thread read atomically", () => {
  assert.match(statusModel, /is_read: true/);
  assert.match(statusModel, /unread_count: 0/);
});

test("RLS grants SELECT only to members of the row workspace", () => {
  assert.match(migration, /mail_threads_select_workspace_members/);
  assert.match(migration, /mail_messages_select_workspace_members/);
  assert.equal((migration.match(/for select/g) || []).length, 2);
  assert.equal((migration.match(/to authenticated/g) || []).length, 2);
  assert.equal(
    (migration.match(/membership\.clerk_user_id = \(select auth\.jwt\(\) ->> 'sub'\)/g) || [])
      .length,
    2,
  );
});
