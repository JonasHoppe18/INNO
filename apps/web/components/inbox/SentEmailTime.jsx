import { formatFullDateTime, formatTime } from "@/lib/format/datetime";
export function SentEmailTime({ sentAt }) {
  if (!sentAt) return null;
  const date = new Date(sentAt);
  if (!Number.isFinite(date.getTime())) return null;
  const timestamp = formatTime(date);
  const fullTimestamp = formatFullDateTime(date);
  return <time dateTime={sentAt} title={fullTimestamp} className="text-xs tabular-nums">{timestamp}</time>;
}
