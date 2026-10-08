"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Power, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsPage,
  SettingsRowMenu,
  SettingsTable,
  SettingsTableRow,
} from "@/components/settings/ui/settings-layout";
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
            <label className="text-xs font-semibold tracking-wide text-muted-foreground">NAME</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Return"
              maxLength={50}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wide text-muted-foreground">COLOR</label>
            <ColorPicker value={color} onChange={setColor} />
            <div className="mt-2">
              <TagBadge tag={{ name: name || "Example", color }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wide text-muted-foreground">WHEN SHOULD THIS TAG BE APPLIED? (optional)</label>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. Apply this tag when the customer asks about a delayed or missing delivery"
              rows={3}
              maxLength={500}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
            <p className="text-xs text-muted-foreground">AI uses this to determine when the tag is relevant. If left empty, AI will judge based on the tag name.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wide text-muted-foreground">CATEGORY (optional)</label>
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
    <SettingsPage
      width="wide"
      title="Tags"
      description="Create tags to categorize tickets. AI automatically applies relevant tags as soon as a new email is received."
      actions={
        <Button size="sm" onClick={() => { setEditTarget(null); setModalOpen(true); }}>
          New tag
        </Button>
      }
    >
      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading tags…</p>
      ) : tags.length === 0 ? (
        <SettingsEmptyState title="No tags yet" description="Create your first tag to get started." />
      ) : (
        groupKeys.map((groupKey) => (
          <SettingsGroup key={groupKey || "__none__"} title={groupKey || undefined}>
            <SettingsTable
              template="minmax(200px,1fr) minmax(0,1.4fr) 40px"
              columns={[
                { key: "name", label: "Name" },
                { key: "rule", label: "AI rule" },
                { key: "actions", label: "" },
              ]}
            >
              {grouped[groupKey].map((tag) => (
                <SettingsTableRow key={tag.id} muted={!tag.is_active}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className="truncate font-medium text-foreground">{tag.name}</span>
                    {!tag.is_active ? <Badge variant="neutral" className="shrink-0">Inactive</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{tag.ai_prompt || ""}</p>
                  <SettingsRowMenu>
                    <DropdownMenuItem onSelect={() => { setEditTarget(tag); setModalOpen(true); }}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!!togglingId} onSelect={() => handleToggleActive(tag)}>
                      <Power className="mr-2 h-4 w-4" />
                      {tag.is_active ? "Deactivate" : "Activate"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-danger-foreground focus:text-danger-foreground"
                      disabled={deletingId === tag.id}
                      onSelect={() => handleDelete(tag)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </SettingsRowMenu>
                </SettingsTableRow>
              ))}
            </SettingsTable>
          </SettingsGroup>
        ))
      )}

      <TagFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={editTarget ? handleEdit : handleCreate}
        initial={editTarget}
      />
    </SettingsPage>
  );
}
