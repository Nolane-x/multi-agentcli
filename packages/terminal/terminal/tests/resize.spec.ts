import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import type { TerminalBackendSession } from '@deepseek-ai/dsh-terminal'

function stubAgent(ctx: Context, rawId: string): Agent {
  const id = SessionId(rawId)
  const scopeFiber = ctx.plugin(() => {})
  const session = Session.create(id)
  return {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scopeFiber.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TerminalSessionService)
  return ctx
}

describe('TerminalSessionService resize', () => {
  it('routes resize through the exact owner fence', async () => {
    const ctx = await harness()
    const calls: Array<[number, number]> = []
    const backendSession = {
      motd: '',
      pid: 123,
      startSend: () => { throw new Error('unused') },
      read: () => ({ text: '', totalLines: 0, lineBegin: 0, lineEnd: 0, truncated: false }),
      signal: async () => ({ delivered: true as const, targetPgid: 1 }),
      status: () => ({ kind: 'running' as const }),
      close: async () => {},
      resize: async (rows: number, cols: number) => { calls.push([rows, cols]) },
    }
    ctx.terminals.registerBackend({
      type: 'stub',
      spawn: async () => backendSession,
    })
    const owner = stubAgent(ctx, 'owner')
    const foreign = stubAgent(ctx, 'foreign')
    ctx.agents.register(owner)
    ctx.agents.register(foreign)
    const created = await ctx.terminals.spawn(owner, { type: 'stub' })
    const terminals = ctx.terminals as unknown as {
      resize(owner: Agent, id: typeof created.sessionId, rows: number, cols: number): Promise<void>
    }

    await terminals.resize(owner, created.sessionId, 42, 120)
    expect(calls).toEqual([[42, 120]])
    await expect(terminals.resize(foreign, created.sessionId, 30, 80)).rejects.toMatchObject({ code: 'FOREIGN_SESSION' })
  })

  it('rejects unsupported and invalid resize requests instead of silently succeeding', async () => {
    const ctx = await harness()
    const backendSession: TerminalBackendSession = {
      motd: '',
      startSend: () => { throw new Error('unused') },
      read: () => ({ text: '', totalLines: 0, lineBegin: 0, lineEnd: 0, truncated: false }),
      signal: async () => ({ delivered: true as const, targetPgid: 1 }),
      status: () => ({ kind: 'running' as const }),
      close: async () => {},
    }
    ctx.terminals.registerBackend({ type: 'stub', spawn: async () => backendSession })
    const owner = stubAgent(ctx, 'owner')
    ctx.agents.register(owner)
    const created = await ctx.terminals.spawn(owner, { type: 'stub' })
    const terminals = ctx.terminals as unknown as {
      resize(owner: Agent, id: typeof created.sessionId, rows: number, cols: number): Promise<void>
    }

    await expect(terminals.resize(owner, created.sessionId, 24, 80)).rejects.toMatchObject({ code: 'RESIZE_UNSUPPORTED' })
    await expect(terminals.resize(owner, created.sessionId, 0, 80)).rejects.toThrow('rows')
    await expect(terminals.resize(owner, created.sessionId, 24, Number.NaN)).rejects.toThrow('cols')
  })
})
