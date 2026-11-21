import { describe, it, expect } from "vitest"
import {
  activeMembersCutoffIso,
  addUtcDays,
  aggregateMessagesPerDay,
  assertSafeStatisticsPayload,
  buildDailyDateWindow,
  buildStatisticsResponse,
  countActiveMembers,
  normalizeStatisticsQuery,
  parsePositiveInteger,
  toUtcDateString,
} from "../lib/groups/message-statistics"

describe("group message statistics helpers", () => {
  it("parses positive integers with fallbacks", () => {
    expect(parsePositiveInteger(null, 7)).toBe(7)
    expect(parsePositiveInteger("0", 7)).toBe(7)
    expect(parsePositiveInteger("-1", 7)).toBe(7)
    expect(parsePositiveInteger("3.5", 7)).toBe(7)
    expect(parsePositiveInteger("14", 7)).toBe(14)
  })

  it("normalizes query params with caps", () => {
    expect(normalizeStatisticsQuery({})).toEqual({
      page: 1,
      limit: 30,
      activeDays: 7,
    })
    expect(normalizeStatisticsQuery({ page: 2, limit: 200, activeDays: 100 })).toEqual({
      page: 2,
      limit: 90,
      activeDays: 90,
    })
  })

  it("builds descending daily date windows with pagination", () => {
    const { dates, totalDays } = buildDailyDateWindow({
      endDate: "2026-09-24",
      page: 1,
      limit: 3,
      earliestDate: "2026-09-20",
    })
    expect(totalDays).toBe(5)
    expect(dates).toEqual(["2026-09-24", "2026-09-23", "2026-09-22"])

    const page2 = buildDailyDateWindow({
      endDate: "2026-09-24",
      page: 2,
      limit: 3,
      earliestDate: "2026-09-20",
    })
    expect(page2.dates).toEqual(["2026-09-21", "2026-09-20"])
    expect(page2.totalDays).toBe(5)
  })

  it("aggregates messages per day without needing content", () => {
    const result = aggregateMessagesPerDay(
      [
        { created_at: "2026-09-24T01:00:00.000Z" },
        { created_at: "2026-09-24T12:00:00.000Z" },
        { created_at: "2026-09-22T08:00:00.000Z" },
      ],
      ["2026-09-24", "2026-09-23", "2026-09-22"],
    )
    expect(result).toEqual([
      { date: "2026-09-24", count: 2 },
      { date: "2026-09-23", count: 0 },
      { date: "2026-09-22", count: 1 },
    ])
  })

  it("counts distinct active members and ignores null user ids", () => {
    expect(
      countActiveMembers([
        { user_id: "a" },
        { user_id: "b" },
        { user_id: "a" },
        { user_id: null },
      ]),
    ).toBe(2)
  })

  it("computes active member cutoff in UTC", () => {
    const now = new Date("2026-09-24T15:00:00.000Z")
    expect(activeMembersCutoffIso(7, now)).toBe("2026-09-17T15:00:00.000Z")
  })

  it("builds a safe response schema with pagination", () => {
    const payload = buildStatisticsResponse({
      groupId: "group-1",
      totalMessages: 10,
      activeMembers: 3,
      activeMembersWindowDays: 7,
      memberCount: 8,
      groupCreatedAt: "2026-01-01T00:00:00.000Z",
      messagesPerDay: [{ date: "2026-09-24", count: 2 }],
      page: 1,
      limit: 30,
      totalDays: 40,
    })

    expect(payload.statistics.totalMessages).toBe(10)
    expect(payload.pagination).toEqual({
      page: 1,
      limit: 30,
      total: 40,
      hasMore: true,
    })
    expect(assertSafeStatisticsPayload(payload)).toBe(true)
  })

  it("rejects payloads that accidentally include message content keys", () => {
    expect(
      assertSafeStatisticsPayload({
        statistics: { content: "secret hello" },
      }),
    ).toBe(false)
  })

  it("supports utc date helpers", () => {
    expect(toUtcDateString("2026-09-24T23:59:59.000Z")).toBe("2026-09-24")
    expect(addUtcDays("2026-09-24", -1)).toBe("2026-09-23")
  })
})
