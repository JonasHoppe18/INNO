import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const createRoute = read("../apps/web/app/api/threads/new/route.js");
const sendRoute = read("../apps/web/app/api/threads/[threadId]/send/route.js");
const composerState = read("../apps/web/lib/inbox/useComposerState.js");
const composerUi = read("../apps/web/components/inbox/Composer.jsx");
const ticketDetail = read("../apps/web/components/inbox/TicketDetail.jsx");
const selection = read("../apps/web/lib/inbox/useThreadSelection.js");
const inboxData = read("../apps/web/lib/server/inbox-data.js");
const inbox = read("../apps/web/components/inbox/InboxSplitView.jsx");
const inboxPage = read("../apps/web/app/(dashboard)/inbox/page.jsx");

test("a local New Ticket creates and receives a real mail_threads row", () => {
  assert.match(createRoute, /\.from\("mail_threads"\)\s*\.insert\(/);
  assert.match(createRoute, /\.select\([\s\S]*?\bid, user_id, workspace_id, mailbox_id/);
  assert.match(createRoute, /return NextResponse\.json\(\{ thread \}, \{ status: 201 \}\)/);
  assert.match(composerState, /fetch\("\/api\/threads\/new"/);
  assert.match(composerState, /threadIdForSend = String\(createdThread\?\.id/);
  assert.match(inbox, /subject: ""/);
});

test("New Ticket creation scopes the selected mailbox and preserves tenant ownership", () => {
  assert.match(createRoute, /resolveAuthScope\(serviceClient, \{ clerkUserId, orgId \}\)/);
  assert.match(createRoute, /\.eq\("id", mailboxId\)/);
  assert.match(createRoute, /mailboxQuery = applyScope\(mailboxQuery, scope\)/);
  assert.match(createRoute, /mailbox_id: mailbox\.id/);
  assert.match(createRoute, /user_id: mailbox\.user_id/);
  assert.match(createRoute, /workspace_id: mailbox\.workspace_id \|\| scope\.workspaceId/);
  assert.match(composerState, /newTicketMailboxId/);
});

test("new tickets require and send the entered subject", () => {
  const subjectGuardIndex = composerState.indexOf('toast.error("Add a subject before sending.")');
  const createSubjectIndex = composerState.indexOf("subject: newTicketSubject");
  assert.ok(subjectGuardIndex >= 0);
  assert.ok(createSubjectIndex > subjectGuardIndex);
  assert.match(createRoute, /const subject = String\(body\?\.subject \|\| ""\)\.trim\(\)/);
  assert.match(createRoute, /\{ error: "Subject is required\." \}/);
  assert.match(sendRoute, /Subject is required for a new ticket/);
  assert.match(sendRoute, /const subject = isNewTicket\s*\?\s*subjectRaw/);
  assert.doesNotMatch(composerState, /subject: "New ticket"/);
});

test("the current composer provides an editable Subject and mailbox From controls", () => {
  assert.match(composerUi, /isNewTicket = false/);
  assert.match(composerUi, /id="new-ticket-subject"/);
  assert.match(composerUi, /onNewTicketSubjectChange/);
  assert.match(composerUi, /aria-label="Send from mailbox"/);
  assert.match(composerUi, /mailboxes\.map/);
  assert.match(ticketDetail, /isNewTicket = false/);
  assert.match(ticketDetail, /isNewTicket=\{isNewTicket\}/);
  assert.match(ticketDetail, /newTicketSubject=\{newTicketSubject\}/);
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
  assert.ok(validationIndex >= 0);
  assert.ok(insertIndex > validationIndex);
  assert.match(createRoute, /const EMAIL_PATTERN = \/\^\[/);
  assert.match(sendRoute, /const isNewTicket = body\?\.new_ticket === true/);
  assert.match(sendRoute, /At least one recipient is required for a new ticket/);
});

test("a created New Ticket hands off to the existing send endpoint without Re", () => {
  assert.match(composerState, /onLocalThreadCreated\?\.\(\{/);
  assert.match(selection, /const replaceThreadId = useCallback/);
  assert.match(composerState, /fetch\(.*threadIdForSend.*\/send/);
  assert.match(composerState, /new_ticket: isNewTicket/);
  assert.match(sendRoute, /const subject = isNewTicket\s*\?\s*subjectRaw/);
});

test("creation or send failures leave the local draft intact", () => {
  const creationIndex = composerState.indexOf('fetch("/api/threads/new"');
  const draftHandoffIndex = composerState.indexOf("[threadIdForSend]: composeBody");
  const sendIndex = composerState.indexOf("/send`", draftHandoffIndex);
  const clearIndex = composerState.indexOf('[threadIdForSend]: ""');
  const catchIndex = composerState.lastIndexOf("} catch (err) {");
  assert.ok(creationIndex >= 0);
  assert.ok(draftHandoffIndex > creationIndex);
  assert.ok(sendIndex > draftHandoffIndex);
  assert.ok(clearIndex > sendIndex);
  assert.ok(catchIndex > sendIndex);
  assert.match(composerState, /toast\.error\(err\?\.message \|\| "Could not send draft\."/);
});
