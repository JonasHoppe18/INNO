"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bold,
  DownloadCloud,
  FileText,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Lock,
  RefreshCcw,
  Save,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductKnowledgeCard } from "@/components/knowledge/ProductKnowledgeCard";
import { useClerkSupabase } from "@/lib/useClerkSupabase";

const fieldConfig = [
  {
    key: "policy_refund",
    label: "Returns",
    description: "How customers return or exchange items—deadlines, conditions, fees.",
    icon: ShieldCheck,
  },
  {
    key: "policy_shipping",
    label: "Shipping",
    description: "Delivery times, shipping rates, express options, tracking links, exceptions.",
    icon: Truck,
  },
  {
    key: "policy_terms",
    label: "Terms",
    description: "Payment, cancellations, claims, warranties.",
    icon: FileText,
  },
  {
    key: "internal_tone",
    label: "Internal Rules",
    description: "Tone of voice, discounts, escalation rules—internal for the agent only.",
    icon: Lock,
  },
];

export function KnowledgePageClient() {
  const supabase = useClerkSupabase();
  const [values, setValues] = useState({
    policy_refund: "",
    policy_shipping: "",
    policy_terms: "",
    internal_tone: "",
  });
  const [shopId, setShopId] = useState(null);
  const [shopDomain, setShopDomain] = useState("");
  const [platform, setPlatform] = useState("");
  const [manualDomain, setManualDomain] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState("policy_refund");

  const updateField = useCallback((key, next) => {
    setValues((prev) => ({ ...prev, [key]: next }));
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("shops")
        .select("id, shop_domain, platform, policy_refund, policy_shipping, policy_terms, internal_tone")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (data) {
        setShopId(data.id);
        setShopDomain(data.shop_domain || "");
        setPlatform(data.platform || "");
        setValues({
          policy_refund: data.policy_refund || "",
          policy_shipping: data.policy_shipping || "",
          policy_terms: data.policy_terms || "",
          internal_tone: data.internal_tone || "",
        });
        setManualDomain("");
        setManualToken("");
      } else {
        setShopId(null);
        setShopDomain("");
        setPlatform("");
        setValues({
          policy_refund: "",
          policy_shipping: "",
          policy_terms: "",
          internal_tone: "",
        });
        // keep any manually entered values
      }
    } catch (error) {
      console.warn("Load policies failed:", error);
      toast.error("Could not load policies.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadData().catch(() => null);
  }, [loadData]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const response = await fetch("/api/shopify/import-policies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shop_domain: manualDomain || undefined,
          access_token: manualToken || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof payload?.error === "string" ? payload.error : "Could not import from Shopify.";
        throw new Error(message);
      }

      const policyCount = payload?.meta?.policyCount ?? null;
      const policyTypes = Array.isArray(payload?.meta?.policyTypes) ? payload.meta.policyTypes : [];

      setValues((prev) => ({
        ...prev,
        policy_refund: payload?.refund ?? prev.policy_refund,
        policy_shipping: payload?.shipping ?? prev.policy_shipping,
        policy_terms: payload?.terms ?? prev.policy_terms,
      }));
      if (policyCount === 0) {
        toast.info("No policies found in Shopify. Check that they are filled out and the token has read_legal_policies.");
      } else {
        toast.success(
          `Policies imported from Shopify (${policyCount} found${
            policyTypes.length ? `: ${policyTypes.join(", ")}` : ""
          }).`
        );
      }
      if (payload?.meta?.persisted) {
        await loadData();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed.";
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const handleSave = async () => {
    if (!supabase) {
      toast.error("Supabase client is not ready yet.");
      return;
    }
    if (!shopId) {
      toast.error("No Shopify store found. Connect your store first.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        policy_refund: values.policy_refund,
        policy_shipping: values.policy_shipping,
        policy_terms: values.policy_terms,
        internal_tone: values.internal_tone,
      };
      const { error } = await supabase.from("shops").update(payload).eq("id", shopId);
      if (error) throw error;
      toast.success("Policies saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const tabByKey = useMemo(
    () => fieldConfig.reduce((acc, item) => ({ ...acc, [item.key]: item }), {}),
    []
  );

  const active = tabByKey[activeTab] || fieldConfig[0];
  const platformLabel = useMemo(() => {
    if (!platform) return "Store";
    return platform.charAt(0).toUpperCase() + platform.slice(1);
  }, [platform]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-foreground">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">
            Sync your policies, edit them, and add internal rules. The agent uses them directly in replies.
          </p>
        </div>
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
          className="gap-2 self-start bg-black text-white shadow-sm hover:bg-black/90 lg:self-auto"
        >
          {saving ? (
            <>
              <RefreshCcw className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save Changes
            </>
          )}
        </Button>
      </div>

      <div className="space-y-5">
        <ProductKnowledgeCard />

        <Card className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <CardHeader className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-xl">Store Policies</CardTitle>
              <CardDescription>Manage return rules, shipping info, and internal notes.</CardDescription>
              {shopDomain ? (
                <p className="text-xs text-muted-foreground">
                  Connected to: <span className="font-mono text-foreground">{shopDomain}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No Shopify store found. Enter a domain and access token to fetch once, or connect via Integrations.
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleImport}
              disabled={importing || loading}
              className="gap-2"
            >
              {importing ? (
                <>
                  <RefreshCcw className="h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <DownloadCloud className="h-4 w-4" />
                  Update from Store
                </>
              )}
            </Button>

          </CardHeader>
          <CardContent className="space-y-5">
            {!shopDomain ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-semibold text-foreground">Fetch without saved connection</p>
                <p className="text-xs text-muted-foreground">
                  Use your Shopify domain and Admin API access token to fetch policies once. (Does not save the
                  credentials.)
                </p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shopify domain</p>
                    <input
                      type="text"
                      value={manualDomain}
                      onChange={(e) => setManualDomain(e.target.value)}
                      placeholder="myshop.myshopify.com"
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-blue-500/30"
                      disabled={loading || importing}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Admin API Access Token
                    </p>
                    <input
                      type="password"
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      placeholder="shpat_xxx"
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-blue-500/30"
                      disabled={loading || importing}
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Tip: Find the token under Shopify Admin &gt; Apps &gt; Develop apps &gt; Admin API access token.
                </p>
              </div>
            ) : null}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <TabsList className="bg-muted/60">
                {fieldConfig.map((field) => (
                  <TabsTrigger key={field.key} value={field.key} className="gap-2">
                    <field.icon className="h-4 w-4" />
                    {field.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {active?.icon ? <active.icon className="h-4 w-4 text-muted-foreground" /> : null}
                  <span>{active?.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{active?.description}</p>
              </div>

              {fieldConfig.map((field) => (
                <TabsContent key={field.key} value={field.key} className="mt-0">
                  <RichTextarea
                    value={values[field.key]}
                    onValueChange={(next) => updateField(field.key, next)}
                    placeholder={
                      field.key === "internal_tone"
                        ? "Document tone, extra rules, or temporary campaigns for the agent."
                        : "Write or paste your policy content..."
                    }
                    disabled={loading}
                    variant={field.key === "internal_tone" ? "internal" : "default"}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RichTextarea({ value, onValueChange, placeholder, disabled, variant = "default" }) {
  const ref = useRef(null);

  const applyWrap = (prefix, suffix) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const current = el.value ?? "";
    const selected = start !== end ? current.slice(start, end) : "text";
    const nextValue = current.slice(0, start) + prefix + selected + suffix + current.slice(end);
    onValueChange(nextValue);
    const cursorPos = start + prefix.length + selected.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursorPos, cursorPos);
    });
  };

  const applyHeading = (level) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const current = el.value ?? "";
    const lineStart = current.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = current.indexOf("\n", start);
    const segmentEnd = lineEnd === -1 ? current.length : lineEnd;
    const line = current.slice(lineStart, segmentEnd);
    const clean = line.replace(/^#{1,6}\s*/, "").trimStart();
    const prefix = `${"#".repeat(level)} `;
    const nextLine = `${prefix}${clean}`;
    const nextValue = current.slice(0, lineStart) + nextLine + current.slice(segmentEnd);
    onValueChange(nextValue);
    const cursorPos = lineStart + nextLine.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursorPos, cursorPos);
    });
  };

  const applyList = (mode = "bullet") => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const current = el.value ?? "";
    const lineStart = current.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = current.indexOf("\n", end);
    const segmentEnd = lineEnd === -1 ? current.length : lineEnd;
    const segment = current.slice(lineStart, segmentEnd);
    const lines = segment.split("\n").map((line, idx) => {
      if (!line.trim().length) return mode === "ordered" ? `${idx + 1}. ` : "- ";
      const cleaned = line.replace(/^(-|\d+\.)\s*/, "");
      return mode === "ordered" ? `${idx + 1}. ${cleaned}` : `- ${cleaned}`;
    });
    const nextSegment = lines.join("\n");
    const nextValue = current.slice(0, lineStart) + nextSegment + current.slice(segmentEnd);
    onValueChange(nextValue);
    const cursorPos = segmentEnd + 2;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursorPos, cursorPos);
    });
  };

  const baseClass =
    "min-h-[600px] lg:h-[65vh] w-full resize-y rounded-xl px-6 py-6 text-gray-800 shadow-inner focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2";
  const variantClass =
    variant === "internal"
      ? "border border-blue-200 bg-blue-50 text-base leading-7"
      : "border border-gray-200 bg-white text-sm leading-6";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-2">
        <ToolbarButton onClick={() => applyWrap("**", "**")} icon={Bold} label="Bold" />
        <ToolbarButton onClick={() => applyWrap("*", "*")} icon={Italic} label="Italic" />
        <ToolbarSeparator />
        <ToolbarButton onClick={() => applyHeading(1)} icon={Heading1} label="Heading 1" />
        <ToolbarButton onClick={() => applyHeading(2)} icon={Heading2} label="Heading 2" />
        <ToolbarSeparator />
        <ToolbarButton onClick={() => applyList("bullet")} icon={List} label="Bullet list" />
        <ToolbarButton onClick={() => applyList("ordered")} icon={ListOrdered} label="Numbered list" />
      </div>
      <Textarea
        ref={ref}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        rows={10}
        className={`${baseClass} ${variantClass}`}
        disabled={disabled}
      />
    </div>
  );
}

function ToolbarButton({ onClick, icon: Icon, label }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={label}
      className="h-9 w-9 rounded-md border border-transparent p-2 text-foreground hover:border-gray-200 hover:bg-gray-100"
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}

function ToolbarSeparator() {
  return <span className="h-6 w-px bg-gray-200" aria-hidden="true" />;
}
