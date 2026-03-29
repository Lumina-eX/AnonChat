import type { SupabaseClient } from "@supabase/supabase-js"

export type MembershipRow = { id: string; removed_at: string | null }

export async function getActiveRoomMembership(
  supabase: SupabaseClient,
  roomId: string,
  userId: string
): Promise<MembershipRow | null> {
  const { data, error } = await supabase
    .from("room_members")
    .select("id, removed_at")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw error
  if (!data || data.removed_at) return null
  return data as MembershipRow
}
