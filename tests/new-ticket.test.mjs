import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const createRoute = read("../apps/web/app/api/threads/new/route.js");
const sendRoute = read("../apps/web/app/api/threads/[threadId]/send/route.js");
const composer = read("../apps/web/lib/inbox/useComposerState.js");
const selection = read("../apps/web/lib/inbox/useThreadSelection.js");

test("a local New Ticket creates and receives a real mail_threads row", () => {
  assert.match(createRoute, /\.from\("mail_threads"\)\s*\.insert\(/);
  assert.match(createRoute, /\.select\([\s\S]*?\bid, user_id, workspace_id, mailbox_id/);
  assert.match(createRoute, /return NextResponse\.json\(\{ thread \}, \{ status: 201 \}\)/);
  assert.match(composer, /fetch\("\/api\/threads\/new"/);
  assert.match(composer, /threadIdForSend = String\(createdThread\?\.id/);
});

test("New Ticket creation scopes the selected mailbox and preserves tenant ownership", () => {
  assert.match(createRoute, /resolveAuthScope\(serviceClient, \{ clerkUserId, orgId \}\)/);
  assert.match(createRoute, /\.eq\("id", mailboxId\)/);
  assert.match(createRoute, /mailboxQuery = applyScope\(mailboxQuery, scope\)/);
  assert.match(createRoute, /mailbox_id: mailbox\.id/);
  assert.match(createRoute, /user_id: mailbox\.user_id/);
  assert.match(createRoute, /workspace_id: mailbox\.workspace_id \|\| scope\.workspaceId/);
  assert.match(composer, /newTicketMailboxId/);
});

test("invalid New Ticket recipients are rejected before thread insertion or sending", () => {
  const validationIndex = createRoute.indexOf("const invalidRecipient =");
  const insertIndex = createRoute.indexOf('.from("mail_threads")');
  assert.ok(validationIndex >= 0, "new-ticket recipient validation is present");
  assert.ok(insertIndex > validationIndex, "validation precedes insertion");
  assert.match(createRoute, /EMAIL_PATTERN = \/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$\//);
  assert.match(sendRoute, /const isNewTicket = body\?\.new_ticket === true/);
  assert.match(sendRoute, /At least one recipient is required for a new ticket/);
});

test("a created New Ticket hands off to the existing send endpoint with a non-Re subject", () => {
  assert.match(composer, /onLocalThreadCreated\?\.\(\{/);
  assert.match(selection, /const replaceThreadId = useCallback/);
  assert.match(composer, /fetch\(.*threadIdForSend.*\/send/);
  assert.match(composer, /new_ticket: isNewTicket/);
  assert.match(sendRoute, /const subject = isNewTicket\s*\?\s*subjectRaw \|\| "New ticket"/);
});

test("creation or send failures leave the local draft intact", () => {
  const creationIndex = composer.indexOf('fetch("/api/threads/new"');
  const draftHandoffIndex = composer.indexOf("[threadIdForSend]: composeBody");
  const sendIndex = composer.indexOf("/send" + String.fromCharCode(96) + ",");
  const clearIndex = composer.indexOf("[threadIdForSend]: \"\"");
  const catchIndex = composer.lastIndexOf("} catch (err) {");

  assert.ok(creationIndex >= 0);
  assert.ok(draftHandoffIndex > creationIndex);
  assert.ok(sendIndex > draftHandoffIndex);
  assert.ok(clearIndex > sendIndex, "draft clearing is after successful send");
  assert.ok(catchIndex > sendIndex, "send failures are handled after handoff");
  assert.match(composer, /toast\.error\(err\?\.message \|\| "Could not send draft\."/);
});
