"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
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
    <div className="flex min-h-[calc(100vh-140px)] flex-col rounded-lg border border-gray-100 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-gray-100 px-5 py-3.5">
        <button
          onClick={() => router.push(backHref ?? "/knowledge")}
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-gray-200 text-[11px] text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-colors"
        >
          ←
        </button>
        {headerIcon && (
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] bg-gray-100 text-[10px] font-bold text-gray-600">
            {headerIcon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-gray-900">
            {productTitle ?? "General"}
          </div>
          <div className="mt-0.5 text-[10px] text-gray-400">{subtitle}</div>
        </div>
        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-colors"
        >
          <Upload className="h-3 w-3" />
          Import CSV
        </button>
        <button
          onClick={handleAddSnippet}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add snippet
        </button>
      </div>

      {/* Two-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: snippet list */}
        <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-gray-100">
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
              newDraft={newDraft}
            />
          )}
        </div>

        {/* Right: editor or empty state */}
        <div className="flex flex-1 overflow-hidden">
          {newDraft || selectedSnippet ? (
            <SnippetEditor
              key={newDraft ? "new" : selectedId}
              snippet={newDraft ? null : selectedSnippet}
              category={category}
              productId={productId}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
              onCancel={handleCancel}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                <FileText className="h-5 w-5 text-gray-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-gray-600">
                  Select a snippet to edit
                </p>
                <p className="mt-0.5 text-[11px] text-gray-400">
                  or add a new one
                </p>
              </div>
              <button
                onClick={handleAddSnippet}
                className="mt-1 flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add snippet
              </button>
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
