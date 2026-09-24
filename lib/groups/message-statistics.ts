/**
 * Group-level message statistics helpers.
 *
 * Aggregates engagement metrics without exposing message content or
 * identifiable sender metadata beyond anonymous activity counts.
 */

export type MessageActivityRow = {
  created_at: string
  user_id: string | null
}

export type DailyMessageCount = {
  date: string
  count: number
}

export type GroupMessageStatistics = {
  groupId: string
  totalMessages: number
  activeMembers: number
  activeMembersWindowDays: number
  memberCount: number
  groupCreatedAt: string | null
  messagesPerDay: DailyMessageCount[]
}

export type StatisticsPagination = {
  page: number
  limit: number
  total: number
  hasMore: boolean
}

export type StatisticsQueryParams = {
  page?: number
  limit?: number
  activeDays?: number
}

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 90
const DEFAULT_ACTIVE_DAYS = 7
const MAX_ACTIVE_DAYS = 90

export function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function normalizeStatisticsQuery(params: StatisticsQueryParams): {
  page: number
  limit: number
  activeDays: number
} {
  const page = Math.max(params.page ?? DEFAULT_PAGE, 1)
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const activeDays = Math.min(
    Math.max(params.activeDays ?? DEFAULT_ACTIVE_DAYS, 1),
    MAX_ACTIVE_DAYS,
  )
  return { page, limit, activeDays }
}

/** UTC calendar date string YYYY-MM-DD */
export function toUtcDateString(input: Date | string): string {
  const d = typeof input === "string" ? new Date(input) : input
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${input}`)
  }
  return d.toISOString().slice(0, 10)
}

export function addUtcDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return toUtcDateString(d)
}

/**
 * Build a descending window of calendar days for paginated daily breakdowns.
 * Page 1 starts at `endDate` (inclusive) and walks backwards.
 */
export function buildDailyDateWindow(options: {
  endDate: string
  page: number
  limit: number
  earliestDate?: string | null
}): { dates: string[]; totalDays: number } {
  const { endDate, page, limit } = options
  const earliest = options.earliestDate ? toUtcDateString(options.earliestDate) : null

  let totalDays: number
  if (earliest) {
    const end = new Date(`${endDate}T00:00:00.000Z`).getTime()
    const start = new Date(`${earliest}T00:00:00.000Z`).getTime()
    totalDays = Math.max(1, Math.floor((end - start) / 86_400_000) + 1)
  } else {
    // Without a creation date, expose a rolling year of buckets.
    totalDays = 365
  }

  const offset = (page - 1) * limit
  if (offset >= totalDays) {
    return { dates: [], totalDays }
  }

  const dates: string[] = []
  for (let i = 0; i < limit && offset + i < totalDays; i++) {
    dates.push(addUtcDays(endDate, -(offset + i)))
  }
  return { dates, totalDays }
}

/** Aggregate message rows into per-day counts. Never inspects content. */
export function aggregateMessagesPerDay(
  rows: Array<Pick<MessageActivityRow, "created_at">>,
  dates: string[],
): DailyMessageCount[] {
  const counts = new Map<string, number>()
  for (const date of dates) {
    counts.set(date, 0)
  }
  for (const row of rows) {
    const date = toUtcDateString(row.created_at)
    if (counts.has(date)) {
      counts.set(date, (counts.get(date) ?? 0) + 1)
    }
  }
  return dates.map((date) => ({ date, count: counts.get(date) ?? 0 }))
}

/** Count distinct non-null user ids (active posters). */
export function countActiveMembers(rows: Array<Pick<MessageActivityRow, "user_id">>): number {
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.user_id) ids.add(row.user_id)
  }
  return ids.size
}

export function activeMembersCutoffIso(activeDays: number, now: Date = new Date()): string {
  const d = new Date(now.getTime())
  d.setUTCDate(d.getUTCDate() - activeDays)
  return d.toISOString()
}

export function buildStatisticsResponse(input: {
  groupId: string
  totalMessages: number
  activeMembers: number
  activeMembersWindowDays: number
  memberCount: number
  groupCreatedAt: string | null
  messagesPerDay: DailyMessageCount[]
  page: number
  limit: number
  totalDays: number
}): { statistics: GroupMessageStatistics; pagination: StatisticsPagination } {
  const { page, limit, totalDays } = input
  return {
    statistics: {
      groupId: input.groupId,
      totalMessages: input.totalMessages,
      activeMembers: input.activeMembers,
      activeMembersWindowDays: input.activeMembersWindowDays,
      memberCount: input.memberCount,
      groupCreatedAt: input.groupCreatedAt,
      messagesPerDay: input.messagesPerDay,
    },
    pagination: {
      page,
      limit,
      total: totalDays,
      hasMore: page * limit < totalDays,
    },
  }
}

/** Ensure a stats payload never includes message content fields. */
export function assertSafeStatisticsPayload(payload: unknown): boolean {
  const raw = JSON.stringify(payload)
  const forbidden = ['"content"', '"encrypted_content"', '"body"', '"ciphertext"', '"plaintext"']
  return !forbidden.some((key) => raw.includes(key))
}
