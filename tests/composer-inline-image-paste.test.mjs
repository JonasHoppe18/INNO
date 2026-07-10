import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractClipboardHtmlImages,
  isLikelyClipboardContentImage,
  isZendeskImageUrl,
  replaceClipboardHtmlImagesWithMarkers,
} from "../apps/web/lib/inbox/clipboard-inline-images.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Zendesk clipboard HTML keeps inline image order and dimensions", () => {
  const html =
    '<p>Before</p><img src="https://support.example.zendesk.com/attachments/token/a?name=guide.png&amp;x=1" width="640" height="360"><p>After</p>';
  const images = extractClipboardHtmlImages(html);

  assert.deepEqual(images, [
    {
      index: 0,
      src: "https://support.example.zendesk.com/attachments/token/a?name=guide.png&x=1",
      width: 640,
      height: 360,
    },
  ]);
  assert.equal(isZendeskImageUrl(images[0].src), true);
  assert.equal(isLikelyClipboardContentImage(images[0]), true);
  assert.match(
    replaceClipboardHtmlImagesWithMarkers(html, ["[cid:paste-1|w:640|h:360]"]),
    /Before[\s\S]*\[cid:paste-1\|w:640\|h:360\][\s\S]*After/,
  );
});

test("tracking pixels are not imported as pasted content", () => {
  assert.equal(
    isLikelyClipboardContentImage({
      src: "https://support.example.zendesk.com/tracking-pixel.gif",
      width: 1,
      height: 1,
    }),
    false,
  );
});

test("the composer imports Zendesk images and inserts a visible inline preview", () => {
  const composer = read("../apps/web/components/inbox/Composer.jsx");
  const proxyRoute = read("../apps/web/app/api/attachments/fetch-inline/route.js");
  const sendRoute = read("../apps/web/app/api/threads/[threadId]/send/route.js");

  assert.match(composer, /\/api\/attachments\/fetch-inline/);
  assert.match(composer, /execCommand\("insertHTML"/);
  assert.match(proxyRoute, /await auth\(\)/);
  assert.match(proxyRoute, /zendesk\.com/);
  assert.match(sendRoute, /ContentID:/);
  assert.match(sendRoute, /is_inline:/);
});
