/**
 * The browser half's branch rule and route client.
 *
 * The branch rule is shared with the Host validator, so these cases pin the
 * names both halves must agree on. The route client is covered through a stub
 * `fetch`, because its job is turning every transport outcome into one refusal
 * shape without throwing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { branchIsValid } from '../src/branch-rule.ts'
import { request } from '../src/client/api.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('branch rule', () => {
  it('accepts the names a worktree tool can create', () => {
    for (const branch of ['main', 'feature/x', 'dsh/wt-20260102T030405Z', 'release-1.2', 'a']) {
      expect(branchIsValid(branch), branch).toBe(true)
    }
  })

  it('rejects what Git refuses or what would read as an option', () => {
    for (const branch of ['', 'has space', '-flag', 'a..b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'x.lock', '@', '/leading', 'trailing/']) {
      expect(branchIsValid(branch), branch).toBe(false)
    }
  })
})

describe('worktree route client', () => {
  it('returns the parsed value on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessionId: 's-1', path: '/w' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    const result = await request('start', { cwd: '/repo' })
    expect(result).toEqual({ ok: true, value: { sessionId: 's-1', path: '/w' } })
  })

  it('surfaces the Host refusal message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'branch already exists' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })))
    const result = await request('start', { cwd: '/repo' })
    expect(result).toEqual({ ok: false, message: 'branch already exists' })
  })

  it('reports an unreachable route instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused') }))
    const result = await request('list', { cwd: '/repo' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/unreachable/)
  })

  it('reports a non-JSON answer by status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>proxy error</html>', { status: 502 })))
    const result = await request('list', { cwd: '/repo' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/502/)
  })

  it('falls back to the status when a refusal carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: {} }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })))
    const result = await request('list', { cwd: '/repo' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/503/)
  })
})
