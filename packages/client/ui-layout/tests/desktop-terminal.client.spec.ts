// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  createDesktopTerminalWorkspace,
  DESKTOP_TERMINAL_BACKEND,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/desktop-terminal.ts'

interface NativeTerminalEvent {
  readonly event: 'output' | 'exited'
  readonly data?: string
}

class FakeChannel<T> {
  onmessage: (message: T) => void

  constructor(onmessage?: (message: T) => void) {
    this.onmessage = onmessage ?? (() => undefined)
  }
}

function installTauri() {
  let channel: FakeChannel<NativeTerminalEvent> | undefined
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'desktop_terminal_open') {
      channel = args?.onEvent as FakeChannel<NativeTerminalEvent>
      return {
        terminalId: 'native-1',
        cwd: '/workspace/project',
        shell: '/bin/sh',
      }
    }
    if (command === 'desktop_terminal_default_cwd') return '/workspace'
    if (command === 'desktop_terminal_pick_cwd') return '/workspace/project'
    if (command === 'desktop_terminal_close') return true
    return undefined
  })
  Object.defineProperty(window, '__TAURI__', {
    configurable: true,
    value: { core: { Channel: FakeChannel, invoke } },
  })
  return {
    invoke,
    emit: (event: NativeTerminalEvent) => { channel?.onmessage(event) },
  }
}

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI__')
  vi.restoreAllMocks()
})

describe('desktop native terminal workspace', () => {
  it('is absent in the ordinary browser Harness', () => {
    expect(createDesktopTerminalWorkspace()).toBeUndefined()
  })

  it('opens a native terminal without a live Harness Session and streams its channel output', async () => {
    const tauri = installTauri()
    const workspace = createDesktopTerminalWorkspace()
    if (workspace === undefined) throw new Error('desktop workspace was not detected')

    const opened = await workspace.terminal.open('desktop-workspace' as SessionId, {
      type: DESKTOP_TERMINAL_BACKEND,
      cwd: '/workspace/project',
    })
    if (!opened.ok) throw new Error(opened.error.message)

    expect(opened.value.terminalId).toBe('native-1')
    expect(tauri.invoke).toHaveBeenCalledWith('desktop_terminal_open', expect.objectContaining({
      cwd: '/workspace/project',
      rows: 24,
      cols: 80,
      onEvent: expect.any(FakeChannel),
    }))

    const iterator = workspace.terminal.output(
      'desktop-workspace' as SessionId,
      opened.value.terminalId,
    )[Symbol.asyncIterator]()
    const next = iterator.next()
    tauri.emit({ event: 'output', data: '\u001b[32magent$\u001b[0m ' })
    await expect(next).resolves.toEqual({ done: false, value: { data: '\u001b[32magent$\u001b[0m ' } })
    tauri.emit({ event: 'exited' })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('forwards input, resize, interrupt, close, and working-directory commands to Tauri', async () => {
    const tauri = installTauri()
    const workspace = createDesktopTerminalWorkspace()
    if (workspace === undefined) throw new Error('desktop workspace was not detected')

    const opened = await workspace.terminal.open('desktop-workspace' as SessionId, {
      type: DESKTOP_TERMINAL_BACKEND,
    })
    if (!opened.ok) throw new Error(opened.error.message)

    await workspace.terminal.write('desktop-workspace' as SessionId, 'native-1', 'claude\r')
    await workspace.terminal.resize('desktop-workspace' as SessionId, 'native-1', 40, 120)
    await workspace.terminal.signal('desktop-workspace' as SessionId, 'native-1', 'SIGINT')
    await workspace.terminal.close('desktop-workspace' as SessionId, 'native-1')

    expect(tauri.invoke).toHaveBeenCalledWith('desktop_terminal_write', { terminalId: 'native-1', data: 'claude\r' })
    expect(tauri.invoke).toHaveBeenCalledWith('desktop_terminal_resize', { terminalId: 'native-1', rows: 40, cols: 120 })
    expect(tauri.invoke).toHaveBeenCalledWith('desktop_terminal_write', { terminalId: 'native-1', data: '\u0003' })
    expect(tauri.invoke).toHaveBeenCalledWith('desktop_terminal_close', { terminalId: 'native-1' })
    await expect(workspace.defaultCwd()).resolves.toBe('/workspace')
    await expect(workspace.pickCwd()).resolves.toBe('/workspace/project')
  })
})
