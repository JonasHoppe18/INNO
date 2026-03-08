const GLS_TOKEN_URL = "https://api.gls-group.net/oauth2/v2/token";
const TOKEN_EXPIRY_SAFETY_SECONDS = 60;

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

let tokenCache: CachedToken | null = null;
let inFlightTokenRequest: Promise<string> | null = null;

function readEnv(name: string): string {
  try {
    const denoValue = typeof Deno !== "undefined" ? Deno.env.get(name) : undefined;
    if (denoValue) return denoValue;
  } catch {
    // ignore
  }
  const processValue =
    typeof process !== "undefined" && process?.env ? process.env[name] : undefined;
  return String(processValue || "").trim();
}

function getCredentials() {
  const clientId = readEnv("GLS_CLIENT_ID");
  const clientSecret = readEnv("GLS_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("GLS credentials missing. Set GLS_CLIENT_ID and GLS_CLIENT_SECRET.");
  }
  return { clientId, clientSecret };
}

function tokenIsValid(cache: CachedToken | null): cache is CachedToken {
  if (!cache) return false;
  return Date.now() + TOKEN_EXPIRY_SAFETY_SECONDS * 1000 < cache.expiresAtMs;
}

function parseExpiresInSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 300;
  return seconds;
}

async function requestNewToken(): Promise<string> {
  const { clientId, clientSecret } = getCredentials();
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(GLS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    const detail =
      typeof payload === "object" && payload
        ? JSON.stringify(payload)
        : `HTTP ${response.status}`;
    throw new Error(`GLS token request failed: ${detail}`);
  }

  const accessToken = String((payload as Record<string, unknown>)?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("GLS token response did not include access_token.");
  }

  const expiresIn = parseExpiresInSeconds(
    (payload as Record<string, unknown>)?.expires_in,
  );
  tokenCache = {
    accessToken,
    expiresAtMs: Date.now() + expiresIn * 1000,
  };

  return accessToken;
}

export async function getGlsAccessToken(): Promise<string> {
  if (tokenIsValid(tokenCache)) return tokenCache.accessToken;

  if (!inFlightTokenRequest) {
    inFlightTokenRequest = requestNewToken().finally(() => {
      inFlightTokenRequest = null;
    });
  }

  return await inFlightTokenRequest;
}

export function resetGlsTokenCacheForTests() {
  tokenCache = null;
  inFlightTokenRequest = null;
}
