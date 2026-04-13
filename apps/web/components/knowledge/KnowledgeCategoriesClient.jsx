"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  Truck,
  ChevronRight,
  BookOpen,
  BookMarked,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const ICON_MAP = {
  Package,
  RotateCcw,
  Truck,
  MessageSquare,
  Tag,
  BookOpen,
};

function CategoryIcon({ name, className }) {
  const Icon = ICON_MAP[name] || Tag;
  return <Icon className={className} />;
}

function CategoryCard({ category, onClick }) {
  return (
    <Card
      className="group cursor-pointer transition-colors hover:bg-muted/50"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <CategoryIcon name={category.icon} className="h-4 w-4 text-muted-foreground" />
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-sm">{category.label}</CardTitle>
        {category.description && (
          <CardDescription className="mt-1 text-xs line-clamp-2">
            {category.description}
          </CardDescription>
        )}
      </CardContent>
    </Card>
  );
}

function SavedRepliesSection() {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = new, object = edit
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const loadReplies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/saved-replies", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      setReplies(Array.isArray(data?.replies) ? data.replies : []);
    } catch {
      setReplies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReplies(); }, [loadReplies]);

  const openNew = () => {
    setEditing(null);
    setTitle(""); setContent(""); setCategory("");
    setModalOpen(true);
  };

  const openEdit = (reply) => {
    setEditing(reply);
    setTitle(reply.title || "");
    // Strip HTML tags for plain text editing
    setContent(String(reply.content || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
    setCategory(reply.category || "");
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const body = { title: title.trim(), content: content.trim(), category: category.trim() || null };
      if (editing?.id) {
        const res = await fetch("/api/settings/saved-replies", {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editing.id, ...body }),
        });
        if (!res.ok) throw new Error("Could not update");
      } else {
        const res = await fetch("/api/settings/saved-replies", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Could not create");
      }
      toast.success(editing?.id ? "Saved reply updated" : "Saved reply created");
      setModalOpen(false);
      loadReplies();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      const res = await fetch("/api/settings/saved-replies", {
        method: "DELETE", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Could not delete");
      toast.success("Deleted");
      setReplies((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Saved Replies</h2>
          {replies.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {replies.length}
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={openNew}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New reply
        </Button>
      </div>

      {loading ? (
        <div className="rounded-lg border divide-y overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4 ml-auto" />
            </div>
          ))}
        </div>
      ) : replies.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted mb-3">
            <BookMarked className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No saved replies yet</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-xs">
            Create reusable replies your team can insert into drafts with one click.
          </p>
          <Button className="mt-4" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create first reply
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border divide-y overflow-hidden">
          {replies.map((reply) => (
            <div key={reply.id} className="group flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">{reply.title}</span>
                  {reply.category && (
                    <Badge variant="secondary" className="text-xs shrink-0">{reply.category}</Badge>
                  )}
                  {!reply.is_active && (
                    <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">Inactive</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {String(reply.content || "").replace(/<[^>]+>/g, "").slice(0, 80)}
                </p>
              </div>
              {reply.use_count > 0 && (
                <span className="text-xs text-muted-foreground shrink-0">{reply.use_count}×</span>
              )}
              <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(reply)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {confirmDeleteId === reply.id ? (
                  <div className="flex items-center gap-1">
                    <Button variant="destructive" size="sm" className="h-7 text-xs px-2"
                      disabled={deletingId === reply.id}
                      onClick={() => handleDelete(reply.id)}>
                      Delete
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs px-2"
                      onClick={() => setConfirmDeleteId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDeleteId(reply.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit saved reply" : "New saved reply"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input placeholder="e.g. Firmware update guide" value={title}
                onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Category <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input placeholder="e.g. Returns, Technical" value={category}
                onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Content</Label>
              <Textarea placeholder="Write the reply text here…" value={content}
                onChange={(e) => setContent(e.target.value)} rows={8}
                className="resize-none text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!title.trim() || !content.trim() || saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function KnowledgeCategoriesClient() {
  const router = useRouter();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/knowledge/categories", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      setCategories(data?.categories ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleCreate = () => {
    const label = newLabel.trim();
    if (!label) return;
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9æøå\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    setCreateOpen(false);
    setNewLabel("");
    router.push(`/knowledge/${slug}?label=${encodeURIComponent(label)}&new=1`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage what your AI knows about your store
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New category
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-9 w-9 rounded-md" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((cat) => (
            <CategoryCard
              key={cat.slug}
              category={cat}
              onClick={() => router.push(`/knowledge/${cat.slug}`)}
            />
          ))}
          <Card
            className="cursor-pointer border-dashed hover:bg-muted/30 transition-colors"
            onClick={() => setCreateOpen(true)}
          >
            <CardContent className="flex flex-col items-center justify-center h-full min-h-[120px] text-muted-foreground gap-2 pt-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed">
                <Plus className="h-4 w-4" />
              </div>
              <span className="text-sm">New category</span>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />
      <SavedRepliesSection />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create new category</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                placeholder="e.g. Warranty, Technical support..."
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newLabel.trim() || creating}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
