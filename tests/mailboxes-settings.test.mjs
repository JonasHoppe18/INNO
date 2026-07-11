import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("mailbox settings distinguish a failed lookup from an empty mailbox list", () => {
  const route = read("../apps/web/app/api/mail-accounts/route.js");
  const settings = read("../apps/web/components/settings/MailboxesSettingsTab.jsx");
  const page = read("../apps/web/app/(dashboard)/mailboxes/page.jsx");

  assert.match(route, /Could not load connected mailboxes\./);
  assert.match(route, /\{ status: 500 \}/);
  assert.doesNotMatch(route, /id, shop_name, team_name, shop_domain/);
  assert.doesNotMatch(page, /id, shop_name, team_name, shop_domain/);
  assert.match(settings, /const \[error, setError\] = useState\(""\)/);
  assert.match(settings, /role="alert"/);
  assert.match(page, /mailboxLoadError/);
});

test("the shops team-name schema required by mailbox identity queries is migrated", () => {
  const migration = read("../supabase/migrations/20260710082000_add_team_name_to_shops.sql");

  assert.match(migration, /alter table public\.shops/i);
  assert.match(migration, /add column if not exists team_name text/i);
});

test("custom domains expose DNS records and verify each required record", () => {
  const panel = read("../apps/web/components/mailboxes/SendingIdentityPanel.jsx");
  const mailboxRoute = read("../apps/web/app/api/mail-accounts/route.js");
  const statusRoute = read("../apps/web/app/api/mail-accounts/[id]/domain/status/route.js");

  assert.match(panel, /DNS records for/);
  assert.match(panel, /Verify DNS/);
  assert.match(panel, /Continue to DNS records/);
  assert.doesNotMatch(panel, /<Dialog/);
  assert.match(panel, /verificationFlags\.dkim_verified/);
  assert.match(panel, /verificationFlags\.return_path_verified/);
  assert.match(statusRoute, /dkim_verified: Boolean\(domainResponse\?\.DKIMVerified\)/);
  assert.match(statusRoute, /return_path_verified: Boolean\(domainResponse\?\.ReturnPathDomainVerified\)/);
  assert.match(mailboxRoute, /domainSourcesByScope/);
  assert.match(mailboxRoute, /domainMailboxId: domainSource\.id \|\| account\.id/);
  assert.match(mailboxRoute, /domainInherited: domainSource\.id !== account\.id/);
});
