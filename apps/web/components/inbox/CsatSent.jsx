import { MailCheck } from "lucide-react";

export function CsatSent({ event }) {
  if (!event?.sent_at) return null;
  const date = new Date(event.sent_at);
  if (!Number.isFinite(date.getTime())) return null;
  const sentAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Copenhagen",
  }).format(date);
  return (
    <div className="ml-auto flex w-full max-w-[620px] flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm font-normal text-muted-foreground">
      <MailCheck className="size-3.5 shrink-0" aria-hidden="true" />
      <span>CSAT email sent</span>
      <time dateTime={event.sent_at} className="ml-auto text-xs">
        {sentAt}
      </time>
    </div>
  );
}
