export function SentEmailTime({ sentAt }) {
  if (!sentAt) return null;
  const date = new Date(sentAt);
  if (!Number.isFinite(date.getTime())) return null;
  const timestamp = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen",
  }).format(date);
  const fullTimestamp = date.toLocaleString("en-GB", { timeZone: "Europe/Copenhagen" });
  return <time dateTime={sentAt} title={fullTimestamp} className="text-xs tabular-nums">{timestamp}</time>;
}
