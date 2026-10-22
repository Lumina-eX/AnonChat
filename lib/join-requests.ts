import { NextResponse } from 'next/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: string) => UUID.test(v)

const STATUS_BY_ERROR: Record<string, number> = {
  forbidden: 403,
  not_found: 404,
  already_reviewed: 409,
  already_member: 409,
  duplicate_pending_request: 409,
  group_not_private: 400,
  invalid_decision: 400,
}

export function rpcErrorResponse(error: { message?: string }) {
  const key = error.message ?? ''
  const status = STATUS_BY_ERROR[key]
  if (status) return NextResponse.json({ error: key }, { status })
  return NextResponse.json({ error: 'internal_error' }, { status: 500 })
}

export const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })
export const badId = (name: string) => NextResponse.json({ error: `invalid_${name}` }, { status: 400 })