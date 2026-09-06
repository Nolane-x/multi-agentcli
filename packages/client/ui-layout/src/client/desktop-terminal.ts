/** Lightweight adapter from Tauri's native PTY commands to the existing browser terminal client contract. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TerminalSessionClient } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  TerminalCloseValue,
  TerminalOpenValue,
  TerminalOutputFrame,
  TerminalRemoteItem,
  TerminalSignalValue,
} from '@deepseek-ai/dsh-api-session-controller/terminal-types'

/** Native PTY backend name reserved for the desktop shell. */
export const DESKTOP_TERMINAL_BACKEND = 'desktop-native'

interface NativeTerminalEvent {
  readonly event: 'output' | 'exited' | 'eof'
  readonly data?: string
}

interface NativeTerminalOpenValue {
  readonly terminalId: string
  readonly cwd: string
  readonly shell: string
}

interface TauriChannel<T> {
  onmessage: (message: T) => void
}

interface TauriChannelConstructor {
  new<T>(onmessage?: (message: T) => void): TauriChannel<T>
}

interface TauriCore {
  readonly Channel: TauriChannelConstructor
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

declare global {
  interface Window {
    /** Present only inside the Tauri desktop webview when `withGlobalTauri` is enabled. */
    __TAURI__?: {
      readonly core?: TauriCore
    }
  }
}

interface NativeTerminalEntry {
  readonly stream: ReadableStream<TerminalOutputFrame>
  readonly controller: ReadableStreamDefaultController<TerminalOutputFrame>
  readonly cwd: string
  readonly shell: string
  exited: boolean
  closed: boolean
}

/** Desktop-only helpers that do not belong to the owner-addressed Harness PTY contract. */
export interface DesktopTerminalWorkspace {
  readonly terminal: TerminalSessionClient
  defaultCwd(): Promise<string>
  pickCwd(): Promise<string | undefined>
}

function closeStream(entry: NativeTerminalEntry): void {
  if (entry.closed) return
  entry.closed = true
  entry.controller.close()
}

function requireEntry(entries: Map<string, NativeTerminalEntry>, terminalId: string): NativeTerminalEntry {
  const entry = entries.get(terminalId)
  if (entry === undefined) throw new Error(`native terminal is unavailable: ${terminalId}`)
  return entry
}

async function* readOutput(
  entry: NativeTerminalEntry,
  signal?: AbortSignal,
): AsyncIterable<TerminalOutputFrame> {
  const reader = entry.stream.getReader()
  const abort = (): void => {
    if (entry.closed) return
    entry.closed = true
    void reader.cancel()
  }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted === true) abort()
  try {
    while (signal?.aborted !== true) {
      const next = await reader.read()
      if (next.done) return
      yield next.value
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

/**
 * Resolve the native desktop terminal bridge from the Tauri global API.
 * Browser Harness builds return `undefined` and continue using the normal
 * Session-owned terminal Remote unchanged.
 * @returns the native terminal workspace when running inside the desktop app.
 */
export function createDesktopTerminalWorkspace(): DesktopTerminalWorkspace | undefined {
  if (typeof window === 'undefined') return undefined
  const core = window.__TAURI__?.core
  if (core === undefined) return undefined

  const entries = new Map<string, NativeTerminalEntry>()

  const terminal = {
    backends: async () => ({ ok: true as const, value: { items: [DESKTOP_TERMINAL_BACKEND] } }),
    list: async (_sessionId: SessionId) => ({
      ok: true as const,
      value: {
        items: [...entries].map(([terminalId, entry]): TerminalRemoteItem => ({
          terminalId,
          type: DESKTOP_TERMINAL_BACKEND,
          status: entry.exited
            ? { kind: 'exited', exitCode: null, signal: null }
            : { kind: 'running' },
        })),
      },
    }),
    open: async (_sessionId: SessionId, request, signal): Promise<{ ok: true; value: TerminalOpenValue }> => {
      if (request.type !== DESKTOP_TERMINAL_BACKEND) {
        throw new Error(`unsupported desktop terminal backend: ${request.type}`)
      }
      signal?.throwIfAborted()

      let controller!: ReadableStreamDefaultController<TerminalOutputFrame>
      const stream = new ReadableStream<TerminalOutputFrame>({
        start(value) { controller = value },
      })
      const pending: NativeTerminalEntry = {
        stream,
        controller,
        cwd: '',
        shell: '',
        exited: false,
        closed: false,
      }
      const onEvent = new core.Channel<NativeTerminalEvent>((event) => {
        if (pending.closed) return
        if (event.event === 'output') {
          if (event.data !== undefined && event.data !== '') pending.controller.enqueue({ data: event.data })
          return
        }
        if (event.event === 'exited') {
          pending.exited = true
          return
        }
        closeStream(pending)
      })

      const opened = await core.invoke<NativeTerminalOpenValue>('desktop_terminal_open', {
        cwd: request.cwd,
        rows: 24,
        cols: 80,
        onEvent,
      })
      const entry: NativeTerminalEntry = Object.assign(pending, {
        cwd: opened.cwd,
        shell: opened.shell,
      })
      entries.set(opened.terminalId, entry)

      if (signal?.aborted === true) {
        entries.delete(opened.terminalId)
        closeStream(entry)
        await core.invoke<boolean>('desktop_terminal_close', { terminalId: opened.terminalId }).catch(() => false)
        signal.throwIfAborted()
      }

      return {
        ok: true,
        value: {
          terminalId: opened.terminalId,
          type: DESKTOP_TERMINAL_BACKEND,
          status: { kind: 'running' },
          motd: '',
        },
      }
    },
    output: (_sessionId: SessionId, terminalId: string, signal?: AbortSignal) => (
      readOutput(requireEntry(entries, terminalId), signal)
    ),
    write: async (_sessionId: SessionId, terminalId: string, data: string) => {
      requireEntry(entries, terminalId)
      await core.invoke<void>('desktop_terminal_write', { terminalId, data })
      return { ok: true as const, value: undefined }
    },
    resize: async (_sessionId: SessionId, terminalId: string, rows: number, cols: number) => {
      requireEntry(entries, terminalId)
      await core.invoke<void>('desktop_terminal_resize', { terminalId, rows, cols })
      return { ok: true as const, value: undefined }
    },
    signal: async (_sessionId: SessionId, terminalId: string, signal: string) => {
      requireEntry(entries, terminalId)
      if (signal === 'SIGINT') {
        await core.invoke<void>('desktop_terminal_write', { terminalId, data: '\u0003' })
      } else {
        await core.invoke<void>('desktop_terminal_stop', { terminalId })
      }
      return {
        ok: true as const,
        value: { delivered: true as const, targetPgid: 0 } satisfies TerminalSignalValue,
      }
    },
    close: async (_sessionId: SessionId, terminalId: string) => {
      const entry = entries.get(terminalId)
      if (entry === undefined) {
        return { ok: true as const, value: { closed: false } satisfies TerminalCloseValue }
      }
      entries.delete(terminalId)
      closeStream(entry)
      const closed = await core.invoke<boolean>('desktop_terminal_close', { terminalId })
      return { ok: true as const, value: { closed } satisfies TerminalCloseValue }
    },
  } satisfies TerminalSessionClient

  return {
    terminal,
    defaultCwd: () => core.invoke<string>('desktop_terminal_default_cwd'),
    pickCwd: () => core.invoke<string | null>('desktop_terminal_pick_cwd').then(value => value ?? undefined),
  }
}