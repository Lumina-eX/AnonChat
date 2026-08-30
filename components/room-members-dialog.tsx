"use client"

import { useEffect, useMemo, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import {
  Users,
  UserMinus,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Shield,
  Crown,
  ArrowUpDown,
} from "lucide-react"
import toast from "react-hot-toast"
import { cn } from "@/lib/utils"
import { PresenceIndicator } from "@/components/presence-indicator"
import { WalletAddress } from "@/components/wallet-address"
import { useWebSocket, useWebSocketMessage, useWebSocketSend } from "@/lib/websocket/hooks"

type MemberRole = "owner" | "moderator" | "member"

type Member = {
  user_id: string
  joined_at: string
  is_current_user: boolean
  display_name: string | null
  wallet_address: string | null
  avatar_url: string | null
  role?: MemberRole
}

type VotesByTarget = Record<
  string,
  { count: number; voters: string[] }
>

type MemberPresence = "online" | "offline" | "away"

type PresenceSnapshotPayload = {
  users?: Array<{
    userId: string
    status: MemberPresence
  }>
}

type PresenceUpdatePayload = {
  userId: string
  status: MemberPresence
}

type RoomMembersDialogProps = {
  roomId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger?: React.ReactNode
}

export function RoomMembersDialog({
  roomId,
  open,
  onOpenChange,
  trigger,
}: RoomMembersDialogProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [votes, setVotes] = useState<VotesByTarget>({})
  const [loading, setLoading] = useState(false)
  const [votingId, setVotingId] = useState<string | null>(null)
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, MemberPresence>>({})
  
  // Pagination & Sorting state
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [sortBy, setSortBy] = useState<"joinDate" | "role" | "username">("joinDate")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")

  const { connectionState } = useWebSocket({ autoConnect: false })
  const { requestPresenceSnapshot } = useWebSocketSend()

  const fetchData = async (targetPage = page, sort = sortBy, order = sortOrder) => {
    if (!roomId) return
    setLoading(true)
    try {
      const queryParams = new URLSearchParams({
        page: targetPage.toString(),
        limit: "15",
        sortBy: sort,
        sortOrder: order,
      })

      const [membersRes, votesRes] = await Promise.all([
        fetch(`/api/rooms/${encodeURIComponent(roomId)}/members?${queryParams.toString()}`),
        fetch(`/api/rooms/${encodeURIComponent(roomId)}/vote-remove`),
      ])

      if (membersRes.ok) {
        const data = await membersRes.json()
        const nextMembers: Member[] = data.members ?? []
        setMembers(nextMembers)
        setTotalCount(data.totalCount ?? nextMembers.length)
        setTotalPages(data.totalPages ?? 1)
        setPage(data.page ?? targetPage)
        setHasMore(Boolean(data.hasMore))

        setPresenceByUserId((prev) => {
          const next: Record<string, MemberPresence> = {}
          for (const member of nextMembers) {
            next[member.user_id] = prev[member.user_id] ?? "offline"
          }
          return next
        })
      } else {
        setMembers([])
        setPresenceByUserId({})
      }
      if (votesRes.ok) {
        const data = await votesRes.json()
        setVotes(data.votes ?? {})
      } else {
        setVotes({})
      }
    } catch {
      toast.error("Failed to load room members")
      setMembers([])
      setVotes({})
      setPresenceByUserId({})
    } finally {
      setLoading(false)
    }
  }

  const mergedMembers = useMemo(() => {
    const statusRank: Record<MemberPresence, number> = {
      online: 0,
      away: 1,
      offline: 2,
    }

    return [...members]
      .map((member) => ({
        ...member,
        presence: presenceByUserId[member.user_id] ?? "offline",
      }))
      .sort((left, right) => {
        const statusDiff =
          statusRank[left.presence] - statusRank[right.presence]
        if (statusDiff !== 0) return statusDiff
        return left.joined_at.localeCompare(right.joined_at)
      })
  }, [members, presenceByUserId])

  useEffect(() => {
    if (open && roomId) {
      setPage(1)
      void fetchData(1, sortBy, sortOrder)
    }
  }, [open, roomId])

  const handleSortChange = (newSort: "joinDate" | "role" | "username") => {
    const newOrder = sortBy === newSort && sortOrder === "asc" ? "desc" : "asc"
    setSortBy(newSort)
    setSortOrder(newOrder)
    setPage(1)
    void fetchData(1, newSort, newOrder)
  }

  const handlePrevPage = () => {
    if (page <= 1) return
    const prev = page - 1
    setPage(prev)
    void fetchData(prev, sortBy, sortOrder)
  }

  const handleNextPage = () => {
    if (!hasMore && page >= totalPages) return
    const next = page + 1
    setPage(next)
    void fetchData(next, sortBy, sortOrder)
  }

  useEffect(() => {
    if (open && roomId && connectionState === "connected") {
      requestPresenceSnapshot()
    }
  }, [open, roomId, connectionState, requestPresenceSnapshot])

  useWebSocketMessage("presence_snapshot", (msg) => {
    const payload = msg.payload as PresenceSnapshotPayload
    if (!payload.users?.length) return

    setPresenceByUserId((prev) => {
      const next = { ...prev }
      for (const user of payload.users ?? []) {
        next[user.userId] = user.status
      }
      return next
    })
  })

  useWebSocketMessage("presence_update", (msg) => {
    const payload = msg.payload as PresenceUpdatePayload
    if (!payload.userId) return

    setPresenceByUserId((prev) => ({
      ...prev,
      [payload.userId]: payload.status,
    }))
  })

  const handleVoteRemove = async (targetUserId: string) => {
    setVotingId(targetUserId)
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/vote-remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_user_id: targetUserId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Failed to submit vote")
        return
      }
      toast.success(data.removed ? "User removed from room" : "Vote recorded")
      void fetchData(page, sortBy, sortOrder)
    } catch {
      toast.error("Failed to submit vote")
    } finally {
      setVotingId(null)
    }
  }

  const displayId = (id: string) =>
    id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
            "rounded-2xl border border-border/60 bg-[#0f0f16] p-5 shadow-xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          )}
        >
          <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <Dialog.Title className="text-sm font-semibold">
                Room Members ({totalCount})
              </Dialog.Title>
            </div>
            {totalPages > 1 && (
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground mb-3">
            Wallet-based votes to remove a member. Majority of active members removes them.
          </p>

          {/* Sort Controls */}
          <div className="flex items-center justify-between mb-3 px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <ArrowUpDown className="h-3.5 w-3.5" /> Sort by:
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleSortChange("joinDate")}
                className={cn(
                  "rounded-md px-2 py-0.5 transition",
                  sortBy === "joinDate"
                    ? "bg-primary/20 text-primary font-medium"
                    : "hover:bg-muted/40 text-muted-foreground"
                )}
              >
                Join Date {sortBy === "joinDate" && (sortOrder === "asc" ? "↑" : "↓")}
              </button>
              <button
                type="button"
                onClick={() => handleSortChange("role")}
                className={cn(
                  "rounded-md px-2 py-0.5 transition",
                  sortBy === "role"
                    ? "bg-primary/20 text-primary font-medium"
                    : "hover:bg-muted/40 text-muted-foreground"
                )}
              >
                Role {sortBy === "role" && (sortOrder === "asc" ? "↑" : "↓")}
              </button>
              <button
                type="button"
                onClick={() => handleSortChange("username")}
                className={cn(
                  "rounded-md px-2 py-0.5 transition",
                  sortBy === "username"
                    ? "bg-primary/20 text-primary font-medium"
                    : "hover:bg-muted/40 text-muted-foreground"
                )}
              >
                Name {sortBy === "username" && (sortOrder === "asc" ? "↑" : "↓")}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No members found in this room.
            </p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {mergedMembers.map((m) => {
                const voteCount = votes[m.user_id]?.count ?? 0
                const isVoting = votingId === m.user_id
                return (
                  <li
                    key={m.user_id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-[#181822] border border-border/60 px-3 py-2"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <PresenceIndicator
                        status={m.presence}
                        showText
                        className="shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <WalletAddress
                            address={m.wallet_address}
                            fallback={m.display_name || displayId(m.user_id)}
                            className="max-w-full"
                            addressClassName="text-sm font-medium"
                          />
                          {m.role === "owner" && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1.5 py-0.2 text-[10px] font-semibold">
                              <Crown className="h-2.5 w-2.5" /> Owner
                            </span>
                          )}
                          {m.role === "moderator" && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 px-1.5 py-0.2 text-[10px] font-semibold">
                              <Shield className="h-2.5 w-2.5" /> Mod
                            </span>
                          )}
                        </div>
                        {m.display_name && (
                          <p className="truncate text-[11px] text-muted-foreground">
                            {m.display_name}
                            {m.is_current_user && " • you"}
                          </p>
                        )}
                        {!m.display_name && m.is_current_user && (
                          <p className="truncate text-[11px] text-muted-foreground">
                            you
                          </p>
                        )}
                      </div>
                    </div>
                    {!m.is_current_user && (
                      <button
                        type="button"
                        disabled={isVoting}
                        onClick={() => handleVoteRemove(m.user_id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium",
                          "bg-destructive/20 text-destructive hover:bg-destructive/30 border border-destructive/40",
                          "disabled:opacity-50 transition"
                        )}
                      >
                        {isVoting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <UserMinus className="h-3 w-3" />
                        )}
                        Vote to remove {voteCount > 0 && `(${voteCount})`}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {/* Pagination & Close Footer */}
          <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={page <= 1 || loading}
                className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-[#181822] px-2.5 py-1.5 text-xs font-medium hover:bg-[#232330] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>
              <button
                type="button"
                onClick={handleNextPage}
                disabled={(!hasMore && page >= totalPages) || loading || members.length === 0}
                className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-[#181822] px-2.5 py-1.5 text-xs font-medium hover:bg-[#232330] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-border/60 bg-[#181822] px-3.5 py-1.5 text-xs font-medium hover:bg-[#232330] transition"
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

