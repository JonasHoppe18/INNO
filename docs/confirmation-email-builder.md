# Confirmation email editor

Settings → Email → Customer confirmation → Customize email design opens
`/settings/confirmation/email`. A mailbox selection carries through to the editor
and back to Settings. Without a mailbox, the design applies to the workspace
default. A mailbox can publish its own design while keeping other mailboxes'
templates intact.

The editor reuses the CSAT canvas, autosave, preview and toolbar from
`components/email/EmailTemplateBuilder.jsx`. Customers can change the message,
add a logo and other supported blocks, and adjust the email's colors and spacing.
The starting design preserves the current plain text message. Existing raw HTML
layouts are not imported into the canvas; they remain active until Publish.

## Drafts and publication

`confirmation_email_drafts` stores JSON separately from the settings used for
delivery. Save and autosave change only the draft. Publish compiles the design
and atomically updates `mail_auto_reply_templates` and `mail_auto_reply_settings`
through `publish_confirmation_email`. Enablement, ticket-reference preferences
and existing cooldowns remain unchanged. Publication checks the draft revision
and rejects a concurrent change. Shared templates are copied before an individual
scope changes them.

API access requires a verified Clerk workspace. Mailbox IDs must belong to that
workspace. The draft table and publication function are service-role only.

## Delivery contract

One mandatory Confirmation message block holds plain text and supported customer,
team and conversation variables. The compiler converts these to the existing
underscore tokens and places one `{{content}}` slot in an MJML layout. Publication
clears the rich HTML body template. The existing sender inserts escaped plain text
and the optional ticket reference into this slot.

Variables belong in the message or subject. Layout blocks and preview text remain
static. Arbitrary HTML, scripts, unsupported variables and duplicate or missing
message blocks are rejected. CSAT routes retain their own mandatory rating block.
No Edge Function or V2 pipeline change is required.

## Conversation marker

An outgoing message appears as a collapsed "Confirmation email sent" row only
when its provider message ID matches a sent `mail_auto_reply_events` record in
the same workspace, mailbox and thread. Enabling confirmations alone does not
create a sent marker. Drafts and ordinary replies retain their normal bubbles.
Click or Enter expands the existing message renderer, including its View email
control. If event metadata cannot be read, the normal message remains visible.
Historical confirmations with no matching event stay as ordinary bubbles.

Sent CSAT surveys use a matching workspace/thread record in
`csat_survey_requests` with a non-null `sent_at` and status `sent` or `responded`.
They appear as a quiet "CSAT email sent" line with the sending time in
Europe/Copenhagen. Pending, sending, failed and skipped requests do not appear.
The notice follows the last message before the survey was sent. It is display
metadata on a real message, so it cannot become a customer reply target or
change message counts. The send flow does not store the mail body; the notice
therefore does not offer a fabricated email preview.

## Verification on 5 October 2026

The migration was applied to dev `zxaoycxzdjrbnzvbullk`. A rolled-back SQL fixture
verified publication, preservation of disabled/ticket-reference/cooldown values,
stale-draft rejection and foreign-workspace rejection. Production was untouched.

Local browser checks used a production build with dev services. Editing and
reloading used the real draft API. Preview substituted synthetic customer values
and rendered at desktop and 375px widths. The shared CSAT editor loaded. The
conversation check used synthetic messages in an authorized detail response and
verified keyboard expansion and collapse; event matching has separate unit tests.
No confirmation emails were sent during verification.

Local evidence is in `/tmp/sona-confirmation-1005a/`. Screenshots contain inbox
context and must not be uploaded publicly. Build and lint passed. The full suite
reported 788 passed, 8 skipped and 3 pre-existing failures: two landing pricing
assertions and a knowledge evaluation lacking environment variables.

The CSAT extension passed 44 targeted tests and browser checks for the sent
notice alongside the existing confirmation control. A read-only check matched
five real sent CSAT requests in dev to the notices returned by the authorized
thread detail API. No survey was dispatched during these checks. CSAT evidence
is in `csat-api-results.json`, `csat-ui-results.json` and `tests-csat.txt` in the
same local evidence directory.
