import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import type {
  TerminalBackendSession,
  TerminalReadRequest,
  TerminalReadResult,
  TerminalSendOperation,
  TerminalSendRequest,
  TerminalSendResult,
  TerminalSessionId,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
  TerminalSignal,
  TerminalSignalResult,
  TerminalSpawnRequest,
  TerminalSpawnResult,
} from '@deepseek-ai/dsh-terminal'
import { describe, expect, it, vi } from 'vitest'
import { SessionControlController } from '../src/control.ts'

interface TerminalControlFace {
  terminalBackends(): readonly string[]
  listTerminals(sessionId: SessionId): readonly TerminalSessionSnapshot[]
  openTerminal(
    sessionId: SessionId,
    request: TerminalSpawnRequest,
    signal?: AbortSignal,
  ): Promise<TerminalSpawnResult>
  sendTerminal(
    sessionId: SessionId,
    terminalId: TerminalSessionId,
    request: TerminalSendRequest,
  ): Promise<TerminalSendResult>
  readTerminal(
    sessionId: SessionId,
    terminalId: TerminalSessionId,
    request?: TerminalReadRequest,
  ): TerminalReadResult
  signalTerminal(
    sessionId: SessionId,
    terminalId: TerminalSessionId,
    signal: TerminalSignal,
  ): Promise<TerminalSignalResult>
  closeTerminal(sessionId: SessionId, terminalId: TerminalSessionId): Promise<'closed' | 'already-closing'>
}

function liveAgent(ctx: Context, sessionId: SessionId): Agent {
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) throw new Error('missing session')
  return {
    id: session.id,
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx,
  } as Agent
}

class StubTerminal implements TerminalBackendSession {
  readonly motd = 'stub ready'
  readonly pid = 4242
  readonly close = vi.fn(async (_reason: string) => {})
  readonly sends: TerminalSendRequest[] = []
  readonly reads: TerminalReadRequest[] = []
  readonly signals: TerminalSignal[] = []

  startSend(request: TerminalSendRequest): TerminalSendOperation {
    this.sends.push(request)
    return {
      done: Promise.resolve({
        viewport: `ran:${request.text}`,
        waitReason: 'inferred_idle',
        sessionStatus: { kind: 'running' },
        truncated: false,
      }),
      readOutput: () => ({ delta: `ran:${request.text}`, truncated: false }),
      cancel: () => false,
    }
  }

  read(request: TerminalReadRequest): TerminalReadResult {
    this.reads.push(request)
    return {
      text: 'retained terminal output',
      totalLines: 12,
      lineBegin: request.offset ?? 0,
      lineEnd: (request.offset ?? 0) + (request.count ?? 4),
      truncated: false,
    }
  }

  async signal(signal: TerminalSignal): Promise<TerminalSignalResult> {
    this.signals.push(signal)
    return { delivered: true, targetPgid: 4242 }
  }

  status(): TerminalSessionStatus {
    return { kind: 'running' }
  }
}

describe('SessionControlController terminal ownership seam', () => {
  it('opens, interacts with, and closes a PTY only through the addressed live Session owner', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(TerminalSessionService)

    const terminals: StubTerminal[] = []
    ctx.terminals.registerBackend({
      type: 'stub',
      async spawn() {
        const terminal = new StubTerminal()
        terminals.push(terminal)
        return terminal
      },
    })

    const firstSession = ctx.sessions.create()
    const secondSession = ctx.sessions.create()
    const first = liveAgent(ctx, firstSession.id)
    const second = liveAgent(ctx, secondSession.id)
    ctx.agents.register(first)
    ctx.agents.register(second)

    const control = new SessionControlController(ctx) as SessionControlController & TerminalControlFace

    expect(control.terminalBackends()).toEqual(['stub'])
    const opened = await control.openTerminal(firstSession.id, {
      type: 'stub',
      name: 'lead-shell',
      cwd: '/workspace',
    })
    expect(opened).toMatchObject({
      sessionId: 'pty-1',
      name: 'lead-shell',
      type: 'stub',
      pid: 4242,
      motd: 'stub ready',
      status: { kind: 'running' },
    })
    expect(control.listTerminals(firstSession.id)).toEqual([
      expect.objectContaining({ sessionId: opened.sessionId, name: 'lead-shell' }),
    ])
    expect(control.listTerminals(secondSession.id)).toEqual([])

    await expect(control.sendTerminal(firstSession.id, opened.sessionId, {
      text: 'codex --help',
      submit: true,
    })).resolves.toEqual({
      viewport: 'ran:codex --help',
      waitReason: 'inferred_idle',
      sessionStatus: { kind: 'running' },
      truncated: false,
    })
    expect(control.readTerminal(firstSession.id, opened.sessionId, { offset: 2, count: 3 })).toEqual({
      text: 'retained terminal output',
      totalLines: 12,
      lineBegin: 2,
      lineEnd: 5,
      truncated: false,
    })
    await expect(control.signalTerminal(firstSession.id, opened.sessionId, 'SIGINT')).resolves.toEqual({
      delivered: true,
      targetPgid: 4242,
    })
    expect(terminals[0]?.sends).toEqual([{ text: 'codex --help', submit: true }])
    expect(terminals[0]?.reads).toEqual([{ offset: 2, count: 3 }])
    expect(terminals[0]?.signals).toEqual(['SIGINT'])

    await expect(control.sendTerminal(secondSession.id, opened.sessionId, {
      text: 'steal-session',
      submit: true,
    })).rejects.toThrow('belongs to another agent')
    expect(() => control.readTerminal(secondSession.id, opened.sessionId)).toThrow('belongs to another agent')
    await expect(control.signalTerminal(secondSession.id, opened.sessionId, 'SIGTERM'))
      .rejects.toThrow('belongs to another agent')
    await expect(control.closeTerminal(secondSession.id, opened.sessionId)).rejects.toThrow('belongs to another agent')

    await expect(control.closeTerminal(firstSession.id, opened.sessionId)).resolves.toBe('closed')
    expect(terminals[0]?.close).toHaveBeenCalledWith('human closed terminal')
    expect(control.listTerminals(firstSession.id)).toEqual([])
  })
})
