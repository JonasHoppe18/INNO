"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Package,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  const preview = snippet.content?.slice(0, 160);
  const isLong = (snippet.content?.length || 0) > 160;

  return (
    <Card className="group">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{snippet.title}</p>
            <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {expanded ? snippet.content : preview}
              {isLong && !expanded && "…"}
            </p>
            {isLong && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded((v) => !v)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setExpanded((v) => !v)}
                className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {expanded ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> Show more</>}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
      </CardContent>
    </Card>
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
            <Label>Titel</Label>
            <Input
              placeholder="e.g. Firmware update, Pairing with iOS, Known issues..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Indhold</Label>
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
            <h1 className="text-lg font-semibold leading-tight truncate">
              {productTitle || productId}
            </h1>
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
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </CardContent>
            </Card>
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
        <div className="space-y-3">
          {snippets.map((snippet) => (
            <SnippetCard
              key={snippet.snippet_id}
              snippet={snippet}
              onEdit={(s) => { setEditingSnippet(s); setModalOpen(true); }}
              onDelete={handleDelete}
            />
          ))}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setEditingSnippet(null); setModalOpen(true); }}>
            <Plus className="h-3.5 w-3.5" />
            Add snippet
          </Button>
        </div>
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
