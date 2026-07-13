import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildFewShotBlock } from "./writer.ts";

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

Deno.test("buildFewShotBlock labels a near-duplicate example and appends the EXCEPTION paragraph", () => {
  const out = buildFewShotBlock(
    [makeExample({ is_near_duplicate: true })],
    { isReturnRefund: false },
  );
  assertStringIncludes(out, "Near-duplicate — SAME product");
  assertStringIncludes(out, "EXCEPTION — near-duplicate");
  assertStringIncludes(out, "MAY reuse its factual resolution");
});

// ---------------------------------------------------------------------------
// 2. Only non-near-duplicate examples
// ---------------------------------------------------------------------------

Deno.test("buildFewShotBlock omits the EXCEPTION paragraph when no example is a near-duplicate", () => {
  const out = buildFewShotBlock(
    [makeExample({ is_near_duplicate: false })],
    { isReturnRefund: false },
  );
  assertEquals(out.includes("EXCEPTION — near-duplicate"), false);
  assertStringIncludes(out, "STYLE references only");
});

// ---------------------------------------------------------------------------
// 3. Empty examples array
// ---------------------------------------------------------------------------

Deno.test("buildFewShotBlock returns an empty string for an empty examples array", () => {
  const out = buildFewShotBlock([], { isReturnRefund: false });
  assertEquals(out, "");
});
