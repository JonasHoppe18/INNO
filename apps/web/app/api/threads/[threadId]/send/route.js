import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { sendPostmarkEmail } from "@/lib/server/postmark";

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

async function resolveSupabaseUserId(serviceClient, clerkUserId) {
  const { data, error } = await serviceClient
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_id ?? null;
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
  const removedFluff =
    /hope this email finds you well/i.test(ai) && !/hope this email finds you well/i.test(final);
  const addedNextSteps =
    /\b(next steps?|please|you can|we will)\b/i.test(final) &&
    !/\b(next steps?|please|you can|we will)\b/i.test(ai);
  return {
    ai_words: aiWords,
    final_words: finalWords,
    delta_words: delta,
    delta_pct: Number.isFinite(deltaPct) ? Number(deltaPct.toFixed(2)) : 0,
    removed_fluff: removedFluff,
    added_next_steps: addedNextSteps,
  };
}

function buildLearningBullets(diff) {
  const bullets = [];
  if (diff.delta_pct < -0.2) {
    bullets.push("Prefer shorter replies when possible.");
  } else if (diff.delta_pct > 0.2) {
    bullets.push("Allow more detail when the customer needs clarity.");
  }
  if (diff.removed_fluff) {
    bullets.push("Avoid filler greetings and unnecessary pleasantries.");
  }
  if (diff.added_next_steps) {
    bullets.push("Include clear next steps in the response.");
  }
  return bullets.slice(0, 3);
}

function mergeLearningRules(existing, updates) {
  const parsed = String(existing || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(?:[-•]\s*)?(.*?)(?:\s*\(confidence:\s*([0-9.]+)\))?$/i);
      return {
        text: match?.[1]?.trim() || line.replace(/^[-•]\s*/, "").trim(),
        confidence: match?.[2] ? Number(match[2]) : 0.55,
      };
    });

  const map = new Map(parsed.map((item) => [item.text.toLowerCase(), item]));
  updates.forEach((bullet) => {
    const key = bullet.toLowerCase();
    const existingItem = map.get(key);
    if (existingItem) {
      existingItem.confidence = Math.min(0.95, Number((existingItem.confidence + 0.05).toFixed(2)));
    } else {
      map.set(key, { text: bullet, confidence: 0.55 });
    }
  });

  return Array.from(map.values())
    .map((item) => `- ${item.text} (confidence: ${item.confidence.toFixed(2)})`)
    .join("\n");
}

async function updateLearningProfile(serviceClient, mailboxId, userId, diffSummary) {
  if (!mailboxId || !userId) return;
  const { data, error } = await serviceClient
    .from("mail_learning_profiles")
    .select("style_rules")
    .eq("mailbox_id", mailboxId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const updates = buildLearningBullets(diffSummary);
  if (!updates.length) return;

  const nextRules = mergeLearningRules(data?.style_rules || "", updates);

  const { error: upsertError } = await serviceClient
    .from("mail_learning_profiles")
    .upsert(
      {
        mailbox_id: mailboxId,
        user_id: userId,
        enabled: true,
        style_rules: nextRules,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "mailbox_id" }
    );

  if (upsertError) {
    throw new Error(upsertError.message);
  }
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

function buildRawEmail({ from, to, cc, bcc, subject, bodyText, inReplyTo }) {
  const headers = [];
  headers.push(`From: ${from}`);
  headers.push(`To: ${to.join(", ")}`);
  if (cc?.length) headers.push(`Cc: ${cc.join(", ")}`);
  if (bcc?.length) headers.push(`Bcc: ${bcc.join(", ")}`);
  headers.push(`Subject: ${subject}`);
  headers.push(`MIME-Version: 1.0`);
  headers.push(`Content-Type: text/plain; charset="UTF-8"`);
  headers.push(`Content-Transfer-Encoding: 7bit`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  const raw = `${headers.join("\r\n")}\r\n\r\n${bodyText}`;
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

export async function POST(request, { params }) {
  const { userId } = await auth();
  if (!userId) {
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

  let supabaseUserId = null;
  try {
    supabaseUserId = await resolveSupabaseUserId(serviceClient, userId);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: thread, error: threadError } = await serviceClient
    .from("mail_threads")
    .select("id, user_id, mailbox_id, provider, provider_thread_id, subject, snippet")
    .eq("id", threadId)
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const { data: mailbox, error: mailboxError } = await serviceClient
    .from("mail_accounts")
    .select(
      "id, user_id, provider, provider_email, access_token_enc, refresh_token_enc, token_expires_at, status, smtp_host, smtp_port, smtp_secure, smtp_username_enc, smtp_password_enc, smtp_status, sending_type, sending_domain, domain_status, from_email, from_name"
    )
    .eq("id", thread.mailbox_id)
    .maybeSingle();
  if (mailboxError || !mailbox) {
    return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
  }

  const { data: automationSettings } = await serviceClient
    .from("agent_automation")
    .select("learn_from_edits,draft_destination")
    .eq("user_id", supabaseUserId)
    .maybeSingle();
  const learnFromEdits = automationSettings?.learn_from_edits === true;
  const draftDestinationSetting =
    automationSettings?.draft_destination === "sona_inbox" ? "sona_inbox" : "email_provider";

  let aiDraftText = "";
  if (learnFromEdits && draftDestinationSetting === "sona_inbox") {
    const { data: aiRow } = await serviceClient
      .from("mail_messages")
      .select("ai_draft_text")
      .eq("thread_id", threadId)
      .eq("user_id", supabaseUserId)
      .not("ai_draft_text", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    aiDraftText = aiRow?.ai_draft_text || "";
  }

  const { data: inboundMessages } = await serviceClient
    .from("mail_messages")
    .select("id, from_email, provider_message_id, received_at, subject")
    .eq("thread_id", threadId)
    .not("received_at", "is", null)
    .order("received_at", { ascending: false })
    .limit(5);
  const inboundMessage = Array.isArray(inboundMessages) ? inboundMessages[0] : null;

  const fallbackTo = inboundMessage?.from_email ? [inboundMessage.from_email] : [];
  const toEmails = normalizeEmailList(body?.to_emails);
  const ccEmails = normalizeEmailList(body?.cc_emails);
  const bccEmails = normalizeEmailList(body?.bcc_emails);
  const hasExplicitTo = Object.prototype.hasOwnProperty.call(body || {}, "to_emails");
  const finalTo = toEmails.length
    ? toEmails
    : hasExplicitTo || mailbox.provider === "smtp"
    ? []
    : fallbackTo;
  if (!finalTo.length) {
    return NextResponse.json({ error: "Missing recipient." }, { status: 400 });
  }

  const subjectRaw = String(body?.subject || thread.subject || "").trim();
  const subject = subjectRaw.toLowerCase().startsWith("re:")
    ? subjectRaw
    : subjectRaw
    ? `Re: ${subjectRaw}`
    : "Re:";

  let providerMessageId = null;
  let sentFromEmail = mailbox.provider_email || null;
  let sentFromName = senderName || null;
  const nowIso = new Date().toISOString();
  try {
    if (mailbox.provider === "smtp") {
      const senderConfig = resolvePostmarkSender(mailbox, senderName);
      sentFromEmail = senderConfig.fromEmail;
      sentFromName = senderConfig.fromName;
      const references = (Array.isArray(inboundMessages) ? inboundMessages : [])
        .map((row) => normalizeMessageId(row?.provider_message_id))
        .filter(Boolean);
      const inReplyTo = normalizeMessageId(inboundMessage?.provider_message_id);
      const postmarkResponse = await sendViaPostmark({
        to: finalTo,
        cc: ccEmails,
        bcc: bccEmails,
        subject,
        textBody: bodyText || stripHtml(bodyHtml),
        htmlBody: bodyHtml || undefined,
        inReplyTo,
        references,
        replyTo: mailbox.provider_email || undefined,
        fromDisplay: senderConfig.fromDisplay,
      });
      providerMessageId = postmarkResponse?.MessageID || null;

      await logAgentStatus(serviceClient, "send_smtp_success", "success", {
        provider: "smtp",
        threadId,
        transport: "postmark",
        from_mode: senderConfig.mode,
      });
    } else {
      const token = await getAccessToken(serviceClient, mailbox);
      if (mailbox.provider === "gmail") {
      const raw = buildRawEmail({
        from: mailbox.provider_email,
        to: finalTo,
        cc: ccEmails,
        bcc: bccEmails,
        subject,
        bodyText: bodyText || stripHtml(bodyHtml),
        inReplyTo: inboundMessage?.provider_message_id || null,
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
            contentType: bodyHtml ? "HTML" : "Text",
            content: bodyHtml || bodyText,
          },
          toRecipients: finalTo.map((email) => ({ emailAddress: { address: email } })),
          ccRecipients: ccEmails.map((email) => ({ emailAddress: { address: email } })),
          bccRecipients: bccEmails.map((email) => ({ emailAddress: { address: email } })),
          internetMessageHeaders: inboundMessage?.provider_message_id
            ? [
                {
                  name: "In-Reply-To",
                  value: inboundMessage.provider_message_id,
                },
              ]
            : [],
        };
        const useReply = Boolean(inboundMessage?.provider_message_id) && !toEmails.length;
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
      const recipientDomains = [...finalTo, ...ccEmails, ...bccEmails]
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

  const snippet = buildSnippet(bodyText || stripHtml(bodyHtml));
  let insertedMessage = null;
  let insertError = null;
  if (draftMessageId) {
    const result = await serviceClient
      .from("mail_messages")
      .update({
        provider: mailbox.provider,
        provider_message_id: providerMessageId,
        subject,
        snippet,
        body_text: bodyText || stripHtml(bodyHtml),
        body_html: bodyHtml || null,
        from_name: sentFromName,
        from_email: sentFromEmail,
        from_me: true,
        to_emails: finalTo,
        cc_emails: ccEmails,
        bcc_emails: bccEmails,
        is_read: true,
        sent_at: nowIso,
        received_at: null,
        is_draft: false,
        ai_draft_text: null,
        updated_at: nowIso,
      })
      .eq("id", draftMessageId)
      .eq("thread_id", threadId)
      .eq("user_id", supabaseUserId)
      .select("id")
      .maybeSingle();
    insertedMessage = result.data;
    insertError = result.error;
  } else {
    const result = await serviceClient
      .from("mail_messages")
      .insert({
        user_id: supabaseUserId,
        mailbox_id: mailbox.id,
        thread_id: threadId,
        provider: mailbox.provider,
        provider_message_id: providerMessageId,
        subject,
        snippet,
        body_text: bodyText || stripHtml(bodyHtml),
        body_html: bodyHtml || null,
        from_name: sentFromName,
        from_email: sentFromEmail,
        from_me: true,
        to_emails: finalTo,
        cc_emails: ccEmails,
        bcc_emails: bccEmails,
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

  if (insertError) {
    await logAgent(serviceClient, {
      provider: mailbox.provider,
      threadId,
      error: insertError.message,
    });
  }

  await serviceClient
    .from("mail_messages")
    .update({ ai_draft_text: null, updated_at: nowIso })
    .eq("thread_id", threadId)
    .eq("user_id", supabaseUserId)
    .not("ai_draft_text", "is", null);

  await serviceClient
    .from("mail_threads")
    .update({
      last_message_at: nowIso,
      snippet,
      subject: thread.subject ? thread.subject : subject,
      updated_at: nowIso,
    })
    .eq("id", threadId);

  await serviceClient
    .from("drafts")
    .delete()
    .eq("thread_id", thread.provider_thread_id || threadId)
    .eq("platform", mailbox.provider)
    .eq("status", "pending");

  if (learnFromEdits && draftDestinationSetting === "sona_inbox" && aiDraftText) {
    const finalText = bodyText || stripHtml(bodyHtml);
    if (finalText.trim()) {
      const diffSummary = summarizeDraftDiff(aiDraftText, finalText);
      try {
        await serviceClient.from("agent_logs").insert({
          draft_id: null,
          step_name: "learning_event",
          step_detail: JSON.stringify({
            mailbox_id: mailbox.id,
            thread_id: threadId,
            ai_draft_text: aiDraftText,
            final_text: finalText,
            diff_summary: diffSummary,
          }),
          status: "success",
          created_at: nowIso,
        });
        await updateLearningProfile(serviceClient, mailbox.id, supabaseUserId, diffSummary);
      } catch (error) {
        console.warn("[threads/send] learning update failed", error?.message || error);
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      message_id: insertedMessage?.id ?? null,
      provider_message_id: providerMessageId,
      provider: mailbox.provider,
    },
    { status: 200 }
  );
}
