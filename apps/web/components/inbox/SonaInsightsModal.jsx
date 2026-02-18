import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ActionsTimeline } from "@/components/inbox/ActionsTimeline";
import { CustomerTab } from "@/components/inbox/CustomerTab";
import { X } from "lucide-react";
import { useClerkSupabase } from "@/lib/useClerkSupabase";

const asString = (value) => (typeof value === "string" ? value.trim() : "");

const stripThreadMeta = (value) =>
  String(value || "")
    .replace(/\|?\s*thread_id\s*[:=]\s*[a-z0-9-]+/gi, "")
    .replace(/\s*\|thread_id:[a-z0-9-]+\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const parseLogDetail = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return { detail: "", threadId: null, orderId: null };
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw);
      const detail =
        asString(parsed?.detail) ||
        asString(parsed?.message) ||
        asString(parsed?.summary) ||
        asString(parsed?.text) ||
        asString(parsed?.action) ||
        asString(parsed?.error) ||
        asString(parsed?.reason) ||
        asString(parsed?.status);
      return {
        detail: stripThreadMeta(detail),
        threadId: asString(parsed?.thread_id || parsed?.threadId) || null,
        orderId:
          asString(parsed?.order_id || parsed?.orderId) ||
          (typeof parsed?.orderId === "number" ? String(parsed.orderId) : null),
      };
    } catch {
      return { detail: stripThreadMeta(raw), threadId: null, orderId: null };
    }
  }
  return { detail: stripThreadMeta(raw), threadId: null, orderId: null };
};

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
        .select("id, draft_id, step_name, step_detail, status, created_at")
        .order("created_at", { ascending: false })
        .limit(250);

      if (threadId) {
        if (draftIds.length) {
          const list = draftIds.join(",");
          query = query.or(
            `draft_id.in.(${list}),step_name.eq.shopify_action,step_name.eq.shopify_action_failed,step_name.eq.shopify_action_applied,step_name.eq.shopify_action_declined`
          );
        } else if (draftId) {
          query = query.or(
            `draft_id.eq.${draftId},step_name.eq.shopify_action,step_name.eq.shopify_action_failed,step_name.eq.shopify_action_applied,step_name.eq.shopify_action_declined`
          );
        } else {
          query = query.in("step_name", [
            "shopify_action",
            "shopify_action_failed",
            "shopify_action_applied",
            "shopify_action_declined",
          ]);
        }
      } else if (draftId) {
        query = query.eq("draft_id", draftId);
      }

      const { data, error } = await query;
      if (!active) return;
      if (error) {
        setLogs([]);
      } else {
        const rawLogs = Array.isArray(data) ? data : [];
        if (threadId) {
          const normalizedThread = String(threadId);
          const filtered = rawLogs.filter((log) => {
            if (draftIds.length && draftIds.includes(log?.draft_id)) return true;
            const parsed = parseLogDetail(log?.step_detail);
            return parsed.threadId && String(parsed.threadId) === normalizedThread;
          });
          setLogs(filtered.reverse());
        } else {
          setLogs(rawLogs.reverse());
        }
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
      const raw = String(value || "").toLowerCase();
      if (!raw) return "Activity";
      if (raw === "shopify_lookup") return "Shopify Lookup";
      if (raw === "shopify_action") return "Shopify Action";
      if (raw === "shopify_action_applied") return "Shopify Action Applied";
      if (raw === "shopify_action_declined") return "Shopify Action Declined";
      if (raw === "context") return "Context";
      if (raw === "draft_created") return "Draft Created";
      if (raw === "postmark_inbound_draft_created") return "Draft Created";
      return raw
        .replace(/_/g, " ")
        .replace(/\bpostmark\b/gi, "Postmark")
        .replace(/\bai\b/gi, "AI")
        .replace(/\b\w/g, (char) => char.toUpperCase());
    };
    const formatDetail = (value, name) => {
      if (!value) return "";
      const parsed = parseLogDetail(value);
      const step = String(name || "").toLowerCase();
      if (step === "postmark_inbound_draft_created" || step === "draft_created") {
        return "Forwarded email draft created.";
      }
      if (step === "context") {
        return parsed.detail || "Loaded store context.";
      }
      if (step === "shopify_lookup") {
        return parsed.detail || (parsed.orderId ? `Found order ${parsed.orderId}` : "Order found.");
      }
      if (
        step === "shopify_action" ||
        step === "shopify_action_applied" ||
        step === "shopify_action_declined"
      ) {
        return parsed.detail || (parsed.orderId ? `Order ${parsed.orderId}` : "Shopify action executed.");
      }
      if (parsed.orderId && !parsed.detail) return `Order ${parsed.orderId}`;
      return parsed.detail || "";
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
