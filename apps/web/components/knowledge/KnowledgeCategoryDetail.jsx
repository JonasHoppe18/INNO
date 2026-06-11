"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";
import { ISSUE_TYPE_VALUES, ISSUE_TYPE_LABEL_MAP } from "@/lib/knowledge/issue-types";
import { buildStarters } from "@/lib/knowledge/starters";
import { SnippetEditor } from "./SnippetEditor";
import { KnowledgeDocumentEditorCard } from "./KnowledgeDocumentEditorCard";

const KNOWLEDGE_TYPE_LABELS = {
  fact: "Fact",
  procedure: "Guide",
  policy: "Policy",
  tone_example: "Tone example",
  background: "Background",
  saved_reply: "Saved reply",
};

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
  const count = Number(product.snippet_count) || 0;
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
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              count > 0
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
            title={count === 1 ? "1 snippet" : `${count} snippets`}
          >
            {count}
          </span>
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
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [generalCount, setGeneralCount] = useState(0);

  useEffect(() => {
    fetch("/api/knowledge/products", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setProducts(d?.products ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch(`/api/knowledge/snippets?category=${encodeURIComponent(categorySlug)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const all = Array.isArray(d?.snippets) ? d.snippets : [];
        const generalSnippets = all.filter((s) => !s.product_id);
        const uniqueIds = new Set(generalSnippets.map((s) => s.snippet_id).filter(Boolean));
        setGeneralCount(uniqueIds.size || generalSnippets.length);
      })
      .catch(() => {});
  }, [categorySlug]);

  const filtered = products.filter((p) => {
    if (search.trim() && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (onlyMissing && Number(p.snippet_count) > 0) return false;
    return true;
  });

  const missingCount = products.filter((p) => !Number(p.snippet_count)).length;

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
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            generalCount > 0
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300"
              : "border border-indigo-200 bg-white text-indigo-400 dark:border-indigo-700 dark:bg-transparent dark:text-indigo-500"
          }`}
        >
          {generalCount}
        </span>
        <svg className="h-4 w-4 text-indigo-400 transition-transform group-hover:translate-x-0.5 dark:text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <h3 className="text-[13px] font-medium text-gray-700 dark:text-gray-300">Product-specific knowledge</h3>
        {missingCount > 0 && (
          <button
            type="button"
            onClick={() => setOnlyMissing((v) => !v)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              onlyMissing
                ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:bg-transparent dark:text-gray-400 dark:hover:border-gray-600"
            }`}
          >
            {onlyMissing ? `Showing ${missingCount} without snippets` : `Show only without snippets (${missingCount})`}
          </button>
        )}
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
          {onlyMissing ? "Every product has at least one snippet." : "No products match your search."}
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

function SnippetList({ snippets, loading, onAdd, onOpen, starters, onStarterClick }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (!snippets.length) {
    return (
      <div className="rounded-lg border border-dashed border-indigo-100 bg-indigo-50/30 px-5 py-5 dark:border-indigo-800/40 dark:bg-indigo-950/20">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
          <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">
            Start with a common question
          </p>
        </div>
        <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">
          Click one to pre-fill the editor with the question + Guide type. You only need to write the answer.
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStarterClick(s)}
              className="group flex items-center justify-between rounded-md border border-gray-100 bg-white px-3 py-2 text-left text-[12.5px] text-gray-600 transition-all hover:border-indigo-200 hover:bg-indigo-50/30 hover:text-indigo-700 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-300"
            >
              <span className="truncate">{s}</span>
              <Plus className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover:text-indigo-400 dark:text-gray-600 dark:group-hover:text-indigo-500" />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="mt-3 text-[11.5px] text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline dark:text-gray-500 dark:hover:text-gray-300"
        >
          Or start from scratch
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-card">
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {snippets.map((snippet) => (
          <li key={snippet.snippet_id}>
            <button
              type="button"
              onClick={() => onOpen(snippet)}
              className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {snippet.format === "qa" && (
                    <span className="shrink-0 rounded-sm bg-indigo-50 px-1 text-[9px] font-semibold uppercase tracking-wide text-indigo-500 dark:bg-indigo-950/50 dark:text-indigo-400">
                      Q&amp;A
                    </span>
                  )}
                  <span className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-100">
                    {snippet.title}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11.5px] text-gray-500 dark:text-gray-400">
                  {(snippet.format === "qa" && snippet.answer
                    ? snippet.answer
                    : snippet.content || ""
                  )
                    .replace(/\s+/g, " ")
                    .slice(0, 140)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {snippet.usable_as && (
                    <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[9.5px] text-purple-600 dark:bg-purple-950/40 dark:text-purple-400">
                      {KNOWLEDGE_TYPE_LABELS[snippet.usable_as] || snippet.usable_as}
                    </span>
                  )}
                  {(snippet.issue_types || []).slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-green-50 px-1.5 py-0.5 text-[9.5px] text-green-700 dark:bg-green-950/40 dark:text-green-400"
                    >
                      {ISSUE_TYPE_LABEL_MAP[t] || t}
                    </span>
                  ))}
                  {(snippet.issue_types || []).length > 3 && (
                    <span className="text-[9.5px] text-gray-400 dark:text-gray-500">
                      +{snippet.issue_types.length - 3}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500">
                  {formatRelativeTimestamp(snippet.created_at)}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onAdd}
        className="flex w-full items-center gap-2 border-t border-gray-100 bg-gray-50/40 px-4 py-2.5 text-[12px] text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-800 dark:bg-transparent dark:text-gray-500 dark:hover:bg-gray-800/50 dark:hover:text-gray-300"
      >
        <Plus className="h-3.5 w-3.5" />
        Add snippet
      </button>
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

  const [snippets, setSnippets] = useState([]);
  const [shopId, setShopId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState(null);
  const [seedQuestion, setSeedQuestion] = useState("");
  const [shopPolicy, setShopPolicy] = useState(null);
  const [showLegacySnippets, setShowLegacySnippets] = useState(categorySlug !== "returns");

  const starters = useMemo(
    () => buildStarters({ category: categorySlug }),
    [categorySlug]
  );

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
    fetchSnippets();
  }, [fetchSnippets]);

  useEffect(() => {
    setShowLegacySnippets(categorySlug !== "returns");
  }, [categorySlug]);

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

  const openEditor = (snippet, seed = "") => {
    setEditingSnippet(snippet);
    setSeedQuestion(seed);
    setEditorOpen(true);
  };

  const handleSaved = (saved) => {
    setSnippets((prev) => {
      const exists = prev.find((s) => s.snippet_id === saved.snippet_id);
      if (exists) {
        return prev.map((s) =>
          s.snippet_id === saved.snippet_id ? { ...s, ...saved } : s
        );
      }
      return [saved, ...prev];
    });
    setEditingSnippet((prev) => (prev ? { ...prev, ...saved } : saved));
  };

  const handleDeleted = (deletedId) => {
    setSnippets((prev) => prev.filter((s) => s.snippet_id !== deletedId));
    setEditorOpen(false);
    setEditingSnippet(null);
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
        {!isProductCategory && (
          <div className="ml-auto">
            <Button onClick={() => openEditor(null)}>
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
          <KnowledgeDocumentEditorCard
            shopId={shopId}
            onShopId={setShopId}
            category="returns"
            documentType="returns_refunds"
            title="Returns & Refunds"
            description="Define your return policy and how refunds work"
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

      {/* Products section — product-questions only */}
      {isProductCategory && (
        <>
          <div>
            <h2 className="text-sm font-medium mb-3">Products</h2>
            <ProductsSection shopId={shopId} categorySlug={categorySlug} />
          </div>
        </>
      )}

      {/* Snippets */}
      {!isProductCategory && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Snippets</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {categorySlug === "returns"
                  ? "Legacy snippets remain available for reference and specific cases. Saved replies continue to behave as separate macros."
                  : hasPolicySection
                  ? "The pinned policy above is always sent to the AI. Snippets add specific Q&A the AI uses when retrieval matches a customer's question."
                  : "Add specific Q&A the AI uses when retrieval matches a customer's question."}
              </p>
            </div>
            {categorySlug === "returns" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowLegacySnippets((value) => !value)}
              >
                {showLegacySnippets ? "Hide legacy snippets" : "Show legacy snippets"}
              </Button>
            )}
          </div>
          {showLegacySnippets && (
            <SnippetList
              snippets={snippets}
              loading={loading}
              onAdd={() => openEditor(null)}
              onOpen={(s) => openEditor(s)}
              starters={starters}
              onStarterClick={(seed) => openEditor(null, seed)}
            />
          )}
        </>
      )}

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            setEditingSnippet(null);
            setSeedQuestion("");
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-[min(96vw,900px)] max-w-none overflow-hidden p-0 sm:max-w-none">
          <DialogHeader className="border-b border-gray-100 px-5 py-3">
            <DialogTitle className="text-[14px] font-semibold">
              {editingSnippet ? "Edit snippet" : "New snippet"}
            </DialogTitle>
          </DialogHeader>
          <div className="h-[min(80vh,720px)] overflow-hidden">
            <SnippetEditor
              key={editingSnippet?.snippet_id || `new-${seedQuestion || "blank"}`}
              snippet={editingSnippet}
              seedQuestion={seedQuestion}
              category={categorySlug}
              productId={null}
              productTitle={null}
              shopId={shopId}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
              onCancel={() => setEditorOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
