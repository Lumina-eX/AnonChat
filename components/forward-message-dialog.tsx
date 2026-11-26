"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { AlertCircle, Check, Forward, Loader2, RefreshCw, Search, Users, X } from "lucide-react"
import toast from "react-hot-toast"
import { cn } from "@/lib/utils"

export type ForwardedMessage = {
  id: string
  user_id: string
  room_id: string
  content: string
  created_at: string
  status?: string
  is_forwarded?: boolean
  forwarded_original_created_at?: string | null
}

type Destination = { id: string; name: string }

type MessagePreview = {
  id: string
  content: string
  created_at: string
  is_forwarded: boolean
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; preview: MessagePreview; destinations: Destination[] }

type ForwardMessageDialogProps = {
  /** The message to forward. The dialog is open whenever this is non-null. */
  messageId: string | null
  onOpenChange: (open: boolean) => void
  onForwarded?: (destination: Destination, message: ForwardedMessage) => void
}

const formatTimestamp = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })

export function ForwardMessageDialog({ messageId, onOpenChange, onForwarded }: ForwardMessageDialogProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" })
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [isForwarding, setIsForwarding] = useState(false)

  const load = useCallback(async (id: string) => {
    setState({ kind: "loading" })
    setSelectedRoomId(null)
    try {
      const res = await fetch(`/api/messages/forward?message_id=${encodeURIComponent(id)}`)
      const data = await res.json().catch(() => ({}))
      if (res.status === 404) {
        setState({
          kind: "unavailable",
          message: data.error ?? "The original message is no longer available.",
        })
        return
      }
      if (!res.ok) {
        setState({ kind: "error", message: data.error ?? "Failed to load your groups." })
        return
      }
      setState({ kind: "ready", preview: data.message, destinations: data.destinations ?? [] })
    } catch {
      setState({ kind: "error", message: "Network error. Please check your connection." })
    }
  }, [])

  useEffect(() => {
    if (messageId) {
      setFilter("")
      void load(messageId)
    }
  }, [messageId, load])

  const visibleDestinations = useMemo(() => {
    if (state.kind !== "ready") return []
    const q = filter.trim().toLowerCase()
    return q ? state.destinations.filter((d) => d.name.toLowerCase().includes(q)) : state.destinations
  }, [state, filter])

  const selectedDestination =
    state.kind === "ready" ? state.destinations.find((d) => d.id === selectedRoomId) ?? null : null

  const handleForward = async () => {
    if (!messageId || !selectedDestination || isForwarding) return

    if (typeof window !== "undefined" && !window.navigator.onLine) {
      toast.error("You're offline. Message was not forwarded.")
      return
    }

    setIsForwarding(true)
    try {
      const res = await fetch("/api/messages/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, destination_room_id: selectedDestination.id }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 404) {
        setState({
          kind: "unavailable",
          message: data.error ?? "The original message is no longer available.",
        })
        toast.error("Couldn't forward: the original message is no longer available.")
        return
      }
      if (!res.ok) {
        toast.error(data.error ?? "Failed to forward message.")
        return
      }

      toast.success(`Message forwarded to ${selectedDestination.name}`)
      onForwarded?.(selectedDestination, data.message)
      onOpenChange(false)
    } catch {
      toast.error("Failed to forward message. Please check your connection.")
    } finally {
      setIsForwarding(false)
    }
  }

  return (
    <Dialog.Root open={messageId !== null} onOpenChange={(open) => !isForwarding && onOpenChange(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-2xl border border-border/60 bg-card p-5 shadow-xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <Forward className="h-5 w-5 text-primary" />
              <Dialog.Title className="text-sm font-semibold">Forward message</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={isForwarding}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Choose one of your groups to forward this message to.
          </Dialog.Description>

          {state.kind === "loading" && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground" role="status">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-xs">Loading your groups…</p>
            </div>
          )}

          {state.kind === "unavailable" && (
            <div className="flex flex-col items-center text-center gap-2 py-8" role="alert">
              <AlertCircle className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Message unavailable</p>
              <p className="text-xs text-muted-foreground max-w-xs">{state.message}</p>
            </div>
          )}

          {state.kind === "error" && (
            <div className="flex flex-col items-center text-center gap-3 py-8" role="alert">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <button
                type="button"
                onClick={() => messageId && void load(messageId)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium hover:bg-muted/40"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          )}

          {state.kind === "ready" && (
            <>
              <div className="mb-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Preview</p>
                <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2.5">
                  <p className="flex items-center gap-1 text-[10px] italic text-muted-foreground mb-1">
                    <Forward className="h-3 w-3" /> Forwarded
                  </p>
                  <p className="text-sm whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
                    {state.preview.content}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground text-right">
                    Originally sent {formatTimestamp(state.preview.created_at)}
                  </p>
                </div>
              </div>

              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Forward to</p>

              {state.destinations.length === 0 ? (
                <div className="flex flex-col items-center text-center gap-2 py-6 rounded-xl border border-dashed border-border/60">
                  <Users className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm font-medium">No other groups</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Join another group to forward messages there.
                  </p>
                </div>
              ) : (
                <>
                  {state.destinations.length > 5 && (
                    <div className="relative mb-2">
                      <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Search your groups"
                        aria-label="Search your groups"
                        className="w-full rounded-lg border border-border/60 bg-background/60 pl-8 pr-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  )}
                  <ul role="radiogroup" aria-label="Destination group" className="space-y-1.5 max-h-56 overflow-y-auto">
                    {visibleDestinations.length === 0 && (
                      <li className="text-xs text-muted-foreground py-3 text-center">No groups match “{filter}”.</li>
                    )}
                    {visibleDestinations.map((room) => {
                      const selected = room.id === selectedRoomId
                      return (
                        <li key={room.id}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setSelectedRoomId(room.id)}
                            className={cn(
                              "w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition",
                              selected
                                ? "border-primary/50 bg-primary/10"
                                : "border-border/60 hover:bg-muted/40",
                            )}
                          >
                            <span className="truncate">{room.name}</span>
                            {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={isForwarding}
                className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium hover:bg-muted/40 disabled:opacity-50"
              >
                Cancel
              </button>
            </Dialog.Close>
            {state.kind === "ready" && state.destinations.length > 0 && (
              <button
                type="button"
                onClick={() => void handleForward()}
                disabled={!selectedDestination || isForwarding}
                title={!selectedDestination ? "Select a destination group first" : undefined}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {isForwarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Forward className="h-3.5 w-3.5" />}
                <span className="max-w-[12rem] truncate">
                  {selectedDestination ? `Forward to ${selectedDestination.name}` : "Forward"}
                </span>
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
