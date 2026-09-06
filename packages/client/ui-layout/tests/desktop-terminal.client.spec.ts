// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  createDesktopTerminalWorkspace,
  DESKTOP_TERMINAL_BACKEND,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/desktop-terminal.ts'

interface NativeTerminalEvent {
  readonly event: 'output' | 'exited' | 'eof'
  readonly data?: string
}

interface TauriFixtureOptions {
  readonly pickCwd?: string | null
  readonly beforeOpenReturn?: () => void
  readonly rejectClose?: boolean
}

class FakeChannel<T> {
  onmessage: (message: T) => void

  constructor(onmessage?: (message: T) => void) {
    this.onmessage = onmessage ?? (() => undefined)
  }
}

function installTauri(options: TauriFixtureOptions = {}) {
  let channel: FakeChannel<NativeTerminalEvent> | undefined
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'desktop_terminal_open') {
      channel = args?.onEvent as FakeChannel<NativeTerminalEvent>
      options.beforeOpenReturn?.()
      return {
        terminalId: 'native-1',
        cwd: '/workspace/project',
        shell: '/bin/sh',
      }
    }
    if (command === 'desktop_terminal_default_cwd') return '/workspace'
    if (command === 'desktop_terminal_pick_cwd') {
      return options.pickCwd === undefined ? '/workspace/project' : options.pickCwd
    }
    if (command === 'desktop_terminal_close') {
      if (options.rejectClose === true) throw new Error('native close failed')
      return true
    }
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

  it('opens a native terminal without a live Harness Session and drains PTY output after process exit', async () => {
    const tauri = installTauri()
    const workspace = createDesktopTerminalWorkspace()
    if (workspace === undefined) throw new Error('desktop workspace was not detected')

    const opened = await workspace.terminal.open('desktop-workspace' as SessionId, {
      type: DESKTOP_TERMINAL_BACKEND,
      cwd: '/workspace/project',
    })
    if (!opened.ok) throw new Error(opened.error.message)

    expect(opened.value.terminalId).toBe('native-1')
    const openCall = tauri.invoke.mock.calls.find(([command]) => command === 'desktop_terminal_open')
    expect(openCall).toBeDefined()
    const openArgs = openCall?.[1]
    expect(openArgs).toMatchObject({
      cwd: '/workspace/project',
      rows: 24,
      cols: 80,
    })
    expect(openArgs?.onEvent).toBeInstanceOf(FakeChannel)

    const iterator = workspace.terminal.output(
      'desktop-workspace' as SessionId,
      opened.value.terminalId,
    )[Symbol.asyncIterator]()
    const first = iterator.next()
    tauri.emit({ event: 'output', data: '\u001b[32magent$\u001b[0m ' })
    await expect(first).resolves.toEqual({ done: false, value: { data: '\u001b[32magent$\u001b[0m ' } })

    // Process exit and PTY EOF are separate events: buffered bytes may still
    // arrive after wait() reports exit, and must not be truncated.
    tauri.emit({ event: 'exited' })
    const tail = iterator.next()
    tauri.emit({ event: 'output', data: 'final result\r\n' })
    await expect(tail).resolves.toEqual({ done: false, value: { data: 'final result\r\n' } })
    tauri.emit({ event: 'eof' })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('stops channel delivery on output abort while preserving native close', async () => {
    const tauri = installTauri()
    const workspace = createDesktopTerminalWorkspace()
    if (workspace === undefined) throw new Error('desktop workspace was not detected')

    const opened = await workspace.terminal.open('desktop-workspace' as SessionId, {
      type: DESKTOP_TERMINAL_BACKEND,
    })
    if (!opened.ok) throw new Error(opened.error.message)

    const abort = new AbortController()
    const iterator = workspace.terminal.output(
      'desktop-workspace' as SessionId,
      opened.value.terminalId,
      abort.signal,
    )[Symbol.asyncIterator]()
    const pending = iterator.next()
    abort.abort()

    await expect(pending).resolves.toEqual({ done: true, value: undefined })
    expect(() => { tauri.emit({ event: 'output', data: 'late output' }) }).not.toThrow()
    await workspace.terminal.close('desktop-workspace' as SessionId, opened.value.terminalId)
    expect(tauri.invoke).toHaveBeenCalledWith('desktop_terminal_close', { terminalId: 'native-1' })
  })

  it('rejects unsupported and already-aborted terminal opens before invoking Tauri', async () => {
    const tauri = installTauri()
    const workspace = createDesktopTerminalWorkspace()
    if (workspace === undefined) throw new Error('desktop workspace was not detected')

    await expect(workspace.terminal.open('desktop-workspace' as SessionId, {
      type: 'unsupported-backend',
    })).rejects.toThrow('unsupported desktop terminal backend: unsupported-backend')

    const abort = new AbortController()
    abort.abort()
    await expect(workspace.terminal.open('desktop-workspace' as SessionId, {
      type: DESKTOP_TERMINAL_BACKEND,
    }, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })

    expect(tauri.invoke).not.toHaveBeenCalledWith('desktop_terminal_open', expect.anything())
  })

  it('cleans up a terminal when open is aborted after the native process starts', async () => {
    const abort = new AbortController()
    const tauri = installTauri({
      beforeOpenReturn: () => { abort.abort() },
      rejectClose: true,
    })
    const workspace = createDesktopTerminalWorkspace()
    if (workspace === undefined) throw new Error('desktop workspace was not detected')

    await expect(workspace.terminal.open('desktop-workspace' as SessionId, {
      type: DESKTOP_TERMINAL_BACKEND,
    }, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })

    expect(tauri.invoke).toHaveBeenCalledWith('desktop_terminal_close', { terminalId: 'native-1' })
    const listed = await workspace.terminal.list('desktop-workspace' as SessionId)
    expect(listed).toEqual({ ok: true, value: { items: [] } })
  })

  it('reports lifecycle state and covers native routing edge cases', async () => {
    const tauri = installTauri({ pickCwd: null })
    const workspace = createDesktopTerminalWorkspace()
    if (workspace === undefined) throw new Error('desktop workspace was not detected')

    const opened = await workspace.terminal.open('desktop-workspace' as SessionId, {
      type: DESKTOP_TERMINAL_BACKEND,
    })
    if (!opened.ok) throw new Error(opened.error.message)

    await expect(workspace.terminal.list('desktop-workspace' as SessionId)).resolves.toEqual({
      ok: true,
      value: {
        items: [{
          terminalId: 'native-1',
          type: DESKTOP_TERMINAL_BACKEND,
          status: { kind: 'running' },
        }],
      },
    })

    const iterator = workspace.terminal.output(
      'desktop-workspace' as SessionId,
      opened.value.terminalId,
    )[Symbol.asyncIterator]()
    const first = iterator.next()
    tauri.emit({ event: 'output' })
    tauri.emit({ event: 'output', data: '' })
    tauri.emit({ event: 'output', data: 'kept' })
    await expect(first).resolves.toEqual({ done: false, value: { data: 'kept' } })

    tauri.emit({ event: 'exited' })
    await expect(workspace.terminal.list('desktop-workspace' as SessionId)).resolves.toEqual({
      ok: true,
      value: {
        items: [{
          terminalId: 'native-1',
          type: DESKTOP_TERMINAL_BACKEND,
          status: { kind: 'exited', exitCode: null, signal: null },
        }],
      },
    })

    await workspace.terminal.signal('desktop-workspace' as SessionId, 'native-1', 'SIGTERM')
    expect(tauri.invoke).toHaveBeenCalledWith('desktop_terminal_stop', { terminalId: 'native-1' })
    await expect(workspace.pickCwd()).resolves.toBeUndefined()

    tauri.emit({ event: 'eof' })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    await expect(workspace.terminal.close('desktop-workspace' as SessionId, 'native-1')).resolves.toEqual({
      ok: true,
      value: { closed: true },
    })
    await expect(workspace.terminal.close('desktop-workspace' as SessionId, 'native-1')).resolves.toEqual({
      ok: true,
      value: { closed: false },
    })

    expect(() => workspace.terminal.output('desktop-workspace' as SessionId, 'missing')).toThrow(
      'native terminal is unavailable: missing',
    )
    await expect(workspace.terminal.write('desktop-workspace' as SessionId, 'missing', 'x')).rejects.toThrow(
      'native terminal is unavailable: missing',
    )
    await expect(workspace.terminal.resize('desktop-workspace' as SessionId, 'missing', 24, 80)).rejects.toThrow(
      'native terminal is unavailable: missing',
    )
    await expect(workspace.terminal.signal('desktop-workspace' as SessionId, 'missing', 'SIGTERM')).rejects.toThrow(
      'native terminal is unavailable: missing',
    )
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
