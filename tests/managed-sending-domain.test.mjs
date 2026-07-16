import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { toGoDaddyRecordName } from "../apps/web/lib/server/godaddy-dns.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Postmark hosts are converted to records inside the sona-ai.dk zone", () => {
  assert.equal(
    toGoDaddyRecordName(
      "20260710pm._domainkey.acezone.sona-ai.dk",
      "sona-ai.dk",
    ),
    "20260710pm._domainkey.acezone",
  );
  assert.equal(
    toGoDaddyRecordName("pm-bounces.acezone.sona-ai.dk", "sona-ai.dk"),
    "pm-bounces.acezone",
  );
});

test("managed domain provisioning creates Postmark and GoDaddy records idempotently", () => {
  const provisioner = read("../apps/web/lib/server/managed-sending-domain.js");
  const godaddy = read("../apps/web/lib/server/godaddy-dns.js");

  assert.match(provisioner, /findPostmarkDomainByName\(domain\)/);
  assert.match(provisioner, /createPostmarkDomain/);
  assert.match(provisioner, /pm-bounces\.\$\{domain\}/);
  assert.match(provisioner, /upsertGoDaddyDnsRecord/);
  assert.match(provisioner, /managed_sender/);
  assert.match(provisioner, /current\.from_email !== desiredFromEmail/);
  assert.match(provisioner, /from_email: desiredFromEmail/);
  assert.match(godaddy, /method: "PUT"/);
  assert.match(godaddy, /Authorization: `sso-key/);
});

test("forwarded mailbox creation and sending both ensure managed provisioning", () => {
  const forwarding = read("../apps/web/app/api/mail-accounts/forwarding/route.js");
  const send = read("../apps/web/app/api/threads/[threadId]/send/route.js");
  const mailboxes = read("../apps/web/app/api/mail-accounts/route.js");

  assert.match(forwarding, /ensureManagedSendingDomain/);
  assert.match(send, /ensureManagedSendingDomain/);
  assert.ok(
    send.lastIndexOf("ensureManagedSendingDomain") <
      send.indexOf("const senderConfig = resolvePostmarkSender"),
  );
  assert.match(mailboxes, /buildEffectiveSharedFromEmail/);
});

test("mailbox settings expose and refresh managed sender verification", () => {
  const mailboxesApi = read("../apps/web/app/api/mail-accounts/route.js");
  const statusApi = read(
    "../apps/web/app/api/mail-accounts/[id]/managed-domain/status/route.js",
  );
  const mailboxRow = read("../apps/web/components/mailboxes/MailboxRow.jsx");
  const settingsTab = read(
    "../apps/web/components/settings/MailboxesSettingsTab.jsx",
  );

  assert.match(mailboxesApi, /managedSenderStatus/);
  assert.match(mailboxesApi, /managedSenderDkimVerified/);
  assert.match(mailboxesApi, /managedSenderReturnPathVerified/);
  assert.match(statusApi, /ensureManagedSendingDomain/);
  assert.match(statusApi, /refreshPending: true/);
  assert.match(mailboxRow, /Verified/);
  assert.match(mailboxRow, /Verifying/);
  assert.match(mailboxRow, /Fallback active/);
  assert.match(mailboxRow, /Check status/);
  assert.match(settingsTab, /pendingManagedSenders/);
  assert.match(settingsTab, /managed-domain\/status/);
});
