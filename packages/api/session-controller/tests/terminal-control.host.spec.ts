import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { TerminalControlController } from '../src/terminal-control.ts'

function testContext(terminals: object, owner: object | undefined = { id: SessionId('owner') }): Context {
  const ctx = new Context()
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
  } as never)
  ctx.provide('agents', {
    get: (id: string) => id === 'owner' ? owner : undefined,
  } as never)
  ctx.provide('terminals' as never, terminals as never)
  return ctx
}

describe('TerminalControlController', () => {
  it('routes terminal lifecycle and interaction through the exact live Agent owner', async () => {
    const owner = { id: SessionId('owner') }
    const seen: Array<[string, unknown, ...unknown[]]> = []
    const terminals = {
      listBackends: () => ['shell'],
      list: (agent: unknown) => {
        seen.push(['list', agent])
        return [{ sessionId: 'pty-1', type: 'shell', pid: 123, status: { kind: 'running' } }]
      },
      spawn: async (agent: unknown, request: unknown) => {
        seen.push(['spawn', agent, request])
        return { sessionId: 'pty-2', type: 'shell', pid: 456, status: { kind: 'running' }, motd: '$ ' }
      },
      write: async (agent: unknown, id: string, data: string) => { seen.push(['write', agent, id, data]) },
      resize: async (agent: unknown, id: string, rows: number, cols: number) => {
        seen.push(['resize', agent, id, rows, cols])
      },
      signal: async (agent: unknown, id: string, signal: string) => {
        seen.push(['signal', agent, id, signal])
        return { delivered: true, targetPgid: 456 }
      },
      kill: async (agent: unknown, id: string, reason: string) => {
        seen.push(['kill', agent, id, reason])
        return true
      },
      subscribeOutput: () => () => {},
    }
    const controller = new TerminalControlController(testContext(terminals, owner))
    const signal = new AbortController().signal

    expect(controller.backends()).toEqual({ items: ['shell'] })
    expect(controller.list({ sessionId: SessionId('owner') })).toEqual({
      items: [{ terminalId: 'pty-1', type: 'shell', pid: 123, status: { kind: 'running' } }],
    })
    await expect(controller.open({ sessionId: SessionId('owner'), type: 'shell', name: 'claude' }, signal))
      .resolves.toEqual({ terminalId: 'pty-2', type: 'shell', pid: 456, status: { kind: 'running' }, motd: '$ ' })
    await controller.write({ sessionId: SessionId('owner'), terminalId: 'pty-2', data: 'claude\r' })
    await controller.resize({ sessionId: SessionId('owner'), terminalId: 'pty-2', rows: 40, cols: 120 })
    await expect(controller.signal({ sessionId: SessionId('owner'), terminalId: 'pty-2', signal: 'SIGINT' }))
      .resolves.toEqual({ delivered: true, targetPgid: 456 })
    await expect(controller.close({ sessionId: SessionId('owner'), terminalId: 'pty-2' }))
      .resolves.toEqual({ closed: true })

    expect(seen).toEqual([
      ['list', owner],
      ['spawn', owner, { type: 'shell', name: 'claude' }],
      ['write', owner, 'pty-2', 'claude\r'],
      ['resize', owner, 'pty-2', 40, 120],
      ['signal', owner, 'pty-2', 'SIGINT'],
      ['kill', owner, 'pty-2', 'terminal Remote close'],
    ])
  })

  it('streams exact PTY output and disposes the owner subscription when the carrier aborts', async () => {
    const owner = { id: SessionId('owner') }
    let listener: ((data: string) => void) | undefined
    const dispose = vi.fn()
    const terminals = {
      listBackends: () => ['shell'],
      list: () => [],
      subscribeOutput: (agent: unknown, id: string, next: (data: string) => void) => {
        expect(agent).toBe(owner)
        expect(id).toBe('pty-1')
        listener = next
        return dispose
      },
    }
    const controller = new TerminalControlController(testContext(terminals, owner))
    const abort = new AbortController()
    const iterator = controller.output(
      { sessionId: SessionId('owner'), terminalId: 'pty-1' },
      abort.signal,
    )[Symbol.asyncIterator]()
    const first = iterator.next()

    listener?.('\u001b[2Jλ\r\n')
    await expect(first).resolves.toEqual({ done: false, value: { data: '\u001b[2Jλ\r\n' } })
    abort.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('rejects terminal access when the Session has no live Agent instead of guessing ownership', () => {
    const controller = new TerminalControlController(testContext({ listBackends: () => [], list: () => [] }, undefined))
    try {
      controller.list({ sessionId: SessionId('owner') })
      expect.fail('expected owner resolution to fail')
    } catch (error: unknown) {
      expect(remoteErrorOf(error)?.code).toBe('terminal/owner-unavailable')
    }
  })
})
