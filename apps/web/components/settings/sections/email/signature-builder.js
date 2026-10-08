// Structured signature builder: encodes builder fields into signature HTML and back.
import { normalizeSignatureImageUrl } from "@/lib/email-signature-image";

export const SIGNATURE_BUILDER_MARKER_PREFIX = "sona_signature_builder:";
export const SIGNATURE_TEXT_FIELD_KEYS = ["fullName", "jobTitle", "phone", "email", "companyName"];
export const SIGNATURE_TEXT_FIELD_LABELS = {
  fullName: "Full name",
  jobTitle: "Job title",
  phone: "Phone",
  email: "Email",
  companyName: "Company name",
};
export const DEFAULT_SIGNATURE_BUILDER = {
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
};

export function escapeSignatureHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function safeBtoa(value = "") {
  try {
    if (typeof window !== "undefined" && typeof window.btoa === "function") {
      return window.btoa(unescape(encodeURIComponent(String(value || ""))));
    }
  } catch {}
  return "";
}

export function safeAtob(value = "") {
  try {
    if (typeof window !== "undefined" && typeof window.atob === "function") {
      return decodeURIComponent(escape(window.atob(String(value || ""))));
    }
  } catch {}
  return "";
}

export function normalizePhoneHref(value = "") {
  return String(value || "").replace(/[^\d+]/g, "");
}

export function buildSignatureTemplateFromBuilder(builder = DEFAULT_SIGNATURE_BUILDER) {
  const payload = {
    fullName: String(builder?.fullName || "").trim(),
    jobTitle: String(builder?.jobTitle || "").trim(),
    phone: String(builder?.phone || "").trim(),
    email: String(builder?.email || "").trim(),
    logoUrl: normalizeSignatureImageUrl(builder?.logoUrl),
    companyName: String(builder?.companyName || "").trim(),
    accentColor: String(builder?.accentColor || "").trim(),
    layout: String(builder?.layout || "logo_left").trim() || "logo_left",
    textAlign: String(builder?.textAlign || "left").trim() || "left",
    textOrder: Array.isArray(builder?.textOrder) ? builder.textOrder : [...SIGNATURE_TEXT_FIELD_KEYS],
    fieldVisibility:
      builder?.fieldVisibility && typeof builder.fieldVisibility === "object"
        ? builder.fieldVisibility
        : { ...DEFAULT_SIGNATURE_BUILDER.fieldVisibility },
  };
  const encoded = safeBtoa(JSON.stringify(payload));
  const marker = encoded ? `<!-- ${SIGNATURE_BUILDER_MARKER_PREFIX}${encoded} -->` : "";
  const accentStyle = payload.accentColor
    ? `color:${escapeSignatureHtml(payload.accentColor)};`
    : "";
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
      return `<div style="margin-top:4px;font-size:18px;font-weight:700;${accentStyle}${textAlignStyle}line-height:1.2;">${escapeSignatureHtml(payload.fullName)}</div>`;
    }
    if (fieldKey === "jobTitle" && payload.jobTitle) {
      return `<div style="margin-top:4px;font-size:14px;color:#111827;${textAlignStyle}line-height:1.35;">${escapeSignatureHtml(payload.jobTitle)}</div>`;
    }
    if (fieldKey === "phone" && payload.phone) {
      return `<div style="margin-top:4px;font-size:14px;color:#111827;${textAlignStyle}line-height:1.35;">${
        phoneHref
          ? `<a href="tel:${escapeSignatureHtml(phoneHref)}" style="color:#111827;text-decoration:none;">${escapeSignatureHtml(payload.phone)}</a>`
          : escapeSignatureHtml(payload.phone)
      }</div>`;
    }
    if (fieldKey === "email" && payload.email) {
      return `<div style="margin-top:4px;font-size:14px;${textAlignStyle}line-height:1.35;"><a href="mailto:${escapeSignatureHtml(payload.email)}" style="color:#2563EB;text-decoration:underline;">${escapeSignatureHtml(payload.email)}</a></div>`;
    }
    if (fieldKey === "companyName" && payload.companyName) {
      return `<div style="margin-top:6px;font-size:15px;letter-spacing:0.04em;color:#111827;font-weight:600;${textAlignStyle}line-height:1.3;">${escapeSignatureHtml(payload.companyName)}</div>`;
    }
    return "";
  };

  const logoHtml = payload.logoUrl
    ? `<img src="${escapeSignatureHtml(payload.logoUrl)}" alt="${escapeSignatureHtml(payload.companyName || "Company logo")}" style="display:block;max-width:190px;max-height:84px;height:auto;width:auto;">`
    : "";
  const logoBlock = `
<div style="min-width:220px;">
  ${logoHtml || ""}
</div>`.trim();
  const textFieldsHtml = normalizedOrder.map((fieldKey) => renderFieldHtml(fieldKey)).filter(Boolean).join("");
  const textBlock = `
<div>
  ${textFieldsHtml}
</div>`.trim();

  let body = "";
  if (normalizedLayout === "logo_top" || normalizedLayout === "logo_bottom") {
    const top = normalizedLayout === "logo_top" ? logoBlock : textBlock;
    const bottom = normalizedLayout === "logo_top" ? textBlock : logoBlock;
    body = `
<div style="display:block;">
  <div style="margin-bottom:12px;">${top}</div>
  <div>${bottom}</div>
</div>`.trim();
  } else {
    const left = normalizedLayout === "logo_left" ? logoBlock : textBlock;
    const right = normalizedLayout === "logo_left" ? textBlock : logoBlock;
    body = `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
  <tr>
    <td style="vertical-align:top;padding-right:24px;">${left}</td>
    <td style="vertical-align:top;">${right}</td>
  </tr>
</table>`.trim();
  }
  return [marker, body].filter(Boolean).join("\n");
}

export function parseSignatureBuilderFromTemplate(templateHtml = "") {
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
    };
  } catch {
    return { ...DEFAULT_SIGNATURE_BUILDER };
  }
}
