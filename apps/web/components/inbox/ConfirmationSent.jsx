"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight, Reply } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConfirmationSent({ message, children, enabled = true }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const previewText = String(
    message.clean_body_text || message.body_text || message.snippet || "",
  )
    .replace(/\s+/g, " ")
    .trim();
  const preview = previewText.length > 60 ? `${previewText.slice(0, 60).trimEnd()}…` : previewText;
  if (!enabled) return children;
  return (
    <div className="ml-auto w-full max-w-[620px]">
      <Button
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-start gap-2 py-2 text-muted-foreground font-normal"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        <Reply className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="shrink-0">Confirmation email sent</span>
        <span className="min-w-0 truncate text-left">
          — {preview || message.subject}
        </span>
        {open ? (
          <ChevronDown
            className="ml-auto size-3.5 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className="ml-auto size-3.5 shrink-0"
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
