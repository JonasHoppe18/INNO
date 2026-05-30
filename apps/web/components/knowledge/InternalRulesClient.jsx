"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Plus, Shield, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// Must match the planner's primary_intent enum AND the API's
// VALID_TRIGGER_INTENTS so a rule's trigger actually fires.
const INTENT_OPTIONS = [
  { value: "complaint", label: "Complaint / fault" },
  { value: "exchange", label: "Exchange" },
  { value: "return", label: "Return" },
  { value: "refund", label: "Refund" },
  { value: "tracking", label: "Track & trace" },
  { value: "address_change", label: "Address change" },
  { value: "product_question", label: "Product question" },
  { value: "update", label: "Update" },
  { value: "thanks", label: "Thanks" },
  { value: "other", label: "Other" },
];

const INTENT_LABEL = Object.fromEntries(
  INTENT_OPTIONS.map((o) => [o.value, o.label]),
);

const EMPTY_FORM = { id: null, title: "", content: "", triggerIntent: [] };

export function InternalRulesClient() {
  const router = useRouter();
  const [rules, setRules] = useState([]);
  const [shopId, setShopId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/knowledge/snippets?audience=internal", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not load internal rules.");
      setRules(Array.isArray(data?.snippets) ? data.snippets : []);
      setShopId(data?.shop_id || null);
    } catch (err) {
      console.warn("loadRules failed", err);
      toast.error(err instanceof Error ? err.message : "Could not load internal rules.");
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules().catch(() => null);
  }, [loadRules]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };

  const openEdit = (rule) => {
    setForm({
      id: String(rule?.snippet_id || ""),
      title: String(rule?.title || ""),
      content: String(rule?.content || ""),
      triggerIntent: Array.isArray(rule?.trigger_intent) ? rule.trigger_intent : [],
    });
    setEditorOpen(true);
  };

  const toggleIntent = (value) => {
    setForm((prev) => {
      const has = prev.triggerIntent.includes(value);
      return {
        ...prev,
        triggerIntent: has
          ? prev.triggerIntent.filter((v) => v !== value)
          : [...prev.triggerIntent, value],
      };
    });
  };

  const handleSave = async () => {
    const title = form.title.trim();
    const content = form.content.trim();
    if (!title || !content) {
      toast.error("Title and rule text are required.");
      return;
    }
    setSaving(true);
    try {
      const isEditing = Boolean(form.id);
      const res = await fetch("/api/knowledge/snippets", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: form.id || undefined,
          shop_id: shopId || undefined,
          title,
          content,
          audience: "internal",
          trigger_intent: form.triggerIntent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save the rule.");
      toast.success(isEditing ? "Internal rule updated." : "Internal rule added.");
      setEditorOpen(false);
      setForm(EMPTY_FORM);
      await loadRules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the rule.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rule) => {
    const id = String(rule?.snippet_id || "");
    if (!id) return;
    setDeletingId(id);
    try {
      const res = await fetch("/api/knowledge/snippets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, shop_id: shopId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not delete the rule.");
      toast.success("Internal rule deleted.");
      await loadRules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the rule.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => router.push("/knowledge")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
              <Shield className="h-4 w-4" />
            </div>
            <h1 className="text-lg font-semibold">Internal rules</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Rules that govern <em>how</em> the AI handles a case — e.g. how a faulty
            item should be routed, which case type you use internally, or when nothing
            may be promised before approval. They are always followed, but never sent
            verbatim to the customer.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New rule
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="space-y-2 py-4">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : rules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium">No internal rules yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-gray-500 dark:text-gray-400">
                Example: &quot;Faulty microphone = Return For Swap case. Route to the
                production department. Never promise a replacement before the case is approved.&quot;
              </p>
            </div>
            <Button onClick={openCreate} variant="outline" className="mt-1 gap-1.5">
              <Plus className="h-4 w-4" />
              Create your first rule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.snippet_id} className="group">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{rule.title}</p>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">
                      {rule.content}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(rule.trigger_intent || []).length === 0 ? (
                        <Badge variant="secondary" className="text-[11px]">
                          Applies to all inquiries
                        </Badge>
                      ) : (
                        rule.trigger_intent.map((intent) => (
                          <Badge key={intent} variant="secondary" className="text-[11px]">
                            {INTENT_LABEL[intent] || intent}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(rule)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-gray-400 hover:text-red-600"
                      disabled={deletingId === rule.snippet_id}
                      onClick={() => handleDelete(rule)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="w-[min(96vw,640px)] max-w-none sm:max-w-none">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit internal rule" : "New internal rule"}</DialogTitle>
            <DialogDescription>
              Write the rule as an instruction to the AI. It is never quoted verbatim —
              the AI translates it into natural customer language.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                placeholder="e.g. Faulty microphone → Return For Swap"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rule</Label>
              <Textarea
                rows={5}
                placeholder="e.g. When a customer reports a faulty microphone, treat it as a Return For Swap case and route it to the production department. Never promise a replacement before the case is approved — suggest the next step instead."
                value={form.content}
                onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Applies to inquiries about</Label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose which inquiries the rule should trigger on. Select none if the
                rule applies to all inquiries.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {INTENT_OPTIONS.map((opt) => {
                  const active = form.triggerIntent.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleIntent(opt.value)}
                      disabled={saving}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        active
                          ? "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : form.id ? "Save changes" : "Add rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
