import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '@deepseek-ai/dsh-terminal-bash/src/config.ts'
import { LocalPtySession } from '@deepseek-ai/dsh-terminal-bash/src/session.ts'
import type { SubprocessOutcome, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'

class ResizableTerminal implements SubprocessTerminalHandle {
  readonly pid = 123
  readonly output = new PassThrough()
  readonly outcome = Promise.withResolvers<SubprocessOutcome>()
  readonly done = this.outcome.promise
  readonly resizes: Array<[number, number]> = []

  async write(): Promise<void> {}
  async resize(rows: number, cols: number): Promise<void> { this.resizes.push([rows, cols]) }
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

describe('LocalPtySession live resize', () => {
  it('keeps provider PTY and headless emulator geometry in lockstep', async () => {
    const terminal = new ResizableTerminal()
    const session = new LocalPtySession(terminal, config())

    await session.resize(41, 119)

    expect(terminal.resizes).toEqual([[41, 119]])
    const emulator = (session as unknown as { emulator: { rows: number; cols: number } }).emulator
    expect({ rows: emulator.rows, cols: emulator.cols }).toEqual({ rows: 41, cols: 119 })
    await session.close('test complete')
  })

  it('rejects providers without resize instead of leaving stale TUI geometry', async () => {
    const terminal = new ResizableTerminal()
    Object.defineProperty(terminal, 'resize', { value: undefined })
    const session = new LocalPtySession(terminal, config())

    await expect(session.resize(30, 90)).rejects.toMatchObject({ code: 'RESIZE_UNSUPPORTED' })
    const emulator = (session as unknown as { emulator: { rows: number; cols: number } }).emulator
    expect({ rows: emulator.rows, cols: emulator.cols }).toEqual({ rows: 24, cols: 80 })
    await session.close('test complete')
  })
})
