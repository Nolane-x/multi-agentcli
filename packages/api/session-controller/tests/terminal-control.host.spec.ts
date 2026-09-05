import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { TerminalControlController } from '../src/terminal-control.ts'

function testContext(terminals?: object, owner: object | undefined = { id: SessionId('owner') }, hasOwner = true): Context {
  const ctx = new Context()
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
  } as never)
  ctx.provide('agents', {
    get: (id: string) => id === 'owner' && hasOwner ? owner : undefined,
  } as never)
  if (terminals !== undefined) ctx.provide('terminals' as never, terminals as never)
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
    await expect(controller.open({ sessionId: SessionId('owner'), type: 'shell', name: 'claude', cwd: '/repo' }, signal))
      .resolves.toEqual({ terminalId: 'pty-2', type: 'shell', pid: 456, status: { kind: 'running' }, motd: '$ ' })
    await controller.write({ sessionId: SessionId('owner'), terminalId: 'pty-2', data: 'claude\r' })
    await controller.resize({ sessionId: SessionId('owner'), terminalId: 'pty-2', rows: 40, cols: 120 })
    await expect(controller.signal({ sessionId: SessionId('owner'), terminalId: 'pty-2', signal: 'SIGINT' }))
      .resolves.toEqual({ delivered: true, targetPgid: 456 })
    await expect(controller.close({ sessionId: SessionId('owner'), terminalId: 'pty-2' }))
      .resolves.toEqual({ closed: true })

    expect(seen).toEqual([
      ['list', owner],
      ['spawn', owner, { type: 'shell', name: 'claude', cwd: '/repo' }],
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
    listener?.('after-close')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('rejects terminal access when the Session has no live Agent instead of guessing ownership', () => {
    const controller = new TerminalControlController(testContext({ listBackends: () => [], list: () => [] }, undefined, false))
    try {
      controller.list({ sessionId: SessionId('owner') })
      expect.fail('expected owner resolution to fail')
    } catch (error: unknown) {
      expect(remoteErrorOf(error)?.code).toBe('terminal/owner-unavailable')
    }
  })

  it('projects optional terminal fields and exited status without inventing values', () => {
    const controller = new TerminalControlController(testContext({
      listBackends: () => ['shell', 'pwsh'],
      list: () => [
        {
          sessionId: 'pty-exited',
          name: 'finished',
          type: 'shell',
          status: { kind: 'exited', exitCode: 1, signal: null },
        },
        { sessionId: 'pty-running', type: 'pwsh', status: { kind: 'running' } },
      ],
    }))

    expect(controller.backends()).toEqual({ items: ['shell', 'pwsh'] })
    expect(controller.list({ sessionId: SessionId('owner') })).toEqual({
      items: [
        {
          terminalId: 'pty-exited', name: 'finished', type: 'shell',
          status: { kind: 'exited', exitCode: 1, signal: null },
        },
        { terminalId: 'pty-running', type: 'pwsh', status: { kind: 'running' } },
      ],
    })
  })

  it('rejects malformed, cancelled, and unsupported terminal requests', async () => {
    const controller = new TerminalControlController(testContext({
      listBackends: () => [],
      list: () => [],
      spawn: async () => ({ sessionId: 'unused', type: 'shell', status: { kind: 'running' }, motd: '' }),
      write: async () => {},
      resize: async () => {},
      signal: async () => ({ delivered: true, targetPgid: 1 }),
      kill: async () => true,
      subscribeOutput: () => () => {},
    }))
    const live = new AbortController().signal

    await expect(controller.open({ sessionId: SessionId('owner'), type: '' }, live)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(controller.open({ sessionId: SessionId('owner'), type: 'shell', name: '' }, live)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    const aborted = new AbortController()
    aborted.abort()
    await expect(controller.open({ sessionId: SessionId('owner'), type: 'shell' }, aborted.signal)).rejects.toThrow()

    await expect(controller.write({ sessionId: SessionId('owner'), terminalId: '', data: 'x' })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(controller.resize({ sessionId: SessionId('owner'), terminalId: '', rows: 1, cols: 1 })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(controller.resize({ sessionId: SessionId('owner'), terminalId: 'pty', rows: 0, cols: 1 })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(controller.resize({ sessionId: SessionId('owner'), terminalId: 'pty', rows: 1, cols: Number.POSITIVE_INFINITY })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(() => controller.signal({ sessionId: SessionId('owner'), terminalId: '', signal: 'SIGINT' })).toThrow(/terminal id must be non-empty/)
    expect(() => controller.signal({ sessionId: SessionId('owner'), terminalId: 'pty', signal: 'SIGSTOP' as never })).toThrow(/unsupported signal/)
    await expect(controller.close({ sessionId: SessionId('owner'), terminalId: '' })).rejects.toMatchObject({ code: 'gateway/bad-request' })
  })

  it('normalizes registry failures while preserving RemoteError identity and codes', async () => {
    const owner = { id: SessionId('owner') }
    const rejected = new Error('busy')
    Object.assign(rejected, { code: 'PTY_BUSY' })
    const controller = new TerminalControlController(testContext({
      listBackends: () => [],
      list: () => { throw rejected },
      spawn: async () => { throw new Error('spawn failed') },
      write: async () => { throw new RemoteError('terminal/rejected', 'already rejected', { code: 'EXISTING' }) },
      resize: async () => {},
      signal: async () => ({ delivered: true, targetPgid: 1 }),
      kill: async () => true,
      subscribeOutput: () => () => {},
    }, owner))

    expect(() => controller.list({ sessionId: SessionId('owner') })).toThrow(/rejected by the owner-scoped PTY registry/)
    await expect(controller.open({ sessionId: SessionId('owner'), type: 'shell' }, new AbortController().signal)).rejects.toThrow('terminal operation failed')
    await expect(controller.write({ sessionId: SessionId('owner'), terminalId: 'pty', data: 'x' })).rejects.toMatchObject({ code: 'terminal/rejected' })

    const primitiveFailure = new TerminalControlController(testContext({
      listBackends: () => [],
      list: () => { throw 'primitive failure' },
    }, owner))
    expect(() => primitiveFailure.list({ sessionId: SessionId('owner') })).toThrow(/terminal operation failed/)
  })

  it('reports missing registry and output subscription failures through stable errors', async () => {
    const missing = new TerminalControlController(testContext())
    expect(() => missing.backends()).toThrow(/terminal service is unavailable/)

    const controller = new TerminalControlController(testContext({
      listBackends: () => [],
      list: () => [],
      subscribeOutput: () => { throw { code: 'OUTPUT_BUSY' } },
    }))
    const output = controller.output(
      { sessionId: SessionId('owner'), terminalId: 'pty' },
      new AbortController().signal,
    )
    await expect(output[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'terminal/rejected' })

    const aborted = new AbortController()
    aborted.abort()
    const cancelled = controller.output(
      { sessionId: SessionId('owner'), terminalId: 'pty' },
      aborted.signal,
    )
    await expect(cancelled[Symbol.asyncIterator]().next()).rejects.toThrow()
  })

  it('handles an abort that races output queue waiter installation', async () => {
    let listener: ((data: string) => void) | undefined
    let addCount = 0
    let carrierAborted = false
    const carrier = {
      get aborted() { return carrierAborted },
      addEventListener: (_type: string, callback: EventListenerOrEventListenerObject) => {
        addCount += 1
        if (addCount === 2) {
          carrierAborted = true
          if (typeof callback === 'function') callback(new Event('abort'))
        }
      },
      removeEventListener: () => {},
      throwIfAborted: () => {},
    } as unknown as AbortSignal
    const controller = new TerminalControlController(testContext({
      listBackends: () => [],
      list: () => [],
      subscribeOutput: (_owner: object, _id: string, next: (data: string) => void) => {
        listener = next
        return () => {}
      },
    }))

    const iterator = controller.output(
      { sessionId: SessionId('owner'), terminalId: 'pty' },
      carrier,
    )[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    listener?.('ignored')
  })
})
