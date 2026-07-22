import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildWriterConversationHistory,
  latestCustomerTextWithSubjectFallback,
  parseQuotedEmailHistory,
  visibleEmailText,
} from "./email-thread-normalizer.ts";

Deno.test("image-only messages fall back to a substantive issue subject", () => {
  assertEquals(
    latestCustomerTextWithSubjectFallback(
      { clean_body_text: "![](https://example.test/image.png)" },
      "A-Spire Wireless dongle connects but has no sound",
    ),
    "A-Spire Wireless dongle connects but has no sound",
  );
});

Deno.test("a newest acknowledgement is never overridden by a stale subject", () => {
  assertEquals(
    latestCustomerTextWithSubjectFallback(
      { clean_body_text: "Thanks!" },
      "Cancel order 1234",
    ),
    "Thanks!",
  );
});

Deno.test("generic subjects are not treated as customer requests", () => {
  assertEquals(
    latestCustomerTextWithSubjectFallback(
      { clean_body_text: "![](https://example.test/image.png)" },
      "New customer message on 12 July 2026",
    ),
    "![](https://example.test/image.png)",
  );
});

Deno.test("visible text keeps newest customer message separate from quoted history", () => {
  const raw = `The USPS tracking number is 9588871095290073926950

On Tue, Jun 9, 2026 at 11:15 PM Customer <customer@example.com> wrote:
> I am still going to go through with the refund.`;

  assertEquals(
    visibleEmailText({
      clean_body_text: "The USPS tracking number is 9588871095290073926950",
      body_text: raw,
    }),
    "The USPS tracking number is 9588871095290073926950",
  );
});

Deno.test("visible text trims trailing quoted support boundary lines", () => {
  assertEquals(
    visibleEmailText({
      clean_body_text: `I am still going to go through with the refund.

Thanks,
Britt.

On Tue, Jun 9, 2026 at 3:41 AM Example Support <support@example.com> wrote:`,
      body_text: "",
    }),
    `I am still going to go through with the refund.

Thanks,
Britt.`,
  );
});

Deno.test("visible text trims Danish Gmail weekday reply history", () => {
  assertEquals(
    visibleEmailText({
      clean_body_text: `Do you make deeper earcups?

tors 2 juli 2026 kl. 08:52 skrev AceZone Support <support@example.com>:

Older support reply`,
      body_text: "",
    }),
    "Do you make deeper earcups?",
  );
});

Deno.test("quoted support replies are represented as agent context", () => {
  const quoted =
    `On Tue, Jun 9, 2026 at 11:15 PM Britt <britt@example.com> wrote:

> I am still going to go through with the refund.
>
> On Tue, Jun 9, 2026 at 3:41 AM Example Support <support@example.com> wrote:
>
>> For US returns, please send the headset to:
>>
>> Example Returns
>> 49 Innovation Drive`;

  const turns = parseQuotedEmailHistory(quoted);
  assertEquals(turns.map((turn) => turn.role), ["customer", "agent"]);
  assertStringIncludes(turns[1].text, "For US returns");
  assertStringIncludes(turns[1].text, "49 Innovation Drive");
});

Deno.test("writer history includes quoted support but does not duplicate quoted customer as latest request", () => {
  const latest = {
    clean_body_text: "The USPS tracking number is 9588871095290073926950",
    body_text: "The USPS tracking number is 9588871095290073926950",
    quoted_body_text:
      `On Tue, Jun 9, 2026 at 11:15 PM Britt <britt@example.com> wrote:
> I am still going to go through with the refund.
>
> On Tue, Jun 9, 2026 at 3:41 AM Example Support <support@example.com> wrote:
>> Please send the return to the address we provided.`,
    from_me: false,
  };
  const history = buildWriterConversationHistory([
    {
      clean_body_text: "Looking to get a refund.",
      body_text: "Looking to get a refund.",
      from_me: false,
    },
    latest,
  ], latest);

  assertEquals(history.length, 2);
  assertEquals(history[0].role, "customer");
  assertEquals(history[0].text, "Looking to get a refund.");
  assertEquals(history[1].role, "agent");
  assertStringIncludes(history[1].text, "Quoted prior support reply");
  assertStringIncludes(history[1].text, "does not authorize refunds");
  assertStringIncludes(history[1].text, "Please send the return");
  assertEquals(
    history.some((turn) =>
      turn.text.includes("I am still going to go through")
    ),
    false,
  );
});

Deno.test("writer history excludes unsent composer drafts but keeps sent multilingual agent turns", () => {
  const latest = {
    clean_body_text: "Ja, adressen er korrekt.",
    body_text: "Ja, adressen er korrekt.",
    from_me: false,
    is_draft: false,
  };
  const history = buildWriterConversationHistory([
    {
      clean_body_text: "Min pakke er ikke kommet.",
      body_text: "Min pakke er ikke kommet.",
      from_me: false,
      is_draft: false,
    },
    {
      clean_body_text: "Kan du bekræfte leveringsadressen?",
      body_text: "Kan du bekræfte leveringsadressen?",
      from_me: true,
      direction: "outbound",
      is_draft: false,
    },
    {
      clean_body_text: "We have refunded and reshipped your order.",
      body_text: "We have refunded and reshipped your order.",
      from_me: true,
      direction: "outbound",
      is_draft: true,
    },
    latest,
  ], latest);

  assertEquals(history, [
    { role: "customer", text: "Min pakke er ikke kommet." },
    { role: "agent", text: "Kan du bekræfte leveringsadressen?" },
  ]);
});
