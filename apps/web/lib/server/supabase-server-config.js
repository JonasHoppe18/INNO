export function resolveSupabaseServerConfig(env = process.env) {
  return {
    url: String(env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL || "").replace(
      /\/$/,
      "",
    ),
    serviceKey:
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_KEY ||
      "",
  };
}
