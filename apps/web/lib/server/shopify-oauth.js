import crypto from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";

const SHOPIFY_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

function getEncryptionKey() {
  if (!ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is missing on the server.");
  }

  const key = Buffer.from(ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function createServiceSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing on the server.");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function normalizeShopDomain(input = "") {
  return String(input).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

export function isValidShopDomain(shopDomain) {
  return SHOPIFY_DOMAIN_REGEX.test(shopDomain);
}

export function encryptString(value) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, ciphertext, authTag]).toString("base64");
}

export function decryptString(payload) {
  const key = getEncryptionKey();
  const data = Buffer.from(String(payload || ""), "base64");
  if (data.length < 12 + 16) {
    throw new Error("Encrypted value is invalid.");
  }

  const iv = data.subarray(0, 12);
  const authTag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(12, data.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export function generateOauthState() {
  return crypto.randomBytes(16).toString("hex");
}

export function buildShopifyHmacMessage(searchParams) {
  const pairs = [];

  for (const [key, value] of searchParams.entries()) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push([key, value]);
  }

  pairs.sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey === bKey) return aValue.localeCompare(bValue);
    return aKey.localeCompare(bKey);
  });

  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

export function verifyShopifyHmac({ searchParams, clientSecret, providedHmac }) {
  if (!providedHmac || !/^[a-fA-F0-9]{64}$/.test(providedHmac)) {
    return false;
  }

  const message = buildShopifyHmacMessage(searchParams);
  const expectedHex = crypto
    .createHmac("sha256", clientSecret)
    .update(message, "utf8")
    .digest("hex");

  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(providedHmac.toLowerCase(), "hex");

  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

export function sanitizeScopes(input) {
  if (Array.isArray(input)) {
    return input
      .map((scope) => String(scope).trim())
      .filter(Boolean)
      .join(",");
  }

  return String(input || "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(",");
}

export async function resolveWorkspaceIdFromOrg(supabase, orgId) {
  if (!supabase || !orgId) return null;
  const { data, error } = await supabase
    .from("workspaces")
    .select("id")
    .eq("clerk_org_id", orgId)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not resolve workspace from org: ${error.message}`);
  }
  return data?.id ?? null;
}

export async function getAuthContext(request, supabase) {
  void request;
  const { userId: clerkUserId, orgId } = auth();
  if (!clerkUserId || !supabase) {
    return { clerkUserId: null, orgId: orgId ?? null, userId: null, workspaceId: null };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not resolve user: ${error.message}`);
  }

  const workspaceId = await resolveWorkspaceIdFromOrg(supabase, orgId);
  return {
    clerkUserId,
    orgId: orgId ?? null,
    userId: data?.user_id ?? null,
    workspaceId,
  };
}

export async function getUserId(request, supabase) {
  const context = await getAuthContext(request, supabase);
  return context.userId;
}
