import { MailCheck } from "lucide-react";
import { SentEmailTime } from "@/components/inbox/SentEmailTime";

export function CsatSent({ event }) {
  if (!event?.sent_at) return null;
  const date = new Date(event.sent_at);
  if (!Number.isFinite(date.getTime())) return null;
  return (
    <div className="ml-auto flex h-7 w-fit items-center gap-2 px-3 text-sm font-normal text-muted-foreground">
      <MailCheck className="size-3.5 shrink-0" aria-hidden="true" />
      <span>CSAT email sent</span>
      <SentEmailTime sentAt={event.sent_at} />
    </div>
  );
}
