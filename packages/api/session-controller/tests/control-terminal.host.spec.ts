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
  TerminalSendOperation,
  TerminalSendRequest,
  TerminalSessionId,
  TerminalSessionSnapshot,
  TerminalSessionStatus,
  TerminalSignal,
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

  startSend(_request: TerminalSendRequest): TerminalSendOperation {
    return {
      done: Promise.resolve({
        viewport: '',
        waitReason: 'inferred_idle',
        sessionStatus: { kind: 'running' },
        truncated: false,
      }),
      readOutput: () => ({ delta: '', truncated: false }),
      cancel: () => false,
    }
  }

  read(_request: TerminalReadRequest) {
    return { text: '', totalLines: 0, lineBegin: 0, lineEnd: 0, truncated: false }
  }

  async signal(_signal: TerminalSignal) {
    return { delivered: true as const, targetPgid: 4242 }
  }

  status(): TerminalSessionStatus {
    return { kind: 'running' }
  }
}

describe('SessionControlController terminal ownership seam', () => {
  it('opens, lists, and closes a PTY only through the addressed live Session owner', async () => {
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

    await expect(control.closeTerminal(secondSession.id, opened.sessionId)).rejects.toThrow('belongs to another agent')
    await expect(control.closeTerminal(firstSession.id, opened.sessionId)).resolves.toBe('closed')
    expect(terminals[0]?.close).toHaveBeenCalledWith('human closed terminal')
    expect(control.listTerminals(firstSession.id)).toEqual([])
  })
})
