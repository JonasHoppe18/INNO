"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  Globe2,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Store,
  TestTube2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const TYPE_OPTIONS = [
  { value: "policy", label: "Policy" },
  { value: "procedure", label: "Troubleshooting / Procedure" },
  { value: "product", label: "Product information" },
  { value: "brand", label: "Brand / Company" },
];

const STATUS_LABELS = {
  draft: "Draft",
  published: "Published",
  unpublished: "Unpublished",
  archived: "Archived",
};

const STATUS_FILTERS = [
  ["active", "Published & draft"],
  ["all", "All statuses"],
  ["published", "Published"],
  ["draft", "Draft"],
  ["unpublished", "Unpublished"],
  ["archived", "Archived"],
];

const TYPE_ICON = {
  policy: BookOpen,
  procedure: Settings2,
  product: Package,
  brand: Sparkles,
  other: FileText,
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusClass(status) {
  if (status === "published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "archived") return "border-gray-200 bg-gray-100 text-gray-500";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function sourceKindLabel(source) {
  const value = String(typeof source === "string" ? source : source?.kind || source?.label || "").toLowerCase();
  if (value.includes("shopify") || value === "product") return "Shopify";
  if (value.includes("website") || value.includes("web")) return "Website";
  if (value.includes("document") || value.includes("file")) return "Document";
  if (value.includes("historic") || value.includes("ticket") || value.includes("zendesk")) return "Historical support";
  if (value.includes("merchant")) return "Manual";
  return "Imported source";
}

function displaySourceLabel(source) {
  const label = String(source?.label || "").trim();
  if (label === "Merchant") return "Merchant knowledge";
  if (label === "Document upload") return "Imported document";
  return label || sourceKindLabel(source);
}

function emptyForm() {
  return {
    title: "",
    content: "",
    type: "policy",
    status: "draft",
    applies_to: { kind: "all", product_ids: [] },
    task_key: "",
    customer_aliases: [],
    procedure_blocks: [{ kind: "instruction", text: "", list_style: "ordered" }],
  };
}

function formFromRecord(record) {
  return {
    title: record.title || "",
    content: record.content || "",
    type: TYPE_OPTIONS.some((option) => option.value === record.type) ? record.type : "policy",
    status: ["draft", "published", "unpublished"].includes(record.status) ? record.status : "draft",
    applies_to: record.applies_to?.kind === "products"
      ? { kind: "products", product_ids: Array.isArray(record.applies_to.product_ids) ? record.applies_to.product_ids : [] }
      : { kind: "all", product_ids: [] },
    task_key: record.procedure?.task_key || "",
    customer_aliases: Array.isArray(record.procedure?.customer_aliases) ? record.procedure.customer_aliases : [],
    procedure_blocks: Array.isArray(record.procedure?.blocks) && record.procedure.blocks.length
      ? record.procedure.blocks
      : [{ kind: "instruction", text: "", list_style: "ordered" }],
  };
}

const PROCEDURE_BLOCK_OPTIONS = [
  ["heading", "Heading"],
  ["prerequisite", "Prerequisite"],
  ["instruction", "Instruction"],
  ["note", "Note"],
  ["warning", "Warning"],
  ["condition", "Condition"],
  ["expected_result", "Expected result"],
  ["alternative", "Alternative"],
];

const PROCEDURE_GUIDANCE_OPTIONS = [
  ["prerequisite", "Add prerequisite"],
  ["note", "Add note"],
  ["warning", "Add warning"],
  ["condition", "Add condition"],
  ["expected_result", "Add expected result"],
];

function procedureContent(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => String(block?.text || "").trim())
    .map((block) => {
      const text = String(block.text).trim();
      if (block.kind === "heading") return `## ${text}`;
      if (block.kind === "instruction") return block.list_style === "unordered" ? `- ${text}` : text;
      const label = PROCEDURE_BLOCK_OPTIONS.find(([value]) => value === block.kind)?.[1] || "Instruction";
      return `${label}: ${text}`;
    })
    .join("\n\n");
}

function ProcedureBlockEditor({ blocks, onChange, disabled }) {
  const update = (index, patch) => onChange(blocks.map((block, itemIndex) => itemIndex === index ? { ...block, ...patch } : block));
  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const addBlock = (kind) => onChange([...(blocks || []), { kind, text: "", list_style: kind === "instruction" ? "ordered" : null }]);
  let instructionNumber = 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-5 text-muted-foreground">Write the customer-facing solution as clear steps. Add extra guidance only when it helps Sona handle an exception.</p>
      {(blocks || []).map((block, index) => {
        const isInstruction = block.kind === "instruction";
        if (isInstruction) instructionNumber += 1;
        const blockLabel = isInstruction ? `Step ${instructionNumber}` : PROCEDURE_BLOCK_OPTIONS.find(([value]) => value === block.kind)?.[1] || "Guidance";
        return (
          <div key={`${index}-${block.kind}`} className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-800">{blockLabel}</span>
              {!isInstruction ? <Badge variant="secondary" className="font-normal">Optional guidance</Badge> : null}
              <div className="ml-auto flex items-center gap-0.5">
                <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => move(index, -1)} disabled={disabled || index === 0} aria-label="Move step up"><ArrowUp className="size-3.5" /></Button>
                <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => move(index, 1)} disabled={disabled || index === blocks.length - 1} aria-label="Move step down"><ArrowDown className="size-3.5" /></Button>
                <Button type="button" variant="ghost" size="icon" className="size-7 text-gray-400 hover:text-red-600" onClick={() => onChange(blocks.filter((_, itemIndex) => itemIndex !== index))} disabled={disabled || blocks.length <= 1} aria-label="Remove step"><Trash2 className="size-3.5" /></Button>
              </div>
            </div>
            <Textarea value={block.text} onChange={(event) => update(index, { text: event.target.value })} disabled={disabled} placeholder={isInstruction ? "e.g. Turn the device off before reconnecting it." : "Add the extra guidance Sona should follow."} className="mt-2 min-h-16 resize-y bg-white text-sm leading-5" />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => addBlock("instruction")} disabled={disabled}><Plus className="size-4" /> Add step</Button>
        {PROCEDURE_GUIDANCE_OPTIONS.map(([kind, label]) => <Button key={kind} type="button" variant="ghost" size="sm" onClick={() => addBlock(kind)} disabled={disabled}>{label}</Button>)}
      </div>
    </div>
  );
}

function ErrorMessage({ children }) {
  return <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{children}</p>;
}

function SourceIcon({ source }) {
  const value = String(typeof source === "string" ? source : source?.kind || source?.label || "").toLowerCase();
  if (value.includes("merchant") || value.includes("manual")) return <Store className="size-3.5" />;
  if (value.includes("website") || value.includes("web")) return <Globe2 className="size-3.5" />;
  if (value.includes("shopify") || value === "product") return <Package className="size-3.5" />;
  return <FileText className="size-3.5" />;
}

function ProductChooser({ products, value, onChange, disabled }) {
  const [query, setQuery] = useState("");
  if (!products.available) {
    return <p className="rounded-lg bg-muted/45 px-3 py-2.5 text-xs leading-5 text-muted-foreground">Specific product selection is unavailable until a Shopify store is connected. All products remains available.</p>;
  }
  const visibleProducts = products.items.filter((product) => !query.trim() || product.title.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-2">
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products" className="h-9" disabled={disabled} />
      <div className="max-h-44 overflow-y-auto rounded-lg border border-input p-1.5">
      {visibleProducts.length ? visibleProducts.map((product) => {
        const checked = value.includes(product.id);
        return (
          <button
            type="button"
            key={product.id}
            disabled={disabled}
            onClick={() => onChange(checked ? value.filter((id) => id !== product.id) : [...value, product.id])}
            className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors duration-150 hover:bg-muted/60", checked && "bg-indigo-50 text-indigo-800")}
          >
            <span className={cn("flex size-4 items-center justify-center rounded border", checked ? "border-indigo-500 bg-indigo-500 text-white" : "border-gray-300")}>{checked ? <Check className="size-3" /> : null}</span>
            <span className="min-w-0 flex-1 truncate">{product.title}</span>
          </button>
        );
      }) : <p className="px-2.5 py-3 text-xs text-muted-foreground">No products match that search.</p>}
      </div>
    </div>
  );
}

function SourcesView({ records, onAddSource }) {
  const sources = useMemo(() => {
    const grouped = new Map();
    records.forEach((record) => {
      const label = displaySourceLabel(record.source);
      const kind = sourceKindLabel(record.source);
      const key = `${kind}:${label}`;
      const current = grouped.get(key) || {
        key,
        title: label,
        kind,
        records: [],
        latest: record.updated_at,
      };
      current.records.push(record);
      if (String(record.updated_at || "") > String(current.latest || "")) current.latest = record.updated_at;
      grouped.set(key, current);
    });
    return Array.from(grouped.values()).sort((left, right) => String(right.latest || "").localeCompare(String(left.latest || "")));
  }, [records]);

  if (!sources.length) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-200 px-6 py-16 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-500"><FileText className="size-5" /></span>
        <h2 className="mt-4 text-sm font-semibold text-gray-800">No sources yet</h2>
        <p className="mt-1 max-w-sm text-xs leading-5 text-gray-500">Add a document or create knowledge manually to see where Sona learns from.</p>
        <Button size="sm" className="mt-5" onClick={onAddSource}><FileText className="size-4" /> Add a source</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Sources</h2>
        <p className="mt-1 text-xs leading-5 text-gray-500">See where Sona&apos;s knowledge comes from and which records each source created.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {sources.map((source) => {
          const published = source.records.filter((record) => record.status === "published").length;
          const drafts = source.records.filter((record) => record.status === "draft").length;
          return (
            <details key={source.key} className="group rounded-xl border border-gray-200/80 bg-white shadow-sm shadow-gray-100/70">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600"><SourceIcon source={source.kind} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-800">{source.title}</span>
                  <span className="mt-1 block text-xs text-gray-500">{source.kind} · {source.records.length} knowledge item{source.records.length === 1 ? "" : "s"}</span>
                </span>
                <span className="shrink-0 text-right text-[11px] text-gray-400">Updated {formatDate(source.latest)}</span>
              </summary>
              <div className="border-t border-gray-100 px-4 py-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500"><span>{published} published</span><span>{drafts} draft{drafts === 1 ? "" : "s"}</span></div>
                <div className="mt-3 flex flex-col gap-2">
                  {source.records.map((record) => <div key={record.id} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate text-gray-700">{record.title}</span><Badge variant="outline" className={cn("shrink-0 text-[10px] font-medium", statusClass(record.status))}>{STATUS_LABELS[record.status] || "Published"}</Badge></div>)}
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

export function GreenfieldKnowledgePageClient() {
  const [records, setRecords] = useState([]);
  const [filters, setFilters] = useState({ query: "", type: "all", status: "active" });
  const [activeView, setActiveView] = useState("knowledge");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [products, setProducts] = useState({ available: false, items: [] });
  const [saving, setSaving] = useState(false);
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [sourceForm, setSourceForm] = useState({ title: "", knowledge_type: "procedural", content: "" });

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/greenfield-knowledge", { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not load knowledge.");
      setRecords(Array.isArray(payload.records) ? payload.records : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load knowledge.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const loadProducts = useCallback(async () => {
    try {
      const response = await fetch("/api/greenfield-knowledge/products", { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not load products.");
      setProducts({ available: payload.available === true, items: Array.isArray(payload.products) ? payload.products : [] });
    } catch {
      setProducts({ available: false, items: [] });
    }
  }, []);

  useEffect(() => {
    if (sheetOpen) loadProducts();
  }, [loadProducts, sheetOpen]);

  const visibleRecords = useMemo(() => {
    const statusMatches = (record) => filters.status === "active"
      ? ["published", "draft"].includes(record.status)
      : filters.status === "all" || record.status === filters.status;
    const statusOrder = { published: 0, draft: 1, unpublished: 2, archived: 3 };
    return records
      .filter((record) => (
        (!filters.query.trim() || `${record.title} ${record.content}`.toLowerCase().includes(filters.query.trim().toLowerCase()))
          && (filters.type === "all" || record.type === filters.type)
          && statusMatches(record)
      ))
      .sort((left, right) => (statusOrder[left.status] ?? 4) - (statusOrder[right.status] ?? 4) || String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
  }, [filters, records]);

  const openCreate = () => {
    setSelected(null);
    setForm(emptyForm());
    setSheetOpen(true);
  };

  const openRecord = (record) => {
    setSelected(record);
    setForm(formFromRecord(record));
    setSheetOpen(true);
  };

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateType = (type) => setForm((current) => ({
    ...current,
    type,
    applies_to: type === "brand"
      ? { kind: "all", product_ids: [] }
      : type === "product" && current.applies_to.kind === "all"
        ? { kind: "products", product_ids: [] }
        : current.applies_to,
  }));
  const updateProcedureBlocks = (procedure_blocks) => setForm((current) => ({ ...current, procedure_blocks }));

  const save = async (nextStatus = form.status) => {
    setSaving(true);
    try {
      const content = form.type === "procedure" ? procedureContent(form.procedure_blocks) : form.content;
      const response = await fetch(selected ? `/api/greenfield-knowledge/${selected.id}` : "/api/greenfield-knowledge", {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...form, content, status: nextStatus, task_key: form.task_key, customer_aliases: form.customer_aliases }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save knowledge.");
      toast.success(nextStatus === "published" ? "Knowledge published" : nextStatus === "archived" ? "Knowledge archived" : "Knowledge saved");
      setSheetOpen(false);
      await loadRecords();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "Could not save knowledge.");
    } finally {
      setSaving(false);
    }
  };

  const ingestSource = async () => {
    setSourceSaving(true);
    try {
      const response = await fetch("/api/greenfield-knowledge/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(sourceForm),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not ingest source.");
      toast.success(`${payload.source?.candidate_count || 0} draft knowledge records created for review`);
      setSourceSheetOpen(false);
      setSourceForm({ title: "", knowledge_type: "procedural", content: "" });
      await loadRecords();
    } catch (sourceError) {
      toast.error(sourceError instanceof Error ? sourceError.message : "Could not ingest source.");
    } finally {
      setSourceSaving(false);
    }
  };

  const isEditable = !selected || selected.source?.editable;
  const Icon = TYPE_ICON[selected?.type || form.type] || FileText;
  const statusHelp = form.status === "published"
    ? "Published knowledge can be used in normal Sona retrieval."
    : form.status === "unpublished"
      ? "Unpublished knowledge stays saved but is excluded from normal Sona retrieval."
      : "Draft knowledge is saved but never used in normal Sona retrieval.";
  const saveLabel = form.status === "published" ? "Save changes" : form.status === "unpublished" ? "Save unpublished" : "Save draft";
  const formCanSave = Boolean(form.title.trim()) && (form.type === "procedure" ? form.procedure_blocks.some((block) => block.text.trim()) : Boolean(form.content.trim())) && !(form.applies_to.kind === "products" && !form.applies_to.product_ids.length);

  return (
    <div className="mx-auto w-full max-w-[1240px]">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-indigo-600"><BookOpen className="size-3.5" /> Knowledge</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">Knowledge</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-gray-500">Manage the policies, product guidance and procedures Sona uses when helping customers.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/playground"><TestTube2 className="size-4" /> Test Sona</Link></Button>
          <Button variant="outline" size="sm" onClick={() => setSourceSheetOpen(true)}><FileText className="size-4" /> Add source</Button>
          <Button size="sm" onClick={openCreate}><Plus className="size-4" /> Add knowledge</Button>
        </div>
      </div>

      <Tabs value={activeView} onValueChange={setActiveView} className="mt-8">
        <TabsList className="h-10 rounded-none border-b border-gray-200 bg-transparent p-0">
          <TabsTrigger value="knowledge" className="h-10 rounded-none border-b-2 border-transparent px-1.5 text-xs text-gray-500 shadow-none data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none">Knowledge</TabsTrigger>
          <TabsTrigger value="sources" className="h-10 rounded-none border-b-2 border-transparent px-1.5 text-xs text-gray-500 shadow-none data-[state=active]:border-indigo-600 data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none">Sources</TabsTrigger>
        </TabsList>

        <div className="mt-6">
          {activeView === "knowledge" ? <>
            <div className="flex flex-col gap-3 rounded-xl border border-gray-200/80 bg-white p-3 shadow-sm shadow-gray-100/70 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                <Input value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="Search knowledge" className="h-9 border-0 bg-gray-50 pl-9 shadow-none focus-visible:ring-1" />
              </div>
              <Select value={filters.type} onValueChange={(value) => setFilters((current) => ({ ...current, type: value }))}>
                <SelectTrigger className="h-9 w-full sm:w-48"><SelectValue placeholder="All types" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All types</SelectItem>{TYPE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={filters.status} onValueChange={(value) => setFilters((current) => ({ ...current, status: value }))}>
                <SelectTrigger className="h-9 w-full sm:w-44"><SelectValue placeholder="Published & draft" /></SelectTrigger>
                <SelectContent>{STATUS_FILTERS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {error ? <div className="mt-4"><ErrorMessage>{error}</ErrorMessage></div> : null}
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm shadow-gray-100/70">
              <div className="hidden grid-cols-[minmax(0,1.8fr)_1fr_1fr_1fr_110px] gap-4 border-b border-gray-100 bg-gray-50/70 px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 md:grid">
                <span>Knowledge</span><span>Type</span><span>Applies to</span><span>Source</span><span>Status</span>
              </div>
              {loading ? <div className="flex flex-col gap-3 p-5"><div className="h-14 animate-pulse rounded-lg bg-gray-100" /><div className="h-14 animate-pulse rounded-lg bg-gray-100" /><div className="h-14 animate-pulse rounded-lg bg-gray-100" /></div> : null}
              {!loading && visibleRecords.length ? visibleRecords.map((record) => {
                const RowIcon = TYPE_ICON[record.type] || FileText;
                const appliesTo = record.applies_to?.kind === "products" ? `${record.applies_to.product_ids.length} product${record.applies_to.product_ids.length === 1 ? "" : "s"}` : "All products";
                return (
                  <button type="button" key={record.id} onClick={() => openRecord(record)} className="group grid w-full gap-3 border-b border-gray-100 px-5 py-4 text-left transition-colors duration-150 last:border-b-0 hover:bg-gray-50/70 md:grid-cols-[minmax(0,1.8fr)_1fr_1fr_1fr_110px] md:items-center md:gap-4">
                    <span className="flex min-w-0 items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><RowIcon className="size-4" /></span><span className="min-w-0"><span className="block truncate text-sm font-medium text-gray-800">{record.title}</span><span className="mt-0.5 block truncate text-xs text-gray-400">Updated {formatDate(record.updated_at)}</span></span><ChevronRight className="ml-auto size-4 shrink-0 text-gray-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-gray-500 md:hidden" /></span>
                    <span className="text-xs text-gray-600 md:block"><span className="mr-2 text-gray-400 md:hidden">Type</span>{record.type_label}</span>
                    <span className="text-xs text-gray-600 md:block"><span className="mr-2 text-gray-400 md:hidden">Applies to</span>{appliesTo}</span>
                    <span className="flex items-center gap-1.5 text-xs text-gray-600"><SourceIcon source={record.source} />{displaySourceLabel(record.source)}</span>
                    <span><Badge variant="outline" className={cn("font-medium", statusClass(record.status))}>{STATUS_LABELS[record.status] || "Published"}</Badge></span>
                  </button>
                );
              }) : null}
              {!loading && !visibleRecords.length ? <div className="flex flex-col items-center px-6 py-16 text-center"><span className="flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><Sparkles className="size-5" /></span><h2 className="mt-4 text-sm font-semibold text-gray-800">{records.length ? "No knowledge matches those filters" : "Give Sona the knowledge it needs"}</h2><p className="mt-1 max-w-sm text-xs leading-5 text-gray-500">{records.length ? "Try a different search or filter." : "Add policies, product guidance and troubleshooting procedures Sona should use when helping customers."}</p>{!records.length ? <Button size="sm" className="mt-5" onClick={openCreate}><Plus className="size-4" /> Add knowledge</Button> : null}</div> : null}
            </div>
          </> : <SourcesView records={records} onAddSource={() => setSourceSheetOpen(true)} />}
        </div>
      </Tabs>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-gray-100 px-6 py-5 text-left">
            <div className="flex items-center gap-2 text-indigo-600"><Icon className="size-4" /><span className="text-xs font-medium">{selected ? selected.type_label : "New knowledge"}</span></div>
            <SheetTitle className="mt-1">{selected ? (isEditable ? "Edit knowledge" : "Knowledge details") : "Add knowledge"}</SheetTitle>
            <SheetDescription>{selected && !isEditable ? "Imported knowledge is shown here as read-only." : "Write the guidance Sona should use. You can publish it when it is ready."}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-5 px-6 py-5">
            {selected && !isEditable ? <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-xs leading-5 text-blue-800"><FileText className="size-4 shrink-0" />This source is imported from {selected.source?.label || "an external source"}. Create a merchant entry if you need to add a correction.</div> : null}
            <div className="grid gap-2"><Label htmlFor="greenfield-title">Title</Label><Input id="greenfield-title" value={form.title} onChange={(event) => updateForm("title", event.target.value)} disabled={!isEditable || saving} placeholder="e.g. Return policy" maxLength={180} /></div>
            <div className="grid gap-2"><Label htmlFor="greenfield-type">Knowledge type</Label><Select value={form.type} onValueChange={updateType} disabled={!isEditable || saving}><SelectTrigger id="greenfield-type"><SelectValue /></SelectTrigger><SelectContent>{TYPE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            {form.type === "brand" ? null : form.type === "product" ? <div className="grid gap-2"><Label>Products</Label><ProductChooser products={products} value={form.applies_to.product_ids} onChange={(product_ids) => updateForm("applies_to", { kind: "products", product_ids })} disabled={!isEditable || saving} /><p className="text-xs leading-5 text-muted-foreground">Choose one or more Shopify products this information belongs to.</p></div> : <div className="grid gap-2"><Label htmlFor="greenfield-applies">Applies to</Label><Select value={form.applies_to.kind} onValueChange={(value) => updateForm("applies_to", { kind: value, product_ids: value === "all" ? [] : form.applies_to.product_ids })} disabled={!isEditable || saving}><SelectTrigger id="greenfield-applies"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All products</SelectItem>{products.available ? <SelectItem value="products">Specific products</SelectItem> : null}</SelectContent></Select>{form.applies_to.kind === "products" ? <ProductChooser products={products} value={form.applies_to.product_ids} onChange={(product_ids) => updateForm("applies_to", { kind: "products", product_ids })} disabled={!isEditable || saving} /> : <p className="text-xs text-muted-foreground">This guidance can be used for any product in the store.</p>}</div>}
            {form.type === "procedure" ? <>
              <div className="grid gap-2"><Label htmlFor="greenfield-task">What problem does this solve?</Label><Input id="greenfield-task" value={form.task_key} onChange={(event) => updateForm("task_key", event.target.value)} disabled={!isEditable || saving} placeholder="e.g. Microphone is not working" /></div>
              <div className="grid gap-2"><Label htmlFor="greenfield-aliases">How customers might describe it <span className="font-normal text-gray-400">(optional)</span></Label><Input id="greenfield-aliases" value={form.customer_aliases.join(", ")} onChange={(event) => updateForm("customer_aliases", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} disabled={!isEditable || saving} placeholder="mic not working, nobody can hear me" /></div>
              <div className="grid gap-2"><Label>Instructions</Label><ProcedureBlockEditor blocks={form.procedure_blocks} onChange={updateProcedureBlocks} disabled={!isEditable || saving} /></div>
            </> : <div className="grid gap-2"><Label htmlFor="greenfield-content">{form.type === "policy" ? "Policy content" : form.type === "product" ? "Product information" : "Brand information"}</Label><Textarea id="greenfield-content" value={form.content} onChange={(event) => updateForm("content", event.target.value)} disabled={!isEditable || saving} placeholder={form.type === "policy" ? "Explain the policy in plain language..." : form.type === "product" ? "Describe the product information Sona should use..." : "Describe the brand guidance Sona should follow..."} className="min-h-64 resize-y leading-6" maxLength={50_000} /><p className="text-right text-[11px] text-muted-foreground">{form.content.length.toLocaleString()} / 50,000</p></div>}
            <div className="grid gap-2"><Label htmlFor="greenfield-status">Status</Label><Select value={form.status} onValueChange={(value) => updateForm("status", value)} disabled={!isEditable || saving}><SelectTrigger id="greenfield-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="published">Published</SelectItem><SelectItem value="unpublished">Unpublished</SelectItem></SelectContent></Select><p className="text-xs leading-5 text-muted-foreground">{statusHelp}</p></div>
            {selected ? <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-3 text-xs text-gray-500"><div className="flex items-center justify-between"><span>Source</span><span className="flex items-center gap-1.5 font-medium text-gray-700"><SourceIcon source={selected.source} />{displaySourceLabel(selected.source)}</span></div><div className="mt-2 flex items-center justify-between"><span>Last updated</span><span className="font-medium text-gray-700">{formatDate(selected.updated_at)}</span></div></div> : null}
          </div>
          {isEditable ? <SheetFooter className="border-t border-gray-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"><div>{selected ? <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => save("archived")} className="text-gray-500 hover:text-red-600"><Archive className="size-4" /> Archive</Button> : null}</div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setSheetOpen(false)} disabled={saving}>Cancel</Button><Button type="button" variant="outline" size="sm" onClick={() => save(form.status)} disabled={saving || !formCanSave}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}{saveLabel}</Button><Button type="button" size="sm" onClick={() => save("published")} disabled={saving || !formCanSave}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Publish</Button></div></SheetFooter> : <SheetFooter className="border-t border-gray-100 px-6 py-4"><Button type="button" variant="outline" size="sm" onClick={() => setSheetOpen(false)}><X className="size-4" /> Close</Button></SheetFooter>}
        </SheetContent>
      </Sheet>

      <Sheet open={sourceSheetOpen} onOpenChange={setSourceSheetOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-gray-100 px-6 py-5 text-left"><div className="flex items-center gap-2 text-indigo-600"><FileText className="size-4" /><span className="text-xs font-medium">Source</span></div><SheetTitle>Add a source</SheetTitle><SheetDescription>Paste a document or manual and Sona will turn its sections into draft knowledge for review.</SheetDescription></SheetHeader>
          <div className="flex flex-1 flex-col gap-5 px-6 py-5">
            <div className="grid gap-2"><Label htmlFor="greenfield-source-title">Source name</Label><Input id="greenfield-source-title" value={sourceForm.title} onChange={(event) => setSourceForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. AceZone FAQ" disabled={sourceSaving} /></div>
            <div className="grid gap-2"><Label>What should Sona learn?</Label><Select value={sourceForm.knowledge_type} onValueChange={(knowledge_type) => setSourceForm((current) => ({ ...current, knowledge_type }))} disabled={sourceSaving}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="procedural">Troubleshooting / Procedure</SelectItem><SelectItem value="product">Product information</SelectItem><SelectItem value="policy">Policy</SelectItem><SelectItem value="brand">Brand / Company</SelectItem></SelectContent></Select></div>
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2.5 text-xs leading-5 text-indigo-800">Use headings (`## Reset`, `## Pairing`, …) to split the source. The resulting entries start as drafts so you can review them before publishing.</div>
            <div className="grid gap-2"><Label htmlFor="greenfield-source-content">Document content</Label><Textarea id="greenfield-source-content" value={sourceForm.content} onChange={(event) => setSourceForm((current) => ({ ...current, content: event.target.value }))} disabled={sourceSaving} placeholder={'## Reset\n\n1. Turn the device off.\n2. Hold the power button for 15 seconds.\n\n## Pairing\n\n1. ...'} className="min-h-[360px] resize-y leading-5" /></div>
          </div>
          <SheetFooter className="border-t border-gray-100 px-6 py-4 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => setSourceSheetOpen(false)} disabled={sourceSaving}>Cancel</Button><Button type="button" onClick={ingestSource} disabled={sourceSaving || !sourceForm.title.trim() || !sourceForm.content.trim()}>{sourceSaving ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Create drafts</Button></SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
