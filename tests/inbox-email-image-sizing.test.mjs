import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findSignatureZoneStart,
  sanitizeEmailHtml,
} from "../apps/web/lib/inbox/email-html.js";

const imgTags = (html) => String(html).match(/<img\b[^>]*>/gi) || [];
const styleOf = (tag) => String(tag).match(/\sstyle="([^"]*)"/i)?.[1] || "";

// --- Signature-zone detection --------------------------------------------

test("Danish sign-off opens the signature zone", () => {
  const html = '<p>Hej Jonas</p><p>Med venlig hilsen</p><img src="https://a.dk/logo.png">';
  const start = findSignatureZoneStart(html);
  assert.ok(Number.isFinite(start));
  assert.ok(start < html.indexOf("<img"), "zone must start before the logo");
  assert.ok(start > html.indexOf("Hej Jonas"), "zone must start after the body text");
});

test("English sign-offs and the RFC 3676 delimiter open the zone", () => {
  for (const marker of ["Kind regards", "Best regards", "Many thanks", "Sincerely"]) {
    assert.ok(
      Number.isFinite(findSignatureZoneStart(`<p>Body</p><p>${marker}</p>`)),
      `${marker} should be detected`
    );
  }
  assert.ok(Number.isFinite(findSignatureZoneStart("<p>Body</p><br>-- <br><p>Tom</p>")));
});

test("a forwarded Outlook header opens the zone", () => {
  const html =
    "<p>Body</p><b>From:</b> Joachim &lt;j@acezone.io&gt;<br><b>Sent:</b> 08 July 2026 11:24";
  const start = findSignatureZoneStart(html);
  assert.ok(Number.isFinite(start));
  assert.ok(start > html.indexOf("Body"));
});

test("a message with no sign-off and no quote has no signature zone", () => {
  assert.equal(
    findSignatureZoneStart("<p>Hvornår er A-Blaze på lager igen?</p>"),
    Infinity
  );
});

// --- Tier 2: signature-zone logos -----------------------------------------

test("AceZone signature logo is pinned to 44px and marked", () => {
  const html = [
    "<p>Vi vender tilbage i næste uge.</p>",
    "<p>Med venlig hilsen/Kind regards</p>",
    '<img src="https://acezone.io/az-logo.png">',
    "<p>Joachim Buchwald<br>Marketing Manager</p>",
  ].join("");

  const [logo] = imgTags(sanitizeEmailHtml(html));
  assert.match(logo, /data-signature-image="true"/);
  assert.match(styleOf(logo), /max-height:44px/);
  assert.match(styleOf(logo), /width:auto/);
});

test("a signature logo with a declared width still renders at the uniform size", () => {
  // Sender width is dropped on purpose: width + max-height together would
  // stretch the image, and uniformity is the point of this tier.
  const html = '<p>Kind regards</p><img src="https://x.dk/logo.png" width="320">';
  const [logo] = imgTags(sanitizeEmailHtml(html));
  assert.match(styleOf(logo), /max-height:44px/);
  assert.doesNotMatch(styleOf(logo), /(^|;|\s)width:320px/);
});

test("every logo in a multi-signature forward chain is capped", () => {
  // The noima thread: their signature, then a forwarded AceZone reply.
  const html = [
    "<p>Please confirm the quantity.</p>",
    "<p>Many thanks</p><p>Tom</p>",
    '<img src="https://noima.co.uk/noima.png">',
    "<p><b>From:</b> Joachim Buchwald<br><b>Sent:</b> 08 July 2026 11:24</p>",
    "<p>Hi Tom,</p><p>We'll return to you next week.</p>",
    "<p>Med venlig hilsen</p>",
    '<img src="https://acezone.io/az-logo.png">',
  ].join("");

  const tags = imgTags(sanitizeEmailHtml(html));
  assert.equal(tags.length, 2);
  for (const tag of tags) {
    assert.match(styleOf(tag), /max-height:44px/, `not capped: ${tag}`);
  }
});

// --- Tier 1: content images ------------------------------------------------

test("a customer photo above the sign-off is not treated as a signature", () => {
  const html = [
    "<p>Mit headset er knækket, se billede:</p>",
    '<img src="https://cdn.dk/broken-headset.jpg">',
    "<p>Med venlig hilsen</p><p>Søren</p>",
  ].join("");

  const [photo] = imgTags(sanitizeEmailHtml(html));
  assert.doesNotMatch(photo, /data-signature-image/);
  assert.doesNotMatch(styleOf(photo), /max-height:44px/);
});

test("a content image with no declared width carries no inline sizing", () => {
  // It falls through to the EMAIL_BODY_CLASS cap, where width:auto keeps ratio.
  const [photo] = imgTags(sanitizeEmailHtml('<p>Se her:</p><img src="https://cdn.dk/p.jpg">'));
  assert.equal(styleOf(photo), "");
});

test("a content image keeps the sender's declared width", () => {
  const [photo] = imgTags(
    sanitizeEmailHtml('<p>Se her:</p><img src="https://cdn.dk/p.jpg" width="420">')
  );
  assert.match(styleOf(photo), /width:420px/);
  assert.match(styleOf(photo), /height:auto/);
});

// --- Invariants ------------------------------------------------------------

test("REGRESSION: image sizing survives the inline-style stripping pass", () => {
  // The earlier width-preservation fix computed a correct style and then had
  // it stripped by the generic style pass, making it a no-op in the thread
  // view (preserveInlineStyles: false) while still working in the modal.
  const html = '<p>Kind regards</p><img src="https://x.dk/logo.png" width="150">';

  const thread = imgTags(sanitizeEmailHtml(html, [], { preserveInlineStyles: false }));
  assert.notEqual(styleOf(thread[0]), "", "thread view lost the sizing style");

  const modal = imgTags(sanitizeEmailHtml(html, [], { preserveInlineStyles: true }));
  assert.notEqual(styleOf(modal[0]), "", "modal lost the sizing style");
});

test("no image ever pairs an explicit width with a max-height", () => {
  // That combination clamps height while width stays fixed, which stretches
  // the image. Every tier must avoid it.
  const fixtures = [
    '<img src="https://x.dk/a.png">',
    '<img src="https://x.dk/a.png" width="150">',
    '<p>Kind regards</p><img src="https://x.dk/a.png">',
    '<p>Kind regards</p><img src="https://x.dk/a.png" width="150">',
    '<p>Med venlig hilsen</p><img src="https://x.dk/a.png" width="1200">',
  ];

  for (const fixture of fixtures) {
    for (const preserveInlineStyles of [false, true]) {
      for (const tag of imgTags(sanitizeEmailHtml(fixture, [], { preserveInlineStyles }))) {
        const style = styleOf(tag);
        const hasExplicitWidth = /(^|;|\s)width:\s*\d/i.test(style);
        const hasHeightCap = /max-height:\s*\d/i.test(style);
        assert.ok(
          !(hasExplicitWidth && hasHeightCap),
          `distorting style "${style}" for ${fixture}`
        );
      }
    }
  }
});

test("a sender cannot forge an image placeholder", () => {
  const html = '<p>@@SONA_IMG_0@@ Kind regards</p><img src="https://x.dk/logo.png">';
  const out = sanitizeEmailHtml(html);
  assert.equal(imgTags(out).length, 1, "forged placeholder produced an extra image");
  assert.doesNotMatch(out, /@@SONA_IMG_/);
});

// --- Pre-existing behaviour still holds ------------------------------------

test("unsafe image sources are dropped", () => {
  assert.equal(imgTags(sanitizeEmailHtml('<img src="javascript:alert(1)">')).length, 0);
  assert.equal(imgTags(sanitizeEmailHtml("<img>")).length, 0);
});

test("scripts and styles are still stripped and links still resolve", () => {
  const out = sanitizeEmailHtml(
    '<script>alert(1)</script><style>p{color:red}</style><p>Se https://acezone.io her</p>'
  );
  assert.doesNotMatch(out, /<script|<style/i);
  assert.match(out, /<a href="https:\/\/acezone\.io"/);
});

test("cid: references resolve against attachments and unresolved ones are removed", () => {
  const attachments = [{ id: "att-1", content_id: "logo@acezone", mime_type: "image/png" }];

  const resolved = sanitizeEmailHtml('<img src="cid:logo@acezone">', attachments);
  assert.match(resolved, /\/api\/attachments\/att-1\/download/);

  assert.equal(imgTags(sanitizeEmailHtml('<img src="cid:missing@x">', attachments)).length, 0);
});
