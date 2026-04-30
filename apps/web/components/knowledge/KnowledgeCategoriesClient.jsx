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
  ImagePlus,
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

  const allowedTags = new Set([
    "B",
    "STRONG",
    "I",
    "EM",
    "U",
    "BR",
    "P",
    "DIV",
    "UL",
    "OL",
    "LI",
    "A",
    "IMG",
  ]);
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
    if (tag === "IMG") {
      const dataContentIdRaw = String(element.getAttribute("data-content-id") || "").trim();
      const safeDataContentId = normalizeContentId(dataContentIdRaw);
      const srcRaw = String(element.getAttribute("src") || "").trim();
      const isCidSrc = /^cid:[A-Za-z0-9._@-]+$/i.test(srcRaw);
      const isDataSrc = /^data:image\//i.test(srcRaw);
      const safeSrc = isCidSrc || (isDataSrc && safeDataContentId) ? srcRaw : "";
      if (!safeSrc) return document.createDocumentFragment();
      const cleanImg = document.createElement("img");
      cleanImg.setAttribute("src", safeSrc);
      if (safeDataContentId) cleanImg.setAttribute("data-content-id", safeDataContentId);
      const altRaw = String(element.getAttribute("alt") || "").trim();
      if (altRaw) cleanImg.setAttribute("alt", altRaw);
      const widthRaw = String(element.getAttribute("width") || "").trim();
      if (/^\d{1,4}$/.test(widthRaw)) cleanImg.setAttribute("width", widthRaw);
      const heightRaw = String(element.getAttribute("height") || "").trim();
      if (/^\d{1,4}$/.test(heightRaw)) cleanImg.setAttribute("height", heightRaw);
      return cleanImg;
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

function normalizeSavedReplyImageDeliveryMode(value = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "inline" ? "inline" : "attachment";
}

function normalizeContentId(value = "", fallback = "") {
  const cleaned = String(value || fallback || "")
    .trim()
    .replace(/^cid:/i, "")
    .replace(/[^A-Za-z0-9._@-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || null;
}

function makeSavedReplyContentId(filename = "") {
  const stem = String(filename || "image")
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return normalizeContentId(`${stem || "image"}-${suffix}`);
}

function toSavedReplyEditorPreviewHtml(value = "", images = []) {
  const html = toSavedReplyEditorHtml(value);
  if (!html) return "";
  const imageByCid = new Map(
    (Array.isArray(images) ? images : [])
      .map((image) => {
        const cid = normalizeContentId(image?.content_id || image?.contentId, image?.filename);
        const mimeType = String(image?.mime_type || image?.mimeType || "").trim();
        const base64 = String(image?.content_base64 || image?.contentBase64 || "").trim();
        if (!cid || !mimeType || !base64) return null;
        return [cid, { mimeType, base64 }];
      })
      .filter(Boolean)
  );
  return html.replace(
    /<img\b([^>]*?)\bsrc=(['"])cid:([^'"]+)\2([^>]*)>/gi,
    (match, before = "", _quote = "\"", rawCid = "", after = "") => {
      const cid = normalizeContentId(rawCid);
      if (!cid) return match;
      const image = imageByCid.get(cid);
      if (!image) return match;
      return `<img${before}src="data:${image.mimeType};base64,${image.base64}" data-content-id="${cid}"${after}>`;
    }
  );
}

function toSavedReplyStorageHtml(value = "") {
  return String(value || "").replace(/<img\b([^>]*)>/gi, (_match, attrs = "") => {
    const srcMatch = String(attrs).match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const srcRaw = srcMatch?.[2] || srcMatch?.[3] || srcMatch?.[4] || "";
    const dataCidMatch = String(attrs).match(
      /\sdata-content-id\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i
    );
    const dataCidRaw = dataCidMatch?.[2] || dataCidMatch?.[3] || dataCidMatch?.[4] || "";
    const cid = normalizeContentId(
      dataCidRaw,
      /^cid:/i.test(String(srcRaw || "").trim()) ? String(srcRaw).trim().slice(4) : ""
    );
    if (!cid) return "";

    const altMatch = String(attrs).match(/\salt\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const altRaw = altMatch?.[2] || altMatch?.[3] || altMatch?.[4] || "";
    const widthMatch = String(attrs).match(/\swidth\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const widthRaw = widthMatch?.[2] || widthMatch?.[3] || widthMatch?.[4] || "";
    const heightMatch = String(attrs).match(/\sheight\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const heightRaw = heightMatch?.[2] || heightMatch?.[3] || heightMatch?.[4] || "";
    const safeWidth = /^\d{1,4}$/.test(String(widthRaw || "").trim()) ? String(widthRaw).trim() : "";
    const safeHeight = /^\d{1,4}$/.test(String(heightRaw || "").trim()) ? String(heightRaw).trim() : "";
    const altAttr = altRaw ? ` alt="${escapeHtml(altRaw)}"` : "";
    const widthAttr = safeWidth ? ` width="${safeWidth}"` : "";
    const heightAttr = safeHeight ? ` height="${safeHeight}"` : "";
    return `<img src="cid:${cid}"${altAttr}${widthAttr}${heightAttr}>`;
  });
}

const ICON_COLORS = {
  Package: "bg-blue-50 text-blue-600",
  RotateCcw: "bg-orange-50 text-orange-600",
  Truck: "bg-green-50 text-green-600",
  MessageSquare: "bg-purple-50 text-purple-600",
  Tag: "bg-yellow-50 text-yellow-600",
  BookOpen: "bg-indigo-50 text-indigo-600",
};

function CategoryCard({ category, onClick, index = 0 }) {
  const iconColor = ICON_COLORS[category.icon] || "bg-gray-50 text-gray-500";
  return (
    <Card
      className="group cursor-pointer border-gray-200 transition-all duration-150 hover:border-gray-300 hover:shadow-sm active:scale-[0.98]"
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconColor}`}>
            <CategoryIcon name={category.icon} className="h-4 w-4" />
          </div>
          <ChevronRight className="h-4 w-4 text-gray-300 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-gray-400" />
        </div>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-[13px] font-semibold text-gray-900">{category.label}</CardTitle>
        {category.description && (
          <CardDescription className="mt-1 text-[12px] line-clamp-2 leading-[1.5]">
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
  const savedReplyImageResizeStateRef = useRef(null);

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
      (
        Array.isArray(reply?.images)
          ? reply.images.filter(Boolean)
          : reply?.image
            ? [reply.image]
            : []
      ).map((image) => ({
        ...image,
        delivery_mode: normalizeSavedReplyImageDeliveryMode(
          image?.delivery_mode || image?.deliveryMode
        ),
        content_id: normalizeContentId(image?.content_id || image?.contentId, image?.filename),
      }))
    );
    if (savedReplyImageInputRef.current) {
      savedReplyImageInputRef.current.value = "";
    }
    setModalOpen(true);
    requestAnimationFrame(() => {
      const editor = savedReplyEditorRef.current;
      if (editor) {
        editor.innerHTML = toSavedReplyEditorPreviewHtml(
          String(reply?.content || ""),
          Array.isArray(reply?.images) ? reply.images : []
        );
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
          delivery_mode: "inline",
          content_id: makeSavedReplyContentId(file.name),
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
      const editor = savedReplyEditorRef.current;
      if (editor) {
        editor.focus();
        prepared.forEach((image) => {
          if (!image?.content_id) return;
          document.execCommand(
            "insertHTML",
            false,
            `<img src="data:${image.mime_type};base64,${image.content_base64}" data-content-id="${image.content_id}" alt="${escapeHtml(
              image.filename || "Inline image"
            )}">`
          );
        });
        syncSavedReplyEditorToState();
      }
    }
    if (event?.target) event.target.value = "";
  };

  const removeSavedReplyImageAt = (index) => {
    const image = (Array.isArray(savedReplyImages) ? savedReplyImages : [])[index];
    setSavedReplyImages((prev) => prev.filter((_, i) => i !== index));
    const contentId = normalizeContentId(image?.content_id || image?.contentId);
    if (!contentId) return;
    const editor = savedReplyEditorRef.current;
    if (!editor) return;
    editor.innerHTML = String(editor.innerHTML || "").replace(
      new RegExp(
        `<img\\b[^>]*(?:\\bdata-content-id=(['\"])${contentId}\\1|\\bsrc=(['\"])cid:${contentId}\\2)[^>]*>`,
        "gi"
      ),
      ""
    );
    syncSavedReplyEditorToState();
  };

  const toggleSavedReplyImageMode = (index, nextMode) => {
    setSavedReplyImages((prev) =>
      (Array.isArray(prev) ? prev : []).map((image, i) =>
        i === index
          ? { ...image, delivery_mode: normalizeSavedReplyImageDeliveryMode(nextMode) }
          : image
      )
    );
  };

  const syncSavedReplyEditorToState = () => {
    const editor = savedReplyEditorRef.current;
    if (!editor) return;
    const sanitized = sanitizeSavedReplyHtmlClient(editor.innerHTML);
    if (editor.innerHTML !== sanitized) {
      editor.innerHTML = sanitized;
    }
    setContent(toSavedReplyStorageHtml(sanitized));
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

  const getSavedReplyResizeTarget = (event) => {
    const target = event?.target;
    if (!(target instanceof HTMLImageElement)) return null;
    const rect = target.getBoundingClientRect();
    const handleZonePx = 16;
    const inCorner =
      event.clientX >= rect.right - handleZonePx && event.clientY >= rect.bottom - handleZonePx;
    return inCorner ? target : null;
  };

  const handleSavedReplyEditorMouseMove = (event) => {
    const editor = savedReplyEditorRef.current;
    if (!editor) return;
    const target = getSavedReplyResizeTarget(event);
    editor.style.cursor = target ? "nwse-resize" : "";
  };

  const handleSavedReplyEditorMouseLeave = () => {
    const editor = savedReplyEditorRef.current;
    if (!editor) return;
    if (!savedReplyImageResizeStateRef.current) {
      editor.style.cursor = "";
    }
  };

  const handleSavedReplyEditorMouseDown = (event) => {
    const img = getSavedReplyResizeTarget(event);
    if (!img) return;
    event.preventDefault();
    const editor = savedReplyEditorRef.current;
    const startWidth =
      Number(img.getAttribute("width")) || Number(img.width) || Number(img.clientWidth) || 320;
    const startHeight =
      Number(img.getAttribute("height")) || Number(img.height) || Number(img.clientHeight) || 180;
    const ratio = startHeight > 0 ? startWidth / startHeight : 1;

    savedReplyImageResizeStateRef.current = {
      img,
      startX: Number(event.clientX || 0),
      startWidth,
      ratio,
    };
    if (editor) editor.style.cursor = "nwse-resize";

    const onMove = (moveEvent) => {
      const state = savedReplyImageResizeStateRef.current;
      if (!state?.img) return;
      const deltaX = Number(moveEvent.clientX || 0) - state.startX;
      const nextWidth = Math.max(80, Math.min(1200, Math.round(state.startWidth + deltaX)));
      const nextHeight = Math.max(40, Math.round(nextWidth / Math.max(state.ratio || 1, 0.1)));
      state.img.style.width = `${nextWidth}px`;
      state.img.style.height = "auto";
      state.img.setAttribute("width", String(nextWidth));
      state.img.setAttribute("height", String(nextHeight));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      savedReplyImageResizeStateRef.current = null;
      if (editor) editor.style.cursor = "";
      syncSavedReplyEditorToState();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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
        images: (Array.isArray(savedReplyImages) ? savedReplyImages : []).map((image) => ({
          filename: String(image?.filename || "saved-reply-image"),
          mime_type: String(image?.mime_type || image?.mimeType || "image/png"),
          content_base64: String(image?.content_base64 || image?.contentBase64 || ""),
          size_bytes: Number(image?.size_bytes || image?.sizeBytes || 0),
          delivery_mode: normalizeSavedReplyImageDeliveryMode(
            image?.delivery_mode || image?.deliveryMode
          ),
          content_id: normalizeContentId(image?.content_id || image?.contentId, image?.filename),
        })),
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
          <h2 className="text-[15px] font-semibold text-gray-900">Saved Replies</h2>
          {replies.length > 0 && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
              {replies.length}
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={openNew} className="gap-1">
          <Plus className="h-3.5 w-3.5" />
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
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {replies.map((reply) => (
            <div key={reply.id} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/60">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[13px] font-medium text-gray-900 truncate">{reply.title}</span>
                  {reply.category && (
                    <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">{reply.category}</span>
                  )}
                  {(Array.isArray(reply?.images) ? reply.images.length : reply?.image ? 1 : 0) > 0 && (
                    <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-600">
                      {(Array.isArray(reply?.images) ? reply.images.length : 1) === 1
                        ? "1 image"
                        : `${Array.isArray(reply?.images) ? reply.images.length : 1} images`}
                    </span>
                  )}
                  {!reply.is_active && (
                    <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-400">Inactive</span>
                  )}
                </div>
                <p className="text-[12px] text-gray-400 truncate mt-0.5">
                  {stripHtmlToPlainText(reply?.content || "").slice(0, 90)}
                </p>
              </div>
              {reply.use_count > 0 && (
                <span className="text-[12px] text-gray-400 shrink-0">{reply.use_count}×</span>
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
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
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
                  <div className="mx-1 h-4 w-px bg-gray-300" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => savedReplyImageInputRef.current?.click()}
                    title="Insert image"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
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
                    onMouseDown={handleSavedReplyEditorMouseDown}
                    onMouseMove={handleSavedReplyEditorMouseMove}
                    onMouseLeave={handleSavedReplyEditorMouseLeave}
                    className="min-h-[220px] max-h-[420px] overflow-y-auto px-3 py-2 text-sm leading-6 outline-none [&_img]:my-2 [&_img]:inline-block [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-gray-200 [&_img]:align-middle"
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
                <span className="text-xs text-muted-foreground">
                  Upload inserts image inline by default. Toggle each to attachment if needed.
                </span>
              </div>
              {savedReplyImages.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {savedReplyImages.map((image, index) => {
                    const isInline =
                      normalizeSavedReplyImageDeliveryMode(
                        image?.delivery_mode || image?.deliveryMode
                      ) === "inline";
                    return (
                    <div key={`${image.filename}-${image.size_bytes}-${index}`} className="rounded-md border border-gray-200 bg-muted/20 p-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-muted-foreground">{image.filename}</p>
                      </div>
                      <div className="mb-2 flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={isInline ? "default" : "outline"}
                          className="h-6 px-2 text-xs"
                          onClick={() => toggleSavedReplyImageMode(index, "inline")}
                        >
                          Inline
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={!isInline ? "default" : "outline"}
                          className="h-6 px-2 text-xs"
                          onClick={() => toggleSavedReplyImageMode(index, "attachment")}
                        >
                          Attachment
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 px-2 text-xs"
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
                      {isInline && image?.content_id ? (
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">
                          CID: {String(image.content_id)}
                        </p>
                      ) : null}
                    </div>
                  );
                  })}
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
  const [importingTickets, setImportingTickets] = useState(false);
  const [ticketExamplesCount, setTicketExamplesCount] = useState(null);

  const fetchTicketExamplesCount = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge/import-zendesk", { credentials: "include" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const nextCount = Number(payload?.count);
      if (Number.isFinite(nextCount)) setTicketExamplesCount(nextCount);
    } catch {
      // no-op
    }
  }, []);

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

  useEffect(() => {
    fetchTicketExamplesCount();
  }, [fetchTicketExamplesCount]);

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

  const handleImportTickets = useCallback(async () => {
    if (importingTickets) return;
    setImportingTickets(true);
    try {
      const res = await fetch("/api/knowledge/import-zendesk", {
        method: "POST",
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Could not import Zendesk tickets.");
      }
      const imported = Number(payload?.imported ?? 0);
      const totalInDb = Number(payload?.total_in_db ?? 0);
      if (Number.isFinite(totalInDb)) setTicketExamplesCount(totalInDb);
      toast.success(`Imported ${imported} tickets to ticket_examples.`);
    } catch (error) {
      toast.error(error?.message || "Could not import Zendesk tickets.");
    } finally {
      setImportingTickets(false);
      fetchTicketExamplesCount();
    }
  }, [fetchTicketExamplesCount, importingTickets]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-gray-900">Knowledge Base</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Manage what your AI knows about your store
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            New category
          </Button>
        </div>
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
          {categories.map((cat, i) => (
            <CategoryCard
              key={cat.slug}
              category={cat}
              index={i}
              onClick={() => router.push(`/knowledge/${cat.slug}`)}
            />
          ))}
          <Card
            className="group cursor-pointer border-dashed border-gray-200 transition-all duration-150 hover:border-gray-300 hover:bg-gray-50/50 active:scale-[0.98]"
            style={{ animationDelay: `${categories.length * 50}ms` }}
            onClick={() => setCreateOpen(true)}
          >
            <CardContent className="flex flex-col items-center justify-center h-full min-h-[120px] gap-2 pt-6 text-gray-400">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-gray-300 transition-colors group-hover:border-gray-400">
                <Plus className="h-4 w-4" />
              </div>
              <span className="text-[13px]">New category</span>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />
      <div className="flex items-center justify-end gap-2">
        {ticketExamplesCount !== null ? (
          <p className="text-[11px] text-gray-400">
            {ticketExamplesCount} imported ticket examples
          </p>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          onClick={handleImportTickets}
          disabled={importingTickets}
          className="h-7 px-2 text-[11px] text-gray-500 hover:text-gray-700"
        >
          {importingTickets ? "Importing..." : "Import tickets"}
        </Button>
      </div>
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
