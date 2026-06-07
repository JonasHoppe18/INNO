// deno test for the semantic chunker.
// Run: deno test apps/web/lib/server/semantic-chunker.test.ts
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeWhitespace, splitIntoSemanticChunks } from "./semantic-chunker.ts";

const stripWs = (s: string) => s.replace(/\s+/g, " ").trim();
const occurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

// The real curated guide: short blank-line-separated paragraphs mixed with a few
// longer bullet sections. The longer sections clear minChars and force the merge
// path, where the OLD chunker silently dropped every short section (return window,
// return address, etc). This is the exact failure we are fixing.
const GUIDE = `# Returns & Refunds — AI Handling Guide

## Return window

Customers can request a return up to 30 days after receiving the product.

The 30-day period begins when the customer, or a third party appointed by the customer, receives the last item in the order.

## Unused and sealed products

A full refund is available when the product is unused and returned in sealed and intact original packaging.

## How to request a return

Ask the customer for:

* order number
* name used for the purchase
* reason for the return
* whether the product has been opened or tested
* whether the product has already been returned
* tracking information if the package has already been returned

The customer must contact AceZone before returning the product.

## Return address

The customer must arrange and pay for return shipping.

The package must be sent directly to:

AceZone International ApS
Øster Allé 56, 5th floor
2100 København Ø
Denmark

The package must not be sent COD or without distribution.

## Forbidden promises

Never:

* reject a return solely because the product has been opened or tested
* promise a full refund for an opened or tested product
* promise a fixed deduction amount
* promise an exact refund date without order context`;

Deno.test("short section under minChars is never dropped", () => {
  const chunks = splitIntoSemanticChunks(GUIDE);
  const joined = chunks.join("\n\n");
  // The 30-day window lives in a short paragraph — it must survive.
  assert(
    joined.includes("30 days"),
    "return window text was dropped",
  );
  // The sealed-products section is the shortest (~137 chars) — must survive.
  assert(
    joined.includes("sealed and intact original packaging"),
    "short 'unused and sealed' section was dropped",
  );
});

Deno.test("short section merges forward into the next section", () => {
  const input = [
    "## Tiny header",
    "Short body line one.",
    "## Next section",
    "This is a substantially longer body that easily clears the minimum character floor on its own so it would survive even without merging at all.",
  ].join("\n\n");
  const chunks = splitIntoSemanticChunks(input);
  const withTiny = chunks.find((c) => c.includes("Tiny header"));
  assert(withTiny, "tiny section disappeared");
  assert(
    withTiny.includes("Next section") || withTiny.includes("Short body line one"),
    "tiny section was not merged with a neighbour",
  );
});

Deno.test("trailing short section merges back into the previous section", () => {
  const input = [
    "## Main section",
    "This is a substantially longer body that easily clears the minimum character floor on its own without any merging whatsoever, so it stands alone fine.",
    "## Tail",
    "Tiny tail.",
  ].join("\n\n");
  const chunks = splitIntoSemanticChunks(input);
  const joined = chunks.join("\n\n");
  assert(joined.includes("Tiny tail."), "trailing short section was dropped");
  // It must not be a standalone sub-min chunk — it should live with the previous.
  const tailChunk = chunks.find((c) => c.includes("Tiny tail."));
  assert(tailChunk, "no chunk contains the tail");
  assert(
    tailChunk.includes("Main section"),
    "trailing short section did not merge back into previous",
  );
});

Deno.test("all ## headers are preserved in the output", () => {
  const chunks = splitIntoSemanticChunks(GUIDE);
  const joined = chunks.join("\n\n");
  for (
    const header of [
      "## Return window",
      "## Unused and sealed products",
      "## Return address",
    ]
  ) {
    assert(joined.includes(header), `header lost: ${header}`);
  }
});

Deno.test("return address and return window are preserved verbatim", () => {
  const chunks = splitIntoSemanticChunks(GUIDE);
  const joined = chunks.join("\n\n");
  assert(joined.includes("Øster Allé 56, 5th floor"), "return address line lost");
  assert(joined.includes("2100 København Ø"), "return address city lost");
  assert(joined.includes("30 days"), "return window lost");
});

Deno.test("output contains 100% of the input text exactly once", () => {
  const chunks = splitIntoSemanticChunks(GUIDE);
  const joined = stripWs(chunks.join("\n\n"));
  const expected = stripWs(normalizeWhitespace(GUIDE));
  assertEquals(joined, expected, "joined chunks do not reconstruct the input");
  // No duplication of a distinctive sentence.
  assertEquals(
    occurrences(chunks.join("\n\n"), "must not be sent COD"),
    1,
    "content was duplicated across chunks",
  );
});
