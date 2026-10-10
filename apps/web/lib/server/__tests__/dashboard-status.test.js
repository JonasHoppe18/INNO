import { describe, expect, it } from "vitest";
import { buildSystemStatus } from "../dashboard-status.js";

describe("buildSystemStatus", () => {
  it("uses the Mailboxes page rule: forwarding is connected unless disconnected", () => {
    const status = buildSystemStatus({
      mailboxes: [{ provider: "smtp", status: "inactive" }, { provider: "gmail", status: "active" }],
      shops: [{ uninstalled_at: null }],
    });
    expect(status.healthy).toBe(true);
    expect(status.checks.map((check) => [check.key, check.ok])).toEqual([["mailbox", true], ["store", true]]);
  });

  it("names the broken mailbox", () => {
    const status = buildSystemStatus({
      mailboxes: [
        { provider: "gmail", status: "disconnected", provider_email: "help@shop.test" },
        { provider: "outlook", status: "expired" },
        { provider: "smtp", status: "active" },
      ],
    });
    expect(status.healthy).toBe(false);
    expect(status.checks[0]).toMatchObject({ ok: false, detail: "help@shop.test and 1 more disconnected", href: "/mailboxes" });
  });

  it("flags a store that was uninstalled and skips checks with nothing to check", () => {
    expect(buildSystemStatus({ shops: [{ uninstalled_at: "2026-10-01" }] })).toMatchObject({
      healthy: false,
      checks: [{ key: "store", ok: false }],
    });
    expect(buildSystemStatus({})).toEqual({ healthy: true, checks: [] });
  });
});
