export function isSuppressionEligibleNotificationReason(
  reason: string | null | undefined,
): boolean {
  const value = String(reason || "");
  if (!value) return false;
  if (value.includes("human_support_intent")) return false;
  if (value.includes("carrier_notification_domain")) return true;
  if (value.startsWith("sender_rule_override:")) return true;
  if (value === "manual_move_to_notifications") return true;
  if (value.includes("header:") || value.includes("machine_like_structure")) {
    return true;
  }
  if (
    value.includes("auto_sender_pattern") ||
    value.includes("x-auto-response-suppress") ||
    value.includes("feedback-id")
  ) {
    return true;
  }
  return false;
}

export function shouldTriggerDraftGeneration(options: {
  autoDraftEnabled: boolean;
  isEffectiveSupport: boolean;
  notificationBucket: "ticket" | "notification";
  notificationReason?: string | null;
}): boolean {
  if (!options.autoDraftEnabled || !options.isEffectiveSupport) {
    return false;
  }
  if (options.notificationBucket !== "notification") {
    return true;
  }
  return !isSuppressionEligibleNotificationReason(options.notificationReason);
}
