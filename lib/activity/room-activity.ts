import type { SupabaseClient } from "@supabase/supabase-js"

export type RoomActivityEventType =
  | "group_created"
  | "user_joined"
  | "user_left"
  | "ownership_transferred"

export interface RoomActivityInsert {
  room_id: string
  event_type: RoomActivityEventType
  actor_user_id?: string | null
  target_user_id?: string | null
  metadata?: Record<string, unknown>
}

export async function insertRoomActivity(
  supabase: SupabaseClient,
  activity: RoomActivityInsert,
) {
  const { error } = await supabase.from("room_activity_logs").insert({
    room_id: activity.room_id,
    event_type: activity.event_type,
    actor_user_id: activity.actor_user_id ?? null,
    target_user_id: activity.target_user_id ?? null,
    metadata: activity.metadata ?? {},
  })

  if (error) throw error
}

