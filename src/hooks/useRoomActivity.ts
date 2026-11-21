import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export type RoomActivityLog = {
  id: string
  room_id: string
  event_type: string
  actor_user_id: string | null
  target_user_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export function useRoomActivity(roomId: string | null) {
  const [activity, setActivity] = useState<RoomActivityLog[]>([])
  const [loading, setLoading] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!roomId) {
      setActivity([])
      return
    }

    let cancelled = false
    setLoading(true)

    fetch(`/api/rooms/${roomId}/activity?limit=50`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`activity_fetch_${r.status}`)
        return (await r.json()) as { activity: RoomActivityLog[] }
      })
      .then((json) => {
        if (!cancelled) setActivity(json.activity ?? [])
      })
      .catch((e) => {
        console.warn("[activity] failed to fetch activity", e)
        if (!cancelled) setActivity([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const channel = supabase
      .channel(`room_activity:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_activity_logs",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as RoomActivityLog
          setActivity((prev) => [row, ...prev].slice(0, 200))
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [roomId, supabase])

  return { activity, loading }
}

