import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const createRoute = read("../apps/web/app/api/threads/new/route.js");
const sendRoute = read("../apps/web/app/api/threads/[threadId]/send/route.js");
const composer = read("../apps/web/lib/inbox/useComposerState.js");
const selection = read("../apps/web/lib/inbox/useThreadSelection.js");
const inboxData = read("../apps/web/lib/server/inbox-data.js");
const inbox = read("../apps/web/components/inbox/InboxSplitView.jsx");
const inboxPage = read("../apps/web/app/(dashboard)/inbox/page.jsx");

test("a local New Ticket creates and receives a real mail_threads row", () => {
  assert.match(createRoute, /\.from\("mail_threads"\)\s*\.insert\(/);
  assert.match(createRoute, /\.select\([\s\S]*?\bid, user_id, workspace_id, mailbox_id/);
  assert.match(createRoute, /return NextResponse\.json\(\{ thread \}, \{ status: 201 \}\)/);
  assert.match(composer, /fetch\("\/api\/threads\/new"/);
  assert.match(composer, /threadIdForSend = String\(createdThread\?\.id/);
  assert.match(inbox, /subject: ""/);
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

test("new tickets require and send the entered subject", () => {
  const subjectGuardIndex = composer.indexOf(
    'toast.error("Add a subject before sending.")',
  );
  const createSubjectIndex = composer.indexOf("subject: newTicketSubject");
  assert.ok(subjectGuardIndex >= 0, "client subject validation is present");
  assert.ok(createSubjectIndex > subjectGuardIndex, "entered subject is sent to creation");
  assert.match(createRoute, /const subject = String\(body\?\.subject \|\| ""\)\.trim\(\)/);
  assert.match(createRoute, /\{ error: "Subject is required\." \}/);
  assert.match(sendRoute, /Subject is required for a new ticket/);
  assert.match(sendRoute, /const subject = isNewTicket\s*\?\s*subjectRaw/);
  assert.doesNotMatch(composer, /subject: "New ticket"/);
});

test("one connected mailbox is auto-selected and disconnected mailboxes are hidden", () => {
  assert.match(inbox, /const connectedMailboxes = useMemo\(/);
  assert.match(inbox, /status \|\| ""\)\.trim\(\)\.toLowerCase\(\) !== "disconnected"/);
  assert.match(inbox, /connectedMailboxes\.length === 1/);
  assert.match(inbox, /String\(connectedMailboxes\[0\]\?\.id \|\| ""\)/);
  assert.match(inbox, /mailboxes=\{connectedMailboxes\}/);
  assert.match(inboxData, /select\("id, provider, provider_email, status"\)/);
  assert.match(inboxPage, /const connectedMailboxes = mailboxes\.filter\(/);
  assert.match(inboxPage, /if \(!connectedMailboxes\.length\)/);
  assert.match(inboxPage, /mailboxes=\{connectedMailboxes\}/);
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
  assert.match(sendRoute, /const subject = isNewTicket\s*\?\s*subjectRaw/);
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
