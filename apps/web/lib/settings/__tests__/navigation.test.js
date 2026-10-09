import { describe, expect, it } from "vitest";
import {
  SETTINGS_NAV,
  isSettingsSectionPath,
  legacySettingsPath,
  parseSettingsPathname,
  parseSettingsSlug,
  retiredSettingsPath,
  settingsPageKey,
  settingsPath,
  withSearchParams,
} from "../navigation";

describe("settings navigation", () => {
  it("groups sections by what they answer", () => {
    expect(SETTINGS_NAV.map((group) => group.label)).toEqual([
      "WORKSPACE", "CHANNELS", "AUTOMATIC EMAILS", "AI & AUTOMATION", "ACCOUNT",
    ]);
    expect(SETTINGS_NAV.flatMap((group) => group.items.map((item) => item.key))).toEqual([
      "general", "members", "brand", "mailboxes", "inbox-rules", "confirmation-email", "customer-satisfaction",
      "ai", "automation", "profile", "billing",
    ]);
  });

  it("parses section slugs", () => {
    expect(parseSettingsSlug(["general"])).toEqual({ section: "general" });
    expect(parseSettingsSlug(["Inbox-Rules"])).toEqual({ section: "inbox-rules" });
    expect(parseSettingsSlug(["brand"])).toEqual({ section: "brand" });
  });

  it("rejects unknown, nested or retired slugs", () => {
    expect(parseSettingsSlug([])).toBeNull();
    expect(parseSettingsSlug(undefined)).toBeNull();
    expect(parseSettingsSlug(["foo"])).toBeNull();
    expect(parseSettingsSlug(["general", "extra"])).toBeNull();
    expect(parseSettingsSlug(["email"])).toBeNull();
    expect(parseSettingsSlug(["email", "routing"])).toBeNull();
    expect(parseSettingsSlug(["csat"])).toBeNull();
    expect(parseSettingsSlug(["tags"])).toBeNull();
  });

  it("builds canonical paths", () => {
    expect(settingsPath("members")).toBe("/settings/members");
    expect(settingsPath("inbox-rules")).toBe("/settings/inbox-rules");
    expect(settingsPath("nope")).toBe("/settings/general");
  });

  it("parses pathnames", () => {
    expect(parseSettingsPathname("/settings/confirmation-email")).toEqual({ section: "confirmation-email" });
    expect(parseSettingsPathname("/settings/profile/")).toEqual({ section: "profile" });
    expect(parseSettingsPathname("/settings")).toBeNull();
    expect(parseSettingsPathname("/inbox")).toBeNull();
  });

  it("redirects every retired email path to its new home", () => {
    expect(retiredSettingsPath(["email"])).toBe("/settings/confirmation-email");
    expect(retiredSettingsPath(["email", "auto-reply"])).toBe("/settings/confirmation-email");
    expect(retiredSettingsPath(["email", "routing"])).toBe("/settings/inbox-rules");
    expect(retiredSettingsPath(["Email", "Sender-Rules"])).toBe("/settings/inbox-rules");
    expect(retiredSettingsPath(["email", "blocklist"])).toBe("/settings/inbox-rules");
    expect(retiredSettingsPath(["email", "signatures"])).toBe("/settings/members");
    expect(retiredSettingsPath(["members"])).toBeNull();
  });

  it("maps legacy query links", () => {
    expect(legacySettingsPath(new URLSearchParams(""))).toBe("/settings/general");
    expect(legacySettingsPath(new URLSearchParams("tab=customer-satisfaction"))).toBe("/settings/customer-satisfaction");
    expect(legacySettingsPath(new URLSearchParams("tab=email&section=routing"))).toBe("/settings/inbox-rules");
    expect(legacySettingsPath(new URLSearchParams("tab=email&section=bogus"))).toBe("/settings/confirmation-email");
    expect(legacySettingsPath(new URLSearchParams("tab=email"))).toBe("/settings/confirmation-email");
    expect(legacySettingsPath(new URLSearchParams("tab=email&section=signatures"))).toBe("/settings/members");
    expect(legacySettingsPath(new URLSearchParams("tab=bogus"))).toBe("/settings/general");
    expect(legacySettingsPath({ tab: "email", section: "auto-reply", mailbox_id: "m-1" })).toBe("/settings/confirmation-email?mailbox_id=m-1");
  });

  it("appends search params without the omitted keys", () => {
    expect(withSearchParams("/settings/general", null)).toBe("/settings/general");
    expect(withSearchParams("/settings/confirmation-email", new URLSearchParams("tab=email&mailbox_id=a b"), ["tab"])).toBe("/settings/confirmation-email?mailbox_id=a+b");
    expect(withSearchParams("/settings/general", { x: ["1", "2"] })).toBe("/settings/general?x=1&x=2");
  });

  it("recognizes settings section paths but not the email builders", () => {
    expect(isSettingsSectionPath("/settings")).toBe(true);
    expect(isSettingsSectionPath("/settings/general")).toBe(true);
    expect(isSettingsSectionPath("/settings/inbox-rules")).toBe(true);
    expect(isSettingsSectionPath("/settings/csat/email")).toBe(false);
    expect(isSettingsSectionPath("/settings/confirmation/email")).toBe(false);
    expect(isSettingsSectionPath("/inbox")).toBe(false);
  });

  it("treats all settings sections as one page for page-level effects", () => {
    expect(settingsPageKey("/settings/general")).toBe("/settings");
    expect(settingsPageKey("/settings/inbox-rules")).toBe("/settings");
    expect(settingsPageKey("/settings")).toBe("/settings");
    expect(settingsPageKey("/settings/csat/email")).toBe("/settings/csat/email");
    expect(settingsPageKey("/inbox")).toBe("/inbox");
  });
});
