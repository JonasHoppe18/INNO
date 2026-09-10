import { test } from "node:test";
import assert from "node:assert/strict";

import {
  composeEmailBodyWithSignature,
  sanitizeEmailTemplateHtml,
  stripTrailingComposedFooter,
} from "../apps/web/lib/server/email-signature.js";
import {
  EMAIL_SIGNATURE_IMAGE_BUCKET,
  buildPublicEmailSignatureImageUrl,
  uploadEmailSignatureImage,
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
  const uploads = [];
  const serviceClient = {
    storage: {
      from(bucket) {
        assert.equal(bucket, EMAIL_SIGNATURE_IMAGE_BUCKET);
        return {
          async upload(path, bytes, options) {
            uploads.push({ path, bytes, options });
            return { error: null };
          },
        };
      },
    },
  };
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";
  const fixtures = [
    {
      type: "image/png",
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      extension: "png",
    },
    {
      type: "image/jpeg",
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      extension: "jpg",
    },
  ];

  for (const fixture of fixtures) {
    const image = await uploadEmailSignatureImage(serviceClient, {
      supabaseUrl: "https://project.supabase.co",
      workspaceId,
      userId,
      file: {
        type: fixture.type,
        async arrayBuffer() {
          return fixture.bytes;
        },
      },
    });

    assert.match(image.url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\//);
    assert.match(image.url, new RegExp(`${workspaceId}/${userId}/[0-9a-f-]+\\.${fixture.extension}$`));
    assert.equal(image.contentType, fixture.type);
  }

  assert.equal(uploads.length, fixtures.length);
  for (const upload of uploads) {
    assert.equal(upload.options.upsert, false);
    assert.equal(upload.options.cacheControl, "31536000");
    assert.doesNotMatch(upload.path, /token|signed/i);
  }
});

test("new signature templates reject data image sources", () => {
  const publicBaseUrl = "https://project.supabase.co/storage/v1/object/public/workspace-email-signature-assets";
  const template = [
    '<p>Support</p>',
    '<img src="data:image/png;base64,iVBORw0KGgo=" alt="Logo">',
    '<img src="https://project.supabase.co/storage/v1/object/sign/private/logo.png?token=expired" alt="Private logo">',
  ].join("");

  const sanitized = sanitizeEmailTemplateHtml(template, { publicImageBaseUrl: publicBaseUrl });
  assert.doesNotMatch(sanitized, /data:image\//i);
  assert.doesNotMatch(sanitized, /object\/sign|token=/i);
  assert.match(sanitized, /<p>Support<\/p>/);
});

test("composed outbound signature HTML contains the uploaded public HTTPS image URL", () => {
  const imageUrl = buildPublicEmailSignatureImageUrl(
    "https://project.supabase.co",
    "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/logo.png"
  );
  const composed = composeEmailBodyWithSignature({
    bodyText: "Hi there",
    config: {
      closingText: "Best",
      templateHtml: `<p>Support</p><img src="${imageUrl}" alt="Logo">`,
    },
  });

  assert.match(composed.finalBodyHtml, new RegExp(`<img src="${imageUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.doesNotMatch(composed.finalBodyHtml, /data:image\//i);
});
