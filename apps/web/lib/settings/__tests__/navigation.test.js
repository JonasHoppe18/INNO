import { describe, expect, it } from "vitest";
import {
  EMAIL_SECTIONS,
  SETTINGS_NAV,
  isSettingsSectionPath,
  legacySettingsPath,
  parseSettingsPathname,
  parseSettingsSlug,
  settingsPath,
  withSearchParams,
} from "../navigation";

describe("settings navigation", () => {
  it("keeps the current menu order and keys", () => {
    expect(SETTINGS_NAV.map((group) => group.label)).toEqual(["WORKSPACE", "AI & AUTOMATION", "COMMUNICATION", "ACCOUNT"]);
    expect(SETTINGS_NAV.flatMap((group) => group.items.map((item) => item.key))).toEqual([
      "general", "members", "mailboxes", "tags", "ai", "automation", "email", "customer-satisfaction", "profile", "billing",
    ]);
    expect(EMAIL_SECTIONS.map((section) => section.key)).toEqual(["auto-reply", "routing", "sender-rules", "blocklist", "signatures"]);
  });

  it("parses section slugs", () => {
    expect(parseSettingsSlug(["general"])).toEqual({ section: "general", emailSection: null });
    expect(parseSettingsSlug(["email"])).toEqual({ section: "email", emailSection: "auto-reply" });
    expect(parseSettingsSlug(["email", "routing"])).toEqual({ section: "email", emailSection: "routing" });
    expect(parseSettingsSlug(["Email", "ROUTING"])).toEqual({ section: "email", emailSection: "routing" });
  });

  it("rejects unknown or overlong slugs", () => {
    expect(parseSettingsSlug([])).toBeNull();
    expect(parseSettingsSlug(undefined)).toBeNull();
    expect(parseSettingsSlug(["foo"])).toBeNull();
    expect(parseSettingsSlug(["email", "foo"])).toBeNull();
    expect(parseSettingsSlug(["general", "extra"])).toBeNull();
    expect(parseSettingsSlug(["email", "routing", "extra"])).toBeNull();
    expect(parseSettingsSlug(["csat"])).toBeNull();
  });

  it("builds canonical paths", () => {
    expect(settingsPath("members")).toBe("/settings/members");
    expect(settingsPath("email")).toBe("/settings/email/auto-reply");
    expect(settingsPath("email", "blocklist")).toBe("/settings/email/blocklist");
    expect(settingsPath("email", "nope")).toBe("/settings/email/auto-reply");
    expect(settingsPath("nope")).toBe("/settings/general");
  });

  it("parses pathnames", () => {
    expect(parseSettingsPathname("/settings/email/routing")).toEqual({ section: "email", emailSection: "routing" });
    expect(parseSettingsPathname("/settings/profile/")).toEqual({ section: "profile", emailSection: null });
    expect(parseSettingsPathname("/settings")).toBeNull();
    expect(parseSettingsPathname("/inbox")).toBeNull();
  });

  it("maps legacy query links", () => {
    expect(legacySettingsPath(new URLSearchParams(""))).toBe("/settings/general");
    expect(legacySettingsPath(new URLSearchParams("tab=customer-satisfaction"))).toBe("/settings/customer-satisfaction");
    expect(legacySettingsPath(new URLSearchParams("tab=email&section=routing"))).toBe("/settings/email/routing");
    expect(legacySettingsPath(new URLSearchParams("tab=email&section=bogus"))).toBe("/settings/email/auto-reply");
    expect(legacySettingsPath(new URLSearchParams("tab=bogus"))).toBe("/settings/general");
    expect(legacySettingsPath({ tab: "email", section: "auto-reply", mailbox_id: "m-1" })).toBe("/settings/email/auto-reply?mailbox_id=m-1");
  });

  it("appends search params without the omitted keys", () => {
    expect(withSearchParams("/settings/general", null)).toBe("/settings/general");
    expect(withSearchParams("/settings/email/auto-reply", new URLSearchParams("tab=email&mailbox_id=a b"), ["tab"])).toBe("/settings/email/auto-reply?mailbox_id=a+b");
    expect(withSearchParams("/settings/general", { x: ["1", "2"] })).toBe("/settings/general?x=1&x=2");
  });

  it("recognizes settings section paths but not the email builders", () => {
    expect(isSettingsSectionPath("/settings")).toBe(true);
    expect(isSettingsSectionPath("/settings/general")).toBe(true);
    expect(isSettingsSectionPath("/settings/email/signatures")).toBe(true);
    expect(isSettingsSectionPath("/settings/csat/email")).toBe(false);
    expect(isSettingsSectionPath("/settings/confirmation/email")).toBe(false);
    expect(isSettingsSectionPath("/inbox")).toBe(false);
  });
});
