import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../apps/web/next.config.mjs";

import {
  buildHeicPreviewFilename,
  isHeicAttachment,
} from "../apps/web/lib/server/heic-preview.js";

test("HEIC attachments are detected by MIME type or filename", () => {
  assert.equal(isHeicAttachment({ mimeType: "image/heic" }), true);
  assert.equal(isHeicAttachment({ mimeType: "image/heif-sequence" }), true);
  assert.equal(isHeicAttachment({ filename: "customer-photo.HEIC" }), true);
  assert.equal(
    isHeicAttachment({
      filename: "customer-photo.jpg",
      mimeType: "image/jpeg",
    }),
    false,
  );
});

test("HEIC preview filenames use a browser-compatible extension", () => {
  assert.equal(
    buildHeicPreviewFilename("customer-photo.heic"),
    "customer-photo.jpg",
  );
  assert.equal(
    buildHeicPreviewFilename("customer-photo.HEIF"),
    "customer-photo.jpg",
  );
});

test("HEIC conversion stays external to the Next server bundle", () => {
  assert.deepEqual(
    nextConfig.experimental?.serverComponentsExternalPackages,
    ["heic-convert"],
  );
});
