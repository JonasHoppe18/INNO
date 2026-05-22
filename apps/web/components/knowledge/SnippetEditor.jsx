"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const KNOWLEDGE_TYPES = [
  { value: "fact", label: "Factual info — background knowledge" },
  { value: "procedure", label: "Procedure — follow steps exactly" },
  { value: "policy", label: "Policy — authoritative rule" },
  { value: "tone_example", label: "Tone example" },
  { value: "background", label: "Background — general context" },
];

export function SnippetEditor({
  snippet,
  category,
  productId,
  productTitle,
  shopId,
  onSaved,
  onDeleted,
  onCancel,
}) {
  const isNew = !snippet;

  const normalizedProductTitle = productTitle ? productTitle.trim().toLowerCase() : null;

  const [title, setTitle] = useState(snippet?.title ?? "");
  const [usableAs, setUsableAs] = useState(snippet?.usable_as ?? "");
  const [content, setContent] = useState(snippet?.content ?? "");
  const [tags, setTags] = useState(snippet?.issue_types ?? []);
  const [aiTags, setAiTags] = useState(new Set(snippet?.issue_types ?? []));
  const [tagInput, setTagInput] = useState("");
  const [products, setProducts] = useState(
    snippet?.products ?? (isNew && normalizedProductTitle ? [normalizedProductTitle] : [])
  );
  const [productInput, setProductInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  const isDirty = useMemo(() => {
    if (isNew) return title.trim() !== "" || content.trim() !== "";
    const origTags = [...(snippet?.issue_types ?? [])].sort().join(",");
    const currTags = [...tags].sort().join(",");
    const origProducts = [...(snippet?.products ?? [])].sort().join(",");
    const currProducts = [...products].sort().join(",");
    return (
      title !== (snippet?.title ?? "") ||
      content !== (snippet?.content ?? "") ||
      usableAs !== (snippet?.usable_as ?? "") ||
      origTags !== currTags ||
      origProducts !== currProducts
    );
  }, [isNew, title, content, usableAs, tags, products, snippet]);

  const handleDiscard = () => {
    if (isNew) {
      onCancel?.();
    } else {
      setTitle(snippet?.title ?? "");
      setUsableAs(snippet?.usable_as ?? "");
      setContent(snippet?.content ?? "");
      setTags(snippet?.issue_types ?? []);
      setAiTags(new Set(snippet?.issue_types ?? []));
      setTagInput("");
      setProducts(snippet?.products ?? []);
      setProductInput("");
      setConfirmDelete(false);
    }
  };

  const addProduct = (raw) => {
    const value = raw.trim().toLowerCase();
    if (value && !products.includes(value)) {
      setProducts((prev) => [...prev, value]);
    }
    setProductInput("");
  };

  const removeProduct = (p) => setProducts((prev) => prev.filter((x) => x !== p));

  const addTag = (raw) => {
    const value = raw.trim().toLowerCase().replace(/\s+/g, "_");
    if (value && !tags.includes(value)) {
      setTags((prev) => [...prev, value]);
    }
    setTagInput("");
  };

  const removeTag = (tag) => setTags((prev) => prev.filter((t) => t !== tag));

  const handleSave = async () => {
    const trimTitle = title.trim();
    const trimContent = content.trim();
    if (!trimTitle || !trimContent) {
      toast.error("Title and content are required.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: trimTitle,
        content: trimContent,
        ...(usableAs ? { usable_as: usableAs } : {}),
        ...(category ? { category } : {}),
        ...(productId ? { product_id: productId } : {}),
        ...(productId && productTitle ? { product_title: productTitle } : {}),
        ...(shopId ? { shop_id: shopId } : {}),
        issue_types: tags,
        products,
        ...(snippet?.snippet_id ? { id: snippet.snippet_id } : {}),
      };

      const res = await fetch("/api/knowledge/snippets", {
        method: snippet?.snippet_id ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Could not save snippet.");

      const savedSnippetId = snippet?.snippet_id ?? data.snippet_id;
      toast.success(isNew ? "Snippet saved" : "Changes saved");

      const savedSnippet = {
        snippet_id: savedSnippetId,
        title: trimTitle,
        content: trimContent,
        usable_as: usableAs || null,
        issue_types: tags,
        products,
        category: category ?? null,
        product_id: productId ?? null,
      };
      onSaved?.(savedSnippet);

      // Fire async AI tagging — runs in background, updates UI when done
      if (trimContent.length >= 20) {
        autoTagAsync(savedSnippetId, trimTitle, trimContent, usableAs, category, productId, products, tags);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const autoTagAsync = async (snippetId, savedTitle, savedContent, savedUsableAs, savedCategory, savedProductId, currentProducts, currentTags) => {
    try {
      const res = await fetch("/api/knowledge/tag-suggest", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: savedContent }),
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const suggestedIssues = Array.isArray(data.issue_types) ? data.issue_types : [];
      const suggestedProducts = Array.isArray(data.products) ? data.products : [];

      if (!suggestedIssues.length && !suggestedProducts.length) return;

      const mergedIssues = [...new Set([...currentTags, ...suggestedIssues])];
      // Only apply suggested products if user hasn't set any manually
      const mergedProducts = currentProducts.length > 0 ? currentProducts : suggestedProducts;

      await fetch("/api/knowledge/snippets", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: snippetId,
          title: savedTitle,
          content: savedContent,
          ...(savedUsableAs ? { usable_as: savedUsableAs } : {}),
          ...(savedCategory ? { category: savedCategory } : {}),
          ...(savedProductId ? { product_id: savedProductId } : {}),
          issue_types: mergedIssues,
          products: mergedProducts,
        }),
      });

      setTags(mergedIssues);
      setAiTags(new Set(suggestedIssues));
      if (currentProducts.length === 0 && mergedProducts.length > 0) {
        setProducts(mergedProducts);
      }
    } catch {
      // Silently fail — tagging is best-effort
    }
  };

  const handleDelete = async () => {
    if (!snippet?.snippet_id) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/knowledge/snippets", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: snippet.snippet_id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Could not delete snippet.");
      }
      toast.success("Snippet deleted");
      onDeleted?.(snippet.snippet_id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* Panel toolbar — delete lives here, not in the form */}
      {!isNew && (
        <div className="flex items-center justify-end border-b border-gray-100 px-4 py-1.5">
          {confirmDelete ? (
            <div className="flex items-center gap-3 text-[11.5px]">
              <span className="text-gray-500">Delete this snippet?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="font-medium text-red-500 transition-colors hover:text-red-700"
              >
                {deleting ? "Deleting..." : "Yes, delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-gray-400 transition-colors hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded p-1 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-500">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onClick={() => setConfirmDelete(true)}
                  className="text-red-500 focus:text-red-500"
                >
                  Delete snippet
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      <div className={cn("flex-1 space-y-4 overflow-y-auto px-6 py-5", isDirty && "pb-24")}>
        {/* Title */}
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title..."
          className="w-full border-0 border-b-2 border-gray-100 bg-transparent pb-2 text-[15px] font-bold text-gray-900 placeholder:font-normal placeholder:text-gray-300 outline-none focus:border-indigo-200 transition-colors"
        />

        {/* Knowledge type */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Knowledge type</Label>
          <Select value={usableAs || ""} onValueChange={setUsableAs}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Select type..." />
            </SelectTrigger>
            <SelectContent>
              {KNOWLEDGE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Content */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Content</Label>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write the knowledge here..."
            className="w-full min-h-[160px] resize-none overflow-hidden rounded-lg border border-gray-100 bg-transparent px-4 py-3.5 text-[13.5px] leading-relaxed text-gray-800 placeholder:text-gray-300 outline-none transition-colors focus:border-indigo-200 focus:ring-2 focus:ring-indigo-100"
          />
          <p className="text-xs text-muted-foreground">
            Be precise — the AI uses this directly to answer customers.
          </p>
        </div>

        {/* Products */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Products</Label>
          <div className="flex min-h-[36px] flex-wrap items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2">
            {products.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] text-indigo-700"
              >
                {p}
                <button
                  onClick={() => removeProduct(p)}
                  className="text-indigo-300 hover:text-indigo-500 leading-none"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <input
              value={productInput}
              onChange={(e) => setProductInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && productInput.trim()) {
                  e.preventDefault();
                  addProduct(productInput);
                }
              }}
              placeholder={products.length === 0 ? "Add product names — press Enter" : "+ add product"}
              className="min-w-[180px] flex-1 bg-transparent text-[10px] text-gray-400 placeholder:text-gray-300 outline-none"
            />
          </div>
        </div>

        {/* Issue type tags */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Issue types</Label>
          <div
            className={cn(
              "flex min-h-[36px] flex-wrap items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2",
              isNew && tags.length === 0 && "border-dashed"
            )}
          >
            {isNew && tags.length === 0 ? (
              <span className="text-[10px] text-gray-300">
                AI will suggest tags when you save — or add your own
              </span>
            ) : (
              <>
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
                      aiTags.has(tag)
                        ? "border border-green-200 bg-green-50 text-green-700"
                        : "bg-gray-100 text-gray-600"
                    )}
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="text-gray-300 hover:text-gray-500 leading-none"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && tagInput.trim()) {
                      e.preventDefault();
                      addTag(tagInput);
                    }
                  }}
                  placeholder="+ add tag"
                  className="bg-transparent text-[10px] text-gray-400 placeholder:text-gray-300 outline-none"
                />
              </>
            )}
          </div>
          {tags.some((t) => aiTags.has(t)) && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="rounded-full border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] text-green-600">
                AI
              </span>
              Green tags set automatically on save. Add or remove freely.
            </p>
          )}
        </div>

      </div>

      <StickySaveBar
        isVisible={isDirty}
        isSaving={saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
        saveLabel={isNew ? "Save snippet" : "Save changes"}
        message={isNew ? "New snippet" : "Unsaved changes"}
      />
    </div>
  );
}
