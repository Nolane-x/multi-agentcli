import { describe, expect, it } from 'vitest'
import type { SubprocessTerminal } from '@deepseek-ai/dsh-subprocess'
import { LocalPtySession } from '../src/session.ts'
import { config } from './fixtures.ts'

class OrderedTerminal implements SubprocessTerminal {
  readonly output = new EventTarget() as SubprocessTerminal['output']
  readonly writes: string[] = []
  readonly pid = 1
  firstWriteGate: PromiseWithResolvers<void> | undefined

  async write(data: string): Promise<void> {
    this.writes.push(data)
    if (this.writes.length === 1 && this.firstWriteGate !== undefined) await this.firstWriteGate.promise
  }

  async close(): Promise<void> {}

  async signalForeground(): Promise<number> {
    return 1
  }

  status(): { kind: 'running' } {
    return { kind: 'running' }
  }
}

describe('LocalPtySession raw input', () => {
  it('writes exact control sequences without adding a submit newline', async () => {
    const terminal = new OrderedTerminal()
    const session = new LocalPtySession(terminal, config())

    await session.write('\u001b[A')

    expect(terminal.writes).toEqual(['\u001b[A'])
    await session.close('test complete')
  })

  it('serializes concurrent raw writes in admission order', async () => {
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
    expect(() => session.startSend({ text: 'echo should-not-race', submit: true })).toThrowMatchingObject({ code: 'SEND_ACTIVE' })

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
