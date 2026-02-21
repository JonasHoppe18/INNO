import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type ShopifyCredentialRow = {
  shop_domain: string;
  access_token_encrypted: string | null;
};

let cachedKey: CryptoKey | null = null;
let cachedKeyRaw = "";

function decodeBase64(value: string): Uint8Array {
  const normalized = value.trim();
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getEncryptionKey(rawKey?: string | null): Promise<CryptoKey> {
  const source = (rawKey ?? Deno.env.get("ENCRYPTION_KEY") ?? "").trim();
  if (!source) {
    throw new Error("ENCRYPTION_KEY mangler – kan ikke dekryptere Shopify token.");
  }

  if (cachedKey && cachedKeyRaw === source) {
    return cachedKey;
  }

  const keyBytes = decodeBase64(source);
  if (keyBytes.length !== 32) {
    throw new Error("ENCRYPTION_KEY skal være base64-kodet 32-byte nøgle.");
  }

  cachedKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  cachedKeyRaw = source;
  return cachedKey;
}

export async function decryptShopifyToken(
  encryptedValue: string,
  encryptionKeyOverride?: string | null,
): Promise<string> {
  const key = await getEncryptionKey(encryptionKeyOverride);
  const payload = decodeBase64(encryptedValue);
  if (payload.length < 12 + 16) {
    throw new Error("Shopify token payload er ugyldigt.");
  }

  const iv = payload.slice(0, 12);
  const cipherAndTag = payload.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    key,
    cipherAndTag,
  );

  return new TextDecoder().decode(new Uint8Array(decrypted));
}

export async function encryptShopifyToken(
  token: string,
  encryptionKeyOverride?: string | null,
): Promise<string> {
  const key = await getEncryptionKey(encryptionKeyOverride);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(token);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    key,
    plain,
  );

  const encryptedBytes = new Uint8Array(encrypted);
  const merged = new Uint8Array(iv.length + encryptedBytes.length);
  merged.set(iv, 0);
  merged.set(encryptedBytes, iv.length);

  let binary = "";
  for (const byte of merged) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export async function getShopCredentialsForUser(options: {
  supabase: SupabaseClient;
  userId: string;
  workspaceId?: string | null;
  encryptionKeyOverride?: string | null;
}): Promise<{ shop_domain: string; access_token: string }> {
  const { supabase, userId, workspaceId = null, encryptionKeyOverride } = options;

  let data: ShopifyCredentialRow | null = null;
  let error: Error | null = null;

  if (workspaceId) {
    const { data: workspaceData, error: workspaceError } = await supabase
      .from("shops")
      .select("shop_domain, access_token_encrypted")
      .eq("workspace_id", workspaceId)
      .eq("platform", "shopify")
      .is("uninstalled_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    data = workspaceData as ShopifyCredentialRow | null;
    error = workspaceError as Error | null;
  }

  if (!data) {
    const { data: userData, error: userError } = await supabase
      .from("shops")
      .select("shop_domain, access_token_encrypted")
      .eq("owner_user_id", userId)
      .eq("platform", "shopify")
      .is("uninstalled_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    data = userData as ShopifyCredentialRow | null;
    error = userError as Error | null;
  }

  if (error) {
    throw new Error(`Kunne ikke hente Shopify credentials: ${error.message}`);
  }

  const row = data ?? null;

  if (!row?.shop_domain) {
    throw new Error("Ingen Shopify butik forbundet.");
  }

  if (!row.access_token_encrypted) {
    throw new Error("Shopify butik mangler access token.");
  }

  const accessToken = await decryptShopifyToken(
    row.access_token_encrypted,
    encryptionKeyOverride,
  );

  return {
    shop_domain: row.shop_domain,
    access_token: accessToken,
  };
}
