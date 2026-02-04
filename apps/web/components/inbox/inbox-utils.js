export function formatMessageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatBytes(value) {
  if (!value || Number.isNaN(Number(value))) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(value);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function getMessageTimestamp(message) {
  return message?.received_at || message?.sent_at || message?.created_at || "";
}

export function getSenderLabel(message) {
  if (message?.from_name) return message.from_name;
  if (message?.from_email) return message.from_email;
  return "Unknown sender";
}

export function isOutboundMessage(message, mailboxEmails = []) {
  if (message?.from_me === true) return true;
  // Any received message is inbound unless explicitly marked as sent by us.
  if (message?.received_at && message?.from_me !== true) return false;
  if (message?.sent_at && !message?.received_at) return true;
  const sender = (message?.from_email || "").toLowerCase();
  if (!sender) return false;
  if (mailboxEmails.length) {
    return mailboxEmails.some((email) => email.toLowerCase() === sender);
  }
  return sender.includes("sona") || sender.includes("support") || sender.includes("hello");
}
