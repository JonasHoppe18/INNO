"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, MoreHorizontal, Plus, Sparkles, X } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ISSUE_TYPE_GROUPS,
  ISSUE_TYPE_LABEL_MAP,
  ISSUE_TYPE_VALUES,
} from "@/lib/knowledge/issue-types";
import { SnippetPreviewModal } from "./SnippetPreviewModal";

const KNOWLEDGE_TYPES = [
  { value: "fact", label: "Fact — specific information" },
  { value: "procedure", label: "Guide — step-by-step instructions" },
  { value: "policy", label: "Policy — what we do or don't do" },
  { value: "tone_example", label: "Tone example — how we write" },
  { value: "background", label: "Background — general context" },
];

// Knowledge types that benefit from the Question/Answer structure. The
// embedded chunk includes the question verbatim, which dramatically improves
// retrieval against customer messages (which ARE questions).
const QA_TYPES = new Set(["fact", "procedure"]);

export function SnippetEditor({
  snippet,
  category,
  productId,
  productTitle,
  shopId,
  seedQuestion,
  onSaved,
  onDeleted,
  onCancel,
}) {
  const isNew = !snippet;
  const hasSeed = isNew && Boolean(seedQuestion);

  const normalizedProductTitle = productTitle ? productTitle.trim().toLowerCase() : null;

  const [title, setTitle] = useState(snippet?.title ?? (hasSeed ? seedQuestion : ""));
  const [usableAs, setUsableAs] = useState(snippet?.usable_as ?? (hasSeed ? "procedure" : ""));
  const [content, setContent] = useState(snippet?.content ?? "");
  const [question, setQuestion] = useState(snippet?.question ?? (hasSeed ? seedQuestion : ""));
  // For a legacy prose snippet of a Q&A type (procedure/fact stored before
  // the Q&A toggle existed), seed the Answer field with the existing content
  // so the user sees their work in the right place. snippet.answer is null
  // for those rows; we fall back to snippet.content when the type qualifies.
  const [answer, setAnswer] = useState(
    snippet?.answer ??
      (QA_TYPES.has(snippet?.usable_as ?? "") && snippet?.format !== "qa"
        ? snippet?.content ?? ""
        : ""),
  );
  const [tags, setTags] = useState(snippet?.issue_types ?? []);
  const [aiTags, setAiTags] = useState(new Set(snippet?.issue_types ?? []));
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [products, setProducts] = useState(
    snippet?.products ?? (isNew && normalizedProductTitle ? [normalizedProductTitle] : [])
  );
  const [productInput, setProductInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const textareaRef = useRef(null);
  const answerRef = useRef(null);
  // Preserves the typed question text across format switches. If the user
  // converts a Q&A snippet → tone_example → back to fact, we restore their
  // question instead of forcing them to retype it.
  const lastQuestionRef = useRef(snippet?.question ?? "");

  // Q&A view is driven entirely by usable_as. Fact/procedure types ALWAYS
  // get the Question + Answer editor regardless of whether the snippet was
  // stored as legacy prose (CSV imports, pre-Q&A creations) or true Q&A.
  // For legacy prose snippets the existing content is seeded into the Answer
  // field below so nothing disappears from view — admins can then optionally
  // add a Question to upgrade the snippet to Q&A on the next save.
  const isQaType = QA_TYPES.has(usableAs);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  useEffect(() => {
    const el = answerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [answer]);

  // When the user switches to a Q&A type, seed the answer field from any
  // existing prose content so they don't lose work. When switching away from
  // Q&A, fold the question + answer back into the content field. In both
  // directions we clear the inactive side so the dirty-check stays accurate.
  const handleUsableAsChange = (next) => {
    const wasQa = QA_TYPES.has(usableAs);
    const willBeQa = QA_TYPES.has(next);
    if (!wasQa && willBeQa) {
      // Switching TO Q&A: move the prose content into the Answer field so
      // the user's knowledge text lands in the right place. Restore any
      // previously-typed question from the ref (round-trip preservation).
      if (content.trim()) {
        setAnswer(content.trim());
      }
      if (!question.trim() && lastQuestionRef.current) {
        setQuestion(lastQuestionRef.current);
      }
      setContent("");
    } else if (wasQa && !willBeQa) {
      // Switching AWAY from Q&A: put just the answer text into content (it's
      // the actual knowledge text). Remember the question in a ref so we can
      // restore it on round-trip. We don't dump "Question: X\n\nAnswer: Y"
      // literally because that string ends up in the AI's replies.
      if (answer.trim()) {
        setContent(answer.trim());
      }
      if (question.trim()) {
        lastQuestionRef.current = question.trim();
      }
      setQuestion("");
      setAnswer("");
    }
    setUsableAs(next);
  };

  const isDirty = useMemo(() => {
    if (isNew) {
      return (
        title.trim() !== "" ||
        content.trim() !== "" ||
        question.trim() !== "" ||
        answer.trim() !== ""
      );
    }
    const origTags = [...(snippet?.issue_types ?? [])].sort().join(",");
    const currTags = [...tags].sort().join(",");
    const origProducts = [...(snippet?.products ?? [])].sort().join(",");
    const currProducts = [...products].sort().join(",");
    // In Q&A mode the local `content` state is unused — content is synthesized
    // from question + answer on save, so comparing it to snippet.content (which
    // IS the synthesized string) would always look dirty. Diff only the fields
    // the active mode actually edits.
    //
    // Legacy quirk: for a procedure/fact snippet stored as prose (pre-Q&A
    // toggle), we seed the Answer field from snippet.content at mount time
    // so the user can SEE their existing knowledge. snippet.answer is still
    // null in that case, so a naive `answer !== snippet.answer` would always
    // mark the form dirty on open. Treat snippet.content as the original
    // answer in that case — only flag dirty if the user actually edits.
    const originalAnswer =
      QA_TYPES.has(snippet?.usable_as ?? "") && snippet?.format !== "qa"
        ? snippet?.content ?? ""
        : snippet?.answer ?? "";
    const contentDirty = isQaType
      ? question !== (snippet?.question ?? "") || answer !== originalAnswer
      : content !== (snippet?.content ?? "");
    return (
      title !== (snippet?.title ?? "") ||
      contentDirty ||
      usableAs !== (snippet?.usable_as ?? "") ||
      origTags !== currTags ||
      origProducts !== currProducts
    );
  }, [isNew, isQaType, title, content, question, answer, usableAs, tags, products, snippet]);

  const handleDiscard = () => {
    if (isNew) {
      onCancel?.();
    } else {
      setTitle(snippet?.title ?? "");
      setUsableAs(snippet?.usable_as ?? "");
      setContent(snippet?.content ?? "");
      setQuestion(snippet?.question ?? "");
      setAnswer(
        snippet?.answer ??
          (QA_TYPES.has(snippet?.usable_as ?? "") && snippet?.format !== "qa"
            ? snippet?.content ?? ""
            : ""),
      );
      setTags(snippet?.issue_types ?? []);
      setAiTags(new Set(snippet?.issue_types ?? []));
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

  const toggleTag = (value) => {
    if (!ISSUE_TYPE_VALUES.includes(value)) return;
    setTags((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]
    );
  };

  const removeTag = (tag) => setTags((prev) => prev.filter((t) => t !== tag));

  const handleSave = async () => {
    const trimTitle = title.trim();
    const trimQuestion = question.trim();
    const trimAnswer = answer.trim();
    // Save as true Q&A only when BOTH question and answer are filled. If the
    // user leaves question empty (legacy prose snippet they didn't upgrade),
    // we fall back to plain prose and use the Answer field's text as the
    // content — same data, just stored as format=prose.
    const useQa = isQaType && Boolean(trimQuestion) && Boolean(trimAnswer);
    const trimContent = useQa
      ? `Question: ${trimQuestion}\n\nAnswer: ${trimAnswer}`
      : isQaType
        ? trimAnswer
        : content.trim();
    if (!trimTitle) {
      toast.error("Title is required.");
      return;
    }
    if (isQaType) {
      // Question is optional. If filled, answer must also be filled.
      if (trimQuestion && !trimAnswer) {
        toast.error("Answer is required when a question is provided.");
        return;
      }
      if (!trimAnswer) {
        toast.error("Answer is required.");
        return;
      }
    } else if (!trimContent) {
      toast.error("Content is required.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: trimTitle,
        content: trimContent,
        ...(useQa ? { question: trimQuestion, answer: trimAnswer } : {}),
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
        format: useQa ? "qa" : "prose",
        question: useQa ? trimQuestion : null,
        answer: useQa ? trimAnswer : null,
        usable_as: usableAs || null,
        issue_types: tags,
        products,
        category: category ?? null,
        product_id: productId ?? null,
      };
      onSaved?.(savedSnippet);

      // Fire async AI tagging — runs in background, updates UI when done
      if (trimContent.length >= 20) {
        autoTagAsync(savedSnippetId, trimTitle, trimContent, usableAs, category, productId, products, tags, shopId, useQa ? trimQuestion : null, useQa ? trimAnswer : null);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const autoTagAsync = async (snippetId, savedTitle, savedContent, savedUsableAs, savedCategory, savedProductId, currentProducts, currentTags, savedShopId, savedQuestion, savedAnswer) => {
    try {
      const res = await fetch("/api/knowledge/tag-suggest", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: savedContent }),
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      // Only accept suggestions that match the canonical vocabulary — anything
      // else won't be matched by the retriever and just clutters the UI.
      const suggestedIssues = (Array.isArray(data.issue_types) ? data.issue_types : [])
        .filter((t) => ISSUE_TYPE_VALUES.includes(t));
      const suggestedProducts = Array.isArray(data.products) ? data.products : [];

      if (!suggestedIssues.length && !suggestedProducts.length) return;

      const mergedIssues = [...new Set([...currentTags, ...suggestedIssues])];
      // Only apply suggested products if user hasn't set any manually
      const mergedProducts = currentProducts.length > 0 ? currentProducts : suggestedProducts;

      const putRes = await fetch("/api/knowledge/snippets", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: snippetId,
          title: savedTitle,
          content: savedContent,
          ...(savedQuestion && savedAnswer ? { question: savedQuestion, answer: savedAnswer } : {}),
          ...(savedShopId ? { shop_id: savedShopId } : {}),
          ...(savedUsableAs ? { usable_as: savedUsableAs } : {}),
          ...(savedCategory ? { category: savedCategory } : {}),
          ...(savedProductId ? { product_id: savedProductId } : {}),
          issue_types: mergedIssues,
          products: mergedProducts,
        }),
      });
      if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        console.warn("[auto-tag] PUT failed:", errData?.error || putRes.status);
        return;
      }

      setTags(mergedIssues);
      setAiTags(new Set(suggestedIssues));
      if (currentProducts.length === 0 && mergedProducts.length > 0) {
        setProducts(mergedProducts);
      }
    } catch (err) {
      console.warn("[auto-tag] failed:", err);
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
        body: JSON.stringify({
          id: snippet.snippet_id,
          ...(shopId ? { shop_id: shopId } : {}),
        }),
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

  const hasMetadata = usableAs || products.length > 0 || tags.length > 0;
  const [metaOpen, setMetaOpen] = useState(!isNew && hasMetadata);

  const metaSummary = [
    usableAs ? KNOWLEDGE_TYPES.find((t) => t.value === usableAs)?.label.split(" — ")[0] : null,
    products.length > 0 ? `${products.length} product${products.length !== 1 ? "s" : ""}` : null,
    tags.length > 0 ? `${tags.length} tag${tags.length !== 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full w-full flex-col">
      {/* Panel toolbar */}
      {!isNew && (
        <div className="flex items-center justify-end gap-2 border-b border-gray-100 px-4 py-1.5">
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
            <>
              <button
                type="button"
                onClick={() => {
                  if (isDirty) {
                    toast.error("Save your changes before testing against a ticket.");
                    return;
                  }
                  setPreviewOpen(true);
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors",
                  isDirty
                    ? "text-gray-300"
                    : "text-indigo-600 hover:bg-indigo-50"
                )}
                title={isDirty ? "Save first" : "Run an A/B preview against a real ticket"}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Test against ticket
              </button>
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
            </>
          )}
        </div>
      )}

      {snippet?.snippet_id && (
        <SnippetPreviewModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          snippetId={snippet.snippet_id}
          snippetTitle={title || snippet.title}
        />
      )}

      <div className={cn("flex-1 space-y-5 overflow-y-auto px-6 py-5", isDirty && "pb-24")}>
        {/* Title */}
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            isQaType
              ? "Title — short summary shown in the snippet list"
              : "Title..."
          }
          className="w-full border-0 border-b-2 border-gray-100 bg-transparent pb-2 text-[15px] font-bold text-gray-900 dark:text-white placeholder:font-normal placeholder:text-gray-300 outline-none focus:border-indigo-200 transition-colors"
        />

        {/* Content — primary focus. Q&A format for Fact/Guide types boosts
            retrieval because the embedded chunk contains question phrasing. */}
        {isQaType ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">
                Customer question <span className="text-gray-400 font-normal">(optional)</span>
              </Label>
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. How do I pair my AirPods with iPhone?"
                className="w-full rounded-lg border border-gray-100 bg-transparent px-4 py-3 text-[13.5px] text-gray-800 dark:text-white placeholder:text-gray-300 outline-none transition-colors focus:border-indigo-200 focus:ring-2 focus:ring-indigo-100"
              />
              <p className="text-[11px] text-gray-400">
                Phrase it the way a customer would ask. Adding this lets Sona reliably pick THIS snippet over similar ones. Leave empty to save as a plain guide.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Answer</Label>
              <textarea
                ref={answerRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={
                  usableAs === "procedure"
                    ? "Step-by-step instructions the AI should follow exactly..."
                    : "The factual answer the AI should give..."
                }
                className="w-full min-h-[160px] resize-none overflow-hidden rounded-lg border border-gray-100 bg-transparent px-4 py-3.5 text-[13.5px] leading-relaxed text-gray-800 dark:text-white placeholder:text-gray-300 outline-none transition-colors focus:border-indigo-200 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write the knowledge here — be precise, the AI uses this word for word."
              className="w-full min-h-[200px] resize-none overflow-hidden rounded-lg border border-gray-100 bg-transparent px-4 py-3.5 text-[13.5px] leading-relaxed text-gray-800 dark:text-white placeholder:text-gray-300 outline-none transition-colors focus:border-indigo-200 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        )}

        {/* AI settings — collapsible */}
        <div className="rounded-lg border border-gray-100 overflow-hidden">
          <button
            type="button"
            onClick={() => setMetaOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-gray-50/80"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] font-medium text-gray-500">AI settings</span>
              {!metaOpen && metaSummary && (
                <span className="text-[11px] text-gray-400">{metaSummary}</span>
              )}
              {!metaOpen && !metaSummary && (
                <span className="text-[11px] text-gray-300">type, products, tags — AI fills automatically</span>
              )}
            </div>
            <ChevronDown className={cn("h-3.5 w-3.5 text-gray-300 transition-transform duration-150", metaOpen && "rotate-180")} />
          </button>

          {metaOpen && (
            <div className="border-t border-gray-100 px-3.5 py-3.5 space-y-4">
              {/* Knowledge type */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Knowledge type</Label>
                <Select value={usableAs || ""} onValueChange={handleUsableAsChange}>
                  <SelectTrigger className="w-full">
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
                    placeholder={products.length === 0 ? "Add product names — press Enter" : "+ add"}
                    className="min-w-[160px] flex-1 bg-transparent text-[10px] text-gray-400 placeholder:text-gray-300 outline-none"
                  />
                </div>
              </div>

              {/* Issue type tags — closed list aligned with the retriever vocabulary */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Issue types</Label>
                <div
                  className={cn(
                    "flex min-h-[36px] flex-wrap items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2",
                    tags.length === 0 && "border-dashed"
                  )}
                >
                  {tags.map((tag) => {
                    const label = ISSUE_TYPE_LABEL_MAP[tag] || tag;
                    const isAi = aiTags.has(tag);
                    return (
                      <span
                        key={tag}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
                          isAi
                            ? "border border-green-200 bg-green-50 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        )}
                      >
                        {label}
                        <button
                          onClick={() => removeTag(tag)}
                          className="text-gray-300 hover:text-gray-500 leading-none"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    );
                  })}
                  <Popover open={tagPickerOpen} onOpenChange={setTagPickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10px] text-gray-400 transition-colors hover:border-indigo-300 hover:text-indigo-600"
                      >
                        <Plus className="h-2.5 w-2.5" />
                        {tags.length === 0 ? "Pick issue types" : "Add"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-64 p-2">
                      <p className="px-2 pt-1 pb-2 text-[10.5px] text-gray-400">
                        Pick from the canonical list — these are the only tags the AI searches for.
                      </p>
                      <div className="max-h-72 overflow-y-auto">
                        {Object.entries(ISSUE_TYPE_GROUPS).map(([group, options]) => (
                          <div key={group} className="mb-1.5">
                            <p className="px-2 py-1 text-[9.5px] font-semibold uppercase tracking-wide text-gray-400">
                              {group}
                            </p>
                            <div className="space-y-0.5">
                              {options.map((opt) => {
                                const selected = tags.includes(opt.value);
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => toggleTag(opt.value)}
                                    className={cn(
                                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
                                      selected
                                        ? "bg-indigo-50 text-indigo-700"
                                        : "text-gray-700 hover:bg-gray-50"
                                    )}
                                  >
                                    <span>{opt.label}</span>
                                    {selected && <Check className="h-3 w-3 text-indigo-600" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                {tags.some((t) => aiTags.has(t)) && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded-full border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] text-green-600">AI</span>
                    Green tags were set automatically on save. Add or remove freely.
                  </p>
                )}
              </div>
            </div>
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
