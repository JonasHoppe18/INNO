// READINESS-3: clarify_symptom stage directive.
//
// runWriter builds its system prompt inline and calls a live LLM, so (like
// writer-prompt-shape.test.ts) these tests assert on the prompt SOURCE text
// rather than on generated draft output — there is no live model call here.
import { assert, assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./writer.ts", import.meta.url));

// The directive is a JS string literal containing escaped quotes (\"...\"),
// so it can't be pulled out with a single non-greedy regex — scan char by
// char honoring backslash escapes to find the literal's real closing quote.
function extractStringLiteralAfter(marker: string): string {
  const startOfMarker = src.indexOf(marker);
  if (startOfMarker === -1) {
    throw new Error(`marker not found: ${marker}`);
  }
  const openQuote = src.indexOf('"', startOfMarker + marker.length);
  let i = openQuote + 1;
  let out = "";
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      out += ch + src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i += 1;
  }
  return out;
}

function clarifySymptomDirective(): string {
  return extractStringLiteralAfter("clarify_symptom:");
}

Deno.test("writer has a clarify_symptom stage directive", () => {
  const directive = clarifySymptomDirective();
  assert(directive.length > 20, "stageDirectives is missing a clarify_symptom entry");
});

Deno.test("clarify_symptom directive asks exactly one question and forbids troubleshooting/guessing", () => {
  const directive = clarifySymptomDirective().toLowerCase();

  assert(
    directive.includes("præcis ét kort") || directive.includes("præcis et kort"),
    "directive must require exactly one short question",
  );
  assert(
    directive.includes("ingen troubleshooting") ||
      directive.includes("giv ingen troubleshooting"),
    "directive must forbid troubleshooting steps",
  );
  assert(
    directive.includes("gæt aldrig"),
    "directive must forbid guessing the product/symptom/cause",
  );
  assert(
    directive.includes("nævn ikke garanti, retur eller refund") ||
      directive.includes("garanti") && directive.includes("retur"),
    "directive must forbid mentioning warranty/return unless the customer asked",
  );
});

Deno.test("clarify_symptom directive is ecommerce-generic, not audio/headset-specific", () => {
  const directive = clarifySymptomDirective().toLowerCase();

  for (const term of ["mikrofon", "dongle", "bluetooth", "headset", "øreprop", "anc"]) {
    assert(
      !directive.includes(term),
      `clarify_symptom directive should stay vertical-agnostic but contains "${term}"`,
    );
  }
});

Deno.test("clarify_symptom is not a procedure stage (stays in concise reply mode)", () => {
  const match = src.match(/PROCEDURE_STAGES = new Set\(\[([\s\S]*?)\]\)/);
  assert(match, "PROCEDURE_STAGES set not found");
  assert(
    !match[1].includes("clarify_symptom"),
    "clarify_symptom must not be in PROCEDURE_STAGES — it should render as a single short question, not a multi-step procedure reply",
  );
});

Deno.test("resolutionStage fallback stays info_only (clarify_symptom is never a silent default)", () => {
  assert(
    src.includes('const resolutionStage = plan.resolution_stage || "info_only";'),
    "unexpected change to the resolution_stage default fallback",
  );
});
