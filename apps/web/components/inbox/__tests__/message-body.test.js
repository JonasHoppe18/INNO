import { describe, expect, it } from "vitest";

import {
  deriveMessageBodies,
  selectMessagePreview,
} from "../message-body";

describe("inbound message preview selection", () => {
  it("keeps the current-message link and excludes historical link/image HTML", () => {
    const message = {
      body_html: [
        '<p>Current note <a href="https://current.example.test">current link</a></p>',
        '<div class="gmail_quote"><a href="https://old.example.test">old link</a><img src="https://old.example.test/old.png" /></div>',
      ].join(""),
      clean_body_html: '<p>Current note <a href="https://current.example.test">current link</a></p>',
      clean_body_text: "Current note current link",
      quoted_body_html: '<div class="gmail_quote"><a href="https://old.example.test">old link</a><img src="https://old.example.test/old.png" /></div>',
      quoted_body_text: "Old history",
      quoted_history_detected: true,
    };

    const bodies = deriveMessageBodies(message);
    const preview = selectMessagePreview({
      cleanBodyHtml: bodies.cleanBodyHtml,
      cleanBodyText: bodies.cleanBodyText,
      rawBodyText: message.body_html,
      hasQuotedHistory: bodies.hasQuotedHistory,
    });

    expect(preview.bodyHtml).toContain("current.example.test");
    expect(preview.bodyHtml).not.toContain("old.example.test");
    expect(preview.bodyHtml).not.toContain("old.png");
  });

  it("does not fall back to the full raw body when only quoted history is available", () => {
    const preview = selectMessagePreview({
      rawBodyText: "Current text\n\nOld quoted history with a link",
      hasQuotedHistory: true,
    });

    expect(preview.bodyHtml).toBe("");
    expect(preview.bodyText).toBe("No preview available.");
  });

  it("keeps standalone raw content available when no quote was detected", () => {
    const preview = selectMessagePreview({
      rawBodyText: "Standalone message with a link",
      hasQuotedHistory: false,
    });

    expect(preview.bodyText).toBe("Standalone message with a link");
  });
});
