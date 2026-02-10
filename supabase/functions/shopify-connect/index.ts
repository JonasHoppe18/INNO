import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.2.0/index.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptShopifyToken } from "../_shared/shopify-credentials.ts";

const SHOPIFY_API_VERSION = "2024-07"; // Holder API-version ét sted så vi nemt kan opgradere

const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CLERK_JWT_ISSUER = Deno.env.get("CLERK_JWT_ISSUER");

if (!PROJECT_URL) console.warn("PROJECT_URL mangler – kan ikke skrive til shops-tabellen.");
if (!SERVICE_ROLE_KEY)
  console.warn("SERVICE_ROLE_KEY mangler – edge function kan ikke bruge Supabase service rolle.");
if (!CLERK_JWT_ISSUER)
  console.warn("CLERK_JWT_ISSUER mangler – Clerk sessioner kan ikke verificeres.");

const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

const JWKS = CLERK_JWT_ISSUER
  ? createRemoteJWKSet(
      new URL(`${CLERK_JWT_ISSUER.replace(/\/$/, "")}/.well-known/jwks.json`),
    )
  : null;

type ShopMeta = {
  shop?: {
    id?: number;
    name?: string;
    email?: string;
    myshopify_domain?: string;
  };
};

function readBearerToken(req: Request): string {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw Object.assign(new Error("Manglende Clerk session token"), { status: 401 });
  }
  return match[1];
}

async function requireClerkUserId(req: Request): Promise<string> {
  // Validerer at requesten kommer fra en gyldig Clerk-session
  if (!JWKS || !CLERK_JWT_ISSUER) {
    throw Object.assign(
      new Error("CLERK_JWT_ISSUER mangler – kan ikke verificere Clerk session."),
      { status: 500 },
    );
  }
  const token = readBearerToken(req);
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: CLERK_JWT_ISSUER,
  });
  const sub = payload?.sub;
  if (!sub || typeof sub !== "string") {
    throw Object.assign(new Error("Ugyldigt Clerk token – subject mangler."), { status: 401 });
  }
  return sub;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function validateDomain(domain: string): void {
  // Brugeren må kun angive myshopify.com domæner
  if (!domain) {
    throw Object.assign(new Error("Angiv butikdomæne."), { status: 400 });
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw Object.assign(
      new Error("Domænet skal være et gyldigt myshopify.com domæne."),
      { status: 400 },
    );
  }
}

async function validateShopifyCredentials(domain: string, token: string): Promise<ShopMeta> {
  // Vi tester tokenet mod Shopify inden vi gemmer det
  const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, {
    headers: {
      Accept: "application/json",
      "X-Shopify-Access-Token": token,
    },
  });

  const text = await res.text();
  let json: ShopMeta | null = null;
  try {
    json = text ? (JSON.parse(text) as ShopMeta) : null;
  } catch (_err) {
    json = null;
  }

  if (!res.ok) {
    const errorMessage =
      (json as any)?.errors ??
      (json as any)?.error ??
      text ??
      `Shopify svarede med status ${res.status}.`;
    throw Object.assign(
      new Error(
        typeof errorMessage === "string" ? errorMessage : JSON.stringify(errorMessage),
      ),
      { status: res.status },
    );
  }

  return json ?? {};
}

async function resolveSupabaseUserId(clerkUserId: string): Promise<string> {
  if (!supabase) {
    throw Object.assign(new Error("Supabase klient ikke konfigureret."), { status: 500 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    throw Object.assign(
      new Error(`Kunne ikke slå Supabase-bruger op: ${error.message}`),
      { status: 500 },
    );
  }

  const supabaseUserId = data?.user_id;
  if (!supabaseUserId) {
    throw Object.assign(
      new Error("Der findes endnu ingen Supabase-bruger tilknyttet denne Clerk-bruger."),
      { status: 404 },
    );
  }

  return supabaseUserId;
}

async function upsertShop(options: {
  supabaseUserId: string;
  domain: string;
  token: string;
}): Promise<void> {
  const { supabaseUserId, domain, token } = options;

  // Gemmer krypteret token via vores PostgreSQL-funktion
  if (!supabase) {
    throw Object.assign(new Error("Supabase klient ikke konfigureret."), { status: 500 });
  }

  // Sikr at butikken ikke ejes af anden bruger
  const { data: existing, error: fetchError } = await supabase
    .from("shops")
    .select("owner_user_id")
    .eq("platform", "shopify")
    .eq("shop_domain", domain)
    .maybeSingle();

  if (fetchError) {
    throw Object.assign(new Error(`Kunne ikke slå butik op: ${fetchError.message}`), {
      status: 500,
    });
  }

  if (existing && existing.owner_user_id && existing.owner_user_id !== supabaseUserId) {
    throw Object.assign(
      new Error("Denne butik er allerede forbundet til en anden bruger."),
      { status: 409 },
    );
  }

  const encryptedToken = await encryptShopifyToken(token);

  const { error: upsertError } = await supabase.from("shops").upsert({
    owner_user_id: supabaseUserId,
    platform: "shopify",
    shop_domain: domain,
    access_token_encrypted: encryptedToken,
    installed_at: new Date().toISOString(),
    uninstalled_at: null,
  }, {
    onConflict: "owner_user_id,platform,shop_domain",
  });

  if (upsertError) {
    throw Object.assign(
      new Error(`Kunne ikke gemme Shopify forbindelse: ${upsertError.message}`),
      { status: 500 },
    );
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const clerkUserId = await requireClerkUserId(req);
    const supabaseUserId = await resolveSupabaseUserId(clerkUserId);

    let body: { domain?: string; accessToken?: string } = {};
    try {
      body = await req.json();
    } catch (_err) {
      body = {};
    }

    const rawDomain = body.domain ?? "";
    const accessToken = (body.accessToken ?? "").trim();

    if (!accessToken) {
      return new Response("Admin API adgangstoken skal udfyldes.", { status: 400 });
    }

    const domain = normalizeDomain(rawDomain);
    validateDomain(domain);

    await validateShopifyCredentials(domain, accessToken);
    await upsertShop({
      supabaseUserId,
      domain,
      token: accessToken,
    });

    return Response.json({
      ok: true,
      shop: {
        domain,
      },
    });
  } catch (error) {
    const status = (error as any)?.status ?? 500;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
});
