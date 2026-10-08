import { describe, expect, it } from "vitest";
import { initialGeneralState, normalizeAutoCloseMode } from "../general";
import { DEFAULT_STALE_DAYS } from "@/lib/inbox/stale-days";

const workspace = { workspaceId: "w1", workspaceName: "Acme", supportLanguage: "da" };

describe("initialGeneralState", () => {
  it("uses test-mode settings when available", () => {
    const resources = { "/api/settings/test-mode": { ok: true, status: 200, payload: {
      test_mode: true, test_email: " t@x.dk ", support_language: "de", auto_close_mode: "auto", needs_attention_stale_days: 7,
    } } };
    expect(initialGeneralState(workspace, resources)).toEqual({
      teamName: "Acme", testMode: true, testEmail: "t@x.dk", supportLanguage: "de", autoCloseMode: "auto", needsAttentionStaleDays: "7",
    });
  });

  it("falls back to workspace language and defaults without test-mode settings", () => {
    expect(initialGeneralState(workspace, {})).toEqual({
      teamName: "Acme", testMode: false, testEmail: "", supportLanguage: "da", autoCloseMode: "approve", needsAttentionStaleDays: String(DEFAULT_STALE_DAYS),
    });
  });

  it("uses English and Sona Team without a workspace", () => {
    expect(initialGeneralState({ workspaceId: null, workspaceName: "" }, {})).toMatchObject({ teamName: "Sona Team", supportLanguage: "en" });
  });

  it("normalizes auto-close mode", () => {
    expect(normalizeAutoCloseMode("auto")).toBe("auto");
    expect(normalizeAutoCloseMode("x")).toBe("approve");
    expect(normalizeAutoCloseMode(undefined, "auto")).toBe("auto");
  });
});
