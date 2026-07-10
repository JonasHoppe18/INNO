import { test } from "node:test";
import assert from "node:assert/strict";

import {
  composeEmailBodyWithSignature,
  stripTrailingComposedFooter,
} from "../apps/web/lib/server/email-signature.js";

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
