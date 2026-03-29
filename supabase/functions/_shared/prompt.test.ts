import { assertEquals, assertMatch } from "jsr:@std/assert@1";

import { buildMailPrompt } from "./prompt.ts";

Deno.test("prompt renders case_state and thread history blocks when provided", () => {
  const prompt = buildMailPrompt({
    emailBody: "Where is my order?",
    orderSummary: "Order #1001",
    caseStateText: "CASE STATE (DETERMINISTIC):\n- Workflow: tracking",
    threadHistoryText:
      "RECENT THREAD HISTORY (COMPACT, oldest -> newest):\n- [CUSTOMER] Where is my package?",
  });

  assertMatch(prompt, /CASE STATE \(DETERMINISTIC\):/);
  assertMatch(prompt, /RECENT THREAD HISTORY \(COMPACT, oldest -> newest\):/);
  assertMatch(
    prompt,
    /Use CASE STATE as the primary source of truth for verified facts and execution status\./,
  );
  assertMatch(
    prompt,
    /Use RECENT THREAD HISTORY to avoid repeating already answered points\./,
  );
});

Deno.test("prompt includes return guard rule when in return intent mode", () => {
  const prompt = buildMailPrompt({
    emailBody: "I want an RMA return",
    orderSummary: "No order selected",
    policyIntent: "RETURN",
    returnDetailsMissing: ["order_number"],
  });

  assertMatch(
    prompt,
    /If order_number is unknown, do not provide final return address\/instructions yet\. Ask for order_number first in this thread\./,
  );
});

Deno.test("prompt does not render case_state or thread history sections when omitted", () => {
  const prompt = buildMailPrompt({
    emailBody: "Please help",
    orderSummary: "No order",
  });

  assertEquals(prompt.includes("CASE STATE (DETERMINISTIC):"), false);
  assertEquals(prompt.includes("RECENT THREAD HISTORY (COMPACT"), false);
});
