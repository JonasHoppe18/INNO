import { test } from "node:test";
import assert from "node:assert/strict";

import {
  composeEmailBodyWithSignature,
  inferGermanLanguage,
  selectSignatureText,
  stripTrailingComposedFooter,
} from "../apps/web/lib/server/email-signature.js";

test("selects the configured signature variant and falls back to the default", () => {
  const signatures = {
    da: "Mvh\nJonas",
    en: "Best regards\nJonas",
    de: "Viele Grüße\nJonas",
  };

  assert.equal(selectSignatureText({ defaultSignature: "Mvh\nJonas", languageSignatures: signatures, language: "en" }), "Best regards\nJonas");
  assert.equal(selectSignatureText({ defaultSignature: "Mvh\nJonas", languageSignatures: signatures, language: "da-DK" }), "Mvh\nJonas");
  assert.equal(selectSignatureText({ defaultSignature: "Mvh\nJonas", languageSignatures: signatures, language: "de" }), "Viele Grüße\nJonas");
  assert.equal(selectSignatureText({ defaultSignature: "Mvh\nJonas", languageSignatures: signatures, language: "fr" }), "Mvh\nJonas");
  assert.equal(selectSignatureText({ defaultSignature: "", languageSignatures: {}, language: "en" }), "");
  assert.equal(inferGermanLanguage("Ich möchte meine Bestellung zurückgeben, bitte."), true);
});

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

test("keeps one configured signature when the generated answer already has a named sign-off", () => {
  const composed = composeEmailBodyWithSignature({
    bodyText: "I can help with that.\n\nBest regards,\nJonas",
    config: { closingText: "Mvh\nJonas" },
  });

  assert.equal(composed.finalBodyText, "I can help with that.\n\nMvh\nJonas");
  assert.equal(composed.finalBodyText.match(/Jonas/g)?.length, 1);
});

test("keeps a language-specific plain signature compatible with the visual footer", () => {
  const composed = composeEmailBodyWithSignature({
    bodyText: "Your order has shipped.",
    config: {
      closingText: selectSignatureText({
        defaultSignature: "Mvh\nJonas",
        languageSignatures: { en: "Best regards\nJonas" },
        language: "en",
      }),
      templateHtml: "<p>AceZone Support Team</p>",
      templateTextFallback: "AceZone Support Team",
      isActive: true,
    },
  });

  assert.match(composed.finalBodyText, /Your order has shipped\.[\s\S]*Best regards\nJonas[\s\S]*AceZone Support Team/);
  assert.match(composed.finalBodyHtml, /Best regards<br\/>Jonas/);
  assert.match(composed.finalBodyHtml, /AceZone Support Team/);
});
