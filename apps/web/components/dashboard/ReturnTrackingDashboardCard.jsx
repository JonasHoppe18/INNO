"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2Icon, PackageMinusIcon, TicketIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildTrackingTimeline } from "@/components/inbox/tracking-utils";

function returnTrackingStatusLabel(status) {
  const labels = {
    return_tracking_pending: "Pending",
    return_in_transit: "In transit",
    return_delivered: "Delivered",
    return_exception: "Exception",
    refund_pending: "Refund pending",
    refund_completed: "Refund completed",
    unknown: "Unknown",
  };
  return labels[status] ?? "Pending";
}

function formatTimeAgo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function normalizeLiveStatus(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower.includes("delivered") || lower.includes("leveret")) return "Delivered";
  if (lower.includes("out for delivery")) return "Out for delivery";
  if (lower.includes("pickup")) return "Ready for pickup";
  if (lower.includes("transit") || lower.includes("shipped")) return "In transit";
  if (lower.includes("exception") || lower.includes("failed") || lower.includes("delay")) return "Exception";
  return text;
}

function statusTone(status = "") {
  const lower = String(status || "").toLowerCase();
  if (lower.includes("delivered")) return "text-emerald-700 dark:text-emerald-400 bg-emerald-500";
  if (lower.includes("exception") || lower.includes("failed") || lower.includes("delay")) return "text-red-700 dark:text-red-400 bg-red-500";
  if (lower.includes("pickup")) return "text-violet-700 dark:text-violet-400 bg-violet-500";
  if (lower.includes("transit") || lower.includes("delivery")) return "text-blue-700 dark:text-blue-400 bg-blue-500";
  return "text-muted-foreground bg-slate-400";
}

function latestCheckpoint(detail) {
  const events = Array.isArray(detail?.snapshot?.events) ? detail.snapshot.events : [];
  const latest = [...events].sort((a, b) => {
    const aTs = a?.occurredAt ? Date.parse(a.occurredAt) : 0;
    const bTs = b?.occurredAt ? Date.parse(b.occurredAt) : 0;
    return bTs - aTs;
  })[0];
  const description = String(latest?.description || latest?.code || detail?.snapshot?.lastEvent?.description || "").trim();
  const location = String(latest?.location || detail?.snapshot?.lastEvent?.location || "").trim();
  if (description && location) return `${description} · ${location}`;
  return description || location || "";
}

function ticketHref(threadId) {
  const id = String(threadId || "").trim();
  return id ? `/inbox/tickets?thread=${encodeURIComponent(id)}` : "/inbox/tickets";
}

function buildCarrierTrackingUrl({ carrier = "", trackingNumber = "", trackingUrl = "" } = {}) {
  const directUrl = String(trackingUrl || "").trim();
  if (directUrl) return directUrl;
  const number = String(trackingNumber || "").trim();
  if (!number) return "";
  const encoded = encodeURIComponent(number);
  const lower = String(carrier || "").toLowerCase();
  if (lower.includes("bring")) return `https://www.bring.com/tracking?trackingNumber=${encoded}`;
  if (lower.includes("gls")) return `https://gls-group.com/DK/da/pakkesporing?match=${encoded}`;
  if (lower.includes("postnord")) return `https://www.postnord.dk/varktojer/track-trace?shipmentId=${encoded}`;
  if (lower.includes("dhl")) return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encoded}`;
  return "";
}

function DetailRow({ label, value }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{value || "—"}</dd>
    </div>
  );
}

function buildReturnTrackingTimeline(ret, live) {
  if (live?.detail?.snapshot) {
    return buildTrackingTimeline({
      logs: [
        {
          id: `return-live-${ret?.id || "tracking"}`,
          step_name: "carrier_tracking",
          step_detail: JSON.stringify({
            carrier: live.detail.carrier || ret?.carrier || "",
            status: live.detail.statusText || live.detail.status || live.status || "",
            snapshot: live.detail.snapshot,
          }),
          created_at: new Date().toISOString(),
        },
      ],
      order: {
        orderNumber: ret?.order_number || "",
        tracking: {
          number: ret?.tracking_number || "",
          company: ret?.carrier || "",
          status: live?.status || "",
        },
      },
    });
  }

  if (live?.checkpoint || live?.error || ret?.suggested_action) {
    return [
      {
        id: `return-fallback-${ret?.id || "tracking"}`,
        title: live?.checkpoint || live?.error || ret?.suggested_action,
        meta: ret?.carrier || "",
        isCurrent: true,
      },
    ];
  }

  return [];
}

function TimelineDot({ current }) {
  return (
    <div
      className={`size-2.5 rounded-full ${
        current ? "bg-violet-500 ring-4 ring-violet-500/15" : "bg-border"
      }`}
    />
  );
}

function ReturnTrackingRow({ ret, live, dense = false, onOpen }) {
  const ticketNumber = ret.mail_threads?.ticket_number
    ? `#${ret.mail_threads.ticket_number}`
    : ret.mail_thread_id?.slice(0, 8);
  const customer = ret.customer_name || ret.customer_email || "Unknown customer";
  const displayStatus = live.status || returnTrackingStatusLabel(ret.status);
  const tone = statusTone(displayStatus);
  const href = ticketHref(ret.mail_thread_id);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(ret)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(ret);
        }
      }}
      className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${dense ? "py-3" : "py-2.5"} first:pt-0 last:pb-0`}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
        <PackageMinusIcon className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{customer}</p>
        <p className="truncate text-xs text-muted-foreground">
          {ret.order_number || "No order linked"} · {ret.carrier || "Carrier unknown"} · {ret.tracking_number}
        </p>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {live.loading ? "Checking live tracking..." : live.checkpoint || live.error || ret.suggested_action || "Review return tracking"}
          </p>
          {ret.mail_thread_id ? (
            <Link
              href={href}
              onClick={(event) => event.stopPropagation()}
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              <TicketIcon className="size-3" />
              Open ticket
            </Link>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`flex items-center gap-1 text-xs ${tone.split(" ").slice(0, 2).join(" ")}`}>
          {live.loading ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <span className={`size-1.5 rounded-full ${tone.split(" ").at(-1)}`} />
          )}
          {displayStatus}
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">{ticketNumber}</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">{formatTimeAgo(ret.created_at)}</span>
      </div>
    </div>
  );
}

export function ReturnTrackingDashboardCard({ rows = [] }) {
  const returnTrackingRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);
  const [liveById, setLiveById] = useState({});
  const [allOpen, setAllOpen] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const previewRows = useMemo(() => returnTrackingRows.slice(0, 5), [returnTrackingRows]);
  const selectedLive = selectedReturn ? liveById[selectedReturn.id] || {} : {};
  const selectedStatus = selectedReturn ? selectedLive.status || returnTrackingStatusLabel(selectedReturn.status) : "";
  const selectedTrackingUrl = selectedReturn
    ? buildCarrierTrackingUrl({
        carrier: selectedReturn.carrier,
        trackingNumber: selectedReturn.tracking_number,
        trackingUrl: selectedReturn.tracking_url,
      })
    : "";
  const selectedTimeline = selectedReturn ? buildReturnTrackingTimeline(selectedReturn, selectedLive) : [];

  const lookupRows = useMemo(
    () => returnTrackingRows.filter((row) => row?.mail_thread_id && row?.tracking_number).slice(0, 25),
    [returnTrackingRows],
  );

  const openReturnDetail = (ret) => {
    setAllOpen(false);
    setSelectedReturn(ret);
  };

  useEffect(() => {
    let active = true;
    if (!lookupRows.length) {
      setLiveById({});
      return undefined;
    }

    setLiveById((current) => {
      const next = { ...current };
      for (const row of lookupRows) {
        if (!next[row.id]) next[row.id] = { loading: true };
      }
      return next;
    });

    const run = async () => {
      await Promise.all(lookupRows.map(async (row) => {
        const params = new URLSearchParams({ trackingNumber: row.tracking_number });
        if (row.carrier) params.set("company", row.carrier);
        const response = await fetch(
          `/api/threads/${encodeURIComponent(row.mail_thread_id)}/tracking/refresh?${params.toString()}`
        ).catch(() => null);
        const body = await response?.json?.().catch(() => ({}));
        if (!active) return;
        if (response?.ok && body?.detail) {
          const status = normalizeLiveStatus(body.detail.statusText || body.detail.status || "");
          setLiveById((current) => ({
            ...current,
            [row.id]: {
              loading: false,
              status: status || "Unknown",
              checkpoint: latestCheckpoint(body.detail),
              detail: body.detail,
            },
          }));
          return;
        }
        setLiveById((current) => ({
          ...current,
          [row.id]: {
            loading: false,
            status: "",
            checkpoint: "",
            error: body?.error || "Live status unavailable",
          },
        }));
      }));
    };
    run();
    return () => {
      active = false;
    };
  }, [lookupRows]);

  return (
    <Card className={`min-h-[340px] rounded-xl shadow-sm ${returnTrackingRows.length > 0 ? "border-violet-500/20" : ""}`}>
      <CardHeader className="p-5 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">Returns on the way back</CardTitle>
            <CardDescription>Customer-provided return tracking awaiting review</CardDescription>
          </div>
          {returnTrackingRows.length > 0 && (
            <button
              type="button"
              onClick={() => setAllOpen(true)}
              className="shrink-0 text-xs font-medium text-indigo-600 underline-offset-2 transition-colors hover:text-indigo-700 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              View all
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        {returnTrackingRows.length === 0 ? (
          <div className="flex min-h-[210px] items-center justify-center rounded-xl border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">No return tracking rows yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {previewRows.map((ret) => (
              <ReturnTrackingRow key={ret.id} ret={ret} live={liveById[ret.id] || {}} onOpen={openReturnDetail} />
            ))}
          </div>
        )}
      </CardContent>
      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="max-h-[82vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Returns on the way back</DialogTitle>
            <DialogDescription>
              All customer-provided return tracking rows awaiting review.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[58vh] overflow-y-auto pr-1">
            {returnTrackingRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No return tracking rows yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {returnTrackingRows.map((ret) => (
                  <ReturnTrackingRow key={ret.id} ret={ret} live={liveById[ret.id] || {}} dense onOpen={openReturnDetail} />
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => setAllOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(selectedReturn)} onOpenChange={(open) => !open && setSelectedReturn(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Return tracking</DialogTitle>
            <DialogDescription>
              Live tracking details for the selected return.
            </DialogDescription>
          </DialogHeader>
          {selectedReturn ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {selectedReturn.customer_name || selectedReturn.customer_email || "Unknown customer"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedReturn.order_number || "No order linked"} · {selectedReturn.carrier || "Carrier unknown"}
                    </p>
                  </div>
                  <span className={`flex shrink-0 items-center gap-1 text-xs ${statusTone(selectedStatus).split(" ").slice(0, 2).join(" ")}`}>
                    {selectedLive.loading ? (
                      <Loader2Icon className="size-3 animate-spin" />
                    ) : (
                      <span className={`size-1.5 rounded-full ${statusTone(selectedStatus).split(" ").at(-1)}`} />
                    )}
                    {selectedStatus || "Unknown"}
                  </span>
                </div>
              </div>

              <dl className="flex flex-col gap-3">
                <DetailRow label="Tracking number" value={selectedReturn.tracking_number} />
                <DetailRow label="Carrier" value={selectedReturn.carrier} />
                <DetailRow label="Latest update" value={selectedLive.loading ? "Checking live tracking..." : selectedLive.checkpoint || selectedLive.error || selectedReturn.suggested_action} />
                <DetailRow label="Ticket" value={selectedReturn.mail_threads?.ticket_number ? `#${selectedReturn.mail_threads.ticket_number}` : selectedReturn.mail_thread_id} />
                <DetailRow label="Created" value={formatTimeAgo(selectedReturn.created_at)} />
              </dl>

              <div className="border-t pt-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Tracking events
                </p>
                {selectedLive.loading ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    Loading tracking events...
                  </div>
                ) : selectedTimeline.length ? (
                  <div>
                    {selectedTimeline.map((event, index) => (
                      <div key={event.id} className="flex gap-3">
                        <div className="flex w-5 flex-col items-center pt-1">
                          <TimelineDot current={event.isCurrent} />
                          {index < selectedTimeline.length - 1 ? (
                            <div className="mt-1 min-h-5 w-px flex-1 bg-border" />
                          ) : null}
                        </div>
                        <div className="min-w-0 pb-4">
                          <p className={`text-sm font-medium ${event.isCurrent ? "text-foreground" : "text-muted-foreground"}`}>
                            {event.title}
                          </p>
                          {event.meta ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">{event.meta}</p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-3 text-sm text-muted-foreground">No tracking events available.</p>
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                {selectedReturn.mail_thread_id ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={ticketHref(selectedReturn.mail_thread_id)}>Open ticket</Link>
                  </Button>
                ) : null}
                {selectedTrackingUrl ? (
                  <Button size="sm" asChild>
                    <a href={selectedTrackingUrl} target="_blank" rel="noreferrer">
                      Open carrier tracking
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
