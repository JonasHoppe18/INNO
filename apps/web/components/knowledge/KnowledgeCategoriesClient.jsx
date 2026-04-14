"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  List as ListIcon,
  ListOrdered as ListOrderedIcon,
  MessageSquare,
  Paperclip,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  Truck,
  ChevronRight,
  BookOpen,
  BookMarked,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const ICON_MAP = {
  Package,
  RotateCcw,
  Truck,
  MessageSquare,
  Tag,
  BookOpen,
};

function CategoryIcon({ name, className }) {
  const Icon = ICON_MAP[name] || Tag;
  return <Icon className={className} />;
}

function escapeHtml(input = "") {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hasHtmlTag(value = "") {
  return /<[^>]+>/.test(String(value || ""));
}

function stripHtmlToPlainText(value = "") {
  const raw = String(value || "");
  if (!raw) return "";
  const withLineHints = raw
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|ul|ol|section|article|header|footer|main|tr)>/gi, "\n");
  if (typeof document === "undefined") {
    return withLineHints
      .replace(/<[^>]+>/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const container = document.createElement("div");
  container.innerHTML = withLineHints;
  return String(container.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeSavedReplyHtmlClient(value = "") {
  const source = String(value || "");
  if (!source.trim()) return "";
  if (typeof document === "undefined") {
    return source
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\1>/gi, "")
      .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "")
      .trim();
  }

  const allowedTags = new Set(["B", "STRONG", "I", "EM", "U", "BR", "P", "DIV", "UL", "OL", "LI", "A"]);
  const sourceContainer = document.createElement("div");
  sourceContainer.innerHTML = source;

  const sanitizeNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(String(node.nodeValue || ""));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    const element = node;
    const tag = String(element.tagName || "").toUpperCase();
    const fragment = document.createDocumentFragment();
    const sanitizedChildren = Array.from(element.childNodes || []).map(sanitizeNode);
    if (!allowedTags.has(tag)) {
      sanitizedChildren.forEach((child) => fragment.appendChild(child));
      return fragment;
    }
    const cleanElement = document.createElement(tag.toLowerCase());
    if (tag === "A") {
      const hrefRaw = String(element.getAttribute("href") || "").trim();
      const isSafeHref = /^https?:\/\//i.test(hrefRaw) || /^mailto:/i.test(hrefRaw);
      if (isSafeHref) {
        cleanElement.setAttribute("href", hrefRaw);
        cleanElement.setAttribute("target", "_blank");
        cleanElement.setAttribute("rel", "noreferrer noopener");
      }
    }
    sanitizedChildren.forEach((child) => cleanElement.appendChild(child));
    return cleanElement;
  };

  const targetContainer = document.createElement("div");
  Array.from(sourceContainer.childNodes || []).forEach((node) => {
    targetContainer.appendChild(sanitizeNode(node));
  });
  return targetContainer.innerHTML.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

function toSavedReplyEditorHtml(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (hasHtmlTag(raw)) return sanitizeSavedReplyHtmlClient(raw);
  return escapeHtml(raw).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

function CategoryCard({ category, onClick }) {
  return (
    <Card
      className="group cursor-pointer transition-colors hover:bg-muted/50"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <CategoryIcon name={category.icon} className="h-4 w-4 text-muted-foreground" />
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-sm">{category.label}</CardTitle>
        {category.description && (
          <CardDescription className="mt-1 text-xs line-clamp-2">
            {category.description}
          </CardDescription>
        )}
      </CardContent>
    </Card>
  );
}

function SavedRepliesSection() {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = new, object = edit
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [savedReplyImages, setSavedReplyImages] = useState([]);
  const savedReplyImageInputRef = useRef(null);
  const savedReplyEditorRef = useRef(null);

  const resetForm = () => {
    setEditing(null);
    setTitle("");
    setContent("");
    setCategory("");
    setSavedReplyImages([]);
    if (savedReplyImageInputRef.current) {
      savedReplyImageInputRef.current.value = "";
    }
    if (savedReplyEditorRef.current) {
      savedReplyEditorRef.current.innerHTML = "";
    }
  };

  const loadReplies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/saved-replies", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      setReplies(Array.isArray(data?.replies) ? data.replies : []);
    } catch {
      setReplies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReplies(); }, [loadReplies]);

  const openNew = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEdit = (reply) => {
    setEditing(reply);
    setTitle(reply.title || "");
    setContent(String(reply.content || ""));
    setCategory(reply.category || "");
    setSavedReplyImages(
      Array.isArray(reply?.images)
        ? reply.images.filter(Boolean)
        : reply?.image
          ? [reply.image]
          : []
    );
    if (savedReplyImageInputRef.current) {
      savedReplyImageInputRef.current.value = "";
    }
    setModalOpen(true);
    requestAnimationFrame(() => {
      const editor = savedReplyEditorRef.current;
      if (editor) {
        editor.innerHTML = toSavedReplyEditorHtml(String(reply?.content || ""));
      }
    });
  };

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : "");
      };
      reader.onerror = () => reject(reader.error || new Error("Could not read file"));
      reader.readAsDataURL(file);
    });

  const handleSavedReplyImageChange = async (event) => {
    const files = Array.from(event?.target?.files || []);
    if (!files.length) return;
    const prepared = [];
    for (const file of files) {
      const mimeType = String(file.type || "").toLowerCase();
      if (!mimeType.startsWith("image/")) {
        toast.error(`"${file.name}" is not an image`);
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`"${file.name}" is larger than 5 MB`);
        continue;
      }
      try {
        const contentBase64 = await fileToBase64(file);
        if (!contentBase64) continue;
        prepared.push({
          filename: String(file.name || "saved-reply-image"),
          mime_type: mimeType,
          content_base64: contentBase64,
          size_bytes: Number(file.size || 0),
        });
      } catch {
        toast.error(`Could not read "${file.name}"`);
      }
    }
    if (prepared.length) {
      setSavedReplyImages((prev) => {
        const next = [...prev];
        prepared.forEach((image) => {
          const key = `${image.filename}:${image.size_bytes}:${image.mime_type}`;
          if (!next.some((item) => `${item.filename}:${item.size_bytes}:${item.mime_type}` === key)) {
            next.push(image);
          }
        });
        return next.slice(0, 10);
      });
    }
    if (event?.target) event.target.value = "";
  };

  const removeSavedReplyImageAt = (index) => {
    setSavedReplyImages((prev) => prev.filter((_, i) => i !== index));
  };

  const syncSavedReplyEditorToState = () => {
    const editor = savedReplyEditorRef.current;
    if (!editor) return;
    const sanitized = sanitizeSavedReplyHtmlClient(editor.innerHTML);
    if (editor.innerHTML !== sanitized) {
      editor.innerHTML = sanitized;
    }
    setContent(sanitized);
  };

  const handleSavedReplyEditorPaste = (event) => {
    event.preventDefault();
    const clipboard = event?.clipboardData;
    const html = String(clipboard?.getData("text/html") || "");
    const text = String(clipboard?.getData("text/plain") || "");
    const editor = savedReplyEditorRef.current;
    if (!editor) return;
    editor.focus();
    if (html.trim()) {
      document.execCommand("insertHTML", false, sanitizeSavedReplyHtmlClient(html));
    } else if (text.trim()) {
      document.execCommand("insertText", false, text);
    }
    syncSavedReplyEditorToState();
  };

  const applySavedReplyFormatting = (command) => {
    const editor = savedReplyEditorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false);
    syncSavedReplyEditorToState();
  };

  const handleSave = async () => {
    const contentValue = String(content || "").trim();
    if (!title.trim() || !stripHtmlToPlainText(contentValue)) return;
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        content: contentValue,
        category: category.trim() || null,
        images: savedReplyImages,
      };
      if (editing?.id) {
        const res = await fetch("/api/settings/saved-replies", {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editing.id, ...body }),
        });
        if (!res.ok) throw new Error("Could not update");
      } else {
        const res = await fetch("/api/settings/saved-replies", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Could not create");
      }
      toast.success(editing?.id ? "Saved reply updated" : "Saved reply created");
      setModalOpen(false);
      resetForm();
      loadReplies();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      const res = await fetch("/api/settings/saved-replies", {
        method: "DELETE", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Could not delete");
      toast.success("Deleted");
      setReplies((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Saved Replies</h2>
          {replies.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {replies.length}
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={openNew}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New reply
        </Button>
      </div>

      {loading ? (
        <div className="rounded-lg border divide-y overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4 ml-auto" />
            </div>
          ))}
        </div>
      ) : replies.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted mb-3">
            <BookMarked className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No saved replies yet</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-xs">
            Create reusable replies your team can insert into drafts with one click.
          </p>
          <Button className="mt-4" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create first reply
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border divide-y overflow-hidden">
          {replies.map((reply) => (
            <div key={reply.id} className="group flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">{reply.title}</span>
                  {reply.category && (
                    <Badge variant="secondary" className="text-xs shrink-0">{reply.category}</Badge>
                  )}
                  {(Array.isArray(reply?.images) ? reply.images.length : reply?.image ? 1 : 0) > 0 && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {(Array.isArray(reply?.images) ? reply.images.length : 1) === 1
                        ? "1 image"
                        : `${Array.isArray(reply?.images) ? reply.images.length : 1} images`}
                    </Badge>
                  )}
                  {!reply.is_active && (
                    <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">Inactive</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {stripHtmlToPlainText(reply?.content || "").slice(0, 80)}
                </p>
              </div>
              {reply.use_count > 0 && (
                <span className="text-xs text-muted-foreground shrink-0">{reply.use_count}×</span>
              )}
              <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(reply)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {confirmDeleteId === reply.id ? (
                  <div className="flex items-center gap-1">
                    <Button variant="destructive" size="sm" className="h-7 text-xs px-2"
                      disabled={deletingId === reply.id}
                      onClick={() => handleDelete(reply.id)}>
                      Delete
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs px-2"
                      onClick={() => setConfirmDeleteId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDeleteId(reply.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit saved reply" : "New saved reply"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input placeholder="e.g. Firmware update guide" value={title}
                onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Category <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input placeholder="e.g. Returns, Technical" value={category}
                onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Content</Label>
              <div className="overflow-hidden rounded-md border border-gray-200">
                <div className="flex items-center gap-1 border-b border-gray-200 bg-muted/40 px-2 py-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => applySavedReplyFormatting("bold")}
                    title="Bold"
                  >
                    <BoldIcon className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => applySavedReplyFormatting("italic")}
                    title="Italic"
                  >
                    <ItalicIcon className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => applySavedReplyFormatting("underline")}
                    title="Underline"
                  >
                    <UnderlineIcon className="h-3.5 w-3.5" />
                  </Button>
                  <div className="mx-1 h-4 w-px bg-gray-300" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => applySavedReplyFormatting("insertUnorderedList")}
                    title="Bulleted list"
                  >
                    <ListIcon className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => applySavedReplyFormatting("insertOrderedList")}
                    title="Numbered list"
                  >
                    <ListOrderedIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="relative">
                  {!stripHtmlToPlainText(content) ? (
                    <p className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground">
                      Write the reply text here...
                    </p>
                  ) : null}
                  <div
                    ref={savedReplyEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={syncSavedReplyEditorToState}
                    onPaste={handleSavedReplyEditorPaste}
                    className="min-h-[220px] max-h-[420px] overflow-y-auto px-3 py-2 text-sm leading-6 outline-none"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Images (optional)</Label>
              <input
                ref={savedReplyImageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleSavedReplyImageChange}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => savedReplyImageInputRef.current?.click()}
                >
                  <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                  Add images
                </Button>
                <span className="text-xs text-muted-foreground">Up to 10 images (max 5 MB each)</span>
              </div>
              {savedReplyImages.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {savedReplyImages.map((image, index) => (
                    <div key={`${image.filename}-${image.size_bytes}-${index}`} className="rounded-md border border-gray-200 bg-muted/20 p-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-muted-foreground">{image.filename}</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => removeSavedReplyImageAt(index)}
                        >
                          Remove
                        </Button>
                      </div>
                      <Image
                        src={`data:${image.mime_type};base64,${image.content_base64}`}
                        alt={image.filename || "Saved reply image"}
                        width={320}
                        height={180}
                        unoptimized
                        className="h-24 w-full rounded border border-gray-200 bg-white object-contain"
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!title.trim() || !stripHtmlToPlainText(content) || saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function KnowledgeCategoriesClient() {
  const router = useRouter();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/knowledge/categories", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      setCategories(data?.categories ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleCreate = () => {
    const label = newLabel.trim();
    if (!label) return;
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9æøå\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    setCreateOpen(false);
    setNewLabel("");
    router.push(`/knowledge/${slug}?label=${encodeURIComponent(label)}&new=1`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage what your AI knows about your store
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New category
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-9 w-9 rounded-md" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((cat) => (
            <CategoryCard
              key={cat.slug}
              category={cat}
              onClick={() => router.push(`/knowledge/${cat.slug}`)}
            />
          ))}
          <Card
            className="cursor-pointer border-dashed hover:bg-muted/30 transition-colors"
            onClick={() => setCreateOpen(true)}
          >
            <CardContent className="flex flex-col items-center justify-center h-full min-h-[120px] text-muted-foreground gap-2 pt-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed">
                <Plus className="h-4 w-4" />
              </div>
              <span className="text-sm">New category</span>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />
      <SavedRepliesSection />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create new category</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                placeholder="e.g. Warranty, Technical support..."
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newLabel.trim() || creating}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
