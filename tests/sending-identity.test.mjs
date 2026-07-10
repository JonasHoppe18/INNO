import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEffectiveSharedFromEmail,
  buildSharedSonaFromEmail,
  getVerifiedManagedSenderEmail,
  slugifyDomainLabel,
} from "../apps/web/lib/server/sending-identity.js";

const originalPostmarkFromEmail = process.env.POSTMARK_FROM_EMAIL;
const originalSharedLocalPart = process.env.SONA_SHARED_FROM_LOCAL_PART;
const originalSharedDomain = process.env.SONA_SHARED_SENDING_DOMAIN;

afterEach(() => {
  if (originalPostmarkFromEmail === undefined) delete process.env.POSTMARK_FROM_EMAIL;
  else process.env.POSTMARK_FROM_EMAIL = originalPostmarkFromEmail;
  if (originalSharedLocalPart === undefined) delete process.env.SONA_SHARED_FROM_LOCAL_PART;
  else process.env.SONA_SHARED_FROM_LOCAL_PART = originalSharedLocalPart;
  if (originalSharedDomain === undefined) delete process.env.SONA_SHARED_SENDING_DOMAIN;
  else process.env.SONA_SHARED_SENDING_DOMAIN = originalSharedDomain;
});

test("slugifyDomainLabel creates DNS-safe labels from Danish names", () => {
  assert.equal(slugifyDomainLabel("Økologisk Århus Æske"), "oekologisk-aarhus-aeske");
});

test("buildSharedSonaFromEmail uses the configured verified Postmark sender", () => {
  process.env.POSTMARK_FROM_EMAIL = "Support@Sona-AI.dk";
  assert.equal(
    buildSharedSonaFromEmail({
      shop: { shop_name: "Nordic Living" },
      mailbox: { provider_email: "support@example.com" },
    }),
    "support@sona-ai.dk"
  );
});

test("buildSharedSonaFromEmail falls back to the verified root domain, not a per-shop subdomain", () => {
  delete process.env.POSTMARK_FROM_EMAIL;
  delete process.env.SONA_SHARED_FROM_LOCAL_PART;
  delete process.env.SONA_SHARED_SENDING_DOMAIN;
  assert.equal(
    buildSharedSonaFromEmail({
      shop: { shop_domain: "demo-shop.myshopify.com" },
      mailbox: { provider_email: "support@example.com" },
    }),
    "support@sona-ai.dk"
  );
});

test("verified managed senders replace the root fallback", () => {
  const mailbox = {
    metadata: {
      managed_sender: {
        domain: "acezone.sona-ai.dk",
        from_email: "kundeservice@acezone.sona-ai.dk",
        status: "verified",
      },
    },
  };

  assert.equal(
    getVerifiedManagedSenderEmail(mailbox),
    "kundeservice@acezone.sona-ai.dk",
  );
  assert.equal(
    buildEffectiveSharedFromEmail({ mailbox }),
    "kundeservice@acezone.sona-ai.dk",
  );
});

test("pending managed senders keep the verified root fallback", () => {
  process.env.POSTMARK_FROM_EMAIL = "support@sona-ai.dk";
  const mailbox = {
    metadata: {
      managed_sender: {
        domain: "acezone.sona-ai.dk",
        from_email: "kundeservice@acezone.sona-ai.dk",
        status: "pending",
      },
    },
  };

  assert.equal(getVerifiedManagedSenderEmail(mailbox), null);
  assert.equal(buildEffectiveSharedFromEmail({ mailbox }), "support@sona-ai.dk");
});
