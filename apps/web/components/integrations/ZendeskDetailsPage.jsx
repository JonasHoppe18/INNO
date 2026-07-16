"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  TicketCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import zendeskLogo from "../../../../assets/Zendesk_logo.webp";

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(start, end) {
  const startTime = new Date(start || 0).getTime();
  const endTime = new Date(end || 0).getTime();
  if (!startTime || !endTime || endTime < startTime) return "—";
  const totalSeconds = Math.max(0, Math.round((endTime - startTime) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function statusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "completed") return "Completed";
  if (normalized === "running") return "Running";
  if (normalized === "queued") return "Queued";
  if (normalized === "failed") return "Failed";
  return "Not started";
}

function StatusBadge({ status }) {
  const normalized = String(status || "").toLowerCase();
  const variant = normalized === "failed" ? "destructive" : normalized === "completed" ? "default" : "secondary";
  return <Badge variant={variant}>{statusLabel(status)}</Badge>;
}

function DetailRow({ label, children }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/70 py-4 last:border-b-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

export function ZendeskDetailsPage() {
  const [integration, setIntegration] = useState(null);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [estimate, setEstimate] = useState(null);
  const [estimateOpen, setEstimateOpen] = useState(false);
  const importLoopBusyRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoadError("");
    try {
      const [integrationResponse, historyResponse] = await Promise.all([
        fetch("/api/integrations/zendesk", { cache: "no-store" }),
        fetch("/api/knowledge/import-zendesk", { cache: "no-store" }),
      ]);
      const integrationPayload = await integrationResponse.json().catch(() => ({}));
      const historyPayload = await historyResponse.json().catch(() => ({}));
      if (!integrationResponse.ok) {
        throw new Error(integrationPayload?.error || "Could not load Zendesk integration.");
      }
      const nextIntegration = integrationPayload?.integration || null;
      setIntegration(nextIntegration);
      setDomain(nextIntegration?.config?.domain || "");
      setEmail(nextIntegration?.config?.email || "");
      if (historyResponse.ok) setHistory(historyPayload);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load Zendesk integration.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveCredentials = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/integrations/zendesk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, email, api_token: apiToken }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not save Zendesk credentials.");
      setIntegration(payload.integration);
      setDomain(payload.integration?.config?.domain || "");
      setEmail(payload.integration?.config?.email || "");
      setApiToken("");
      setShowToken(false);
      toast.success("Zendesk credentials updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save Zendesk credentials.");
    } finally {
      setSaving(false);
    }
  };

  const refreshHistory = useCallback(async () => {
    const response = await fetch("/api/knowledge/import-zendesk", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) setHistory(payload);
    return payload;
  }, []);

  const runContinueLoop = useCallback(async (jobId) => {
    if (!jobId || importLoopBusyRef.current) return;
    importLoopBusyRef.current = true;
    setHistoryBusy(true);
    setHistoryError("");
    // Gateway timeouts are expected here: a chunk can outlive the reverse
    // proxy's timeout (Zendesk 429 retry sleeps), in which case nginx returns
    // 502/504 with an HTML body while the server KEEPS processing the chunk
    // and finishes it (verified in prod). Those responses carry no JSON
    // `error` field — treat them as transient: wait, then re-enter the loop.
    // The cursor lease answers 409 "job busy" until the in-flight chunk is
    // done, which serializes us safely. Real route errors always carry a JSON
    // `error` field and keep their existing fatal/retryable handling.
    let transientRetries = 0;
    const MAX_TRANSIENT_RETRIES = 30;
    try {
      while (true) {
        let response = null;
        try {
          response = await fetch("/api/knowledge/import-zendesk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "continue", jobId }),
          });
        } catch {
          response = null; // network hiccup — handled as transient below
        }
        const payload = response ? await response.json().catch(() => ({})) : {};
        const isTransient = !response || (!response.ok && payload?.error == null);
        if (isTransient) {
          transientRetries += 1;
          if (transientRetries > MAX_TRANSIENT_RETRIES) {
            throw new Error(
              "The import connection keeps timing out. The job is paused and can be continued safely.",
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 10000));
          continue;
        }
        transientRetries = 0;
        if (response.status === 409 && payload?.job) {
          setHistory((current) => ({ ...(current || {}), last_job: payload.job }));
          await new Promise((resolve) => setTimeout(resolve, Number(payload?.retry_after_ms) || 1500));
          continue;
        }
        if (!response.ok) {
          if (payload?.job) {
            setHistory((current) => ({ ...(current || {}), last_job: payload.job }));
          }
          const detail = payload?.error || "Zendesk history import failed.";
          throw new Error(payload?.retryable ? `${detail} The import is paused and can be continued safely.` : detail);
        }
        const job = payload?.job;
        setHistory((current) => ({ ...(current || {}), last_job: job }));
        if (job?.status === "completed") {
          await refreshHistory();
          toast.success("Zendesk history import completed.");
          return;
        }
        if (job?.status === "failed") {
          throw new Error(job?.last_error || "Zendesk history import failed.");
        }
      }
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Zendesk history import failed.");
      await refreshHistory();
    } finally {
      importLoopBusyRef.current = false;
      setHistoryBusy(false);
    }
  }, [refreshHistory]);

  const estimateImport = async () => {
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const response = await fetch("/api/knowledge/import-zendesk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "estimate" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not estimate import cost.");
      setEstimate(payload?.estimate || null);
      setEstimateOpen(true);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Could not estimate import cost.");
    } finally {
      setHistoryBusy(false);
    }
  };

  const startImport = async () => {
    setEstimateOpen(false);
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const response = await fetch("/api/knowledge/import-zendesk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "start", confirm: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 409) {
        throw new Error(payload?.error || "Could not start Zendesk history import.");
      }
      const job = payload?.job;
      setHistory((current) => ({ ...(current || {}), last_job: job }));
      setHistoryBusy(false);
      if (job?.status === "running") await runContinueLoop(job.id);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Could not start Zendesk history import.");
      setHistoryBusy(false);
    }
  };

  if (loading) return <LoadingState />;

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Couldn&apos;t load Zendesk</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button type="button" variant="outline" onClick={loadData}>
            <RefreshCw data-icon="inline-start" />
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!integration) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Zendesk isn&apos;t connected</CardTitle>
          <CardDescription>Connect Zendesk from the integrations page before viewing details.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <Link href="/integrations">Back to integrations</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const job = history?.last_job || null;
  const connected = Boolean(integration.is_active);
  const website = integration?.config?.domain || "";
  const websiteHref = website && /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : "";

  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild aria-label="Back to integrations">
            <Link href="/integrations"><ArrowLeft /></Link>
          </Button>
          <div className="flex size-12 items-center justify-center rounded-xl border bg-card">
            <Image src={zendeskLogo} alt="Zendesk logo" width={34} height={34} className="object-contain" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Zendesk</h1>
            <p className="mt-1 text-sm text-muted-foreground">Connection, credentials and ticket history.</p>
          </div>
        </div>
        <Badge variant={connected ? "default" : "secondary"} className="w-fit gap-1.5">
          <CheckCircle2 />
          {connected ? "Connected" : "Inactive"}
        </Badge>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <form onSubmit={saveCredentials}>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <CardTitle>Credentials</CardTitle>
                <CardDescription>Update how Sona authenticates with Zendesk.</CardDescription>
              </div>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="zendesk-details-email">Agent email</Label>
                <Input
                  id="zendesk-details-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="zendesk-details-token">API token</Label>
                <div className="flex gap-2">
                  <Input
                    id="zendesk-details-token"
                    type={showToken ? "text" : "password"}
                    value={apiToken}
                    onChange={(event) => setApiToken(event.target.value)}
                    placeholder={integration.has_api_token ? "Saved — enter a new token to replace" : "Enter API token"}
                    autoComplete="new-password"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowToken((current) => !current)}
                    aria-label={showToken ? "Hide API token" : "Show API token"}
                    disabled={!apiToken}
                  >
                    {showToken ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  For security, the saved token can be replaced but never revealed.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="zendesk-details-domain">Zendesk URL</Label>
                <Input
                  id="zendesk-details-domain"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  placeholder="your-company.zendesk.com"
                  autoComplete="url"
                  required
                />
              </div>
            </CardContent>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integration details</CardTitle>
            <CardDescription>Connection metadata for this workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label="Integration ID"><span className="font-mono text-xs">{integration.id}</span></DetailRow>
              <DetailRow label="Status">
                <Badge variant={connected ? "default" : "secondary"}>{connected ? "Connected" : "Inactive"}</Badge>
              </DetailRow>
              <DetailRow label="Connected">{formatDateTime(integration.created_at)}</DetailRow>
              <DetailRow label="Last updated">{formatDateTime(integration.updated_at)}</DetailRow>
              <DetailRow label="Website">
                {website ? (
                  <a href={websiteHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                    {website}<ExternalLink className="size-3.5" />
                  </a>
                ) : "—"}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Sync progress</h2>
          <p className="mt-1 text-sm text-muted-foreground">Track the one-time import of historical Zendesk tickets.</p>
        </div>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <TicketCheck />
              </div>
              <div className="flex flex-col gap-1">
                <CardTitle className="text-base">Tickets</CardTitle>
                <CardDescription>
                  {job ? `Started ${formatDateTime(job.created_at)}` : "No full-history import has been started."}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={job?.status} />
              {job ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock3 className="size-3.5" />{formatDuration(job.created_at, job.updated_at)}
                </span>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-3 rounded-lg bg-muted/40 p-4 sm:grid-cols-5">
              {[
                ["Imported", job?.imported_count ?? history?.imported_examples ?? 0],
                ["Refreshed", job?.updated_count ?? 0],
                ["Skipped", job?.skipped_count ?? 0],
                ["Dropped", job?.dropped_count ?? 0],
                ["Total", job?.total_count ?? 0],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
                </div>
              ))}
            </div>
            {job?.last_error || historyError ? (
              <p role="alert" className="text-sm text-destructive">{historyError || job.last_error}</p>
            ) : null}
          </CardContent>

          <CardFooter className="justify-end border-t border-border pt-5">
            {job?.status === "running" ? (
              <Button type="button" variant="outline" onClick={() => runContinueLoop(job.id)} disabled={historyBusy}>
                {historyBusy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}
                {historyBusy ? "Importing…" : "Continue import"}
              </Button>
            ) : (
              <Button type="button" onClick={estimateImport} disabled={historyBusy}>
                {historyBusy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <KeyRound data-icon="inline-start" />}
                {historyBusy ? "Checking…" : "Import full history"}
              </Button>
            )}
          </CardFooter>
        </Card>
      </section>

      <Dialog open={estimateOpen} onOpenChange={setEstimateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import full ticket history?</DialogTitle>
            <DialogDescription>
              {estimate
                ? `${estimate.ticketCount} tickets found in Zendesk. Tickets are imported in small batches, and you can safely resume later if you leave this page.`
                : "Review the estimated import before continuing."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEstimateOpen(false)}>Cancel</Button>
            <Button type="button" onClick={startImport}>Start import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
