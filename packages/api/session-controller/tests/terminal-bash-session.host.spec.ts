import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../../../terminal/terminal-bash/src/config.ts'
import { LocalPtySession } from '../../../terminal/terminal-bash/src/session.ts'
import type { SubprocessOutcome, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'

class HostTerminal implements SubprocessTerminalHandle {
  readonly pid = 321
  readonly output = new PassThrough()
  readonly outcome = Promise.withResolvers<SubprocessOutcome>()
  readonly done = this.outcome.promise
  readonly writes: string[] = []
  readonly resizes: Array<[number, number]> = []
  firstWriteGate: PromiseWithResolvers<undefined> | undefined

  emitData(data: string): void {
    this.output.write(Buffer.from(data, 'utf8'))
  }

  async write(data: string): Promise<void> {
    this.writes.push(data)
    if (this.writes.length === 1 && this.firstWriteGate !== undefined) await this.firstWriteGate.promise
  }

  async resize(rows: number, cols: number): Promise<void> {
    this.resizes.push([rows, cols])
  }

  async inspectForeground() {
    return { processGroupId: 321, inputWaiting: true }
  }

  async signalForeground() {
    return 321
  }

  async terminate(): Promise<void> {
    this.output.end()
    this.outcome.resolve({ exitCode: 0, signal: null })
  }
}

function config(): ResolvedConfig {
  return {
    backendType: 'shell', shellDialect: 'bash', shellPath: '/bin/bash', shellArgs: [], rows: 24, cols: 80,
    scrollbackLines: 10, scrollbackMaxBytes: 128, maxReadBytes: 64,
    pollIntervalMs: 10, exactProbeAfterMs: 20, idleSilenceMs: 50, handoffGraceMs: 10, timeoutMs: 100,
    disposeGraceMs: 20,
  }
}

async function markExited(terminal: HostTerminal): Promise<void> {
  const ended = new Promise<void>((resolve) => { terminal.output.once('end', resolve) })
  terminal.output.end()
  terminal.outcome.resolve({ exitCode: 0, signal: null })
  await ended
  await new Promise<void>(resolve => setImmediate(resolve))
}

describe('LocalPtySession host raw terminal surface', () => {
  it('publishes exact output and clears observers when the emulator closes', async () => {
    const terminal = new HostTerminal()
    const session = new LocalPtySession(terminal, config())
    const received: string[] = []
    const listener = (data: string): void => { received.push(data) }
    const dispose = session.subscribeOutput(listener)

    terminal.output.write('\u001b[2Jλ')
    expect(received.join('')).toBe('\u001b[2Jλ')
    dispose()
    dispose()
    terminal.output.write('ignored')
    expect(received).toEqual(['\u001b[2Jλ'])

    await session.close('test complete')
    expect(() => session.subscribeOutput(listener)).toThrow('PTY session is closing')
    await expect(session.write('after-close')).rejects.toThrow('PTY session is closing')
  })

  it('serializes raw writes and reserves the model-send slot while input drains', async () => {
    const terminal = new HostTerminal()
    terminal.firstWriteGate = Promise.withResolvers<undefined>()
    const session = new LocalPtySession(terminal, config())

    const first = session.write('a')
    await Promise.resolve()
    const second = session.write('\u001b[A')
    expect(() => session.startSend({ text: 'must wait', submit: true })).toThrow(/draining raw input/)

    terminal.firstWriteGate.resolve(undefined)
    await Promise.all([first, second])
    expect(terminal.writes).toEqual(['a', '\u001b[A'])
    await session.close('test complete')

    const modelSession = new LocalPtySession(new HostTerminal(), config())
    const modelSend = modelSession.startSend({ text: '', submit: false })
    await expect(modelSession.write('raw while model is active')).rejects.toThrow('active model send')
    modelSend.cancel()
    await modelSession.close('test complete')
  })

  it('rejects a queued raw write when closing starts', async () => {
    const terminal = new HostTerminal()
    terminal.firstWriteGate = Promise.withResolvers<undefined>()
    const session = new LocalPtySession(terminal, config())

    const first = session.write('first')
    await Promise.resolve()
    const second = session.write('second')
    const closing = session.close('test close')
    terminal.firstWriteGate.resolve(undefined)

    await first
    await expect(second).rejects.toThrow('PTY session is closing')
    await closing
  })

  it('rejects a queued raw write after the provider reports exit', async () => {
    const terminal = new HostTerminal()
    terminal.firstWriteGate = Promise.withResolvers<undefined>()
    const session = new LocalPtySession(terminal, config())

    const first = session.write('first')
    await Promise.resolve()
    const second = session.write('second')
    await markExited(terminal)
    terminal.firstWriteGate.resolve(undefined)

    await first
    await expect(second).rejects.toThrow('PTY session has exited')
    await session.close('test complete')
  })

  it('waits for terminal protocol replies before sending raw input', async () => {
    const terminal = new HostTerminal()
    terminal.firstWriteGate = Promise.withResolvers<undefined>()
    const session = new LocalPtySession(terminal, config())

    terminal.emitData('\x1b[6n')
    await new Promise<void>(resolve => setImmediate(resolve))
    const input = session.write('raw input')
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(terminal.writes).toEqual(['\x1b[1;1R'])

    terminal.firstWriteGate.resolve(undefined)
    await input
    expect(terminal.writes).toEqual(['\x1b[1;1R', 'raw input'])
    await session.close('test complete')
  })

  it('resizes live terminals, rejects unsupported providers, and fences closed sessions', async () => {
    const terminal = new HostTerminal()
    const session = new LocalPtySession(terminal, config())
    terminal.output.write('output before resize')
    await session.resize(41, 119)
    expect(terminal.resizes).toEqual([[41, 119]])
    await session.close('test complete')
    await expect(session.resize(30, 90)).rejects.toThrow('PTY session is closing')

    const unsupportedTerminal = new HostTerminal()
    Object.defineProperty(unsupportedTerminal, 'resize', { value: undefined })
    const unsupported = new LocalPtySession(unsupportedTerminal, config())
    await expect(unsupported.resize(30, 90)).rejects.toMatchObject({ code: 'RESIZE_UNSUPPORTED' })
    await unsupported.close('test complete')

    const exitedTerminal = new HostTerminal()
    const exited = new LocalPtySession(exitedTerminal, config())
    await markExited(exitedTerminal)
    expect(() => exited.subscribeOutput(() => {})).toThrow('PTY session has exited')
    await expect(exited.write('input')).rejects.toThrow('PTY session has exited')
    await expect(exited.resize(30, 90)).rejects.toThrow('PTY session has exited')
    await exited.close('test complete')
  })

  it('waits for a pending emulator response before resizing', async () => {
    const terminal = new HostTerminal()
    terminal.firstWriteGate = Promise.withResolvers<undefined>()
    const session = new LocalPtySession(terminal, config())

    terminal.emitData('\x1b[6n')
    await new Promise<void>(resolve => setImmediate(resolve))
    const resize = session.resize(30, 90)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(terminal.resizes).toEqual([])

    terminal.firstWriteGate.resolve(undefined)
    await resize
    expect(terminal.resizes).toEqual([[30, 90]])
    await session.close('test complete')
  })

  it('keeps a live session resizeable after output closes the emulator', async () => {
    const terminal = new HostTerminal()
    const session = new LocalPtySession(terminal, config())
    const ended = new Promise<void>((resolve) => { terminal.output.once('end', resolve) })
    terminal.output.end()
    await ended

    await session.resize(30, 90)
    expect(terminal.resizes).toEqual([[30, 90]])
    await session.close('test complete')
  })
})
