import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildFewShotBlock, stripHistoricalStyleArtifacts } from "./writer.ts";

type Example = Parameters<typeof buildFewShotBlock>[0][number];

function makeExample(overrides: Partial<Example> = {}): Example {
  return {
    id: 1,
    customer_msg: "My mic clip broke, can I get a replacement?",
    agent_reply: "Sure, we can send you a replacement mic clip.",
    subject: null,
    score: 0.9,
    similarity: 0.95,
    is_near_duplicate: false,
    csat_score: null,
    conversation_context: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Near-duplicate example present
// ---------------------------------------------------------------------------

Deno.test("buildFewShotBlock never turns a near-duplicate historical reply into factual authority", () => {
  const out = buildFewShotBlock(
    [makeExample({ is_near_duplicate: true })],
    { isReturnRefund: false },
  );
  assertEquals(out.includes("Near-duplicate — SAME product"), false);
  assertEquals(out.includes("MAY reuse its factual resolution"), false);
  assertStringIncludes(out, "NEVER factual authority");
});

// ---------------------------------------------------------------------------
// 2. Only non-near-duplicate examples
// ---------------------------------------------------------------------------

Deno.test("buildFewShotBlock omits the EXCEPTION paragraph when no example is a near-duplicate", () => {
  const out = buildFewShotBlock(
    [makeExample({ is_near_duplicate: false })],
    { isReturnRefund: false },
  );
  assertEquals(out.includes("MAY reuse its factual resolution"), false);
  assertStringIncludes(out, "STYLE references only");
});

// ---------------------------------------------------------------------------
// 3. Empty examples array
// ---------------------------------------------------------------------------

Deno.test("buildFewShotBlock returns an empty string for an empty examples array", () => {
  const out = buildFewShotBlock([], { isReturnRefund: false });
  assertEquals(out, "");
});

Deno.test("historical style examples omit synthetic greetings, signatures and agent placeholders", () => {
  const historical =
    "Hi there, Thanks for the details. I can confirm the next step now. Kind regards / Med venlig hilsen, [Agent] Support Associate Acezone.io";
  const body = stripHistoricalStyleArtifacts(historical);
  assertEquals(
    body,
    "Thanks for the details. I can confirm the next step now.",
  );

  const out = buildFewShotBlock(
    [makeExample({ agent_reply: historical })],
    { isReturnRefund: false },
  );
  assertStringIncludes(out, "STYLE, TONE and STRUCTURE");
  assertEquals(out.includes("Hi there"), false);
  assertEquals(out.includes("Kind regards"), false);
  assertEquals(out.includes("[Agent]"), false);
  assertEquals(out.includes("how to resolve the case"), false);
});
