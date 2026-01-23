export function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) {
    // For open source demo purposes, provide dummy values to allow viewing the app
    const defaults: Record<string, string> = {
      NEXT_PUBLIC_SUPABASE_URL: "https://dummy.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy-anon-key-for-demo",
      SUPABASE_URL: "https://dummy.supabase.co",
      SUPABASE_ANON_KEY: "dummy-anon-key-for-demo",
      SUPABASE_SERVICE_ROLE_KEY: "dummy-service-role-key-for-demo",
    }
    return defaults[key] || ""
  }
  return val
}
