const UNKNOWN_SEND_STATUS = "send_status_unknown";

const DELIVERY_ERROR_COPY = {
  recipient_suppressed: {
    kind: "rejected",
    title: "Email couldn't be delivered",
    message:
      "This email address appears not to exist or is no longer accepting mail. Check the recipient address before trying again. The message was not sent.",
  },
  recipient_rejected: {
    kind: "rejected",
    title: "Email couldn't be delivered",
    message:
      "The recipient's mail server rejected this message. Check the recipient address before trying again. The message was not sent.",
  },
  send_failed: {
    kind: "failed",
    title: "Email couldn't be sent",
    message:
      "Sona couldn't send this message. The message was not sent. Please review the error and try again.",
  },
};

const UNKNOWN_SEND_COPY = {
  kind: "unknown",
  title: "Send status unknown",
  message:
    "The send status is unknown. The email provider may have accepted the message. Verify the thread before trying again.",
};

const ACCEPTED_LOCAL_FINALIZATION_COPY = {
  kind: "unknown",
  title: "Email sent, thread update pending",
  message:
    "The email provider accepted the email, but Sona couldn't finish updating the thread locally. Refresh before trying again.",
};

export function getSendErrorPresentation({
  errorCode,
  sendStatus,
  message,
} = {}) {
  const normalizedCode = String(errorCode || "").trim().toLowerCase();
  const normalizedStatus = String(sendStatus || "").trim().toLowerCase();
  const normalizedMessage = String(message || "").trim().toLowerCase();

  if (
    normalizedCode === UNKNOWN_SEND_STATUS ||
    normalizedStatus === "unknown" ||
    normalizedMessage.includes("send status is unknown")
  ) {
    return { ...UNKNOWN_SEND_COPY };
  }

  if (
    normalizedCode === "send_accepted_local_finalize_pending" ||
    (normalizedStatus === "sent" &&
      /email (was )?(accepted|sent)/i.test(String(message || "")))
  ) {
    return { ...ACCEPTED_LOCAL_FINALIZATION_COPY };
  }

  return {
    ...(DELIVERY_ERROR_COPY[normalizedCode] || DELIVERY_ERROR_COPY.send_failed),
  };
}
