"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#64748b",
];

function TagBadge({ tag, onRemove, onClick }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white cursor-default select-none"
      style={{ backgroundColor: tag.color }}
      onClick={onClick}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(tag); }}
          className="opacity-70 hover:opacity-100 leading-none"
          aria-label="Fjern tag"
        >
          ×
        </button>
      )}
    </span>
  );
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="w-6 h-6 rounded-full border-2 transition-all"
          style={{
            backgroundColor: c,
            borderColor: value === c ? "#0f172a" : "transparent",
            transform: value === c ? "scale(1.2)" : "scale(1)",
          }}
          aria-label={c}
        />
      ))}
    </div>
  );
}

function TagFormModal({ open, onClose, onSave, initial }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [category, setCategory] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setColor(initial?.color ?? PRESET_COLORS[0]);
      setCategory(initial?.category ?? "");
      setAiPrompt(initial?.ai_prompt ?? "");
      setSaving(false);
    }
  }, [open, initial]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Name is required."); return; }
    if (trimmed.length > 50) { toast.error("Name must be 50 characters or fewer."); return; }
    setSaving(true);
    try {
      await onSave({ name: trimmed, color, category: category.trim() || null, ai_prompt: aiPrompt.trim() || null });
      onClose();
    } catch (err) {
      toast.error(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit tag" : "Create tag"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wide text-slate-500">NAME</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Return"
              maxLength={50}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wide text-slate-500">COLOR</label>
            <ColorPicker value={color} onChange={setColor} />
            <div className="mt-2">
              <TagBadge tag={{ name: name || "Example", color }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wide text-slate-500">WHEN SHOULD THIS TAG BE APPLIED? (optional)</label>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. Apply this tag when the customer asks about a delayed or missing delivery"
              rows={3}
              maxLength={500}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
            <p className="text-xs text-slate-400">AI uses this to determine when the tag is relevant. If left empty, AI will judge based on the tag name.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wide text-slate-500">CATEGORY (optional)</label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Orders, Shipping"
              maxLength={50}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : initial ? "Save changes" : "Create tag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TagsSettings() {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/tags");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not fetch tags.");
      setTags(json.tags ?? []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTags(); }, [fetchTags]);

  const handleCreate = useCallback(async (data) => {
    const res = await fetch("/api/settings/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Failed to create tag.");
    setTags((prev) => [...prev, json.tag]);
    toast.success("Tag created.");
  }, []);

  const handleEdit = useCallback(async (data) => {
    const res = await fetch("/api/settings/tags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editTarget.id, ...data }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Failed to update tag.");
    setTags((prev) => prev.map((t) => (t.id === json.tag.id ? json.tag : t)));
    toast.success("Tag updated.");
  }, [editTarget]);

  const handleToggleActive = useCallback(async (tag) => {
    if (togglingId) return;
    setTogglingId(tag.id);
    try {
      const res = await fetch("/api/settings/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tag.id, is_active: !tag.is_active }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not update tag.");
      setTags((prev) => prev.map((t) => (t.id === json.tag.id ? json.tag : t)));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTogglingId(null);
    }
  }, [togglingId]);

  const handleDelete = useCallback(async (tag) => {
    if (deletingId) return;
    setDeletingId(tag.id);
    try {
      const res = await fetch("/api/settings/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tag.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to delete tag.");
      if (json.deactivated) {
        setTags((prev) => prev.map((t) => (t.id === json.tag.id ? json.tag : t)));
        toast.info("Tag is in use and has been deactivated instead of deleted.");
      } else {
        setTags((prev) => prev.filter((t) => t.id !== tag.id));
        toast.success("Tag deleted.");
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
    }
  }, [deletingId]);

  // Gruppér tags efter kategori
  const grouped = tags.reduce((acc, tag) => {
    const key = tag.category || "";
    if (!acc[key]) acc[key] = [];
    acc[key].push(tag);
    return acc;
  }, {});
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, "da");
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Tags</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Create tags to categorize tickets. AI automatically applies relevant tags as soon as a new email is received.
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditTarget(null); setModalOpen(true); }}>
          <Plus className="w-4 h-4 mr-1.5" />
          New tag
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-8 text-center">Loading tags…</div>
      ) : tags.length === 0 ? (
        <div className="border border-dashed rounded-xl p-10 text-center text-slate-400">
          <Tag className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No tags yet</p>
          <p className="text-xs mt-1">Create your first tag to get started.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupKeys.map((groupKey) => (
            <div key={groupKey || "__none__"}>
              {groupKey && (
                <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase mb-2">
                  {groupKey}
                </p>
              )}
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {grouped[groupKey].map((tag) => (
                  <div key={tag.id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      <div className="min-w-0">
                        <span className={`text-sm font-medium ${tag.is_active ? "text-slate-800" : "text-slate-400 line-through"}`}>
                          {tag.name}
                        </span>
                        {!tag.is_active && (
                          <span className="ml-2 text-xs text-slate-400 italic">inactive</span>
                        )}
                        {tag.ai_prompt && (
                          <p className="text-xs text-slate-400 truncate max-w-xs mt-0.5">{tag.ai_prompt}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(tag)}
                        disabled={!!togglingId}
                        className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded transition-colors"
                      >
                        {tag.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditTarget(tag); setModalOpen(true); }}
                        className="p-1.5 text-slate-400 hover:text-slate-700 rounded transition-colors"
                        aria-label="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(tag)}
                        disabled={deletingId === tag.id}
                        className="p-1.5 text-slate-400 hover:text-red-500 rounded transition-colors"
                        aria-label="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <TagFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={editTarget ? handleEdit : handleCreate}
        initial={editTarget}
      />
    </div>
  );
}
