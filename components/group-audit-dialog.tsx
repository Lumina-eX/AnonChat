"use client"

import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { ExternalLink, Loader2, ScrollText } from "lucide-react"
import toast from "react-hot-toast"
import { cn } from "@/lib/utils"

type AuditEvent = {
  eventId: string
  eventType: string
  actorUserId: string | null
  targetUserId: string | null
  transactionHash: string | null
  explorerUrl: string | null
  status: "pending" | "submitted" | "failed"
  error: string | null
  timestamp: string
}

type GroupAuditDialogProps = {
  groupId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const EVENT_LABELS: Record<string, string> = {
  group_created: "Group created",
  member_joined: "Member joined",
  member_left: "Member left",
  member_removed: "Member removed",
}

function displayId(id: string | null) {
  if (!id) return "System"
  return id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id
}

export function GroupAuditDialog({
  groupId,
  open,
  onOpenChange,
}: GroupAuditDialogProps) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !groupId) return

    const fetchAuditTrail = async () => {
      setLoading(true)
      try {
        const response = await fetch(
          `/api/groups/${encodeURIComponent(groupId)}/audit?limit=25`
        )
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load audit trail")
        }

        setEvents(data.auditTrail ?? [])
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load audit trail")
        setEvents([])
      } finally {
        setLoading(false)
      }
    }

    void fetchAuditTrail()
  }, [open, groupId])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2",
            "rounded-2xl border border-border/60 bg-[#0f0f16] p-5 shadow-xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          )}
        >
          <div className="flex items-center gap-2 border-b border-border/60 pb-3 mb-3">
            <ScrollText className="h-5 w-5 text-primary" />
            <Dialog.Title className="text-sm font-semibold">
              Audit trail
            </Dialog.Title>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              No audit events have been recorded for this group yet.
            </p>
          ) : (
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
              {events.map((event) => (
                <li
                  key={event.eventId}
                  className="rounded-xl border border-border/60 bg-[#181822] px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {EVENT_LABELS[event.eventType] ?? event.eventType}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(event.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-1 text-[11px] font-medium",
                        event.status === "submitted" && "bg-emerald-500/15 text-emerald-300",
                        event.status === "pending" && "bg-yellow-500/15 text-yellow-300",
                        event.status === "failed" && "bg-destructive/20 text-destructive"
                      )}
                    >
                      {event.status}
                    </span>
                  </div>

                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>Actor: {displayId(event.actorUserId)}</span>
                    <span>Target: {displayId(event.targetUserId)}</span>
                  </div>

                  {event.transactionHash && event.explorerUrl && (
                    <a
                      href={event.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      {displayId(event.transactionHash)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}

                  {event.error && (
                    <p className="mt-2 text-xs text-destructive">
                      {event.error}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex justify-end">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-border/60 bg-[#181822] px-3 py-1.5 text-xs font-medium hover:bg-[#232330] transition"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
