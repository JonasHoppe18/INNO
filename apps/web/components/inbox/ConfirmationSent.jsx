"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight, Reply } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConfirmationSent({ children, enabled = true, sentAt = "" }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  if (!enabled) return children;
  const sentDate = new Date(sentAt);
  const validDate = Number.isFinite(sentDate.getTime());
  const timestamp = validDate ? new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen",
  }).format(sentDate) : "";
  const fullTimestamp = validDate ? sentDate.toLocaleString("en-GB", { timeZone: "Europe/Copenhagen" }) : "";
  return (
    <div className="ml-auto w-full max-w-[620px]">
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto flex w-fit gap-2 text-muted-foreground font-normal"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        <Reply className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="shrink-0">Confirmation email sent</span>
        {timestamp ? <time dateTime={sentAt} title={fullTimestamp} className="text-xs tabular-nums">{timestamp}</time> : null}
        {open ? (
          <ChevronDown
            className="size-3.5 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className="size-3.5 shrink-0"
            aria-hidden="true"
          />
        )}
      </Button>
      <div id={contentId} hidden={!open}>
        {open ? children : null}
      </div>
    </div>
  );
}
