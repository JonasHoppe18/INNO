"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { Cable, CheckCircle2, Circle, FileText, Plus, Shield, Trash2, Truck, Undo2 } from "lucide-react";
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

export function KnowledgePageClient() {
  const supabase = useClerkSupabase();
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState(null);
  const [policyRefund, setPolicyRefund] = useState("");
  const [policyShipping, setPolicyShipping] = useState("");

  const [snippets, setSnippets] = useState([]);
  const [savingPolicies, setSavingPolicies] = useState(false);
  const [savingSnippet, setSavingSnippet] = useState(false);
  const [deletingSnippetId, setDeletingSnippetId] = useState(null);

  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [snippetModalOpen, setSnippetModalOpen] = useState(false);
  const [snippetTitle, setSnippetTitle] = useState("");
  const [snippetContent, setSnippetContent] = useState("");
  const [historyProvider, setHistoryProvider] = useState(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [snippetMode, setSnippetMode] = useState("text");
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfTitle, setPdfTitle] = useState("");
  const pdfFileInputRef = useRef(null);

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
      .select("id, policy_refund, policy_shipping")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    setShopId(data?.id || null);
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
        .in("source_provider", ["manual_text", "pdf_upload"])
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
          (row?.source_provider === "pdf_upload" ? "Uploaded PDF" : "Untitled snippet");
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
      await loadSnippets(currentShopId);
      await loadHistoryConnection();
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

  const handleAddPdf = async () => {
    const file = pdfFile;
    if (!file) return;
    if (!shopId) {
      toast.error("No shop found.");
      return;
    }
    if (file.type !== "application/pdf") {
      toast.error("Only PDF files are supported.");
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
        throw new Error(payload?.error || "Could not upload PDF.");
      }

      toast.success("PDF uploaded and indexed.");
      setSnippetModalOpen(false);
      setPdfFile(null);
      setPdfTitle("");
      await loadSnippets(shopId);
    } catch (error) {
      console.warn("PDF upload failed", error);
      toast.error(error instanceof Error ? error.message : "Could not upload PDF.");
    } finally {
      setUploadingPdf(false);
    }
  };

  const handleSaveSnippetModal = async () => {
    if (snippetMode === "pdf") {
      await handleAddPdf();
      return;
    }
    await handleAddSnippet();
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

          <div className={`grid items-stretch gap-4 ${hasHistoryConnection ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}>
            <Card className="h-full rounded-xl border border-gray-200/60 bg-white shadow-sm">
              <CardHeader className="flex flex-row items-start justify-between px-6 pb-3 pt-6">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Shield className="h-4 w-4 text-slate-500" />
                    Policies
                  </CardTitle>
                  <CardDescription>Auto-synced from your store.</CardDescription>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-gray-300 text-gray-700 hover:bg-gray-50"
                  onClick={() => setPolicyModalOpen(true)}
                  disabled={!shopId || loading}
                >
                  Edit
                </Button>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <div className="divide-y divide-gray-50 rounded-lg border border-gray-100 bg-white">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Undo2 className="h-4 w-4 text-gray-400" />
                      <span>Return Policy</span>
                    </div>
                    {policyStatus.returnsConfigured ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Circle className="h-4 w-4 text-gray-300" />
                    )}
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Truck className="h-4 w-4 text-gray-400" />
                      <span>Shipping Policy</span>
                    </div>
                    {policyStatus.shippingConfigured ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Circle className="h-4 w-4 text-gray-300" />
                    )}
                  </div>
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
            <DialogTitle>Edit Policies</DialogTitle>
            <DialogDescription>Update the core policies Sona should follow in replies.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="policy-refund">Returns policy</Label>
              <Textarea
                id="policy-refund"
                value={policyRefund}
                onChange={(event) => setPolicyRefund(event.target.value)}
                rows={5}
                placeholder="Paste your return policy..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-shipping">Shipping policy</Label>
              <Textarea
                id="policy-shipping"
                value={policyShipping}
                onChange={(event) => setPolicyShipping(event.target.value)}
                rows={5}
                placeholder="Paste your shipping policy..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPolicyModalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSavePolicies} disabled={savingPolicies || !shopId}>
              {savingPolicies ? "Saving..." : "Save policies"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={snippetModalOpen} onOpenChange={setSnippetModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Knowledge</DialogTitle>
            <DialogDescription>Add text or upload a PDF to train the AI.</DialogDescription>
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
                PDF
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
                  <Label htmlFor="pdf-file">PDF file</Label>
                  <input
                    ref={pdfFileInputRef}
                    id="pdf-file"
                    type="file"
                    accept="application/pdf"
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
                  <p className="text-xs text-gray-500">Only PDF is supported (max 15MB).</p>
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
                  : "Upload PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
