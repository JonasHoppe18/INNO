"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  FileText,
  Filter,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ISSUE_TYPE_LABEL_MAP,
  ISSUE_TYPE_VALUES,
} from "@/lib/knowledge/issue-types";
import { SnippetEditor } from "./SnippetEditor";

const KNOWLEDGE_TYPE_LABELS = {
  fact: "Fact",
  procedure: "Guide",
  policy: "Policy",
  tone_example: "Tone example",
  background: "Background",
  saved_reply: "Saved reply",
};

const CATEGORY_LABELS = {
  "product-questions": "Product Questions",
  returns: "Returns & Refunds",
  shipping: "Shipping & Delivery",
  general: "General",
};

function formatRelative(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return date.toLocaleDateString();
}

function FilterChip({ label, onClear }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="text-indigo-400 hover:text-indigo-600"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

function MultiSelectFilter({ label, options, selected, onChange }) {
  const toggle = (value) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };
  const count = selected.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-600 transition-colors hover:border-gray-300">
          <Filter className="h-3 w-3 text-gray-400" />
          {label}
          {count > 0 && (
            <span className="ml-0.5 rounded-full bg-indigo-100 px-1.5 text-[10px] font-medium text-indigo-600">
              {count}
            </span>
          )}
          <ChevronDown className="h-3 w-3 text-gray-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-gray-400">
          {label}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={selected.includes(opt.value)}
            onCheckedChange={() => toggle(opt.value)}
            onSelect={(e) => e.preventDefault()}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SnippetEditDialog({ snippet, shopId, open, onOpenChange, onSaved, onDeleted }) {
  if (!snippet && !open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(96vw,900px)] max-w-none overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b border-gray-100 px-5 py-3">
          <DialogTitle className="text-[14px] font-semibold">
            Edit snippet
          </DialogTitle>
        </DialogHeader>
        <div className="h-[min(80vh,720px)] overflow-hidden">
          {snippet && (
            <SnippetEditor
              key={snippet.snippet_id}
              snippet={snippet}
              category={snippet.category}
              productId={snippet.product_id}
              productTitle={snippet.product_title || null}
              shopId={shopId}
              onSaved={(saved) => {
                onSaved?.(saved);
              }}
              onDeleted={(id) => {
                onDeleted?.(id);
                onOpenChange(false);
              }}
              onCancel={() => onOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AllSnippetsClient() {
  const router = useRouter();
  const [snippets, setSnippets] = useState([]);
  const [shopId, setShopId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [productFilter, setProductFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [issueFilter, setIssueFilter] = useState([]);
  const [formatFilter, setFormatFilter] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const loadSnippets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/knowledge/snippets?include_all=1", {
        credentials: "include",
      });
      const data = await res.json();
      setSnippets(Array.isArray(data?.snippets) ? data.snippets : []);
      if (data?.shop_id) setShopId(data.shop_id);
    } catch {
      setSnippets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSnippets();
  }, [loadSnippets]);

  const productOptions = useMemo(() => {
    const set = new Map();
    for (const s of snippets) {
      if (s.product_id) {
        set.set(s.product_id, {
          value: s.product_id,
          label: s.product_title || s.product_id,
        });
      }
    }
    return [...set.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [snippets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snippets.filter((s) => {
      if (categoryFilter.length && !categoryFilter.includes(s.category || "uncategorized")) return false;
      if (productFilter.length) {
        if (!s.product_id || !productFilter.includes(s.product_id)) return false;
      }
      if (typeFilter.length && !typeFilter.includes(s.usable_as || "untyped")) return false;
      if (issueFilter.length) {
        const has = Array.isArray(s.issue_types) && s.issue_types.some((t) => issueFilter.includes(t));
        if (!has) return false;
      }
      if (formatFilter.length && !formatFilter.includes(s.format || "prose")) return false;
      if (q) {
        const haystack = [
          s.title,
          s.content,
          s.question,
          s.answer,
          s.product_title,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [snippets, search, categoryFilter, productFilter, typeFilter, issueFilter, formatFilter]);

  const handleOpenSnippet = (snippet) => {
    setEditing(snippet);
    setEditorOpen(true);
  };

  const handleSaved = (saved) => {
    setSnippets((prev) =>
      prev.map((s) => (s.snippet_id === saved.snippet_id ? { ...s, ...saved } : s))
    );
    setEditing((prev) => (prev ? { ...prev, ...saved } : prev));
  };

  const handleDeleted = (deletedId) => {
    setSnippets((prev) => prev.filter((s) => s.snippet_id !== deletedId));
    setEditing(null);
  };

  const clearAllFilters = () => {
    setSearch("");
    setCategoryFilter([]);
    setProductFilter([]);
    setTypeFilter([]);
    setIssueFilter([]);
    setFormatFilter([]);
  };

  const hasAnyFilter = Boolean(
    search ||
      categoryFilter.length ||
      productFilter.length ||
      typeFilter.length ||
      issueFilter.length ||
      formatFilter.length,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => router.push("/knowledge")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-gray-900">
            All snippets
          </h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Search and filter every snippet across categories and products.
          </p>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-300" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, content, question, answer..."
              className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-[12.5px] text-gray-700 placeholder:text-gray-300 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <MultiSelectFilter
            label="Category"
            selected={categoryFilter}
            onChange={setCategoryFilter}
            options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <MultiSelectFilter
            label="Knowledge type"
            selected={typeFilter}
            onChange={setTypeFilter}
            options={Object.entries(KNOWLEDGE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <MultiSelectFilter
            label="Issue type"
            selected={issueFilter}
            onChange={setIssueFilter}
            options={ISSUE_TYPE_VALUES.map((v) => ({ value: v, label: ISSUE_TYPE_LABEL_MAP[v] || v }))}
          />
          <MultiSelectFilter
            label="Format"
            selected={formatFilter}
            onChange={setFormatFilter}
            options={[
              { value: "qa", label: "Q&A" },
              { value: "prose", label: "Prose" },
            ]}
          />
          {productOptions.length > 0 && (
            <MultiSelectFilter
              label="Product"
              selected={productFilter}
              onChange={setProductFilter}
              options={productOptions}
            />
          )}
        </div>
        {hasAnyFilter && (
          <div className="flex flex-wrap items-center gap-1.5">
            {search && <FilterChip label={`"${search}"`} onClear={() => setSearch("")} />}
            {categoryFilter.map((v) => (
              <FilterChip
                key={`cat-${v}`}
                label={CATEGORY_LABELS[v] || v}
                onClear={() => setCategoryFilter((p) => p.filter((x) => x !== v))}
              />
            ))}
            {typeFilter.map((v) => (
              <FilterChip
                key={`type-${v}`}
                label={KNOWLEDGE_TYPE_LABELS[v] || v}
                onClear={() => setTypeFilter((p) => p.filter((x) => x !== v))}
              />
            ))}
            {issueFilter.map((v) => (
              <FilterChip
                key={`issue-${v}`}
                label={ISSUE_TYPE_LABEL_MAP[v] || v}
                onClear={() => setIssueFilter((p) => p.filter((x) => x !== v))}
              />
            ))}
            {formatFilter.map((v) => (
              <FilterChip
                key={`format-${v}`}
                label={v === "qa" ? "Q&A" : "Prose"}
                onClear={() => setFormatFilter((p) => p.filter((x) => x !== v))}
              />
            ))}
            {productFilter.map((v) => {
              const opt = productOptions.find((o) => o.value === v);
              return (
                <FilterChip
                  key={`prod-${v}`}
                  label={opt?.label || v}
                  onClear={() => setProductFilter((p) => p.filter((x) => x !== v))}
                />
              );
            })}
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-[11px] text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
        <p className="text-[11px] text-gray-400">
          {loading
            ? "Loading..."
            : `Showing ${filtered.length} of ${snippets.length} snippet${snippets.length === 1 ? "" : "s"}`}
        </p>
      </div>

      {/* Snippet list */}
      {loading ? (
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 py-16 text-center">
          <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
            <FileText className="h-5 w-5 text-gray-400" />
          </div>
          <p className="text-[13px] font-medium text-gray-700">
            {hasAnyFilter ? "No snippets match your filters" : "No snippets yet"}
          </p>
          {hasAnyFilter && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="mt-2 text-[11.5px] text-indigo-600 hover:text-indigo-700"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <ul className="divide-y divide-gray-100">
            {filtered.map((s) => (
              <li key={s.snippet_id}>
                <button
                  type="button"
                  onClick={() => handleOpenSnippet(s)}
                  className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {s.format === "qa" && (
                        <span className="shrink-0 rounded-sm bg-indigo-50 px-1 text-[9px] font-semibold uppercase tracking-wide text-indigo-500">
                          Q&amp;A
                        </span>
                      )}
                      <span className="truncate text-[13px] font-medium text-gray-800">
                        {s.title}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-gray-500">
                      {(s.format === "qa" && s.answer
                        ? s.answer
                        : s.content || ""
                      )
                        .replace(/\s+/g, " ")
                        .slice(0, 140)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {s.category && (
                        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9.5px] text-gray-500">
                          {CATEGORY_LABELS[s.category] || s.category}
                        </span>
                      )}
                      {s.product_title && (
                        <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9.5px] text-blue-600">
                          {s.product_title}
                        </span>
                      )}
                      {s.usable_as && (
                        <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[9.5px] text-purple-600">
                          {KNOWLEDGE_TYPE_LABELS[s.usable_as] || s.usable_as}
                        </span>
                      )}
                      {(s.issue_types || []).slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-green-50 px-1.5 py-0.5 text-[9.5px] text-green-700"
                        >
                          {ISSUE_TYPE_LABEL_MAP[t] || t}
                        </span>
                      ))}
                      {(s.issue_types || []).length > 3 && (
                        <span className="text-[9.5px] text-gray-400">
                          +{s.issue_types.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10.5px] text-gray-400">
                      {formatRelative(s.updated_at || s.created_at)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SnippetEditDialog
        snippet={editing}
        shopId={shopId}
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditing(null);
        }}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </div>
  );
}

export default AllSnippetsClient;
