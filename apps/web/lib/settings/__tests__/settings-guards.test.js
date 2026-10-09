import { describe, expect, it, vi } from "vitest";
import { decideSettingsPopState } from "../navigation";
import { withResource } from "../resource-map";
import { initialGeneralState } from "../general";
import { initialEmailState } from "../email-state";

describe("decideSettingsPopState", () => {
  const base = { previousUrl: "/settings/general", nextUrl: "/settings/members" };

  it("allows back/forward without unsaved changes", () => {
    const restore = vi.fn();
    expect(decideSettingsPopState({ ...base, dirty: false, confirm: () => false, restore })).toBe("allow");
    expect(restore).not.toHaveBeenCalled();
  });

  it("allows URL changes within the same section while dirty", () => {
    const confirm = vi.fn(() => false);
    expect(decideSettingsPopState({
      previousUrl: "/settings/inbox-rules", nextUrl: "/settings/inbox-rules?x=1", dirty: true, confirm, restore: vi.fn(),
    })).toBe("allow");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("discards when the user confirms leaving a dirty section", () => {
    const restore = vi.fn();
    expect(decideSettingsPopState({ ...base, dirty: true, confirm: () => true, restore })).toBe("discard");
    expect(restore).not.toHaveBeenCalled();
  });

  it("restores the previous url when the user cancels", () => {
    const restore = vi.fn();
    const previousUrl = "/settings/confirmation-email?mailbox_id=m1";
    expect(decideSettingsPopState({ previousUrl, nextUrl: "/settings/general", dirty: true, confirm: () => false, restore })).toBe("restore");
    expect(restore).toHaveBeenCalledWith(previousUrl);
  });
});

describe("withResource", () => {
  it("makes saved General values visible on the next mount", () => {
    const workspace = { workspaceId: "w1", workspaceName: "Acme", supportLanguage: "en" };
    const stale = { "/api/settings/test-mode": { ok: true, status: 200, payload: { test_mode: false, support_language: "en" } } };
    const saved = withResource(stale, "/api/settings/test-mode", { test_mode: true, test_email: "t@x.dk", support_language: "da", auto_close_mode: "auto", needs_attention_stale_days: 3 });
    expect(initialGeneralState(workspace, saved)).toMatchObject({ testMode: true, testEmail: "t@x.dk", supportLanguage: "da", autoCloseMode: "auto", needsAttentionStaleDays: "3" });
    expect(stale["/api/settings/test-mode"].payload.test_mode).toBe(false);
  });

  it("makes saved email values visible on the next mount", () => {
    const saved = withResource({}, "/api/settings/email-blocklist", { blocks: [{ id: "b1", matcher_type: "email", matcher_value: "A@B.dk" }] });
    expect(initialEmailState(saved, "").emailBlocklistRows[0]).toMatchObject({ matcher_value: "a@b.dk" });
  });
});
