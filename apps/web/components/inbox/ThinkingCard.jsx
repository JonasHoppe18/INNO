import { SonaLogo } from "@/components/ui/SonaLogo";
import { cn } from "@/lib/utils";
const stripThreadSuffix = (value) =>
  String(value || "").replace(/\s*\|thread_id:[a-z0-9-]+\s*/i, "").trim();

const normalizeText = (value) =>
  String(value || "").replace(/\s+/g, " ").trim();

const resolveCardText = (data) => {
  if (!data) return "";
  const detail = normalizeText(
    data?.text || data?.summary || data?.detail || data?.message || ""
  );
  const lower = detail.toLowerCase();
  const type = String(data?.type || data?.kind || data?.step_name || "").toLowerCase();

  const isLookup =
    type.includes("lookup") ||
    lower.includes("verified order") ||
    lower.includes("found order");
  if (isLookup) {
    return detail || "Verified order details.";
  }

  const isAction =
    type.includes("action") ||
    lower.startsWith("updated shipping address") ||
    lower.startsWith("updated address");
  if (isAction) {
    const cleaned = detail
      .replace(/^updated shipping address to\s*/i, "")
      .replace(/^updated address to\s*/i, "")
      .trim();
    return cleaned ? `✅ Updated shipping address to: ${cleaned}` : "✅ Updated shipping address.";
  }

  return detail || "Analyzed request using Store Policies.";
};

export function ThinkingCard({ data, onClick, loading = false }) {
  if (!data && !loading) return null;

  const cleanedDetail = stripThreadSuffix(
    data?.detail || data?.summary || data?.text || data?.message || ""
  );
  const cardText = resolveCardText({ ...data, detail: cleanedDetail });
  const displayText = loading ? "Thinking..." : cardText;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center text-left transition",
        loading
          ? "gap-2 rounded-md p-1"
          : "gap-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 hover:border-indigo-200 hover:bg-indigo-50/70"
      )}
    >
      <div className={cn("rounded-full", loading ? "p-1" : "bg-white/70 p-1.5")}>
        <SonaLogo size={20} speed="working" />
      </div>
      <div className="text-sm font-medium text-indigo-900">
        {displayText}
      </div>
    </button>
  );
}
