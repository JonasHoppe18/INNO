import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  applySendReadyStyleCleanup,
  stripDuplicateGreeting,
  stripGenericClosers,
} from "./writer.ts";

// ---------------------------------------------------------------------------
// 1. Duplicate greeting cleanup
// ---------------------------------------------------------------------------

Deno.test("stripDuplicateGreeting removes an inline second English greeting and recapitalizes", () => {
  const out = stripDuplicateGreeting(
    "Hi there,\n\nHi there, your order is on its way.",
  );
  assertEquals(out, "Hi there,\n\nYour order is on its way.");
});

Deno.test("stripDuplicateGreeting removes an inline second Danish greeting (Hej / Hejsa)", () => {
  const out = stripDuplicateGreeting(
    "Hej,\n\nHejsa, det er ærgerligt at høre om problemet.",
  );
  assertEquals(out, "Hej,\n\nDet er ærgerligt at høre om problemet.");
});

Deno.test("stripDuplicateGreeting drops a standalone duplicate greeting line", () => {
  const out = stripDuplicateGreeting(
    "Hi there,\n\nHi there,.\n\nWe can help you with that.",
  );
  assertEquals(out, "Hi there,\n\nWe can help you with that.");
});

Deno.test("stripDuplicateGreeting leaves a single greeting untouched", () => {
  const input = "Hi there,\n\nYour order shipped today.";
  assertEquals(stripDuplicateGreeting(input), input);
});

Deno.test("stripDuplicateGreeting does not strip a non-greeting word that merely starts the body", () => {
  // "Hello world" has no greeting punctuation after the token, so it must stay.
  const input = "Hi there,\n\nHello world is printed on the box you received.";
  assertEquals(stripDuplicateGreeting(input), input);
});

// ---------------------------------------------------------------------------
// 2. Generic closer / filler removal
// ---------------------------------------------------------------------------

Deno.test("stripGenericClosers removes a trailing 'if you have any questions' closer", () => {
  const out = stripGenericClosers(
    "The A-Spire works with PlayStation via USB-C or 3.5mm AUX.\n\nIf you have any questions, feel free to ask.",
  );
  assertEquals(
    out,
    "The A-Spire works with PlayStation via USB-C or 3.5mm AUX.",
  );
});

Deno.test("stripGenericClosers removes a trailing 'I look forward to hearing from you'", () => {
  const out = stripGenericClosers(
    "Your refund will appear within 3-5 business days.\n\nI look forward to hearing from you.",
  );
  assertEquals(out, "Your refund will appear within 3-5 business days.");
});

Deno.test("stripGenericClosers removes a Danish filler closer", () => {
  const out = stripGenericClosers(
    "Vi sender et nyt kabel til dig.\n\nJeg ser frem til at høre fra dig.",
  );
  assertEquals(out, "Vi sender et nyt kabel til dig.");
});

Deno.test("stripGenericClosers removes 'Thank you for your understanding'", () => {
  const out = stripGenericClosers(
    "Once an order is dispatched, we are unable to cancel it.\n\nThank you for your understanding.",
  );
  assertEquals(
    out,
    "Once an order is dispatched, we are unable to cancel it.",
  );
});

// ---------------------------------------------------------------------------
// 3. Cleanup must NOT remove useful factual context or a real next step
// ---------------------------------------------------------------------------

Deno.test("stripGenericClosers preserves a closing sentence that carries a real next step", () => {
  const input =
    "Please try forgetting the headset in Bluetooth settings and pairing again.\n\nIf it still does not connect after that, reply with the headset model and the phone you are using.";
  assertEquals(stripGenericClosers(input), input);
});

Deno.test("stripGenericClosers preserves a trailing clarifying question", () => {
  const input =
    "I can help check this. Can you send the order number or the email address used at checkout?";
  assertEquals(stripGenericClosers(input), input);
});

Deno.test("stripGenericClosers preserves factual content even when it ends the draft", () => {
  const input =
    "Wireless dongle compatibility isn't confirmed for A-Spire, so I recommend using one of those wired connection options instead.";
  assertEquals(stripGenericClosers(input), input);
});

Deno.test("stripGenericClosers removes a full 'if you have any questions or need assistance, feel free to reach out' closer without leaving a dangling clause", () => {
  const out = stripGenericClosers(
    "I recommend keeping an eye on our webshop for updates.\n\nIf you have any further questions or need assistance, feel free to reach out.",
  );
  assertEquals(
    out,
    "I recommend keeping an eye on our webshop for updates.",
  );
  assert(!/[,]\s*$/.test(out), "must not leave a trailing comma fragment");
});

Deno.test("stripGenericClosers removes 'I hope this helps, and I look forward to hearing from you' without leaving a dangling conjunction", () => {
  const out = stripGenericClosers(
    "Please include your order number inside the parcel so we can identify the return.\n\nI hope this helps, and I look forward to hearing from you.",
  );
  assertEquals(
    out,
    "Please include your order number inside the parcel so we can identify the return.",
  );
  assert(!/\band\s*$/i.test(out), "must not leave a trailing 'and'");
});

Deno.test("stripGenericClosers removes a standalone 'I hope this helps clarify the situation' filler", () => {
  const out = stripGenericClosers(
    "You can return the product within our 30-day return window.\n\nI hope this helps clarify the situation.",
  );
  assertEquals(
    out,
    "You can return the product within our 30-day return window.",
  );
});

Deno.test("stripGenericClosers removes a Danish look-forward closer with a 'hvis du har brug for hjælp' tail", () => {
  const out = stripGenericClosers(
    "Med hensyn til opladning er det desværre ikke muligt at bruge headsettet, mens det oplades.\n\nJeg ser frem til at høre fra dig, hvis du har brug for yderligere hjælp.",
  );
  assertEquals(
    out,
    "Med hensyn til opladning er det desværre ikke muligt at bruge headsettet, mens det oplades.",
  );
});

Deno.test("stripGenericClosers removes 'let me know if there's anything else I can assist you with'", () => {
  const out = stripGenericClosers(
    "You can return the product within our 30-day return window.\n\nLet me know if there's anything else I can assist you with.",
  );
  assertEquals(
    out,
    "You can return the product within our 30-day return window.",
  );
});

// ---------------------------------------------------------------------------
// 4. Cleanup must NOT make live-commerce drafts more assertive
// ---------------------------------------------------------------------------

Deno.test("cleanup keeps live-fact hedging intact and never introduces shipped/delivered/refunded claims", () => {
  const input =
    "Hi there,\n\nI can't confirm the live tracking status right now. Could you share your order number so I can look into it?\n\nThanks for your understanding.";
  const out = applySendReadyStyleCleanup(input);
  // The safe hedge and the question must survive.
  assertStringIncludes(out, "can't confirm the live tracking status");
  assertStringIncludes(out, "order number");
  // Only-removal contract: nothing assertive added.
  assert(!/\b(shipped|delivered|refunded|on its way)\b/i.test(out));
  // The pure-pleasantry closer is gone.
  assert(!/thanks for your understanding/i.test(out));
});

// ---------------------------------------------------------------------------
// Combined + idempotence
// ---------------------------------------------------------------------------

Deno.test("applySendReadyStyleCleanup removes both a duplicate greeting and a trailing filler closer", () => {
  const input =
    "Hi there,\n\nHi there, we can take a look at this under warranty. Please send a short video and your order number.\n\nFeel free to reach out if you have any questions.";
  const out = applySendReadyStyleCleanup(input);
  assertEquals(
    out,
    "Hi there,\n\nWe can take a look at this under warranty. Please send a short video and your order number.",
  );
});

Deno.test("applySendReadyStyleCleanup is a no-op on an already send-ready draft", () => {
  const input =
    "Hi there,\n\nThe A-Spire headset works with PlayStation via USB-C or 3.5mm AUX.\n\nWireless dongle compatibility isn't confirmed for A-Spire, so I recommend using one of those wired connection options instead.";
  assertEquals(applySendReadyStyleCleanup(input), input);
});

Deno.test("writer cleanup removes a standalone Danish sign-off added by the model", () => {
  const input =
    "Hej,\n\nVi har desværre ikke stofpuder til dette headset.\n\nBedste hilsner";
  assertEquals(
    applySendReadyStyleCleanup(input),
    "Hej,\n\nVi har desværre ikke stofpuder til dette headset.",
  );
});

Deno.test("writer cleanup removes a compound Danish invitation closer", () => {
  const input =
    "Vi har desværre ikke stofpuder til dette headset.\n\nHvis du har brug for yderligere hjælp eller har andre spørgsmål, er du velkommen til at skrive igen.";
  assertEquals(
    applySendReadyStyleCleanup(input),
    "Vi har desværre ikke stofpuder til dette headset.",
  );
});
