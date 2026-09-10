import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isExternalCustomerEmail,
  normalizeCustomerEmail,
  resolveInboundCustomerIdentity,
} from "./customer-identity.ts";

Deno.test("normalizes customer email without provider-specific rewriting", () => {
  assertEquals(normalizeCustomerEmail("  Customer.Name@example.com "), "customer.name@example.com");
  assertEquals(normalizeCustomerEmail("customer+tag@example.com"), "customer+tag@example.com");
});

Deno.test("resolves an inbound sender without Shopify data", () => {
  assertEquals(resolveInboundCustomerIdentity({
    workspaceId: "workspace-a",
    fromEmail: "customer@example.com",
    internalEmails: [],
  }), {
    workspaceId: "workspace-a",
    normalizedEmail: "customer@example.com",
  });
});

Deno.test("excludes internal, automated, and blocked senders", () => {
  assertEquals(isExternalCustomerEmail("support@example.com", {
    internalEmails: ["support@example.com"],
  }), false);
  assertEquals(resolveInboundCustomerIdentity({
    workspaceId: "workspace-a",
    fromEmail: "customer@example.com",
    isAutomated: true,
  }), null);
  assertEquals(resolveInboundCustomerIdentity({
    workspaceId: "workspace-a",
    fromEmail: "customer@example.com",
    isBlockedSender: true,
  }), null);
  assertEquals(resolveInboundCustomerIdentity({
    workspaceId: "workspace-a",
    fromEmail: "no-reply@example.com",
  }), null);
});
