import { createClient } from "@supabase/supabase-js";

export function createClerkSupabaseClient({
  supabaseUrl,
  supabaseAnonKey,
  getToken,
  storage,
}) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase konfiguration mangler. Kontrollér URL og ANON key.");
  }

  if (typeof getToken !== "function") {
    throw new Error("Clerk getToken funktion mangler.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      storage,
    },
    // Supabase's native Clerk integration validates the regular Clerk
    // session token through Clerk's OIDC/JWKS endpoint.
    accessToken: () => getToken(),
  });
}
