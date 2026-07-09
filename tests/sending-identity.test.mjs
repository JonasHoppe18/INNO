import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSharedSonaFromEmail,
  slugifyDomainLabel,
} from "../apps/web/lib/server/sending-identity.js";

test("slugifyDomainLabel creates DNS-safe labels from Danish names", () => {
  assert.equal(slugifyDomainLabel("Økologisk Århus Æske"), "oekologisk-aarhus-aeske");
});

test("buildSharedSonaFromEmail uses shop name for shared fallback sender", () => {
  assert.equal(
    buildSharedSonaFromEmail({
      shop: { shop_name: "Nordic Living" },
      mailbox: { provider_email: "support@example.com" },
    }),
    "kundeservice@nordic-living.sona-ai.dk"
  );
});

test("buildSharedSonaFromEmail falls back to shop domain handle", () => {
  assert.equal(
    buildSharedSonaFromEmail({
      shop: { shop_domain: "demo-shop.myshopify.com" },
      mailbox: { provider_email: "support@example.com" },
    }),
    "kundeservice@demo-shop.sona-ai.dk"
  );
});
