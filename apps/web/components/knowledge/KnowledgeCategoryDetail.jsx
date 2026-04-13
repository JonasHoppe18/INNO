"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";

const DEFAULT_CATEGORIES = {
  "product-questions": {
    label: "Product Questions",
    icon: Package,
    description: "Technical support, firmware, product usage",
    placeholder: "e.g. firmware update procedure, known issues, step-by-step guides...",
  },
  returns: {
    label: "Returns & Refunds",
    icon: RotateCcw,
    description: "Return procedures, refunds, exchanges",
    placeholder: "e.g. how to start a return, who pays for shipping...",
  },
  shipping: {
    label: "Shipping & Delivery",
    icon: Truck,
    description: "Delivery times, tracking, shipping costs",
    placeholder: "e.g. delivery times per country, what happens with delayed orders...",
  },
  general: {
    label: "General",
    icon: MessageSquare,
    description: "Contact info, opening hours, other questions",
    placeholder: "e.g. opening hours, contact details, office address...",
  },
};

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

function SnippetModal({ open, onClose, onSave, shopId, categorySlug, productId, productTitle, initial }) {
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
        category: categorySlug,
        ...(productId ? { product_id: productId, product_title: productTitle } : {}),
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

  const categoryMeta = DEFAULT_CATEGORIES[categorySlug];

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
              placeholder="e.g. Firmware update A-Spire"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Content</Label>
            <Textarea
              placeholder={categoryMeta?.placeholder || "Describe the answer to a question customers typically ask..."}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="resize-none text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Be precise and specific — the AI uses this directly to answer customers.
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

function getInitials(title) {
  return String(title || "")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase() || "?";
}

function ProductCard({ product, onClick }) {
  const initials = getInitials(product.title);
  return (
    <Card className="group cursor-pointer transition-colors hover:bg-muted/50" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{product.title}</p>
            {product.price && (
              <p className="text-xs text-muted-foreground">
                {Number(product.price).toLocaleString("da-DK", { minimumFractionDigits: 2 })} kr
              </p>
            )}
          </div>
          {product.snippet_count > 0 && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {product.snippet_count}
            </span>
          )}
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </CardContent>
    </Card>
  );
}

function ProductsSection({ shopId, categorySlug }) {
  const router = useRouter();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/knowledge/products", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setProducts(d?.products ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? products.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
    : products;

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-md shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!products.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No products found. Sync your Shopify products under settings.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {products.length > 8 && (
        <Input
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onClick={() =>
              router.push(
                `/knowledge/${categorySlug}/${encodeURIComponent(product.external_id)}?title=${encodeURIComponent(product.title)}`
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function SnippetList({ snippets, loading, onEdit, onDelete, onAdd, icon: Icon }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!snippets.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted mb-3">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">No snippets yet</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">
          Add knowledge the AI uses when answering questions in this category.
        </p>
        <Button className="mt-4" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add first snippet
        </Button>
      </div>
    );
  }

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

function decodeEntities(text) {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function PolicyEditor({ title, description, field, initialContent, onSynced }) {
  const [value, setValue] = useState(() => decodeEntities(initialContent));
  const [saved, setSaved] = useState(() => decodeEntities(initialContent));
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const decoded = decodeEntities(initialContent);
    setValue(decoded);
    setSaved(decoded);
  }, [initialContent]);

  const isDirty = value !== saved;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/knowledge/shop-policy", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error("Could not save policy");
      setSaved(value);
      toast.success("Policy saved");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/knowledge/sync-policies", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Could not sync from Shopify");
      toast.success("Policy synced from Shopify");
      onSynced?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={handleSync}
            disabled={syncing}
          >
            <RotateCcw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync from Shopify"}
          </Button>
        </div>
        <div className="px-6 py-5">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={16}
            placeholder="Click here to write your policy…"
            className="min-h-[240px] resize-y text-sm leading-relaxed border-0 shadow-none p-0 focus-visible:ring-0 bg-transparent"
          />
        </div>
      </div>

      <StickySaveBar
        isVisible={isDirty}
        isSaving={saving}
        onSave={handleSave}
        onDiscard={() => setValue(saved)}
      />
    </>
  );
}

export function KnowledgeCategoryDetail({ categorySlug }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const labelFromParams = searchParams.get("label");

  const categoryMeta = DEFAULT_CATEGORIES[categorySlug];
  const label =
    categoryMeta?.label ||
    labelFromParams ||
    categorySlug.charAt(0).toUpperCase() + categorySlug.slice(1).replace(/-/g, " ");
  const Icon = categoryMeta ? categoryMeta.icon : Tag;
  const isProductCategory = categorySlug === "product-questions";
  const hasPolicySection = categorySlug === "returns" || categorySlug === "shipping";

  const [snippets, setSnippets] = useState([]);
  const [shopId, setShopId] = useState(null);
  const [loading, setLoading] = useState(!hasPolicySection);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState(null);
  const [shopPolicy, setShopPolicy] = useState(null);

  const fetchSnippets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/knowledge/snippets?category=${encodeURIComponent(categorySlug)}`,
        { credentials: "include" }
      );
      const data = await res.json().catch(() => ({}));
      const all = data?.snippets ?? [];
      setSnippets(isProductCategory ? all.filter((s) => !s.product_id) : all);
      if (data?.shop_id) setShopId(data.shop_id);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [categorySlug, isProductCategory]);

  useEffect(() => {
    if (!hasPolicySection) fetchSnippets();
  }, [fetchSnippets, hasPolicySection]);

  const fetchShopPolicy = useCallback(() => {
    fetch("/api/knowledge/shop-policy", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setShopPolicy(d))
      .catch(() => setShopPolicy({}));
  }, []);

  useEffect(() => {
    if (!hasPolicySection) return;
    fetchShopPolicy();
  }, [hasPolicySection, fetchShopPolicy]);

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
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => router.push("/knowledge")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 min-w-0">
          <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">{label}</h1>
            {categoryMeta?.description && (
              <p className="text-sm text-muted-foreground">{categoryMeta.description}</p>
            )}
          </div>
        </div>
        {!isProductCategory && !hasPolicySection && (
          <div className="ml-auto">
            <Button onClick={() => { setEditingSnippet(null); setModalOpen(true); }}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add snippet
            </Button>
          </div>
        )}
      </div>

      {/* Policy pages — returns & shipping */}
      {hasPolicySection && (
        shopPolicy === null ? (
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="px-6 py-5 border-b space-y-2">
              <Skeleton className="h-5 w-1/4" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <div className="px-6 py-5 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ) : categorySlug === "returns" ? (
          <PolicyEditor
            title="Return Policy"
            description="Shown to customers and used by AI when answering return & refund questions."
            field="policy_refund"
            initialContent={shopPolicy.policy_refund}
            onSynced={fetchShopPolicy}
          />
        ) : (
          <PolicyEditor
            title="Shipping Policy"
            description="Shown to customers and used by AI when answering shipping & delivery questions."
            field="policy_shipping"
            initialContent={shopPolicy.policy_shipping}
            onSynced={fetchShopPolicy}
          />
        )
      )}

      {/* Products section — product-questions only */}
      {isProductCategory && (
        <>
          <div>
            <h2 className="text-sm font-medium mb-3">Products</h2>
            <ProductsSection shopId={shopId} categorySlug={categorySlug} />
          </div>
          <Separator />
          <div>
            <h2 className="text-sm font-medium mb-1">General product knowledge</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Knowledge that applies across all products — not product-specific.
            </p>
          </div>
        </>
      )}

      {/* Snippets — not shown on policy pages */}
      {!hasPolicySection && (
        <SnippetList
          snippets={snippets}
          loading={loading}
          onEdit={(s) => { setEditingSnippet(s); setModalOpen(true); }}
          onDelete={handleDelete}
          onAdd={() => { setEditingSnippet(null); setModalOpen(true); }}
          icon={Icon}
        />
      )}

      <SnippetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={fetchSnippets}
        shopId={shopId}
        categorySlug={categorySlug}
        productId={null}
        productTitle={null}
        initial={editingSnippet}
      />
    </div>
  );
}
