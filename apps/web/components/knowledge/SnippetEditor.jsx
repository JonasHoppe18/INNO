"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
  onSaved,
  onDeleted,
  onCancel,
}) {
  const isNew = !snippet;

  const [title, setTitle] = useState(snippet?.title ?? "");
  const [usableAs, setUsableAs] = useState(snippet?.usable_as ?? "");
  const [content, setContent] = useState(snippet?.content ?? "");
  const [tags, setTags] = useState(snippet?.issue_types ?? []);
  const [aiTags, setAiTags] = useState(new Set(snippet?.issue_types ?? []));
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset when snippet changes
  useEffect(() => {
    setTitle(snippet?.title ?? "");
    setUsableAs(snippet?.usable_as ?? "");
    setContent(snippet?.content ?? "");
    setTags(snippet?.issue_types ?? []);
    setAiTags(new Set(snippet?.issue_types ?? []));
    setTagInput("");
    setConfirmDelete(false);
  }, [snippet?.snippet_id]);

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
        issue_types: tags,
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
        products: snippet?.products ?? [],
        category: category ?? null,
        product_id: productId ?? null,
      };
      onSaved?.(savedSnippet);

      // Fire async AI tagging — runs in background, updates UI when done
      if (trimContent.length >= 20) {
        autoTagAsync(savedSnippetId, trimTitle, trimContent);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const autoTagAsync = async (snippetId, savedTitle, savedContent) => {
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

      // Merge keeping existing manual tags
      const merged = [...new Set([...tags, ...suggestedIssues])];

      await fetch("/api/knowledge/snippets", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: snippetId,
          title: savedTitle,
          content: savedContent,
          ...(usableAs ? { usable_as: usableAs } : {}),
          ...(category ? { category } : {}),
          ...(productId ? { product_id: productId } : {}),
          issue_types: merged,
          ...(suggestedProducts.length ? { products: suggestedProducts } : {}),
        }),
      });

      // Update UI to reflect AI tags
      setTags(merged);
      setAiTags(new Set(suggestedIssues));
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
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {/* Title */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title..."
          className="w-full border-0 border-b-2 border-gray-100 bg-transparent pb-2 text-[15px] font-bold text-gray-900 placeholder:font-normal placeholder:text-gray-300 outline-none focus:border-indigo-200 transition-colors"
        />

        {/* Knowledge type */}
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Knowledge type
          </label>
          <Select value={usableAs || ""} onValueChange={setUsableAs}>
            <SelectTrigger className="h-8 w-64 text-[11px]">
              <SelectValue placeholder="Select type..." />
            </SelectTrigger>
            <SelectContent>
              {KNOWLEDGE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value} className="text-[11px]">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Content */}
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Content
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write the knowledge here..."
            className="w-full resize-y rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] leading-relaxed text-gray-700 placeholder:text-gray-300 outline-none focus:border-indigo-200 focus:bg-white transition-colors min-h-[120px]"
          />
          <p className="mt-1 text-[10px] text-gray-300">
            Be precise — the AI uses this directly to answer customers.
          </p>
        </div>

        {/* Tags */}
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Tags
          </label>
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
            <p className="mt-1 flex items-center gap-1 text-[10px] text-gray-300">
              <span className="rounded-full border border-green-200 bg-green-50 px-1.5 py-0.5 text-[9px] text-green-600">
                AI
              </span>
              Green tags set automatically on save. Add or remove freely.
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-gray-100 bg-white px-6 py-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : isNew ? "Save snippet" : "Save changes"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-[11px] text-gray-500 hover:bg-gray-200 transition-colors"
        >
          {isNew ? "Cancel" : "Discard"}
        </button>
        {!isNew && (
          <div className="ml-auto">
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                >
                  {deleting ? "Deleting..." : "Confirm delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-1 text-[10px] text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded-md border border-red-100 px-2.5 py-1.5 text-[11px] text-red-400 hover:border-red-200 hover:text-red-600 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
