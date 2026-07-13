import { describe, expect, it } from "vitest";
import { resolveSupabaseServerConfig } from "../supabase-server-config.js";

describe("resolveSupabaseServerConfig", () => {
  it("supports the production Supabase environment aliases", () => {
    expect(
      resolveSupabaseServerConfig({
        EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co/",
        SUPABASE_SERVICE_KEY: "service-key",
      }),
    ).toEqual({
      url: "https://example.supabase.co",
      serviceKey: "service-key",
    });
  });

  it("prefers the canonical server environment names", () => {
    expect(
      resolveSupabaseServerConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://canonical.supabase.co",
        EXPO_PUBLIC_SUPABASE_URL: "https://fallback.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "canonical-key",
        SERVICE_ROLE_KEY: "fallback-key",
        SUPABASE_SERVICE_KEY: "legacy-key",
      }),
    ).toEqual({
      url: "https://canonical.supabase.co",
      serviceKey: "canonical-key",
    });
  });
});
