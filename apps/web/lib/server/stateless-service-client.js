import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const STATE_KEY = Symbol.for("sona.stateless-service-client");

// Service-role transport only. No user session is persisted on this client;
// each caller must authenticate with Clerk and apply its workspace filters.
export function createStatelessServiceClient(url, serviceKey) {
  if (!url || !serviceKey) return null;
  const fingerprint = createHash("sha256").update(`${url}\n${serviceKey}`).digest("hex");
  const state = globalThis[STATE_KEY];
  if (state?.fingerprint === fingerprint) return state.client;
  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  globalThis[STATE_KEY] = { fingerprint, client };
  return client;
}
