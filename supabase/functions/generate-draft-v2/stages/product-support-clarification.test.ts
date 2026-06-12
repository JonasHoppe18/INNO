import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildClarificationDirective,
  isProductSupportClarificationReason,
  PRODUCT_SUPPORT_LOW_CONFIDENCE_REASON,
} from "./product-support-clarification.ts";

const SHOP_PRODUCT_TERMS = ["acezone", "a-spire", "aspire", "shopify"];
const CANNED_REPLY_FRAGMENTS = [
  // English / Danish example replies must NOT be baked into the directive.
  "could you describe",
  "kan du beskrive",
  "is the issue related to the microphone",
  "er problemet eksempelvis",
];

Deno.test("directive triggers identically for every language (language-agnostic)", () => {
  for (const lang of ["en", "da", "de", "fr", "es", "nl"]) {
    const d = buildClarificationDirective(lang);
    // Embeds the resolved language code so the reply is multilingual via the
    // existing resolver — not via per-language canned text.
    assert(d.includes(`(${lang})`), `missing language code for ${lang}`);
    assert(/clarification question/i.test(d));
    assert(/do not provide troubleshooting steps/i.test(d));
    assert(/factory reset/i.test(d));
    assert(/firmware/i.test(d));
    assert(/pairing/i.test(d));
  }
});

Deno.test("directive structure is the same template for all languages (only the code differs)", () => {
  const en = buildClarificationDirective("en").split("\n");
  const de = buildClarificationDirective("de").split("\n");
  const fr = buildClarificationDirective("fr").split("\n");
  assertEquals(en.length, de.length);
  assertEquals(en.length, fr.length);
  // Every line except the language one is byte-identical across languages.
  en.forEach((line, i) => {
    if (line.includes("(en)")) return;
    assertEquals(de[i], line);
    assertEquals(fr[i], line);
  });
});

Deno.test("directive contains NO canned per-language reply text", () => {
  for (const lang of ["en", "da", "de", "fr"]) {
    const d = buildClarificationDirective(lang).toLowerCase();
    for (const fragment of CANNED_REPLY_FRAGMENTS) {
      assert(!d.includes(fragment), `unexpected canned reply "${fragment}" for ${lang}`);
    }
  }
});

Deno.test("directive output has no AceZone / A-Spire / shop-specific strings", () => {
  for (const lang of ["en", "da", "de", "fr"]) {
    const d = buildClarificationDirective(lang).toLowerCase();
    for (const term of SHOP_PRODUCT_TERMS) {
      assert(!d.includes(term), `directive must not hardcode "${term}" (${lang})`);
    }
  }
});

Deno.test("empty / unknown language falls back to English code", () => {
  assert(buildClarificationDirective("").includes("(en)"));
  assert(buildClarificationDirective(undefined as unknown as string).includes("(en)"));
});

Deno.test("clarification reason predicate is language-agnostic and specific", () => {
  assertEquals(isProductSupportClarificationReason(PRODUCT_SUPPORT_LOW_CONFIDENCE_REASON), true);
  assertEquals(isProductSupportClarificationReason("product_support_low_confidence"), true);
  // A normal section injection (any language) must NOT trigger clarification.
  assertEquals(isProductSupportClarificationReason("product_support_selected"), false);
  assertEquals(isProductSupportClarificationReason("injected"), false);
  assertEquals(isProductSupportClarificationReason(null), false);
  assertEquals(isProductSupportClarificationReason(undefined), false);
});
