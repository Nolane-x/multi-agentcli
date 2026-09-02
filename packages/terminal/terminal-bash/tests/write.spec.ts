import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '@deepseek-ai/dsh-terminal-bash/src/config.ts'
import { LocalPtySession } from '@deepseek-ai/dsh-terminal-bash/src/session.ts'
import type { SubprocessOutcome, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'

class OrderedTerminal implements SubprocessTerminalHandle {
  readonly pid = 123
  readonly output = new PassThrough()
  readonly outcome = Promise.withResolvers<SubprocessOutcome>()
  readonly done = this.outcome.promise
  readonly writes: string[] = []
  firstWriteGate: PromiseWithResolvers<void> | undefined

  async write(data: string): Promise<void> {
    this.writes.push(data)
    if (this.writes.length === 1 && this.firstWriteGate !== undefined) await this.firstWriteGate.promise
  }
  async resize(): Promise<void> {}
  async inspectForeground() { return { processGroupId: 123, inputWaiting: true } }
  async signalForeground() { return 123 }
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

describe('LocalPtySession raw input', () => {
  it('serializes rapid keystrokes in exact call order', async () => {
    const terminal = new OrderedTerminal()
    terminal.firstWriteGate = Promise.withResolvers<void>()
    const session = new LocalPtySession(terminal, config())

    const first = session.write('a')
    const second = session.write('\u001b[A')
    await Promise.resolve()
    expect(terminal.writes).toEqual(['a'])

    terminal.firstWriteGate.resolve()
    await Promise.all([first, second])
    expect(terminal.writes).toEqual(['a', '\u001b[A'])
    await session.close('test complete')
  })

  it('fences model sends while raw input is still draining', async () => {
    const terminal = new OrderedTerminal()
    terminal.firstWriteGate = Promise.withResolvers<void>()
    const session = new LocalPtySession(terminal, config())

    const pending = session.write('codex\r')
    expect(() => session.startSend({ text: 'echo should-not-race', submit: true })).toThrowErrorMatchingObject({ code: 'SEND_ACTIVE' })

    terminal.firstWriteGate.resolve()
    await pending
    await session.close('test complete')
  })

  it('fences raw input while a model send owns the interaction slot', async () => {
    const terminal = new OrderedTerminal()
    const session = new LocalPtySession(terminal, config())
    const operation = session.startSend({ text: '', submit: false })

    await expect(session.write('x')).rejects.toMatchObject({ code: 'SEND_ACTIVE' })
    operation.cancel()
    await session.close('test complete')
  })
})
