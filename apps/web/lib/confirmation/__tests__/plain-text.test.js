import { describe, expect, it } from "vitest";
import { htmlToPlainText } from "../plain-text";

describe("htmlToPlainText", () => {
  it("separates paragraphs and keeps line breaks", () => {
    expect(htmlToPlainText("<p>Hi {{customer_first_name}},</p><p>Thanks.<br>Best,<br/>{{team_name}}</p>"))
      .toBe("Hi {{customer_first_name}},\n\nThanks.\nBest,\n{{team_name}}");
  });

  it("keeps link targets and drops formatting tags", () => {
    expect(htmlToPlainText('<p>See <a href="https://shop.test/help">our <strong>help</strong> page</a> or <span style="color:red">call</span>.</p>'))
      .toBe("See our help page (https://shop.test/help) or call.");
  });

  it("decodes entities", () => {
    expect(htmlToPlainText("<p>A &amp; B &lt;3 &gt; &quot;x&quot; it&#39;s&nbsp;ok</p>")).toBe(`A & B <3 > "x" it's ok`);
  });

  it("ignores head, styles, comments and table layout from the email wrapper", () => {
    const html = `<!doctype html><html><head><title>t</title><style>p{color:red}</style></head><body>
      <!--sona:full-design--><div style="display:none">Preview</div>
      <table><tr><td><h2>We've received your message</h2></td></tr>
      <tr><td><p>Hi there,</p></td></tr><tr><td></td></tr><tr><td><p>Best</p></td></tr></table></body></html>`;
    expect(htmlToPlainText(html)).toBe("We've received your message\n\nHi there,\n\nBest");
  });

  it("collapses whitespace and empty blocks", () => {
    expect(htmlToPlainText("<p>  a   b </p><p></p><p>\n c </p>")).toBe("a b\n\nc");
  });
});
