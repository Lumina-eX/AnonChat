import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'            // REPLACE
import { createAdminClient } from '@/lib/supabase/admin'     // REPLACE (service-role client)
import { isUuid, rpcErrorResponse, unauthorized, badId } from '@/lib/join-requests'

type Ctx = { params: Promise<{ groupId: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  const { groupId } = await params
  if (!isUuid(groupId)) return badId('group_id')
  const user = await getAuthenticatedUser(req)
  if (!user) return unauthorized()

  let message: string | null = null
  try {
    const body = await req.json()
    if (typeof body?.message === 'string') message = body.message.slice(0, 500)
  } catch {
    // Body is optional; ignore empty or invalid JSON and continue without a message
  }

  const db = createAdminClient()
  const { data, error } = await db.rpc('create_join_request', {
    p_room: groupId, p_user: user.id, p_message: message,
  })
  if (error) return rpcErrorResponse(error)
  return NextResponse.json({ request: data }, { status: 201 })
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { groupId } = await params
  if (!isUuid(groupId)) return badId('group_id')
  const user = await getAuthenticatedUser(req)
  if (!user) return unauthorized()

  const db = createAdminClient()
  const { data: allowed, error: authErr } = await db.rpc('is_group_reviewer', {
    p_room: groupId, p_user: user.id,
  })
  if (authErr) return rpcErrorResponse(authErr)
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const status = req.nextUrl.searchParams.get('status') ?? 'pending'
  if (!['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
  }
  const { data, error } = await db
    .from('group_join_requests')
    .select('id, room_id, requester_id, status, message, reviewed_by, created_at, reviewed_at')
    .eq('room_id', groupId).eq('status', status)
    .order('created_at', { ascending: true }).limit(200)
  if (error) return rpcErrorResponse(error)
  return NextResponse.json({ requests: data })
}