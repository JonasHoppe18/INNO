"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import {
  Cable,
  Bold as BoldIcon,
  CheckCircle2,
  Circle,
  Database,
  ExternalLink,
  FileText,
  Italic as ItalicIcon,
  List as ListIcon,
  ListOrdered as ListOrderedIcon,
  MessageSquareText,
  Package,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Truck,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CsvSupportKnowledgeImportModal } from "@/components/knowledge/CsvSupportKnowledgeImportModal";

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPrice(value) {
  if (value === null || value === undefined || value === "") return "-";
  const num = Number(value);
  if (Number.isFinite(num)) {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  }
  return String(value);
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
  ]);
  const sourceContainer = document.createElement("div");
  sourceContainer.innerHTML = source;

  const sanitizeNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(String(node.nodeValue || ""));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createDocumentFragment();
    }

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

  return targetContainer.innerHTML
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
}

function toSavedReplyEditorHtml(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (hasHtmlTag(raw)) return sanitizeSavedReplyHtmlClient(raw);
  return escapeHtml(raw).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

function getChunkIndex(row) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const index = Number(metadata?.chunk_index);
  if (Number.isInteger(index) && index >= 0) return index;
  return 0;
}

function stitchChunkedText(chunks) {
  const ordered = Array.isArray(chunks) ? chunks.map((c) => String(c || "")).filter(Boolean) : [];
  if (!ordered.length) return "";
  let merged = ordered[0];
  for (let i = 1; i < ordered.length; i += 1) {
    const next = ordered[i];
    const maxOverlap = Math.min(220, merged.length, next.length);
    let overlap = 0;
    for (let candidate = maxOverlap; candidate >= 20; candidate -= 1) {
      if (merged.slice(-candidate) === next.slice(0, candidate)) {
        overlap = candidate;
        break;
      }
    }
    merged += next.slice(overlap);
  }
  return merged.trim();
}

export function KnowledgePageClient() {
  const supabase = useClerkSupabase();
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [shops, setShops] = useState([]);
  const [shopId, setShopId] = useState(null);
  const [shopDomain, setShopDomain] = useState("");
  const [policyRefund, setPolicyRefund] = useState("");
  const [policyShipping, setPolicyShipping] = useState("");

  const [snippets, setSnippets] = useState([]);
  const [savedReplies, setSavedReplies] = useState([]);
  const [savedRepliesLoading, setSavedRepliesLoading] = useState(false);
  const [savedReplyModalOpen, setSavedReplyModalOpen] = useState(false);
  const [savedReplyTitle, setSavedReplyTitle] = useState("");
  const [savedReplyContent, setSavedReplyContent] = useState("");
  const [savedReplyCategory, setSavedReplyCategory] = useState("");
  const [editingSavedReplyId, setEditingSavedReplyId] = useState(null);
  const [savingSavedReply, setSavingSavedReply] = useState(false);
  const [deletingSavedReplyId, setDeletingSavedReplyId] = useState(null);
  const [savingPolicies, setSavingPolicies] = useState(false);
  const [savingSnippet, setSavingSnippet] = useState(false);
  const [deletingSnippetId, setDeletingSnippetId] = useState(null);
  const [editingSnippetId, setEditingSnippetId] = useState(null);
  const [csvImportModalOpen, setCsvImportModalOpen] = useState(false);
  const [csvImportSeedFile, setCsvImportSeedFile] = useState(null);
  const [csvImportBatches, setCsvImportBatches] = useState([]);
  const [deletingCsvImportId, setDeletingCsvImportId] = useState("");
  const [csvPreviewOpen, setCsvPreviewOpen] = useState(false);
  const [csvPreviewLoading, setCsvPreviewLoading] = useState(false);
  const [csvPreviewTitle, setCsvPreviewTitle] = useState("CSV import");
  const [csvPreviewRows, setCsvPreviewRows] = useState([]);

  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [activePolicyField, setActivePolicyField] = useState("refund");
  const [snippetModalOpen, setSnippetModalOpen] = useState(false);
  const [snippetTitle, setSnippetTitle] = useState("");
  const [snippetContent, setSnippetContent] = useState("");
  const [historyProvider, setHistoryProvider] = useState(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [snippetMode, setSnippetMode] = useState("text");
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfTitle, setPdfTitle] = useState("");
  const pdfFileInputRef = useRef(null);
  const snippetEditorRef = useRef(null);
  const savedReplyEditorRef = useRef(null);
  const [productsModalOpen, setProductsModalOpen] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [productsSyncing, setProductsSyncing] = useState(false);
  const [productCount, setProductCount] = useState(0);
  const [pagesModalOpen, setPagesModalOpen] = useState(false);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pages, setPages] = useState([]);
  const [pagesSyncing, setPagesSyncing] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [metafieldsModalOpen, setMetafieldsModalOpen] = useState(false);
  const [metafieldsLoading, setMetafieldsLoading] = useState(false);
  const [metafields, setMetafields] = useState([]);
  const [metafieldsSyncing, setMetafieldsSyncing] = useState(false);
  const [metafieldCount, setMetafieldCount] = useState(0);
  const [blogsModalOpen, setBlogsModalOpen] = useState(false);
  const [blogsLoading, setBlogsLoading] = useState(false);
  const [blogs, setBlogs] = useState([]);
  const [blogsSyncing, setBlogsSyncing] = useState(false);
  const [blogCount, setBlogCount] = useState(0);
  const [filesModalOpen, setFilesModalOpen] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesSyncing, setFilesSyncing] = useState(false);
  const [shopFiles, setShopFiles] = useState([]);
  const [fileCount, setFileCount] = useState(0);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsSyncing, setCollectionsSyncing] = useState(false);
  const [collectionCount, setCollectionCount] = useState(0);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsSyncing, setVariantsSyncing] = useState(false);
  const [variantCount, setVariantCount] = useState(0);
  const [metaobjectsLoading, setMetaobjectsLoading] = useState(false);
  const [metaobjectsSyncing, setMetaobjectsSyncing] = useState(false);
  const [metaobjectCount, setMetaobjectCount] = useState(0);
  const [shopifyPoliciesLoading, setShopifyPoliciesLoading] = useState(false);
  const [shopifyPoliciesSyncing, setShopifyPoliciesSyncing] = useState(false);
  const [shopifyPolicyCount, setShopifyPolicyCount] = useState(0);
  const normalizedShopDomain = useMemo(
    () => String(shopDomain || "").replace(/^https?:\/\//i, "").replace(/\/+$/, ""),
    [shopDomain]
  );

  const resolveScope = useCallback(async () => {
    if (!supabase || !user?.id) return { workspaceId: null, userId: null };

    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("clerk_user_id", user.id)
      .maybeSingle();

    const userId = profile?.user_id ?? null;

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("clerk_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      workspaceId: membership?.workspace_id ?? null,
      userId,
    };
  }, [supabase, user?.id]);

  const loadHistoryConnection = useCallback(async () => {
    if (!supabase || !user?.id) {
      setHistoryProvider(null);
      return;
    }

    const { workspaceId, userId } = await resolveScope();
    const providers = ["zendesk", "gorgias", "freshdesk"];

    let data = null;

    if (workspaceId) {
      const response = await supabase
        .from("integrations")
        .select("provider, is_active, updated_at")
        .in("provider", providers)
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (response.error) {
        throw response.error;
      }
      data = Array.isArray(response.data) ? response.data[0] : null;
    }

    if (!data && userId) {
      const response = await supabase
        .from("integrations")
        .select("provider, is_active, updated_at")
        .in("provider", providers)
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (response.error) {
        throw response.error;
      }
      data = Array.isArray(response.data) ? response.data[0] : null;
    }

    setHistoryProvider(typeof data?.provider === "string" ? data.provider : null);
  }, [resolveScope, supabase, user?.id]);

  const loadShops = useCallback(async () => {
    const { data, error } = await supabase
      .from("shops")
      .select("id, shop_domain, policy_refund, policy_shipping, created_at")
      .is("uninstalled_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    setShops(rows);
    setShopId((current) => {
      if (current && rows.some((row) => row?.id === current)) return current;
      if (rows.length === 1) return rows[0]?.id || null;
      return null;
    });

    return rows;
  }, [supabase]);

  useEffect(() => {
    const selected = shops.find((row) => row?.id === shopId) || null;
    setShopDomain(typeof selected?.shop_domain === "string" ? selected.shop_domain : "");
    setPolicyRefund(selected?.policy_refund || "");
    setPolicyShipping(selected?.policy_shipping || "");
  }, [shops, shopId]);

  const loadSnippets = useCallback(
    async (currentShopId) => {
      if (!currentShopId) {
        setSnippets([]);
        return;
      }

      const { data, error } = await supabase
        .from("agent_knowledge")
        .select("id, content, metadata, created_at, source_provider, source_type")
        .eq("shop_id", currentShopId)
        .in("source_provider", ["manual_text", "pdf_upload", "image_upload"])
        .order("created_at", { ascending: false });

      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      const grouped = new Map();
      for (const row of rows) {
        const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
        const snippetId = String(metadata?.snippet_id || row?.id || "").trim();
        if (!snippetId) continue;
        const existing = grouped.get(snippetId) || {
          id: snippetId,
          title: "",
          created_at: null,
          source_provider: String(row?.source_provider || ""),
          chunks: [],
        };
        if (!existing.title) {
          existing.title =
            String(metadata?.title || metadata?.file_name || "").trim() ||
            (row?.source_provider === "manual_text" ? "Untitled snippet" : "Uploaded File");
        }
        if (!existing.created_at || String(row?.created_at || "") > String(existing.created_at || "")) {
          existing.created_at = row?.created_at || null;
        }
        existing.chunks.push({
          index: getChunkIndex(row),
          content: String(row?.content || ""),
        });
        grouped.set(snippetId, existing);
      }
      const prepared = Array.from(grouped.values()).map((snippet) => {
        const sortedChunks = (snippet.chunks || [])
          .slice()
          .sort((a, b) => Number(a?.index || 0) - Number(b?.index || 0))
          .map((item) => String(item?.content || ""));
        const stitchedContent = stitchChunkedText(sortedChunks);
        return {
          id: snippet.id,
          title: snippet.title,
          created_at: snippet.created_at,
          source_provider: snippet.source_provider,
          content: snippet.source_provider === "manual_text" ? stitchedContent : "",
        };
      });
      setSnippets(prepared);
    },
    [supabase]
  );

  const loadCsvImportBatches = useCallback(async (currentShopId) => {
    if (!currentShopId) {
      setCsvImportBatches([]);
      return;
    }
    try {
      const response = await fetch(
        `/api/knowledge/import-csv?shop_id=${encodeURIComponent(String(currentShopId))}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load CSV imports.");
      }
      setCsvImportBatches(Array.isArray(payload?.batches) ? payload.batches : []);
    } catch (error) {
      console.warn("CSV import batches load failed", error);
      setCsvImportBatches([]);
    }
  }, []);

  const loadSavedReplies = useCallback(async () => {
    setSavedRepliesLoading(true);
    try {
      const response = await fetch("/api/settings/saved-replies", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404) {
          setSavedReplies([]);
          return;
        }
        throw new Error(payload?.error || "Could not load saved replies.");
      }
      setSavedReplies(Array.isArray(payload?.replies) ? payload.replies : []);
    } catch (error) {
      console.warn("Saved replies load failed", error);
      setSavedReplies([]);
    } finally {
      setSavedRepliesLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const shopRows = await loadShops();
      const currentShopId =
        shopId && shopRows.some((row) => row?.id === shopId)
          ? shopId
          : shopRows.length === 1
          ? shopRows[0]?.id || null
          : null;
      await Promise.all([loadHistoryConnection(), loadSavedReplies()]);
      if (!currentShopId) {
        setSnippets([]);
        setCsvImportBatches([]);
        setProductCount(0);
        setPageCount(0);
        setMetafieldCount(0);
        setBlogCount(0);
        setFileCount(0);
        setCollectionCount(0);
        setVariantCount(0);
        setMetaobjectCount(0);
        setShopifyPolicyCount(0);
        return;
      }
      await Promise.all([loadSnippets(currentShopId), loadCsvImportBatches(currentShopId)]);
      const [
        productsCountResponse,
        pagesCountResponse,
        metafieldsCountResponse,
        blogsCountResponse,
        filesCountResponse,
        collectionsCountResponse,
        variantsCountResponse,
        metaobjectsCountResponse,
        policiesCountResponse,
      ] = await Promise.all([
        fetch(`/api/knowledge/sync-products?shop_id=${encodeURIComponent(String(currentShopId))}`, { method: "GET" }),
        fetch(`/api/knowledge/sync-pages?shop_id=${encodeURIComponent(String(currentShopId))}`, { method: "GET" }),
        fetch(`/api/knowledge/sync-metafields?shop_id=${encodeURIComponent(String(currentShopId))}`, { method: "GET" }),
        fetch(`/api/knowledge/sync-blogs?shop_id=${encodeURIComponent(String(currentShopId))}`, { method: "GET" }),
        fetch(`/api/knowledge/sync-files?shop_id=${encodeURIComponent(String(currentShopId))}`, { method: "GET" }),
        fetch(`/api/knowledge/sync-collections?shop_id=${encodeURIComponent(String(currentShopId))}`, { method: "GET" }),
        fetch(`/api/knowledge/sync-variants?shop_id=${encodeURIComponent(String(currentShopId))}`, { method: "GET" }),
        fetch(`/api/knowledge/sync-metaobjects?shop_id=${encodeURIComponent(String(currentShopId))}`, { method: "GET" }),
        fetch(`/api/knowledge/sync-policies?shop_id=${encodeURIComponent(String(currentShopId))}`, { method: "GET" }),
      ]);
      const productsCountPayload = await productsCountResponse.json().catch(() => ({}));
      if (productsCountResponse.ok) {
        setProductCount(Number(productsCountPayload?.count ?? 0));
      }
      const pagesCountPayload = await pagesCountResponse.json().catch(() => ({}));
      if (pagesCountResponse.ok) {
        setPageCount(Number(pagesCountPayload?.count ?? 0));
      }
      const metafieldsCountPayload = await metafieldsCountResponse.json().catch(() => ({}));
      if (metafieldsCountResponse.ok) {
        setMetafieldCount(Number(metafieldsCountPayload?.count ?? 0));
      }
      const blogsCountPayload = await blogsCountResponse.json().catch(() => ({}));
      if (blogsCountResponse.ok) {
        setBlogCount(Number(blogsCountPayload?.count ?? 0));
      }
      const filesCountPayload = await filesCountResponse.json().catch(() => ({}));
      if (filesCountResponse.ok) {
        setFileCount(Number(filesCountPayload?.count ?? 0));
      }
      const collectionsCountPayload = await collectionsCountResponse.json().catch(() => ({}));
      if (collectionsCountResponse.ok) {
        setCollectionCount(Number(collectionsCountPayload?.count ?? 0));
      }
      const variantsCountPayload = await variantsCountResponse.json().catch(() => ({}));
      if (variantsCountResponse.ok) {
        setVariantCount(Number(variantsCountPayload?.count ?? 0));
      }
      const metaobjectsCountPayload = await metaobjectsCountResponse.json().catch(() => ({}));
      if (metaobjectsCountResponse.ok) {
        setMetaobjectCount(Number(metaobjectsCountPayload?.count ?? 0));
      }
      const policiesCountPayload = await policiesCountResponse.json().catch(() => ({}));
      if (policiesCountResponse.ok) {
        setShopifyPolicyCount(Number(policiesCountPayload?.count ?? 0));
      }
    } catch (error) {
      console.warn("KnowledgePageClient load failed", error);
      toast.error("Could not load knowledge data.");
    } finally {
      setLoading(false);
    }
  }, [loadCsvImportBatches, loadHistoryConnection, loadSavedReplies, loadShops, loadSnippets, shopId, supabase]);

  useEffect(() => {
    loadData().catch(() => null);
  }, [loadData]);

  const policyStatus = useMemo(
    () => ({
      returnsConfigured: policyRefund.trim().length > 0,
      shippingConfigured: policyShipping.trim().length > 0,
    }),
    [policyRefund, policyShipping]
  );
  const hasHistoryConnection = Boolean(historyProvider);
  const knowledgeItems = useMemo(() => {
    const snippetItems = (snippets || []).map((snippet) => ({
      kind: "snippet",
      key: `snippet:${String(snippet?.id || "")}`,
      id: String(snippet?.id || ""),
      title: String(snippet?.title || "Untitled snippet"),
      created_at: snippet?.created_at || null,
      source_provider: String(snippet?.source_provider || ""),
      row_count: null,
    }));
    const csvItems = (csvImportBatches || []).map((batch) => ({
      kind: "csv_import",
      key: `csv:${String(batch?.import_id || "")}`,
      id: String(batch?.import_id || ""),
      title: String(batch?.source_file_name || "CSV import"),
      created_at: batch?.created_at || null,
      source_provider: "csv_support_knowledge",
      row_count: Number(batch?.imported_count || 0),
    }));

    return [...snippetItems, ...csvItems].sort((a, b) => {
      const aTime = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [csvImportBatches, snippets]);

  const renderStatusIcon = (isReady, isBusy) => {
    if (isBusy) {
      return <RefreshCw className="h-4 w-4 animate-spin text-gray-400" />;
    }
    return isReady ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    ) : (
      <Circle className="h-4 w-4 text-gray-300" />
    );
  };

  const handleSavePolicies = async () => {
    if (!supabase || !shopId) {
      toast.error("No shop found.");
      return;
    }

    setSavingPolicies(true);
    try {
      const { error } = await supabase
        .from("shops")
        .update({
          policy_refund: policyRefund,
          policy_shipping: policyShipping,
        })
        .eq("id", shopId);

      if (error) throw error;

      toast.success("Policies updated.");
      setPolicyModalOpen(false);
    } catch (error) {
      console.warn("Save policies failed", error);
      toast.error("Could not save policies.");
    } finally {
      setSavingPolicies(false);
    }
  };

  const resetSnippetForm = () => {
    setEditingSnippetId(null);
    setSnippetMode("text");
    setSnippetTitle("");
    setSnippetContent("");
    setPdfFile(null);
    setPdfTitle("");
  };

  const buildSnippetDraftKey = useCallback(
    (snippetId) => {
      const scopeShop = String(shopId || "no-shop");
      const scopeUser = String(user?.id || "anon");
      const scopeSnippet = String(snippetId || "new");
      return `knowledge:snippet-draft:${scopeShop}:${scopeUser}:${scopeSnippet}`;
    },
    [shopId, user?.id],
  );

  const readSnippetDraft = useCallback(
    (snippetId) => {
      if (typeof window === "undefined") return null;
      try {
        const raw = window.localStorage.getItem(buildSnippetDraftKey(snippetId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        return {
          mode: String(parsed?.mode || "text") === "pdf" ? "pdf" : "text",
          title: String(parsed?.title || ""),
          content: String(parsed?.content || ""),
          pdfTitle: String(parsed?.pdfTitle || ""),
        };
      } catch (_error) {
        return null;
      }
    },
    [buildSnippetDraftKey],
  );

  const clearSnippetDraft = useCallback(
    (snippetId) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(buildSnippetDraftKey(snippetId));
      } catch (_error) {
        // no-op
      }
    },
    [buildSnippetDraftKey],
  );

  const hydrateSnippetEditor = (value) => {
    requestAnimationFrame(() => {
      const editor = snippetEditorRef.current;
      if (!editor) return;
      editor.innerHTML = toSavedReplyEditorHtml(value);
    });
  };

  const syncSnippetEditorToState = () => {
    const editor = snippetEditorRef.current;
    if (!editor) return;
    const sanitized = sanitizeSavedReplyHtmlClient(editor.innerHTML);
    if (editor.innerHTML !== sanitized) {
      editor.innerHTML = sanitized;
    }
    setSnippetContent(sanitized);
  };

  const handleSnippetEditorInput = () => {
    syncSnippetEditorToState();
  };

  const handleSnippetEditorPaste = (event) => {
    event.preventDefault();
    const clipboard = event?.clipboardData;
    const html = String(clipboard?.getData("text/html") || "");
    const text = String(clipboard?.getData("text/plain") || "");
    const editor = snippetEditorRef.current;
    if (!editor) return;
    editor.focus();
    if (html.trim()) {
      document.execCommand("insertHTML", false, sanitizeSavedReplyHtmlClient(html));
    } else if (text.trim()) {
      document.execCommand("insertText", false, text);
    }
    syncSnippetEditorToState();
  };

  const applySnippetFormatting = (command) => {
    const editor = snippetEditorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false);
    syncSnippetEditorToState();
  };

  const openCreateSnippetModal = () => {
    const draft = readSnippetDraft(null);
    resetSnippetForm();
    if (draft) {
      setSnippetMode(draft.mode);
      setSnippetTitle(draft.title);
      setSnippetContent(draft.content);
      setPdfTitle(draft.pdfTitle);
    }
    setSnippetModalOpen(true);
    hydrateSnippetEditor(draft?.content || "");
  };

  const openEditSnippetModal = (snippet) => {
    if (String(snippet?.source_provider || "") !== "manual_text") return;
    const nextSnippetId = String(snippet?.id || "").trim() || null;
    const draft = readSnippetDraft(nextSnippetId);
    setEditingSnippetId(nextSnippetId);
    setSnippetMode("text");
    setSnippetTitle(draft?.title || String(snippet?.title || ""));
    setSnippetContent(draft?.content || String(snippet?.content || ""));
    setPdfFile(null);
    setPdfTitle("");
    setSnippetModalOpen(true);
    hydrateSnippetEditor(draft?.content || String(snippet?.content || ""));
  };

  useEffect(() => {
    if (!snippetModalOpen) return undefined;
    const hasContent = Boolean(stripHtmlToPlainText(snippetContent));
    const hasAny = Boolean(
      snippetTitle.trim() || pdfTitle.trim() || hasContent || snippetMode === "pdf",
    );
    const draftKey = buildSnippetDraftKey(editingSnippetId);

    const timer = window.setTimeout(() => {
      if (typeof window === "undefined") return;
      try {
        if (!hasAny) {
          window.localStorage.removeItem(draftKey);
          return;
        }
        window.localStorage.setItem(
          draftKey,
          JSON.stringify({
            mode: snippetMode,
            title: snippetTitle,
            content: snippetContent,
            pdfTitle,
            updated_at: new Date().toISOString(),
          }),
        );
      } catch (_error) {
        // no-op
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    buildSnippetDraftKey,
    editingSnippetId,
    pdfTitle,
    snippetContent,
    snippetModalOpen,
    snippetMode,
    snippetTitle,
  ]);

  const handleAddSnippet = async () => {
    const draftSnippetId = editingSnippetId;
    if (!shopId) {
      toast.error("No shop found.");
      return;
    }

    const title = snippetTitle.trim();
    const content = sanitizeSavedReplyHtmlClient(snippetContent);
    const contentPlain = stripHtmlToPlainText(content);

    if (!title || !contentPlain) {
      toast.error("Title and content are required.");
      return;
    }

    setSavingSnippet(true);
    try {
      const isEditing = Boolean(editingSnippetId);
      const response = await fetch("/api/knowledge/snippets", {
        method: isEditing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: editingSnippetId || undefined,
          shop_id: shopId,
          title,
          content,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || (isEditing ? "Could not update snippet." : "Could not add snippet."));
      }

      toast.success(isEditing ? "Knowledge snippet updated." : "Knowledge snippet added.");
      clearSnippetDraft(draftSnippetId);
      setSnippetModalOpen(false);
      resetSnippetForm();
      await loadSnippets(shopId);
    } catch (error) {
      console.warn("Add snippet failed", error);
      toast.error(error instanceof Error ? error.message : "Could not save snippet.");
    } finally {
      setSavingSnippet(false);
    }
  };

  const handleAddFile = async () => {
    const draftSnippetId = editingSnippetId;
    const file = pdfFile;
    if (!file) return;
    if (!shopId) {
      toast.error("No shop found.");
      return;
    }
    const isCsvFile =
      file.name.toLowerCase().endsWith(".csv") ||
      file.type === "text/csv" ||
      file.type === "application/csv" ||
      file.type === "text/plain" ||
      file.type === "application/vnd.ms-excel";
    if (isCsvFile) {
      setCsvImportSeedFile(file);
      setSnippetModalOpen(false);
      setCsvImportModalOpen(true);
      return;
    }
    if (file.type !== "application/pdf" && !file.type.startsWith("image/")) {
      toast.error("Only PDF, image, and CSV files are supported.");
      return;
    }

    setUploadingPdf(true);
    try {
      const formData = new FormData();
      formData.append("shop_id", shopId);
      formData.append("title", String(pdfTitle || "").trim() || file.name.replace(/\.pdf$/i, ""));
      formData.append("file", file);

      const response = await fetch("/api/knowledge/snippets", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not upload file.");
      }

      toast.success("File uploaded and indexed.");
      clearSnippetDraft(draftSnippetId);
      setSnippetModalOpen(false);
      resetSnippetForm();
      await loadSnippets(shopId);
    } catch (error) {
      console.warn("File upload failed", error);
      toast.error(error instanceof Error ? error.message : "Could not upload file.");
    } finally {
      setUploadingPdf(false);
    }
  };

  const handleSaveSnippetModal = async () => {
    if (snippetMode === "pdf") {
      await handleAddFile();
      return;
    }
    await handleAddSnippet();
  };

  const loadProductsPreview = async () => {
    setProductsLoading(true);
    try {
      const response = await fetch(
        `/api/knowledge/sync-products?shop_id=${encodeURIComponent(String(shopId))}&include_products=1`,
        { method: "GET" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load products.");
      }
      setProducts(Array.isArray(payload?.products) ? payload.products : []);
      setProductCount(Number(payload?.count ?? 0));
      setProductsModalOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load products.");
    } finally {
      setProductsLoading(false);
    }
  };

  const handleSyncProducts = async () => {
    setProductsSyncing(true);
    try {
      const response = await fetch("/api/knowledge/sync-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not sync products.");
      }
      toast.success(
        `Synced ${Number(payload?.synced ?? 0)} products (${Number(payload?.indexed ?? 0)} indexed).`
      );
      setProductCount(Number(payload?.indexed ?? payload?.synced ?? 0));
      await loadProductsPreview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync products.");
    } finally {
      setProductsSyncing(false);
    }
  };

  const loadPagesPreview = async () => {
    setPagesLoading(true);
    try {
      const response = await fetch(
        `/api/knowledge/sync-pages?shop_id=${encodeURIComponent(String(shopId))}&include_pages=1`,
        { method: "GET" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load pages.");
      }
      setPages(Array.isArray(payload?.pages) ? payload.pages : []);
      setPageCount(Number(payload?.count ?? 0));
      setPagesModalOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load pages.");
    } finally {
      setPagesLoading(false);
    }
  };

  const handleSyncPages = async () => {
    setPagesSyncing(true);
    try {
      const response = await fetch("/api/knowledge/sync-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not sync pages.");
      }
      toast.success(
        `Synced ${Number(payload?.synced ?? 0)} pages (${Number(payload?.indexed ?? 0)} indexed).`
      );
      setPageCount(Number(payload?.indexed ?? payload?.synced ?? 0));
      await loadPagesPreview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync pages.");
    } finally {
      setPagesSyncing(false);
    }
  };

  const loadMetafieldsPreview = async () => {
    setMetafieldsLoading(true);
    try {
      const response = await fetch(`/api/knowledge/sync-metafields?shop_id=${encodeURIComponent(String(shopId))}&include_metafields=1`, {
        method: "GET",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load metafields.");
      }
      setMetafields(Array.isArray(payload?.metafields) ? payload.metafields : []);
      setMetafieldCount(Number(payload?.count ?? 0));
      setMetafieldsModalOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load metafields.");
    } finally {
      setMetafieldsLoading(false);
    }
  };

  const handleSyncMetafields = async () => {
    setMetafieldsSyncing(true);
    try {
      const response = await fetch("/api/knowledge/sync-metafields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not sync metafields.");
      }
      toast.success(
        `Synced ${Number(payload?.synced ?? 0)} metafields (${Number(payload?.updated_chunks ?? 0)} updated chunks).`
      );
      setMetafieldCount(Number(payload?.indexed ?? payload?.synced ?? 0));
      await loadMetafieldsPreview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync metafields.");
    } finally {
      setMetafieldsSyncing(false);
    }
  };

  const loadBlogsPreview = async () => {
    setBlogsLoading(true);
    try {
      const response = await fetch(
        `/api/knowledge/sync-blogs?shop_id=${encodeURIComponent(String(shopId))}&include_blogs=1`,
        { method: "GET" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load blog articles.");
      }
      setBlogs(Array.isArray(payload?.blogs) ? payload.blogs : []);
      setBlogCount(Number(payload?.count ?? 0));
      setBlogsModalOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load blog articles.");
    } finally {
      setBlogsLoading(false);
    }
  };

  const handleSyncBlogs = async () => {
    setBlogsSyncing(true);
    try {
      const response = await fetch("/api/knowledge/sync-blogs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not sync blog articles.");
      }
      toast.success(
        `Synced ${Number(payload?.synced ?? 0)} articles (${Number(payload?.updated_chunks ?? 0)} updated chunks).`
      );
      setBlogCount(Number(payload?.indexed ?? payload?.synced ?? 0));
      await loadBlogsPreview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync blog articles.");
    } finally {
      setBlogsSyncing(false);
    }
  };

  const loadFilesPreview = async () => {
    setFilesLoading(true);
    try {
      const response = await fetch(
        `/api/knowledge/sync-files?shop_id=${encodeURIComponent(String(shopId))}&include_files=1`,
        { method: "GET" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load files.");
      }
      setShopFiles(Array.isArray(payload?.files) ? payload.files : []);
      setFileCount(Number(payload?.count ?? 0));
      setFilesModalOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load files.");
    } finally {
      setFilesLoading(false);
    }
  };

  const handleSyncFiles = async () => {
    setFilesSyncing(true);
    setFilesLoading(true);
    try {
      const response = await fetch("/api/knowledge/sync-files?include_image_guides=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not sync files.");
      setFileCount(Number(payload?.indexed ?? payload?.synced ?? 0));
      toast.success(`Synced ${Number(payload?.synced ?? 0)} files.`);
      await loadFilesPreview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync files.");
    } finally {
      setFilesSyncing(false);
      setFilesLoading(false);
    }
  };

  const handleSyncCollections = async () => {
    setCollectionsSyncing(true);
    setCollectionsLoading(true);
    try {
      const response = await fetch("/api/knowledge/sync-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not sync collections.");
      setCollectionCount(Number(payload?.indexed ?? payload?.synced ?? 0));
      toast.success(`Synced ${Number(payload?.synced ?? 0)} collections.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync collections.");
    } finally {
      setCollectionsSyncing(false);
      setCollectionsLoading(false);
    }
  };

  const handleSyncVariants = async () => {
    setVariantsSyncing(true);
    setVariantsLoading(true);
    try {
      const response = await fetch("/api/knowledge/sync-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not sync variants.");
      setVariantCount(Number(payload?.indexed ?? payload?.synced ?? 0));
      toast.success(`Synced ${Number(payload?.synced ?? 0)} variants.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync variants.");
    } finally {
      setVariantsSyncing(false);
      setVariantsLoading(false);
    }
  };

  const handleSyncMetaobjects = async () => {
    setMetaobjectsSyncing(true);
    setMetaobjectsLoading(true);
    try {
      const response = await fetch("/api/knowledge/sync-metaobjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not sync metaobjects.");
      setMetaobjectCount(Number(payload?.indexed ?? payload?.synced ?? 0));
      toast.success(`Synced ${Number(payload?.synced ?? 0)} metaobjects.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync metaobjects.");
    } finally {
      setMetaobjectsSyncing(false);
      setMetaobjectsLoading(false);
    }
  };

  const handleSyncShopifyPolicies = async () => {
    setShopifyPoliciesSyncing(true);
    setShopifyPoliciesLoading(true);
    try {
      const response = await fetch("/api/knowledge/sync-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not sync policies.");
      setShopifyPolicyCount(Number(payload?.indexed ?? payload?.synced ?? 0));

      // Keep editable policy fields in sync with latest Shopify legal policies.
      const importResponse = await fetch("/api/shopify/import-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const importPayload = await importResponse.json().catch(() => ({}));
      if (importResponse.ok) {
        setPolicyRefund(String(importPayload?.refund || ""));
        setPolicyShipping(String(importPayload?.shipping || ""));
      }

      const syncCount = Number(payload?.synced ?? 0);
      if (!importResponse.ok) {
        toast.success(`Synced ${syncCount} policies. Could not refresh editable policy fields.`);
      } else {
        toast.success(`Synced ${syncCount} policies and refreshed policy fields.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sync policies.");
    } finally {
      setShopifyPoliciesSyncing(false);
      setShopifyPoliciesLoading(false);
    }
  };

  const handleDeleteSnippet = async (id) => {
    if (!shopId) return;

    setDeletingSnippetId(id);
    try {
      const response = await fetch("/api/knowledge/snippets", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not delete snippet.");
      }
      setSnippets((prev) => prev.filter((item) => item.id !== id));
      toast.success("Snippet deleted.");
    } catch (error) {
      console.warn("Delete snippet failed", error);
      toast.error("Could not delete snippet.");
    } finally {
      setDeletingSnippetId(null);
    }
  };

  const handleDeleteCsvImport = async (importId) => {
    const targetId = String(importId || "").trim();
    if (!targetId || !shopId) return;
    if (!window.confirm("Delete this CSV support knowledge import?")) return;

    setDeletingCsvImportId(targetId);
    try {
      const response = await fetch("/api/knowledge/import-csv", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          import_id: targetId,
          shop_id: shopId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not delete CSV import.");
      }
      toast.success(`Deleted ${Number(payload?.deleted || 0)} knowledge rows.`);
      await loadCsvImportBatches(shopId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete CSV import.");
    } finally {
      setDeletingCsvImportId("");
    }
  };

  const handlePreviewCsvImport = async (item) => {
    const targetImportId = String(item?.id || "").trim();
    if (!targetImportId || !shopId) return;

    setCsvPreviewTitle(String(item?.title || "CSV import"));
    setCsvPreviewRows([]);
    setCsvPreviewOpen(true);
    setCsvPreviewLoading(true);
    try {
      const response = await fetch(
        `/api/knowledge/import-csv?shop_id=${encodeURIComponent(String(shopId))}&import_id=${encodeURIComponent(
          targetImportId,
        )}&limit=120`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load CSV import preview.");
      }
      setCsvPreviewRows(Array.isArray(payload?.rows) ? payload.rows : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load CSV import preview.");
      setCsvPreviewRows([]);
    } finally {
      setCsvPreviewLoading(false);
    }
  };

  const hydrateSavedReplyEditor = (value) => {
    requestAnimationFrame(() => {
      const editor = savedReplyEditorRef.current;
      if (!editor) return;
      editor.innerHTML = toSavedReplyEditorHtml(value);
    });
  };

  const resetSavedReplyForm = () => {
    setEditingSavedReplyId(null);
    setSavedReplyTitle("");
    setSavedReplyContent("");
    setSavedReplyCategory("");
  };

  const syncSavedReplyEditorToState = () => {
    const editor = savedReplyEditorRef.current;
    if (!editor) return;
    const sanitized = sanitizeSavedReplyHtmlClient(editor.innerHTML);
    if (editor.innerHTML !== sanitized) {
      editor.innerHTML = sanitized;
    }
    setSavedReplyContent(sanitized);
  };

  const handleSavedReplyEditorInput = () => {
    syncSavedReplyEditorToState();
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

  const buildSavedReplyDraftKey = useCallback(
    (replyId) => {
      const scopeShop = String(shopId || "no-shop");
      const scopeUser = String(user?.id || "anon");
      const scopeReply = String(replyId || "new");
      return `knowledge:saved-reply-draft:${scopeShop}:${scopeUser}:${scopeReply}`;
    },
    [shopId, user?.id],
  );

  const readSavedReplyDraft = useCallback(
    (replyId) => {
      if (typeof window === "undefined") return null;
      try {
        const raw = window.localStorage.getItem(buildSavedReplyDraftKey(replyId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        return {
          title: String(parsed?.title || ""),
          category: String(parsed?.category || ""),
          content: String(parsed?.content || ""),
        };
      } catch (_error) {
        return null;
      }
    },
    [buildSavedReplyDraftKey],
  );

  const clearSavedReplyDraft = useCallback(
    (replyId) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(buildSavedReplyDraftKey(replyId));
      } catch (_error) {
        // no-op
      }
    },
    [buildSavedReplyDraftKey],
  );

  const openCreateSavedReplyModal = () => {
    const draft = readSavedReplyDraft(null);
    resetSavedReplyForm();
    if (draft) {
      setSavedReplyTitle(draft.title);
      setSavedReplyCategory(draft.category);
      setSavedReplyContent(draft.content);
    }
    setSavedReplyModalOpen(true);
    hydrateSavedReplyEditor(draft?.content || "");
  };

  const openEditSavedReplyModal = (reply) => {
    const nextReplyId = String(reply?.id || "").trim() || null;
    const draft = readSavedReplyDraft(nextReplyId);
    setEditingSavedReplyId(nextReplyId);
    setSavedReplyTitle(draft?.title || String(reply?.title || ""));
    setSavedReplyContent(draft?.content || String(reply?.content || ""));
    setSavedReplyCategory(draft?.category || String(reply?.category || ""));
    setSavedReplyModalOpen(true);
    hydrateSavedReplyEditor(draft?.content || String(reply?.content || ""));
  };

  useEffect(() => {
    if (!savedReplyModalOpen) return undefined;
    const hasContent = Boolean(stripHtmlToPlainText(savedReplyContent));
    const hasAny = Boolean(savedReplyTitle.trim() || savedReplyCategory.trim() || hasContent);
    const draftKey = buildSavedReplyDraftKey(editingSavedReplyId);

    const timer = window.setTimeout(() => {
      if (typeof window === "undefined") return;
      try {
        if (!hasAny) {
          window.localStorage.removeItem(draftKey);
          return;
        }
        window.localStorage.setItem(
          draftKey,
          JSON.stringify({
            title: savedReplyTitle,
            category: savedReplyCategory,
            content: savedReplyContent,
            updated_at: new Date().toISOString(),
          }),
        );
      } catch (_error) {
        // no-op
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    buildSavedReplyDraftKey,
    editingSavedReplyId,
    savedReplyCategory,
    savedReplyContent,
    savedReplyModalOpen,
    savedReplyTitle,
  ]);

  const handleSaveSavedReply = async () => {
    const draftReplyId = editingSavedReplyId;
    const title = String(savedReplyTitle || "").trim();
    const content = String(savedReplyContent || "").trim();
    const contentPlain = stripHtmlToPlainText(content);
    const category = String(savedReplyCategory || "").trim();
    if (!title || !contentPlain) {
      toast.error("Title and content are required.");
      return;
    }

    setSavingSavedReply(true);
    try {
      const method = editingSavedReplyId ? "PUT" : "POST";
      const response = await fetch("/api/settings/saved-replies", {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          id: editingSavedReplyId || undefined,
          title,
          content,
          category: category || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not save saved reply.");
      }
      toast.success(editingSavedReplyId ? "Saved reply updated." : "Saved reply created.");
      clearSavedReplyDraft(draftReplyId);
      setSavedReplyModalOpen(false);
      resetSavedReplyForm();
      await loadSavedReplies();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save saved reply.");
    } finally {
      setSavingSavedReply(false);
    }
  };

  const handleDeleteSavedReply = async (id) => {
    const nextId = String(id || "").trim();
    if (!nextId) return;
    if (!window.confirm("Delete this saved reply?")) return;

    setDeletingSavedReplyId(nextId);
    try {
      const response = await fetch("/api/settings/saved-replies", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ id: nextId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not delete saved reply.");
      }
      toast.success("Saved reply deleted.");
      await loadSavedReplies();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete saved reply.");
    } finally {
      setDeletingSavedReplyId(null);
    }
  };

  const handleToggleSavedReply = async (reply) => {
    const id = String(reply?.id || "").trim();
    if (!id) return;
    try {
      const response = await fetch("/api/settings/saved-replies", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          id,
          is_active: !Boolean(reply?.is_active),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not update saved reply.");
      }
      await loadSavedReplies();
      toast.success(Boolean(reply?.is_active) ? "Saved reply deactivated." : "Saved reply activated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update saved reply.");
    }
  };

  return (
    <>
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-foreground">Brain Center</h1>
          <p className="text-sm text-muted-foreground">
            Combine rules, facts, and historical context so Sona responds with accurate answers and the right tone.
          </p>
        </div>

        <div className="max-w-sm">
          <Label htmlFor="knowledge-shop-selector" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Active Shop
          </Label>
          <Select value={shopId || ""} onValueChange={(value) => setShopId(value || null)}>
            <SelectTrigger id="knowledge-shop-selector" className="mt-2 h-11">
              <SelectValue placeholder={shops.length > 1 ? "Select shop" : "No shop connected"} />
            </SelectTrigger>
            <SelectContent>
              {shops.map((shop) => (
                <SelectItem key={shop.id} value={shop.id}>
                  {String(shop.shop_domain || "Unnamed shop")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!shopId && shops.length > 1 ? (
            <p className="mt-2 text-xs text-slate-500">Choose the exact shop to write and sync knowledge for.</p>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card className="h-full rounded-xl border border-gray-300/70 bg-white shadow-sm">
            <CardHeader className="flex flex-col gap-3 px-6 pb-3 pt-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-lg">Knowledge Snippets</CardTitle>
                <CardDescription>Primary source for product facts, manuals, and troubleshooting guides.</CardDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={openCreateSnippetModal}
                  disabled={!shopId || loading}
                  className="gap-1.5 bg-black text-white hover:bg-black/90"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Knowledge
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading snippets...</p>
              ) : knowledgeItems.length === 0 ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-center">
                  <FileText className="h-12 w-12 text-gray-300" />
                  <p className="text-sm font-medium text-gray-600">No custom knowledge yet.</p>
                  <p className="text-xs text-gray-400">Add product manuals or guides to train the AI.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-lg border border-gray-100">
                    <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Snippets & Uploaded Files
                    </div>
                    <div className="divide-y divide-gray-50">
                      {knowledgeItems.map((item) => (
                        <div key={item.key} className="group flex items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            {item.kind === "csv_import" ? (
                              <button
                                type="button"
                                className="truncate text-left text-sm font-medium text-foreground underline-offset-2 hover:underline"
                                onClick={() => handlePreviewCsvImport(item)}
                              >
                                {item.title}
                              </button>
                            ) : (
                              <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {item.kind === "csv_import"
                                ? `${Number(item.row_count || 0)} rows · ${formatDate(item.created_at)}`
                                : formatDate(item.created_at)}
                            </p>
                          </div>
                          {item.kind === "snippet" && item.source_provider === "manual_text" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                              onClick={() => {
                                const snippet = snippets.find((entry) => String(entry?.id || "") === item.id);
                                if (snippet) openEditSnippetModal(snippet);
                              }}
                            >
                              Edit
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                            onClick={() => {
                              if (item.kind === "csv_import") {
                                handleDeleteCsvImport(item.id);
                                return;
                              }
                              handleDeleteSnippet(item.id);
                            }}
                            disabled={
                              item.kind === "csv_import"
                                ? deletingCsvImportId === item.id
                                : deletingSnippetId === item.id
                            }
                          >
                            <Trash2 className="h-4 w-4 text-gray-500" />
                            <span className="sr-only">
                              {item.kind === "csv_import" ? "Delete CSV import" : "Delete snippet"}
                            </span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="h-full rounded-xl border border-gray-300/70 bg-white shadow-sm">
            <CardHeader className="flex flex-col gap-3 px-6 pb-3 pt-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-lg">Saved Replies</CardTitle>
                <CardDescription>Approved replies your team can insert into drafts with one click.</CardDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={openCreateSavedReplyModal}
                  disabled={loading}
                  className="gap-1.5 bg-black text-white hover:bg-black/90"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Saved Reply
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {loading || savedRepliesLoading ? (
                <p className="text-sm text-muted-foreground">Loading saved replies...</p>
              ) : savedReplies.length === 0 ? (
                <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 text-center">
                  <MessageSquareText className="h-12 w-12 text-gray-300" />
                  <p className="text-sm font-medium text-gray-600">No saved replies yet.</p>
                  <p className="text-xs text-gray-400">Create your first saved reply.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50 rounded-lg border border-gray-100">
                  {savedReplies.map((reply) => (
                    <div key={reply.id} className="group flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground">{reply.title || "Untitled reply"}</p>
                          {reply?.category ? (
                            <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500">
                              {reply.category}
                            </span>
                          ) : null}
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${
                              reply?.is_active
                                ? "border-emerald-200 text-emerald-700"
                                : "border-gray-200 text-gray-500"
                            }`}
                          >
                            {reply?.is_active ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {stripHtmlToPlainText(reply?.content || "") || "(empty content)"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditSavedReplyModal(reply)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleSavedReply(reply)}
                        >
                          {reply?.is_active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDeleteSavedReply(reply.id)}
                          disabled={deletingSavedReplyId === reply.id}
                        >
                          <Trash2 className="h-4 w-4 text-gray-500" />
                          <span className="sr-only">Delete saved reply</span>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid items-stretch gap-4 lg:grid-cols-1">
            <Card className="h-full rounded-xl border border-gray-200/60 bg-white shadow-sm">
              <CardHeader className="flex flex-col gap-3 px-6 pb-3 pt-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    Shopify Data
                  </CardTitle>
                  <CardDescription>Everything auto-fetched from your connected Shopify store.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <div className="divide-y divide-gray-50 rounded-lg border border-gray-100 bg-white">
                  <button
                    type="button"
                    onClick={() => {
                      setActivePolicyField("refund");
                      setPolicyModalOpen(true);
                    }}
                    disabled={!shopId || loading}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Undo2 className="h-4 w-4 text-gray-400" />
                      <span>Return Policy</span>
                    </div>
                    {policyStatus.returnsConfigured ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Circle className="h-4 w-4 text-gray-300" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActivePolicyField("shipping");
                      setPolicyModalOpen(true);
                    }}
                    disabled={!shopId || loading}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Truck className="h-4 w-4 text-gray-400" />
                      <span>Shipping Policy</span>
                    </div>
                    {policyStatus.shippingConfigured ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Circle className="h-4 w-4 text-gray-300" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleSyncShopifyPolicies}
                    disabled={shopifyPoliciesLoading || loading || !shopId}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Shield className="h-4 w-4 text-gray-400" />
                      <span>Shopify Policies</span>
                    </div>
                    {renderStatusIcon(shopifyPolicyCount > 0, shopifyPoliciesLoading || shopifyPoliciesSyncing)}
                  </button>
                  <button
                    type="button"
                    onClick={loadFilesPreview}
                    disabled={filesLoading || loading || !shopId}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <FileText className="h-4 w-4 text-gray-400" />
                      <span>Guide Files</span>
                    </div>
                    {renderStatusIcon(fileCount > 0, filesLoading || filesSyncing)}
                  </button>
                  <button
                    type="button"
                    onClick={loadProductsPreview}
                    disabled={productsLoading || loading || !shopId}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Database className="h-4 w-4 text-gray-400" />
                      <span>Product Catalog</span>
                    </div>
                    {renderStatusIcon(productCount > 0, productsLoading)}
                  </button>
                  <button
                    type="button"
                    onClick={handleSyncVariants}
                    disabled={variantsLoading || loading || !shopId}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Package className="h-4 w-4 text-gray-400" />
                      <span>Variants</span>
                    </div>
                    {renderStatusIcon(variantCount > 0, variantsLoading || variantsSyncing)}
                  </button>
                  <button
                    type="button"
                    onClick={loadMetafieldsPreview}
                    disabled={metafieldsLoading || loading || !shopId}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Database className="h-4 w-4 text-gray-400" />
                      <span>Product Metafields</span>
                    </div>
                    {renderStatusIcon(metafieldCount > 0, metafieldsLoading)}
                  </button>
                  <button
                    type="button"
                    onClick={handleSyncCollections}
                    disabled={collectionsLoading || loading || !shopId}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Database className="h-4 w-4 text-gray-400" />
                      <span>Collections</span>
                    </div>
                    {renderStatusIcon(collectionCount > 0, collectionsLoading || collectionsSyncing)}
                  </button>
                  <button
                    type="button"
                    onClick={loadPagesPreview}
                    disabled={pagesLoading || loading || !shopId}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <FileText className="h-4 w-4 text-gray-400" />
                      <span>Store Pages</span>
                    </div>
                    {renderStatusIcon(pageCount > 0, pagesLoading)}
                  </button>
                  <button
                    type="button"
                    onClick={loadBlogsPreview}
                    disabled={blogsLoading || loading || !shopId}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <FileText className="h-4 w-4 text-gray-400" />
                      <span>Blog Articles</span>
                    </div>
                    {renderStatusIcon(blogCount > 0, blogsLoading || blogsSyncing)}
                  </button>
                  <button
                    type="button"
                    onClick={handleSyncMetaobjects}
                    disabled={metaobjectsLoading || loading || !shopId}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <FileText className="h-4 w-4 text-gray-400" />
                      <span>Metaobjects</span>
                    </div>
                    {renderStatusIcon(metaobjectCount > 0, metaobjectsLoading || metaobjectsSyncing)}
                  </button>
                </div>
              </CardContent>
            </Card>

            {hasHistoryConnection ? (
              <Card className="h-full rounded-xl border border-gray-200/60 bg-white shadow-sm">
                <CardHeader className="flex flex-col gap-3 px-6 pb-3 pt-6 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="text-lg">History</CardTitle>
                    <CardDescription>One-time import from integrations.</CardDescription>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                    asChild
                  >
                    <Link href="/integrations">Manage</Link>
                  </Button>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                  <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Cable className="h-4 w-4 text-gray-400" />
                      <span>Source: {String(historyProvider).charAt(0).toUpperCase() + String(historyProvider).slice(1)}</span>
                    </div>
                    <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                      Connected
                    </span>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog open={policyModalOpen} onOpenChange={setPolicyModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {activePolicyField === "shipping" ? "Edit Shipping Policy" : "Edit Return Policy"}
            </DialogTitle>
            <DialogDescription>Update this policy for AI replies.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {activePolicyField === "shipping" ? (
              <div className="space-y-2">
                <Label htmlFor="policy-shipping">Shipping policy</Label>
                <Textarea
                  id="policy-shipping"
                  value={policyShipping}
                  onChange={(event) => setPolicyShipping(event.target.value)}
                  rows={8}
                  placeholder="Paste your shipping policy..."
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="policy-refund">Returns policy</Label>
                <Textarea
                  id="policy-refund"
                  value={policyRefund}
                  onChange={(event) => setPolicyRefund(event.target.value)}
                  rows={8}
                  placeholder="Paste your return policy..."
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPolicyModalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSavePolicies} disabled={savingPolicies || !shopId}>
              {savingPolicies ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={snippetModalOpen}
        onOpenChange={(open) => {
          setSnippetModalOpen(open);
          if (!open) resetSnippetForm();
        }}
      >
        <DialogContent
          className="max-w-5xl"
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editingSnippetId ? "Edit Knowledge Snippet" : "Add Knowledge"}</DialogTitle>
            <DialogDescription>
              {editingSnippetId
                ? "Update your manual snippet content."
                : "Add text or upload a file to train the AI."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm ${snippetMode === "text" ? "bg-white font-medium text-gray-900 shadow-sm" : "text-gray-600"}`}
                onClick={() => setSnippetMode("text")}
              >
                Text
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm ${snippetMode === "pdf" ? "bg-white font-medium text-gray-900 shadow-sm" : "text-gray-600"}`}
                onClick={() => setSnippetMode("pdf")}
                disabled={Boolean(editingSnippetId)}
              >
                File
              </button>
            </div>

            {snippetMode === "pdf" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="pdf-title">Title (optional)</Label>
                  <Input
                    id="pdf-title"
                    value={pdfTitle}
                    onChange={(event) => setPdfTitle(event.target.value)}
                    placeholder="Product Manual"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pdf-file">File</Label>
                  <input
                    ref={pdfFileInputRef}
                    id="pdf-file"
                    type="file"
                    accept="application/pdf,image/*,.csv,text/csv"
                    className="hidden"
                    onChange={(event) => setPdfFile(event.target.files?.[0] || null)}
                  />
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="border-gray-300 text-gray-700 hover:bg-gray-50"
                      onClick={() => pdfFileInputRef.current?.click()}
                    >
                      Choose file
                    </Button>
                    <span className="text-sm text-gray-600">
                      {pdfFile?.name || "No file selected"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">PDF and image files are supported (max 15MB).</p>
                  <p className="text-xs text-gray-500">CSV is also supported for structured support knowledge.</p>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="snippet-title">Title</Label>
                  <Input
                    id="snippet-title"
                    value={snippetTitle}
                    onChange={(event) => setSnippetTitle(event.target.value)}
                    placeholder="Reset Guide"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="snippet-content">Content</Label>
                  <div className="overflow-hidden rounded-md border border-gray-200">
                    <div className="flex items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => applySnippetFormatting("bold")}
                        title="Bold"
                      >
                        <BoldIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => applySnippetFormatting("italic")}
                        title="Italic"
                      >
                        <ItalicIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => applySnippetFormatting("underline")}
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
                        onClick={() => applySnippetFormatting("insertUnorderedList")}
                        title="Bulleted list"
                      >
                        <ListIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => applySnippetFormatting("insertOrderedList")}
                        title="Numbered list"
                      >
                        <ListOrderedIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="relative">
                      {!stripHtmlToPlainText(snippetContent) ? (
                        <p className="pointer-events-none absolute left-3 top-3 text-sm text-gray-400">
                          Explain the issue and the exact troubleshooting steps...
                        </p>
                      ) : null}
                      <div
                        id="snippet-content"
                        ref={snippetEditorRef}
                        contentEditable
                        suppressContentEditableWarning
                        onInput={handleSnippetEditorInput}
                        onPaste={handleSnippetEditorPaste}
                        className="min-h-[320px] max-h-[520px] overflow-y-auto px-3 py-2 text-sm leading-6 outline-none"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSnippetModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveSnippetModal}
              disabled={(snippetMode === "text" ? savingSnippet : uploadingPdf) || !shopId}
            >
              {snippetMode === "text"
                ? savingSnippet
                  ? editingSnippetId
                    ? "Saving..."
                    : "Adding..."
                  : editingSnippetId
                    ? "Save changes"
                    : "Add snippet"
                : uploadingPdf
                  ? "Uploading..."
                  : "Upload file"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={savedReplyModalOpen}
        onOpenChange={(open) => {
          setSavedReplyModalOpen(open);
          if (!open) resetSavedReplyForm();
        }}
      >
        <DialogContent
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editingSavedReplyId ? "Edit Saved Reply" : "Add Saved Reply"}</DialogTitle>
            <DialogDescription>Create fixed, approved wording for your support team.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="saved-reply-title">Title</Label>
              <Input
                id="saved-reply-title"
                value={savedReplyTitle}
                onChange={(event) => setSavedReplyTitle(event.target.value)}
                placeholder="Bluetooth setup instructions"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="saved-reply-category">Category (optional)</Label>
              <Input
                id="saved-reply-category"
                value={savedReplyCategory}
                onChange={(event) => setSavedReplyCategory(event.target.value)}
                placeholder="Troubleshooting"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="saved-reply-content">Content</Label>
              <div className="overflow-hidden rounded-md border border-gray-200">
                <div className="flex items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
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
                  {!stripHtmlToPlainText(savedReplyContent) ? (
                    <p className="pointer-events-none absolute left-3 top-3 text-sm text-gray-400">
                      Write the approved reply...
                    </p>
                  ) : null}
                  <div
                    id="saved-reply-content"
                    ref={savedReplyEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={handleSavedReplyEditorInput}
                    onPaste={handleSavedReplyEditorPaste}
                    className="min-h-[240px] max-h-[420px] overflow-y-auto px-3 py-2 text-sm leading-6 outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSavedReplyModalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveSavedReply} disabled={savingSavedReply}>
              {savingSavedReply
                ? "Saving..."
                : editingSavedReplyId
                  ? "Save changes"
                  : "Create saved reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CsvSupportKnowledgeImportModal
        open={csvImportModalOpen}
        onOpenChange={(open) => {
          setCsvImportModalOpen(open);
          if (!open) {
            setCsvImportSeedFile(null);
          }
        }}
        shopId={shopId}
        initialFile={csvImportSeedFile}
        onImported={async () => {
          await loadCsvImportBatches(shopId);
        }}
      />

      <Dialog open={csvPreviewOpen} onOpenChange={setCsvPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{csvPreviewTitle}</DialogTitle>
            <DialogDescription>Preview of imported support knowledge rows.</DialogDescription>
          </DialogHeader>
          {csvPreviewLoading ? (
            <p className="text-sm text-muted-foreground">Loading imported rows...</p>
          ) : csvPreviewRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rows found in this import.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
              <div className="grid grid-cols-12 gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <div className="col-span-1">Row</div>
                <div className="col-span-4">Input</div>
                <div className="col-span-5">Answer</div>
                <div className="col-span-2">Topic</div>
              </div>
              <div className="max-h-[420px] divide-y divide-gray-100 overflow-y-auto">
                {csvPreviewRows.map((row, index) => (
                  <div key={`csv-preview-${index}`} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-gray-700">
                    <div className="col-span-1">{Number(row?.row_index || 0) || "-"}</div>
                    <div className="col-span-4 whitespace-pre-wrap break-words">
                      {String(row?.input_text || "-")}
                    </div>
                    <div className="col-span-5 whitespace-pre-wrap break-words">
                      {String(row?.answer_text || "-")}
                    </div>
                    <div className="col-span-2 whitespace-pre-wrap break-words">
                      {String(row?.topic || "-")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={productsModalOpen} onOpenChange={setProductsModalOpen}>
        <DialogContent className="max-w-4xl overflow-hidden p-0">
          <div className="flex max-h-[600px] flex-col">
            <DialogHeader className="flex flex-row items-start justify-between gap-3 border-b border-gray-100 px-6 pb-4 pt-6 pr-14">
              <div>
                <DialogTitle>Product Catalog</DialogTitle>
                <DialogDescription>View and manage the products currently synced from Shopify.</DialogDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                onClick={handleSyncProducts}
                disabled={productsSyncing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${productsSyncing ? "animate-spin" : ""}`} />
                {productsSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {products.length === 0 ? (
                <div className="space-y-3 rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">No products found yet. Run product sync first.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                    onClick={handleSyncProducts}
                    disabled={productsSyncing}
                  >
                    {productsSyncing ? "Syncing..." : "Sync products now"}
                  </Button>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="grid grid-cols-12 gap-3 border-b border-gray-100 bg-gray-50/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <div className="col-span-6">Product</div>
                    <div className="col-span-3">Product ID</div>
                    <div className="col-span-1 text-right">Price</div>
                    <div className="col-span-2 text-right">Updated</div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {products.map((product, index) => (
                      <div
                        key={`${product?.external_id || "p"}-${index}`}
                        className="grid grid-cols-12 gap-3 px-4 py-3 text-sm transition-colors hover:bg-gray-50"
                      >
                        <div className="col-span-6 min-w-0">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100">
                              <Package className="h-3.5 w-3.5 text-gray-500" />
                            </div>
                            {product?.external_id && normalizedShopDomain ? (
                              <a
                                href={`https://${normalizedShopDomain}/admin/products/${product.external_id}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="group/link inline-flex min-w-0 items-center gap-1.5 text-gray-900 font-medium hover:text-blue-600 hover:underline transition-colors"
                              >
                                <span className="truncate">{product?.title || "Untitled product"}</span>
                                <ExternalLink className="h-3 w-3 shrink-0 text-gray-400 transition-colors group-hover/link:text-blue-600" />
                              </a>
                            ) : (
                              <p className="truncate font-medium text-gray-900">{product?.title || "Untitled product"}</p>
                            )}
                          </div>
                        </div>
                        <div className="col-span-3 min-w-0">
                          <p className="truncate font-mono text-xs text-gray-400">{product?.external_id || "-"}</p>
                        </div>
                        <div className="col-span-1 text-right font-semibold text-gray-900">{formatPrice(product?.price)}</div>
                        <div className="col-span-2 text-right text-sm text-gray-500">{formatDate(product?.updated_at) || "-"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 p-3 text-xs text-gray-500">
              <span>Total products: {products.length}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Auto-sync enabled
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pagesModalOpen} onOpenChange={setPagesModalOpen}>
        <DialogContent className="max-w-5xl overflow-hidden p-0">
          <div className="flex max-h-[600px] flex-col">
            <DialogHeader className="flex flex-row items-start justify-between gap-3 border-b border-gray-100 px-6 pb-4 pt-6 pr-14">
              <div>
                <DialogTitle>Store Pages</DialogTitle>
                <DialogDescription>View pages currently synced from Shopify.</DialogDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                onClick={handleSyncPages}
                disabled={pagesSyncing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${pagesSyncing ? "animate-spin" : ""}`} />
                {pagesSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {pages.length === 0 ? (
                <div className="space-y-3 rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">No pages found yet. Run page sync first.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                    onClick={handleSyncPages}
                    disabled={pagesSyncing}
                  >
                    {pagesSyncing ? "Syncing..." : "Sync pages now"}
                  </Button>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="grid grid-cols-12 gap-3 border-b border-gray-100 bg-gray-50/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <div className="col-span-6">Page</div>
                    <div className="col-span-3">Page ID</div>
                    <div className="col-span-3 text-right">Updated</div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {pages.map((page, index) => (
                      <div
                        key={`${page?.external_id || "page"}-${index}`}
                        className="grid grid-cols-12 gap-3 px-4 py-3 text-sm transition-colors hover:bg-gray-50"
                      >
                        <div className="col-span-6 min-w-0">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100">
                              <FileText className="h-3.5 w-3.5 text-gray-500" />
                            </div>
                            {page?.external_id && normalizedShopDomain ? (
                              <a
                                href={`https://${normalizedShopDomain}/admin/pages/${page.external_id}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="group/link inline-flex min-w-0 items-center gap-1.5 text-gray-900 font-medium hover:text-blue-600 hover:underline transition-colors"
                              >
                                <span className="truncate">{page?.title || "Untitled page"}</span>
                                <ExternalLink className="h-3 w-3 shrink-0 text-gray-400 transition-colors group-hover/link:text-blue-600" />
                              </a>
                            ) : (
                              <p className="truncate font-medium text-gray-900">{page?.title || "Untitled page"}</p>
                            )}
                          </div>
                        </div>
                        <div className="col-span-3 min-w-0">
                          <p className="truncate font-mono text-xs text-gray-400">{page?.external_id || "-"}</p>
                        </div>
                        <div className="col-span-3 text-right text-sm text-gray-500">{formatDate(page?.updated_at) || "-"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 p-3 text-xs text-gray-500">
              <span>Total pages: {pages.length}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Auto-sync enabled
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={metafieldsModalOpen} onOpenChange={setMetafieldsModalOpen}>
        <DialogContent className="max-w-5xl overflow-hidden p-0">
          <div className="flex max-h-[600px] flex-col">
            <DialogHeader className="flex flex-row items-start justify-between gap-3 border-b border-gray-100 px-6 pb-4 pt-6 pr-14">
              <div>
                <DialogTitle>Product Metafields</DialogTitle>
                <DialogDescription>Technical specs and compatibility fields synced from Shopify.</DialogDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                onClick={handleSyncMetafields}
                disabled={metafieldsSyncing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${metafieldsSyncing ? "animate-spin" : ""}`} />
                {metafieldsSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {metafields.length === 0 ? (
                <div className="space-y-3 rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">No metafields found yet. Run metafield sync first.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                    onClick={handleSyncMetafields}
                    disabled={metafieldsSyncing}
                  >
                    {metafieldsSyncing ? "Syncing..." : "Sync metafields now"}
                  </Button>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="grid grid-cols-12 gap-3 border-b border-gray-100 bg-gray-50/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <div className="col-span-3">Namespace</div>
                    <div className="col-span-3">Key</div>
                    <div className="col-span-3">Owner</div>
                    <div className="col-span-3 text-right">Updated</div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {metafields.map((field, index) => (
                      <div
                        key={`${field?.external_id || "metafield"}-${index}`}
                        className="grid grid-cols-12 gap-3 px-4 py-3 text-sm transition-colors hover:bg-gray-50"
                      >
                        <div className="col-span-3 min-w-0">
                          <p className="truncate font-mono text-xs text-gray-500">{field?.namespace || "-"}</p>
                        </div>
                        <div className="col-span-3 min-w-0">
                          <p className="truncate font-medium text-gray-900">{field?.key || "-"}</p>
                        </div>
                        <div className="col-span-3 min-w-0">
                          {field?.owner_admin_url ? (
                            <a
                              href={field.owner_admin_url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="group/link inline-flex min-w-0 items-center gap-1.5 text-gray-900 hover:text-blue-600 hover:underline transition-colors"
                            >
                              <span className="truncate">{field?.owner_title || field?.owner_id || "Product"}</span>
                              <ExternalLink className="h-3 w-3 shrink-0 text-gray-400 transition-colors group-hover/link:text-blue-600" />
                            </a>
                          ) : (
                            <p className="truncate text-gray-700">{field?.owner_title || field?.owner_id || "-"}</p>
                          )}
                        </div>
                        <div className="col-span-3 text-right text-sm text-gray-500">{formatDate(field?.updated_at) || "-"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 p-3 text-xs text-gray-500">
              <span>Total fields: {metafields.length}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Auto-sync enabled
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={blogsModalOpen} onOpenChange={setBlogsModalOpen}>
        <DialogContent className="max-w-5xl overflow-hidden p-0">
          <div className="flex max-h-[600px] flex-col">
            <DialogHeader className="flex flex-row items-start justify-between gap-3 border-b border-gray-100 px-6 pb-4 pt-6 pr-14">
              <div>
                <DialogTitle>Blog Articles</DialogTitle>
                <DialogDescription>Helpful guides and support posts synced from Shopify blogs.</DialogDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                onClick={handleSyncBlogs}
                disabled={blogsSyncing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${blogsSyncing ? "animate-spin" : ""}`} />
                {blogsSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {blogs.length === 0 ? (
                <div className="space-y-3 rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">No blog articles found yet. Run blog sync first.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                    onClick={handleSyncBlogs}
                    disabled={blogsSyncing}
                  >
                    {blogsSyncing ? "Syncing..." : "Sync blog articles now"}
                  </Button>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="grid grid-cols-12 gap-3 border-b border-gray-100 bg-gray-50/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <div className="col-span-5">Article</div>
                    <div className="col-span-3">Blog</div>
                    <div className="col-span-2">Article ID</div>
                    <div className="col-span-2 text-right">Updated</div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {blogs.map((article, index) => (
                      <div
                        key={`${article?.external_id || "blog"}-${index}`}
                        className="grid grid-cols-12 gap-3 px-4 py-3 text-sm transition-colors hover:bg-gray-50"
                      >
                        <div className="col-span-5 min-w-0">
                          {article?.external_id && normalizedShopDomain ? (
                            <a
                              href={`https://${normalizedShopDomain}/admin/articles/${article.external_id}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="group/link inline-flex min-w-0 items-center gap-1.5 text-gray-900 font-medium hover:text-blue-600 hover:underline transition-colors"
                            >
                              <span className="truncate">{article?.title || "Untitled article"}</span>
                              <ExternalLink className="h-3 w-3 shrink-0 text-gray-400 transition-colors group-hover/link:text-blue-600" />
                            </a>
                          ) : (
                            <p className="truncate font-medium text-gray-900">{article?.title || "Untitled article"}</p>
                          )}
                        </div>
                        <div className="col-span-3 min-w-0">
                          <p className="truncate text-gray-600">{article?.blog_title || "-"}</p>
                        </div>
                        <div className="col-span-2 min-w-0">
                          <p className="truncate font-mono text-xs text-gray-400">{article?.external_id || "-"}</p>
                        </div>
                        <div className="col-span-2 text-right text-sm text-gray-500">{formatDate(article?.updated_at) || "-"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 p-3 text-xs text-gray-500">
              <span>Total articles: {blogs.length}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Auto-sync enabled
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={filesModalOpen} onOpenChange={setFilesModalOpen}>
        <DialogContent className="max-w-5xl overflow-hidden p-0">
          <div className="flex max-h-[600px] flex-col">
            <DialogHeader className="flex flex-row items-start justify-between gap-3 border-b border-gray-100 px-6 pb-4 pt-6 pr-14">
              <div>
                <DialogTitle>Guide Files</DialogTitle>
                <DialogDescription>
                  Manuals and size guides synced from Shopify Files. Product images are excluded unless they match guide keywords.
                </DialogDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                onClick={handleSyncFiles}
                disabled={filesSyncing}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${filesSyncing ? "animate-spin" : ""}`} />
                {filesSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {shopFiles.length === 0 ? (
                <div className="space-y-3 rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500">No guide files found yet. Run file sync first.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                    onClick={handleSyncFiles}
                    disabled={filesSyncing}
                  >
                    {filesSyncing ? "Syncing..." : "Sync files now"}
                  </Button>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="grid grid-cols-12 gap-3 border-b border-gray-100 bg-gray-50/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <div className="col-span-5">File</div>
                    <div className="col-span-2">Type</div>
                    <div className="col-span-3">File ID</div>
                    <div className="col-span-2 text-right">Updated</div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {shopFiles.map((file, index) => (
                      <div
                        key={`${file?.external_id || "file"}-${index}`}
                        className="grid grid-cols-12 gap-3 px-4 py-3 text-sm transition-colors hover:bg-gray-50"
                      >
                        <div className="col-span-5 min-w-0">
                          {file?.url ? (
                            <a
                              href={file.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="group/link inline-flex min-w-0 items-center gap-1.5 text-gray-900 font-medium hover:text-blue-600 hover:underline transition-colors"
                            >
                              <span className="truncate">{file?.title || file?.file_name || "Untitled file"}</span>
                              <ExternalLink className="h-3 w-3 shrink-0 text-gray-400 transition-colors group-hover/link:text-blue-600" />
                            </a>
                          ) : (
                            <p className="truncate font-medium text-gray-900">{file?.title || file?.file_name || "Untitled file"}</p>
                          )}
                        </div>
                        <div className="col-span-2 min-w-0">
                          <p className="truncate text-xs text-gray-500">{file?.mime_type || file?.file_kind || "-"}</p>
                        </div>
                        <div className="col-span-3 min-w-0">
                          <p className="truncate font-mono text-xs text-gray-400">{file?.external_id || "-"}</p>
                        </div>
                        <div className="col-span-2 text-right text-sm text-gray-500">{formatDate(file?.updated_at) || "-"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 p-3 text-xs text-gray-500">
              <span>Total files: {shopFiles.length}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Guide-image OCR enabled
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
