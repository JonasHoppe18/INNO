// supabase/functions/gmail-poll/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { shouldSkipInboxMessage } from "../_shared/inbox-filter.ts";
import { categorizeEmail, EmailCategory } from "../_shared/email-category.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const GMAIL_POLL_SECRET = Deno.env.get("GMAIL_POLL_SECRET");
const INTERNAL_AGENT_SECRET = Deno.env.get("INTERNAL_AGENT_SECRET");
const ENCRYPTION_KEY = Deno.env.get("ENCRYPTION_KEY");
const EDGE_DEBUG_LOGS = Deno.env.get("EDGE_DEBUG_LOGS") === "true";
const MAX_USERS_PER_RUN = Number(Deno.env.get("GMAIL_POLL_MAX_USERS") ?? "5");
const MAX_MESSAGES_PER_USER = Number(Deno.env.get("GMAIL_POLL_MAX_MESSAGES") ?? "20");
const IGNORE_SPAM_FILTER = Deno.env.get("GMAIL_IGNORE_SPAM") === "true";

const emitDebugLog = (...args: Array<unknown>) => {
  if (EDGE_DEBUG_LOGS) console.log(...args);
};

if (!PROJECT_URL) console.warn("PROJECT_URL mangler – gmail-poll kan ikke kalde edge functions.");
if (!SERVICE_ROLE_KEY) console.warn("SERVICE_ROLE_KEY mangler – gmail-poll kan ikke læse tabeller.");
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
  console.warn("Google OAuth config mangler – gmail-poll kan ikke forny tokens.");
if (!GMAIL_POLL_SECRET)
  console.warn("GMAIL_POLL_SECRET mangler – gmail-poll er ikke beskyttet mod offentlige kald.");
if (!INTERNAL_AGENT_SECRET)
  console.warn("INTERNAL_AGENT_SECRET mangler – gmail-poll kan ikke kalde generate-draft-unified.");

const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

type MailAccount = {
  id: string;
  user_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  metadata: { historyId?: string } | null;
};

type GmailMessageMeta = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

type ParsedFrom = {
  name: string | null;
  email: string | null;
};

function parseFromHeader(value = ""): ParsedFrom {
  const emailMatch = value.match(/<([^>]+)>/);
  const email =
    emailMatch?.[1] ??
    (value.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i) ?? [null, null])[1];
  const name = value.replace(/<[^>]+>/, "").replace(/\"/g, "").trim();
  return {
    name: name || null,
    email: email || null,
  };
}

function buildSnippet(input = "", maxLength = 180) {
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}…` : cleaned;
}

async function upsertThread({
  mailboxId,
  userId,
  providerThreadId,
  subject,
  snippet,
  lastMessageAt,
  isRead,
  category,
}: {
  mailboxId: string;
  userId: string;
  providerThreadId: string | null;
  subject: string;
  snippet: string;
  lastMessageAt: string | null;
  isRead: boolean;
  category: EmailCategory;
}) {
  if (!supabase || !providerThreadId) return null;
  const { data } = await supabase
    .from("mail_threads")
    .select("id, unread_count, tags")
    .eq("mailbox_id", mailboxId)
    .eq("provider_thread_id", providerThreadId)
    .maybeSingle();

  if (data?.id) {
    const updates: Record<string, unknown> = {
      subject,
      snippet,
      last_message_at: lastMessageAt,
      updated_at: new Date().toISOString(),
    };
    const existingTags = Array.isArray(data?.tags) ? data.tags : [];
    const hasTags = existingTags.length > 0;
    if (!hasTags || (existingTags[0] === "General" && category !== "General")) {
      updates.tags = [category];
    }
    await supabase.from("mail_threads").update(updates).eq("id", data.id);
    return data.id as string;
  }

  const unreadCount = isRead ? 0 : 1;
  const { data: inserted } = await supabase
    .from("mail_threads")
    .insert({
      user_id: userId,
      mailbox_id: mailboxId,
      provider: "gmail",
      provider_thread_id: providerThreadId,
      subject,
      snippet,
      last_message_at: lastMessageAt,
      unread_count: unreadCount,
      tags: [category],
    })
    .select("id")
    .maybeSingle();
  return (inserted as any)?.id ?? null;
}

async function upsertMessage({
  mailboxId,
  userId,
  threadId,
  providerMessageId,
  subject,
  snippet,
  bodyText,
  fromName,
  fromEmail,
  isRead,
  receivedAt,
}: {
  mailboxId: string;
  userId: string;
  threadId: string | null;
  providerMessageId: string;
  subject: string;
  snippet: string;
  bodyText: string;
  fromName: string | null;
  fromEmail: string | null;
  isRead: boolean;
  receivedAt: string | null;
}) {
  if (!supabase) return;
  const { data } = await supabase
    .from("mail_messages")
    .select("id")
    .eq("mailbox_id", mailboxId)
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    user_id: userId,
    mailbox_id: mailboxId,
    thread_id: threadId,
    provider: "gmail",
    provider_message_id: providerMessageId,
    subject,
    snippet,
    body_text: bodyText,
    from_name: fromName,
    from_email: fromEmail,
    is_read: isRead,
    received_at: receivedAt,
    updated_at: new Date().toISOString(),
  };

  if (data?.id) {
    await supabase.from("mail_messages").update(payload).eq("id", data.id);
  } else {
    await supabase.from("mail_messages").insert(payload);
  }
}

function isAuthorized(req: Request) {
  if (!GMAIL_POLL_SECRET) return false;
  const header =
    req.headers.get("x-cron-secret") ??
    req.headers.get("X-Cron-Secret") ??
    req.headers.get("x-internal-secret") ??
    req.headers.get("X-Internal-Secret");
  return header === GMAIL_POLL_SECRET;
}

async function readJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function maybeDecodeBase64String(value: string): string | null {
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) return null;
  if (value.length % 4 !== 0) return null;
  try {
    const decoded = new TextDecoder().decode(base64ToBytes(value));
    return decoded;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

async function getAesKey(): Promise<CryptoKey | null> {
  if (!ENCRYPTION_KEY) return null;
  const data = new TextEncoder().encode(ENCRYPTION_KEY);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return await crypto.subtle.importKey("raw", hash, { name: "AES-CBC" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptToken(value: string): Promise<string> {
  const key = await getAesKey();
  if (!key) return bytesToBase64(new TextEncoder().encode(value));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    key,
    new TextEncoder().encode(value),
  );
  return `${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptToken(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith("\\x")) {
    const hex = value.slice(2);
    if (hex.length % 2 !== 0) return null;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
    }
    const decoded = new TextDecoder().decode(bytes);
    const maybeBase64 = maybeDecodeBase64String(decoded);
    return maybeBase64 ?? decoded;
  }
  if (value.includes(":")) {
    const key = await getAesKey();
    if (key) {
      const [ivB64, dataB64] = value.split(":");
      if (ivB64 && dataB64) {
        const iv = base64ToBytes(ivB64);
        const encrypted = base64ToBytes(dataB64);
        try {
          const decrypted = await crypto.subtle.decrypt(
            { name: "AES-CBC", iv },
            key,
            encrypted,
          );
          return new TextDecoder().decode(new Uint8Array(decrypted));
        } catch {
          // fallthrough
        }
      }
    }
  }
  try {
    return new TextDecoder().decode(base64ToBytes(value));
  } catch {
    return value;
  }
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binaryString = atob(padded);
  try {
    return decodeURIComponent(escape(binaryString));
  } catch {
    return binaryString;
  }
}

const shopIdCache = new Map<string, string | null>();

async function resolveShopId(userId: string): Promise<string | null> {
  if (!supabase) return null;
  if (shopIdCache.has(userId)) return shopIdCache.get(userId) ?? null;
  const { data, error } = await supabase
    .from("shops")
    .select("id")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const shopId = data?.id ?? null;
  shopIdCache.set(userId, shopId);
  return shopId;
}

function extractPlainTextFromPayload(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const mime = part?.mimeType ?? "";
      const value = extractPlainTextFromPayload(part);
      if (!value) continue;
      if (mime.includes("text/plain")) return value;
      if (mime.includes("text/html")) return value.replace(/<[^>]*>/g, " ").trim();
      return value;
    }
  }
  return "";
}

function findHeader(headers: Array<{ name: string; value: string }> = [], name: string) {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function isSpamLike(meta: GmailMessageMeta): boolean {
  if (IGNORE_SPAM_FILTER) return false;
  const headers = meta.payload?.headers ?? [];
  const from = findHeader(headers, "From");
  const listUnsubscribe = findHeader(headers, "List-Unsubscribe");
  const precedence = findHeader(headers, "Precedence");
  const subject = findHeader(headers, "Subject");

  if (listUnsubscribe) return true;
  if (/bulk|list|auto/i.test(precedence)) return true;
  if (/newsletter/i.test(subject)) return true;
  if (/no[- ]?reply|noreply/i.test(from)) return true;
  return false;
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message = json?.error?.message || json?.message || text || `HTTP ${res.status}`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return json as T;
}

async function refreshAccessToken(account: MailAccount, refreshToken: string): Promise<string> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID/SECRET mangler til token refresh");
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
    throw new Error(`Token refresh fejlede: ${message}`);
  }
  const nextAccessToken = payload?.access_token;
  const expiresIn = Number(payload?.expires_in ?? 0);
  if (!nextAccessToken) throw new Error("Token refresh mangler access_token");

  const nextExpiresAt = new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString();
  const encrypted = await encryptToken(nextAccessToken);
  const { error } = await supabase!
    .from("mail_accounts")
    .update({
      access_token_enc: encrypted,
      token_expires_at: nextExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  if (error) {
    console.warn("gmail-poll: failed to update tokens", error.message);
  }

  return nextAccessToken;
}

async function fetchMessageMeta(id: string, token: string) {
  const url = `${GMAIL_BASE}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe&metadataHeaders=Precedence`;
  return await fetchJson<GmailMessageMeta>(url, token).catch(() => null);
}

async function fetchMessageFull(id: string, token: string) {
  const url = `${GMAIL_BASE}/messages/${id}?format=full`;
  return await fetchJson<any>(url, token);
}

async function listMessages(token: string) {
  const url = new URL(`${GMAIL_BASE}/messages`);
  url.searchParams.set("maxResults", "20");
  url.searchParams.set("q", "is:unread");
  const list = await fetchJson<{ messages?: Array<{ id: string }> }>(url.toString(), token);
  return list.messages ?? [];
}

async function listHistory(token: string, startHistoryId: string) {
  const url = new URL(`${GMAIL_BASE}/history`);
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("historyTypes", "messageAdded");
  url.searchParams.set("labelId", "INBOX");
  return await fetchJson<any>(url.toString(), token);
}

async function callGenerateDraft(
  shopId: string,
  accessToken: string,
  emailData: Record<string, unknown>,
) {
  if (!PROJECT_URL) throw new Error("PROJECT_URL mangler");
  if (!INTERNAL_AGENT_SECRET) {
    throw new Error("INTERNAL_AGENT_SECRET mangler – kan ikke kalde generate-draft-unified");
  }
  const endpoint = `${PROJECT_URL.replace(/\/$/, "")}/functions/v1/generate-draft-unified`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": INTERNAL_AGENT_SECRET,
      ...(SERVICE_ROLE_KEY ? { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } : {}),
    },
    body: JSON.stringify({
      shop_id: shopId,
      provider: "gmail",
      access_token: accessToken,
      email_data: emailData,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`generate-draft-unified fejlede ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (req) => {
  try {
    if (!isAuthorized(req)) return new Response("Unauthorized", { status: 401 });
    if (req.method === "GET") {
      const googleEnvKeys = [];
      for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "GOOGLE_OAUTH_REDIRECT_URI", "NEXT_PUBLIC_GOOGLE_CLIENT_ID"]) {
        if (Deno.env.get(key)) googleEnvKeys.push(key);
      }
      return Response.json({
        hasClientId: Boolean(GOOGLE_CLIENT_ID),
        hasClientSecret: Boolean(GOOGLE_CLIENT_SECRET),
        hasRedirect:
          Boolean(Deno.env.get("GOOGLE_REDIRECT_URI")) ||
          Boolean(Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI")),
        googleEnvKeys,
      });
    }
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    if (!supabase) return new Response("Supabase client missing", { status: 500 });

    const body = await readJson(req);
    const limit = Number(body?.limit ?? MAX_USERS_PER_RUN);

    const { data: accounts, error } = await supabase
      .from("mail_accounts")
      .select("id, user_id, access_token_enc, refresh_token_enc, token_expires_at, metadata")
      .eq("provider", "gmail")
      .limit(limit);
    if (error) {
      throw new Error(error.message);
    }

    const results = [];
    for (const account of accounts ?? []) {
      const userId = account.user_id;
      if (!userId) {
        results.push({ error: "Missing user_id on mail account" });
        continue;
      }

      const shopId = await resolveShopId(userId);

      try {
        const accessToken = await decryptToken(account.access_token_enc);
        const refreshToken = await decryptToken(account.refresh_token_enc);
        if (!accessToken || !refreshToken) {
          throw new Error("Missing access/refresh token.");
        }

        const expiresAt = account.token_expires_at ? Date.parse(account.token_expires_at) : NaN;
        const expiresSoon = !Number.isFinite(expiresAt) || expiresAt - Date.now() <= 60_000;
        const freshAccessToken = expiresSoon
          ? await refreshAccessToken(account as MailAccount, refreshToken)
          : accessToken;

        const historyId = account.metadata?.historyId;
        let messageIds: string[] = [];
        let newHistoryId: string | null = null;

        if (historyId) {
          try {
            const history = await listHistory(freshAccessToken, historyId);
            newHistoryId = history?.historyId ?? null;
            const items = Array.isArray(history?.history) ? history.history : [];
            const ids = new Set<string>();
            for (const entry of items) {
              const added = Array.isArray(entry?.messagesAdded) ? entry.messagesAdded : [];
              for (const item of added) {
                const id = item?.message?.id;
                if (id) ids.add(id);
              }
            }
            messageIds = Array.from(ids);
          } catch (err) {
            console.warn("gmail-poll: history fetch failed, fallback to unread", err?.message || err);
          }
        }

        if (!messageIds.length) {
          const list = await listMessages(freshAccessToken);
          messageIds = list.map((m) => m.id).filter(Boolean) as string[];
        }

        let processed = 0;
        let draftsCreated = 0;
        const metas = await Promise.all(
          messageIds.map((id) => fetchMessageMeta(id, freshAccessToken)),
        );

        const candidates = metas
          .filter((meta): meta is GmailMessageMeta => !!meta?.id && !isSpamLike(meta))
          .slice(0, MAX_MESSAGES_PER_USER);

        for (const meta of candidates) {
          if (processed >= MAX_MESSAGES_PER_USER) break;
          const full = await fetchMessageFull(meta.id!, freshAccessToken);
          const headers = full?.payload?.headers ?? [];
          const from = findHeader(headers, "From");
          const subject = findHeader(headers, "Subject");
          const threadId = full?.threadId ?? meta.threadId ?? null;
          const messageId = full?.id ?? meta.id ?? null;
          const plain = extractPlainTextFromPayload(full?.payload);
          const parsedFrom = parseFromHeader(from);
          const labelIds = Array.isArray(full?.labelIds) ? full.labelIds : [];
          const isRead = !labelIds.includes("UNREAD");
          const internalDate = full?.internalDate ? Number(full.internalDate) : NaN;
          const receivedAt = Number.isFinite(internalDate)
            ? new Date(internalDate).toISOString()
            : null;
          const snippet = buildSnippet(plain);
          if (
            !IGNORE_SPAM_FILTER &&
            shouldSkipInboxMessage({
              from: from || "",
              subject,
              snippet,
              body: plain,
              headers,
            })
          ) {
            continue;
          }
          const category = await categorizeEmail({
            subject,
            body: plain,
            from: from || "",
          });
          const threadRecordId = await upsertThread({
            mailboxId: account.id,
            userId,
            providerThreadId: threadId,
            subject,
            snippet,
            lastMessageAt: receivedAt,
            isRead,
            category,
          });
          if (messageId) {
            await upsertMessage({
              mailboxId: account.id,
              userId,
              threadId: threadRecordId,
              providerMessageId: messageId,
              subject,
              snippet,
              bodyText: plain,
              fromName: parsedFrom.name,
              fromEmail: parsedFrom.email,
              isRead,
              receivedAt,
            });
          }

          if (shopId) {
            await callGenerateDraft(shopId, freshAccessToken, {
              messageId,
              threadId,
              subject,
              from,
              fromEmail: parsedFrom.email,
              body: plain,
            });
            draftsCreated += 1;
          }
          processed += 1;
        }

        if (newHistoryId) {
          const { error: updateError } = await supabase
            .from("mail_accounts")
            .update({
              metadata: { ...(account.metadata ?? {}), historyId: newHistoryId },
              updated_at: new Date().toISOString(),
            })
            .eq("id", account.id);
          if (updateError) {
            console.warn("gmail-poll: failed to update historyId", updateError.message);
          }
        }

        emitDebugLog("gmail-poll", shopId ?? userId, {
          candidates: candidates.length,
          draftsCreated,
        });

        results.push({ shopId, processed, draftsCreated });
      } catch (err: any) {
        console.warn("gmail-poll: account failed", account?.id, err?.message || err);
        results.push({ shopId, error: err?.message || String(err) });
      }
    }

    return Response.json({ success: true, processed: results.length, results });
  } catch (err: any) {
    console.error("gmail-poll error", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || "Ukendt fejl" }), {
      status: typeof err?.status === "number" ? err.status : 500,
    });
  }
});
