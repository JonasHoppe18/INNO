"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronRight,
  CircleCheck,
  FileCheck2,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const STATUS_LABELS = {
  suggested: "Needs review",
  reviewed: "Reviewed",
  dismissed: "Dismissed",
  published: "Published",
};

const STATUS_CLASSES = {
  suggested: "border-amber-200 bg-amber-50 text-amber-700",
  reviewed: "border-blue-200 bg-blue-50 text-blue-700",
  dismissed: "border-gray-200 bg-gray-100 text-gray-500",
  published: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

function reviewForm(suggestion) {
  return {
    title: suggestion.title || "",
    trigger: suggestion.trigger || "",
    customer_phrasing_examples: Array.isArray(suggestion.customer_phrasing_examples) ? suggestion.customer_phrasing_examples : [],
    recommended_steps: Array.isArray(suggestion.recommended_steps) ? suggestion.recommended_steps : [],
    escalation_condition: suggestion.escalation_condition || "",
    policy_dependencies: Array.isArray(suggestion.policy_dependencies) ? suggestion.policy_dependencies : [],
  };
}

function ConfidenceBadge({ confidence }) {
  const classes = confidence === "HIGH"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : confidence === "MEDIUM"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : "border-gray-200 bg-gray-100 text-gray-600";
  return <Badge variant="outline" className={cn("text-[10px] font-semibold", classes)}>{confidence || "—"}</Badge>;
}

function StepsEditor({ steps, onChange, disabled }) {
  const update = (index, text) => onChange(steps.map((step, itemIndex) => itemIndex === index ? { ...step, text } : step));
  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-3">
      {steps.map((step, index) => (
        <div key={`${index}-${step.kind || "instruction"}`} className="rounded-lg border border-gray-200 bg-gray-50/70 p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-800">Step {index + 1}</span>
            <div className="ml-auto flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => move(index, -1)} disabled={disabled || index === 0}>Up</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => move(index, 1)} disabled={disabled || index === steps.length - 1}>Down</Button>
              <Button type="button" variant="ghost" size="sm" className="text-gray-400 hover:text-red-600" onClick={() => onChange(steps.filter((_, itemIndex) => itemIndex !== index))} disabled={disabled || steps.length <= 1} aria-label={`Remove step ${index + 1}`}><X className="size-3.5" /></Button>
            </div>
          </div>
          <Textarea value={step.text || ""} onChange={(event) => update(index, event.target.value)} disabled={disabled} className="mt-2 min-h-16 resize-y bg-white text-sm leading-5" />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange([...steps, { kind: "instruction", text: "", list_style: "ordered" }])} disabled={disabled}><Plus className="size-4" /> Add step</Button>
    </div>
  );
}

function SuggestionCard({ suggestion, onOpen }) {
  const warnings = suggestion.provenance?.policy_conflict_warnings || [];
  return (
    <button type="button" onClick={() => onOpen(suggestion)} className="group flex w-full flex-col gap-4 rounded-xl border border-gray-200/80 bg-white p-5 text-left shadow-sm shadow-gray-100/60 transition-colors hover:border-indigo-200 hover:bg-indigo-50/20">
      <span className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><FileCheck2 className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold text-gray-900">{suggestion.title}</span><Badge variant="outline" className={cn("text-[10px] font-medium", STATUS_CLASSES[suggestion.status] || STATUS_CLASSES.suggested)}>{STATUS_LABELS[suggestion.status] || "Needs review"}</Badge></span>
          <span className="mt-1 block text-xs leading-5 text-gray-500">{suggestion.trigger}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500" />
      </span>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
        <span><strong className="font-semibold text-gray-800">{suggestion.historical_evidence_count}</strong> historical conversations</span>
        <span><ConfidenceBadge confidence={suggestion.confidence} /> confidence</span>
        {warnings.length ? <span className="flex items-center gap-1 text-amber-700"><AlertTriangle className="size-3.5" /> {warnings.length} policy warning{warnings.length === 1 ? "" : "s"}</span> : null}
      </span>
    </button>
  );
}

export function SuggestedProceduresView({ suggestions, loading, error, onRefresh, onPublished }) {
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selected) {
      const fresh = suggestions.find((item) => item.id === selected.id);
      if (fresh && fresh.updated_at !== selected.updated_at) {
        setSelected(fresh);
        setForm(reviewForm(fresh));
      }
    }
  }, [selected, suggestions]);

  const openSuggestion = (suggestion) => {
    setSelected(suggestion);
    setForm(reviewForm(suggestion));
  };

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const saveSuggestion = async (status = "reviewed") => {
    if (!selected || !form) return null;
    setSaving(true);
    try {
      const response = await fetch(`/api/greenfield-procedure-suggestions/${selected.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save suggested procedure.");
      setSelected(payload.suggestion);
      setForm(reviewForm(payload.suggestion));
      await onRefresh();
      toast.success(status === "dismissed" ? "Suggestion dismissed" : "Review saved");
      return payload.suggestion;
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "Could not save suggested procedure.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const publishSuggestion = async () => {
    if (!selected || selected.status === "dismissed") return;
    const saved = await saveSuggestion("reviewed");
    if (!saved) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/greenfield-procedure-suggestions/${saved.id}/publish`, { method: "POST", credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not publish suggested procedure.");
      setSelected(payload.suggestion);
      setForm(reviewForm(payload.suggestion));
      await onRefresh();
      await onPublished?.();
      toast.success("Published as a Knowledge V1 procedure");
    } catch (publishError) {
      toast.error(publishError instanceof Error ? publishError.message : "Could not publish suggested procedure.");
    } finally {
      setSaving(false);
    }
  };

  const dismissSuggestion = () => saveSuggestion("dismissed");
  const warnings = selected?.provenance?.policy_conflict_warnings || [];
  const canPublish = selected && selected.status !== "published" && selected.status !== "dismissed";

  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-indigo-600"><Sparkles className="size-3.5" /> Merchant review</div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-gray-900">Suggested procedures</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">Aggregate historical support patterns, ready for review. Suggestions stay outside Sona&apos;s knowledge until you explicitly publish one.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh</Button>
      </div>

      <div className="mt-6 flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs leading-5 text-indigo-900"><CircleCheck className="mt-0.5 size-4 shrink-0 text-indigo-600" /><span><strong className="font-semibold">Historical evidence is not policy.</strong> Review the workflow, check current Knowledge V1 dependencies, then publish only the version you approve.</span></div>
      {error ? <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{error}</p> : null}
      {loading ? <div className="mt-4 grid gap-3 lg:grid-cols-2"><div className="h-36 animate-pulse rounded-xl bg-gray-100" /><div className="h-36 animate-pulse rounded-xl bg-gray-100" /></div> : null}
      {!loading && !suggestions.length ? <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-gray-200 px-6 py-16 text-center"><FileCheck2 className="size-6 text-gray-400" /><h3 className="mt-3 text-sm font-semibold text-gray-800">No suggested procedures yet</h3><p className="mt-1 max-w-sm text-xs leading-5 text-gray-500">Import the reviewed audit candidates into this DEV workspace to begin merchant review.</p></div> : null}
      {!loading && suggestions.length ? <div className="mt-4 grid gap-3 lg:grid-cols-2">{suggestions.map((suggestion) => <SuggestionCard key={suggestion.id} suggestion={suggestion} onOpen={openSuggestion} />)}</div> : null}

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open && !saving) setSelected(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="border-b border-gray-100 px-6 py-5 text-left">
            <div className="flex items-center gap-2 text-indigo-600"><FileCheck2 className="size-4" /><span className="text-xs font-medium">Suggested procedure</span></div>
            <SheetTitle className="mt-1">Review procedure</SheetTitle>
            <SheetDescription>Edit the workflow before publishing it as a normal Knowledge V1 procedure. Historical policy facts are intentionally not copied into the steps.</SheetDescription>
          </SheetHeader>
          {selected && form ? <div className="flex flex-1 flex-col gap-5 px-6 py-5">
            {warnings.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" /> Current policy needs review</div><ul className="mt-2 list-disc space-y-1 pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
            <div className="grid gap-2"><Label htmlFor="suggestion-title">Title</Label><Input id="suggestion-title" value={form.title} onChange={(event) => updateForm("title", event.target.value)} disabled={saving || selected.status === "published"} /></div>
            <div className="grid gap-2"><Label htmlFor="suggestion-trigger">When this applies</Label><Textarea id="suggestion-trigger" value={form.trigger} onChange={(event) => updateForm("trigger", event.target.value)} disabled={saving || selected.status === "published"} className="min-h-20 resize-y" /></div>
            <div className="grid gap-2"><Label htmlFor="suggestion-aliases">Customers may say</Label><Textarea id="suggestion-aliases" value={form.customer_phrasing_examples.join("\n")} onChange={(event) => updateForm("customer_phrasing_examples", event.target.value.split("\n").map((value) => value.trim()).filter(Boolean))} disabled={saving || selected.status === "published"} className="min-h-20 resize-y" /></div>
            <div className="grid gap-2"><Label>Suggested steps</Label><StepsEditor steps={form.recommended_steps} onChange={(recommended_steps) => updateForm("recommended_steps", recommended_steps)} disabled={saving || selected.status === "published"} /></div>
            <div className="grid gap-2"><Label htmlFor="suggestion-escalation">Escalation condition</Label><Textarea id="suggestion-escalation" value={form.escalation_condition} onChange={(event) => updateForm("escalation_condition", event.target.value)} disabled={saving || selected.status === "published"} className="min-h-20 resize-y" /></div>
            <div className="grid gap-2"><Label>Current policy dependencies</Label><div className="flex flex-wrap gap-2">{form.policy_dependencies.map((dependency) => <Badge key={dependency} variant="secondary" className="font-normal">{dependency}</Badge>)}</div><p className="text-xs leading-5 text-gray-500">These references guide review; the current authoritative policy is retrieved separately at runtime.</p></div>
            <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-3 text-xs leading-5 text-gray-600"><div className="flex items-center justify-between"><span>Historical evidence</span><strong className="text-gray-800">{selected.historical_evidence_count} conversations</strong></div><div className="mt-2 flex items-center justify-between"><span>Confidence</span><ConfidenceBadge confidence={selected.confidence} /></div><div className="mt-2 flex items-center justify-between"><span>Source</span><strong className="font-medium text-gray-800">Historical Zendesk analysis</strong></div><div className="mt-2 border-t border-gray-200 pt-2">Action permission: <strong className="font-medium text-gray-800">{selected.action_permission_note || "Human approval likely required"}</strong></div></div>
            {selected.status !== "published" ? <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-xs leading-5 text-blue-800"><RotateCcw className="mt-0.5 size-4 shrink-0" />This suggestion is not retrievable by Sona until you publish it.</div> : <div className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 text-xs leading-5 text-emerald-800"><Check className="mt-0.5 size-4 shrink-0" />Published as a normal canonical Knowledge V1 procedure.</div>}
          </div> : null}
          {selected ? <SheetFooter className="border-t border-gray-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"><div>{selected.status !== "published" ? <Button type="button" variant="ghost" size="sm" onClick={dismissSuggestion} disabled={saving || selected.status === "dismissed"} className="text-gray-500 hover:text-red-600"><Archive className="size-4" /> Dismiss</Button> : null}</div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setSelected(null)} disabled={saving}>Close</Button>{selected.status !== "published" && selected.status !== "dismissed" ? <><Button type="button" variant="outline" size="sm" onClick={() => saveSuggestion("reviewed")} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save review</Button><Button type="button" size="sm" onClick={publishSuggestion} disabled={saving || !canPublish}>{saving ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />} Publish</Button></> : null}</div></SheetFooter> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
