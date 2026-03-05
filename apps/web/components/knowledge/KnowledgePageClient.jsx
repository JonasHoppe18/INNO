"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import {
  Cable,
  CheckCircle2,
  Circle,
  Database,
  ExternalLink,
  FileText,
  Package,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Truck,
  Undo2,
} from "lucide-react";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

export function KnowledgePageClient() {
  const supabase = useClerkSupabase();
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState(null);
  const [shopDomain, setShopDomain] = useState("");
  const [policyRefund, setPolicyRefund] = useState("");
  const [policyShipping, setPolicyShipping] = useState("");

  const [snippets, setSnippets] = useState([]);
  const [savingPolicies, setSavingPolicies] = useState(false);
  const [savingSnippet, setSavingSnippet] = useState(false);
  const [deletingSnippetId, setDeletingSnippetId] = useState(null);

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

  const loadShop = useCallback(async () => {
    const { data, error } = await supabase
      .from("shops")
      .select("id, shop_domain, policy_refund, policy_shipping")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    setShopId(data?.id || null);
    setShopDomain(typeof data?.shop_domain === "string" ? data.shop_domain : "");
    setPolicyRefund(data?.policy_refund || "");
    setPolicyShipping(data?.policy_shipping || "");

    return data?.id || null;
  }, [supabase]);

  const loadSnippets = useCallback(
    async (currentShopId) => {
      if (!currentShopId) {
        setSnippets([]);
        return;
      }

      const { data, error } = await supabase
        .from("agent_knowledge")
        .select("id, metadata, created_at, source_provider, source_type")
        .eq("shop_id", currentShopId)
        .in("source_provider", ["manual_text", "pdf_upload", "image_upload"])
        .order("created_at", { ascending: false });

      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      const deduped = new Map();
      for (const row of rows) {
        const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
        const snippetId = String(metadata?.snippet_id || row?.id || "").trim();
        if (!snippetId || deduped.has(snippetId)) continue;
        const title =
          String(metadata?.title || metadata?.file_name || "").trim() ||
          (row?.source_provider === "manual_text" ? "Untitled snippet" : "Uploaded File");
        deduped.set(snippetId, {
          id: snippetId,
          title,
          created_at: row?.created_at || null,
        });
      }
      setSnippets(Array.from(deduped.values()));
    },
    [supabase]
  );

  const loadData = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const currentShopId = await loadShop();
      await Promise.all([loadSnippets(currentShopId), loadHistoryConnection()]);
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
        fetch("/api/knowledge/sync-products", { method: "GET" }),
        fetch("/api/knowledge/sync-pages", { method: "GET" }),
        fetch("/api/knowledge/sync-metafields", { method: "GET" }),
        fetch("/api/knowledge/sync-blogs", { method: "GET" }),
        fetch("/api/knowledge/sync-files", { method: "GET" }),
        fetch("/api/knowledge/sync-collections", { method: "GET" }),
        fetch("/api/knowledge/sync-variants", { method: "GET" }),
        fetch("/api/knowledge/sync-metaobjects", { method: "GET" }),
        fetch("/api/knowledge/sync-policies", { method: "GET" }),
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
  }, [loadHistoryConnection, loadShop, loadSnippets, supabase]);

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

  const handleAddSnippet = async () => {
    if (!shopId) {
      toast.error("No shop found.");
      return;
    }

    const title = snippetTitle.trim();
    const content = snippetContent.trim();

    if (!title || !content) {
      toast.error("Title and content are required.");
      return;
    }

    setSavingSnippet(true);
    try {
      const response = await fetch("/api/knowledge/snippets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shop_id: shopId,
          title,
          content,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not add snippet.");
      }

      toast.success("Knowledge snippet added.");
      setSnippetModalOpen(false);
      setSnippetTitle("");
      setSnippetContent("");
      await loadSnippets(shopId);
    } catch (error) {
      console.warn("Add snippet failed", error);
      toast.error("Could not add snippet.");
    } finally {
      setSavingSnippet(false);
    }
  };

  const handleAddFile = async () => {
    const file = pdfFile;
    if (!file) return;
    if (!shopId) {
      toast.error("No shop found.");
      return;
    }
    if (file.type !== "application/pdf" && !file.type.startsWith("image/")) {
      toast.error("Only PDF and image files are supported.");
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
      setSnippetModalOpen(false);
      setPdfFile(null);
      setPdfTitle("");
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
      const response = await fetch("/api/knowledge/sync-products?include_products=1", { method: "GET" });
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
      const response = await fetch("/api/knowledge/sync-products", { method: "POST" });
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
      const response = await fetch("/api/knowledge/sync-pages?include_pages=1", { method: "GET" });
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
      const response = await fetch("/api/knowledge/sync-pages", { method: "POST" });
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
      const response = await fetch("/api/knowledge/sync-metafields?include_metafields=1", {
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
      const response = await fetch("/api/knowledge/sync-metafields", { method: "POST" });
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
      const response = await fetch("/api/knowledge/sync-blogs?include_blogs=1", { method: "GET" });
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
      const response = await fetch("/api/knowledge/sync-blogs", { method: "POST" });
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
      const response = await fetch("/api/knowledge/sync-files?include_files=1", { method: "GET" });
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
      const response = await fetch("/api/knowledge/sync-files?include_image_guides=1", { method: "POST" });
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
      const response = await fetch("/api/knowledge/sync-collections", { method: "POST" });
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
      const response = await fetch("/api/knowledge/sync-variants", { method: "POST" });
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
      const response = await fetch("/api/knowledge/sync-metaobjects", { method: "POST" });
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
      const response = await fetch("/api/knowledge/sync-policies", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not sync policies.");
      setShopifyPolicyCount(Number(payload?.indexed ?? payload?.synced ?? 0));

      // Keep editable policy fields in sync with latest Shopify legal policies.
      const importResponse = await fetch("/api/shopify/import-policies", { method: "POST" });
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

  return (
    <>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-foreground">Brain Center</h1>
          <p className="text-sm text-muted-foreground">
            Combine rules, facts, and historical context so Sona responds with accurate answers and the right tone.
          </p>
        </div>

        <div className="space-y-4">
          <Card className="h-full rounded-xl border border-gray-300/70 bg-white shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between px-6 pb-3 pt-6">
              <div className="space-y-1">
                <CardTitle className="text-lg">Knowledge Snippets</CardTitle>
                <CardDescription>Primary source for product facts, manuals, and troubleshooting guides.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setSnippetModalOpen(true)}
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
              ) : snippets.length === 0 ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-center">
                  <FileText className="h-12 w-12 text-gray-300" />
                  <p className="text-sm font-medium text-gray-600">No custom knowledge yet.</p>
                  <p className="text-xs text-gray-400">Add product manuals or guides to train the AI.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50 rounded-lg border border-gray-100">
                  {snippets.map((snippet) => (
                    <div key={snippet.id} className="group flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{snippet.title || "Untitled snippet"}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(snippet.created_at)}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => handleDeleteSnippet(snippet.id)}
                        disabled={deletingSnippetId === snippet.id}
                      >
                        <Trash2 className="h-4 w-4 text-gray-500" />
                        <span className="sr-only">Delete snippet</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid items-stretch gap-4 lg:grid-cols-1">
            <Card className="h-full rounded-xl border border-gray-200/60 bg-white shadow-sm">
              <CardHeader className="flex flex-row items-start justify-between px-6 pb-3 pt-6">
                <div className="space-y-1">
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
                <CardHeader className="flex flex-row items-start justify-between px-6 pb-3 pt-6">
                  <div className="space-y-1">
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

      <Dialog open={snippetModalOpen} onOpenChange={setSnippetModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Knowledge</DialogTitle>
            <DialogDescription>Add text or upload a file to train the AI.</DialogDescription>
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
                    accept="application/pdf,image/*"
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
                  <Textarea
                    id="snippet-content"
                    value={snippetContent}
                    onChange={(event) => setSnippetContent(event.target.value)}
                    rows={7}
                    placeholder="Explain the issue and the exact troubleshooting steps..."
                  />
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
                  ? "Adding..."
                  : "Add snippet"
                : uploadingPdf
                  ? "Uploading..."
                  : "Upload file"}
            </Button>
          </DialogFooter>
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
