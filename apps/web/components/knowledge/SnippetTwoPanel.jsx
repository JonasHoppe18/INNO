"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Lightbulb, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SnippetList } from "./SnippetList";
import { SnippetEditor } from "./SnippetEditor";
import { CsvSupportKnowledgeImportModal } from "./CsvSupportKnowledgeImportModal";
import { buildStarters } from "@/lib/knowledge/starters";

export function SnippetTwoPanel({
  category,
  productId,
  productTitle,
  productPrice,
  backHref,
  headerIcon,
  headerSubtitle,
  productScope,
}) {
  const router = useRouter();
  const [snippets, setSnippets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [newDraft, setNewDraft] = useState(false);
  const [seedQuestion, setSeedQuestion] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [shopId, setShopId] = useState(null);

  const starters = useMemo(
    () => buildStarters({ category, productTitle, productScope }),
    [category, productTitle, productScope]
  );

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
      const rawList = Array.isArray(data.snippets) ? data.snippets : [];
      // "general" scope: keep only snippets that aren't tied to a specific product
      const list = productScope === "general"
        ? rawList.filter((s) => !s.product_id)
        : rawList;
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
  }, [category, productId, productScope]);

  useEffect(() => {
    loadSnippets();
  }, [loadSnippets]);

  const selectedSnippet = snippets.find((s) => s.snippet_id === selectedId) ?? null;

  const handleSelect = (id) => {
    setSelectedId(id);
    if (id !== null) setNewDraft(false);
  };

  const handleAddSnippet = (seed = "") => {
    setSelectedId(null);
    setSeedQuestion(seed);
    setNewDraft(true);
  };

  const handleSaved = (saved) => {
    setNewDraft(false);
    setSeedQuestion("");
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
    setSeedQuestion("");
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
          <h1 className="text-page-heading font-semibold leading-tight">
            {productTitle ?? "General"}
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Import CSV
          </Button>
          <Button size="sm" onClick={() => handleAddSnippet()}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add snippet
          </Button>
        </div>
      </div>

      {/* Two-panel — bleeds to page edges, defined height so children can use h-full */}
      <div className="-mx-4 lg:-mx-10 -mb-6 lg:-mb-10 flex border-t border-border h-[calc(100svh-141px)] overflow-hidden ">
        {/* Left: snippet list */}
        <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-muted/50  ">
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
        <div className="flex flex-1 overflow-hidden bg-card">
          {newDraft || selectedSnippet ? (
            <SnippetEditor
              key={newDraft ? `new-${seedQuestion || "blank"}` : selectedId}
              snippet={newDraft ? null : selectedSnippet}
              seedQuestion={newDraft ? seedQuestion : ""}
              category={category}
              productId={productId}
              productTitle={productTitle}
              shopId={shopId}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
              onCancel={handleCancel}
            />
          ) : snippets.length === 0 ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-8 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent ">
                <Lightbulb className="h-5 w-5 text-primary " />
              </div>
              <div className="max-w-md">
                <p className="text-sm font-semibold text-foreground ">
                  Start with a common question
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click one to pre-fill the editor, or write your own. Q&amp;A snippets dramatically improve how the AI matches customer messages.
                </p>
              </div>
              <div className="flex w-full max-w-md flex-col gap-1.5">
                {starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => handleAddSnippet(starter)}
                    className="group flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-[color,background-color,border-color,box-shadow,transform] hover:border-primary/30 hover:bg-accent/30 hover:text-accent-foreground  dark:bg-transparent    "
                  >
                    <span className="truncate">{starter}</span>
                    <Plus className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary  " />
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => handleAddSnippet()}
                className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-muted-foreground hover:underline "
              >
                Or start from scratch
              </button>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted ">
                <FileText className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground ">
                  Select a snippet to edit
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  or add a new one
                </p>
              </div>
              <Button size="sm" onClick={() => handleAddSnippet()}>
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
