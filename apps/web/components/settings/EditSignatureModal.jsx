"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, GripVertical, Minus, Plus } from "lucide-react";
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

const LAYOUT_OPTIONS = [
  {
    value: "logo_left",
    label: "Logo left",
    preview: (
      <div className="flex items-start gap-1">
        <div className="h-5 w-5 flex-shrink-0 rounded bg-slate-400" />
        <div className="flex flex-1 flex-col gap-0.5 pt-0.5">
          <div className="h-1.5 w-full rounded bg-slate-300" />
          <div className="h-1 w-3/4 rounded bg-slate-200" />
          <div className="h-1 w-1/2 rounded bg-slate-200" />
        </div>
      </div>
    ),
  },
  {
    value: "logo_right",
    label: "Logo right",
    preview: (
      <div className="flex items-start gap-1">
        <div className="flex flex-1 flex-col gap-0.5 pt-0.5">
          <div className="h-1.5 w-full rounded bg-slate-300" />
          <div className="h-1 w-3/4 rounded bg-slate-200" />
          <div className="h-1 w-1/2 rounded bg-slate-200" />
        </div>
        <div className="h-5 w-5 flex-shrink-0 rounded bg-slate-400" />
      </div>
    ),
  },
  {
    value: "logo_top",
    label: "Logo top",
    preview: (
      <div className="flex flex-col gap-1">
        <div className="h-3 w-full rounded bg-slate-400" />
        <div className="flex flex-col gap-0.5">
          <div className="h-1.5 w-full rounded bg-slate-300" />
          <div className="h-1 w-2/3 rounded bg-slate-200" />
        </div>
      </div>
    ),
  },
  {
    value: "logo_bottom",
    label: "Logo bottom",
    preview: (
      <div className="flex flex-col gap-1">
        <div className="flex flex-col gap-0.5">
          <div className="h-1.5 w-full rounded bg-slate-300" />
          <div className="h-1 w-2/3 rounded bg-slate-200" />
        </div>
        <div className="h-3 w-full rounded bg-slate-400" />
      </div>
    ),
  },
];

const TEXT_ALIGN_OPTIONS = [
  { value: "left", icon: AlignLeft, label: "Left" },
  { value: "center", icon: AlignCenter, label: "Center" },
  { value: "right", icon: AlignRight, label: "Right" },
];

function StepperInput({ value, onChange, min, max }) {
  const num = Number(value);
  return (
    <div className="flex h-9 items-center rounded-md border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => onChange(String(Math.max(min, num - 1)))}
        className="flex h-full w-8 items-center justify-center text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 active:scale-95"
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="w-10 select-none text-center text-sm text-slate-700">{value}</span>
      <button
        type="button"
        onClick={() => onChange(String(Math.min(max, num + 1)))}
        className="flex h-full w-8 items-center justify-center text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 active:scale-95"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{children}</p>
  );
}

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
    return [lineOne, lineTwo].filter(Boolean).join(" · ");
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

  const hasTemplate = Boolean(String(templateHtml || "").trim());

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex w-[96vw] max-w-2xl flex-col overflow-hidden border-gray-200 bg-white" style={{ maxHeight: "92vh" }}>
          <DialogHeader>
            <DialogTitle className="text-base">Edit Email Signature</DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              Update signature for {getDisplayName(member)}.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-0.5">
            {/* Plain text signature */}
            <div className="space-y-1.5">
              <label htmlFor="member-signature" className="text-sm font-medium text-slate-700">
                Signature
              </label>
              <Textarea
                id="member-signature"
                value={signature}
                onChange={(event) => setSignature(event.target.value)}
                placeholder={"Best regards,\nYour Name"}
                className="min-h-[100px] resize-y border-slate-200 text-sm"
              />
            </div>

            {/* Visual template toggle row */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">Extend with template</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Add a visual email footer without removing plain text signature.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 border-slate-200 text-xs"
                    onClick={() => setBuilderOpen(true)}
                  >
                    Configure template
                  </Button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(templateIsActive)}
                    onClick={() => setTemplateIsActive((prev) => !prev)}
                    className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                      templateIsActive ? "bg-emerald-500" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                        templateIsActive ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {hasTemplate && (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="truncate text-sm text-slate-600">{templateSummary}</p>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700"
                      onClick={() => setBuilderOpen(true)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-slate-400 hover:text-red-500"
                      onClick={() => setTemplateHtml("")}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Final preview */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-widest">Final Preview</p>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-sm text-slate-700 shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                  <p><span className="font-medium text-slate-700">From:</span> Sona Support <span className="text-slate-400">&lt;support@yourcompany.com&gt;</span></p>
                  <p className="mt-0.5"><span className="font-medium text-slate-700">To:</span> customer@example.com</p>
                  <p className="mt-0.5"><span className="font-medium text-slate-700">Subject:</span> Re: Your inquiry</p>
                </div>
                <div className="px-4 py-4">
                  <p className="text-slate-600">Hi Customer, thanks for reaching out...</p>
                  <p className="mt-4 whitespace-pre-line text-slate-700">{previewSignature}</p>
                  {templateIsActive && hasTemplate && (
                    <div className="mt-4" dangerouslySetInnerHTML={{ __html: templateHtml }} />
                  )}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-3 border-t border-gray-100 pt-3">
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

      {/* Template Builder */}
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
        <DialogContent className="flex w-[95vw] max-w-6xl flex-col overflow-hidden" style={{ maxHeight: "90vh" }}>
          <DialogHeader>
            <DialogTitle className="text-base">Signature Template Builder</DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              Build a visual footer and apply it to this team member.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid min-h-0 gap-6 md:grid-cols-[1.1fr_1fr]">
              {/* Left: controls */}
              <div className="space-y-4 pr-1 pb-1">

                {/* Content */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900">Content</h4>
                  <div className="space-y-1.5">
                    <SectionLabel>Full Name</SectionLabel>
                    <Input
                      value={builderDraft.fullName}
                      onChange={(e) => handleBuilderField("fullName", e.target.value)}
                      placeholder="Full name"
                      className="border-slate-200 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <SectionLabel>Job Title</SectionLabel>
                    <Input
                      value={builderDraft.jobTitle}
                      onChange={(e) => handleBuilderField("jobTitle", e.target.value)}
                      placeholder="Support specialist"
                      className="border-slate-200 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <SectionLabel>Phone</SectionLabel>
                      <Input
                        value={builderDraft.phone}
                        onChange={(e) => handleBuilderField("phone", e.target.value)}
                        placeholder="+45 00000000"
                        className="border-slate-200 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <SectionLabel>Email</SectionLabel>
                      <Input
                        value={builderDraft.email}
                        onChange={(e) => handleBuilderField("email", e.target.value)}
                        placeholder="name@company.com"
                        className="border-slate-200 text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <SectionLabel>Company Name</SectionLabel>
                    <Input
                      value={builderDraft.companyName}
                      onChange={(e) => handleBuilderField("companyName", e.target.value)}
                      placeholder="Company name"
                      className="border-slate-200 text-sm"
                    />
                  </div>
                </div>

                {/* Layout & Style */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
                  <h4 className="text-sm font-semibold text-slate-900">Layout & Style</h4>

                  {/* Layout picker */}
                  <div className="space-y-2">
                    <SectionLabel>Layout</SectionLabel>
                    <div className="grid grid-cols-4 gap-2">
                      {LAYOUT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleBuilderField("layout", opt.value)}
                          className={`flex flex-col items-center gap-2 rounded-lg border p-2.5 text-center transition-all ${
                            builderDraft.layout === opt.value
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-300 hover:bg-white"
                          }`}
                        >
                          <div className={`w-full ${builderDraft.layout === opt.value ? "[&_div]:bg-white/60 [&_.logo-block]:bg-white" : ""}`}>
                            {opt.preview}
                          </div>
                          <span className="text-[10px] font-medium leading-none">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text alignment */}
                  <div className="space-y-2">
                    <SectionLabel>Text Alignment</SectionLabel>
                    <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                      {TEXT_ALIGN_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => handleBuilderField("textAlign", opt.value)}
                            aria-label={opt.label}
                            className={`flex flex-1 items-center justify-center rounded-md py-1.5 transition-all ${
                              builderDraft.textAlign === opt.value
                                ? "bg-white text-slate-900 shadow-sm"
                                : "text-slate-400 hover:text-slate-600"
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Size controls */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <SectionLabel>Name size (px)</SectionLabel>
                      <StepperInput
                        value={builderDraft.nameSize || "16"}
                        onChange={(v) => handleBuilderField("nameSize", v)}
                        min={12}
                        max={28}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <SectionLabel>Text size (px)</SectionLabel>
                      <StepperInput
                        value={builderDraft.bodySize || "13"}
                        onChange={(v) => handleBuilderField("bodySize", v)}
                        min={11}
                        max={22}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <SectionLabel>Logo width (px)</SectionLabel>
                      <StepperInput
                        value={builderDraft.logoWidth || "170"}
                        onChange={(v) => handleBuilderField("logoWidth", v)}
                        min={90}
                        max={320}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <SectionLabel>Column gap (px)</SectionLabel>
                      <StepperInput
                        value={builderDraft.columnGap || "14"}
                        onChange={(v) => handleBuilderField("columnGap", v)}
                        min={4}
                        max={40}
                      />
                    </div>
                  </div>

                  {/* Accent color */}
                  <div className="space-y-2">
                    <SectionLabel>Accent Color</SectionLabel>
                    <div className="flex items-center gap-2.5">
                      <label className="relative cursor-pointer">
                        <div
                          className="h-8 w-8 rounded-lg border border-slate-200 shadow-sm"
                          style={{ backgroundColor: builderDraft.accentColor || "#111827" }}
                        />
                        <input
                          type="color"
                          value={builderDraft.accentColor || "#111827"}
                          onChange={(e) => handleBuilderField("accentColor", e.target.value)}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        />
                      </label>
                      <span className="font-mono text-sm text-slate-600">
                        {builderDraft.accentColor || "#111827"}
                      </span>
                      {builderDraft.accentColor ? (
                        <button
                          type="button"
                          className="text-xs text-slate-400 underline hover:text-slate-600"
                          onClick={() => handleBuilderField("accentColor", "")}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Text order */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Text Order</h4>
                    <p className="mt-0.5 text-xs text-slate-500">Drag rows to reorder fields in the signature.</p>
                  </div>
                  <div className="space-y-1.5">
                    {(Array.isArray(builderDraft.textOrder) ? builderDraft.textOrder : SIGNATURE_TEXT_FIELD_KEYS)
                      .filter((fieldKey) => SIGNATURE_TEXT_FIELD_KEYS.includes(fieldKey))
                      .map((fieldKey) => (
                        <div
                          key={fieldKey}
                          draggable
                          onDragStart={() => setDraggingFieldKey(fieldKey)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            handleFieldDrop(draggingFieldKey, fieldKey);
                            setDraggingFieldKey(null);
                          }}
                          onDragEnd={() => setDraggingFieldKey(null)}
                          className={`flex cursor-grab items-center gap-2.5 rounded-lg border px-3 py-2 transition-all active:cursor-grabbing ${
                            draggingFieldKey === fieldKey
                              ? "border-slate-900 bg-slate-50 opacity-60"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <GripVertical className="h-3.5 w-3.5 text-slate-300" />
                          <input
                            type="checkbox"
                            checked={builderDraft?.fieldVisibility?.[fieldKey] !== false}
                            onChange={(e) => handleBuilderFieldVisibility(fieldKey, e.target.checked)}
                            className="accent-slate-900"
                          />
                          <span className="text-sm text-slate-700">
                            {SIGNATURE_TEXT_FIELD_LABELS[fieldKey] || fieldKey}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Logo */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900">Logo</h4>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 transition-colors hover:border-slate-400 hover:bg-slate-100">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="sr-only"
                    />
                    <span className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                      Choose file
                    </span>
                    <span className="text-xs text-slate-400">PNG, SVG, or JPG · max 5 MB</span>
                  </label>
                  {logoUploadError ? (
                    <p className="text-xs text-red-500">{logoUploadError}</p>
                  ) : null}
                  {builderDraft.logoUrl ? (
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={builderDraft.logoUrl}
                        alt="Logo preview"
                        className="h-10 w-auto rounded-md border border-slate-200"
                      />
                      <button
                        type="button"
                        className="text-xs text-slate-400 underline hover:text-red-500"
                        onClick={() => handleBuilderField("logoUrl", "")}
                      >
                        Remove logo
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Right: preview */}
              <div className="space-y-2.5 md:sticky md:top-0 self-start">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-widest">Preview</p>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                    <p>From: [sender]</p>
                    <p className="mt-0.5">To: [recipient]</p>
                    <p className="mt-0.5">Subject: Re: Your request</p>
                  </div>
                  <div
                    className="p-4 text-sm text-slate-700"
                    dangerouslySetInnerHTML={{ __html: builderPreviewHtml }}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4 border-t border-slate-100 pt-3">
            <p className="mr-auto text-xs text-slate-400">
              {hasBuilderChanges ? "Unsaved changes" : ""}
            </p>
            <Button type="button" variant="outline" onClick={() => setBuilderOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-slate-900 text-white hover:bg-slate-800"
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
