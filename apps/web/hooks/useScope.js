// Module-level scope resolver for client-side Supabase hooks.
//
// resolveScope() does a JWT decode + up to 2 Supabase round-trips
// (profiles, workspace_members). Before this module existed, every
// inbox hook (useThreadMessages, useThreadPreviewMessages,
// useThreadAttachments, useThreads) called it independently — adding
// up to 3-5 redundant resolutions per ticket switch.
//
// getScope() caches the in-flight Promise per Clerk user.id, so
// concurrent callers share one resolution and subsequent callers
// reuse the resolved value for the lifetime of the session.
// Failures are not cached.

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidUuid = (value) =>
  typeof value === "string" && UUID_REGEX.test(value);

const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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

export const resolveScope = async ({ supabase, user, getToken, logLabel }) => {
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
        typeof payload?.supabase_user_id === "string"
          ? payload.supabase_user_id
          : null;
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
    console.warn(
      `${logLabel}: supabase user id not ready, continuing with workspace scope only`,
    );
  }

  return {
    supabaseUserId,
    workspaceId: membership?.workspace_id ?? null,
  };
};

// user.id (Clerk) -> Promise<scope>. We cache the Promise (not the
// resolved value) so concurrent callers during a single render share
// one in-flight request rather than each kicking off their own.
const scopeCache = new Map();

export const invalidateScope = (clerkUserId) => {
  if (clerkUserId) {
    scopeCache.delete(clerkUserId);
  } else {
    scopeCache.clear();
  }
};

export const getScope = ({ supabase, user, getToken, logLabel }) => {
  if (!supabase || !user?.id) {
    return Promise.resolve({ supabaseUserId: null, workspaceId: null });
  }
  const cacheKey = user.id;
  const existing = scopeCache.get(cacheKey);
  if (existing) return existing;
  const pending = resolveScope({ supabase, user, getToken, logLabel }).catch(
    (err) => {
      // Don't keep a failed resolution in the cache — next call retries.
      if (scopeCache.get(cacheKey) === pending) {
        scopeCache.delete(cacheKey);
      }
      throw err;
    },
  );
  scopeCache.set(cacheKey, pending);
  return pending;
};
