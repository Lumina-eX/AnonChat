"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Search, Users, X } from "lucide-react"
import { cn, shortenWalletAddress } from "@/lib/utils"
import {
  PresenceIndicator,
  type PresenceStatus,
} from "@/components/presence-indicator"
import {
  useWebSocket,
  useWebSocketMessage,
  useWebSocketSend,
} from "@/lib/websocket/hooks"

export type Member = {
  wallet: string
  userId?: string
  /** Prefer status when presence data comes from the WebSocket. */
  status?: PresenceStatus
  /** Kept for compatibility with the original MemberPanel API. */
  online?: boolean
}

export interface MemberPanelProps {
  members?: Member[]
  roomId?: string
  className?: string
  defaultCollapsed?: boolean
  mobileOpen?: boolean
  onMobileOpenChange?: (open: boolean) => void
}

const SEARCH_DEBOUNCE_MS = 200
const MEMBERS_PAGE_SIZE = 25

type ApiMember = {
  user_id: string
  wallet_address: string | null
}

type MembersResponse = {
  members?: ApiMember[]
  totalCount?: number
  page?: number
  hasMore?: boolean
}

type PresencePayload = {
  roomId?: string
  userId?: string
  status?: PresenceStatus
  users?: Array<{ userId: string; status: PresenceStatus }>
}

function getStatus(member: Member): PresenceStatus {
  if (member.status) return member.status
  return member.online ? "online" : "offline"
}

function getWalletAlias(wallet: string) {
  return shortenWalletAddress(wallet, 6, 4)
}

export default function MemberPanel({
  members = [],
  roomId,
  className,
  defaultCollapsed = false,
  mobileOpen = false,
  onMobileOpenChange,
}: MemberPanelProps) {
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [remoteMembers, setRemoteMembers] = useState<Member[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(Boolean(roomId))
  const [error, setError] = useState(false)
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, PresenceStatus>>({})
  const { connectionState } = useWebSocket({ autoConnect: false })
  const { requestPresenceSnapshot } = useWebSocketSend()

  const fetchMembers = useCallback(
    async (targetPage = 1, append = false) => {
      if (!roomId) return
      setLoading(true)
      setError(false)
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          limit: String(MEMBERS_PAGE_SIZE),
          sortBy: "joinDate",
          sortOrder: "asc",
        })
        const response = await fetch(
          `/api/rooms/${encodeURIComponent(roomId)}/members?${params.toString()}`,
        )
        if (!response.ok) throw new Error("Unable to load members")

        const data = (await response.json()) as MembersResponse
        const nextMembers = (data.members ?? [])
          .filter((member) => Boolean(member.wallet_address))
          .map((member) => ({
            userId: member.user_id,
            wallet: member.wallet_address as string,
          }))
        setRemoteMembers((current) => (append ? [...current, ...nextMembers] : nextMembers))
        setTotalCount(data.totalCount ?? nextMembers.length)
        setPage(data.page ?? targetPage)
        setHasMore(Boolean(data.hasMore))
      } catch {
        setError(true)
        if (!append) {
          setRemoteMembers([])
          setTotalCount(0)
        }
      } finally {
        setLoading(false)
      }
    },
    [roomId],
  )

  useEffect(() => {
    if (!roomId) return
    setPage(0)
    void fetchMembers(1)
  }, [roomId, fetchMembers])

  useEffect(() => {
    if (roomId && connectionState === "connected") requestPresenceSnapshot()
  }, [roomId, connectionState, requestPresenceSnapshot])

  const handlePresence = useCallback(
    (message: { payload: Record<string, unknown> }) => {
      const payload = message.payload as PresencePayload
      if (payload.roomId && payload.roomId !== roomId) return

      if (Array.isArray(payload.users)) {
        setPresenceByUserId((current) => {
          const next = { ...current }
          for (const user of payload.users ?? []) next[user.userId] = user.status
          return next
        })
        return
      }

      if (payload.userId && payload.status) {
        setPresenceByUserId((current) => ({
          ...current,
          [payload.userId as string]: payload.status as PresenceStatus,
        }))
      }
    },
    [roomId],
  )

  const refreshAfterRoomChange = useCallback(
    (message: { payload: Record<string, unknown> }) => {
      if (!roomId || message.payload.roomId !== roomId) return
      void fetchMembers(1)
    },
    [fetchMembers, roomId],
  )

  useWebSocketMessage("presence_snapshot", handlePresence)
  useWebSocketMessage("presence_update", handlePresence)
  useWebSocketMessage("room_join", refreshAfterRoomChange)
  useWebSocketMessage("room_leave", refreshAfterRoomChange)

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setDebouncedSearch(search.trim().toLowerCase()),
      SEARCH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timeoutId)
  }, [search])

  const displayedMembers = useMemo(() => {
    if (!roomId) return members
    return remoteMembers.map((member) => ({
      ...member,
      status: member.userId
        ? presenceByUserId[member.userId] ?? "offline"
        : "offline",
    }))
  }, [members, presenceByUserId, remoteMembers, roomId])

  const memberTotal = roomId ? totalCount : members.length
  const onlineCount = useMemo(
    () => displayedMembers.filter((member) => getStatus(member) === "online").length,
    [displayedMembers],
  )

  const filteredMembers = useMemo(() => {
    const matchingMembers = displayedMembers.filter((member) =>
      getWalletAlias(member.wallet).toLowerCase().includes(debouncedSearch),
    )

    return [...matchingMembers].sort(
      (left, right) =>
        Number(getStatus(left) !== "online") - Number(getStatus(right) !== "online"),
    )
  }, [debouncedSearch, displayedMembers])

  const closeMobilePanel = () => onMobileOpenChange?.(false)

  return (
    <aside
      aria-label="Group members"
      className={cn(
        "flex w-full flex-col border-border/60 bg-background/95 text-foreground md:w-80 md:border-l",
        roomId && !mobileOpen && "hidden lg:flex",
        roomId && mobileOpen && "fixed inset-3 z-40 max-h-[calc(100vh-6rem)] shadow-2xl lg:static lg:inset-auto lg:z-auto lg:max-h-none lg:shadow-none",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <div className="flex min-w-0 items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Members</h2>
            <p className="text-xs text-muted-foreground">
              {members.length} total · {onlineCount} online
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls="member-panel-content"
          aria-label={collapsed ? "Expand member list" : "Collapse member list"}
          onClick={() => {
            if (roomId && mobileOpen) closeMobilePanel()
            else setCollapsed((isCollapsed) => !isCollapsed)
          }}
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
            {collapsed ? <Users className="h-4 w-4" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>

      {!collapsed && (
        <div id="member-panel-content" className="flex min-h-0 flex-1 flex-col p-4">
          <label className="relative mb-4 block">
            <span className="sr-only">Search members by wallet alias</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="Search wallet alias"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-md border border-border/60 bg-muted/30 pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>

          {loading && displayedMembers.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading members" />
            </div>
          ) : error && displayedMembers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Unable to load members right now.
            </p>
          ) : memberTotal === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No members are present yet.
            </p>
          ) : filteredMembers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No members match that alias.
            </p>
          ) : (
            <ul className="min-h-0 space-y-1 overflow-y-auto" aria-live="polite">
              {filteredMembers.map((member) => {
                const status = getStatus(member)
                const alias = getWalletAlias(member.wallet)
                return (
                  <li
                    key={member.wallet}
                    className="flex items-center gap-3 rounded-md px-2 py-2 transition hover:bg-muted/50"
                  >
                    <PresenceIndicator status={status} className="shrink-0" />
                    <span className="min-w-0 truncate font-mono text-xs" title={alias}>
                      {alias}
                    </span>
                    <span className="sr-only">
                      {status === "online" ? "Online" : status === "offline" ? "Offline" : "Recently active"}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {roomId && hasMore && (
            <button
              type="button"
              onClick={() => void fetchMembers(page + 1, true)}
              disabled={loading}
              className="mt-3 rounded-md border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {loading ? "Loading..." : `Load more (${remoteMembers.length} of ${totalCount})`}
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
