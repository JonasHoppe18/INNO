import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

import { parseEmailReplyBodies } from "./email-reply-parser.ts";
import { ACEZONE_QUOTED_REPLY_FIXTURE } from "./fixtures/acezone-quoted-reply.fixture.ts";

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

  assertEquals(
    parsed.cleanBodyText,
    "Hej\n\nJeg vil gerne vide mere om min ordre.",
  );
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

Deno.test("cuts a Danish Gmail weekday-and-date quoted reply marker", () => {
  const parsed = parseEmailReplyBodies({
    text: [
      "Do you make deeper earcups because the ANC speaker touches my ear?",
      "",
      "tors 2 juli 2026 kl. 08:52 skrev AceZone Support (Support) <support@example.com>:",
      "",
      "Hi there,",
      "The older return conversation must not become the latest request.",
    ].join("\n"),
  });

  assertEquals(
    parsed.cleanBodyText,
    "Do you make deeper earcups because the ANC speaker touches my ear?",
  );
  assertEquals(parsed.parserStrategy, "on_wrote");
});

Deno.test("keeps a standalone customer email intact", () => {
  const parsed = parseEmailReplyBodies({
    text: "The replacement arrived today and works perfectly.",
    html: "<p>The replacement arrived today and works perfectly.</p>",
  });

  assertEquals(parsed.cleanBodyText, "The replacement arrived today and works perfectly.");
  assertEquals(parsed.quotedBodyText, null);
  assertEquals(parsed.quotedBodyHtml, null);
  assertEquals(parsed.quotedHistoryDetected, false);
});

Deno.test("cuts a Gmail quote while preserving a current-message link", () => {
  const parsed = parseEmailReplyBodies({
    text: [
      "The tracking link is https://example.test/track/123.",
      "",
      "On Tue, 21 Sep 2026, Support <support@example.test> wrote:",
      "",
      "Older customer message with https://old.example.test/history.",
    ].join("\n"),
    html: [
      "<p>The tracking link is <a href=\"https://example.test/track/123\">here</a>.</p>",
      "<div class=\"gmail_quote\"><p>Older customer message with <a href=\"https://old.example.test/history\">history</a>.</p></div>",
    ].join(""),
  });

  assertEquals(parsed.cleanBodyText, "The tracking link is https://example.test/track/123.");
  assertMatch(parsed.cleanBodyHtml || "", /example\.test\/track\/123/);
  assert(!String(parsed.cleanBodyHtml || "").includes("old.example.test"));
  assertMatch(parsed.quotedBodyText || "", /Older customer message/);
  assertMatch(parsed.quotedBodyHtml || "", /old\.example\.test/);
});

Deno.test("cuts an Outlook reply header from the latest customer text", () => {
  const parsed = parseEmailReplyBodies({
    text: [
      "The parcel is still missing.",
      "",
      "From: Support <support@example.test>",
      "Sent: Tuesday, September 21, 2026 4:20 PM",
      "To: Customer <customer@example.test>",
      "Subject: Re: Parcel",
      "",
      "Previous reply",
    ].join("\n"),
  });

  assertEquals(parsed.cleanBodyText, "The parcel is still missing.");
  assertEquals(parsed.parserStrategy, "header_block");
  assertMatch(parsed.quotedBodyText || "", /^From: Support/m);
});

Deno.test("uses Postmark StrippedTextReply only for a reply with reply headers", () => {
  const parsed = parseEmailReplyBodies({
    text: "Latest customer note\n\nfont-family: Arial;\nOld quoted content",
    strippedTextReply: "Latest customer note",
    hasReplyHeaders: true,
  });

  assertEquals(parsed.cleanBodyText, "Latest customer note");
  assertEquals(parsed.parserStrategy, "stripped_text_reply");
  assertEquals(parsed.cleanExtractionSucceeded, true);
  assertEquals(parsed.quotedHistoryDetected, true);

  const standalone = parseEmailReplyBodies({
    text: "A standalone note",
    strippedTextReply: "A misleading hint",
    hasReplyHeaders: false,
  });
  assertEquals(standalone.cleanBodyText, "A standalone note");
  assertEquals(standalone.quotedHistoryDetected, false);
});

Deno.test("uses the HTML current-message section when TextBody is polluted by quoted CSS", () => {
  const parsed = parseEmailReplyBodies(ACEZONE_QUOTED_REPLY_FIXTURE);

  assertEquals(parsed.cleanBodyText, "I still need help with the replacement.");
  assert(!String(parsed.cleanBodyText).includes("font-family"));
  assert(!String(parsed.cleanBodyText).includes("Old Zendesk history"));
  assertMatch(parsed.quotedBodyText || "", /Old Zendesk history/);
  assertMatch(parsed.quotedBodyHtml || "", /gmail_quote/);
});

Deno.test("preserves a deliberate forwarded message as historical evidence", () => {
  const parsed = parseEmailReplyBodies({
    text: [
      "Please see the supplier email below.",
      "",
      "---------- Forwarded message ----------",
      "From: Supplier <supplier@example.test>",
      "Subject: Delivery update",
      "",
      "The shipment leaves tomorrow.",
    ].join("\n"),
    html: "<p>Please see the supplier email below.</p><hr><p>---------- Forwarded message ----------</p><p>The shipment leaves tomorrow.</p>",
  });

  assertEquals(parsed.cleanBodyText, "Please see the supplier email below.");
  assertEquals(parsed.parserStrategy, "forwarded_separator");
  assertMatch(parsed.quotedBodyText || "", /The shipment leaves tomorrow/);
  assertMatch(parsed.quotedBodyHtml || "", /Forwarded message/);
});

Deno.test("derives readable text from an HTML-only message without exposing style markup", () => {
  const parsed = parseEmailReplyBodies({
    html: "<style>.mail { color: red; }</style><p>HTML-only customer note</p>",
  });

  assertEquals(parsed.cleanBodyText, "HTML-only customer note");
  assertMatch(parsed.cleanBodyHtml || "", /HTML-only customer note/);
  assert(!parsed.cleanBodyText.includes("color: red"));
});

Deno.test("does not alter attachment metadata or bytes during body extraction", () => {
  const attachment = {
    Name: "supporting-document.pdf",
    ContentType: "application/pdf",
    ContentLength: 12,
    ContentID: "<pdf-1>",
    Content: "JVBERi0xLjQK",
  };
  const before = JSON.stringify(attachment);
  parseEmailReplyBodies({
    text: "Latest note\n\nOn Tue, Support <support@example.test> wrote:\nOld note",
    html: "<p>Latest note</p><blockquote>Old note</blockquote>",
  });
  assertEquals(JSON.stringify(attachment), before);
  assertEquals(attachment.Name, "supporting-document.pdf");
  assertEquals(attachment.ContentType, "application/pdf");
  assertEquals(attachment.Content, "JVBERi0xLjQK");
});
