import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Crown,
  Key,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type GroupActivityEventType = 'join' | 'leave' | 'ownership_change'

export interface GroupActivityEvent {
  id: string
  type: GroupActivityEventType
  user: string
  timestamp: string | Date
  details?: string
}

type SubscribeReturn = { unsubscribe: () => void } | (() => void)

export type GroupActivitySubscribeFn = (params: {
  groupId: string
  onEvent: (event: GroupActivityEvent) => void
}) => SubscribeReturn | void

function toDate(input: string | Date): Date {
  if (input instanceof Date) return input
  const d = new Date(input)
  return d
}

function formatPreciseDate(input: string | Date): string {
  const d = toDate(input)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function formatRelativeTime(input: string | Date): string {
  const d = toDate(input)
  if (Number.isNaN(d.getTime())) return ''

  const now = Date.now()
  const ts = d.getTime()
  const diffMs = now - ts

  const sign = diffMs >= 0 ? 1 : -1
  const absMs = Math.abs(diffMs)

  const seconds = Math.floor(absMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  let qty: number
  let unit: Intl.RelativeTimeFormatUnit

  if (seconds < 45) {
    qty = seconds
    unit = 'second'
  } else if (minutes < 45) {
    qty = minutes
    unit = 'minute'
  } else if (hours < 22) {
    qty = hours
    unit = 'hour'
  } else {
    qty = days
    unit = 'day'
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  return rtf.format(sign * qty, unit)
}

function getEventVisual(
  type: GroupActivityEventType,
): {
  Icon: React.ComponentType<{ className?: string }>
  dotClassName: string
  cardClassName: string
  accentClassName: string
} {
  switch (type) {
    case 'join':
      return {
        Icon: UserPlus,
        dotClassName: 'bg-green-500',
        accentClassName: 'text-green-400',
        cardClassName:
          'bg-green-950/30 border-green-900/40 hover:bg-green-950/45',
      }
    case 'leave':
      return {
        Icon: UserMinus,
        dotClassName: 'bg-red-500',
        accentClassName: 'text-red-400',
        cardClassName:
          'bg-red-950/30 border-red-900/40 hover:bg-red-950/45',
      }
    case 'ownership_change':
      return {
        Icon: Crown,
        dotClassName: 'bg-amber-500',
        accentClassName: 'text-amber-400',
        cardClassName:
          'bg-amber-950/25 border-amber-900/40 hover:bg-amber-950/40',
      }
    default:
      return {
        Icon: Users,
        dotClassName: 'bg-purple-500',
        accentClassName: 'text-purple-400',
        cardClassName:
          'bg-purple-950/20 border-purple-900/30 hover:bg-purple-950/30',
      }
  }
}

function TimelineItem({
  event,
  showPrecise,
}: {
  event: GroupActivityEvent
  showPrecise: boolean
}) {
  const { Icon, dotClassName, cardClassName, accentClassName } =
    getEventVisual(event.type)

  const relative = formatRelativeTime(event.timestamp)
  const precise = formatPreciseDate(event.timestamp)

  const tooltip = [
    showPrecise && precise ? precise : '',
    event.details ? `Details: ${event.details}` : '',
    `User: ${event.user}`,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <li className="relative pl-6 sm:pl-8">
      {/* Left vertical rail */}
      <div className="absolute left-2 sm:left-2.5 top-0 bottom-0 w-px bg-white/10" />

      {/* Dot */}
      <div className="absolute left-0 sm:left-0.5 top-3 flex items-center justify-center">
        <div
          className={cn(
            'w-3 h-3 rounded-full ring-4 ring-black/30',
            dotClassName,
          )}
        />
      </div>

      <div
        className={cn(
          'rounded-xl border border-transparent px-3 py-2.5',
          cardClassName,
        )}
      >
        <div className="flex items-start gap-3">
          <div className={cn('pt-0.5', accentClassName)}>
            <Icon className="size-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="text-sm font-semibold text-gray-100">
                {event.type === 'join' && 'Joined'}
                {event.type === 'leave' && 'Left'}
                {event.type === 'ownership_change' && 'Ownership changed'}
              </p>
              <p className="text-xs text-gray-400 break-all">{event.user}</p>
              <span className="text-[11px] text-gray-500 font-medium">
                {relative || '—'}
              </span>
            </div>

            {event.details ? (
              <p className="mt-1 text-xs text-gray-300/90 break-words">
                {event.details}
              </p>
            ) : null}

            {/* Tooltip (hover) */}
            <div className="sr-only" aria-hidden>
              {tooltip}
            </div>

            <div className="hidden sm:block" title={tooltip} />
            <div className="sm:hidden" title={tooltip} />
          </div>
        </div>
      </div>

      {/* Bottom spacing */}
      <div className="mt-2" />
    </li>
  )
}

export interface GroupActivityFeedProps {
  groupId: string
  initialEvents?: GroupActivityEvent[]

  /**
   * Optional subscribe wrapper.
   * This prepares the component for WebSocket/Supabase realtime integrations.
   */
  subscribeToEvents?: GroupActivitySubscribeFn

  /**
   * Optional className for outer container.
   */
  className?: string

  /**
   * Maximum number of events retained in UI.
   */
  maxEvents?: number

  /**
   * Show precise hover timestamp strings.
   */
  showPreciseHover?: boolean
}

export const GroupActivityFeed: React.FC<GroupActivityFeedProps> = ({
  groupId,
  initialEvents = [],
  subscribeToEvents,
  className,
  maxEvents = 100,
  showPreciseHover = true,
}) => {
  const [events, setEvents] = useState<GroupActivityEvent[]>(() => {
    const normalized = [...initialEvents]
    normalized.sort((a, b) => toDate(a.timestamp).getTime() - toDate(b.timestamp).getTime())
    return normalized
  })

  const latestIdsRef = useRef<Set<string>>(new Set(events.map((e) => e.id)))

  useEffect(() => {
    // Reset when group changes.
    const normalized = [...initialEvents]
    normalized.sort(
      (a, b) => toDate(a.timestamp).getTime() - toDate(b.timestamp).getTime(),
    )
    latestIdsRef.current = new Set(normalized.map((e) => e.id))
    setEvents(normalized)
  }, [groupId, initialEvents])

  useEffect(() => {
    if (!subscribeToEvents) return

    const unsubscribeOrVoid = subscribeToEvents({
      groupId,
      onEvent: (event) => {
        setEvents((prev) => {
          const idSet = latestIdsRef.current
          if (idSet.has(event.id)) return prev
          idSet.add(event.id)

          const next = [...prev, event]
          next.sort(
            (a, b) =>
              toDate(a.timestamp).getTime() - toDate(b.timestamp).getTime(),
          )

          // Keep newest maxEvents entries (but preserve chronological ordering)
          if (next.length > maxEvents) {
            return next.slice(next.length - maxEvents)
          }

          return next
        })
      },
    })

    if (typeof unsubscribeOrVoid === 'function') {
      return () => unsubscribeOrVoid()
    }
    if (unsubscribeOrVoid && typeof (unsubscribeOrVoid as any).unsubscribe === 'function') {
      return () => (unsubscribeOrVoid as SubscribeReturn & { unsubscribe: () => void }).unsubscribe()
    }

    return
  }, [groupId, subscribeToEvents, maxEvents])

  const rendered = useMemo(() => {
    // Ensure chronological (oldest -> newest)
    const normalized = [...events]
    normalized.sort(
      (a, b) => toDate(a.timestamp).getTime() - toDate(b.timestamp).getTime(),
    )
    return normalized
  }, [events])

  return (
    <section
      className={cn(
        'w-full rounded-2xl bg-gray-950/40 border border-gray-800/60',
        className,
      )}
      aria-label="Group activity"
    >
      <div className="px-4 py-3 border-b border-gray-800/60">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-purple-950/60 border border-purple-900/30 flex items-center justify-center text-purple-300">
              {/* lightweight fallback icon */}
              <Key className="size-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-100 truncate">
                Group activity
              </h3>
              <p className="text-[11px] text-gray-500">
                Timeline of join/leave and ownership changes
              </p>
            </div>
          </div>
          <div className="text-[11px] text-gray-500 font-medium whitespace-nowrap">
            {rendered.length} event{rendered.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div
        className="px-3 sm:px-4 py-2 max-h-[65vh] sm:max-h-[70vh] overflow-y-auto"
        aria-busy={subscribeToEvents ? true : undefined}
      >
        {rendered.length === 0 ? (

          <div className="py-10 flex flex-col items-center justify-center text-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center">
              <Users className="size-5 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-200">
              No activity yet
            </p>
            <p className="text-xs text-gray-500 max-w-[40ch]">
              When members join, leave, or ownership changes, it will appear here.
            </p>
          </div>
        ) : (
          <ol className="relative space-y-3">
            {rendered.map((event) => (
              <TimelineItem
                key={event.id}
                event={event}
                showPrecise={showPreciseHover}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

