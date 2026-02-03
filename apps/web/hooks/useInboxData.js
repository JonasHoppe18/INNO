import { useAuth, useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { getMessageTimestamp } from "@/components/inbox/inbox-utils";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidUuid = (value) => typeof value === "string" && UUID_REGEX.test(value);

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const base64UrlToBase64 = (input) => {
  if (typeof input !== "string" || !input.length) {
    return "";
  }
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return normalized.padEnd(normalized.length + padding, "=");
};

const decodeBase64 = (input) => {
  let result = "";
  let buffer = 0;
  let bits = 0;
  for (const char of input) {
    if (char === "=") break;
    const value = base64Alphabet.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      const byte = (buffer >> bits) & 0xff;
      result += String.fromCharCode(byte);
    }
  }
  return result;
};

const decodeJwtPayload = (token) => {
  if (typeof token !== "string" || !token.includes(".")) {
    return null;
  }
  const [, payloadPart] = token.split(".");
  if (!payloadPart) return null;
  try {
    const normalized = base64UrlToBase64(payloadPart);
    const decoded = decodeBase64(normalized);
    return JSON.parse(decoded);
  } catch (_err) {
    return null;
  }
};

const SUPABASE_TEMPLATE =
  process.env.NEXT_PUBLIC_CLERK_SUPABASE_TEMPLATE?.trim() || "supabase";

const makeListKey = (list = [], key = "id") =>
  list.map((item) => item?.[key] ?? "").join("|");

export function deriveThreadsFromMessages(messages = []) {
  const groups = new Map();
  messages.forEach((message) => {
    const threadId = message.thread_id || message.id;
    if (!threadId) return;
    if (!groups.has(threadId)) {
      groups.set(threadId, []);
    }
    groups.get(threadId).push(message);
  });

  return Array.from(groups.entries()).map(([threadId, threadMessages]) => {
    const sorted = [...threadMessages].sort((a, b) => {
      const aTime = new Date(getMessageTimestamp(a)).getTime();
      const bTime = new Date(getMessageTimestamp(b)).getTime();
      return bTime - aTime;
    });
    const latest = sorted[0] || {};
    const unreadCount = threadMessages.filter((message) => !message.is_read).length;
    return {
      id: threadId,
      user_id: latest.user_id ?? null,
      mailbox_id: latest.mailbox_id ?? null,
      provider: latest.provider ?? null,
      provider_thread_id: null,
      subject: latest.subject ?? "",
      snippet: latest.snippet ?? "",
      last_message_at: getMessageTimestamp(latest),
      unread_count: unreadCount,
      created_at: latest.created_at ?? null,
      updated_at: latest.updated_at ?? null,
    };
  });
}

export function useThreads(options = {}) {
  const { initialData = [], fallbackMessages = [], enabled = false } = options;
  const supabase = useClerkSupabase();
  const { getToken } = useAuth();
  const { user } = useUser();

  const seededData = useMemo(() => {
    if (initialData?.length) return initialData;
    if (fallbackMessages?.length) return deriveThreadsFromMessages(fallbackMessages);
    return [];
  }, [initialData, fallbackMessages]);

  const [data, setData] = useState(seededData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const seededKey = useMemo(() => makeListKey(seededData), [seededData]);
  const seededKeyRef = useRef(seededKey);

  const ensureUserId = useCallback(async () => {
    const metadataUuid = user?.publicMetadata?.supabase_uuid;
    if (isValidUuid(metadataUuid)) return metadataUuid;

    if (typeof getToken === "function") {
      try {
        const templateToken = await getToken({ template: SUPABASE_TEMPLATE });
        const payload = decodeJwtPayload(templateToken);
        const claimUuid =
          typeof payload?.supabase_user_id === "string" ? payload.supabase_user_id : null;
        const sub = typeof payload?.sub === "string" ? payload.sub : null;
        const candidate = isValidUuid(claimUuid) ? claimUuid : sub;
        if (isValidUuid(candidate)) return candidate;
      } catch (tokenError) {
        console.warn("useThreads: clerk token missing supabase uuid", tokenError);
      }
    }

    if (!supabase || !user?.id) {
      throw new Error("Supabase user ID is not ready yet.");
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("clerk_user_id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    const candidate = profile?.user_id;
    if (isValidUuid(candidate)) return candidate;
    throw new Error("Supabase user ID is not ready yet.");
  }, [getToken, supabase, user?.id, user?.publicMetadata?.supabase_uuid]);

  const fetchThreads = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const userId = await ensureUserId();
      const { data: rows, error: queryError } = await supabase
        .from("mail_threads")
        .select(
          "id, user_id, mailbox_id, provider, provider_thread_id, subject, snippet, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, created_at, updated_at"
        )
        .eq("user_id", userId)
        .order("last_message_at", { ascending: false, nullsLast: true });
      if (queryError) throw queryError;
      setData(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Could not load threads."));
    } finally {
      setLoading(false);
    }
  }, [ensureUserId, supabase]);

  useEffect(() => {
    if (!enabled) return;
    fetchThreads();
  }, [enabled, fetchThreads]);

  useEffect(() => {
    if (!seededData?.length) return;
    if (seededKeyRef.current === seededKey) return;
    seededKeyRef.current = seededKey;
    setData(seededData);
  }, [seededData, seededKey]);

  return { data, loading, error, refresh: fetchThreads };
}

export function useThreadMessages(threadId, options = {}) {
  const { initialData = [], enabled = false } = options;
  const supabase = useClerkSupabase();
  const { getToken } = useAuth();
  const { user } = useUser();

  const seeded = useMemo(() => {
    if (!threadId) return [];
    if (!initialData?.length) return [];
    return initialData.filter((message) => (message.thread_id || message.id) === threadId);
  }, [initialData, threadId]);

  const [data, setData] = useState(seeded);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const seededKey = useMemo(() => makeListKey(seeded), [seeded]);
  const seededKeyRef = useRef(seededKey);

  const ensureUserId = useCallback(async () => {
    const metadataUuid = user?.publicMetadata?.supabase_uuid;
    if (isValidUuid(metadataUuid)) return metadataUuid;
    if (typeof getToken === "function") {
      try {
        const templateToken = await getToken({ template: SUPABASE_TEMPLATE });
        const payload = decodeJwtPayload(templateToken);
        const claimUuid =
          typeof payload?.supabase_user_id === "string" ? payload.supabase_user_id : null;
        const sub = typeof payload?.sub === "string" ? payload.sub : null;
        const candidate = isValidUuid(claimUuid) ? claimUuid : sub;
        if (isValidUuid(candidate)) return candidate;
      } catch (tokenError) {
        console.warn("useThreadMessages: clerk token missing supabase uuid", tokenError);
      }
    }
    if (!supabase || !user?.id) {
      throw new Error("Supabase user ID is not ready yet.");
    }
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("clerk_user_id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    const candidate = profile?.user_id;
    if (isValidUuid(candidate)) return candidate;
    throw new Error("Supabase user ID is not ready yet.");
  }, [getToken, supabase, user?.id, user?.publicMetadata?.supabase_uuid]);

  const fetchMessages = useCallback(async () => {
    if (!supabase || !threadId) return;
    setLoading(true);
    setError(null);
    try {
      const userId = await ensureUserId();
      const { data: rows, error: queryError } = await supabase
        .from("mail_messages")
        .select(
          "id, mailbox_id, thread_id, subject, snippet, body_text, body_html, from_name, from_email, to_emails, cc_emails, bcc_emails, is_read, received_at, sent_at, created_at, ai_draft_text"
        )
        .eq("user_id", userId)
        .eq("thread_id", threadId)
        .order("received_at", { ascending: true, nullsLast: true });
      if (queryError) throw queryError;
      setData(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Could not load messages."));
    } finally {
      setLoading(false);
    }
  }, [ensureUserId, supabase, threadId]);

  useEffect(() => {
    if (!enabled) return;
    fetchMessages();
  }, [enabled, fetchMessages]);

  useEffect(() => {
    if (!seeded?.length) {
      setData([]);
      return;
    }
    if (seededKeyRef.current === seededKey) return;
    seededKeyRef.current = seededKey;
    setData(seeded);
  }, [seeded, seededKey]);

  return { data, loading, error, refresh: fetchMessages };
}

export function useThreadAttachments(messageIds = [], options = {}) {
  const { initialData = [], enabled = false } = options;
  const supabase = useClerkSupabase();
  const { getToken } = useAuth();
  const { user } = useUser();

  const seeded = useMemo(() => {
    if (!initialData?.length) return [];
    if (!messageIds?.length) return [];
    return initialData.filter((attachment) => messageIds.includes(attachment.message_id));
  }, [initialData, messageIds]);

  const [data, setData] = useState(seeded);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const seededKey = useMemo(() => makeListKey(seeded), [seeded]);
  const seededKeyRef = useRef(seededKey);

  const ensureUserId = useCallback(async () => {
    const metadataUuid = user?.publicMetadata?.supabase_uuid;
    if (isValidUuid(metadataUuid)) return metadataUuid;
    if (typeof getToken === "function") {
      try {
        const templateToken = await getToken({ template: SUPABASE_TEMPLATE });
        const payload = decodeJwtPayload(templateToken);
        const claimUuid =
          typeof payload?.supabase_user_id === "string" ? payload.supabase_user_id : null;
        const sub = typeof payload?.sub === "string" ? payload.sub : null;
        const candidate = isValidUuid(claimUuid) ? claimUuid : sub;
        if (isValidUuid(candidate)) return candidate;
      } catch (tokenError) {
        console.warn("useThreadAttachments: clerk token missing supabase uuid", tokenError);
      }
    }
    if (!supabase || !user?.id) {
      throw new Error("Supabase user ID is not ready yet.");
    }
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("clerk_user_id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    const candidate = profile?.user_id;
    if (isValidUuid(candidate)) return candidate;
    throw new Error("Supabase user ID is not ready yet.");
  }, [getToken, supabase, user?.id, user?.publicMetadata?.supabase_uuid]);

  const fetchAttachments = useCallback(async () => {
    if (!supabase || !messageIds?.length) return;
    setLoading(true);
    setError(null);
    try {
      const userId = await ensureUserId();
      const { data: rows, error: queryError } = await supabase
        .from("mail_attachments")
        .select(
          "id, user_id, mailbox_id, message_id, provider, provider_attachment_id, filename, mime_type, size_bytes, storage_path, created_at"
        )
        .eq("user_id", userId)
        .in("message_id", messageIds);
      if (queryError) throw queryError;
      setData(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Could not load attachments."));
    } finally {
      setLoading(false);
    }
  }, [ensureUserId, messageIds, supabase]);

  useEffect(() => {
    if (!enabled) return;
    fetchAttachments();
  }, [enabled, fetchAttachments]);

  useEffect(() => {
    if (!seeded?.length) {
      setData([]);
      return;
    }
    if (seededKeyRef.current === seededKey) return;
    seededKeyRef.current = seededKey;
    setData(seeded);
  }, [seeded, seededKey]);

  return { data, loading, error, refresh: fetchAttachments };
}
