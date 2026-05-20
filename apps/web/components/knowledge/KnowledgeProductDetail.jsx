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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const VALID_USABLE_AS = ["policy", "procedure", "fact", "tone_example"];

const USABLE_AS_BADGE = {
  fact:         { label: "FAQ / Product info", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  procedure:    { label: "Procedure",          color: "bg-blue-50 text-blue-700 border-blue-200" },
  policy:       { label: "Policy",             color: "bg-red-50 text-red-700 border-red-200" },
  tone_example: { label: "Tone example",       color: "bg-purple-50 text-purple-700 border-purple-200" },
};

const ISSUE_TYPE_OPTIONS = [
  "connectivity", "factory_reset", "audio", "battery", "firmware",
  "microphone", "pairing", "physical_damage", "return", "refund",
  "shipping", "tracking", "product_specs", "general",
];

function SnippetCard({ snippet, onEdit, onDelete, onTagsUpdated, shopId }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [localProducts, setLocalProducts] = useState(snippet.products || []);
  const [localIssueTypes, setLocalIssueTypes] = useState(snippet.issue_types || []);
  const [tagSaving, setTagSaving] = useState(false);
  const [newProduct, setNewProduct] = useState("");

  const toggle = () => setExpanded((v) => !v);

  const saveTags = async (products, issueTypes) => {
    setTagSaving(true);
    try {
      await fetch("/api/knowledge/snippets", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: snippet.snippet_id,
          shop_id: shopId,
          title: snippet.title,
          content: snippet.content,
          category: "product-questions",
          ...(snippet.product_id ? { product_id: snippet.product_id } : {}),
          ...(snippet.usable_as ? { usable_as: snippet.usable_as } : {}),
          products,
          issue_types: issueTypes,
        }),
      });
      onTagsUpdated?.({ ...snippet, products, issue_types: issueTypes });
    } catch { /* ignore */ } finally {
      setTagSaving(false);
    }
  };

  const toggleIssueType = (t) => {
    const next = localIssueTypes.includes(t) ? localIssueTypes.filter((x) => x !== t) : [...localIssueTypes, t];
    setLocalIssueTypes(next);
    saveTags(localProducts, next);
  };

  const removeProduct = (p) => {
    const next = localProducts.filter((x) => x !== p);
    setLocalProducts(next);
    saveTags(next, localIssueTypes);
  };

  const addProduct = (val) => {
    const v = val.trim().toLowerCase();
    if (!v || localProducts.includes(v)) return;
    const next = [...localProducts, v];
    setLocalProducts(next);
    saveTags(next, localIssueTypes);
  };

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
        <div className="flex shrink-0 items-center gap-1 mr-1">
          {localProducts.map((p) => (
            <span key={p} className="rounded-full bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] text-blue-700">{p}</span>
          ))}
          {localIssueTypes.map((t) => (
            <span key={t} className="rounded-full bg-green-50 border border-green-200 px-1.5 py-0.5 text-[10px] text-green-700">{t}</span>
          ))}
        </div>
        {snippet.usable_as && USABLE_AS_BADGE[snippet.usable_as] && (
          <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${USABLE_AS_BADGE[snippet.usable_as].color}`}>
            {USABLE_AS_BADGE[snippet.usable_as].label}
          </span>
        )}
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
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-10 pb-5 space-y-4">
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {snippet.content}
          </p>
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Tags</span>
              {tagSaving && <span className="text-[10px] text-gray-400">Gemmer...</span>}
            </div>
            <div className="space-y-1.5">
              <span className="text-[11px] text-gray-400">Produkter</span>
              <div className="flex flex-wrap items-center gap-1">
                {localProducts.map((p) => (
                  <span key={p} className="flex items-center gap-0.5 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs text-blue-700">
                    {p}
                    <button type="button" onClick={() => removeProduct(p)} className="ml-0.5 hover:text-blue-500 leading-none">×</button>
                  </span>
                ))}
                <input
                  type="text"
                  value={newProduct}
                  onChange={(e) => setNewProduct(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addProduct(newProduct); setNewProduct(""); } }}
                  placeholder="+ produkt (Enter)"
                  className="h-6 rounded-full border border-dashed border-gray-300 px-2 text-[11px] text-gray-500 placeholder:text-gray-300 focus:outline-none focus:border-blue-300 min-w-[110px]"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-[11px] text-gray-400">Issue types</span>
              <div className="flex flex-wrap gap-1">
                {ISSUE_TYPE_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleIssueType(t)}
                    className={`rounded-full px-2 py-0.5 text-xs border transition-colors ${
                      localIssueTypes.includes(t)
                        ? "bg-green-100 border-green-400 text-green-800"
                        : "bg-gray-50 border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SnippetList({ snippets, onEdit, onDelete, onAdd, onTagsUpdated, shopId }) {
  return (
    <div className="rounded-lg border divide-y overflow-hidden">
      {snippets.map((snippet) => (
        <SnippetCard key={snippet.snippet_id} snippet={snippet} onEdit={onEdit} onDelete={onDelete} onTagsUpdated={onTagsUpdated} shopId={shopId} />
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
  const [usableAs, setUsableAs] = useState(initial?.usable_as || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initial?.title || "");
      setContent(initial?.content || "");
      setUsableAs(VALID_USABLE_AS.includes(initial?.usable_as) ? initial.usable_as : "");
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
        ...(usableAs ? { usable_as: usableAs } : {}),
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
            <Label>Knowledge type</Label>
            <Select
              value={usableAs || "auto"}
              onValueChange={(val) => setUsableAs(val === "auto" ? "" : val)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect — let the AI classify</SelectItem>
                <SelectItem value="fact">FAQ / Product info — use as authoritative fact</SelectItem>
                <SelectItem value="procedure">Procedure — follow these steps exactly</SelectItem>
                <SelectItem value="policy">Policy — authoritative rule (highest priority)</SelectItem>
                <SelectItem value="tone_example">Tone example — style reference only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Content</Label>
            <Textarea
              placeholder="Describe the answer precisely. The AI uses this directly to answer customers asking about this product."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={7}
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
          onTagsUpdated={(updated) => setSnippets((prev) => prev.map((s) => s.snippet_id === updated.snippet_id ? updated : s))}
          shopId={shopId}
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
