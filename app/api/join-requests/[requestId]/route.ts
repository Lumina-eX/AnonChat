import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'            // REPLACE
import { createAdminClient } from '@/lib/supabase/admin'     // REPLACE
import { isUuid, unauthorized, badId } from '@/lib/join-requests'

export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  if (!isUuid(requestId)) return badId('request_id')
  const user = await getAuthenticatedUser(req)
  if (!user) return unauthorized()

  const db = createAdminClient()
  const { data: row } = await db.from('group_join_requests').select('*').eq('id', requestId).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (row.requester_id !== user.id) {
    const { data: ok } = await db.rpc('is_group_reviewer', { p_room: row.room_id, p_user: user.id })
    if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 }) // don't leak existence
  }
  return NextResponse.json({ request: row })
}