// supabase/functions/outlook-poll/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { shouldSkipInboxMessage } from "../_shared/inbox-filter.ts";
import { categorizeEmail, EmailCategory } from "../_shared/email-category.ts";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const EDGE_DEBUG_LOGS = Deno.env.get("EDGE_DEBUG_LOGS") === "true";
const emitDebugLog = (...args: Array<unknown>) => {
  if (EDGE_DEBUG_LOGS) {
    console.log(...args);
  }
};

// Konfiguration (brug samme model som gmail-poll)
const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID");
const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET");
const MICROSOFT_TENANT_ID = Deno.env.get("MICROSOFT_TENANT_ID") ?? "common";
const INTERNAL_AGENT_SECRET = Deno.env.get("INTERNAL_AGENT_SECRET");
const OUTLOOK_POLL_SECRET = Deno.env.get("OUTLOOK_POLL_SECRET") ?? INTERNAL_AGENT_SECRET;
const MAX_USERS_PER_RUN = Number(Deno.env.get("OUTLOOK_POLL_MAX_USERS") ?? "5");
const MAX_MESSAGES_PER_USER = Number(Deno.env.get("OUTLOOK_POLL_MAX_MESSAGES") ?? "20");
const IGNORE_SPAM_FILTER = Deno.env.get("OUTLOOK_IGNORE_SPAM") === "true";

if (!PROJECT_URL) console.warn("PROJECT_URL mangler – outlook-poll kan ikke kalde edge functions.");
if (!SERVICE_ROLE_KEY) console.warn("SERVICE_ROLE_KEY mangler – outlook-poll kan ikke læse tabeller.");
if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
  console.warn("MICROSOFT_CLIENT_ID/SECRET mangler – outlook-poll kan ikke forny tokens.");
}
if (!INTERNAL_AGENT_SECRET)
  console.warn("INTERNAL_AGENT_SECRET mangler – kald til outlook-create-draft-ai kan ikke sikres.");
if (!OUTLOOK_POLL_SECRET)
  console.warn("OUTLOOK_POLL_SECRET mangler – outlook-poll er ikke beskyttet mod offentlige kald.");

const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

type AutomationUser = {
  user_id: string;
};

type PollState = {
  user_id: string;
  last_message_id: string | null;
  last_received_ts: number | null;
};

type GraphMessageMeta = {
  id?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime?: string;
  isDraft?: boolean;
  isRead?: boolean;
};

type MailboxTarget = {
  user_id: string;
  mailbox_id: string;
};

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
      provider: "outlook",
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
  bodyHtml,
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
  bodyHtml: string;
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
    provider: "outlook",
    provider_message_id: providerMessageId,
    subject,
    snippet,
    body_text: bodyText,
    body_html: bodyHtml,
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

denoAssertConfig();

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    if (!isAuthorized(req)) return new Response("Unauthorized", { status: 401 });

  const body = await readJson(req);
  const explicitUsers: string[] | null = Array.isArray(body?.userIds)
    ? body.userIds.filter((id: unknown) => typeof id === "string")
    : typeof body?.userId === "string"
    ? [body.userId]
    : null;

  const autoDraftUsers = await loadAutoDraftUsers(
    Math.min(MAX_USERS_PER_RUN, Number(body?.userLimit ?? MAX_USERS_PER_RUN)),
  );
  const autoDraftSet = new Set(autoDraftUsers.map((row) => row.user_id));

  const targets: MailboxTarget[] = explicitUsers?.length
    ? await loadOutlookMailboxesByUsers(explicitUsers)
    : await loadActiveOutlookMailboxes(
        Math.min(MAX_USERS_PER_RUN, Number(body?.userLimit ?? MAX_USERS_PER_RUN)),
      );

    const results = [] as Array<Record<string, unknown>>;
    for (const target of targets) {
      const outcome = await pollSingleMailbox(target, autoDraftSet.has(target.user_id));
      results.push(outcome);
    }

    return Response.json({ success: true, processed: results.length, results });
  } catch (err: any) {
    console.error("outlook-poll error", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || "Ukendt fejl" }), {
      status: typeof err?.status === "number" ? err.status : 500,
    });
  }
});

// Poller enkelt bruger: henter nye mails og trigger draft-funktion
async function pollSingleMailbox(target: MailboxTarget, shouldDraft: boolean) {
  if (!supabase) throw new Error("Supabase klient ikke konfigureret");
  try {
    const token = await getFreshOutlookAccessToken(target.user_id);
    const shopId = await resolveShopId(target.user_id);
    if (shopId) {
      await syncDraftStatuses(shopId, token);
    }
    const state = await loadPollState(target.user_id);
    const candidates = await fetchCandidateMessages(token, state);

    let handled = 0;
    let draftsCreated = 0;
    let skipped = 0;
    let maxTs = state?.last_received_ts ?? 0;
    for (const msg of candidates) {
      if (handled >= MAX_MESSAGES_PER_USER) break;
      if (!msg?.id) continue;
      const message = await fetchGraphMessageDetail(token, msg.id);
      const subject = message?.subject ?? msg?.subject ?? "";
      const fromAddress = message?.from?.emailAddress?.address ?? "";
      const fromName = message?.from?.emailAddress?.name ?? "";
      const rawBody = message?.body?.content ?? message?.bodyPreview ?? "";
      const bodyHtml =
        (message?.body?.contentType ?? "").toLowerCase() === "html"
          ? String(rawBody ?? "")
          : "";
      const bodyText =
        (message?.body?.contentType ?? "").toLowerCase() === "html"
          ? stripHtml(rawBody)
          : String(rawBody ?? "");
      const receivedAt = message?.receivedDateTime ?? msg?.receivedDateTime ?? null;
      const isRead = msg?.isRead ?? false;
      const snippet = buildSnippet(message?.bodyPreview ?? bodyText);
      const providerThreadId = message?.conversationId ?? null;
      const providerMessageId = message?.id ?? msg.id;
      const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
      if (
        !IGNORE_SPAM_FILTER &&
        shouldSkipInboxMessage({
          from,
          subject,
          snippet,
          body: bodyText,
          headers: [],
        })
      ) {
        continue;
      }
      const category = await categorizeEmail({
        subject,
        body: bodyText,
        from,
      });
      const threadRecordId = await upsertThread({
        mailboxId: target.mailbox_id,
        userId: target.user_id,
        providerThreadId,
        subject,
        snippet,
        lastMessageAt: receivedAt,
        isRead,
        category,
      });
      await upsertMessage({
        mailboxId: target.mailbox_id,
        userId: target.user_id,
        threadId: threadRecordId,
        providerMessageId,
        subject,
        snippet,
        bodyText,
        bodyHtml,
        fromName,
        fromEmail: fromAddress,
        isRead,
        receivedAt,
      });

      if (!shopId || !shouldDraft) {
        handled += 1;
        const ts = Date.parse(receivedAt ?? "") || 0;
        if (ts > maxTs) maxTs = ts;
        continue;
      }
      const outcome = await triggerDraft(shopId, token, msg.id);
      handled += 1;
      const ts = Date.parse(receivedAt ?? "") || 0;
      if (ts > maxTs) maxTs = ts;
      if (outcome?.skipped) {
        skipped += 1;
      } else {
        draftsCreated += 1;
      }
    }

    if (handled && maxTs) {
      await savePollState(
        target.user_id,
        candidates[candidates.length - 1]?.id ?? null,
        maxTs,
      );
    }

    emitDebugLog("outlook-poll", target.user_id, {
      candidates: candidates.length,
      drafts: draftsCreated,
      skipped,
      handled,
      maxReceivedTs: maxTs,
    });

    return {
      supabaseUserId: target.user_id,
      candidates: candidates.length,
      draftsCreated,
      skipped,
      processed: handled,
    };
  } catch (err: any) {
    console.warn("outlook-poll user failed", target.user_id, err?.message || err);
    return {
      supabaseUserId: target.user_id,
      error: err?.message || String(err),
    };
  }
}

async function fetchCandidateMessages(token: string, state: PollState | null) {
  const url = new URL(`${GRAPH_BASE}/me/mailFolders('Inbox')/messages`);
  url.searchParams.set("$top", "50");
  url.searchParams.set("$select", "id,subject,from,receivedDateTime,isDraft,isRead");
  url.searchParams.set("$orderby", "receivedDateTime desc");
  if (state?.last_received_ts) {
    const iso = new Date(state.last_received_ts).toISOString();
    url.searchParams.set("$filter", `receivedDateTime gt ${iso}`);
  }

  const { value = [] } = await fetchJson<{ value?: GraphMessageMeta[] }>(
    url.toString(),
    token,
  );

  const lastTs = state?.last_received_ts ?? 0;
  const filtered = value
    .filter((m) => !m?.isDraft)
    .filter((m) => {
      if (IGNORE_SPAM_FILTER) return true;
      const from = (m?.from?.emailAddress?.address || "").toLowerCase();
      const subject = (m?.subject || "").toLowerCase();
      if (from.includes("no-reply") || from.includes("noreply")) return false;
      if (subject.includes("newsletter")) return false;
      return true;
    })
    .filter((m) => {
      const ts = Date.parse(m?.receivedDateTime ?? "") || 0;
      if (!lastTs) return true;
      return ts > lastTs;
    })
    .sort((a, b) => {
      const ta = Date.parse(a.receivedDateTime ?? "") || 0;
      const tb = Date.parse(b.receivedDateTime ?? "") || 0;
      return ta - tb;
    });

  return filtered;
}

function stripHtml(input = ""): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchGraphMessageDetail(token: string, messageId: string) {
  const url = new URL(`${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set(
    "$select",
    "id,subject,from,body,bodyPreview,conversationId,internetMessageId,receivedDateTime",
  );
  return await fetchJson<any>(url.toString(), token);
}

async function triggerDraft(
  shopId: string,
  accessToken: string,
  messageId: string,
) {
  if (!PROJECT_URL) throw new Error("PROJECT_URL mangler");
  const endpoint = `${PROJECT_URL.replace(/\/$/, "")}/functions/v1/generate-draft-unified`;

  const message = await fetchGraphMessageDetail(accessToken, messageId);
  const subject = message?.subject ?? "";
  const fromAddress = message?.from?.emailAddress?.address ?? "";
  const fromName = message?.from?.emailAddress?.name ?? "";
  const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
  const rawBody = message?.body?.content ?? message?.bodyPreview ?? "";
  const body =
    (message?.body?.contentType ?? "").toLowerCase() === "html"
      ? stripHtml(rawBody)
      : String(rawBody ?? "");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVICE_ROLE_KEY ? { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } : {}),
    },
    body: JSON.stringify({
      provider: "outlook",
      shop_id: shopId,
      access_token: accessToken,
      email_data: {
        messageId: message?.internetMessageId ?? message?.id ?? messageId,
        threadId: message?.conversationId ?? null,
        subject,
        from,
        fromEmail: fromAddress,
        body,
        headers: [],
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`generate-draft-unified fejlede ${res.status}: ${text}`);
  }
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return null;
}

function encodeToken(value: string): string {
  return btoa(value);
}

function decodeToken(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("\\x")) {
    const hex = value.slice(2);
    if (!hex || hex.length % 2 !== 0) return null;
    let out = "";
    for (let i = 0; i < hex.length; i += 2) {
      out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
    }
    const maybeBase64 = decodeBase64String(out);
    return maybeBase64 ?? out;
  }
  try {
    return atob(value);
  } catch {
    return value;
  }
}

function decodeBase64String(value: string): string | null {
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) return null;
  if (value.length % 4 !== 0) return null;
  try {
    return atob(value);
  } catch {
    return null;
  }
}

async function getFreshOutlookAccessToken(userId: string): Promise<string> {
  if (!supabase) throw new Error("Supabase klient ikke konfigureret");
  const { data, error } = await supabase
    .from("mail_accounts")
    .select("access_token_enc, refresh_token_enc, token_expires_at")
    .eq("user_id", userId)
    .eq("provider", "outlook")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const accessToken = decodeToken((data as any)?.access_token_enc ?? null);
  const refreshToken = decodeToken((data as any)?.refresh_token_enc ?? null);
  if (!accessToken || !refreshToken) {
    throw new Error("Ingen Outlook credentials fundet for user");
  }

  const expiresAt =
    typeof (data as any)?.token_expires_at === "string"
      ? Date.parse((data as any).token_expires_at)
      : NaN;
  const expiresSoon = !Number.isFinite(expiresAt) || expiresAt - Date.now() <= 60_000;
  if (!expiresSoon) return accessToken;

  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
    throw new Error("Microsoft OAuth config mangler til token refresh");
  }

  const params = new URLSearchParams();
  params.set("client_id", MICROSOFT_CLIENT_ID);
  params.set("client_secret", MICROSOFT_CLIENT_SECRET);
  params.set("refresh_token", refreshToken);
  params.set("grant_type", "refresh_token");
  params.set("scope", "offline_access Mail.ReadWrite User.Read");

  const res = await fetch(
    `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.error_description || payload?.error || `HTTP ${res.status}`;
    throw new Error(`Token refresh fejlede: ${message}`);
  }

  const nextAccessToken = payload?.access_token;
  const nextRefreshToken = payload?.refresh_token;
  const expiresIn = Number(payload?.expires_in ?? 0);
  if (!nextAccessToken) throw new Error("Token refresh mangler access_token");
  const nextExpiresAt = new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString();

  const updatePayload: Record<string, unknown> = {
    access_token_enc: encodeToken(nextAccessToken),
    token_expires_at: nextExpiresAt,
  };
  if (nextRefreshToken) {
    updatePayload.refresh_token_enc = encodeToken(nextRefreshToken);
  }

  const { error: updateError } = await supabase
    .from("mail_accounts")
    .update(updatePayload)
    .eq("user_id", userId)
    .eq("provider", "outlook");
  if (updateError) {
    console.warn("outlook-poll: failed to update tokens", updateError.message);
  }

  return nextAccessToken;
}

async function loadAutoDraftUsers(limit: number): Promise<AutomationUser[]> {
  if (!supabase) return [];
  const { data: automation, error } = await supabase
    .from("agent_automation")
    .select("user_id")
    .eq("auto_draft_enabled", true)
    .limit(limit);
  if (error || !automation?.length) return [];
  return automation
    .map((row) => row.user_id)
    .filter((id: unknown): id is string => typeof id === "string")
    .map((id) => ({ user_id: id }));
}

async function loadActiveOutlookMailboxes(limit: number): Promise<MailboxTarget[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("mail_accounts")
    .select("id,user_id")
    .eq("provider", "outlook")
    .eq("status", "active")
    .limit(limit);
  if (error || !data?.length) return [];
  return data
    .filter((row) => row?.id && row?.user_id)
    .map((row) => ({
      mailbox_id: row.id as string,
      user_id: row.user_id as string,
    }));
}

async function loadOutlookMailboxesByUsers(userIds: string[]): Promise<MailboxTarget[]> {
  if (!supabase || !userIds.length) return [];
  const { data, error } = await supabase
    .from("mail_accounts")
    .select("id,user_id")
    .eq("provider", "outlook")
    .eq("status", "active")
    .in("user_id", userIds);
  if (error || !data?.length) return [];
  return data
    .filter((row) => row?.id && row?.user_id)
    .map((row) => ({
      mailbox_id: row.id as string,
      user_id: row.user_id as string,
    }));
}

async function loadPollState(userId: string): Promise<PollState | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("outlook_poll_state")
    .select("clerk_user_id,last_message_id,last_received_ts")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  if (!data) return null;
  const rawTs = (data as any).last_received_ts;
  const parsedTs =
    typeof rawTs === "number"
      ? rawTs
      : typeof rawTs === "string"
      ? Number(rawTs)
      : null;
  return {
    user_id: (data as any).clerk_user_id,
    last_message_id: (data as any).last_message_id ?? null,
    last_received_ts: Number.isFinite(parsedTs) ? Number(parsedTs) : null,
  };
}

async function savePollState(
  userId: string,
  lastMessageId: string | null,
  lastReceivedTs: number,
) {
  if (!supabase) return;
  await supabase.from("outlook_poll_state").upsert({
    clerk_user_id: userId,
    last_message_id: lastMessageId,
    last_received_ts: lastReceivedTs,
    updated_at: new Date().toISOString(),
  });
}

async function resolveShopId(ownerUserId: string): Promise<string | null> {
  if (!supabase || !ownerUserId) return null;
  const { data, error } = await supabase
    .from("shops")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("outlook-poll: failed to resolve shop id", error.message);
  }
  return data?.id ?? null;
}

async function outlookDraftIsDraft(token: string, draftId: string): Promise<boolean | null> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(draftId)}?$select=id,isDraft`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.status === 404) return false;
  if (!res.ok) {
    const message = json?.error?.message || json?.message || text || `HTTP ${res.status}`;
    console.warn("outlook-poll: draft check failed", draftId, message);
    return null;
  }
  return json?.isDraft === true;
}

async function syncDraftStatuses(shopId: string, token: string) {
  if (!supabase) return;
  const { data, error } = await supabase
    .from("drafts")
    .select("id,draft_id")
    .eq("shop_id", shopId)
    .eq("platform", "outlook")
    .eq("status", "pending")
    .not("draft_id", "is", null);
  if (error) {
    console.warn("outlook-poll: failed to load pending drafts", error.message);
    return;
  }
  const toMarkSent: string[] = [];
  for (const row of data ?? []) {
    const draftId = (row as any)?.draft_id;
    if (!draftId) continue;
    const isDraft = await outlookDraftIsDraft(token, String(draftId));
    if (isDraft === false) {
      toMarkSent.push((row as any).id);
    }
  }
  if (!toMarkSent.length) return;
  const { error: updateError } = await supabase
    .from("drafts")
    .update({ status: "sent" })
    .in("id", toMarkSent);
  if (updateError) {
    console.warn("outlook-poll: failed to update draft status", updateError.message);
  }
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

function isAuthorized(req: Request) {
  if (!OUTLOOK_POLL_SECRET) return false;
  const header =
    req.headers.get("x-cron-secret") ??
    req.headers.get("X-Cron-Secret") ??
    req.headers.get("x-internal-secret") ??
    req.headers.get("X-Internal-Secret");
  return header === OUTLOOK_POLL_SECRET;
}

async function readJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function denoAssertConfig() {
  // no-op placeholder for parity med gmail-poll
}
