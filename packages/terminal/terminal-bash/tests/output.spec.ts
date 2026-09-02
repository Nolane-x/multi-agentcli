import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '@deepseek-ai/dsh-terminal-bash/src/config.ts'
import { LocalPtySession } from '@deepseek-ai/dsh-terminal-bash/src/session.ts'
import type { SubprocessOutcome, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'

class OutputTerminal implements SubprocessTerminalHandle {
  readonly pid = 123
  readonly output = new PassThrough()
  readonly outcome = Promise.withResolvers<SubprocessOutcome>()
  readonly done = this.outcome.promise

  async write(): Promise<void> {}
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

type RawOutputSession = {
  subscribeOutput(listener: (data: string) => void): () => void
}

describe('LocalPtySession raw output', () => {
  it('preserves ANSI/control data and UTF-8 characters split across provider chunks', async () => {
    const terminal = new OutputTerminal()
    const session = new LocalPtySession(terminal, config())
    const raw = session as unknown as RawOutputSession
    const received: string[] = []
    const dispose = raw.subscribeOutput(data => { received.push(data) })
    const lambda = Buffer.from('λ', 'utf8')

    terminal.output.write(Buffer.from('\u001b[2J', 'utf8'))
    terminal.output.write(lambda.subarray(0, 1))
    terminal.output.write(lambda.subarray(1))
    terminal.output.write(Buffer.from('\r\n', 'utf8'))

    expect(received.join('')).toBe('\u001b[2Jλ\r\n')
    dispose()
    dispose()
    terminal.output.write('after-dispose')
    expect(received.join('')).toBe('\u001b[2Jλ\r\n')
    await session.close('test complete')
  })

  it('isolates a failing raw-output consumer from the PTY transport and other consumers', async () => {
    const terminal = new OutputTerminal()
    const session = new LocalPtySession(terminal, config())
    const raw = session as unknown as RawOutputSession
    const received: string[] = []
    raw.subscribeOutput(() => { throw new Error('consumer failed') })
    raw.subscribeOutput(data => { received.push(data) })

    expect(() => { terminal.output.write('\u001b[?25lhello') }).not.toThrow()
    expect(received).toEqual(['\u001b[?25lhello'])
    await session.close('test complete')
  })
})
