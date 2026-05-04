import {
  buildVariantGuidanceBlock,
  detectVariantSignals,
  isVariantConflictingSource,
  resolveSalutationName,
} from "./customer-context.ts";

Deno.test("resolveSalutationName prefers form name over Shopify/order name", () => {
  const message =
    "Country Code:\nSE\nName:\nDoni\nEmail:\nLiridon_bmw@hotmail.com\nBody:\nHi, I bought the Cable Version headset.\n\nKind regards,\nDonixo";

  const result = resolveSalutationName(message, "Liridon Idrizi");

  if (result.name !== "Doni" || result.source !== "customer_form_name") {
    throw new Error(
      `Expected Doni from form name, got ${JSON.stringify(result)}`,
    );
  }
  if (result.conflictingOrderName !== "Liridon Idrizi") {
    throw new Error("Expected conflicting order name to be recorded");
  }
});

Deno.test("resolveSalutationName falls back to signature before order name", () => {
  const message =
    "Hi, can you help me with my headset?\n\nKind regards,\nDonixo";

  const result = resolveSalutationName(message, "Liridon Idrizi");

  if (result.name !== "Donixo" || result.source !== "customer_signature") {
    throw new Error(
      `Expected Donixo from signature, got ${JSON.stringify(result)}`,
    );
  }
});

Deno.test("detectVariantSignals identifies generic wired terms without product hardcode", () => {
  const result = detectVariantSignals(
    "I bought the cable version a few years ago. Is firmware 146 latest?",
  );

  if (!result.families.includes("wired")) {
    throw new Error(`Expected wired signal, got ${JSON.stringify(result)}`);
  }
});

Deno.test("detectVariantSignals identifies generic wireless terms without product hardcode", () => {
  const result = detectVariantSignals(
    "The dongle will not pair over Bluetooth.",
  );

  if (!result.families.includes("wireless")) {
    throw new Error(`Expected wireless signal, got ${JSON.stringify(result)}`);
  }
});

Deno.test("buildVariantGuidanceBlock flags conflicting saved reply as unsafe procedure", () => {
  const block = buildVariantGuidanceBlock(
    "I bought the cable version headset and need firmware help.",
    [{
      source_label: "Saved Reply: Wireless firmware update",
      content:
        "Pair the dongle over Bluetooth and update the wireless headset.",
      kind: "saved_reply",
      usable_as: "saved_reply",
    }],
  );

  if (block.includes("Saved Reply: Wireless firmware update")) {
    throw new Error(`Expected conflicting source name hidden, got ${block}`);
  }
  if (!block.includes("kun bruges som tone/struktur")) {
    throw new Error(`Expected saved reply warning, got ${block}`);
  }
});

Deno.test("isVariantConflictingSource detects conflicting saved reply without product metadata", () => {
  const conflict = isVariantConflictingSource(
    "I bought the cable version headset and need firmware help.",
    {
      source_label: "Saved Reply: Wireless firmware update",
      content:
        "Pair the dongle over Bluetooth and update the wireless headset.",
      kind: "saved_reply",
      usable_as: "saved_reply",
    },
  );

  if (!conflict) {
    throw new Error(
      "Expected saved reply to conflict with wired customer signal",
    );
  }
});
