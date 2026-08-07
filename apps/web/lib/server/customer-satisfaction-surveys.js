import crypto from "crypto";

import { getReplyTargetEmail, normalizeEmailAddress } from "../inbox/sender.js";
import { normalizeSupportLanguage } from "../translation/languages.js";
import { getCustomerSatisfactionLanguageCopy, localizeCustomerSatisfactionValue } from "../csat/language-copy.js";
import { loadCustomerSatisfactionSettings } from "./customer-satisfaction.js";
import { sendPostmarkEmail } from "./postmark.js";
import { buildEffectiveSharedFromEmail } from "./sending-identity.js";

const SOLVED_STATUSES = new Set(["resolved", "solved", "closed"]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MINUTES = 15;

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getTokenSecret() {
  const secret =
    process.env.CSAT_TOKEN_SECRET ||
    process.env.ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    "";
  if (!secret) throw new Error("CSAT token secret is missing.");
  return secret;
}

export function deriveCustomerSatisfactionToken(workspaceId, threadId) {
  return crypto
    .createHmac("sha256", getTokenSecret())
    .update(`${String(workspaceId)}:${String(threadId)}`)
    .digest("hex");
}

export function hashCustomerSatisfactionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function buildCustomerSatisfactionUrl(token, origin = "") {
  const base =
    asString(origin).replace(/\/$/, "") ||
    asString(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.WEB_APP_URL).replace(/\/$/, "");
  if (!base) throw new Error("Public app URL is missing for CSAT links.");
  return `${base}/csat/${encodeURIComponent(String(token))}`;
}

export function scheduledCustomerSatisfactionAt(resolvedAt, delay, customDelayMinutes = null) {
  const base = Date.parse(resolvedAt || "") || Date.now();
  const delayMs = delay === "immediately"
    ? 0
    : delay === "custom"
      ? Math.max(5, Math.min(7 * 24 * 60, Number(customDelayMinutes) || 60)) * 60 * 1000
      : delay === "24h"
        ? 24 * 60 * 60 * 1000
        : 60 * 60 * 1000;
  return new Date(base + delayMs).toISOString();
}

function isCustomerEmail(email) {
  const normalized = normalizeEmailAddress(email);
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return false;
  const localPart = normalized.split("@")[0];
  return !/^(no-?reply|donotreply|mailer-daemon|postmaster|notifications?)([+._-]|$)/i.test(localPart);
}

async function loadRecipient(serviceClient, thread) {
  const direct = normalizeEmailAddress(thread?.customer_email);
  if (isCustomerEmail(direct)) return direct;

  const { data: message, error } = await serviceClient
    .from("mail_messages")
    .select("from_email, extracted_customer_email")
    .eq("thread_id", thread.id)
    .eq("from_me", false)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const fallback = getReplyTargetEmail(message);
  return isCustomerEmail(fallback) ? normalizeEmailAddress(fallback) : "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function replaceTemplate(value, tokens) {
  return String(value || "").replace(/{{\s*([a-z_]+)\s*}}/gi, (_match, key) => tokens[key] ?? "");
}

function buildFromDisplay(name, email) {
  const safeName = String(name || "").replace(/[\r\n<>]/g, "").trim();
  return safeName ? `${safeName} <${email}>` : email;
}

export function buildSurveyEmail({ settings, surveyUrl, customerName, subject, language = "en" }) {
  const normalizedLanguage = normalizeSupportLanguage(language);
  const languageCopy = getCustomerSatisfactionLanguageCopy(normalizedLanguage);
  const tokens = {
    customer_first_name: customerName || "there",
    ticket_subject: subject || "your support request",
    team_name: settings.company || "your support team",
  };
  const renderedSubject = (replaceTemplate(localizeCustomerSatisfactionValue(settings.subject, "subject", normalizedLanguage), tokens) || languageCopy.subject)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 200);
  const optionalCopy = (value, key) => {
    const raw = String(value || "").trim();
    return raw ? replaceTemplate(localizeCustomerSatisfactionValue(raw, key, normalizedLanguage), tokens) : "";
  };
  const headline = optionalCopy(settings.headline, "headline");
  const intro = optionalCopy(settings.intro, "intro");
  const footer = optionalCopy(settings.footer, "footer");
  const accent = /^#[0-9a-f]{6}$/i.test(settings.accent || "") ? settings.accent : "#635bff";
  const logoPosition = ["top-center", "top-left", "footer"].includes(settings.logoPosition) ? settings.logoPosition : "top-center";
  const logoSize = {
    small: { maxWidth: 120, maxHeight: 36 },
    medium: { maxWidth: 160, maxHeight: 48 },
    large: { maxWidth: 220, maxHeight: 72 },
  }[settings.logoSize] || { maxWidth: 160, maxHeight: 48 };
  const companyName = String(settings.company || "").trim();
  const senderName = String(settings.senderName || "").trim();
  const logo = settings.logoUrl
    ? `<img src="${escapeHtml(settings.logoUrl)}" alt="${escapeHtml(companyName || "Company")} logo" style="display:block;max-width:${logoSize.maxWidth}px;max-height:${logoSize.maxHeight}px;margin:${logoPosition === "top-left" ? "0 0 24px" : "0 auto 24px"};object-fit:contain;">`
    : "";
  const topLogo = logoPosition === "footer" ? "" : logo;
  const footerLogo = logoPosition === "footer" && logo
    ? `<div style="margin-top:auto;padding-top:20px;">${logo.replace("margin:0 auto 24px", "margin:0 auto")}</div>`
    : "";
  const companyLine = companyName ? `<p style="margin:0 0 8px;color:#6b6b78;font-size:13px;font-weight:600;">${escapeHtml(companyName)}</p>` : "";
  const senderLine = senderName ? `<p style="margin:0 0 8px;color:#8b8b96;font-size:12px;">${escapeHtml(senderName)}</p>` : "";
  const headlineLine = headline ? `<h1 style="margin:0;font-size:28px;line-height:1.2;letter-spacing:-.03em;">${escapeHtml(headline)}</h1>` : "";
  const introLine = intro ? `<p style="margin:16px auto 28px;max-width:420px;color:#6b6b78;font-size:16px;line-height:1.6;">${escapeHtml(intro)}</p>` : "";
  const footerLine = footer ? `<p style="margin:14px 0 0;color:#8b8b96;font-size:11px;line-height:1.5;">${escapeHtml(footer)}</p>` : "";
  const ratingUrls = [1, 2, 3, 4, 5].map((score) => `${surveyUrl}${surveyUrl.includes("?") ? "&" : "?"}score=${score}&language=${normalizedLanguage}`);
  const ratingLinks = ratingUrls
    .map((ratingUrl, index) => {
      const score = index + 1;
      return `<a href="${escapeHtml(ratingUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${score} out of 5" style="display:inline-block;width:40px;height:40px;line-height:40px;margin:0 3px;border:1px solid #d8d8e0;border-radius:999px;color:#4b4b58;text-decoration:none;font-weight:600;text-align:center;">${score}</a>`;
    })
    .join("");
  const ratingLabels = `<table role="presentation" width="240" cellpadding="0" cellspacing="0" border="0" style="width:240px;max-width:100%;margin:8px auto 0;color:#8b8b96;font-size:12px;"><tr><td align="left" style="padding:0;text-align:left;">${escapeHtml(languageCopy.lowLabel)}</td><td align="right" style="padding:0;text-align:right;">${escapeHtml(languageCopy.highLabel)}</td></tr></table>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f7f7fa;color:#111118;font-family:Arial,Helvetica,sans-serif;"><div style="max-width:560px;margin:32px auto;padding:0 16px;"><div style="background:#ffffff;border:1px solid #e6e6ec;border-radius:18px;padding:40px 28px;text-align:center;box-shadow:0 8px 24px rgba(20,20,30,.06);min-height:440px;display:flex;flex-direction:column;">${topLogo}${companyLine}${senderLine}${headlineLine}${introLine}<div style="margin:0 auto 10px;">${ratingLinks}</div>${ratingLabels}<p style="margin:28px 0 0;color:#8b8b96;font-size:12px;line-height:1.5;">${escapeHtml(languageCopy.instruction)}</p>${footerLogo}${footerLine}</div></div></body></html>`;
  const textRatings = ratingUrls.map((ratingUrl, index) => `${index + 1}: ${ratingUrl}`).join("\n");
  const text = [headline, intro, `Rate your experience (1–5):\n${textRatings}`, footer].filter(Boolean).join("\n\n");
  return { subject: renderedSubject, html, text };
}

async function loadThread(serviceClient, threadId, workspaceId) {
  const { data, error } = await serviceClient
    .from("mail_threads")
    .select("id, workspace_id, mailbox_id, subject, status, resolution_source, customer_email, customer_language")
    .eq("id", threadId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function loadWorkspaceSupportLanguage(serviceClient, workspaceId) {
  const { data, error } = await serviceClient
    .from("workspaces")
    .select("support_language")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeSupportLanguage(data?.support_language || "en");
}

function resolveSurveyLanguage(settings, thread, workspaceLanguage) {
  if (settings.languageMode === "en") return "en";
  if (settings.languageMode === "workspace") return workspaceLanguage;
  return normalizeSupportLanguage(thread?.customer_language || workspaceLanguage);
}

export async function scheduleCustomerSatisfactionSurvey(
  serviceClient,
  { workspaceId, threadId, resolvedAt = new Date().toISOString() } = {},
) {
  if (!serviceClient || !workspaceId || !threadId) return { status: "invalid" };
  const settings = await loadCustomerSatisfactionSettings(serviceClient, workspaceId);
  if (!settings.enabled) return { status: "disabled" };

  const thread = await loadThread(serviceClient, threadId, workspaceId);
  if (!thread || !SOLVED_STATUSES.has(String(thread.status || "").toLowerCase())) {
    return { status: "not_resolved" };
  }

  const token = deriveCustomerSatisfactionToken(workspaceId, threadId);
  const tokenHash = hashCustomerSatisfactionToken(token);
  const scheduledFor = scheduledCustomerSatisfactionAt(resolvedAt, settings.delay, settings.delayMinutes);
  const { data: existing, error: existingError } = await serviceClient
    .from("csat_survey_requests")
    .select("id, status, scheduled_for, attempt_count")
    .eq("thread_id", threadId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing && ["sent", "responded", "skipped"].includes(existing.status)) {
    return { status: existing.status, id: existing.id, token };
  }

  const values = {
    workspace_id: workspaceId,
    thread_id: threadId,
    token_hash: tokenHash,
    status: "pending",
    scheduled_for: scheduledFor,
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  const query = existing
    ? serviceClient.from("csat_survey_requests").update(values).eq("id", existing.id).select("id").maybeSingle()
    : serviceClient.from("csat_survey_requests").insert(values).select("id").maybeSingle();
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { status: "pending", id: data?.id || existing?.id || null, token, scheduledFor };
}

async function loadMailboxAndShop(serviceClient, workspaceId, thread) {
  const { data: mailbox, error: mailboxError } = await serviceClient
    .from("mail_accounts")
    .select("id, provider, provider_email, status, shop_id, sending_type, sending_domain, domain_status, from_email, from_name, metadata")
    .eq("workspace_id", workspaceId)
    .not("status", "eq", "disconnected")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (mailboxError) throw new Error(mailboxError.message);

  const shop = mailbox?.shop_id
    ? (await serviceClient.from("shops").select("id, shop_name, shop_domain").eq("id", mailbox.shop_id).maybeSingle()).data
    : null;
  return { mailbox: mailbox || { shop_id: null }, shop, thread };
}

export async function sendCustomerSatisfactionSurvey(
  serviceClient,
  { requestRow, origin = "" } = {},
) {
  if (!requestRow?.workspace_id || !requestRow?.thread_id) throw new Error("CSAT request is incomplete.");
  const settings = await loadCustomerSatisfactionSettings(serviceClient, requestRow.workspace_id, { logoExpiresIn: 7 * 24 * 60 * 60 });
  if (!settings.enabled) return { status: "skipped", reason: "disabled" };
  const thread = await loadThread(serviceClient, requestRow.thread_id, requestRow.workspace_id);
  if (!thread) throw new Error("Ticket no longer exists.");
  if (!SOLVED_STATUSES.has(String(thread.status || "").toLowerCase())) {
    return { status: "deferred", reason: "ticket_not_resolved" };
  }
  const recipient = await loadRecipient(serviceClient, thread);
  if (!recipient) return { status: "skipped", reason: "no_customer_email" };
  if (!isCustomerEmail(recipient)) {
    return { status: "skipped", reason: "not_customer_email" };
  }

  const { mailbox, shop } = await loadMailboxAndShop(serviceClient, requestRow.workspace_id, thread);
  const fromEmail = buildEffectiveSharedFromEmail({ shop, mailbox });
  const fromName = settings.senderName || settings.company || "Support";
  const token = deriveCustomerSatisfactionToken(requestRow.workspace_id, requestRow.thread_id);
  const surveyUrl = buildCustomerSatisfactionUrl(token, origin);
  const workspaceLanguage = await loadWorkspaceSupportLanguage(serviceClient, requestRow.workspace_id);
  const language = resolveSurveyLanguage(settings, thread, workspaceLanguage);
  const rendered = buildSurveyEmail({ settings, surveyUrl, subject: thread.subject, language });
  const response = await sendPostmarkEmail({
    From: buildFromDisplay(fromName, fromEmail),
    To: recipient,
    ReplyTo: mailbox.provider_email || fromEmail,
    Subject: rendered.subject,
    TextBody: rendered.text,
    HtmlBody: rendered.html,
    Tag: "csat-survey",
  });
  return { status: "sent", provider: "postmark", providerMessageId: response?.MessageID || null };
}

async function updateRequest(serviceClient, id, patch) {
  const { error } = await serviceClient
    .from("csat_survey_requests")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function scheduleRecentResolvedCustomerSatisfactionSurveys(
  serviceClient,
  { workspaceId = null, since = null, limit = 100 } = {},
) {
  let query = serviceClient
    .from("ticket_lifecycle_events")
    .select("workspace_id, thread_id, occurred_at")
    .eq("event_type", "resolved")
    .not("workspace_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 500));
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  if (since) query = query.gte("occurred_at", since);
  const { data: events, error } = await query;
  if (error) throw new Error(error.message);

  const seen = new Set();
  const results = [];
  for (const event of events || []) {
    const key = `${event.workspace_id}:${event.thread_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const scheduled = await scheduleCustomerSatisfactionSurvey(serviceClient, {
        workspaceId: event.workspace_id,
        threadId: event.thread_id,
        resolvedAt: event.occurred_at,
      });
      results.push({ workspaceId: event.workspace_id, threadId: event.thread_id, status: scheduled.status });
    } catch (error) {
      results.push({ workspaceId: event.workspace_id, threadId: event.thread_id, status: "failed", reason: error.message });
    }
  }
  return results;
}

export async function dispatchDueCustomerSatisfactionSurveys(
  serviceClient,
  { workspaceId = null, origin = "", limit = 25 } = {},
) {
  let query = serviceClient
    .from("csat_survey_requests")
    .select("id, workspace_id, thread_id, status, attempt_count, scheduled_for")
    .in("status", ["pending", "failed"])
    .lte("scheduled_for", new Date().toISOString())
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("scheduled_for", { ascending: true })
    .limit(Math.min(Math.max(Number(limit) || 25, 1), 100));
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const results = [];
  for (const row of rows || []) {
    const nextAttempt = Number(row.attempt_count || 0) + 1;
    const { data: claimed, error: claimError } = await serviceClient
      .from("csat_survey_requests")
      .update({ status: "sending", attempt_count: nextAttempt, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .in("status", ["pending", "failed"])
      .select("id, workspace_id, thread_id, attempt_count")
      .maybeSingle();
    if (claimError || !claimed) continue;

    try {
      const sent = await sendCustomerSatisfactionSurvey(serviceClient, { requestRow: claimed, origin });
      if (sent.status === "sent") {
        await updateRequest(serviceClient, row.id, {
          status: "sent",
          sent_at: new Date().toISOString(),
          delivery_provider: sent.provider,
          provider_message_id: sent.providerMessageId,
          last_error: null,
        });
      } else if (sent.status === "deferred") {
        await updateRequest(serviceClient, row.id, {
          status: "pending",
          scheduled_for: new Date(Date.now() + RETRY_DELAY_MINUTES * 60 * 1000).toISOString(),
          last_error: sent.reason,
        });
      } else {
        await updateRequest(serviceClient, row.id, { status: "skipped", last_error: sent.reason || null });
      }
      results.push({ id: row.id, status: sent.status, reason: sent.reason || null });
    } catch (error) {
      await updateRequest(serviceClient, row.id, {
        status: nextAttempt >= MAX_ATTEMPTS ? "failed" : "failed",
        last_error: String(error?.message || "CSAT delivery failed").slice(0, 500),
      });
      results.push({ id: row.id, status: "failed", reason: error?.message || "CSAT delivery failed" });
    }
  }
  return { processed: results.length, results };
}
