// Deploy: supabase functions deploy postmark-inbound --no-verify
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SONA_WEBHOOK_SECRET
// SQL: create unique index if not exists uniq_mail_messages_provider_msg on public.mail_messages(provider, provider_message_id);
import { createClient } from "jsr:@supabase/supabase-js@2";
import { shouldSkipInboxMessage } from "../_shared/inbox-filter.ts";
import { classifyInboxBucket } from "../_shared/inbox-classification.ts";
import {
  categorizeEmail,
  EmailCategory,
  EMAIL_CATEGORIES,
  LEGACY_EMAIL_CATEGORY_MAP,
  normalizeEmailCategory,
} from "../_shared/email-category.ts";
import {
  classifyInboundRouting,
  type RoutingCategory,
  type RoutingTargetCategory,
  type RoutingClassification,
} from "../_shared/email-routing-classifier.ts";
import { parseEmailReplyBodies } from "../_shared/email-reply-parser.ts";
import { parseShopifyContactIdentity } from "../_shared/shopify-contact-form.ts";
import { detectCustomerLanguage } from "../_shared/detect-language.ts";

const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
const WEBHOOK_SECRET = Deno.env.get("SONA_WEBHOOK_SECRET") ?? "";
const INTERNAL_AGENT_SECRET = Deno.env.get("INTERNAL_AGENT_SECRET") ?? "";
const IGNORE_SPAM_FILTER = Deno.env.get("POSTMARK_IGNORE_SPAM") === "true";
const POSTMARK_SERVER_TOKEN = Deno.env.get("POSTMARK_SERVER_TOKEN") ?? "";
const POSTMARK_MESSAGE_STREAM = Deno.env.get("POSTMARK_MESSAGE_STREAM") ?? "outbound";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const POSTMARK_FROM_EMAIL = Deno.env.get("POSTMARK_FROM_EMAIL") ?? "support@sona-ai.dk";
const POSTMARK_FROM_NAME = Deno.env.get("POSTMARK_FROM_NAME") ?? "Sona";

const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

const INBOUND_DOMAIN = "inbound.sona-ai.dk";
const EMAIL_CATEGORY_SET = new Set<string>(EMAIL_CATEGORIES);
const LEGACY_CATEGORY_TAGS = new Set<string>(Object.keys(LEGACY_EMAIL_CATEGORY_MAP));

type PostmarkHeader = { Name?: string; Value?: string };
type PostmarkAttachment = {
  Name?: string;
  ContentType?: string;
  ContentLength?: number;
  ContentID?: string | null;
  Content?: string;
};

type MailboxLookup = {
  mailbox_id: string;
  user_id: string;
  workspace_id: string | null;
  shop_id: string | null;
  provider_email: string | null;
  from_name: string | null;
  status?: string | null;
};

type AutoReplySettings = {
  id: string;
  enabled: boolean;
  trigger_mode: "first_inbound_per_thread" | "every_inbound";
  cooldown_minutes: number;
  subject_template: string;
  body_text_template: string;
  body_html_template: string | null;
  template_id: string | null;
};

type WorkspaceEmailRoute = {
  id: string;
  workspace_id: string;
  category_key: string;
  label: string;
  forward_to_email: string | null;
  mode: "manual_approval" | "auto_forward";
  is_active: boolean;
};

type RouteDecision = {
  category: string;
  mode: "manual_approval" | "auto_forward" | null;
  forwardToEmail: string | null;
  shouldCreateApprovalAction: boolean;
  shouldAutoForward: boolean;
  isEffectiveSupport: boolean;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-sona-webhook-secret, Authorization",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function isAuthorized(req: Request) {
  if (!WEBHOOK_SECRET) return false;
  const headerSecret = req.headers.get("x-sona-webhook-secret") ?? "";
  if (headerSecret && headerSecret === WEBHOOK_SECRET) return true;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Basic ")) {
    try {
      const raw = atob(authHeader.slice("Basic ".length));
      const [, password] = raw.split(":");
      if (password && password === WEBHOOK_SECRET) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function normalizeEmailList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : ""))
      .flatMap((item) => item.split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function extractEmail(value: string): string | null {
  if (!value) return null;
  const match = value.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim();
  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch ? emailMatch[0].trim() : value.trim();
}

function extractName(value: string): string | null {
  if (!value) return null;
  const name = value.replace(/<[^>]+>/g, "").replace(/\"/g, "").trim();
  return name || null;
}

function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/[<>]/g, "").trim() || null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function buildSnippet(text: string, maxLength = 240): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}…` : cleaned;
}

function findHeader(headers: PostmarkHeader[] | null, name: string): string | null {
  if (!headers) return null;
  const match = headers.find((h) => h?.Name?.toLowerCase() === name.toLowerCase());
  return match?.Value ?? null;
}

function getInboundRecipient(toList: string[]): string | null {
  for (const raw of toList) {
    const email = extractEmail(raw);
    if (email && email.toLowerCase().endsWith(`@${INBOUND_DOMAIN}`)) {
      return email;
    }
  }
  return null;
}

function collectRecipientCandidates(
  payload: Record<string, unknown>,
  headers: PostmarkHeader[],
): string[] {
  const candidates: string[] = [];
  candidates.push(...normalizeEmailList(payload?.To));
  candidates.push(...normalizeEmailList(payload?.OriginalRecipient));
  candidates.push(...normalizeEmailList(payload?.Recipient));

  const headerNames = [
    "Delivered-To",
    "X-Original-To",
    "X-Forwarded-To",
    "Envelope-To",
    "X-Envelope-To",
    "To",
  ];
  for (const name of headerNames) {
    const value = findHeader(headers, name);
    if (value) candidates.push(value);
  }
  return candidates.filter(Boolean);
}

function parseSlugFromAddress(address: string | null): string | null {
  if (!address) return null;
  const email = extractEmail(address);
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain || domain.toLowerCase() !== INBOUND_DOMAIN) return null;
  return local.trim().toLowerCase() || null;
}

function splitThreadTags(tags: unknown): { category: EmailCategory | null; other: string[] } {
  const list = Array.isArray(tags)
    ? tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
  let category: EmailCategory | null = null;
  const other: string[] = [];
  for (const tag of list) {
    if (!category && (EMAIL_CATEGORY_SET.has(tag) || LEGACY_CATEGORY_TAGS.has(tag))) {
      category = normalizeEmailCategory(tag);
      continue;
    }
    other.push(tag);
  }
  return { category, other };
}

function buildThreadTags(existingTags: unknown, category: EmailCategory): string[] {
  const { other } = splitThreadTags(existingTags);
  return [category, ...other];
}

async function lookupMailbox(slug: string): Promise<MailboxLookup | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("mail_accounts")
    .select("id, user_id, workspace_id, shop_id, provider_email, from_name, inbound_slug, status")
    .ilike("inbound_slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id || !data?.user_id) return null;
  let shopId = data.shop_id ?? null;
  if (!shopId) {
    let shopsQuery = supabase
      .from("shops")
      .select("id")
      .is("uninstalled_at", null)
      .eq("platform", "shopify")
      .order("created_at", { ascending: false })
      .limit(2);
    shopsQuery = data.workspace_id
      ? shopsQuery.eq("workspace_id", data.workspace_id)
      : shopsQuery.eq("owner_user_id", data.user_id);
    const { data: shopRows, error: shopsError } = await shopsQuery;
    if (shopsError) throw new Error(shopsError.message);
    const activeShops = Array.isArray(shopRows) ? shopRows : [];
    if (activeShops.length === 1 && activeShops[0]?.id) {
      shopId = activeShops[0].id as string;
      const { error: repairError } = await supabase
        .from("mail_accounts")
        .update({
          shop_id: shopId,
          status: data.status === "disconnected" ? data.status : "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id);
      if (repairError) {
        console.warn("postmark-inbound: failed to auto-rebind mailbox shop", repairError.message);
      }
    }
  }
  return {
    mailbox_id: data.id,
    user_id: data.user_id,
    workspace_id: data.workspace_id ?? null,
    shop_id: shopId,
    provider_email: data.provider_email ?? null,
    from_name: data.from_name ?? null,
    status: shopId && data.status !== "disconnected" ? "active" : data.status,
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRouteCategory(value: unknown): string {
  const normalized = asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "support";
  return normalized;
}

function normalizeRouteMode(value: unknown): "manual_approval" | "auto_forward" {
  return asString(value).toLowerCase() === "auto_forward" ? "auto_forward" : "manual_approval";
}

function buildForwardActionKey(messageId: string | null, targetEmail: string): string {
  return `forward_email::${String(messageId || "unknown")}::${targetEmail.toLowerCase()}`;
}

async function ensureWorkspaceRoutes(workspaceId: string | null): Promise<WorkspaceEmailRoute[]> {
  if (!supabase || !workspaceId) return [];

  const { data, error } = await supabase
    .from("workspace_email_routes")
    .select("id, workspace_id, category_key, label, forward_to_email, mode, is_active, sort_order")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);

  return (Array.isArray(data) ? data : [])
    .map((row) => {
      const category = normalizeRouteCategory(row?.category_key);
      if (category === "support") return null;
      return {
        id: String(row?.id || ""),
        workspace_id: String(row?.workspace_id || workspaceId),
        category_key: category,
        label: asString(row?.label) || category,
        forward_to_email: asString(row?.forward_to_email) || null,
        mode: normalizeRouteMode(row?.mode),
        is_active: Boolean(row?.is_active),
      } as WorkspaceEmailRoute;
    })
    .filter((row): row is WorkspaceEmailRoute => Boolean(row?.id));
}

function decideRouteForClassification(
  classification: RoutingClassification,
  routes: WorkspaceEmailRoute[],
): RouteDecision {
  const category = normalizeRouteCategory(classification.category);
  if (category === "support") {
    return {
      category,
      mode: null,
      forwardToEmail: null,
      shouldCreateApprovalAction: false,
      shouldAutoForward: false,
      isEffectiveSupport: true,
    };
  }

  const route = routes.find((row) => row.category_key === category);
  if (!route || !route.is_active) {
    return {
      category,
      mode: null,
      forwardToEmail: null,
      shouldCreateApprovalAction: false,
      shouldAutoForward: false,
      isEffectiveSupport: true,
    };
  }

  const forwardToEmail = asString(route.forward_to_email).toLowerCase() || null;
  const mode = route.mode;
  if (!forwardToEmail) {
    return {
      category,
      mode,
      forwardToEmail: null,
      shouldCreateApprovalAction: false,
      shouldAutoForward: false,
      isEffectiveSupport: true,
    };
  }
  return {
    category,
    mode,
    forwardToEmail,
    shouldCreateApprovalAction: mode === "manual_approval",
    shouldAutoForward: mode === "auto_forward",
    isEffectiveSupport: false,
  };
}

function firstName(value: string | null | undefined): string {
  const next = asString(value);
  if (!next) return "";
  return next.split(/\s+/)[0] || "";
}

function isLikelyAutoSender(fromEmail: string | null, headers: PostmarkHeader[]): boolean {
  const sender = String(fromEmail || "").toLowerCase();
  if (/no[-_.]?reply|donotreply|mailer-daemon|postmaster|noreply/.test(sender)) return true;
  const autoSubmitted = String(findHeader(headers, "Auto-Submitted") || "").toLowerCase();
  const precedence = String(findHeader(headers, "Precedence") || "").toLowerCase();
  const xAutoResponseSuppress = String(findHeader(headers, "X-Auto-Response-Suppress") || "").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (/bulk|list|junk/.test(precedence)) return true;
  if (xAutoResponseSuppress.includes("all")) return true;
  return false;
}

function fillTemplateTokens(template: string, values: Record<string, string>): string {
  let result = String(template || "");
  Object.entries(values).forEach(([key, value]) => {
    result = result.replaceAll(`{{${key}}}`, String(value ?? ""));
  });
  return result;
}

function toPlainText(value: string): string {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeSubjectForDiagnostics(value: string | null | undefined): string {
  let subject = asString(value);
  if (!subject) return "";
  let changed = true;
  while (changed) {
    changed = false;
    const next = subject.replace(/^(?:(?:re|fw|fwd|sv)\s*:\s*)+/i, "").trim();
    if (next !== subject) {
      subject = next;
      changed = true;
    }
  }
  return subject.replace(/\s+/g, " ").trim();
}

async function loadAutoReplySettings(mailbox: MailboxLookup): Promise<AutoReplySettings | null> {
  if (!supabase) return null;
  if (!mailbox.workspace_id) return null;
  const query = supabase
    .from("mail_auto_reply_settings")
    .select(
      "id, enabled, trigger_mode, cooldown_minutes, subject_template, body_text_template, body_html_template, template_id, mailbox_id"
    )
    .eq("enabled", true)
    .eq("workspace_id", mailbox.workspace_id)
    .order("updated_at", { ascending: false })
    .limit(20);
  const { data, error } = await query;
  if (error) {
    console.warn("postmark-inbound: failed to load auto reply settings", error.message);
    return null;
  }
  const rows = Array.isArray(data) ? data : [];
  const selected =
    rows.find((row) => row?.mailbox_id && row.mailbox_id === mailbox.mailbox_id) ||
    rows.find((row) => !row?.mailbox_id) ||
    null;
  if (!selected?.id) return null;
  return {
    id: selected.id,
    enabled: Boolean(selected.enabled),
    trigger_mode:
      selected.trigger_mode === "every_inbound" ? "every_inbound" : "first_inbound_per_thread",
    cooldown_minutes: Math.max(1, Number(selected.cooldown_minutes ?? 1440)),
    subject_template: asString(selected.subject_template) || "Tak for din henvendelse",
    body_text_template:
      asString(selected.body_text_template) ||
      "Hej,\n\nTak for din henvendelse. Vi har modtaget din besked og vender tilbage hurtigst muligt.",
    body_html_template: asString(selected.body_html_template) || null,
    template_id: asString(selected.template_id) || null,
  };
}

async function loadWorkspaceTestSettings(workspaceId: string | null): Promise<{
  testMode: boolean;
  testEmail: string | null;
}> {
  if (!supabase || !workspaceId) {
    return { testMode: false, testEmail: null };
  }
  const { data, error } = await supabase
    .from("workspaces")
    .select("test_mode, test_email")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    console.warn("postmark-inbound: failed to load workspace test mode", error.message);
    return { testMode: false, testEmail: null };
  }
  const testEmail = asString((data as any)?.test_email).toLowerCase() || null;
  return {
    testMode: Boolean((data as any)?.test_mode),
    testEmail,
  };
}

async function loadAutoReplyTemplateHtml(
  mailbox: MailboxLookup,
  templateId: string | null,
): Promise<string> {
  if (!supabase || !templateId || !mailbox.workspace_id) return "{{content}}";
  const query = supabase
    .from("mail_auto_reply_templates")
    .select("html_layout")
    .eq("workspace_id", mailbox.workspace_id)
    .eq("id", templateId)
    .maybeSingle();
  const { data } = await query;
  return asString((data as any)?.html_layout) || "{{content}}";
}

async function sendPostmarkAutoReply(payload: {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  replyTo?: string | null;
}): Promise<string | null> {
  if (!POSTMARK_SERVER_TOKEN) {
    console.warn("postmark-inbound: POSTMARK_SERVER_TOKEN missing, auto-reply skipped");
    return null;
  }
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN,
    },
    body: JSON.stringify({
      MessageStream: POSTMARK_MESSAGE_STREAM,
      From: `${payload.fromName} <${payload.from}>`,
      To: payload.to,
      Subject: payload.subject,
      TextBody: payload.textBody,
      HtmlBody: payload.htmlBody,
      ReplyTo: payload.replyTo || undefined,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Postmark auto-reply failed ${response.status}: ${data?.Message || response.statusText}`,
    );
  }
  return asString(data?.MessageID) || null;
}

async function sendForwardedEmail(options: {
  mailbox: MailboxLookup;
  to: string;
  originalSubject: string;
  originalFrom: string;
  originalBodyText: string;
}): Promise<string | null> {
  if (!POSTMARK_SERVER_TOKEN) {
    throw new Error("POSTMARK_SERVER_TOKEN missing");
  }
  const fromEmail = asString(options.mailbox.provider_email) || POSTMARK_FROM_EMAIL;
  const fromName = asString(options.mailbox.from_name) || POSTMARK_FROM_NAME;
  const subject = `Fwd: ${options.originalSubject || "Inbound message"}`.slice(0, 250);
  const textBody = [
    "Forwarded inbound email",
    "",
    `From: ${options.originalFrom || "Unknown sender"}`,
    `Subject: ${options.originalSubject || "(no subject)"}`,
    "",
    options.originalBodyText || "(empty body)",
  ].join("\n");
  const safeBody = String(options.originalBodyText || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
  const htmlBody =
    `<p><strong>Forwarded inbound email</strong></p>` +
    `<p><strong>From:</strong> ${options.originalFrom || "Unknown sender"}<br/>` +
    `<strong>Subject:</strong> ${options.originalSubject || "(no subject)"}</p>` +
    `<hr/><p style=\"white-space:pre-wrap\">${safeBody}</p>`;

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN,
    },
    body: JSON.stringify({
      MessageStream: POSTMARK_MESSAGE_STREAM,
      From: `${fromName} <${fromEmail}>`,
      To: options.to,
      Subject: subject,
      TextBody: textBody,
      HtmlBody: htmlBody,
      ReplyTo: fromEmail,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Postmark forward failed ${response.status}: ${data?.Message || response.statusText}`,
    );
  }
  return asString(data?.MessageID) || null;
}

async function createPendingForwardAction(options: {
  threadId: string;
  mailbox: MailboxLookup;
  targetEmail: string;
  messageDbId: string | null;
  providerMessageId: string;
  subject: string;
  fromRaw: string;
  category: RoutingCategory;
  classification: RoutingClassification;
}) {
  if (!supabase) return;
  const actionKey = buildForwardActionKey(options.messageDbId, options.targetEmail);
  const nowIso = new Date().toISOString();
  const { data: existing } = await supabase
    .from("thread_actions")
    .select("id")
    .eq("thread_id", options.threadId)
    .eq("action_key", actionKey)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return;

  const payload = {
    target_email: options.targetEmail,
    subject: options.subject || "",
    original_message_id: options.messageDbId,
    provider_message_id: options.providerMessageId,
    category_key: options.category,
    reason: options.classification.reason,
    confidence: options.classification.confidence,
    source: options.classification.source,
    from: options.fromRaw,
  };
  await supabase.from("thread_actions").insert({
    user_id: options.mailbox.user_id,
    workspace_id: options.mailbox.workspace_id,
    thread_id: options.threadId,
    action_type: "forward_email",
    action_key: actionKey,
    status: "pending",
    detail: `Forward this ${options.category} email to ${options.targetEmail}.`,
    payload,
    source: "routing",
    created_at: nowIso,
    updated_at: nowIso,
    error: null,
  });
}

async function runAutoForwardAction(options: {
  threadId: string;
  mailbox: MailboxLookup;
  targetEmail: string;
  messageDbId: string | null;
  providerMessageId: string;
  subject: string;
  fromRaw: string;
  textBody: string;
  category: RoutingCategory;
  classification: RoutingClassification;
}) {
  if (!supabase) return;
  const actionKey = buildForwardActionKey(options.messageDbId, options.targetEmail);
  const nowIso = new Date().toISOString();
  const actionPayload = {
    target_email: options.targetEmail,
    subject: options.subject || "",
    original_message_id: options.messageDbId,
    provider_message_id: options.providerMessageId,
    category_key: options.category,
    reason: options.classification.reason,
    confidence: options.classification.confidence,
    source: options.classification.source,
    from: options.fromRaw,
  } as Record<string, unknown>;
  const workspaceTest = await loadWorkspaceTestSettings(options.mailbox.workspace_id);
  const effectiveTarget =
    workspaceTest.testMode && workspaceTest.testEmail
      ? workspaceTest.testEmail
      : options.targetEmail;

  if (workspaceTest.testMode && !workspaceTest.testEmail) {
    await supabase.from("thread_actions").insert({
      user_id: options.mailbox.user_id,
      workspace_id: options.mailbox.workspace_id,
      thread_id: options.threadId,
      action_type: "forward_email",
      action_key: actionKey,
      status: "approved_test_mode",
      detail: "Forwarding simulated in Test Mode; no test email configured.",
      payload: { ...actionPayload, simulated: true, test_mode: true },
      source: "routing",
      created_at: nowIso,
      updated_at: nowIso,
      decided_at: nowIso,
      error: "Forwarding simulated in Test Mode; no test email configured.",
    });
    return;
  }

  try {
    const providerMessageId = await sendForwardedEmail({
      mailbox: options.mailbox,
      to: effectiveTarget,
      originalSubject: options.subject,
      originalFrom: options.fromRaw,
      originalBodyText: options.textBody,
    });
    await supabase.from("thread_actions").insert({
      user_id: options.mailbox.user_id,
      workspace_id: options.mailbox.workspace_id,
      thread_id: options.threadId,
      action_type: "forward_email",
      action_key: actionKey,
      status: workspaceTest.testMode ? "approved_test_mode" : "applied",
      detail: workspaceTest.testMode
        ? `Forwarded to ${effectiveTarget} (Test Mode).`
        : `Auto-forwarded to ${effectiveTarget}.`,
      payload: {
        ...actionPayload,
        sent_message_id: providerMessageId,
        target_email_effective: effectiveTarget,
        ...(workspaceTest.testMode ? { simulated: true, test_mode: true } : {}),
      },
      source: "routing",
      created_at: nowIso,
      updated_at: nowIso,
      decided_at: nowIso,
      applied_at: workspaceTest.testMode ? null : nowIso,
      error: null,
    });
  } catch (error) {
    await supabase.from("thread_actions").insert({
      user_id: options.mailbox.user_id,
      workspace_id: options.mailbox.workspace_id,
      thread_id: options.threadId,
      action_type: "forward_email",
      action_key: actionKey,
      status: "failed",
      detail: `Auto-forward failed for ${options.targetEmail}.`,
      payload: actionPayload,
      source: "routing",
      created_at: nowIso,
      updated_at: nowIso,
      decided_at: nowIso,
      error: (error as Error).message || "Forwarding failed.",
    });
  }
}

async function maybeSendAutoReply(options: {
  mailbox: MailboxLookup;
  threadId: string;
  inboundMessageId: string | null;
  fromEmail: string | null;
  fromName: string | null;
  subject: string;
  headers: PostmarkHeader[];
}): Promise<{ sent: boolean; providerMessageId: string | null }> {
  if (!supabase) return { sent: false, providerMessageId: null };
  if (!options.inboundMessageId || !options.fromEmail) return { sent: false, providerMessageId: null };
  if (isLikelyAutoSender(options.fromEmail, options.headers)) return { sent: false, providerMessageId: null };

  const setting = await loadAutoReplySettings(options.mailbox);
  if (!setting?.enabled) return { sent: false, providerMessageId: null };
  const workspaceTest = await loadWorkspaceTestSettings(options.mailbox.workspace_id);

  if (setting.trigger_mode === "first_inbound_per_thread") {
    const { count } = await supabase
      .from("mail_messages")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", options.threadId)
      .eq("from_me", false);
    if (Number(count || 0) > 1) return { sent: false, providerMessageId: null };
  }

  const recipient = String(options.fromEmail || "").trim().toLowerCase();
  const effectiveRecipient =
    workspaceTest.testMode && workspaceTest.testEmail
      ? workspaceTest.testEmail
      : recipient;
  if (workspaceTest.testMode && !workspaceTest.testEmail) {
    await supabase.from("agent_logs").insert({
      draft_id: null,
      step_name: "email_simulated_test_mode",
      step_detail: JSON.stringify({
        thread_id: options.threadId,
        mailbox_id: options.mailbox.mailbox_id,
        reason: "test_mode_enabled_without_test_email",
        intended_recipient: recipient,
      }),
      status: "info",
      created_at: new Date().toISOString(),
    });
    return { sent: false, providerMessageId: null };
  }
  const { data: previousEvents } = await supabase
    .from("mail_auto_reply_events")
    .select("sent_at")
    .eq("rule_id", setting.id)
    .eq("thread_id", options.threadId)
    .eq("recipient_email", recipient)
    .order("sent_at", { ascending: false })
    .limit(1);
  const lastSentAt = asString(previousEvents?.[0]?.sent_at);
  if (lastSentAt) {
    const elapsedMinutes = (Date.now() - new Date(lastSentAt).getTime()) / 60000;
    if (Number.isFinite(elapsedMinutes) && elapsedMinutes < setting.cooldown_minutes) {
      return { sent: false, providerMessageId: null };
    }
  }

  const customerFirstName = firstName(options.fromName || options.fromEmail);
  const tokenValues = {
    customer_name: asString(options.fromName),
    customer_first_name: customerFirstName || "der",
    team_name: asString(options.mailbox.from_name) || POSTMARK_FROM_NAME,
    subject: asString(options.subject),
  };
  const renderedSubject = fillTemplateTokens(setting.subject_template, tokenValues);
  const renderedText = fillTemplateTokens(setting.body_text_template, tokenValues);
  const renderedBodyHtml =
    fillTemplateTokens(setting.body_html_template || "", tokenValues) ||
    `<p style="white-space:pre-wrap">${renderedText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
  const templateHtml = await loadAutoReplyTemplateHtml(options.mailbox, setting.template_id);
  const mergedHtml = templateHtml.includes("{{content}}")
    ? templateHtml.replace("{{content}}", renderedBodyHtml)
    : `${templateHtml}\n${renderedBodyHtml}`;
  const outgoingFrom = asString(options.mailbox.provider_email) || POSTMARK_FROM_EMAIL;
  const outgoingName = asString(options.mailbox.from_name) || POSTMARK_FROM_NAME;
  const providerMessageId = await sendPostmarkAutoReply({
    from: outgoingFrom,
    fromName: outgoingName,
    to: effectiveRecipient,
    subject: renderedSubject,
    textBody: toPlainText(renderedText),
    htmlBody: mergedHtml,
    replyTo: options.mailbox.provider_email,
  });
  if (!providerMessageId) return { sent: false, providerMessageId: null };

  const nowIso = new Date().toISOString();
  await supabase.from("mail_messages").insert({
    user_id: options.mailbox.user_id,
    workspace_id: options.mailbox.workspace_id,
    mailbox_id: options.mailbox.mailbox_id,
    thread_id: options.threadId,
    provider: "smtp",
    provider_message_id: providerMessageId,
    subject: renderedSubject,
    snippet: toPlainText(renderedText).slice(0, 240),
    body_text: renderedText,
    body_html: mergedHtml,
    clean_body_text: renderedText,
    clean_body_html: mergedHtml,
    quoted_body_text: null,
    quoted_body_html: null,
    from_name: outgoingName,
    from_email: outgoingFrom,
    to_emails: [effectiveRecipient],
    cc_emails: [],
    bcc_emails: [],
    from_me: true,
    is_read: true,
    sent_at: nowIso,
    received_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  });
  await supabase.from("mail_auto_reply_events").insert({
    user_id: options.mailbox.user_id,
    workspace_id: options.mailbox.workspace_id,
    mailbox_id: options.mailbox.mailbox_id,
    thread_id: options.threadId,
    inbound_message_id: options.inboundMessageId,
    rule_id: setting.id,
    provider: "smtp",
    recipient_email: effectiveRecipient,
    sent_message_id: providerMessageId,
    sent_at: nowIso,
    created_at: nowIso,
  });
  if (workspaceTest.testMode && workspaceTest.testEmail) {
    await supabase.from("agent_logs").insert({
      draft_id: null,
      step_name: "email_simulated_test_mode",
      step_detail: JSON.stringify({
        thread_id: options.threadId,
        mailbox_id: options.mailbox.mailbox_id,
        intended_recipient: recipient,
        redirected_to: workspaceTest.testEmail,
      }),
      status: "info",
      created_at: new Date().toISOString(),
    });
  }

  return { sent: true, providerMessageId };
}

async function logAgent(step: string, detail: Record<string, unknown>, status: string) {
  if (!supabase) return;
  await supabase.from("agent_logs").insert({
    draft_id: null,
    step_name: step,
    step_detail: JSON.stringify(detail),
    status,
    created_at: new Date().toISOString(),
  });
}

async function findThreadByReplyMessage(
  mailboxId: string,
  providerMessageId: string,
): Promise<string | null> {
  if (!supabase || !providerMessageId) return null;
  const { data } = await supabase
    .from("mail_messages")
    .select("thread_id")
    .eq("mailbox_id", mailboxId)
    .eq("provider", "smtp")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  return (data as any)?.thread_id ?? null;
}

async function resolveShopId(options: {
  ownerUserId: string | null;
  workspaceId: string | null;
}): Promise<string | null> {
  if (!supabase) return null;
  const { ownerUserId, workspaceId } = options;

  if (workspaceId) {
    const { data, error } = await supabase
      .from("shops")
      .select("id")
      .eq("workspace_id", workspaceId)
      .is("uninstalled_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data?.id) return data.id as string;
    if (error) {
      console.warn("postmark-inbound: failed to resolve workspace shop id", error.message);
    }
  }

  if (!ownerUserId) return null;
  const { data, error } = await supabase
    .from("shops")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("postmark-inbound: failed to resolve user shop id", error.message);
  }
  return (data as any)?.id ?? null;
}

async function isAutoDraftEnabled(options: {
  userId: string | null;
  workspaceId: string | null;
}): Promise<boolean> {
  if (!supabase) return false;
  const { userId, workspaceId } = options;

  if (workspaceId) {
    const { data, error } = await supabase
      .from("agent_automation")
      .select("auto_draft_enabled")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) return Boolean((data as any)?.auto_draft_enabled);
    if (error) {
      console.warn("postmark-inbound: failed to fetch workspace automation", error.message);
    }
  }

  if (!userId) return false;
  const { data, error } = await supabase
    .from("agent_automation")
    .select("auto_draft_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("postmark-inbound: failed to fetch user automation", error.message);
  }
  return Boolean((data as any)?.auto_draft_enabled);
}

async function triggerDraftForInbound(params: {
  shopId: string;
  messageId: string;
  threadId: string;
  subject: string;
  fromRaw: string;
  fromEmail: string | null;
  fromName: string | null;
  body: string;
  headers: PostmarkHeader[];
}) {
  if (!PROJECT_URL) throw new Error("PROJECT_URL mangler");
  const endpoint = `${PROJECT_URL.replace(/\/$/, "")}/functions/v1/generate-draft-unified`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(INTERNAL_AGENT_SECRET ? { "x-internal-secret": INTERNAL_AGENT_SECRET } : {}),
      ...(SERVICE_ROLE_KEY ? { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } : {}),
    },
    body: JSON.stringify({
      shop_id: params.shopId,
      provider: "smtp",
      access_token: "",
      email_data: {
        messageId: params.messageId,
        threadId: params.threadId,
        subject: params.subject,
        from: params.fromName && params.fromEmail ? `${params.fromName} <${params.fromEmail}>` : params.fromRaw,
        fromEmail: params.fromEmail ?? "",
        body: params.body,
        headers: params.headers.map((header) => ({
          name: header?.Name ?? "",
          value: header?.Value ?? "",
        })),
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`generate-draft-unified fejlede ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function ensureDraftLog(params: {
  threadId: string;
  shopId: string | null;
  workspaceId: string | null;
  subject: string;
  customerEmail: string | null;
  draftMessageId: string | null;
}) {
  if (!supabase) return null;
  let existingQuery = supabase
    .from("drafts")
    .select("id")
    .eq("thread_id", params.threadId)
    .eq("platform", "smtp");
  existingQuery = params.workspaceId
    ? existingQuery.eq("workspace_id", params.workspaceId)
    : existingQuery.is("workspace_id", null);
  const { data: existing, error: lookupError } = await existingQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) {
    console.warn("postmark-inbound: failed to lookup drafts", lookupError.message);
  } else if (existing?.id) {
    return existing.id;
  }

  const { data, error } = await supabase
    .from("drafts")
    .insert({
      shop_id: params.shopId,
      workspace_id: params.workspaceId,
      customer_email: params.customerEmail,
      subject: params.subject,
      platform: "smtp",
      status: "pending",
      draft_id: params.draftMessageId,
      thread_id: params.threadId,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.warn("postmark-inbound: failed to insert draft log", error.message);
    return null;
  }
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  if (!isAuthorized(req)) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  if (!supabase) {
    return jsonResponse(500, { error: "Supabase client not configured" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON" });
  }

  const rawMessageId = String(payload?.MessageID ?? payload?.MessageId ?? "").trim();
  const messageId = normalizeMessageId(rawMessageId);
  if (!messageId) {
    return jsonResponse(400, { error: "Missing MessageID" });
  }

  const subject = String(payload?.Subject ?? "").trim();
  const fromRaw = String(payload?.From ?? "").trim();
  const fromEmail = extractEmail(fromRaw);
  const fromName = extractName(fromRaw);

  const headers = Array.isArray(payload?.Headers)
    ? (payload.Headers as PostmarkHeader[])
    : [];

  const toList = normalizeEmailList(payload?.To);
  const ccList = normalizeEmailList(payload?.Cc);
  const bccList = normalizeEmailList(payload?.Bcc);
  const recipientCandidates = collectRecipientCandidates(payload, headers);
  const inboundRecipient = getInboundRecipient(recipientCandidates);
  const slug = parseSlugFromAddress(inboundRecipient);
  if (!slug) {
    await logAgent(
      "postmark_inbound_received",
      { messageId, subject, to: toList, candidates: recipientCandidates.slice(0, 8) },
      "error",
    );
    return jsonResponse(404, { error: "Inbound mailbox not found" });
  }

  let mailbox: MailboxLookup | null = null;
  try {
    mailbox = await lookupMailbox(slug);
  } catch (err) {
    await logAgent("postmark_inbound_received", { messageId, slug }, "error");
    return jsonResponse(500, { error: (err as Error).message });
  }

  if (!mailbox) {
    await logAgent("postmark_inbound_received", { messageId, slug }, "error");
    return jsonResponse(404, { error: "Mailbox lookup failed" });
  }

  const receivedAtRaw =
    (payload?.ReceivedAt as string | undefined) ??
    (payload?.Date as string | undefined) ??
    null;
  const receivedAt = receivedAtRaw ? new Date(receivedAtRaw).toISOString() : null;

  const htmlBody = String(payload?.HtmlBody ?? "").trim();
  const textBodyRaw = String(payload?.TextBody ?? "").trim();
  const textBody = textBodyRaw || (htmlBody ? stripHtml(htmlBody) : "");
  const parsedBodies = parseEmailReplyBodies({ text: textBody, html: htmlBody });
  const replyToEmail =
    extractEmail(findHeader(headers, "Reply-To") || "") || extractEmail(asString(payload?.ReplyTo));
  const shopifyContact = parseShopifyContactIdentity({
    fromEmail,
    fromName,
    replyToEmail,
    subject,
    bodyText: parsedBodies.cleanBodyText || textBody,
  });
  if (shopifyContact.detected) {
    console.log("postmark-inbound: detected Shopify contact form", {
      storedMessageId: messageId,
      extractedCustomerEmail: shopifyContact.customerEmail,
      extractedCustomerName: shopifyContact.customerName,
      reasons: shopifyContact.reasons,
    });
  } else if ((fromEmail || replyToEmail || "").toLowerCase().includes("shopify.com")) {
    console.log("postmark-inbound: Shopify sender fallback", {
      storedMessageId: messageId,
      fromEmail,
      replyToEmail,
    });
  }
  const snippet = buildSnippet(parsedBodies.cleanBodyText || textBody);
  const shouldSkipAsSpam =
    !IGNORE_SPAM_FILTER &&
    shouldSkipInboxMessage({
      from: fromRaw,
      subject,
      snippet,
      body: textBody,
      headers: headers.map((header) => ({
        name: header?.Name ?? "",
        value: header?.Value ?? "",
      })),
    });

  const inReplyTo = normalizeMessageId(findHeader(headers, "In-Reply-To"));
  const messageIdHeader =
    normalizeMessageId(findHeader(headers, "Message-ID")) ??
    normalizeMessageId(findHeader(headers, "Message-Id"));
  const storedMessageId = messageIdHeader || messageId;
  const referencesRaw = findHeader(headers, "References");
  const referenceIds = [
    inReplyTo,
    ...(referencesRaw ? referencesRaw.split(/\s+/g) : []),
  ]
    .map((value) => normalizeMessageId(value))
    .filter(Boolean) as string[];
  await logAgent(
    "postmark_inbound_diagnostics",
    {
      raw_subject: subject,
      normalized_subject: normalizeSubjectForDiagnostics(subject),
      sender: fromEmail || fromRaw || null,
      message_id: storedMessageId || null,
      in_reply_to: inReplyTo || null,
      references: referenceIds,
      parser_strategy: parsedBodies.parserStrategy,
      quoted_history_detected: parsedBodies.quotedHistoryDetected,
      clean_body_extraction_succeeded: parsedBodies.cleanExtractionSucceeded,
      matched_boundary_line: parsedBodies.matchedBoundaryLine,
      clean_body_preview: parsedBodies.cleanBodyPreview,
    },
    "info",
  );

  const { data: existingMessage } = await supabase
    .from("mail_messages")
    .select("id, thread_id")
    .eq("provider", "smtp")
    .eq("provider_message_id", storedMessageId)
    .maybeSingle();
  if (existingMessage?.id) {
    return jsonResponse(200, {
      ok: true,
      thread_id: existingMessage.thread_id,
      message_id: existingMessage.id,
      duplicate: true,
    });
  }

  if (shouldSkipAsSpam) {
    await logAgent(
      "postmark_inbound_skipped",
      { messageId: storedMessageId, slug, reason: "spam_filter", from: fromRaw, subject },
      "info",
    );
    return jsonResponse(200, {
      ok: true,
      skipped: true,
      reason: "spam_filter",
    });
  }

  let routingClassification: RoutingClassification = {
    category: "support",
    confidence: 0.4,
    reason: "fallback_default",
    source: "fallback",
    subject,
    excerpt: textBody.slice(0, 700),
  };
  let workspaceRoutes: WorkspaceEmailRoute[] = [];
  try {
    workspaceRoutes = await ensureWorkspaceRoutes(mailbox.workspace_id);
  } catch (error) {
    console.warn("postmark-inbound: failed to load email routes", (error as Error)?.message || error);
    workspaceRoutes = [];
  }
  const activeRoutingCategories: RoutingTargetCategory[] = workspaceRoutes
    .filter((route) => route.is_active)
    .map((route) => ({
      key: route.category_key,
      label: route.label || route.category_key,
    }));

  if (activeRoutingCategories.length > 0) {
    try {
      routingClassification = await classifyInboundRouting(
        {
          subject,
          body: textBody,
        },
        { activeCategories: activeRoutingCategories },
      );
    } catch (error) {
      console.warn(
        "postmark-inbound: routing classification failed",
        (error as Error)?.message || error,
      );
      routingClassification = {
        category: "support",
        confidence: 0.35,
        reason: "fallback:classifier_error",
        source: "fallback",
        subject,
        excerpt: textBody.slice(0, 420),
      };
    }
  } else {
    routingClassification = {
      category: "support",
      confidence: 1,
      reason: "fallback:no_active_categories",
      source: "fallback",
      subject,
      excerpt: textBody.slice(0, 420),
    };
  }

  const routeDecision = decideRouteForClassification(routingClassification, workspaceRoutes);
  const inboxClassification = classifyInboxBucket({
    from: fromRaw,
    subject,
    body: textBody,
    headers: headers.map((header) => ({
      name: header?.Name ?? "",
      value: header?.Value ?? "",
    })),
  });
  let inboundCategory: EmailCategory = "General";
  if (routeDecision.isEffectiveSupport && inboxClassification.bucket !== "notification") {
    try {
      inboundCategory = await categorizeEmail({
        subject,
        body: textBody,
        from: fromEmail || fromRaw || "",
      });
    } catch (error) {
      console.warn(
        "postmark-inbound: category classification failed",
        (error as Error)?.message || error,
      );
      inboundCategory = "General";
    }
  }

  let threadId: string | null = null;
  for (const ref of referenceIds) {
    if (!ref) continue;
    const match = await findThreadByReplyMessage(mailbox.mailbox_id, ref);
    if (match) {
      threadId = match;
      break;
    }
  }

  let createdNewThread = false;
  if (!threadId) {
    const { data: threadInsert, error: threadError } = await supabase
      .from("mail_threads")
      .insert({
        user_id: mailbox.user_id,
        workspace_id: mailbox.workspace_id,
        mailbox_id: mailbox.mailbox_id,
        provider: "smtp",
        provider_thread_id: null,
        subject,
        snippet,
        customer_name: shopifyContact.customerName || fromName || null,
        customer_email: (shopifyContact.customerEmail || fromEmail || "").toLowerCase() || null,
        customer_last_inbound_at: receivedAt,
        last_message_at: receivedAt,
        unread_count: 1,
        is_read: false,
        status: "new",
        priority: "normal",
        tags: buildThreadTags([], inboundCategory),
        classification_key:
          inboxClassification.bucket === "notification"
            ? "notification"
            : normalizeRouteCategory(routingClassification.category),
        classification_confidence:
          inboxClassification.bucket === "notification"
            ? Math.min(1, Math.max(0.8, inboxClassification.score / 8))
            : routingClassification.confidence,
        classification_reason:
          inboxClassification.bucket === "notification"
            ? inboxClassification.reason
            : routingClassification.reason,
        updated_at: new Date().toISOString(),
      })
      .select("id, subject, unread_count")
      .maybeSingle();
    if (threadError) {
      await logAgent(
        "postmark_inbound_received",
        { messageId, slug, error: threadError.message },
        "error",
      );
      return jsonResponse(500, { error: threadError.message });
    }
    threadId = (threadInsert as any)?.id ?? null;
    createdNewThread = true;
  }

  if (!threadId) {
    await logAgent("postmark_inbound_received", { messageId, slug }, "error");
    return jsonResponse(500, { error: "Thread creation failed" });
  }

  const { data: messageInsert, error: messageError } = await supabase
    .from("mail_messages")
    .insert({
      user_id: mailbox.user_id,
      workspace_id: mailbox.workspace_id,
      mailbox_id: mailbox.mailbox_id,
      thread_id: threadId,
      provider: "smtp",
      provider_message_id: storedMessageId,
      subject,
      snippet,
      body_text: textBody,
      body_html: htmlBody,
      clean_body_text: parsedBodies.cleanBodyText || textBody,
      clean_body_html: parsedBodies.cleanBodyHtml,
      quoted_body_text: parsedBodies.quotedBodyText,
      quoted_body_html: parsedBodies.quotedBodyHtml,
      from_name: fromName,
      from_email: fromEmail,
      extracted_customer_name: shopifyContact.customerName,
      extracted_customer_email: shopifyContact.customerEmail,
      extracted_customer_fields:
        shopifyContact.detected && Object.keys(shopifyContact.fields).length
          ? shopifyContact.fields
          : null,
      sender_identity_source: shopifyContact.detected ? "shopify_contact_form" : null,
      to_emails: toList,
      cc_emails: ccList,
      bcc_emails: bccList,
      is_read: false,
      received_at: receivedAt,
      sent_at: receivedAt,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (messageError) {
    await logAgent(
      "postmark_inbound_received",
      { messageId, slug, error: messageError.message },
      "error",
    );
    return jsonResponse(500, { error: messageError.message });
  }

  const messageDbId = (messageInsert as any)?.id ?? null;

  // Clear stale AI drafts when a new customer message arrives on an existing thread.
  // This ensures agents never see an outdated draft that was generated for a previous message.
  if (!createdNewThread && threadId) {
    await supabase
      .from("mail_messages")
      .delete()
      .eq("thread_id", threadId)
      .eq("is_draft", true)
      .eq("from_me", true);
    await supabase
      .from("mail_messages")
      .update({ ai_draft_text: null, updated_at: new Date().toISOString() })
      .eq("thread_id", threadId)
      .not("ai_draft_text", "is", null);
  }

  const { data: existingThread } = await supabase
    .from("mail_threads")
    .select("subject, unread_count, tags, classification_key, classification_confidence, classification_reason, customer_name, customer_email")
    .eq("id", threadId)
    .maybeSingle();
  const currentUnread = Number(existingThread?.unread_count ?? 0);
  const nextUnreadCount = createdNewThread ? 1 : Math.max(0, currentUnread + 1);
  const existingCategory = splitThreadTags(existingThread?.tags).category;
  const shouldUpdateCategory = !existingCategory || (existingCategory === "General" && inboundCategory !== "General");
  const updatePayload: Record<string, unknown> = {
    last_message_at: receivedAt,
    snippet,
    subject: existingThread?.subject ? existingThread.subject : subject,
    unread_count: nextUnreadCount,
    is_read: false,
    customer_name: shopifyContact.customerName || fromName || existingThread?.customer_name || null,
    customer_email:
      (shopifyContact.customerEmail || fromEmail || existingThread?.customer_email || "").toLowerCase() ||
      null,
    customer_last_inbound_at: receivedAt,
    classification_key:
      inboxClassification.bucket === "notification"
        ? "notification"
        : normalizeRouteCategory(routingClassification.category),
    classification_confidence:
      inboxClassification.bucket === "notification"
        ? Math.min(1, Math.max(0.8, inboxClassification.score / 8))
        : routingClassification.confidence,
    classification_reason:
      inboxClassification.bucket === "notification"
        ? inboxClassification.reason
        : routingClassification.reason,
    updated_at: new Date().toISOString(),
  };
  if (!createdNewThread) {
    // Re-open existing threads when a new inbound customer message arrives.
    updatePayload.status = "open";
  }
  if (shouldUpdateCategory) {
    updatePayload.tags = buildThreadTags(existingThread?.tags, inboundCategory);
  }
  await supabase
    .from("mail_threads")
    .update(updatePayload)
    .eq("id", threadId);

  // Detect and store customer language (fire-and-forget, non-blocking)
  if (createdNewThread) {
    const textToDetect = parsedBodies.cleanBodyText || textBody;
    if (textToDetect) {
      detectCustomerLanguage(textToDetect, OPENAI_API_KEY).then((lang) => {
        if (lang !== "unknown") {
          supabase
            .from("mail_threads")
            .update({ customer_language: lang })
            .eq("id", threadId)
            .then(() => null)
            .catch(() => null);
        }
      }).catch(() => null);
    }
  }

  if (messageDbId) {
    const attachments = Array.isArray(payload?.Attachments)
      ? (payload.Attachments as PostmarkAttachment[])
      : [];
    if (attachments.length) {
      const sanitizeBase64 = (value: unknown): string | null => {
        const raw = String(value || "").trim();
        if (!raw) return null;
        const withoutPrefix = raw.includes(",") && /^data:[^,]+,/.test(raw)
          ? raw.slice(raw.indexOf(",") + 1)
          : raw;
        let normalized = withoutPrefix.replace(/\s+/g, "").trim();
        if (!normalized) return null;
        // Accept URL-safe base64 variants used by some providers.
        normalized = normalized.replace(/-/g, "+").replace(/_/g, "/");
        const remainder = normalized.length % 4;
        if (remainder) normalized = normalized.padEnd(normalized.length + (4 - remainder), "=");
        return /^[A-Za-z0-9+/=]+$/.test(normalized) ? normalized : null;
      };
      const rows = attachments.map((att) => ({
        user_id: mailbox!.user_id,
        mailbox_id: mailbox!.mailbox_id,
        message_id: messageDbId,
        provider: "postmark",
        provider_attachment_id: att?.ContentID ?? null,
        filename: att?.Name ?? null,
        mime_type: att?.ContentType ?? null,
        size_bytes: att?.ContentLength ?? null,
        storage_path: (() => {
          const content = sanitizeBase64(att?.Content);
          const mimeType = String(att?.ContentType || "application/octet-stream").trim();
          return content ? `inline:${mimeType};base64,${content}` : null;
        })(),
        created_at: new Date().toISOString(),
      }));
      const { error: attachmentInsertError } = await supabase.from("mail_attachments").insert(rows);
      if (attachmentInsertError) {
        console.error("postmark-inbound: attachment insert fejlede", attachmentInsertError.message, { messageDbId, count: rows.length });
      }
    }
  }

  await logAgent(
    "postmark_inbound_received",
    {
      messageId: storedMessageId,
      slug,
      subject,
      from: fromRaw,
      to: toList,
      routing_category: routingClassification.category,
      routing_confidence: routingClassification.confidence,
      routing_source: routingClassification.source,
      route_mode: routeDecision.mode,
      route_target: routeDecision.forwardToEmail,
    },
    "success",
  );

  if (!routeDecision.isEffectiveSupport) {
    if (routeDecision.shouldCreateApprovalAction && routeDecision.forwardToEmail) {
      await createPendingForwardAction({
        threadId,
        mailbox,
        targetEmail: routeDecision.forwardToEmail,
        messageDbId,
        providerMessageId: storedMessageId,
        subject,
        fromRaw,
        category: routeDecision.category,
        classification: routingClassification,
      });
      await logAgent(
        "postmark_inbound_forward_pending",
        {
          messageId: storedMessageId,
          threadId,
          category: routeDecision.category,
          target: routeDecision.forwardToEmail,
        },
        "info",
      );
    }
    if (routeDecision.shouldAutoForward && routeDecision.forwardToEmail) {
      await runAutoForwardAction({
        threadId,
        mailbox,
        targetEmail: routeDecision.forwardToEmail,
        messageDbId,
        providerMessageId: storedMessageId,
        subject,
        fromRaw,
        textBody,
        category: routeDecision.category,
        classification: routingClassification,
      });
      await logAgent(
        "postmark_inbound_auto_forward_attempted",
        {
          messageId: storedMessageId,
          threadId,
          category: routeDecision.category,
          target: routeDecision.forwardToEmail,
        },
        "info",
      );
    }
  }

  try {
    const autoReplyResult = await maybeSendAutoReply({
      mailbox,
      threadId,
      inboundMessageId: messageDbId,
      fromEmail: shopifyContact.customerEmail || fromEmail,
      fromName: shopifyContact.customerName || fromName,
      subject,
      headers,
    });
    if (autoReplyResult.sent) {
      await logAgent(
        "postmark_inbound_auto_reply_sent",
        {
          messageId: storedMessageId,
          threadId,
          recipient: shopifyContact.customerEmail || fromEmail,
          sentMessageId: autoReplyResult.providerMessageId,
        },
        "success",
      );
    }
  } catch (error) {
    await logAgent(
      "postmark_inbound_auto_reply_failed",
      { messageId: storedMessageId, threadId, error: (error as Error).message },
      "error",
    );
  }

  try {
    const autoDraftEnabled = await isAutoDraftEnabled({
      userId: mailbox.user_id,
      workspaceId: mailbox.workspace_id,
    });
    if (autoDraftEnabled && routeDecision.isEffectiveSupport) {
      const shopId = mailbox.shop_id;
      if (shopId) {
        const draftOutcome = await triggerDraftForInbound({
          shopId,
          messageId: storedMessageId,
          threadId,
          subject,
          fromRaw,
          fromEmail: shopifyContact.customerEmail || fromEmail,
          fromName: shopifyContact.customerName || fromName,
          body: textBody,
          headers,
        });
        const draftId = await ensureDraftLog({
          threadId,
          shopId,
          workspaceId: mailbox.workspace_id,
          subject,
          customerEmail: shopifyContact.customerEmail || fromEmail,
          draftMessageId: draftOutcome?.draftId ? String(draftOutcome.draftId) : null,
        });
        await supabase.from("agent_logs").insert({
          draft_id: draftId ?? null,
          step_name: "draft_created",
          step_detail: `Email draft created.|thread_id:${threadId}`,
          status: "success",
          created_at: new Date().toISOString(),
        });
      }
    }
  } catch (error) {
    await logAgent(
      "postmark_inbound_draft_failed",
      { messageId, slug, error: (error as Error).message },
      "error",
    );
  }

  return jsonResponse(200, {
    ok: true,
    thread_id: threadId,
    message_id: messageDbId,
  });
});
