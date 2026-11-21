import { enforceWalletApiAuth } from "@/lib/auth/wallet-jwt-middleware"
import { updateSession } from "@/lib/supabase/proxy"
import type { NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  const walletAuth = await enforceWalletApiAuth(request)
  if (!walletAuth.ok) {
    return walletAuth.response
  }

  return await updateSession(walletAuth.request)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
