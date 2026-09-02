import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import type { TerminalBackendSession, TerminalSessionId } from '@deepseek-ai/dsh-terminal'

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

type RawOutputService = {
  subscribeOutput(owner: Agent, id: TerminalSessionId, listener: (data: string) => void): () => void
}

describe('TerminalSessionService raw output', () => {
  it('streams exact terminal data only to the exact owner and detaches cleanly', async () => {
    const ctx = await harness()
    const listeners = new Set<(data: string) => void>()
    const backendSession = {
      motd: '',
      pid: 321,
      startSend: () => { throw new Error('unused') },
      read: () => ({ text: '', totalLines: 0, lineBegin: 0, lineEnd: 0, truncated: false }),
      subscribeOutput: (listener: (data: string) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      signal: async () => ({ delivered: true as const, targetPgid: 1 }),
      status: () => ({ kind: 'running' as const }),
      close: async () => {},
    }
    ctx.terminals.registerBackend({
      type: 'stub',
      spawn: async () => backendSession as TerminalBackendSession,
    })
    const owner = stubAgent(ctx, 'owner')
    const foreign = stubAgent(ctx, 'foreign')
    ctx.agents.register(owner)
    ctx.agents.register(foreign)
    const created = await ctx.terminals.spawn(owner, { type: 'stub' })
    const terminals = ctx.terminals as unknown as RawOutputService
    const received: string[] = []

    const dispose = terminals.subscribeOutput(owner, created.sessionId, data => { received.push(data) })
    for (const listener of listeners) listener('\u001b[2Jλ\r\n')
    expect(received).toEqual(['\u001b[2Jλ\r\n'])
    expect(() => terminals.subscribeOutput(foreign, created.sessionId, () => {})).toThrowMatchingObject({ code: 'FOREIGN_SESSION' })

    dispose()
    dispose()
    for (const listener of listeners) listener('after-dispose')
    expect(received).toEqual(['\u001b[2Jλ\r\n'])
  })

  it('rejects backends without raw output instead of exposing sanitized scrollback as a substitute', async () => {
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
    const terminals = ctx.terminals as unknown as RawOutputService

    expect(() => terminals.subscribeOutput(owner, created.sessionId, () => {})).toThrowMatchingObject({ code: 'OUTPUT_UNSUPPORTED' })
  })
})
