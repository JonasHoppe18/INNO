"use client";

import { useState } from "react";
import { ChevronRight, MailCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SentEmailTime } from "@/components/inbox/SentEmailTime";

function LoadingPreview() {
  return (
    <div className="mx-auto w-full max-w-[640px] space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
      <div className="h-5 w-2/3 animate-pulse rounded-full bg-muted" />
      <div className="h-24 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export function CsatSent({ event, threadId }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  if (!event?.sent_at) return null;
  const date = new Date(event.sent_at);
  if (!Number.isFinite(date.getTime())) return null;

  const loadPreview = async () => {
    setOpen(true);
    if (preview?.eventId === event.id) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/inbox/threads/${encodeURIComponent(threadId || "")}/csat-preview`,
        { headers: { Accept: "application/json" } },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not load the CSAT email.");
      setPreview({ ...payload, eventId: event.id });
    } catch (loadError) {
      setError(loadError?.message || "Could not load the CSAT email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto flex w-fit font-normal text-muted-foreground focus-visible:ring-offset-conversation"
        aria-label="Open sent CSAT email"
        title="Open sent CSAT email"
        onClick={loadPreview}
      >
        <MailCheck className="size-3.5 shrink-0" aria-hidden="true" />
        <span>CSAT email sent</span>
        <SentEmailTime sentAt={event.sent_at} />
        <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(760px,88vh)] w-[min(92vw,720px)] max-w-none flex-col gap-0 overflow-hidden border-border bg-card p-0">
          <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <MailCheck className="size-4 text-muted-foreground" aria-hidden="true" />
              CSAT email sent
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2 text-xs">
              {preview?.recipient ? <span className="truncate">To: {preview.recipient}</span> : null}
              <SentEmailTime sentAt={preview?.sent_at || event.sent_at} />
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-muted/35 p-4 sm:p-5">
            {loading ? <LoadingPreview /> : null}
            {!loading && error ? (
              <div className="mx-auto max-w-[640px] rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}
            {!loading && !error && preview?.html ? (
              <iframe
                title="Sent CSAT email preview"
                srcDoc={preview.html}
                className="mx-auto block min-h-[560px] w-full max-w-[640px] border-0 bg-white shadow-sm"
                sandbox="allow-same-origin"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
