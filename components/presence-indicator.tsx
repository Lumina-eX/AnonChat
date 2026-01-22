"use client"

import { cn } from "@/lib/utils"

export type PresenceStatus = "online" | "offline" | "recently_active"

interface PresenceIndicatorProps {
  status: PresenceStatus
  className?: string
  showText?: boolean
}

export function PresenceIndicator({ status, className, showText = false }: PresenceIndicatorProps) {
  const statusColors = {
    online: "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]",
    offline: "bg-muted-foreground/40",
    recently_active: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]",
  }

  const statusLabels = {
    online: "Online",
    offline: "Offline",
    recently_active: "Recently Active",
  }

  return (
    <div 
      className={cn("flex items-center gap-2", className)}
      title={statusLabels[status]}
    >
      <span
        className={cn(
          "w-2.5 h-2.5 rounded-full ring-2 ring-background transition-all duration-300",
          statusColors[status]
        )}
      />
      {showText && (
        <span className="text-xs text-muted-foreground font-medium">
          {statusLabels[status]}
        </span>
      )}
    </div>
  )
}
