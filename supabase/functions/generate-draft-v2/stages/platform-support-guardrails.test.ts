// deno test --no-check supabase/functions/generate-draft-v2/stages/platform-support-guardrails.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildPlatformSupportGuardrailsBlock,
  PLATFORM_SUPPORT_GUARDRAILS_BLOCK,
} from "./platform-support-guardrails.ts";

const UNIVERSAL_RULES = [
  "Never invent policy facts, addresses, prices, timelines or operational steps",
  "Never promise a refund, exchange, replacement or prepaid return label",
  "For a general policy question, answer directly without asking for an order number",
  "use the documented default return address",
  "Do not claim that a regional address does not exist",
  "acknowledge delivery and explain that inspection or processing is the next step",
  "Do not say that the parcel is still awaiting receipt",
  "Do not offer a price adjustment or claim that price adjustments are impossible",
  "Do not reopen a question the customer has already answered",
  "Do not expose internal labels, enum names, workflow stages or internal reasoning",
  "ask one focused clarification question or use a safe neutral formulation",
];

Deno.test("block contains every universal rule", () => {
  const block = buildPlatformSupportGuardrailsBlock();
  for (const rule of UNIVERSAL_RULES) {
    assert(block.includes(rule), `missing rule: ${rule}`);
  }
});

Deno.test("block is headed as an always-apply platform mandate", () => {
  assert(
    buildPlatformSupportGuardrailsBlock().startsWith(
      "# PLATFORM SUPPORT GUARDRAILS — ALWAYS APPLY",
    ),
  );
});

Deno.test("block contains no shop-specific terms", () => {
  const block = buildPlatformSupportGuardrailsBlock().toLowerCase();
  for (
    const forbidden of [
      "acezone",
      "alpi",
      "a-spire",
      "a-blaze",
      "webshipper",
      "shopify",
      "return for swap",
    ]
  ) {
    assert(!block.includes(forbidden), `shop-specific term leaked: ${forbidden}`);
  }
});

Deno.test("block contains no shop id or UUID", () => {
  assert(
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
      buildPlatformSupportGuardrailsBlock(),
    ),
  );
});

Deno.test("renderer is deterministic and pure", () => {
  assertEquals(
    buildPlatformSupportGuardrailsBlock(),
    buildPlatformSupportGuardrailsBlock(),
  );
  assertEquals(
    buildPlatformSupportGuardrailsBlock(),
    PLATFORM_SUPPORT_GUARDRAILS_BLOCK,
  );
});

Deno.test("writer inserts the block exactly once, covering all retry paths", async () => {
  // Primary draft, both language-correction retries and the strong-model
  // escalation all call runWriter, which assembles userContent in one place.
  // Assert the source wires the renderer exactly once into that assembly.
  const writerSource = await Deno.readTextFile(
    new URL("./writer.ts", import.meta.url),
  );
  const calls = writerSource.match(/buildPlatformSupportGuardrailsBlock\(\)/g) ?? [];
  assertEquals(calls.length, 1, "expected exactly one insertion in writer.ts");
  assert(
    writerSource.includes(
      'import { buildPlatformSupportGuardrailsBlock } from "./platform-support-guardrails.ts"',
    ),
  );
  // The block must not be duplicated as an inline string literal anywhere.
  const inline = writerSource.match(/PLATFORM SUPPORT GUARDRAILS/g) ?? [];
  assertEquals(inline.length, 0, "block text must not be inlined in writer.ts");
});

Deno.test("module performs no DB reads and no LLM calls", async () => {
  const source = await Deno.readTextFile(
    new URL("./platform-support-guardrails.ts", import.meta.url),
  );
  for (const forbidden of ["createClient", "fetch(", "OPENAI_API", "Deno.env", "import {", "await "]) {
    assert(
      !source.toLowerCase().includes(forbidden.toLowerCase()),
      `forbidden reference in pure module: ${forbidden}`,
    );
  }
});
