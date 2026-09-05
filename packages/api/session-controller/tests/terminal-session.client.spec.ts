import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TerminalCloseValue,
  TerminalListValue,
  TerminalOpenValue,
  TerminalOutputFrame,
  TerminalSignalValue,
} from '../src/terminal-types.ts'
import {
  createTerminalSessionClient,
  type TerminalSessionClient,
} from '../src/client/terminal-session.ts'
import type { SessionTerminalRemote } from '../src/client/sessions/remotes.ts'

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function fakeTerminalRemote() {
  const remote = {
    backends: vi.fn(async () => ok({ items: ['shell'] })),
    list: vi.fn(async () => ok<TerminalListValue>({ items: [] })),
    open: vi.fn(async () => ok<TerminalOpenValue>({
      terminalId: 'pty-1',
      type: 'shell',
      status: { kind: 'running' },
      motd: '',
    })),
    output: vi.fn((_request, _signal): AsyncIterable<TerminalOutputFrame> => (async function * () {})()),
    write: vi.fn(async () => ok(undefined)),
    resize: vi.fn(async () => ok(undefined)),
    signal: vi.fn(async () => ok<TerminalSignalValue>({ delivered: true, targetPgid: 11 })),
    close: vi.fn(async () => ok<TerminalCloseValue>({ closed: true })),
  } satisfies SessionTerminalRemote
  return remote
}

describe('TerminalSessionClient', () => {
  it('forwards terminal operations through the exact session address', async () => {
    const remote = fakeTerminalRemote()
    const client: TerminalSessionClient = createTerminalSessionClient(remote)
    const sessionId = 'agent-a' as SessionId
    const signal = new AbortController().signal

    await client.backends()
    await client.list(sessionId)
    await client.open(sessionId, { type: 'shell', cwd: '/repo' }, signal)
    await client.write(sessionId, 'pty-1', 'ls\r')
    await client.resize(sessionId, 'pty-1', 24, 80)
    await client.signal(sessionId, 'pty-1', 'SIGINT')
    await client.close(sessionId, 'pty-1')

    expect(remote.backends).toHaveBeenCalledOnce()
    expect(remote.list).toHaveBeenCalledWith({ sessionId })
    expect(remote.open).toHaveBeenCalledWith(
      { sessionId, type: 'shell', cwd: '/repo' }, signal,
    )
    expect(remote.write).toHaveBeenCalledWith({ sessionId, terminalId: 'pty-1', data: 'ls\r' })
    expect(remote.resize).toHaveBeenCalledWith({ sessionId, terminalId: 'pty-1', rows: 24, cols: 80 })
    expect(remote.signal).toHaveBeenCalledWith({ sessionId, terminalId: 'pty-1', signal: 'SIGINT' })
    expect(remote.close).toHaveBeenCalledWith({ sessionId, terminalId: 'pty-1' })
  })

  it('keeps the output stream owner-addressed and passes cancellation through', async () => {
    const remote = fakeTerminalRemote()
    const client = createTerminalSessionClient(remote)
    const sessionId = 'agent-b' as SessionId
    const signal = new AbortController().signal

    client.output(sessionId, 'pty-2', signal)

    expect(remote.output).toHaveBeenCalledWith({ sessionId, terminalId: 'pty-2' }, signal)
  })
})
