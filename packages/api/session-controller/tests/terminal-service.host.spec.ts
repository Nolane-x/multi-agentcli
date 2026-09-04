import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import TerminalSessionService from '../../../terminal/terminal/src/index.ts'
import type {
  TerminalBackendSession,
  TerminalReadRequest,
  TerminalSendOperation,
  TerminalSendResult,
  TerminalSessionStatus,
} from '../../../terminal/terminal/src/types.ts'

class ServiceSession implements TerminalBackendSession {
  readonly motd = 'ready'
  readonly pid = 123
  readonly writes: string[] = []
  readonly resizes: Array<[number, number]> = []
  readonly outputListeners = new Set<(data: string) => void>()
  readonly closeGate: PromiseWithResolvers<undefined> | undefined
  private statusValue: TerminalSessionStatus = { kind: 'running' }

  constructor(closeGate?: PromiseWithResolvers<undefined>) {
    this.closeGate = closeGate
  }

  startSend(_request: { text: string; submit: boolean }): TerminalSendOperation {
    const settled = Promise.withResolvers<TerminalSendResult>()
    let active = true
    return {
      done: settled.promise,
      readOutput: () => ({ delta: '', truncated: false }),
      cancel: () => {
        if (!active) return false
        active = false
        settled.resolve({
          viewport: '', waitReason: 'stdin_read', sessionStatus: this.statusValue, truncated: false,
        })
        return true
      },
    }
  }

  read(_request: TerminalReadRequest) {
    return { text: '', totalLines: 0, lineBegin: 0, lineEnd: 0, truncated: false }
  }

  subscribeOutput(listener: (data: string) => void): () => void {
    this.outputListeners.add(listener)
    return () => { this.outputListeners.delete(listener) }
  }

  write(data: string): Promise<void> {
    this.writes.push(data)
    return Promise.resolve()
  }

  resize(rows: number, cols: number): Promise<void> {
    this.resizes.push([rows, cols])
    return Promise.resolve()
  }

  signal(): Promise<{ delivered: true; targetPgid: number }> {
    return Promise.resolve({ delivered: true, targetPgid: 123 })
  }

  status(): TerminalSessionStatus {
    return this.statusValue
  }

  async close(): Promise<void> {
    await this.closeGate?.promise
    this.statusValue = { kind: 'exited', exitCode: 0, signal: null }
  }
}

function owner(ctx: Context): Agent {
  const session = Session.create(SessionId('terminal-owner'))
  const scope = ctx.plugin(() => {})
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function harness(sessions: ServiceSession[]): Promise<{ terminals: TerminalSessionService; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TerminalSessionService)
  const terminals = ctx.get('terminals') as TerminalSessionService
  terminals.registerBackend({ type: 'stub', spawn: async () => {
    const session = sessions.shift()
    if (session === undefined) throw new Error('test backend exhausted')
    return session
  } })
  const agent = owner(ctx)
  ctx.agents.register(agent)
  return { terminals, agent }
}

describe('TerminalSessionService raw terminal host surface', () => {
  it('routes output, input, resize, and active-send fencing through one owner', async () => {
    const session = new ServiceSession()
    const { terminals, agent } = await harness([session])
    const created = await terminals.spawn(agent, { type: 'stub' })
    const received: string[] = []
    const dispose = terminals.subscribeOutput(agent, created.sessionId, (data) => { received.push(data) })
    for (const listener of session.outputListeners) listener('\u001b[2J')
    dispose()
    expect(received).toEqual(['\u001b[2J'])

    await terminals.write(agent, created.sessionId, 'claude\r')
    await terminals.resize(agent, created.sessionId, 30, 100)
    await expect(terminals.resize(agent, created.sessionId, 0, 100)).rejects.toThrow('rows')
    await expect(terminals.resize(agent, created.sessionId, 30, Number.NaN)).rejects.toThrow('cols')
    expect(session.writes).toEqual(['claude\r'])
    expect(session.resizes).toEqual([[30, 100]])

    const operation = terminals.startSend(agent, created.sessionId, { text: '', submit: false })
    await expect(terminals.write(agent, created.sessionId, 'while active')).rejects.toThrow('active model send')
    operation.cancel()
    await operation.done
    await terminals.kill(agent, created.sessionId, 'test complete')
  })

  it('fences all operations while a close is in flight', async () => {
    const closeGate = Promise.withResolvers<undefined>()
    const session = new ServiceSession(closeGate)
    const { terminals, agent } = await harness([session])
    const created = await terminals.spawn(agent, { type: 'stub' })
    const closing = terminals.kill(agent, created.sessionId, 'test close')
    await Promise.resolve()

    expect(() => terminals.subscribeOutput(agent, created.sessionId, () => {})).toThrow('is closing')
    await expect(terminals.write(agent, created.sessionId, 'x')).rejects.toThrow('is closing')
    await expect(terminals.resize(agent, created.sessionId, 1, 1)).rejects.toThrow('is closing')

    closeGate.resolve(undefined)
    await expect(closing).resolves.toBe(true)
  })

  it('reports missing optional backend capabilities with stable error codes', async () => {
    const session = new ServiceSession()
    Object.defineProperties(session, {
      subscribeOutput: { value: undefined },
      write: { value: undefined },
      resize: { value: undefined },
    })
    const { terminals, agent } = await harness([session])
    const created = await terminals.spawn(agent, { type: 'stub' })

    expect(() => terminals.subscribeOutput(agent, created.sessionId, () => {})).toThrow(/does not support raw output/)
    await expect(terminals.write(agent, created.sessionId, 'x')).rejects.toMatchObject({ code: 'WRITE_UNSUPPORTED' })
    await expect(terminals.resize(agent, created.sessionId, 1, 1)).rejects.toMatchObject({ code: 'RESIZE_UNSUPPORTED' })
    await terminals.kill(agent, created.sessionId, 'test complete')
  })
})
