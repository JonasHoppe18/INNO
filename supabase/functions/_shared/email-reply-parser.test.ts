import { assertEquals, assertMatch } from "jsr:@std/assert@1";

import { parseEmailReplyBodies } from "./email-reply-parser.ts";

Deno.test("cuts Danish Outlook iOS signature plus Scandinavian reply header", () => {
  const parsed = parseEmailReplyBodies({
    text: [
      "Hej",
      "",
      "Jeg vil gerne vide mere om min ordre.",
      "",
      "Sendt fra Outlook til iOS",
      "",
      "Fra: AceZone Support <support@acezone.io>",
      "Sendt: fredag den 13. marts 2026 14.11",
      "Til: Albert <albert@example.com>",
      "Emne: Re: Order 1050",
      "",
      "Gammel besked",
    ].join("\n"),
  });

  assertEquals(parsed.cleanBodyText, "Hej\n\nJeg vil gerne vide mere om min ordre.");
  assertEquals(parsed.parserStrategy, "outlook_ios_signature");
  assertMatch(parsed.quotedBodyText || "", /^Sendt fra Outlook til iOS/m);
});

Deno.test("cuts English Outlook iOS signature plus reply header", () => {
  const parsed = parseEmailReplyBodies({
    text: [
      "Following up on this.",
      "",
      "Sent from Outlook for iOS",
      "",
      "From: AceZone Support <support@acezone.io>",
      "Sent: Friday, March 13, 2026 2:11 PM",
      "To: Albert <albert@example.com>",
      "Subject: Re: Order 1050",
      "",
      "Older thread",
    ].join("\n"),
  });

  assertEquals(parsed.cleanBodyText, "Following up on this.");
  assertEquals(parsed.parserStrategy, "outlook_ios_signature");
  assertMatch(parsed.quotedBodyText || "", /^Sent from Outlook for iOS/m);
});

Deno.test("cuts Scandinavian header block without mobile signature", () => {
  const parsed = parseEmailReplyBodies({
    text: [
      "Test igen",
      "",
      "Fra: AceZone Support <support@acezone.io>",
      "Sendt: fredag den 13. marts 2026 14.11",
      "Til: Albert <albert@example.com>",
      "Emne: Re: Order 1050",
      "",
      "Tidligere besked",
    ].join("\n"),
  });

  assertEquals(parsed.cleanBodyText, "Test igen");
  assertEquals(parsed.parserStrategy, "header_block_scandinavian");
});

Deno.test("cuts Outlook iOS signature when blank lines separate signature and header block", () => {
  const parsed = parseEmailReplyBodies({
    text: [
      "Nyeste besked",
      "",
      "Sendt fra Outlook til iOS",
      "",
      "",
      "Fra: AceZone Support <support@acezone.io>",
      "",
      "Sendt: fredag den 13. marts 2026 14.11",
      "Til: Albert <albert@example.com>",
      "",
      "Emne: Re: Order 1050",
      "",
      "Ældre indhold",
    ].join("\n"),
  });

  assertEquals(parsed.cleanBodyText, "Nyeste besked");
  assertEquals(parsed.parserStrategy, "outlook_ios_signature");
  assertEquals(parsed.matchedBoundaryLine, "Sendt fra Outlook til iOS");
});
