"use client"

import { useRoomActivity } from "@/src/hooks/useRoomActivity"

function formatEvent(eventType: string) {
  switch (eventType) {
    case "group_created":
      return "Group created"
    case "user_joined":
      return "User joined"
    case "user_left":
      return "User left"
    default:
      return eventType
  }
}

export function RoomActivityPanel({ roomId }: { roomId: string | null }) {
  const { activity, loading } = useRoomActivity(roomId)

  return (
    <div className="rounded-2xl border border-border/50 bg-card/50 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Activity</div>
        {loading && <div className="text-xs opacity-60">Loading…</div>}
      </div>

      <div className="mt-3 max-h-[240px] overflow-auto space-y-2 pr-1">
        {!loading && activity.length === 0 && (
          <div className="text-xs opacity-60">No activity yet</div>
        )}

        {activity.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-3">
            <div className="text-xs">
              <div className="font-medium">{formatEvent(a.event_type)}</div>
              {typeof a.metadata?.reason !== "undefined" && (
                <div className="opacity-60">{String(a.metadata.reason)}</div>
              )}
            </div>
            <div className="text-[11px] tabular-nums opacity-60">
              {new Date(a.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

