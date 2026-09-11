import { describe, expect, it } from "vitest";

import {
  buildNamedFromAddress,
  buildOutlookFrom,
  mailboxMatchesScope,
  resolveMailboxSenderName,
  validateMailboxSenderName,
} from "../mailbox-sender-name.js";

describe("mailbox sender name", () => {
  it("uses the mailbox name instead of the authenticated member name", () => {
    expect(
      resolveMailboxSenderName({
        mailbox: { from_name: "AceZone Support" },
        provider: "smtp",
        fallback: "Sona",
        memberName: "Elias Knudsen",
      }),
    ).toBe("AceZone Support");
  });

  it("builds the named From value used by Postmark and Gmail MIME", () => {
    expect(
      buildNamedFromAddress({
        name: "AceZone Support",
        email: "support@acezone.io",
      }),
    ).toBe("AceZone Support <support@acezone.io>");
  });

  it("keeps the authorized mailbox address in the Outlook From object", () => {
    const name = resolveMailboxSenderName({
      mailbox: { from_name: "AceZone Support" },
      provider: "outlook",
    });

    expect(buildOutlookFrom({ email: "support@acezone.io", name })).toEqual({
      emailAddress: { address: "support@acezone.io", name: "AceZone Support" },
    });
  });

  it("falls back safely when the mailbox name is blank", () => {
    expect(
      resolveMailboxSenderName({
        mailbox: { from_name: "  " },
        provider: "smtp",
        fallback: "Sona",
      }),
    ).toBe("Sona");
    expect(
      resolveMailboxSenderName({ mailbox: { from_name: "" }, provider: "gmail" }),
    ).toBeNull();
    expect(
      buildNamedFromAddress({ name: null, email: "support@acezone.io" }),
    ).toBe("support@acezone.io");
  });

  it("rejects header injection and address-separator characters", () => {
    for (const value of [
      "AceZone\r\nBcc: attacker@example.com",
      "AceZone <support@acezone.io>",
      "AceZone, Support",
      "AceZone: Support",
    ]) {
      expect(validateMailboxSenderName(value).error).toBeTruthy();
    }
    expect(validateMailboxSenderName({ name: "AceZone Support" }).error).toBe(
      "Sender name must be text.",
    );
  });

  it("keeps mailbox updates tenant-scoped", () => {
    expect(
      mailboxMatchesScope(
        { workspace_id: "workspace-a", user_id: "user-a" },
        { workspaceId: "workspace-a", supabaseUserId: "user-a" },
      ),
    ).toBe(true);
    expect(
      mailboxMatchesScope(
        { workspace_id: "workspace-b", user_id: "user-a" },
        { workspaceId: "workspace-a", supabaseUserId: "user-a" },
      ),
    ).toBe(false);
    expect(
      mailboxMatchesScope(
        { user_id: "user-a" },
        { workspaceId: null, supabaseUserId: "user-a" },
      ),
    ).toBe(true);
  });

  it("uses the same mailbox resolution for a new ticket", () => {
    expect(
      resolveMailboxSenderName({
        mailbox: { from_name: "AceZone Support" },
        provider: "smtp",
        fallback: "Sona",
        newTicket: true,
        memberName: "Elias Knudsen",
      }),
    ).toBe("AceZone Support");
  });
});
