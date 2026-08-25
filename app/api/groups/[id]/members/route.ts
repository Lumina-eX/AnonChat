import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { verifyWalletAuthorization, ensureWalletMatchesUser, resolveWalletFromUser } from "@/lib/auth/wallet-authorization"
import { removeGroupMember } from "@/lib/groups/member-removal"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params

  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 })
  }

  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      console.error("[groups/members] auth error:", authError)
      return NextResponse.json({ error: "Unable to verify authentication" }, { status: 401 })
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const auth = await verifyWalletAuthorization(body, "remove_group_member")
    if (!auth.ok) {
      return auth.response
    }

    const { data: callerProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      console.error("[groups/members] profile lookup error:", profileError)
      return NextResponse.json({ error: "Failed to retrieve caller profile" }, { status: 500 })
    }

    const callerWallet = resolveWalletFromUser(user, callerProfile)
    const walletMismatch = ensureWalletMatchesUser(auth.walletAddress, callerWallet)
    if (walletMismatch) {
      return walletMismatch
    }

    const { targetWallet } = body as { targetWallet?: string }
    if (!targetWallet || typeof targetWallet !== "string") {
      return NextResponse.json({ error: "targetWallet is required" }, { status: 400 })
    }

    const { data: group } = await supabase
      .from("rooms")
      .select("id, name")
      .eq("id", groupId)
      .maybeSingle()

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 })
    }

    const result = await removeGroupMember({
      supabase,
      groupId,
      callerWallet,
      targetWallet,
      actorUserId: user.id,
      groupName: group.name,
      adminAccess: true,
    })

    if (result instanceof NextResponse || "success" in result && !result.success) {
      return result instanceof NextResponse ? result : NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      success: true,
      group_id: groupId,
      target_wallet: targetWallet,
      message: "Member removed from group",
      audit: result.audit,
      notification: result.notification,
    })
  } catch (error) {
    console.error("[groups/members] DELETE error:", error)
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })
  }
}
