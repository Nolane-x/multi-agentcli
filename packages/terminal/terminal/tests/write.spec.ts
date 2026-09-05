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

describe('TerminalSessionService raw write', () => {
  it('routes exact bytes only for the exact owner', async () => {
    const ctx = await harness()
    const writes: string[] = []
    const backendSession = {
      motd: '',
      pid: 321,
      startSend: () => { throw new Error('unused') },
      read: () => ({ text: '', totalLines: 0, lineBegin: 0, lineEnd: 0, truncated: false }),
      write: async (data: string) => { writes.push(data) },
      signal: async () => ({ delivered: true as const, targetPgid: 1 }),
      status: () => ({ kind: 'running' as const }),
      close: async () => {},
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
      write(owner: Agent, id: typeof created.sessionId, data: string): Promise<void>
    }

    await terminals.write(owner, created.sessionId, 'claude\r')
    await terminals.write(owner, created.sessionId, '\u001b[A')
    expect(writes).toEqual(['claude\r', '\u001b[A'])
    await expect(terminals.write(foreign, created.sessionId, 'x')).rejects.toMatchObject({ code: 'FOREIGN_SESSION' })
  })

  it('rejects backends without raw write instead of pretending input was accepted', async () => {
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
      write(owner: Agent, id: typeof created.sessionId, data: string): Promise<void>
    }

    await expect(terminals.write(owner, created.sessionId, 'codex\r')).rejects.toMatchObject({ code: 'WRITE_UNSUPPORTED' })
  })
})
