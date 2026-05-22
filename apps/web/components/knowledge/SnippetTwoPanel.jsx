"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileText, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SnippetList } from "./SnippetList";
import { SnippetEditor } from "./SnippetEditor";
import { CsvSupportKnowledgeImportModal } from "./CsvSupportKnowledgeImportModal";

export function SnippetTwoPanel({
  category,
  productId,
  productTitle,
  productPrice,
  backHref,
  headerIcon,
  headerSubtitle,
}) {
  const router = useRouter();
  const [snippets, setSnippets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [newDraft, setNewDraft] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [shopId, setShopId] = useState(null);

  const loadSnippets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (productId) params.set("product_id", productId);
      const res = await fetch(`/api/knowledge/snippets?${params}`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data.snippets) ? data.snippets : [];
      setSnippets(list);
      if (data.shop_id) setShopId(data.shop_id);
      setSelectedId((prev) => {
        if (prev) return prev;
        return list.length > 0 ? list[0].snippet_id : null;
      });
    } catch {
      setSnippets([]);
    } finally {
      setLoading(false);
    }
  }, [category, productId]);

  useEffect(() => {
    loadSnippets();
  }, [loadSnippets]);

  const selectedSnippet = snippets.find((s) => s.snippet_id === selectedId) ?? null;

  const handleSelect = (id) => {
    setSelectedId(id);
    if (id !== null) setNewDraft(false);
  };

  const handleAddSnippet = () => {
    setSelectedId(null);
    setNewDraft(true);
  };

  const handleSaved = (saved) => {
    setNewDraft(false);
    setSnippets((prev) => {
      const exists = prev.find((s) => s.snippet_id === saved.snippet_id);
      if (exists) {
        return prev.map((s) =>
          s.snippet_id === saved.snippet_id ? { ...s, ...saved } : s
        );
      }
      return [saved, ...prev];
    });
    setSelectedId(saved.snippet_id);
  };

  const handleDeleted = (deletedId) => {
    setSnippets((prev) => prev.filter((s) => s.snippet_id !== deletedId));
    setSelectedId(null);
    setNewDraft(false);
  };

  const handleCancel = () => {
    setNewDraft(false);
    if (snippets.length > 0) setSelectedId(snippets[0].snippet_id);
    else setSelectedId(null);
  };

  const count = snippets.length;
  const subtitle =
    headerSubtitle ??
    (productPrice
      ? `${productPrice} · ${count} snippet${count !== 1 ? "s" : ""}`
      : `${count} snippet${count !== 1 ? "s" : ""}`);

  return (
    <div className="flex flex-col">
      {/* Header — flat, matches the rest of the knowledge section */}
      <div className="flex items-center gap-3 pb-6">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => router.push(backHref ?? "/knowledge")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {headerIcon && (
          <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
            {headerIcon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight">
            {productTitle ?? "General"}
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Import CSV
          </Button>
          <Button size="sm" onClick={handleAddSnippet}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add snippet
          </Button>
        </div>
      </div>

      {/* Two-panel — bleeds to page edges, defined height so children can use h-full */}
      <div className="-mx-4 lg:-mx-10 -mb-6 lg:-mb-10 flex border-t border-gray-100 h-[calc(100svh-141px)] overflow-hidden">
        {/* Left: snippet list */}
        <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-gray-100 bg-gray-50/50">
          {loading ? (
            <div className="space-y-2 p-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : (
            <SnippetList
              snippets={snippets}
              selectedId={newDraft ? null : selectedId}
              onSelect={handleSelect}
            />
          )}
        </div>

        {/* Right: editor or empty state */}
        <div className="flex flex-1 overflow-hidden bg-white">
          {newDraft || selectedSnippet ? (
            <SnippetEditor
              key={newDraft ? "new" : selectedId}
              snippet={newDraft ? null : selectedSnippet}
              category={category}
              productId={productId}
              productTitle={productTitle}
              shopId={shopId}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
              onCancel={handleCancel}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                <FileText className="h-5 w-5 text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Select a snippet to edit
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  or add a new one
                </p>
              </div>
              <Button size="sm" onClick={handleAddSnippet}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add snippet
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* CSV Import Modal */}
      <CsvSupportKnowledgeImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        shopId={shopId}
        onImported={() => {
          setImportOpen(false);
          loadSnippets();
        }}
      />
    </div>
  );
}
