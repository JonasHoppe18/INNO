import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

import { resolveAuthScope } from "./workspace-auth.js";

export const CUSTOMER_SATISFACTION_STORAGE_BUCKET = "workspace-assets";
export const CUSTOMER_SATISFACTION_MIN_DELAY_MINUTES = 5;
export const CUSTOMER_SATISFACTION_MAX_DELAY_MINUTES = 7 * 24 * 60;

export const CUSTOMER_SATISFACTION_DEFAULTS = {
  enabled: false,
  delay: "1h",
  delayMinutes: null,
  excludeAutoResolved: false,
  customerOnly: true,
  subject: "How did we do?",
  headline: "How was your support experience?",
  intro: "We'd love to hear how we did. Your feedback helps us make every reply better.",
  thankYou: "Thanks for helping us improve.",
  company: "",
  senderName: "",
  footer: "You're receiving this because your support conversation was resolved.",
  accent: "#635bff",
  logoPosition: "top-center",
  logoSize: "medium",
  languageMode: "conversation",
  logoUrl: "",
  logoName: "",
};

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

export function createCustomerSatisfactionServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function requireCustomerSatisfactionContext() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return { response: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };

  const serviceClient = createCustomerSatisfactionServiceClient();
  if (!serviceClient) return { response: NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 }) };

  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  if (!scope.workspaceId) return { response: NextResponse.json({ error: "Workspace scope not found." }, { status: 404 }) };
  return { serviceClient, scope };
}

function text(value, fallback = "", maxLength = 1000) {
  if (value === undefined || value === null) return fallback;
  return String(value).trim().slice(0, maxLength);
}

function boolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function delay(value, fallback = CUSTOMER_SATISFACTION_DEFAULTS.delay) {
  return ["immediately", "1h", "24h", "custom"].includes(value) ? value : fallback;
}

function delayMinutes(value, fallback = null) {
  const candidate = Number(value);
  if (!Number.isInteger(candidate)) return fallback;
  if (candidate < CUSTOMER_SATISFACTION_MIN_DELAY_MINUTES || candidate > CUSTOMER_SATISFACTION_MAX_DELAY_MINUTES) {
    return fallback;
  }
  return candidate;
}

function accent(value, fallback = CUSTOMER_SATISFACTION_DEFAULTS.accent) {
  const candidate = text(value, fallback, 7);
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toLowerCase() : fallback;
}

function logoPosition(value, fallback = CUSTOMER_SATISFACTION_DEFAULTS.logoPosition) {
  return ["top-center", "top-left", "footer"].includes(value) ? value : fallback;
}

function logoSize(value, fallback = CUSTOMER_SATISFACTION_DEFAULTS.logoSize) {
  return ["small", "medium", "large"].includes(value) ? value : fallback;
}

function languageMode(value, fallback = CUSTOMER_SATISFACTION_DEFAULTS.languageMode) {
  return ["conversation", "workspace", "en"].includes(value) ? value : fallback;
}

export function normalizeCustomerSatisfactionPayload(row, workspaceName = "", logoUrl = "") {
  const workspaceDefaults = {
    ...CUSTOMER_SATISFACTION_DEFAULTS,
    company: text(workspaceName),
    senderName: workspaceName ? `${text(workspaceName)} Support` : "",
  };
  const normalizedDelay = delay(row?.send_delay, workspaceDefaults.delay);
  return {
    enabled: boolean(row?.enabled, workspaceDefaults.enabled),
    delay: normalizedDelay,
    delayMinutes: normalizedDelay === "custom" ? delayMinutes(row?.send_delay_minutes, 60) : null,
    // CSAT covers every resolved conversation, including auto-resolved ones.
    excludeAutoResolved: false,
    // CSAT is always restricted to real customer email addresses. Keep the
    // field in the response for backwards compatibility with older clients,
    // but never allow a stored value to disable this safety rule.
    customerOnly: true,
    subject: text(row?.subject, workspaceDefaults.subject),
    headline: text(row?.headline, workspaceDefaults.headline),
    intro: text(row?.intro, workspaceDefaults.intro),
    thankYou: text(row?.thank_you, workspaceDefaults.thankYou),
    company: text(row?.company_name, workspaceDefaults.company),
    senderName: text(row?.sender_name, workspaceDefaults.senderName),
    footer: text(row?.footer, workspaceDefaults.footer),
    accent: accent(row?.accent_color, workspaceDefaults.accent),
    logoPosition: logoPosition(row?.logo_position),
    logoSize: logoSize(row?.logo_size),
    languageMode: languageMode(row?.language_mode),
    logoUrl: logoUrl || "",
    logoName: text(row?.logo_name),
    updatedAt: row?.updated_at || null,
  };
}

export async function loadCustomerSatisfactionSettings(serviceClient, workspaceId, { logoExpiresIn = 3600 } = {}) {
  const [{ data: row, error: rowError }, { data: workspace, error: workspaceError }] = await Promise.all([
    serviceClient
      .from("workspace_customer_satisfaction_settings")
      .select("id, workspace_id, enabled, send_delay, send_delay_minutes, exclude_auto_resolved, customer_only, subject, headline, intro, thank_you, company_name, sender_name, footer, accent_color, logo_position, logo_size, language_mode, logo_path, logo_name, updated_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    serviceClient.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
  ]);
  if (rowError) throw new Error(rowError.message);
  if (workspaceError) throw new Error(workspaceError.message);

  let logoUrl = "";
  if (row?.logo_path) {
    const signed = await serviceClient.storage.from(CUSTOMER_SATISFACTION_STORAGE_BUCKET).createSignedUrl(row.logo_path, logoExpiresIn);
    if (!signed.error) logoUrl = signed.data?.signedUrl || "";
  }

  return normalizeCustomerSatisfactionPayload(row, text(workspace?.name), logoUrl);
}

export function customerSatisfactionDatabaseValues(body, workspaceId, existing = {}) {
  const normalizedDelay = delay(body?.delay);
  return {
    workspace_id: workspaceId,
    enabled: boolean(body?.enabled, CUSTOMER_SATISFACTION_DEFAULTS.enabled),
    send_delay: normalizedDelay,
    send_delay_minutes: normalizedDelay === "custom" ? delayMinutes(body?.delayMinutes, 60) : null,
    exclude_auto_resolved: false,
    customer_only: true,
    subject: text(body?.subject, CUSTOMER_SATISFACTION_DEFAULTS.subject),
    headline: text(body?.headline, CUSTOMER_SATISFACTION_DEFAULTS.headline),
    intro: text(body?.intro, CUSTOMER_SATISFACTION_DEFAULTS.intro),
    thank_you: text(body?.thankYou, CUSTOMER_SATISFACTION_DEFAULTS.thankYou),
    company_name: text(body?.company, existing.company_name || ""),
    sender_name: text(body?.senderName, existing.sender_name || ""),
    footer: text(body?.footer, CUSTOMER_SATISFACTION_DEFAULTS.footer),
    accent_color: accent(body?.accent),
    logo_position: logoPosition(body?.logoPosition),
    logo_size: logoSize(body?.logoSize),
    language_mode: languageMode(body?.languageMode),
    logo_path: existing.logo_path || null,
    logo_name: existing.logo_name || null,
    updated_at: new Date().toISOString(),
  };
}

export async function removeCustomerSatisfactionLogo(serviceClient, logoPath) {
  if (!logoPath) return;
  const { error } = await serviceClient.storage.from(CUSTOMER_SATISFACTION_STORAGE_BUCKET).remove([logoPath]);
  if (error) throw new Error(error.message);
}
