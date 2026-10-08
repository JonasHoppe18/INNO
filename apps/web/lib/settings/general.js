import { normalizeSupportLanguage } from "@/lib/translation/languages";
import { DEFAULT_STALE_DAYS, normalizeStaleDays } from "@/lib/inbox/stale-days";
import { resourcePayload } from "@/lib/settings/resource-map";

export const normalizeAutoCloseMode = (value, fallback = "approve") =>
  value === "auto" ? "auto" : fallback === "auto" ? "auto" : "approve";

export function initialGeneralState(workspace, resources) {
  const workspaceId = workspace?.workspaceId || null;
  const teamName = String(workspace?.workspaceName || "").trim() || "Sona Team";
  const testModePayload = workspaceId ? resourcePayload(resources, "/api/settings/test-mode") : null;
  if (!testModePayload) {
    return {
      teamName,
      testMode: false,
      testEmail: "",
      supportLanguage: workspaceId ? normalizeSupportLanguage(workspace?.supportLanguage || "en") : "en",
      autoCloseMode: "approve",
      needsAttentionStaleDays: String(DEFAULT_STALE_DAYS),
    };
  }
  return {
    teamName,
    testMode: Boolean(testModePayload.test_mode),
    testEmail: String(testModePayload.test_email || "").trim(),
    supportLanguage: normalizeSupportLanguage(testModePayload.support_language || "en"),
    autoCloseMode: normalizeAutoCloseMode(testModePayload.auto_close_mode),
    needsAttentionStaleDays: String(normalizeStaleDays(testModePayload.needs_attention_stale_days)),
  };
}
