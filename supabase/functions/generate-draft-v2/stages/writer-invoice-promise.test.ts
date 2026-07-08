// READINESS-4: writer.ts must never suggest a future document-delivery
// promise as its own "safe" fallback for unconfirmed invoice/receipt/order-
// confirmation requests. runWriter builds its system prompt inline and calls
// a live LLM (like writer-clarify-symptom.test.ts), so these tests assert on
// the prompt SOURCE text rather than generated draft output — there is no
// live model call here.
import { assert, assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./writer.ts", import.meta.url));

Deno.test("writer.ts no longer suggests 'Jeg sørger for at du får din faktura' as a fallback", () => {
  assert(
    !src.includes("Jeg sørger for at du får din faktura"),
    "writer.ts still contains the unsafe future-promise invoice fallback example",
  );
});

Deno.test("writer.ts no longer claims a fabricated shop-manager request as a fallback", () => {
  assert(
    !src.includes("Jeg har bedt vores shop-manager om at sende din faktura"),
    "writer.ts still contains the unsafe fabricated-request invoice fallback example",
  );
});

Deno.test("writer.ts invoice fallback guidance no longer instructs 'neutral/fremtidig formulering'", () => {
  assert(
    !src.includes("neutral/fremtidig formulering"),
    "writer.ts invoice rule still points the model at future-tense wording as the safe option",
  );
});

Deno.test("writer.ts invoice rules explicitly forbid promising future delivery", () => {
  const invoiceRuleLines = src
    .split("\n")
    .filter((line) =>
      line.includes("faktura") && line.toLowerCase().includes("vil blive")
    );
  assert(
    invoiceRuleLines.length > 0,
    "expected at least one invoice rule that explicitly forbids promising the invoice 'vil blive' sendt/tilsendt",
  );
});

Deno.test("writer.ts fallback wording for unconfirmed invoice requests is neutral, not a promise", () => {
  assert(
    src.includes("Jeg kan ikke sende fakturaen direkte herfra"),
    "writer.ts is missing the neutral non-promising invoice fallback example",
  );
});

Deno.test("writer.ts explicitly forbids common future invoice-delivery promises", () => {
  for (
    const phrase of [
      "Du vil modtage fakturaen",
      "du får den tilsendt",
      "vi sørger for at du får den",
      "den bliver sendt til dig",
    ]
  ) {
    assert(
      src.includes(phrase),
      `writer.ts is missing explicit invoice-delivery ban for: ${phrase}`,
    );
  }
});

Deno.test("writer.ts routes ungrounded team/B2B discount requests to customer-ready fallback", () => {
  assert(
    src.includes("Send gerne antal og behov, så tager vi den derfra"),
    "writer.ts is missing the customer-ready fallback for team/B2B discount requests",
  );
  assert(
    src.includes(
      "må du hverken love rabat/teampris/specialpris eller afvise at de findes",
    ),
    "writer.ts must forbid both positive and negative ungrounded commercial policy claims",
  );
});

// Guard the three known locations this guidance lives in stay all fixed —
// prevents a partial fix (e.g. only the BESLUTNINGSREGLER block) from
// silently reintroducing the promise via buildLiveFactAuthorityBlock().
Deno.test("buildLiveFactAuthorityBlock, FAKTURA/kvittering rule, and FAKTURA-REGEL all use non-promising language", () => {
  const occurrences = src.split("faktura").length - 1;
  assert(
    occurrences > 0,
    "sanity: writer.ts should still reference faktura at all",
  );
  assertEquals(
    src.includes("sørger for at du får din faktura"),
    false,
  );
});
