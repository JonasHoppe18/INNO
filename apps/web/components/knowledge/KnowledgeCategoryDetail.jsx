"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Package,
  RotateCcw,
  Tag,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";
import { KnowledgeDocumentEditorCard } from "./KnowledgeDocumentEditorCard";

function formatRelativeTimestamp(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return date.toLocaleDateString();
}

const DEFAULT_CATEGORIES = {
  "product-questions": {
    label: "Product Questions",
    icon: Package,
    description: "Upload guides, FAQs, and troubleshooting for each product",
    placeholder: "e.g. firmware update procedure, known issues, step-by-step guides...",
  },
  returns: {
    label: "Returns & Refunds",
    icon: RotateCcw,
    description: "Define your return policy and how exchanges work",
    placeholder: "e.g. how to start a return, who pays for shipping...",
  },
  shipping: {
    label: "Shipping & Delivery",
    icon: Truck,
    description: "Set delivery times, costs, and carrier details",
    placeholder: "e.g. delivery times per country, what happens with delayed orders...",
  },
  general: {
    label: "General",
    icon: MessageSquare,
    description: "Hours, contact info, and store-wide answers",
    placeholder: "e.g. opening hours, contact details, office address...",
  },
};


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
                {Number(product.price).toLocaleString("da-DK", { minimumFractionDigits: 2 })}
                {product.currency ? ` ${product.currency}` : ""}
              </p>
            )}
          </div>
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
  const [syncing, setSyncing] = useState(false);

  const loadProducts = useCallback(() => {
    return fetch("/api/knowledge/products", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setProducts(d?.products ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const handleSyncProducts = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/knowledge/sync-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shopId ? { shop_id: shopId } : {}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Sync failed.");
      }
      toast.success(
        `Synced ${Number(payload?.synced ?? 0)} products (${Number(payload?.indexed ?? 0)} indexed).`,
      );
      await loadProducts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }, [shopId, loadProducts]);

  const filtered = products.filter((p) => {
    if (search.trim() && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

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

  const syncButton = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleSyncProducts}
      disabled={syncing}
      className="gap-1.5"
    >
      <RotateCcw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
      {syncing ? "Syncing..." : "Sync products"}
    </Button>
  );

  if (!products.length) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          No products found yet. Sync your Shopify products to get started.
        </p>
        {syncButton}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* General — promoted to the top so brand-wide knowledge is the obvious first stop */}
      <div
        onClick={() => router.push(`/knowledge/${categorySlug}/general`)}
        className="group flex cursor-pointer items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-3.5 transition-all hover:border-indigo-300 hover:bg-indigo-50 active:scale-[0.99] dark:border-indigo-800/60 dark:bg-indigo-950/30 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/50"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-indigo-900 dark:text-indigo-100">General product knowledge</div>
          <div className="text-[11px] text-indigo-500 mt-0.5 dark:text-indigo-400">Applies across all products — start here for brand-wide guides, FAQs, and shared procedures</div>
        </div>
        <svg className="h-4 w-4 text-indigo-400 transition-transform group-hover:translate-x-0.5 dark:text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <h3 className="text-[13px] font-medium text-gray-700 dark:text-gray-300">Product-specific knowledge</h3>
        {syncButton}
      </div>

      {products.length > 8 && (
        <Input
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      )}

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No products match your search.
            </p>
      ) : (
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
      )}
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

function PolicyEditor({ title, description, field, initialContent, shopId, syncedAt, onSynced }) {
  const [value, setValue] = useState(() => decodeEntities(initialContent));
  const [saved, setSaved] = useState(() => decodeEntities(initialContent));
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Policy text from Shopify is usually long — collapse it by default so it
  // doesn't dominate the page, and let the admin expand when they need to
  // read or edit.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const decoded = decodeEntities(initialContent);
    setValue(decoded);
    setSaved(decoded);
  }, [initialContent]);

  const syncedAgo = formatRelativeTimestamp(syncedAt);

  const isDirty = value !== saved;
  // Short policies (or empty) don't benefit from collapse — just render inline.
  const SHORT_POLICY_THRESHOLD = 320;
  const isShort = (value || "").length <= SHORT_POLICY_THRESHOLD;
  const isEffectivelyExpanded = expanded || isDirty || isShort;
  const previewText = (value || "").trim().replace(/\s+/g, " ").slice(0, 240);
  const wordCount = (value || "").trim().split(/\s+/).filter(Boolean).length;

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId || undefined }),
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
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{title}</h2>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-600">
                Pinned
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleSync}
              disabled={syncing}
            >
              <RotateCcw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync from Shopify"}
            </Button>
            {syncedAgo && (
              <p className="text-[10.5px] text-gray-400">
                Last synced {syncedAgo}
              </p>
            )}
          </div>
        </div>
        {isEffectivelyExpanded ? (
          <div className="px-6 py-5">
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={16}
              placeholder="Click here to write your policy…"
              className="min-h-[240px] max-h-[480px] resize-y overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed border-0 shadow-none p-0 focus-visible:ring-0 bg-transparent"
            />
            {!isShort && (
              <div className="mt-3 flex items-center justify-between">
                <p className="text-[11px] text-gray-400">
                  {wordCount.toLocaleString()} word{wordCount === 1 ? "" : "s"}
                </p>
                {!isDirty && (
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="inline-flex items-center gap-1 text-[11.5px] text-gray-500 hover:text-gray-800"
                  >
                    <ChevronDown className="h-3 w-3 rotate-180" />
                    Collapse
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="group flex w-full items-start justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-gray-50/60 dark:hover:bg-gray-800/30"
          >
            <div className="min-w-0 flex-1">
              {previewText ? (
                <>
                  <p className="line-clamp-3 text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
                    {previewText}
                    {(value || "").length > previewText.length ? "…" : ""}
                  </p>
                  <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
                    {wordCount.toLocaleString()} word{wordCount === 1 ? "" : "s"} · click to expand and edit
                  </p>
                </>
              ) : (
                <p className="text-[12.5px] text-gray-400 dark:text-gray-500">
                  No policy yet — click to add one, or sync from Shopify.
                </p>
              )}
            </div>
            <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-400" />
          </button>
        )}
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
  const hasGeneralDocument = categorySlug === "general";

  const [shopId, setShopId] = useState(null);
  const [shopPolicy, setShopPolicy] = useState(null);

  const fetchShopPolicy = useCallback(() => {
    fetch("/api/knowledge/shop-policy", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setShopPolicy(d);
        if (d?.shop_id) setShopId(d.shop_id);
      })
      .catch(() => setShopPolicy({}));
  }, []);

  useEffect(() => {
    if (!hasPolicySection) return;
    fetchShopPolicy();
  }, [hasPolicySection, fetchShopPolicy]);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => router.push("/knowledge")} aria-label="Back to knowledge">
          <ArrowLeft />
        </Button>
        <div className="flex items-center gap-3 min-w-0">
          <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Icon className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
            {categoryMeta?.description && (
              <p className="text-sm text-muted-foreground">{categoryMeta.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Policy pages — returns & shipping */}
      {hasPolicySection && (
        shopPolicy === null ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-1/4" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <div className="overflow-hidden rounded-xl border bg-card">
              <Skeleton className="h-12 w-full rounded-none" />
              <div className="flex flex-col gap-3 p-8">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </div>
        ) : categorySlug === "returns" ? (
          <KnowledgeDocumentEditorCard
            shopId={shopId}
            onShopId={setShopId}
            category="returns"
            documentType="returns_refunds"
            title="Returns & Refunds"
          />
        ) : (
          <PolicyEditor
            title="Shipping Policy"
            description="Shown to customers and used by AI when answering shipping & delivery questions."
            field="policy_shipping"
            initialContent={shopPolicy.policy_shipping}
            shopId={shopId}
            syncedAt={shopPolicy.policy_synced_at}
            onSynced={fetchShopPolicy}
          />
        )
      )}

      {/* General document — store-wide procedures */}
      {hasGeneralDocument && (
        <KnowledgeDocumentEditorCard
          shopId={shopId}
          onShopId={setShopId}
          category="general"
          documentType="general"
          title="General Knowledge"
        />
      )}

      {/* Products section — product-questions only */}
      {isProductCategory && (
        <>
          <div>
            <h2 className="text-sm font-medium mb-3">Products</h2>
            <ProductsSection shopId={shopId} categorySlug={categorySlug} />
          </div>
        </>
      )}

    </div>
  );
}
