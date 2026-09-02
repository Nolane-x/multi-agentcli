import type { IDisposable, IPty } from 'node-pty'
import { describe, expect, it } from 'vitest'
import { LocalTerminalHandle } from '@deepseek-ai/dsh-subprocess-local/src/terminal.ts'
import type {
  ProcessInspector,
  ProcessSnapshot,
} from '@deepseek-ai/dsh-subprocess-local/src/process-inspector.ts'

class ResizePty {
  pid = 123
  readonly resizes: Array<[number, number]> = []
  private exited = false
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()

  readonly onData = (listener: (data: string) => void): IDisposable => {
    this.dataListeners.add(listener)
    return { dispose: () => { this.dataListeners.delete(listener) } }
  }

  readonly onExit = (listener: (event: { exitCode: number; signal?: number }) => void): IDisposable => {
    this.exitListeners.add(listener)
    return { dispose: () => { this.exitListeners.delete(listener) } }
  }

  write(): void {}
  kill(): void { this.emitExit() }
  resize(columns: number, rows: number): void { this.resizes.push([columns, rows]) }

  emitExit(): void {
    if (this.exited) return
    this.exited = true
    for (const listener of this.exitListeners) listener({ exitCode: 0 })
  }

  asPty(): IPty { return this as unknown as IPty }
}

function inspector(): ProcessInspector {
  const root = { pid: 123, started: 'shell' }
  const snapshot: ProcessSnapshot = {
    tree: () => [root],
    session: () => [],
    alive: () => true,
  }
  return {
    snapshot: () => snapshot,
    foregroundPgid: () => 123,
    isStdinWaiting: () => false,
    isAlive: () => true,
    signalGroup: () => {},
    signalProcess: () => {},
  } as unknown as ProcessInspector
}

describe('LocalTerminalHandle resize', () => {
  it('maps rows/cols to node-pty columns/rows without changing the public seam order', async () => {
    const pty = new ResizePty()
    const handle = new LocalTerminalHandle(pty.asPty(), inspector(), 10, 'linux')

    await handle.resize(40, 120)

    expect(pty.resizes).toEqual([[120, 40]])
  })

  it('rejects resize after terminal exit', async () => {
    const pty = new ResizePty()
    const handle = new LocalTerminalHandle(pty.asPty(), inspector(), 10, 'linux')
    pty.emitExit()

    await expect(handle.resize(24, 80)).rejects.toThrow('terminal process has exited')
  })
})
