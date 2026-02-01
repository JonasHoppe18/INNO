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
      if (!supabase || !open || !draftId) {
        setLogs([]);
        setLogsLoading(false);
        return;
      }
      setLogsLoading(true);
      const { data, error } = await supabase
        .from("agent_logs")
        .select("id, step_name, step_detail, status, created_at")
        .eq("draft_id", draftId)
        .order("created_at", { ascending: true });
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
  }, [draftId, open, supabase]);

  const timelineItems = useMemo(() => {
    return logs.map((log) => ({
      id: String(log.id),
      title: log.step_name,
      statusLabel: log.step_detail,
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
              {logsLoading ? (
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
