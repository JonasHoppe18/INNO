import { test } from "node:test";
import assert from "node:assert/strict";

import {
  composeEmailBodyWithSignature,
  sanitizeEmailTemplateHtml,
  stripTrailingComposedFooter,
} from "../apps/web/lib/server/email-signature.js";
import {
  buildPublicEmailSignatureImageUrl,
  uploadEmailSignatureImage,
  validateEmailSignatureImage,
} from "../apps/web/lib/server/email-signature-assets.js";

test("stripTrailingComposedFooter removes the rendered closing and template footer", () => {
  const config = {
    closingText: "Best Regards,",
    templateHtml: "<p>AceZone Support Team</p>",
    templateTextFallback: "AceZone Support Team",
    isActive: true,
  };
  const composed = composeEmailBodyWithSignature({
    bodyText: "Hi there,\n\nThanks for the update.",
    bodyHtml: "",
    config,
  });

  assert.equal(
    stripTrailingComposedFooter(composed.finalBodyText, config),
    "Hi there,\n\nThanks for the update."
  );
});

test("stripTrailingComposedFooter leaves a draft unchanged when the configured footer is absent", () => {
  const config = {
    closingText: "Best Regards,",
    templateTextFallback: "AceZone Support Team",
  };

  assert.equal(
    stripTrailingComposedFooter("Hi there,\n\nThanks for the update.", config),
    "Hi there,\n\nThanks for the update."
  );
});

test("uploaded PNG and JPEG signature images become public HTTPS URLs", async () => {
  const uploaded = [];
  const serviceClient = {
    storage: {
      from(bucket) {
        return {
          async upload(path, bytes, options) {
            uploaded.push({ bucket, path, bytes, options });
            return { error: null };
          },
        };
      },
    },
  };

  const png = await uploadEmailSignatureImage(serviceClient, {
    supabaseUrl: "https://project.supabase.co",
    workspaceId: "workspace-1",
    userId: "member-1",
    file: {
      type: "image/png",
      async arrayBuffer() {
        return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
      },
    },
  });
  const jpeg = await uploadEmailSignatureImage(serviceClient, {
    supabaseUrl: "https://project.supabase.co",
    workspaceId: "workspace-1",
    userId: "member-1",
    file: {
      type: "image/jpeg",
      async arrayBuffer() {
        return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]).buffer;
      },
    },
  });

  assert.match(png.url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/workspace-email-signature-assets\/workspace-1\/member-1\/[0-9a-f-]+\.png$/);
  assert.match(jpeg.url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/workspace-email-signature-assets\/workspace-1\/member-1\/[0-9a-f-]+\.jpg$/);
  assert.equal(uploaded.length, 2);
  assert.equal(uploaded[0].bucket, "workspace-email-signature-assets");
  assert.equal(uploaded[0].options.upsert, false);
  assert.notEqual(uploaded[0].path, uploaded[1].path);
  assert.equal(
    buildPublicEmailSignatureImageUrl(
      "https://project.supabase.co",
      uploaded[0].path,
    ),
    png.url,
  );
});

test("signature HTML no longer accepts data, relative, or signed image sources", () => {
  const publicImageUrl =
    "https://project.supabase.co/storage/v1/object/public/workspace-email-signature-assets/workspace-1/member-1/logo.png";
  const sanitized = sanitizeEmailTemplateHtml(
    [
      `<img src="data:image/png;base64,AAAA">`,
      `<img src="/storage/v1/object/sign/private/logo.png?token=secret">`,
      `<img src="${publicImageUrl}" alt="Logo">`,
    ].join(""),
    { publicImageBaseUrl: "https://project.supabase.co/storage/v1/object/public/workspace-email-signature-assets" },
  );

  assert.doesNotMatch(sanitized, /data:image/i);
  assert.doesNotMatch(sanitized, /object\/sign|token=secret/i);
  assert.match(sanitized, new RegExp(publicImageUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("composed outbound signature HTML contains the public HTTPS image URL", () => {
  const publicImageUrl =
    "https://project.supabase.co/storage/v1/object/public/workspace-email-signature-assets/workspace-1/member-1/logo.jpg";
  const composed = composeEmailBodyWithSignature({
    bodyText: "Hello",
    config: {
      closingText: "Best Regards,",
      templateHtml: `<p>Support</p><img src="${publicImageUrl}" alt="Logo">`,
      templateTextFallback: "Support",
      isActive: true,
    },
  });

  assert.match(composed.finalBodyHtml, new RegExp(publicImageUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(composed.finalBodyHtml, /data:image/i);
});

test("signature image validation accepts PNG and JPEG but rejects unsupported content", () => {
  assert.equal(
    validateEmailSignatureImage({
      contentType: "image/png",
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    }).extension,
    "png",
  );
  assert.equal(
    validateEmailSignatureImage({
      contentType: "image/jpeg",
      bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
    }).extension,
    "jpg",
  );
  assert.throws(
    () => validateEmailSignatureImage({ contentType: "image/gif", bytes: Uint8Array.from([0x47, 0x49, 0x46]) }),
    /Only PNG and JPEG/,
  );
});
