import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const rpc = vi.fn()
const getUser = vi.fn()
vi.mock('@/lib/auth', () => ({ getAuthenticatedUser: (...a: unknown[]) => getUser(...a) }))      // REPLACE paths
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }))                  // REPLACE paths

import { POST as createReq, GET as listReqs } from '@/app/api/groups/[groupId]/join-requests/route'
import { POST as approve } from '@/app/api/join-requests/[requestId]/approve/route'
import { POST as reject } from '@/app/api/join-requests/[requestId]/reject/route'

const ID = '11111111-1111-4111-8111-111111111111'
const RID = '22222222-2222-4222-8222-222222222222'
const req = (body?: unknown) =>
  new NextRequest('http://localhost/x', { method: 'POST', body: body ? JSON.stringify(body) : undefined })
const ctxG = { params: Promise.resolve({ groupId: ID }) }
const ctxR = { params: Promise.resolve({ requestId: RID }) }

beforeEach(() => { rpc.mockReset(); getUser.mockReset(); getUser.mockResolvedValue({ id: 'user-1' }) })

describe('create join request', () => {
  it('creates a request (201)', async () => {
    rpc.mockResolvedValue({ data: { id: RID, status: 'pending' }, error: null })
    const res = await createReq(req({ message: 'hi' }), ctxG)
    expect(res.status).toBe(201)
    expect(rpc).toHaveBeenCalledWith('create_join_request', { p_room: ID, p_user: 'user-1', p_message: 'hi' })
  })
  it('rejects unauthenticated users (401)', async () => {
    getUser.mockResolvedValue(null)
    expect((await createReq(req(), ctxG)).status).toBe(401)
  })
  it('blocks duplicate pending request (409)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'duplicate_pending_request' } })
    expect((await createReq(req(), ctxG)).status).toBe(409)
  })
  it('blocks existing members (409)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'already_member' } })
    expect((await createReq(req(), ctxG)).status).toBe(409)
  })
  it('rejects non-private groups (400)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'group_not_private' } })
    expect((await createReq(req(), ctxG)).status).toBe(400)
  })
})

describe('review', () => {
  it('approves (200) and passes reviewer + decision', async () => {
    rpc.mockResolvedValue({ data: { id: RID, status: 'approved' }, error: null })
    const res = await approve(req(), ctxR)
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('review_join_request', { p_request_id: RID, p_reviewer: 'user-1', p_decision: 'approved' })
  })
  it('rejects (200)', async () => {
    rpc.mockResolvedValue({ data: { id: RID, status: 'rejected' }, error: null })
    const res = await reject(req(), ctxR)
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('review_join_request', { p_request_id: RID, p_reviewer: 'user-1', p_decision: 'rejected' })
  })
  it('blocks non-reviewers (403)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } })
    expect((await approve(req(), ctxR)).status).toBe(403)
    expect((await reject(req(), ctxR)).status).toBe(403)
  })
  it('list is forbidden for non-reviewers', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    const res = await listReqs(new NextRequest('http://localhost/x'), ctxG)
    expect(res.status).toBe(403)
  })
  it('concurrent approvals: exactly one succeeds, one gets 409, one membership', async () => {
    let reviewed = false
    let memberships = 0
    rpc.mockImplementation(async () => {
      await Promise.resolve()
      if (reviewed) return { data: null, error: { message: 'already_reviewed' } }
      reviewed = true; memberships += 1
      return { data: { id: RID, status: 'approved' }, error: null }
    })
    const results = await Promise.all([approve(req(), ctxR), approve(req(), ctxR)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(memberships).toBe(1)
  })
  it('rejects invalid ids (400)', async () => {
    const res = await approve(req(), { params: Promise.resolve({ requestId: 'nope' }) })
    expect(res.status).toBe(400)
  })
})