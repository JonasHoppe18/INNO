import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ActionsTimeline } from "@/components/inbox/ActionsTimeline";
import { CustomerTab } from "@/components/inbox/CustomerTab";
import { X } from "lucide-react";
import { useClerkSupabase } from "@/lib/useClerkSupabase";

export function SonaInsightsModal({
  open,
  onOpenChange,
  actions,
  draftId,
  threadId,
  draftLoading = false,
  customerLookup,
  customerLookupLoading,
  customerLookupError,
  onCustomerRefresh,
}) {
  const supabase = useClerkSupabase();
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchLogs = async () => {
      if (!supabase || !open || (!draftId && !threadId)) {
        setLogs([]);
        setLogsLoading(false);
        return;
      }
      setLogsLoading(true);
      let draftIds = [];
      if (threadId) {
        const { data: draftRows, error: draftError } = await supabase
          .from("drafts")
          .select("id")
          .eq("thread_id", threadId)
          .order("created_at", { ascending: true });
        if (!draftError) {
          draftIds = (draftRows || []).map((row) => row.id).filter(Boolean);
        }
      }

      let query = supabase
        .from("agent_logs")
        .select("id, step_name, step_detail, status, created_at")
        .order("created_at", { ascending: true });

      if (threadId) {
        const safeThread = String(threadId).replace(/%/g, "\\%").replace(/_/g, "\\_");
        if (draftIds.length) {
          const list = draftIds.join(",");
          query = query.or(`draft_id.in.(${list}),step_detail.ilike.%thread_id:${safeThread}%`);
        } else if (draftId) {
          query = query.or(`draft_id.eq.${draftId},step_detail.ilike.%thread_id:${safeThread}%`);
        } else {
          query = query.ilike("step_detail", `%thread_id:${safeThread}%`);
        }
      } else if (draftId) {
        query = query.eq("draft_id", draftId);
      }

      const { data, error } = await query;
      if (!active) return;
      if (error) {
        setLogs([]);
      } else {
        setLogs(Array.isArray(data) ? data : []);
      }
      setLogsLoading(false);
    };
    fetchLogs();
    return () => {
      active = false;
    };
  }, [draftId, open, supabase, threadId]);

  const timelineItems = useMemo(() => {
    const formatTitle = (value) => {
      const raw = String(value || "");
      if (!raw) return "Activity";
      return raw
        .replace(/_/g, " ")
        .replace(/\bpostmark\b/gi, "Postmark")
        .replace(/\bai\b/gi, "AI")
        .replace(/\b\w/g, (char) => char.toUpperCase());
    };
    const formatDetail = (value, name) => {
      if (!value) return "";
      const raw = String(value);
      const stripped = raw.replace(/\s*\|thread_id:[a-z0-9-]+\s*/i, "").trim();
      if (stripped.trim().startsWith("{") && stripped.trim().endsWith("}")) {
        try {
          const parsed = JSON.parse(stripped);
          if (name === "postmark_inbound_draft_created") {
            return "Forwarded email draft created.";
          }
          if (parsed?.orderId) {
            return `Order ${parsed.orderId}`;
          }
          return "";
        } catch {
          return stripped;
        }
      }
      if (name === "postmark_inbound_draft_created") {
        return "Forwarded email draft created.";
      }
      return stripped;
    };
    return logs.map((log) => ({
      id: String(log.id),
      title: formatTitle(log.step_name),
      statusLabel: formatDetail(log.step_detail, log.step_name),
      timestamp: new Date(log.created_at).toLocaleTimeString("da-DK", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: log.status,
    }));
  }, [logs]);

  return (
    <aside
      className={`flex h-full flex-none flex-col border-l border-gray-200 bg-background transition-[width] duration-200 ease-linear ${
        open ? "w-[360px]" : "w-0"
      }`}
      aria-hidden={!open}
    >
      <div className={`flex h-full flex-col gap-4 overflow-hidden ${open ? "p-4" : "p-0"}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sona Insights</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Close insights"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Tabs defaultValue="actions" className="flex flex-1 flex-col gap-4 overflow-hidden">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="actions">Sona Actions</TabsTrigger>
            <TabsTrigger value="customer">Customer</TabsTrigger>
          </TabsList>
          <TabsContent value="actions" className="flex-1 overflow-y-auto">
            <div className="rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50/50 to-white p-4">
              {logsLoading || (draftLoading && !timelineItems.length) ? (
                <div className="text-sm text-slate-500">Loading investigation data…</div>
              ) : timelineItems.length ? (
                <ActionsTimeline items={timelineItems} />
              ) : (
                <div className="text-sm text-slate-500">No investigation data available.</div>
              )}
            </div>
          </TabsContent>
          <TabsContent value="customer" className="flex-1 overflow-y-auto">
            <CustomerTab
              data={customerLookup}
              loading={customerLookupLoading}
              error={customerLookupError}
              onRefresh={onCustomerRefresh}
            />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}
