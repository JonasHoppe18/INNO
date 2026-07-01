export function shouldTriggerDraftGeneration(options: {
  autoDraftEnabled: boolean;
  isEffectiveSupport: boolean;
  notificationBucket: "ticket" | "notification";
}): boolean {
  return (
    options.autoDraftEnabled &&
    options.isEffectiveSupport &&
    options.notificationBucket !== "notification"
  );
}
