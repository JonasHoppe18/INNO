"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useClerkSupabase } from "@/lib/useClerkSupabase";

const SIGNATURE_BUILDER_MARKER_PREFIX = "sona_signature_builder:";
const SIGNATURE_TEXT_FIELD_KEYS = ["fullName", "jobTitle", "phone", "email", "companyName"];
const SIGNATURE_TEXT_FIELD_LABELS = {
  fullName: "Full name",
  jobTitle: "Job title",
  phone: "Phone",
  email: "Email",
  companyName: "Company name",
};
const DEFAULT_SIGNATURE_BUILDER = {
  fullName: "",
  jobTitle: "",
  phone: "",
  email: "",
  logoUrl: "",
  companyName: "",
  accentColor: "",
  layout: "logo_left",
  textAlign: "left",
  textOrder: [...SIGNATURE_TEXT_FIELD_KEYS],
  fieldVisibility: {
    fullName: true,
    jobTitle: true,
    phone: true,
    email: true,
    companyName: true,
  },
  nameSize: "16",
  bodySize: "13",
  logoWidth: "170",
  columnGap: "14",
};

function getDisplayName(member) {
  const first = String(member?.first_name || "").trim();
  const last = String(member?.last_name || "").trim();
  const fullName = `${first} ${last}`.trim();
  if (fullName) return fullName;
  const email = String(member?.email || "").trim();
  if (email) return email.split("@")[0];
  return "Member";
}

function escapeSignatureHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeBtoa(value = "") {
  try {
    if (typeof window !== "undefined" && typeof window.btoa === "function") {
      return window.btoa(unescape(encodeURIComponent(String(value || ""))));
    }
  } catch {}
  return "";
}

function safeAtob(value = "") {
  try {
    if (typeof window !== "undefined" && typeof window.atob === "function") {
      return decodeURIComponent(escape(window.atob(String(value || ""))));
    }
  } catch {}
  return "";
}

function normalizePhoneHref(value = "") {
  return String(value || "").replace(/[^\d+]/g, "");
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function buildSignatureTemplateFromBuilder(builder = DEFAULT_SIGNATURE_BUILDER) {
  const payload = {
    fullName: String(builder?.fullName || "").trim(),
    jobTitle: String(builder?.jobTitle || "").trim(),
    phone: String(builder?.phone || "").trim(),
    email: String(builder?.email || "").trim(),
    logoUrl: String(builder?.logoUrl || "").trim(),
    companyName: String(builder?.companyName || "").trim(),
    accentColor: String(builder?.accentColor || "").trim(),
    layout: String(builder?.layout || "logo_left").trim() || "logo_left",
    textAlign: String(builder?.textAlign || "left").trim() || "left",
    textOrder: Array.isArray(builder?.textOrder) ? builder.textOrder : [...SIGNATURE_TEXT_FIELD_KEYS],
    fieldVisibility:
      builder?.fieldVisibility && typeof builder.fieldVisibility === "object"
        ? builder.fieldVisibility
        : { ...DEFAULT_SIGNATURE_BUILDER.fieldVisibility },
    nameSize: String(builder?.nameSize || DEFAULT_SIGNATURE_BUILDER.nameSize),
    bodySize: String(builder?.bodySize || DEFAULT_SIGNATURE_BUILDER.bodySize),
    logoWidth: String(builder?.logoWidth || DEFAULT_SIGNATURE_BUILDER.logoWidth),
    columnGap: String(builder?.columnGap || DEFAULT_SIGNATURE_BUILDER.columnGap),
  };
  const nameSize = clampNumber(payload.nameSize, 12, 28, 16);
  const bodySize = clampNumber(payload.bodySize, 11, 22, 13);
  const logoWidth = clampNumber(payload.logoWidth, 90, 320, 170);
  const columnGap = clampNumber(payload.columnGap, 4, 40, 14);
  const encoded = safeBtoa(JSON.stringify(payload));
  const marker = encoded ? `<!-- ${SIGNATURE_BUILDER_MARKER_PREFIX}${encoded} -->` : "";
  const accentStyle = payload.accentColor ? `color:${escapeSignatureHtml(payload.accentColor)};` : "";
  const normalizedTextAlign = ["left", "center", "right"].includes(payload.textAlign)
    ? payload.textAlign
    : "left";
  const textAlignStyle = `text-align:${normalizedTextAlign};`;
  const normalizedLayout = ["logo_left", "logo_right", "logo_top", "logo_bottom"].includes(payload.layout)
    ? payload.layout
    : "logo_left";

  const normalizedVisibility = {
    fullName: payload.fieldVisibility?.fullName !== false,
    jobTitle: payload.fieldVisibility?.jobTitle !== false,
    phone: payload.fieldVisibility?.phone !== false,
    email: payload.fieldVisibility?.email !== false,
    companyName: payload.fieldVisibility?.companyName !== false,
  };
  const normalizedOrder = [
    ...new Set(
      [...payload.textOrder, ...SIGNATURE_TEXT_FIELD_KEYS].filter((key) =>
        SIGNATURE_TEXT_FIELD_KEYS.includes(key)
      )
    ),
  ];

  const phoneHref = normalizePhoneHref(payload.phone);
  const renderFieldHtml = (fieldKey) => {
    if (!normalizedVisibility[fieldKey]) return "";
    if (fieldKey === "fullName" && payload.fullName) {
      return `<div style="margin-top:2px;font-size:${nameSize}px;font-weight:700;${accentStyle}${textAlignStyle}line-height:1.2;">${escapeSignatureHtml(payload.fullName)}</div>`;
    }
    if (fieldKey === "jobTitle" && payload.jobTitle) {
      return `<div style="margin-top:2px;font-size:${bodySize}px;color:#111827;${textAlignStyle}line-height:1.3;">${escapeSignatureHtml(payload.jobTitle)}</div>`;
    }
    if (fieldKey === "phone" && payload.phone) {
      return `<div style="margin-top:2px;font-size:${bodySize}px;color:#111827;${textAlignStyle}line-height:1.3;">${
        phoneHref
          ? `<a href="tel:${escapeSignatureHtml(phoneHref)}" style="color:#111827;text-decoration:none;">${escapeSignatureHtml(payload.phone)}</a>`
          : escapeSignatureHtml(payload.phone)
      }</div>`;
    }
    if (fieldKey === "email" && payload.email) {
      return `<div style="margin-top:2px;font-size:${bodySize}px;${textAlignStyle}line-height:1.3;"><a href="mailto:${escapeSignatureHtml(payload.email)}" style="color:#2563EB;text-decoration:underline;">${escapeSignatureHtml(payload.email)}</a></div>`;
    }
    if (fieldKey === "companyName" && payload.companyName) {
      return `<div style="margin-top:4px;font-size:${bodySize}px;letter-spacing:0.02em;color:#111827;font-weight:600;${textAlignStyle}line-height:1.25;">${escapeSignatureHtml(payload.companyName)}</div>`;
    }
    return "";
  };

  const logoHtml = payload.logoUrl
    ? `<img src="${escapeSignatureHtml(payload.logoUrl)}" alt="${escapeSignatureHtml(payload.companyName || "Company logo")}" style="display:block;max-width:${logoWidth}px;max-height:72px;height:auto;width:auto;">`
    : "";
  const logoBlock = `<div style="min-width:${Math.max(120, Math.round(logoWidth * 0.8))}px;">${logoHtml || ""}</div>`;
  const textFieldsHtml = normalizedOrder.map((fieldKey) => renderFieldHtml(fieldKey)).filter(Boolean).join("");
  const textBlock = `<div>${textFieldsHtml}</div>`;

  let body = "";
  if (normalizedLayout === "logo_top" || normalizedLayout === "logo_bottom") {
    const top = normalizedLayout === "logo_top" ? logoBlock : textBlock;
    const bottom = normalizedLayout === "logo_top" ? textBlock : logoBlock;
    body = `<div style="display:block;"><div style="margin-bottom:12px;">${top}</div><div>${bottom}</div></div>`;
  } else {
    const left = normalizedLayout === "logo_left" ? logoBlock : textBlock;
    const right = normalizedLayout === "logo_left" ? textBlock : logoBlock;
    body = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="vertical-align:top;padding-right:${columnGap}px;">${left}</td><td style="vertical-align:top;">${right}</td></tr></table>`;
  }

  return [marker, body].filter(Boolean).join("\n");
}

function parseSignatureBuilderFromTemplate(templateHtml = "") {
  const raw = String(templateHtml || "");
  const markerRegex = new RegExp(
    `<!--\\s*${SIGNATURE_BUILDER_MARKER_PREFIX}([A-Za-z0-9+/=_-]+)\\s*-->`,
    "i"
  );
  const match = raw.match(markerRegex);
  if (!match?.[1]) return { ...DEFAULT_SIGNATURE_BUILDER };
  const decoded = safeAtob(match[1]);
  if (!decoded) return { ...DEFAULT_SIGNATURE_BUILDER };
  try {
    const parsed = JSON.parse(decoded);
    return {
      fullName: String(parsed?.fullName || ""),
      jobTitle: String(parsed?.jobTitle || ""),
      phone: String(parsed?.phone || ""),
      email: String(parsed?.email || ""),
      logoUrl: String(parsed?.logoUrl || ""),
      companyName: String(parsed?.companyName || ""),
      accentColor: String(parsed?.accentColor || ""),
      layout: String(parsed?.layout || "logo_left"),
      textAlign: String(parsed?.textAlign || "left"),
      textOrder: Array.isArray(parsed?.textOrder)
        ? parsed.textOrder.filter((key) => SIGNATURE_TEXT_FIELD_KEYS.includes(String(key)))
        : [...SIGNATURE_TEXT_FIELD_KEYS],
      fieldVisibility:
        parsed?.fieldVisibility && typeof parsed.fieldVisibility === "object"
          ? {
              fullName: parsed.fieldVisibility.fullName !== false,
              jobTitle: parsed.fieldVisibility.jobTitle !== false,
              phone: parsed.fieldVisibility.phone !== false,
              email: parsed.fieldVisibility.email !== false,
              companyName: parsed.fieldVisibility.companyName !== false,
            }
          : { ...DEFAULT_SIGNATURE_BUILDER.fieldVisibility },
      nameSize: String(parsed?.nameSize || DEFAULT_SIGNATURE_BUILDER.nameSize),
      bodySize: String(parsed?.bodySize || DEFAULT_SIGNATURE_BUILDER.bodySize),
      logoWidth: String(parsed?.logoWidth || DEFAULT_SIGNATURE_BUILDER.logoWidth),
      columnGap: String(parsed?.columnGap || DEFAULT_SIGNATURE_BUILDER.columnGap),
    };
  } catch {
    return { ...DEFAULT_SIGNATURE_BUILDER };
  }
}

export function EditSignatureModal({ open, onOpenChange, member, onSaved }) {
  const supabase = useClerkSupabase();
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateIsActive, setTemplateIsActive] = useState(true);
  const [templateHtml, setTemplateHtml] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderDraft, setBuilderDraft] = useState(DEFAULT_SIGNATURE_BUILDER);
  const [logoUploadError, setLogoUploadError] = useState("");
  const [draggingFieldKey, setDraggingFieldKey] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSignature(String(member?.signature || ""));
  }, [member?.signature, open]);

  useEffect(() => {
    if (!open || !member?.user_id) return;
    let active = true;
    setTemplateLoading(true);
    fetch(`/api/settings/email-signature?user_id=${encodeURIComponent(member.user_id)}`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) throw new Error(payload?.error || "Could not load signature template.");
        const next = payload?.signature || {};
        setTemplateIsActive(next?.is_active !== false);
        setTemplateHtml(String(next?.template_html || ""));
      })
      .catch((error) => {
        if (!active) return;
        toast.error(error?.message || "Could not load signature template.");
      })
      .finally(() => {
        if (active) setTemplateLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, member?.user_id]);

  useEffect(() => {
    if (!builderOpen) return;
    setBuilderDraft(parseSignatureBuilderFromTemplate(templateHtml));
    setLogoUploadError("");
  }, [builderOpen, templateHtml]);

  const previewSignature = useMemo(() => {
    const value = String(signature || "").trim();
    return value || "Best regards,\nSona Team";
  }, [signature]);

  const templateSummary = useMemo(() => {
    const parsed = parseSignatureBuilderFromTemplate(templateHtml);
    const hasTemplate = Boolean(String(templateHtml || "").trim());
    const lineOne =
      String(parsed.fullName || "").trim() ||
      (hasTemplate ? "Template configured." : "No template configured yet.");
    const lineTwo = String(parsed.jobTitle || "").trim();
    return [lineOne, lineTwo].filter(Boolean).join(" • ");
  }, [templateHtml]);

  const templatePreviewHtml = useMemo(() => {
    return "Message body preview.<br/><br/>" + String(templateHtml || "");
  }, [templateHtml]);

  const builderPreviewHtml = useMemo(
    () => "Message body preview.<br/><br/>" + buildSignatureTemplateFromBuilder(builderDraft),
    [builderDraft]
  );
  const hasBuilderChanges = useMemo(() => {
    return (
      String(buildSignatureTemplateFromBuilder(builderDraft) || "").trim() !==
      String(templateHtml || "").trim()
    );
  }, [builderDraft, templateHtml]);

  const handleBuilderField = useCallback((field, value) => {
    setBuilderDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleBuilderFieldVisibility = useCallback((fieldKey, nextVisible) => {
    if (!SIGNATURE_TEXT_FIELD_KEYS.includes(fieldKey)) return;
    setBuilderDraft((prev) => ({
      ...prev,
      fieldVisibility: {
        ...(prev?.fieldVisibility || {}),
        [fieldKey]: Boolean(nextVisible),
      },
    }));
  }, []);

  const handleFieldDrop = useCallback((sourceFieldKey, targetFieldKey) => {
    if (
      !sourceFieldKey ||
      !targetFieldKey ||
      sourceFieldKey === targetFieldKey ||
      !SIGNATURE_TEXT_FIELD_KEYS.includes(sourceFieldKey) ||
      !SIGNATURE_TEXT_FIELD_KEYS.includes(targetFieldKey)
    ) {
      return;
    }
    setBuilderDraft((prev) => {
      const order = Array.isArray(prev?.textOrder) ? [...prev.textOrder] : [...SIGNATURE_TEXT_FIELD_KEYS];
      const fromIndex = order.indexOf(sourceFieldKey);
      const toIndex = order.indexOf(targetFieldKey);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const [moved] = order.splice(fromIndex, 1);
      order.splice(toIndex, 0, moved);
      return { ...prev, textOrder: order };
    });
  }, []);

  const handleLogoUpload = useCallback((event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (!String(file.type || "").toLowerCase().startsWith("image/")) {
      setLogoUploadError("Please upload an image file.");
      return;
    }
    if (Number(file.size || 0) > 5 * 1024 * 1024) {
      setLogoUploadError("Logo must be 5 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      if (!result) {
        setLogoUploadError("Could not read logo file.");
        return;
      }
      setLogoUploadError("");
      setBuilderDraft((prev) => ({ ...prev, logoUrl: result }));
    };
    reader.onerror = () => setLogoUploadError("Could not read logo file.");
    reader.readAsDataURL(file);
  }, []);

  const handleSave = async () => {
    if (!supabase || !member?.user_id || saving) return;
    setSaving(true);
    try {
      const plainSignature = String(signature || "").trim();
      const { error: signatureError } = await supabase
        .from("profiles")
        .update({ signature: plainSignature || null })
        .eq("user_id", member.user_id);
      if (signatureError) throw signatureError;

      const templateResponse = await fetch("/api/settings/email-signature", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          user_id: member.user_id,
          is_active: Boolean(templateIsActive),
          template_html: String(templateHtml || ""),
        }),
      });
      const templatePayload = await templateResponse.json().catch(() => ({}));
      if (!templateResponse.ok) {
        throw new Error(templatePayload?.error || "Could not update signature template.");
      }

      onSaved?.(member.user_id, plainSignature, {
        is_active: templatePayload?.signature?.is_active !== false,
        template_html: String(templatePayload?.signature?.template_html || ""),
      });
      toast.success("Signature updated.");
      onOpenChange(false);
    } catch (error) {
      if (error?.code === "42703") {
        toast.error("profiles.signature column is missing.");
      } else {
        toast.error(error?.message || "Could not update signature.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[96vw] max-w-3xl border-gray-200 bg-white max-h-[92vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Email Signature</DialogTitle>
            <DialogDescription>
              Update signature for {getDisplayName(member)}.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              <label htmlFor="member-signature" className="text-sm font-medium text-slate-700">
                Signature
              </label>
              <Textarea
                id="member-signature"
                value={signature}
                onChange={(event) => setSignature(event.target.value)}
                placeholder={"Best regards,\nYour Name"}
                className="min-h-[120px] resize-y border-gray-200"
              />
            </div>

            <details className="rounded-lg border border-gray-200 p-3">
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Extend with template</p>
                    <p className="text-xs text-slate-500">
                      Add a visual email footer without removing plain text signature.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={(event) => {
                        event.preventDefault();
                        setBuilderOpen(true);
                      }}
                    >
                      Configure template
                    </Button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(templateIsActive)}
                      onClick={(event) => {
                        event.preventDefault();
                        setTemplateIsActive((prev) => !prev);
                      }}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                        templateIsActive ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                          templateIsActive ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </summary>

              <div className="mt-3 space-y-3">
                <div className="rounded-md border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-slate-700">{templateSummary}</p>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" onClick={() => setBuilderOpen(true)}>
                        Edit template
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setTemplateHtml("")}>
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg bg-gray-100 p-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                    Template Preview
                  </p>
                  <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-slate-700">
                    {templateLoading ? (
                      <p className="text-sm text-slate-500">Loading template…</p>
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: templatePreviewHtml }} />
                    )}
                  </div>
                </div>
              </div>
            </details>

            <div className="rounded-lg bg-gray-100 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                Final Preview
              </p>
              <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-slate-700">
                <div className="-m-4 mb-4 rounded-t-lg border-b border-gray-200 bg-gray-50 p-4 text-gray-700">
                  <p>
                    <span className="font-semibold">From:</span> Sona Support{" "}
                    <span className="text-gray-500">&lt;support@yourcompany.com&gt;</span>
                  </p>
                  <p>
                    <span className="font-semibold">To:</span>{" "}
                    <span className="text-gray-600">customer@example.com</span>
                  </p>
                  <p>
                    <span className="font-semibold">Subject:</span>{" "}
                    <span className="text-gray-600">Re: Your inquiry</span>
                  </p>
                </div>

                <p>Hi Customer, thanks for reaching out...</p>
                <p className="mt-4 whitespace-pre-line">{previewSignature}</p>
                {templateIsActive && String(templateHtml || "").trim() ? (
                  <div className="mt-4" dangerouslySetInnerHTML={{ __html: templateHtml }} />
                ) : null}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-2 border-t border-gray-200 pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="bg-slate-900 text-white hover:bg-slate-800"
            >
              {saving ? "Saving..." : "Save Signature"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={builderOpen}
        onOpenChange={(next) => {
          setBuilderOpen(next);
          if (!next) {
            setLogoUploadError("");
            setDraggingFieldKey(null);
          }
        }}
      >
        <DialogContent className="w-[95vw] max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Signature Template Builder</DialogTitle>
            <DialogDescription>
              Build a visual footer and apply it to this team member.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid min-h-0 gap-6 md:grid-cols-[1.05fr_1fr]">
              <div className="space-y-4 pr-1">
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900">Content</h4>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold tracking-wide text-slate-500">FULL NAME</label>
                    <Input
                      value={builderDraft.fullName}
                      onChange={(event) => handleBuilderField("fullName", event.target.value)}
                      placeholder="Full name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold tracking-wide text-slate-500">JOB TITLE</label>
                    <Input
                      value={builderDraft.jobTitle}
                      onChange={(event) => handleBuilderField("jobTitle", event.target.value)}
                      placeholder="Support specialist"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold tracking-wide text-slate-500">PHONE</label>
                      <Input
                        value={builderDraft.phone}
                        onChange={(event) => handleBuilderField("phone", event.target.value)}
                        placeholder="+45 00000000"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold tracking-wide text-slate-500">EMAIL</label>
                      <Input
                        value={builderDraft.email}
                        onChange={(event) => handleBuilderField("email", event.target.value)}
                        placeholder="name@company.com"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold tracking-wide text-slate-500">COMPANY NAME</label>
                    <Input
                      value={builderDraft.companyName}
                      onChange={(event) => handleBuilderField("companyName", event.target.value)}
                      placeholder="Company name"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900">Layout & Style</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold tracking-wide text-slate-500">LAYOUT</label>
                      <select
                        value={builderDraft.layout || "logo_left"}
                        onChange={(event) => handleBuilderField("layout", event.target.value)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-slate-700"
                      >
                        <option value="logo_left">Logo left, text right</option>
                        <option value="logo_right">Text left, logo right</option>
                        <option value="logo_top">Logo top, text below</option>
                        <option value="logo_bottom">Text top, logo below</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold tracking-wide text-slate-500">TEXT ALIGNMENT</label>
                      <select
                        value={builderDraft.textAlign || "left"}
                        onChange={(event) => handleBuilderField("textAlign", event.target.value)}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-slate-700"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold tracking-wide text-slate-500">NAME SIZE (px)</label>
                      <Input
                        type="number"
                        min={12}
                        max={28}
                        value={builderDraft.nameSize || "16"}
                        onChange={(event) => handleBuilderField("nameSize", event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold tracking-wide text-slate-500">TEXT SIZE (px)</label>
                      <Input
                        type="number"
                        min={11}
                        max={22}
                        value={builderDraft.bodySize || "13"}
                        onChange={(event) => handleBuilderField("bodySize", event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold tracking-wide text-slate-500">LOGO WIDTH (px)</label>
                      <Input
                        type="number"
                        min={90}
                        max={320}
                        value={builderDraft.logoWidth || "170"}
                        onChange={(event) => handleBuilderField("logoWidth", event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold tracking-wide text-slate-500">COLUMN GAP (px)</label>
                      <Input
                        type="number"
                        min={4}
                        max={40}
                        value={builderDraft.columnGap || "14"}
                        onChange={(event) => handleBuilderField("columnGap", event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold tracking-wide text-slate-500">ACCENT COLOR</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={builderDraft.accentColor || "#111827"}
                        onChange={(event) => handleBuilderField("accentColor", event.target.value)}
                        className="h-10 w-12 rounded border border-slate-300 bg-white p-1"
                      />
                      <span className="text-sm text-slate-600">
                        {builderDraft.accentColor ? builderDraft.accentColor : "Pick color"}
                      </span>
                      {builderDraft.accentColor ? (
                        <button
                          type="button"
                          className="text-xs text-slate-500 underline"
                          onClick={() => handleBuilderField("accentColor", "")}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900">Text Order</h4>
                  <p className="text-xs text-slate-500">Drag rows to reorder fields in the signature.</p>
                  <div className="space-y-2">
                    {(Array.isArray(builderDraft.textOrder) ? builderDraft.textOrder : SIGNATURE_TEXT_FIELD_KEYS)
                      .filter((fieldKey) => SIGNATURE_TEXT_FIELD_KEYS.includes(fieldKey))
                      .map((fieldKey, index, arr) => (
                        <div
                          key={fieldKey}
                          draggable
                          onDragStart={() => setDraggingFieldKey(fieldKey)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            handleFieldDrop(draggingFieldKey, fieldKey);
                            setDraggingFieldKey(null);
                          }}
                          onDragEnd={() => setDraggingFieldKey(null)}
                          className={`flex items-center justify-between rounded-md border px-2 py-2 transition ${
                            draggingFieldKey === fieldKey
                              ? "border-sky-300 bg-sky-50"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <label className="flex items-center gap-2 text-sm text-slate-700">
                            <button
                              type="button"
                              className="cursor-grab text-slate-400 hover:text-slate-600"
                              aria-label={`Drag ${SIGNATURE_TEXT_FIELD_LABELS[fieldKey] || fieldKey}`}
                            >
                              <GripVertical className="h-4 w-4" />
                            </button>
                            <input
                              type="checkbox"
                              checked={builderDraft?.fieldVisibility?.[fieldKey] !== false}
                              onChange={(event) =>
                                handleBuilderFieldVisibility(fieldKey, event.target.checked)
                              }
                            />
                            {SIGNATURE_TEXT_FIELD_LABELS[fieldKey] || fieldKey}
                          </label>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                  <h4 className="text-sm font-semibold text-slate-900">Logo</h4>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="block w-full text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
                  />
                  {logoUploadError ? <p className="text-xs text-red-600">{logoUploadError}</p> : null}
                  {builderDraft.logoUrl ? (
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={builderDraft.logoUrl} alt="Logo preview" className="h-10 w-auto rounded border border-slate-200" />
                      <button
                        type="button"
                        className="text-xs text-slate-500 underline"
                        onClick={() => handleBuilderField("logoUrl", "")}
                      >
                        Remove logo
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="space-y-2 md:sticky md:top-0 self-start">
                <h4 className="text-sm font-medium text-slate-800">Preview</h4>
                <div className="rounded-md border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
                    <div>From: [sender]</div>
                    <div>To: [recipient]</div>
                    <div>Subject: Re: Your request</div>
                  </div>
                  <div
                    className="p-4 text-sm text-slate-900"
                    dangerouslySetInnerHTML={{ __html: builderPreviewHtml }}
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="mt-4 border-t border-slate-200 pt-3 bg-white">
            <div className="mr-auto text-xs text-slate-500">
              {hasBuilderChanges ? "Unsaved changes" : "No pending changes"}
            </div>
            <Button type="button" variant="outline" onClick={() => setBuilderOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setTemplateHtml(buildSignatureTemplateFromBuilder(builderDraft));
                setBuilderOpen(false);
              }}
            >
              Apply template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
