import { useAuth, useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClerkSupabase } from "@/lib/useClerkSupabase";
import { getMessageTimestamp } from "@/components/inbox/inbox-utils";

const EMPTY_LIST = [];

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

const resolveScope = async ({ supabase, user, getToken, logLabel }) => {
  const metadataUuid = user?.publicMetadata?.supabase_uuid;
  let supabaseUserId = isValidUuid(metadataUuid) ? metadataUuid : null;

  if (!supabase || !user?.id) {
    return {
      supabaseUserId: null,
      workspaceId: null,
    };
  }

  if (!supabaseUserId && typeof getToken === "function") {
    try {
      const templateToken = await getToken({ template: SUPABASE_TEMPLATE });
      const payload = decodeJwtPayload(templateToken);
      const claimUuid =
        typeof payload?.supabase_user_id === "string" ? payload.supabase_user_id : null;
      const sub = typeof payload?.sub === "string" ? payload.sub : null;
      const candidate = isValidUuid(claimUuid) ? claimUuid : sub;
      if (isValidUuid(candidate)) {
        supabaseUserId = candidate;
      }
    } catch (tokenError) {
      console.warn(`${logLabel}: clerk token missing supabase uuid`, tokenError);
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;

  if (!supabaseUserId) {
    const candidate = profile?.user_id;
    if (isValidUuid(candidate)) {
      supabaseUserId = candidate;
    }
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("clerk_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (membershipError) throw membershipError;

  if (!supabaseUserId) {
    console.warn(`${logLabel}: supabase user id not ready, continuing with workspace scope only`);
  }

  return {
    supabaseUserId,
    workspaceId: membership?.workspace_id ?? null,
  };
};

const applyClientScope = (
  query,
  scope,
  { workspaceColumn = "workspace_id", userColumn = "user_id" } = {}
) => {
  if (scope?.workspaceId && workspaceColumn) return query.eq(workspaceColumn, scope.workspaceId);
  if (scope?.supabaseUserId && userColumn) return query.eq(userColumn, scope.supabaseUserId);
  return query;
};

const resolveScopedMailboxIds = async (supabase, scope) => {
  let query = supabase.from("mail_accounts").select("id");
  query = applyClientScope(query, scope);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => row.id).filter(Boolean);
};

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
  const {
    initialData = EMPTY_LIST,
    fallbackMessages = EMPTY_LIST,
    enabled = false,
  } = options;
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

  const fetchThreads = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const scope = await resolveScope({
        supabase,
        user,
        getToken,
        logLabel: "useThreads",
      });
      let request = supabase
        .from("mail_threads")
        .select(
          "id, user_id, mailbox_id, provider, provider_thread_id, subject, snippet, customer_name, customer_email, customer_last_inbound_at, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, classification_key, classification_confidence, classification_reason, created_at, updated_at"
        )
        .order("last_message_at", { ascending: false, nullsLast: true });
      request = applyClientScope(request, scope);
      let { data: rows, error: queryError } = await request;
      if (
        queryError &&
        /customer_name|customer_email|customer_last_inbound_at/i.test(String(queryError.message || ""))
      ) {
        let fallbackRequest = supabase
          .from("mail_threads")
          .select(
            "id, user_id, mailbox_id, provider, provider_thread_id, subject, snippet, last_message_at, unread_count, is_read, status, assignee_id, priority, tags, classification_key, classification_confidence, classification_reason, created_at, updated_at"
          )
          .order("last_message_at", { ascending: false, nullsLast: true });
        fallbackRequest = applyClientScope(fallbackRequest, scope);
        const fallback = await fallbackRequest;
        rows = fallback.data;
        queryError = fallback.error;
      }
      if (queryError) throw queryError;
      setData(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Could not load threads."));
    } finally {
      setLoading(false);
    }
  }, [getToken, supabase, user]);

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
  const { initialData = EMPTY_LIST, enabled = false } = options;
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

  const fetchMessages = useCallback(async () => {
    if (!supabase || !threadId) return;
    setLoading(true);
    setError(null);
    try {
      // Prefer server-side scoped fetch for thread bodies.
      // This avoids client-side scope/RLS mismatches on older rows.
      try {
        const response = await fetch(`/api/inbox/threads/${threadId}/messages`, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });
        if (response.ok) {
          const payload = await response.json().catch(() => null);
          const rows = Array.isArray(payload?.messages) ? payload.messages : [];
          if (!rows.length) {
            console.warn("[useThreadMessages] tomt server-resultat for tråd:", threadId);
          }
          setData(rows);
          return;
        }
      } catch (_serverFetchError) {
        // Fallback to existing client query path below.
      }

      const scope = await resolveScope({
        supabase,
        user,
        getToken,
        logLabel: "useThreadMessages",
      });
      const loadRelatedThreadIds = async () => {
        const normalizeSubject = (value) =>
          String(value || "")
            .toLowerCase()
            .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, "")
            .replace(/\s+/g, " ")
            .trim();

        let selectedThreadQuery = supabase
          .from("mail_threads")
          .select("id, provider_thread_id, mailbox_id, subject")
          .eq("id", threadId)
          .limit(1)
          .maybeSingle();
        selectedThreadQuery = applyClientScope(selectedThreadQuery, scope);
        let { data: selectedThread, error: selectedThreadError } = await selectedThreadQuery;

        const scopeWorkspaceError =
          Boolean(selectedThreadError) &&
          /workspace_id/i.test(String(selectedThreadError?.message || ""));
        if (scopeWorkspaceError || !selectedThread?.id) {
          const unscopedSelected = await supabase
            .from("mail_threads")
            .select("id, provider_thread_id, mailbox_id, subject")
            .eq("id", threadId)
            .limit(1)
            .maybeSingle();
          selectedThread = unscopedSelected.data;
          selectedThreadError = unscopedSelected.error;
        }

        if (selectedThreadError || !selectedThread?.id) return [threadId];

        const providerThreadId = String(selectedThread?.provider_thread_id || "").trim();
        const mailboxId = String(selectedThread?.mailbox_id || "").trim();
        const normalizedSubject = normalizeSubject(selectedThread?.subject);
        if (!mailboxId) return [threadId];

        let siblingRows = [];
        let siblingsError = null;

        if (providerThreadId) {
          let siblingsQuery = supabase
            .from("mail_threads")
            .select("id")
            .eq("provider_thread_id", providerThreadId)
            .eq("mailbox_id", mailboxId)
            .order("created_at", { ascending: true });
          siblingsQuery = applyClientScope(siblingsQuery, scope);
          const siblingsResult = await siblingsQuery;
          siblingRows = siblingsResult.data;
          siblingsError = siblingsResult.error;

          const siblingsScopeWorkspaceError =
            Boolean(siblingsError) &&
            /workspace_id/i.test(String(siblingsError?.message || ""));
          if (
            siblingsScopeWorkspaceError ||
            !Array.isArray(siblingRows) ||
            siblingRows.length === 0
          ) {
            const unscopedSiblings = await supabase
              .from("mail_threads")
              .select("id")
              .eq("provider_thread_id", providerThreadId)
              .eq("mailbox_id", mailboxId)
              .order("created_at", { ascending: true });
            siblingRows = unscopedSiblings.data;
            siblingsError = unscopedSiblings.error;
          }
        }

        // Fallback for legacy/split threads where provider_thread_id is missing or unreliable:
        // group by normalized subject inside same mailbox.
        if ((!Array.isArray(siblingRows) || siblingRows.length <= 1) && normalizedSubject) {
          let subjectQuery = supabase
            .from("mail_threads")
            .select("id, subject")
            .eq("mailbox_id", mailboxId)
            .order("created_at", { ascending: false })
            .limit(2000);
          subjectQuery = applyClientScope(subjectQuery, scope);
          let subjectRowsResult = await subjectQuery;
          let subjectRows = subjectRowsResult.data;
          let subjectError = subjectRowsResult.error;
          const subjectScopeWorkspaceError =
            Boolean(subjectError) &&
            /workspace_id/i.test(String(subjectError?.message || ""));
          if (
            subjectScopeWorkspaceError ||
            !Array.isArray(subjectRows) ||
            subjectRows.length === 0
          ) {
            const unscopedSubjectRows = await supabase
              .from("mail_threads")
              .select("id, subject")
              .eq("mailbox_id", mailboxId)
              .order("created_at", { ascending: false })
              .limit(2000);
            subjectRows = unscopedSubjectRows.data;
            subjectError = unscopedSubjectRows.error;
          }
          if (!subjectError && Array.isArray(subjectRows)) {
            const matchedBySubject = subjectRows.filter(
              (row) => normalizeSubject(row?.subject) === normalizedSubject
            );
            if (matchedBySubject.length > 0) {
              siblingRows = [
                ...(Array.isArray(siblingRows) ? siblingRows : []),
                ...matchedBySubject.map((row) => ({ id: row.id })),
              ];
            }
          }
        }

        if (siblingsError || !Array.isArray(siblingRows) || siblingRows.length === 0) return [threadId];

        const ids = Array.from(
          new Set(
            siblingRows
              .map((row) => String(row?.id || "").trim())
              .filter(Boolean)
          )
        );
        if (!ids.length) return [threadId];
        if (ids.includes(String(threadId))) return ids;
        return [threadId, ...ids];
      };

      const relatedThreadIds = await loadRelatedThreadIds();

      const runFullQuery = async (scoped = true) => {
        let request = supabase
          .from("mail_messages")
          .select(
            "id, user_id, mailbox_id, thread_id, provider_message_id, subject, snippet, body_text, body_html, clean_body_text, clean_body_html, quoted_body_text, quoted_body_html, from_name, from_email, extracted_customer_name, extracted_customer_email, extracted_customer_fields, sender_identity_source, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at, ai_draft_text"
          )
          .order("received_at", { ascending: true, nullsLast: true });
        if (relatedThreadIds.length > 1) {
          request = request.in("thread_id", relatedThreadIds);
        } else {
          request = request.eq("thread_id", threadId);
        }
        if (scoped) request = applyClientScope(request, scope);
        return request;
      };

      const runLeanQuery = async (scoped = true) => {
        let request = supabase
          .from("mail_messages")
          .select(
            "id, user_id, mailbox_id, thread_id, subject, snippet, body_text, body_html, from_name, from_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at"
          )
          .order("received_at", { ascending: true, nullsLast: true });
        if (relatedThreadIds.length > 1) {
          request = request.in("thread_id", relatedThreadIds);
        } else {
          request = request.eq("thread_id", threadId);
        }
        if (scoped) request = applyClientScope(request, scope);
        return request;
      };

      let { data: rows, error: queryError } = await runFullQuery(true);
      const shouldRetryUnscopedFull =
        !queryError &&
        Array.isArray(rows) &&
        rows.length === 0 &&
        Boolean(scope?.workspaceId);
      const workspaceColumnError =
        Boolean(queryError) && /workspace_id/i.test(String(queryError?.message || ""));
      if (shouldRetryUnscopedFull || workspaceColumnError) {
        const unscoped = await runFullQuery(false);
        rows = unscoped.data;
        queryError = unscoped.error;
      }
      // Ældre beskeder kan have NULL workspace_id — prøv user_id filter som fallback
      if (!queryError && Array.isArray(rows) && rows.length === 0 && scope?.supabaseUserId) {
        let userRequest = supabase
          .from("mail_messages")
          .select(
            "id, user_id, mailbox_id, thread_id, provider_message_id, subject, snippet, body_text, body_html, clean_body_text, clean_body_html, quoted_body_text, quoted_body_html, from_name, from_email, to_emails, cc_emails, bcc_emails, from_me, is_draft, is_read, received_at, sent_at, created_at, ai_draft_text"
          )
          .eq("user_id", scope.supabaseUserId)
          .order("received_at", { ascending: true, nullsLast: true });
        if (relatedThreadIds.length > 1) {
          userRequest = userRequest.in("thread_id", relatedThreadIds);
        } else {
          userRequest = userRequest.eq("thread_id", threadId);
        }
        const userResult = await userRequest;
        if (!userResult.error && Array.isArray(userResult.data) && userResult.data.length > 0) {
          rows = userResult.data;
          queryError = null;
        }
      }
      if (
        queryError &&
        /ai_draft_text|provider_message_id|body_html|clean_body_text|clean_body_html|quoted_body_text|quoted_body_html|extracted_customer_email|extracted_customer_fields|sender_identity_source/i.test(
          queryError.message || ""
        )
      ) {
        const fallback = await runLeanQuery(true);
        rows = fallback.data;
        queryError = fallback.error;
        const shouldRetryUnscopedLean =
          !queryError &&
          Array.isArray(rows) &&
          rows.length === 0 &&
          Boolean(scope?.workspaceId);
        const leanWorkspaceColumnError =
          Boolean(queryError) && /workspace_id/i.test(String(queryError?.message || ""));
        if (shouldRetryUnscopedLean || leanWorkspaceColumnError) {
          const unscopedLean = await runLeanQuery(false);
          rows = unscopedLean.data;
          queryError = unscopedLean.error;
        }
      }
      if (queryError) throw queryError;
      if (!rows?.length) {
        console.warn("[useThreadMessages] tom resultat for tråd:", threadId, "scope:", scope);
      }
      setData(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error("[useThreadMessages] fejl for tråd:", threadId, err);
      setError(err instanceof Error ? err : new Error("Could not load messages."));
    } finally {
      setLoading(false);
    }
  }, [getToken, supabase, threadId, user]);

  useEffect(() => {
    if (!enabled) return;
    fetchMessages();
  }, [enabled, fetchMessages]);

  useEffect(() => {
    if (!threadId) {
      setData((prev) => (prev?.length ? [] : prev));
      return;
    }
    // Only reset when switching thread. Don't keep clearing when seeded is empty,
    // otherwise fetched messages for older threads get wiped on every render.
    seededKeyRef.current = seededKey;
    setData(seeded);
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    if (!seeded?.length) return;
    if (seededKeyRef.current === seededKey) return;
    seededKeyRef.current = seededKey;
    setData(seeded);
  }, [seeded, seededKey, threadId]);

  return { data, loading, error, refresh: fetchMessages };
}

export function useThreadPreviewMessages(threadIds = [], options = {}) {
  const { enabled = false } = options;
  const supabase = useClerkSupabase();
  const { getToken } = useAuth();
  const { user } = useUser();

  const normalizedThreadIds = useMemo(
    () => Array.from(new Set((threadIds || []).filter(Boolean))),
    [threadIds]
  );
  const threadKey = useMemo(() => normalizedThreadIds.join("|"), [normalizedThreadIds]);

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchMessages = useCallback(async () => {
    if (!supabase || !normalizedThreadIds.length) {
      setData([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const scope = await resolveScope({
        supabase,
        user,
        getToken,
        logLabel: "useThreadPreviewMessages",
      });
      const chunkSize = 40;
      const allRows = [];
      for (let index = 0; index < normalizedThreadIds.length; index += chunkSize) {
        const chunk = normalizedThreadIds.slice(index, index + chunkSize);
        let request = supabase
          .from("mail_messages")
          .select(
            "id, thread_id, from_name, from_email, extracted_customer_name, extracted_customer_email, to_emails, cc_emails, bcc_emails, from_me, received_at, sent_at, created_at"
          )
          .in("thread_id", chunk)
          .order("received_at", { ascending: false, nullsLast: true })
          .limit(Math.max(chunk.length * 20, 500));
        request = applyClientScope(request, scope);
        const { data: rows, error: queryError } = await request;
        if (queryError) throw queryError;
        if (Array.isArray(rows) && rows.length) {
          allRows.push(...rows);
        }
      }
      setData(allRows);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Could not load preview messages."));
    } finally {
      setLoading(false);
    }
  }, [getToken, normalizedThreadIds, supabase, user]);

  useEffect(() => {
    if (!enabled) return;
    fetchMessages();
  }, [enabled, fetchMessages, threadKey]);

  useEffect(() => {
    if (normalizedThreadIds.length) return;
    setData([]);
  }, [normalizedThreadIds.length]);

  return { data, loading, error, refresh: fetchMessages };
}

export function useThreadAttachments(messageIds = [], options = {}) {
  const { initialData = EMPTY_LIST, enabled = false } = options;
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

  const fetchAttachments = useCallback(async () => {
    if (!supabase || !messageIds?.length) return;
    setLoading(true);
    setError(null);
    try {
      const scope = await resolveScope({
        supabase,
        user,
        getToken,
        logLabel: "useThreadAttachments",
      });
      const mailboxIds = await resolveScopedMailboxIds(supabase, scope);
      if (!mailboxIds.length) {
        setData([]);
        return;
      }
      let request = supabase
        .from("mail_attachments")
        .select(
          "id, user_id, mailbox_id, message_id, provider, provider_attachment_id, filename, mime_type, size_bytes, storage_path, created_at"
        )
        .in("mailbox_id", mailboxIds)
        .in("message_id", messageIds);
      request = applyClientScope(request, scope, { workspaceColumn: null, userColumn: "user_id" });
      const { data: rows, error: queryError } = await request;
      if (queryError) throw queryError;
      setData(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Could not load attachments."));
    } finally {
      setLoading(false);
    }
  }, [getToken, messageIds, supabase, user]);

  useEffect(() => {
    if (!enabled) return;
    fetchAttachments();
  }, [enabled, fetchAttachments]);

  useEffect(() => {
    if (!seeded?.length) {
      setData((prev) => (prev?.length ? [] : prev));
      return;
    }
    if (seededKeyRef.current === seededKey) return;
    seededKeyRef.current = seededKey;
    setData(seeded);
  }, [seeded, seededKey]);

  return { data, loading, error, refresh: fetchAttachments };
}
