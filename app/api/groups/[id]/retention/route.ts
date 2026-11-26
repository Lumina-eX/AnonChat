import { createAdminClient, createClient } from "@/lib/supabase/server";
import { ensureWalletMatchesUser, resolveWalletFromUser, verifyWalletAuthorization } from "@/lib/auth/wallet-authorization";
import { MESSAGE_RETENTION } from "@/lib/message-retention";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json({ error: "Unable to verify authentication" }, { status: 401 });
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, created_by")
      .eq("id", groupId)
      .maybeSingle();

    if (groupError) throw groupError;
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("room_members")
      .select("removed_at")
      .eq("room_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) throw membershipError;
    if ((!membership && group.created_by !== user.id) || membership?.removed_at) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: policy, error } = await admin
      .from("message_retention_policies")
      .select("enabled, retention_seconds, updated_at, updated_by")
      .eq("room_id", groupId)
      .maybeSingle();

    if (error) throw error;

    const { data: auditHistory, error: auditError } = await admin
      .from("message_retention_policy_audit")
      .select("actor_user_id, previous_enabled, previous_retention_seconds, enabled, retention_seconds, changed_at")
      .eq("room_id", groupId)
      .order("changed_at", { ascending: false })
      .limit(50);

    if (auditError) throw auditError;

    return NextResponse.json({
      group_id: groupId,
      policy: policy ?? {
        enabled: false,
        retention_seconds: 86400,
        updated_at: null,
        updated_by: null,
      },
      audit_history: auditHistory ?? [],
    });
  } catch (error) {
    console.error(`[group-retention] GET /api/groups/${groupId}/retention error:`, error);
    return NextResponse.json({ error: "Failed to fetch message retention policy" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  if (!groupId) {
    return NextResponse.json({ error: "Group ID is required" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json({ error: "Unable to verify authentication" }, { status: 401 });
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { enabled, retention_seconds: retentionSeconds } = body;
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    if (
      typeof retentionSeconds !== "number"
      || !Number.isInteger(retentionSeconds)
      || retentionSeconds < MESSAGE_RETENTION.MIN_SECONDS
      || retentionSeconds > MESSAGE_RETENTION.MAX_SECONDS
    ) {
      return NextResponse.json({
        error: `retention_seconds must be an integer between ${MESSAGE_RETENTION.MIN_SECONDS} and ${MESSAGE_RETENTION.MAX_SECONDS}`,
      }, { status: 400 });
    }

    const auth = await verifyWalletAuthorization(body, "update_group_retention");
    if (!auth.ok) return auth.response;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    const callerWallet = resolveWalletFromUser(user, profile);
    const walletMismatch = ensureWalletMatchesUser(auth.walletAddress, callerWallet);
    if (walletMismatch) return walletMismatch;

    const { data: group, error: groupError } = await supabase
      .from("rooms")
      .select("id, created_by, owner_wallet")
      .eq("id", groupId)
      .maybeSingle();

    if (groupError) throw groupError;
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    if (group.created_by !== user.id && group.owner_wallet !== auth.walletAddress) {
      return NextResponse.json({ error: "Forbidden. Only the group owner can change retention settings." }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: policy, error } = await admin.rpc("set_message_retention_policy", {
      p_room_id: groupId,
      p_enabled: enabled,
      p_retention_seconds: retentionSeconds,
      p_actor_user_id: user.id,
    });

    if (error) throw error;

    return NextResponse.json({ success: true, group_id: groupId, policy });
  } catch (error) {
    console.error(`[group-retention] PUT /api/groups/${groupId}/retention error:`, error);
    return NextResponse.json({ error: "Failed to update message retention policy" }, { status: 500 });
  }
}
