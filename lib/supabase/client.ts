import { createBrowserClient } from "@supabase/ssr"
import { requireEnv } from "@/lib/supabase/env"

export function createClient() {
  return createBrowserClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"))
}
