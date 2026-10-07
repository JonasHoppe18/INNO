import { describe, expect, it } from "vitest";
import { buildEmailDocument, emailHtmlToText, sanitizeConversationHtml } from "../email-rendering";
import { customerPreviewsByThread } from "@/components/inbox/message-preview";

const html = `<html><head><style>body { margin: 0 } .button { background: black; color: white; padding: 16px }</style></head><body><div style="display:none">Hidden preheader</div><h1>Sign in</h1><p>Finish signing in.</p><a class="button" href="https://example.invalid/login">Sign in</a><img src="cid:logo" alt="Store logo"></body></html>`;

describe("email rendering", () => {
  it("extracts visible text without CSS or hidden preheaders", () => {
    expect(emailHtmlToText(html)).toBe("Sign in\nFinish signing in.\nSign in");
  });
  it("repairs an existing preview polluted by CSS using the original HTML", () => {
    expect(customerPreviewsByThread([{ thread_id: "a", body_html: html, clean_body_text: "#outlook a { padding:0; } body { margin: 0 } Sign in" }])).toEqual({ a: "Sign in Finish signing in. Sign in" });
  });
  it("keeps useful inline formatting and resolves inline images", () => {
    const result = sanitizeConversationHtml('<p style="text-align:center;color:#123456;position:fixed">Hello</p><img src="cid:logo" alt="Store logo">', [{ id: "one", content_id: "logo" }]);
    expect(result).toContain("text-align:center");
    expect(result).toContain("color:#123456");
    expect(result).not.toContain("position:");
    expect(result).toContain("/api/attachments/one/download?disposition=inline");
  });
  it("preserves the original layout only in an isolated document", () => {
    const result = buildEmailDocument(html);
    expect(result).toContain(".button { background: black");
    expect(result).toContain('class="button"');
    expect(result).toContain("Content-Security-Policy");
    expect(result).toContain("script-src 'none'");
  });
  it("removes active content, hostile links, event handlers and embedded documents", () => {
    const hostile = '<script>alert(1)</script><iframe src="https://example.invalid"></iframe><form action="https://example.invalid"><input></form><a href="jav&#97;script:alert(1)" onclick="alert(1)">Hello</a><img src="https://example.invalid/a.png" onerror="alert(1)">';
    for (const result of [sanitizeConversationHtml(hostile), buildEmailDocument(hostile)]) {
      expect(result).not.toMatch(/<script|<iframe|<form|<input|onclick=|onerror=|href="javascript:/i);
      expect(result).toContain("Hello");
    }
  });
  it("keeps plain text messages and their quoted-history split", () => {
    expect(buildEmailDocument(null)).toBe("");
    expect(buildEmailDocument("  ")).toBe("");
    expect(customerPreviewsByThread([{ thread_id: "a", clean_body_text: "Where is my order?", body_text: "Where is my order?\nOn Monday someone wrote: Old reply" }])).toEqual({ a: "Where is my order?" });
  });
  it("handles table-based receipts, entities and hidden rows", () => {
    expect(emailHtmlToText('<table><tr style="display:none"><td>Tracking</td></tr><tr><td>Order &amp; delivery</td><td>&#248; &#xE5;</td></tr></table>')).toBe("Order & delivery ø å");
  });
  it("removes unresolved CID images while preserving resolved original dimensions", () => {
    const document = buildEmailDocument('<img src="cid:missing"><img src="cid:logo" alt="Logo" width="180">', [{ id: "one", content_id: "logo" }]);
    expect(document).not.toContain("cid:");
    expect(document).toContain('alt="Logo"');
    expect(document).toContain('width="180"');
  });
  it("keeps hidden preheaders hidden in conversation HTML", () => {
    expect(sanitizeConversationHtml(html)).not.toContain("Hidden preheader");
  });
});
