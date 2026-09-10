import { ChevronRight } from "lucide-react";
import { SonaLogo } from "@/components/ui/SonaLogo";
import { cn } from "@/lib/utils";

const stripThreadSuffix = (value) =>
  String(value || "").replace(/\s*\|thread_id:[a-z0-9-]+\s*/i, "").trim();

const normalizeText = (value) =>
  stripThreadSuffix(String(value || "").replace(/\s+/g, " ").trim());

const STEP_LABELS = {
  draft_intent_assessed: "Identified intent",
  draft_context_loaded: "Loaded context",
  retrieval_completed: "Read knowledge base",
  knowledge_gap_detected: "Found knowledge gap",
  draft_created: "Built draft",
  carrier_tracking: "Checked shipment tracking",
  "carrier tracking": "Checked shipment tracking",
  "shopify lookup": "Looked up Shopify data",
  "product search": "Searched products",
  context: "Loaded context",
};

const humanizeStepName = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (STEP_LABELS[normalized]) return STEP_LABELS[normalized];
  const readable = normalized
    .replace(/^(draft|ai|sona)_/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return readable || "Completed a step";
};

const parseStepDetail = (value) => {
  if (value && typeof value === "object") return value;
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const humanizeValue = (value) => {
  const text = normalizeText(value);
  if (!text) return "";
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const getDetailText = (detail) => {
  const parsed = parseStepDetail(detail);
  if (!parsed) return "";
  if (typeof parsed === "string") return normalizeText(parsed);

  const directValue = [
    parsed.detail,
    parsed.summary,
    parsed.title,
    parsed.message,
    parsed.reason,
    parsed.status,
  ].find((value) => typeof value === "string" && value.trim());
  if (directValue) return normalizeText(directValue);

  const orderNumber = parsed.order_number || parsed.orderNumber;
  if (orderNumber) return `#${String(orderNumber).replace(/^#/, "")}`;

  const intent = parsed.primary_intent || parsed.intent;
  if (intent) return humanizeValue(intent);

  const sources = parsed.kb_chunks || parsed.knowledge_sources || parsed.sources;
  if (Array.isArray(sources) && sources.length) {
    const firstSource = sources[0];
    const sourceTitle =
      typeof firstSource === "string"
        ? firstSource
        : firstSource?.title || firstSource?.name || firstSource?.label;
    if (sourceTitle) {
      const remainder = sources.length - 1;
      return remainder > 0
        ? `${normalizeText(sourceTitle)} + ${remainder} more`
        : normalizeText(sourceTitle);
    }
    return `${sources.length} source${sources.length === 1 ? "" : "s"}`;
  }

  return "";
};

const normalizeSteps = (steps) =>
  (Array.isArray(steps) ? steps : [])
    .map((step, index) => {
      const stepName = step?.step_name || step?.name || step?.type || step?.kind;
      const title = humanizeStepName(stepName);
      const detail = getDetailText(step?.step_detail ?? step?.detail ?? step?.summary);
      return {
        id: String(step?.id || `${stepName || "step"}-${index}`),
        title,
        detail,
      };
    })
    .filter((step) => step.title || step.detail);

export function ThinkingCard({ steps = [], onClick, loading = false }) {
  const normalizedSteps = normalizeSteps(steps);
  if (!loading && !normalizedSteps.length) return null;

  if (loading && !normalizedSteps.length) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-1 py-1 text-[12px] text-muted-foreground"
        aria-live="polite"
      >
        <SonaLogo size={17} speed="working" />
        <span>Sona is analyzing…</span>
      </div>
    );
  }

  const visibleSteps = normalizedSteps.slice(0, 3);
  const remainingCount = Math.max(normalizedSteps.length - visibleSteps.length, 0);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg border border-indigo-100/80 bg-indigo-50/35 px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out hover:border-indigo-200 hover:bg-indigo-50/70 hover:shadow-sm active:scale-[0.995]",
      )}
      aria-label="View how Sona built this draft"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/80 ring-1 ring-indigo-100/80">
        <SonaLogo size={17} speed="idle" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold leading-4 text-indigo-950">
          <span>Sona</span>
          <span className="font-normal text-indigo-900/55">Built this draft</span>
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap gap-1.5">
          {visibleSteps.map((step) => (
            <span
              key={step.id}
              className="max-w-full truncate rounded-md border border-indigo-100/80 bg-white/70 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-indigo-900/75"
              title={step.detail ? `${step.title} · ${step.detail}` : step.title}
            >
              {step.title}
              {step.detail ? ` · ${step.detail}` : ""}
            </span>
          ))}
          {remainingCount > 0 ? (
            <span className="rounded-md px-1 py-0.5 text-[11px] font-medium leading-4 text-indigo-900/55">
              +{remainingCount} more
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-indigo-700/65 transition-colors group-hover:text-indigo-800">
        <span className="hidden sm:inline">Details</span>
        <ChevronRight className="size-3.5" />
      </span>
    </button>
  );
}
