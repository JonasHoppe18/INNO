export function splitActionApprovalOptions({
  decision,
  actionType,
  options,
} = {}) {
  const acceptedOptions =
    decision === "accepted" && options && typeof options === "object"
      ? { ...options }
      : null;
  const shouldResolveAfterApproval =
    decision === "accepted" &&
    String(actionType || "").trim().toLowerCase() === "forward_email" &&
    acceptedOptions?.closeTicket === true;

  if (acceptedOptions) delete acceptedOptions.closeTicket;

  return {
    payloadOverride:
      acceptedOptions && Object.keys(acceptedOptions).length
        ? acceptedOptions
        : null,
    shouldResolveAfterApproval,
  };
}
