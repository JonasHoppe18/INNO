import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { normalizeZendeskBaseUrl } from "./zendesk-url.ts";

Deno.test("Zendesk URL normalization accepts HTTPS tenant hosts", () => {
  assertEquals(
    normalizeZendeskBaseUrl("acezone.zendesk.com"),
    "https://acezone.zendesk.com",
  );
  assertEquals(
    normalizeZendeskBaseUrl("https://eu.acezone.zendesk.com/"),
    "https://eu.acezone.zendesk.com",
  );
});

Deno.test("Zendesk URL normalization rejects SSRF-capable destinations", () => {
  for (
    const value of [
      "http://acezone.zendesk.com",
      "https://zendesk.com",
      "https://acezone.zendesk.com.evil.test",
      "https://localhost",
      "https://127.0.0.1",
      "https://[::1]",
      "https://user:pass@acezone.zendesk.com",
      "https://acezone.zendesk.com:8443",
      "https://acezone.zendesk.com/agent",
      "https://acezone.zendesk.com?next=http://127.0.0.1",
    ]
  ) {
    assertThrows(() => normalizeZendeskBaseUrl(value), Error, "Zendesk");
  }
});

Deno.test("custom Zendesk hosts require an exact server-side allowlist entry", () => {
  assertEquals(
    normalizeZendeskBaseUrl("https://support.acezone.io", {
      allowedCustomHosts: "support.acezone.io,help.example.org",
    }),
    "https://support.acezone.io",
  );
  assertThrows(
    () =>
      normalizeZendeskBaseUrl("https://support.acezone.io.evil.com", {
        allowedCustomHosts: ["support.acezone.io"],
      }),
    Error,
    "allowlisted",
  );
  assertThrows(
    () =>
      normalizeZendeskBaseUrl("https://127.0.0.1", {
        allowedCustomHosts: ["127.0.0.1"],
      }),
    Error,
    "not allowed",
  );
});
