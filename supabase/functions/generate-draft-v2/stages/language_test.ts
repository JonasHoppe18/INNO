import { cleanupMixedLanguageDraft, mixedLanguageCheck } from "./language.ts";

Deno.test("mixedLanguageCheck fails English draft with Danish closing", () => {
  const result = mixedLanguageCheck(
    "Hi Mattias,\n\nWe will start the warranty review.\n\nUndskyld for ulejligheden og tak for din tålmodighed.",
    "en",
  );

  if (result.ok) {
    throw new Error("Expected mixed-language English draft to fail");
  }
  if (!result.detectedForeignLanguages.includes("da")) {
    throw new Error("Expected Danish to be detected as foreign language");
  }
});

Deno.test("mixedLanguageCheck fails Danish draft with English service phrase", () => {
  const result = mixedLanguageCheck(
    "Hej Morten\n\nVi opretter sagen nu.\n\nI look forward to hearing from you.",
    "da",
  );

  if (result.ok) {
    throw new Error("Expected mixed-language Danish draft to fail");
  }
  if (!result.detectedForeignLanguages.includes("en")) {
    throw new Error("Expected English to be detected as foreign language");
  }
});

Deno.test("mixedLanguageCheck passes English draft with Danish-like names and product names", () => {
  const result = mixedLanguageCheck(
    "Hi Søren,\n\nI can see order #2291 for AceZone A-Spire Wireless. Please reply here with a photo of the issue.",
    "en",
  );

  if (!result.ok) {
    throw new Error(
      `Expected product/name text to pass, got ${
        result.foreignSegments.join(", ")
      }`,
    );
  }
});

Deno.test("mixedLanguageCheck passes Danish draft with URL and tracking/brand tokens", () => {
  const result = mixedLanguageCheck(
    "Hej\n\nDin GLS-pakke kan spores her: https://gls-group.eu/DK/da/find-pakke?match=055463208463. AceZone A-Blaze er registreret på ordre #4349.",
    "da",
  );

  if (!result.ok) {
    throw new Error(
      `Expected URL/tracking/product text to pass, got ${
        result.foreignSegments.join(", ")
      }`,
    );
  }
});

Deno.test("cleanupMixedLanguageDraft translates known Danish phrase in English draft", () => {
  const cleaned = cleanupMixedLanguageDraft(
    "Hi Mattias,\n\nWe will review the case.\n\nUndskyld for ulejligheden og tak for din tålmodighed.",
    "en",
  );

  const result = mixedLanguageCheck(cleaned, "en");
  if (!result.ok) {
    throw new Error(`Expected cleaned draft to pass, got ${cleaned}`);
  }
  if (!cleaned.includes("Sorry for the inconvenience")) {
    throw new Error(`Expected English replacement, got ${cleaned}`);
  }
});
