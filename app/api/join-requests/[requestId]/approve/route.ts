import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'            // REPLACE
import { createAdminClient } from '@/lib/supabase/admin'     // REPLACE
import { isUuid, rpcErrorResponse, unauthorized, badId } from '@/lib/join-requests'

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  if (!isUuid(requestId)) return badId('request_id')
  const user = await getAuthenticatedUser(req)
  if (!user) return unauthorized()
  const { data, error } = await createAdminClient().rpc('review_join_request', {
    p_request_id: requestId, p_reviewer: user.id, p_decision: 'approved',
  })
  if (error) return rpcErrorResponse(error)
  return NextResponse.json({ request: data })
}