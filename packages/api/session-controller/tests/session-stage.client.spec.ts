import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { ClientSessions } from '../src/client/sessions/service.ts'
import { FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

const sid = (value: string): SessionId => value as SessionId

async function feedList(
  svc: ClientSessions,
  api: FakeApiClient,
  ids: readonly SessionId[],
): Promise<void> {
  api.onList = () => Promise.resolve(ok({
    items: ids.map((sessionId, index) => ({
      sessionId,
      updatedAt: index + 1,
      running: false,
      blank: false,
    })),
  }) as never)
  await svc.refresh()
  await Promise.resolve()
}

describe('session staging', () => {
  it('opens a second resident Session without changing the current selection', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const svc = new ClientSessions(ctx, fakeRemote(api))

    await feedList(svc, api, [sid('s1'), sid('s2')])
    svc.open(sid('s1'))
    await vi.waitFor(() => {
      expect(api.activeFollows(sid('s1'))).toBe(1)
    })

    svc.stage(sid('s2'))

    await vi.waitFor(() => {
      expect(api.activeFollows(sid('s2'))).toBe(1)
    })
    expect(svc.list.getSnapshot().current).toBe(sid('s1'))
    expect(svc.binding(sid('s2'))).toBeDefined()

    await ctx.fiber.dispose()
  })

  it('keeps repeated staging idempotent and preserves global selection', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const svc = new ClientSessions(ctx, fakeRemote(api))

    await feedList(svc, api, [sid('s1'), sid('s2')])
    svc.open(sid('s1'))
    svc.stage(sid('s2'))
    svc.stage(sid('s2'))
    svc.stage(sid('s2'))

    await vi.waitFor(() => {
      expect(api.activeFollows(sid('s2'))).toBe(1)
    })
    expect(svc.list.getSnapshot().current).toBe(sid('s1'))

    await ctx.fiber.dispose()
  })

  it('tears down an explicitly staged pane after its Session leaves the eligible list', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const svc = new ClientSessions(ctx, fakeRemote(api))

    await feedList(svc, api, [sid('s1'), sid('s2')])
    svc.open(sid('s1'))
    svc.stage(sid('s2'))
    await vi.waitFor(() => {
      expect(api.activeFollows(sid('s2'))).toBe(1)
    })

    await feedList(svc, api, [sid('s1')])

    expect(svc.binding(sid('s2'))).toBeUndefined()
    await vi.waitFor(() => {
      expect(api.activeFollows(sid('s2'))).toBe(0)
    })
    expect(svc.list.getSnapshot().current).toBe(sid('s1'))

    await ctx.fiber.dispose()
  })

  it('ignores an id that is no longer addressable instead of mutating selection', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const svc = new ClientSessions(ctx, fakeRemote(api))

    await feedList(svc, api, [sid('s1')])
    svc.open(sid('s1'))
    svc.stage(sid('missing'))

    expect(svc.list.getSnapshot().current).toBe(sid('s1'))
    expect(svc.binding(sid('missing'))).toBeUndefined()
    expect(api.activeFollows(sid('missing'))).toBe(0)

    await ctx.fiber.dispose()
  })
})
