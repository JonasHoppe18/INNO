import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { sendPostmarkEmail } from "@/lib/server/postmark";
import { getReplyTargetEmail } from "@/lib/inbox/sender";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import { autoTagThread } from "@/lib/ai/autoTagThread";
import {
  composeEmailBodyWithSignature,
  loadEmailSignatureConfig,
  normalizePlainText,
} from "@/lib/server/email-signature";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID || "common";
const POSTMARK_FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL || "support@sona-ai.dk";
const POSTMARK_FROM_NAME = process.env.POSTMARK_FROM_NAME || "Sona";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function normalizeEmailList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim());
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function stripHtml(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function loadLegacyUserSignature(serviceClient, supabaseUserId) {
  if (!supabaseUserId) return "";
  const { data: profile, error } = await serviceClient
    .from("profiles")
    .select("signature")
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (error) {
    console.warn("[threads/send] profile signature lookup failed", error.message);
    return "";
  }
  return normalizePlainText(profile?.signature);
}

function buildSnippet(text, maxLength = 240) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}…` : cleaned;
}

function countWords(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

function summarizeDraftDiff(aiText, finalText) {
  const ai = String(aiText || "");
  const final = String(finalText || "");
  const aiWords = countWords(ai);
  const finalWords = countWords(final);
  const delta = finalWords - aiWords;
  const deltaPct = aiWords ? delta / aiWords : 0;
  const normalizedAi = ai.replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedFinal = final.replace(/\s+/g, " ").trim().toLowerCase();
  const removedFluff =
    /hope this email finds you well/i.test(ai) && !/hope this email finds you well/i.test(final);
  const addedNextSteps =
    /\b(next steps?|please|you can|we will)\b/i.test(final) &&
    !/\b(next steps?|please|you can|we will)\b/i.test(ai);
  return {
    ai_length: ai.length,
    final_length: final.length,
    ai_words: aiWords,
    final_words: finalWords,
    delta_words: delta,
    delta_pct: Number.isFinite(deltaPct) ? Number(deltaPct.toFixed(2)) : 0,
    identical_normalized: Boolean(normalizedAi) && normalizedAi === normalizedFinal,
    changed_materially:
      Boolean(normalizedAi) &&
      normalizedAi !== normalizedFinal &&
      (Math.abs(delta) >= 5 || Math.abs(deltaPct) >= 0.15 || Math.abs(final.length - ai.length) >= 40),
    removed_fluff: removedFluff,
    added_next_steps: addedNextSteps,
  };
}

function levenshtein(a, b) {
  const s1 = String(a || "").slice(0, 1000);
  const s2 = String(b || "").slice(0, 1000);
  if (s1 === s2) return 0;
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        s1[i - 1] === s2[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function classifyEdit(aiText, finalText, distance) {
  const ai = String(aiText || "").replace(/\s+/g, " ").trim().toLowerCase();
  const fin = String(finalText || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (ai === fin) return "no_edit";
  const maxLen = Math.max(ai.length, fin.length, 1);
  return distance / maxLen < 0.15 ? "minor_edit" : "major_edit";
}

async function captureDraftEditFeedback({
  serviceClient,
  threadId,
  messageDraftId,
  sourceWasAiGenerated,
  originalAiText,
  finalText,
  eventType,
  createdAt,
}) {
  if (!serviceClient || !threadId || !sourceWasAiGenerated) return;
  const diffSummary = summarizeDraftDiff(originalAiText, finalText);
  await serviceClient.from("agent_logs").insert({
    draft_id: null,
    step_name: "draft_edit_feedback_captured",
    step_detail: JSON.stringify({
      thread_id: threadId,
      message_draft_id: messageDraftId || null,
      event_type: eventType,
      source_was_ai_generated: true,
      original_ai_draft_length: diffSummary.ai_length,
      final_draft_length: diffSummary.final_length,
      changed_materially: diffSummary.changed_materially,
      diff_summary: diffSummary,
    }),
    status: "info",
    created_at: createdAt || new Date().toISOString(),
  });
}


function encodeBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function decodeBase64(input) {
  return Buffer.from(input, "base64");
}

function base64ToBytes(input) {
  return new Uint8Array(decodeBase64(input));
}

function bytesToBase64(bytes) {
  return encodeBase64(Buffer.from(bytes));
}

function maybeDecodeBase64String(value) {
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) return null;
  if (value.length % 4 !== 0) return null;
  try {
    return decodeBase64(value).toString("utf-8");
  } catch {
    return null;
  }
}

function decodeHexToString(hexValue) {
  const hex = hexValue.slice(2);
  if (!hex || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return Buffer.from(bytes).toString("utf-8");
}

function getAesKey() {
  if (!ENCRYPTION_KEY) return null;
  const hash = crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
  return hash;
}

function encryptToken(value) {
  if (!ENCRYPTION_KEY) {
    return Buffer.from(value, "utf-8").toString("base64");
  }
  const key = getAesKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
  return `${bytesToBase64(iv)}:${bytesToBase64(encrypted)}`;
}

function decryptToken(value) {
  if (!value) return null;
  if (typeof value !== "string") return null;
  if (value.startsWith("\\x")) {
    const decoded = decodeHexToString(value);
    if (!decoded) return null;
    const maybeBase64 = maybeDecodeBase64String(decoded);
    return maybeBase64 ?? decoded;
  }
  if (value.includes(":")) {
    const key = getAesKey();
    if (key) {
      const [ivB64, dataB64] = value.split(":");
      if (ivB64 && dataB64) {
        const iv = Buffer.from(base64ToBytes(ivB64));
        const encrypted = Buffer.from(base64ToBytes(dataB64));
        try {
          const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
          const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
          return decrypted.toString("utf-8");
        } catch {
          return null;
        }
      }
    }
  }
  try {
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return value;
  }
}

async function refreshGmailToken(serviceClient, account) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth config missing");
  }
  const refreshToken = decryptToken(account.refresh_token_enc);
  if (!refreshToken) {
    throw new Error("Missing Gmail refresh token");
  }
  const params = new URLSearchParams();
  params.set("client_id", GOOGLE_CLIENT_ID);
  params.set("client_secret", GOOGLE_CLIENT_SECRET);
  params.set("refresh_token", refreshToken);
  params.set("grant_type", "refresh_token");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.error_description || payload?.error || `HTTP ${res.status}`;
    throw new Error(`Token refresh failed: ${message}`);
  }
  const nextAccessToken = payload?.access_token;
  const expiresIn = Number(payload?.expires_in ?? 0);
  if (!nextAccessToken) throw new Error("Missing Gmail access token");
  const nextExpiresAt = new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString();
  await serviceClient
    .from("mail_accounts")
    .update({
      access_token_enc: encryptToken(nextAccessToken),
      token_expires_at: nextExpiresAt,
    })
    .eq("id", account.id);
  return nextAccessToken;
}

async function refreshOutlookToken(serviceClient, account) {
  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
    throw new Error("Microsoft OAuth config missing");
  }
  const refreshToken = decryptToken(account.refresh_token_enc);
  if (!refreshToken) {
    throw new Error("Missing Outlook refresh token");
  }
  const params = new URLSearchParams();
  params.set("client_id", MICROSOFT_CLIENT_ID);
  params.set("client_secret", MICROSOFT_CLIENT_SECRET);
  params.set("refresh_token", refreshToken);
  params.set("grant_type", "refresh_token");
  params.set("scope", "offline_access Mail.ReadWrite Mail.Send User.Read");

  const tokenUrl = `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.error_description || payload?.error || `HTTP ${res.status}`;
    throw new Error(`Token refresh failed: ${message}`);
  }
  const nextAccessToken = payload?.access_token;
  const expiresIn = Number(payload?.expires_in ?? 0);
  if (!nextAccessToken) throw new Error("Missing Outlook access token");
  const nextExpiresAt = new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString();
  await serviceClient
    .from("mail_accounts")
    .update({
      access_token_enc: encryptToken(nextAccessToken),
      token_expires_at: nextExpiresAt,
    })
    .eq("id", account.id);
  return nextAccessToken;
}

async function getAccessToken(serviceClient, account) {
  const accessToken = decryptToken(account.access_token_enc);
  const expiresAt =
    typeof account.token_expires_at === "string" ? Date.parse(account.token_expires_at) : NaN;
  const expiresSoon = !Number.isFinite(expiresAt) || expiresAt - Date.now() <= 60_000;
  if (accessToken && !expiresSoon) return accessToken;
  if (account.provider === "gmail") {
    return await refreshGmailToken(serviceClient, account);
  }
  if (account.provider === "outlook") {
    return await refreshOutlookToken(serviceClient, account);
  }
  throw new Error("Unsupported provider");
}

function toBase64Url(input) {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function chunkBase64(input, lineLength = 76) {
  const value = String(input || "");
  if (!value) return "";
  const chunks = [];
  for (let index = 0; index < value.length; index += lineLength) {
    chunks.push(value.slice(index, index + lineLength));
  }
  return chunks.join("\r\n");
}

function sanitizeBase64(input) {
  const value = String(input || "").replace(/\s+/g, "");
  if (!value) return "";
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) {
    throw new Error("Attachment content must be valid base64.");
  }
  return value;
}

function buildRawEmail({ from, to, cc, bcc, subject, bodyText, bodyHtml, inReplyTo, attachments }) {
  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  const hasAttachments = safeAttachments.length > 0;
  const hasHtml = Boolean(String(bodyHtml || "").trim());
  const headers = [];
  headers.push(`From: ${from}`);
  headers.push(`To: ${to.join(", ")}`);
  if (cc?.length) headers.push(`Cc: ${cc.join(", ")}`);
  if (bcc?.length) headers.push(`Bcc: ${bcc.join(", ")}`);
  headers.push(`Subject: ${subject}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  headers.push("MIME-Version: 1.0");

  const plainBody = String(bodyText || "");
  const htmlBody = String(bodyHtml || "");
  const plainBodyBase64 = chunkBase64(Buffer.from(plainBody, "utf-8").toString("base64"));
  const htmlBodyBase64 = chunkBase64(Buffer.from(htmlBody, "utf-8").toString("base64"));

  if (!hasAttachments && !hasHtml) {
    headers.push(`Content-Type: text/plain; charset="UTF-8"`);
    headers.push(`Content-Transfer-Encoding: base64`);
    const raw = `${headers.join("\r\n")}\r\n\r\n${plainBodyBase64}`;
    return toBase64Url(raw);
  }

  const mixedBoundary = `mix_${crypto.randomBytes(12).toString("hex")}`;
  const altBoundary = `alt_${crypto.randomBytes(12).toString("hex")}`;
  const lines = [...headers];

  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    lines.push("");
    lines.push(`--${mixedBoundary}`);
  } else {
    lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    lines.push("");
  }

  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  lines.push("");
  lines.push(`--${altBoundary}`);
  lines.push(`Content-Type: text/plain; charset="UTF-8"`);
  lines.push(`Content-Transfer-Encoding: base64`);
  lines.push("");
  lines.push(plainBodyBase64);

  if (hasHtml) {
    lines.push(`--${altBoundary}`);
    lines.push(`Content-Type: text/html; charset="UTF-8"`);
    lines.push(`Content-Transfer-Encoding: base64`);
    lines.push("");
    lines.push(htmlBodyBase64);
  }

  lines.push(`--${altBoundary}--`);

  if (hasAttachments) {
    safeAttachments.forEach((attachment, index) => {
      const filename = String(attachment?.filename || "").trim() || `attachment-${index + 1}`;
      const mimeType =
        String(attachment?.mime_type || "").trim() || "application/octet-stream";
      const content = chunkBase64(sanitizeBase64(attachment?.content_base64));
      lines.push("");
      lines.push(`--${mixedBoundary}`);
      lines.push(`Content-Type: ${mimeType}; name="${filename}"`);
      lines.push(`Content-Disposition: attachment; filename="${filename}"`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(content);
    });
    lines.push(`--${mixedBoundary}--`);
  }

  const raw = lines.join("\r\n");
  return toBase64Url(raw);
}

function normalizeMessageId(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("<") && cleaned.endsWith(">")) return cleaned;
  return `<${cleaned.replace(/^<|>$/g, "")}>`;
}

function parseEmailDomain(email) {
  const value = String(email || "").trim().toLowerCase();
  const atIndex = value.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === value.length - 1) return null;
  return value.slice(atIndex + 1);
}

function buildFromAddress(name, email) {
  if (!email) return null;
  const safeName = String(name || "").trim();
  if (!safeName) return email;
  return `${safeName} <${email}>`;
}

function resolvePostmarkSender(mailbox, senderName) {
  const safeSharedFromEmail = String(POSTMARK_FROM_EMAIL || "").trim().toLowerCase();
  if (!safeSharedFromEmail) {
    throw new Error("POSTMARK_FROM_EMAIL is missing.");
  }

  const safeCustomFromEmail = String(mailbox?.from_email || "").trim().toLowerCase();
  const safeSendingDomain = String(mailbox?.sending_domain || "").trim().toLowerCase();
  const customIsAllowed =
    mailbox?.sending_type === "custom" &&
    mailbox?.domain_status === "verified" &&
    safeCustomFromEmail &&
    safeSendingDomain &&
    parseEmailDomain(safeCustomFromEmail) === safeSendingDomain;

  if (customIsAllowed) {
    const resolvedName = String(senderName || "").trim() || String(mailbox?.from_name || "").trim();
    return {
      fromEmail: safeCustomFromEmail,
      fromDisplay: buildFromAddress(resolvedName, safeCustomFromEmail),
      fromName: resolvedName || null,
      mode: "custom",
    };
  }

  const resolvedName = String(senderName || "").trim() || POSTMARK_FROM_NAME;
  return {
    fromEmail: safeSharedFromEmail,
    fromDisplay: buildFromAddress(resolvedName, safeSharedFromEmail),
    fromName: resolvedName || null,
    mode: "shared",
  };
}

async function sendViaPostmark({
  to,
  cc,
  bcc,
  subject,
  textBody,
  htmlBody,
  inReplyTo,
  references,
  replyTo,
  fromDisplay,
  attachments,
}) {
  const headers = [];
  if (inReplyTo) headers.push({ Name: "In-Reply-To", Value: inReplyTo });
  if (references?.length) headers.push({ Name: "References", Value: references.join(" ") });

  return await sendPostmarkEmail({
    From: fromDisplay,
    ReplyTo: replyTo || undefined,
    To: to.join(", "),
    Cc: cc?.length ? cc.join(", ") : undefined,
    Bcc: bcc?.length ? bcc.join(", ") : undefined,
    Subject: subject,
    TextBody: textBody || undefined,
    HtmlBody: htmlBody || undefined,
    Headers: headers.length ? headers : undefined,
    Attachments: Array.isArray(attachments) && attachments.length
      ? attachments.map((attachment, index) => ({
          Name: String(attachment?.filename || "").trim() || `attachment-${index + 1}`,
          Content: sanitizeBase64(attachment?.content_base64),
          ContentType: String(attachment?.mime_type || "").trim() || "application/octet-stream",
        }))
      : undefined,
  });
}

async function sendGmail({ token, raw, threadId }) {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.error?.message || `Gmail API ${res.status}`;
    throw new Error(message);
  }
  return payload;
}

async function sendOutlook({ token, message, useReply, replyMessageId }) {
  if (useReply && replyMessageId) {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${replyMessageId}/createReply`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const draft = await res.json().catch(() => null);
    if (!res.ok) {
      const message = draft?.error?.message || `Graph createReply ${res.status}`;
      throw new Error(message);
    }
    const draftId = draft?.id;
    if (!draftId) throw new Error("Missing Outlook draft id");
    await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draftId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
    const sendRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${draftId}/send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!sendRes.ok) {
      const text = await sendRes.text();
      throw new Error(text || `Graph send ${sendRes.status}`);
    }
    return { id: draftId };
  }

  const res = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
  const draft = await res.json().catch(() => null);
  if (!res.ok) {
    const message = draft?.error?.message || `Graph create ${res.status}`;
    throw new Error(message);
  }
  const draftId = draft?.id;
  if (!draftId) throw new Error("Missing Outlook draft id");
  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${draftId}/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!sendRes.ok) {
    const text = await sendRes.text();
    throw new Error(text || `Graph send ${sendRes.status}`);
  }
  return { id: draftId };
}

async function logAgent(serviceClient, detail) {
  await serviceClient.from("agent_logs").insert({
    draft_id: null,
    step_name: "send_reply_failed",
    step_detail: JSON.stringify(detail),
    status: "error",
    created_at: new Date().toISOString(),
  });
}

async function logAgentStatus(serviceClient, stepName, status, detail) {
  await serviceClient.from("agent_logs").insert({
    draft_id: null,
    step_name: stepName,
    step_detail: JSON.stringify(detail),
    status,
    created_at: new Date().toISOString(),
  });
}

async function loadWorkspaceTestSettings(serviceClient, workspaceId) {
  if (!workspaceId) {
    return { testMode: false, testEmail: null };
  }
  const { data, error } = await serviceClient
    .from("workspaces")
    .select("test_mode, test_email")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  const testEmail = String(data?.test_email || "").trim().toLowerCase();
  return {
    testMode: Boolean(data?.test_mode),
    testEmail: testEmail || null,
  };
}

export async function POST(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  const threadId = params?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const bodyText = String(body?.body_text || "").trim();
  const bodyHtml = String(body?.body_html || "").trim();
  const senderName = String(body?.sender_name || "").trim();
  const draftMessageId =
    typeof body?.draft_message_id === "string" ? body.draft_message_id.trim() : null;
  if (!bodyText && !bodyHtml) {
    return NextResponse.json({ error: "body_text is required." }, { status: 400 });
  }
  const requestedAttachments = Array.isArray(body?.attachments) ? body.attachments : [];
  if (requestedAttachments.length > 10) {
    return NextResponse.json({ error: "Maximum 10 attachments per reply." }, { status: 400 });
  }
  const attachmentsPayload = [];
  for (const attachment of requestedAttachments) {
    const filename = String(attachment?.filename || "").trim();
    const mimeType =
      String(attachment?.mime_type || "").trim() || "application/octet-stream";
    const sizeBytes = Number(attachment?.size_bytes || 0);
    const contentBase64 = String(attachment?.content_base64 || "").trim();
    if (!filename || !contentBase64 || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return NextResponse.json({ error: "Invalid attachment payload." }, { status: 400 });
    }
    if (sizeBytes > 15 * 1024 * 1024) {
      return NextResponse.json(
        { error: `Attachment "${filename}" exceeds the 15 MB limit.` },
        { status: 400 }
      );
    }
    try {
      sanitizeBase64(contentBase64);
    } catch {
      return NextResponse.json({ error: `Attachment "${filename}" has invalid content.` }, { status: 400 });
    }
    attachmentsPayload.push({
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      content_base64: contentBase64,
    });
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const supabaseUserId = scope?.supabaseUserId ?? null;
  if (!scope?.workspaceId && !supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve user scope." }, { status: 401 });
  }
  let testSettings = { testMode: false, testEmail: null };
  if (scope?.workspaceId) {
    try {
      testSettings = await loadWorkspaceTestSettings(serviceClient, scope.workspaceId);
    } catch (error) {
      return NextResponse.json(
        { error: error?.message || "Could not load workspace test settings." },
        { status: 500 }
      );
    }
  }
  const legacySignature = await loadLegacyUserSignature(serviceClient, supabaseUserId);

  let threadQuery = serviceClient
    .from("mail_threads")
    .select("id, user_id, workspace_id, mailbox_id, provider, provider_thread_id, subject, snippet, classification_key, tags")
    .eq("id", threadId);
  threadQuery = applyScope(threadQuery, scope);
  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  let mailboxQuery = serviceClient
    .from("mail_accounts")
    .select(
      "id, user_id, workspace_id, shop_id, provider, provider_email, access_token_enc, refresh_token_enc, token_expires_at, status, smtp_host, smtp_port, smtp_secure, smtp_username_enc, smtp_password_enc, smtp_status, sending_type, sending_domain, domain_status, from_email, from_name"
    )
    .eq("id", thread.mailbox_id);
  mailboxQuery = applyScope(mailboxQuery, scope);
  const { data: mailbox, error: mailboxError } = await mailboxQuery.maybeSingle();
  if (mailboxError || !mailbox) {
    return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
  }

  let automationQuery = serviceClient
    .from("agent_automation")
    .select("learn_from_edits,draft_destination")
    .order("updated_at", { ascending: false })
    .limit(1);
  automationQuery = applyScope(automationQuery, scope);
  const { data: automationSettings } = await automationQuery.maybeSingle();
  const learnFromEdits = automationSettings?.learn_from_edits === true;
  const draftDestinationSetting = "sona_inbox";

  let aiDraftText = "";
  if (learnFromEdits && draftDestinationSetting === "sona_inbox" && (scope?.workspaceId || supabaseUserId)) {
    let aiQuery = serviceClient
      .from("mail_messages")
      .select("ai_draft_text")
      .eq("thread_id", threadId)
      .not("ai_draft_text", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1);
    aiQuery = applyScope(aiQuery, scope);
    const { data: aiRow } = await aiQuery.maybeSingle();
    aiDraftText = aiRow?.ai_draft_text || "";
  }

  let inboundMessagesQuery = serviceClient
    .from("mail_messages")
    .select("id, from_email, extracted_customer_email, provider_message_id, received_at, subject")
    .eq("thread_id", threadId)
    .not("received_at", "is", null)
    .order("received_at", { ascending: false })
    .limit(5);
  inboundMessagesQuery = applyScope(inboundMessagesQuery, scope);
  const { data: inboundMessages } = await inboundMessagesQuery;
  const inboundMessage = Array.isArray(inboundMessages) ? inboundMessages[0] : null;

  const fallbackReplyTarget = getReplyTargetEmail(inboundMessage);
  const fallbackTo = fallbackReplyTarget ? [fallbackReplyTarget] : [];
  const toEmails = normalizeEmailList(body?.to_emails);
  const ccEmails = normalizeEmailList(body?.cc_emails);
  const bccEmails = normalizeEmailList(body?.bcc_emails);
  const hasExplicitTo = Object.prototype.hasOwnProperty.call(body || {}, "to_emails");
  const finalTo = toEmails.length
    ? toEmails
    : hasExplicitTo || mailbox.provider === "smtp"
    ? []
    : fallbackTo;
  const isTestModeActive = Boolean(testSettings?.testMode);
  const testEmailAddress = String(testSettings?.testEmail || "").trim().toLowerCase() || null;
  const shouldSimulateEmailOnly = isTestModeActive && !testEmailAddress;
  if (!finalTo.length && !shouldSimulateEmailOnly) {
    return NextResponse.json({ error: "Missing recipient." }, { status: 400 });
  }
  const deliveryTo = isTestModeActive
    ? testEmailAddress
      ? [testEmailAddress]
      : []
    : finalTo;
  const deliveryCc = isTestModeActive ? [] : ccEmails;
  const deliveryBcc = isTestModeActive ? [] : bccEmails;

  const subjectRaw = String(body?.subject || thread.subject || "").trim();
  const subject = subjectRaw.toLowerCase().startsWith("re:")
    ? subjectRaw
    : subjectRaw
    ? `Re: ${subjectRaw}`
    : "Re:";
  const signatureConfig = await loadEmailSignatureConfig(serviceClient, {
    workspaceId: scope?.workspaceId || mailbox?.workspace_id || null,
    shopId: mailbox?.shop_id || null,
    userId: supabaseUserId,
    legacySignature,
  });
  const composed = composeEmailBodyWithSignature({
    bodyText: bodyText || stripHtml(bodyHtml),
    bodyHtml,
    config: signatureConfig,
  });
  const coreBodyText = composed.coreBodyText;
  const finalBodyText = composed.finalBodyText;
  const finalBodyHtml = composed.finalBodyHtml || "";

  let providerMessageId = null;
  let sentFromEmail = mailbox.provider_email || null;
  let sentFromName = senderName || null;
  const nowIso = new Date().toISOString();
  try {
    if (shouldSimulateEmailOnly) {
      providerMessageId = `email-simulated-test-mode-${threadId}-${Date.now()}`;
      await logAgentStatus(serviceClient, "email_simulated_test_mode", "info", {
        provider: mailbox.provider,
        threadId,
        simulated: true,
        reason: "test_mode_enabled_without_test_email",
        intended_to: finalTo,
        intended_cc: ccEmails,
        intended_bcc: bccEmails,
      });
    } else if (mailbox.provider === "smtp") {
      const senderConfig = resolvePostmarkSender(mailbox, senderName);
      sentFromEmail = senderConfig.fromEmail;
      sentFromName = senderConfig.fromName;
      const references = (Array.isArray(inboundMessages) ? inboundMessages : [])
        .map((row) => normalizeMessageId(row?.provider_message_id))
        .filter(Boolean);
      const inReplyTo = normalizeMessageId(inboundMessage?.provider_message_id);
      const postmarkResponse = await sendViaPostmark({
        to: deliveryTo,
        cc: deliveryCc,
        bcc: deliveryBcc,
        subject,
        textBody: finalBodyText,
        htmlBody: finalBodyHtml || undefined,
        inReplyTo,
        references,
        replyTo: mailbox.provider_email || undefined,
        fromDisplay: senderConfig.fromDisplay,
        attachments: attachmentsPayload,
      });
      providerMessageId = postmarkResponse?.MessageID || null;

      await logAgentStatus(serviceClient, "send_smtp_success", "success", {
        provider: "smtp",
        threadId,
        transport: "postmark",
        from_mode: senderConfig.mode,
        ...(isTestModeActive
          ? {
              test_mode: true,
              redirected_to: testEmailAddress,
              intended_to: finalTo,
            }
          : {}),
      });
    } else {
      const token = await getAccessToken(serviceClient, mailbox);
      if (mailbox.provider === "gmail") {
      const raw = buildRawEmail({
        from: mailbox.provider_email,
        to: deliveryTo,
        cc: deliveryCc,
        bcc: deliveryBcc,
        subject,
        bodyText: finalBodyText,
        bodyHtml: finalBodyHtml || null,
        inReplyTo: inboundMessage?.provider_message_id || null,
        attachments: attachmentsPayload,
      });
      const payload = await sendGmail({
        token,
        raw,
        threadId: thread.provider_thread_id || undefined,
      });
      providerMessageId = payload?.id || null;
      } else if (mailbox.provider === "outlook") {
        const message = {
          subject,
          body: {
            contentType: finalBodyHtml ? "HTML" : "Text",
            content: finalBodyHtml || finalBodyText,
          },
          toRecipients: deliveryTo.map((email) => ({ emailAddress: { address: email } })),
          ccRecipients: deliveryCc.map((email) => ({ emailAddress: { address: email } })),
          bccRecipients: deliveryBcc.map((email) => ({ emailAddress: { address: email } })),
          internetMessageHeaders: inboundMessage?.provider_message_id
            ? [
                {
                  name: "In-Reply-To",
                  value: inboundMessage.provider_message_id,
                },
              ]
            : [],
          attachments: attachmentsPayload.map((attachment) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: attachment.filename,
            contentType: attachment.mime_type,
            contentBytes: attachment.content_base64,
          })),
        };
        const useReply =
          Boolean(inboundMessage?.provider_message_id) &&
          !toEmails.length &&
          !isTestModeActive;
        const payload = await sendOutlook({
          token,
          message,
          useReply,
          replyMessageId: inboundMessage?.provider_message_id || null,
        });
        providerMessageId = payload?.id || null;
      }
    }
  } catch (error) {
    console.error("[threads/send] send failed", {
      provider: mailbox.provider,
      threadId,
      message: String(error?.message || error),
    });
    if (mailbox.provider === "smtp") {
      await logAgentStatus(serviceClient, "send_smtp_fail", "error", {
        provider: mailbox.provider,
        threadId,
        error: String(error?.message || "SMTP send failed").slice(0, 280),
      });
    }
    await logAgent(serviceClient, {
      provider: mailbox.provider,
      threadId,
      error: error.message || String(error),
    });
    const message = error?.message || `Send failed (${mailbox.provider}).`;
    const lowerMessage = String(message).toLowerCase();
    if (lowerMessage.includes("pending approval") && lowerMessage.includes("domain")) {
      const recipientDomains = [...deliveryTo, ...deliveryCc, ...deliveryBcc]
        .map((email) => String(email || "").trim().toLowerCase())
        .filter(Boolean)
        .map((email) => email.split("@")[1] || "")
        .filter(Boolean);
      return NextResponse.json(
        {
          error:
            "Postmark account is pending approval. You can only send to recipients on your own domain right now.",
          recipient_domains: Array.from(new Set(recipientDomains)),
          from_domain: String(sentFromEmail || "").split("@")[1] || null,
        },
        { status: 400 }
      );
    }
    const status = /refresh/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  const snippet = buildSnippet(finalBodyText);
  const persistedProviderMessageId =
    providerMessageId || `sent-${mailbox.provider}-${threadId}-${Date.now()}`;
  let insertedMessage = null;
  let insertError = null;
  if (draftMessageId) {
    let updateDraftQuery = serviceClient
      .from("mail_messages")
      .update({
        provider: mailbox.provider,
        provider_message_id: persistedProviderMessageId,
        subject,
        snippet,
        body_text: finalBodyText,
        body_html: finalBodyHtml || null,
        clean_body_text: finalBodyText,
        clean_body_html: finalBodyHtml || null,
        quoted_body_text: null,
        quoted_body_html: null,
        from_name: sentFromName,
        from_email: sentFromEmail,
        from_me: true,
        to_emails: deliveryTo,
        cc_emails: deliveryCc,
        bcc_emails: deliveryBcc,
        is_read: true,
        sent_at: nowIso,
        received_at: null,
        is_draft: false,
        ai_draft_text: null,
        updated_at: nowIso,
      })
      .eq("id", draftMessageId)
      .eq("thread_id", threadId);
    updateDraftQuery = applyScope(updateDraftQuery, scope);
    const result = await updateDraftQuery.select("id").maybeSingle();
    insertedMessage = result.data;
    insertError = result.error;
  } else {
    const result = await serviceClient
      .from("mail_messages")
      .insert({
        user_id: supabaseUserId,
        workspace_id: scope?.workspaceId ?? null,
        mailbox_id: mailbox.id,
        thread_id: threadId,
        provider: mailbox.provider,
        provider_message_id: persistedProviderMessageId,
        subject,
        snippet,
        body_text: finalBodyText,
        body_html: finalBodyHtml || null,
        clean_body_text: finalBodyText,
        clean_body_html: finalBodyHtml || null,
        quoted_body_text: null,
        quoted_body_html: null,
        from_name: sentFromName,
        from_email: sentFromEmail,
        from_me: true,
        to_emails: deliveryTo,
        cc_emails: deliveryCc,
        bcc_emails: deliveryBcc,
        is_read: true,
        sent_at: nowIso,
        received_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .maybeSingle();
    insertedMessage = result.data;
    insertError = result.error;
  }

  if (!insertError && !insertedMessage) {
    const fallback = await serviceClient
      .from("mail_messages")
      .insert({
        user_id: supabaseUserId,
        workspace_id: scope?.workspaceId ?? null,
        mailbox_id: mailbox.id,
        thread_id: threadId,
        provider: mailbox.provider,
        provider_message_id: persistedProviderMessageId,
        subject,
        snippet,
        body_text: finalBodyText,
        body_html: finalBodyHtml || null,
        clean_body_text: finalBodyText,
        clean_body_html: finalBodyHtml || null,
        quoted_body_text: null,
        quoted_body_html: null,
        from_name: sentFromName,
        from_email: sentFromEmail,
        from_me: true,
        to_emails: deliveryTo,
        cc_emails: deliveryCc,
        bcc_emails: deliveryBcc,
        is_read: true,
        sent_at: nowIso,
        received_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .maybeSingle();
    insertedMessage = fallback.data;
    insertError = fallback.error;
  }

  if (insertError) {
    await logAgent(serviceClient, {
      provider: mailbox.provider,
      threadId,
      error: insertError.message,
    });
    return NextResponse.json(
      {
        error:
          "Email was sent, but we could not persist it in the thread. Please refresh and try again.",
      },
      { status: 500 }
    );
  }

  if (insertedMessage?.id) {
    let clearExistingAttachmentsQuery = serviceClient
      .from("mail_attachments")
      .delete()
      .eq("message_id", insertedMessage.id);
    clearExistingAttachmentsQuery = applyScope(clearExistingAttachmentsQuery, scope, {
      workspaceColumn: null,
      userColumn: "user_id",
    });
    await clearExistingAttachmentsQuery;

    if (attachmentsPayload.length) {
      const attachmentRows = attachmentsPayload.map((attachment) => ({
        user_id: supabaseUserId,
        mailbox_id: mailbox.id,
        message_id: insertedMessage.id,
        provider: mailbox.provider,
        provider_attachment_id: null,
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
        storage_path: `inline:${attachment.mime_type};base64,${sanitizeBase64(
          attachment.content_base64
        )}`,
        created_at: nowIso,
      }));
      const { error: attachmentInsertError } = await serviceClient
        .from("mail_attachments")
        .insert(attachmentRows);
      if (attachmentInsertError) {
        await logAgent(serviceClient, {
          provider: mailbox.provider,
          threadId,
          error: attachmentInsertError.message,
        });
        return NextResponse.json(
          {
            error: "Email was sent, but attachments could not be saved. Please try again.",
          },
          { status: 500 }
        );
      }
    }
  }

  // Ensure stale unsent drafts are removed after successful send.
  if (insertedMessage?.id) {
    let staleDraftDeleteQuery = serviceClient
      .from("mail_messages")
      .delete()
      .eq("thread_id", threadId)
      .eq("from_me", true)
      .eq("is_draft", true)
      .neq("id", insertedMessage.id);
    staleDraftDeleteQuery = applyScope(staleDraftDeleteQuery, scope);
    await staleDraftDeleteQuery;
  } else {
    let staleDraftDeleteQuery = serviceClient
      .from("mail_messages")
      .delete()
      .eq("thread_id", threadId)
      .eq("from_me", true)
      .eq("is_draft", true);
    staleDraftDeleteQuery = applyScope(staleDraftDeleteQuery, scope);
    await staleDraftDeleteQuery;
  }

  let clearAiDraftQuery = serviceClient
    .from("mail_messages")
    .update({ ai_draft_text: null, updated_at: nowIso })
    .eq("thread_id", threadId)
    .not("ai_draft_text", "is", null);
  clearAiDraftQuery = applyScope(clearAiDraftQuery, scope);
  await clearAiDraftQuery;

  // Supersede any still-pending Shopify action proposals when a reply is sent.
  // An agent replying means they've handled the situation — pending proposals are no longer relevant.
  let supersedePendingActionsQuery = serviceClient
    .from("thread_actions")
    .update({ status: "superseded", updated_at: nowIso })
    .eq("thread_id", threadId)
    .eq("status", "pending");
  supersedePendingActionsQuery = applyScope(supersedePendingActionsQuery, scope);
  await supersedePendingActionsQuery;

  // Tag exchange threads as awaiting_return on first outbound reply
  // so the UI can show the "Markér modtaget" banner.
  const threadClassKey = String(thread.classification_key || "").toLowerCase();
  const threadTags = Array.isArray(thread.tags) ? thread.tags : [];
  const isExchangeThread = threadClassKey === "exchange";
  const alreadyAwaitingReturn = threadTags.includes("awaiting_return");
  const updatedTags = isExchangeThread && !alreadyAwaitingReturn
    ? [...threadTags, "awaiting_return"]
    : threadTags;

  let updateThreadQuery = serviceClient
    .from("mail_threads")
    .update({
      snippet,
      subject: thread.subject ? thread.subject : subject,
      tags: isExchangeThread && !alreadyAwaitingReturn ? updatedTags : undefined,
      updated_at: nowIso,
    })
    .eq("id", threadId);
  updateThreadQuery = applyScope(updateThreadQuery, scope);
  await updateThreadQuery;

  const draftThreadKeys = [thread.provider_thread_id, threadId].filter(Boolean);
  if (draftThreadKeys.length) {
    let pendingDraftsQuery = serviceClient
      .from("drafts")
      .select("id, created_at")
      .in("thread_id", draftThreadKeys)
      .eq("platform", mailbox.provider)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (scope?.workspaceId) {
      pendingDraftsQuery = pendingDraftsQuery.eq("workspace_id", scope.workspaceId);
    }
    const { data: pendingDraftRows, error: pendingDraftsLookupError } = await pendingDraftsQuery;

    if (pendingDraftsLookupError) {
      console.warn("[threads/send] failed to lookup pending drafts", pendingDraftsLookupError.message);
    } else if (Array.isArray(pendingDraftRows) && pendingDraftRows.length) {
      const latestDraftId = pendingDraftRows[0]?.id ?? null;
      const staleDraftIds = pendingDraftRows
        .slice(1)
        .map((row) => row?.id)
        .filter(Boolean);

      if (latestDraftId !== null) {
        const { data: draftRow } = await serviceClient
          .from("drafts")
          .select("ai_draft_text")
          .eq("id", latestDraftId)
          .maybeSingle();
        const savedAiText = draftRow?.ai_draft_text || aiDraftText || null;
        const dist = savedAiText ? levenshtein(savedAiText, coreBodyText) : null;
        const editClass = savedAiText ? classifyEdit(savedAiText, coreBodyText, dist) : null;
        const maxLen = savedAiText
          ? Math.max(savedAiText.slice(0, 1000).length, String(coreBodyText || "").slice(0, 1000).length, 1)
          : null;
        const deltaPct = dist !== null && maxLen !== null
          ? Number((dist / maxLen).toFixed(4))
          : null;

        let sentDraftQuery = serviceClient
          .from("drafts")
          .update({
            status: "sent",
            final_sent_text: coreBodyText || null,
            edit_distance: dist,
            edit_delta_pct: deltaPct,
            edit_classification: editClass,
          })
          .eq("id", latestDraftId);
        if (scope?.workspaceId) {
          sentDraftQuery = sentDraftQuery.eq("workspace_id", scope.workspaceId);
        }
        await sentDraftQuery;
      }

      if (staleDraftIds.length) {
        let supersedeDraftsQuery = serviceClient
          .from("drafts")
          .update({ status: "superseded" })
          .in("id", staleDraftIds);
        if (scope?.workspaceId) {
          supersedeDraftsQuery = supersedeDraftsQuery.eq("workspace_id", scope.workspaceId);
        }
        await supersedeDraftsQuery;
      }
    }
  }

  // AI auto-tagging + løsningsopsummering (fire-and-forget)
  const workspaceIdForTags = scope?.workspaceId || thread?.workspace_id || null;
  if (workspaceIdForTags && coreBodyText?.trim()) {
    (async () => {
      try {
        const { data: workspaceTags } = await serviceClient
          .from("workspace_tags")
          .select("id, name, category")
          .eq("workspace_id", workspaceIdForTags)
          .eq("is_active", true);

        if (!workspaceTags?.length) return;

        const result = await autoTagThread({
          subject: thread?.subject || "",
          sentReply: coreBodyText,
          availableTags: workspaceTags,
        });

        if (result.tag_ids?.length) {
          await serviceClient.from("thread_tag_assignments").upsert(
            result.tag_ids.map((id) => ({
              thread_id: threadId,
              tag_id: id,
              source: "ai",
            })),
            { onConflict: "thread_id,tag_id", ignoreDuplicates: true }
          );
        }

        if (result.solution_summary) {
          await serviceClient
            .from("mail_threads")
            .update({ solution_summary: result.solution_summary })
            .eq("id", threadId);
        }
      } catch (err) {
        console.warn("[auto-tag] fejl:", err?.message);
      }
    })();
  }

  // Store sent reply as a knowledge example for future AI draft retrieval (fire-and-forget)
  const shopIdForLearning = mailbox?.shop_id || null;
  const customerTextForLearning = inboundMessage?.body_text || inboundMessage?.snippet || "";
  if (learnFromEdits && shopIdForLearning && coreBodyText?.trim() && customerTextForLearning.trim() && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    fetch(`${SUPABASE_URL}/functions/v1/store-reply-example`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        thread_id: threadId,
        shop_id: shopIdForLearning,
        workspace_id: scope?.workspaceId || null,
        sent_reply_text: coreBodyText,
        customer_message_text: customerTextForLearning,
        subject: thread?.subject || "",
      }),
    }).catch(() => null);
  }

  return NextResponse.json(
    {
      ok: true,
      message_id: insertedMessage?.id ?? null,
      provider_message_id: persistedProviderMessageId,
      provider: mailbox.provider,
      attachment_count: attachmentsPayload.length,
      test_mode: isTestModeActive,
      simulated: shouldSimulateEmailOnly,
      redirected_to: testEmailAddress,
      message:
        shouldSimulateEmailOnly
          ? "Email simulated: Test Mode is enabled and no Test Email Address is configured."
          : isTestModeActive
          ? `Email sent to ${testEmailAddress} because Test Mode is enabled.`
          : null,
    },
    { status: 200 }
  );
}
