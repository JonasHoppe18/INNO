"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Package,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function SnippetCard({ snippet, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggle = () => setExpanded((v) => !v);

  return (
    <div className="group">
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggle()}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
        />
        <span className="text-sm font-medium flex-1 truncate">{snippet.title}</span>
        <div
          className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(snippet)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <Button variant="destructive" size="sm" className="h-7 text-xs px-2" onClick={() => onDelete(snippet.snippet_id)}>
                Delete
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-10 pb-4">
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {snippet.content}
          </p>
        </div>
      )}
    </div>
  );
}

function SnippetList({ snippets, onEdit, onDelete, onAdd }) {
  return (
    <div className="rounded-lg border divide-y overflow-hidden">
      {snippets.map((snippet) => (
        <SnippetCard key={snippet.snippet_id} snippet={snippet} onEdit={onEdit} onDelete={onDelete} />
      ))}
      <div
        role="button"
        tabIndex={0}
        onClick={onAdd}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onAdd()}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        <span className="text-sm">Add snippet</span>
      </div>
    </div>
  );
}

function SnippetModal({ open, onClose, onSave, shopId, productId, productTitle, initial }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [content, setContent] = useState(initial?.content || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initial?.title || "");
      setContent(initial?.content || "");
    }
  }, [open, initial]);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const body = {
        shop_id: shopId,
        title: title.trim(),
        content: content.trim(),
        category: "product-questions",
        product_id: productId,
        product_title: productTitle,
      };
      if (initial?.snippet_id) {
        const res = await fetch("/api/knowledge/snippets", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: initial.snippet_id, ...body }),
        });
        if (!res.ok) throw new Error("Could not update snippet");
      } else {
        const res = await fetch("/api/knowledge/snippets", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Could not save snippet");
      }
      onSave();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial?.snippet_id ? "Edit snippet" : "Add snippet"}
            {productTitle ? ` — ${productTitle}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              placeholder="e.g. Firmware update, Pairing with iOS, Known issues..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Content</Label>
            <Textarea
              placeholder="Describe the answer precisely. The AI uses this directly to answer customers asking about this product."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="resize-none text-sm"
            />
            <p className="text-xs text-muted-foreground">
              The more specific and precise you are, the better the AI&apos;s answers will be.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!title.trim() || !content.trim() || saving}>
            {saving ? "Saving..." : initial?.snippet_id ? "Save changes" : "Add snippet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KnowledgeProductDetail({ productId, productTitle }) {
  const router = useRouter();
  const [snippets, setSnippets] = useState([]);
  const [shopId, setShopId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState(null);

  const fetchSnippets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/knowledge/snippets?category=product-questions&product_id=${encodeURIComponent(productId)}`,
        { credentials: "include" }
      );
      const data = await res.json().catch(() => ({}));
      setSnippets(data?.snippets ?? []);
      if (data?.shop_id) setShopId(data.shop_id);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    fetchSnippets();
  }, [fetchSnippets]);

  const handleDelete = async (snippetId) => {
    try {
      const res = await fetch("/api/knowledge/snippets", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: snippetId, shop_id: shopId }),
      });
      if (!res.ok) throw new Error("Could not delete snippet");
      toast.success("Snippet deleted");
      setSnippets((prev) => prev.filter((s) => s.snippet_id !== snippetId));
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => router.push("/knowledge/product-questions")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 min-w-0">
          <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
            <Package className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-lg font-semibold leading-tight truncate">
                {productTitle || productId}
              </h1>
              {!loading && snippets.length > 0 && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {snippets.length}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Product-specific knowledge</p>
          </div>
        </div>
        <div className="ml-auto">
          <Button onClick={() => { setEditingSnippet(null); setModalOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add snippet
          </Button>
        </div>
      </div>

      {/* Snippets */}
      {loading ? (
        <div className="rounded-lg border divide-y overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-3.5 w-3.5 rounded shrink-0" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : snippets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
            <Package className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No snippets for this product yet</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-xs">
            Add product-specific knowledge — firmware procedures, known issues, FAQs — that the AI uses
            when customers ask about {productTitle || "this product"}.
          </p>
          <Button className="mt-4" onClick={() => { setEditingSnippet(null); setModalOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add first snippet
          </Button>
        </div>
      ) : (
        <SnippetList
          snippets={snippets}
          onEdit={(s) => { setEditingSnippet(s); setModalOpen(true); }}
          onDelete={handleDelete}
          onAdd={() => { setEditingSnippet(null); setModalOpen(true); }}
        />
      )}

      <SnippetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={fetchSnippets}
        shopId={shopId}
        productId={productId}
        productTitle={productTitle}
        initial={editingSnippet}
      />
    </div>
  );
}
