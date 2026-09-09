// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { TerminalSessionClient } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TerminalPane } from '@deepseek-ai/dsh-client-ui-layout/src/client/TerminalPane.tsx'
import { DESKTOP_TERMINAL_BACKEND } from '@deepseek-ai/dsh-client-ui-layout/src/client/desktop-terminal.ts'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function translate(key: string): string {
  const messages: Record<string, string> = {
    'spatial.agent.pane': 'Terminal pane',
    'spatial.agent.startingTerminal': 'Starting terminal',
    'spatial.agent.closedTerminal': 'Terminal closed',
    'spatial.agent.agentTerminal': 'Agent terminal',
    'spatial.agent.stopTerminal': 'Stop terminal',
    'spatial.agent.closeTerminal': 'Close terminal',
    'spatial.agent.stop': 'Stop',
    'spatial.agent.close': 'Close',
    'spatial.agent.output': 'Terminal output',
    'spatial.agent.input': 'Terminal input',
    'spatial.agent.unavailable': 'Terminal unavailable',
  }
  return messages[key] ?? key
}

function terminalClient(
  outputDone: Promise<void>,
  close = vi.fn(async () => ({ ok: true as const, value: { closed: true } })),
) {
  const open = vi.fn(async () => ({
    ok: true as const,
    value: {
      terminalId: 'native-1',
      type: DESKTOP_TERMINAL_BACKEND,
      status: { kind: 'running' as const },
      motd: '',
    },
  }))
  const terminal: TerminalSessionClient = {
    backends: vi.fn(async () => ({ ok: true as const, value: { items: [DESKTOP_TERMINAL_BACKEND] } })),
    list: vi.fn(async () => ({ ok: true as const, value: { items: [] } })),
    open,
    output: vi.fn(async function* () {
      await outputDone
    }),
    write: vi.fn(async () => ({ ok: true as const, value: undefined })),
    resize: vi.fn(async () => ({ ok: true as const, value: undefined })),
    signal: vi.fn(async () => ({
      ok: true as const,
      value: { delivered: true as const, targetPgid: 0 },
    })),
    close,
  }
  return { terminal, open }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TerminalPane natural exit lifecycle', () => {
  it('closes the backend and notifies its parent when PTY output ends naturally', async () => {
    const exited = deferred()
    const sessionId = 'desktop-terminal-workspace' as SessionId
    const close = vi.fn(async () => ({ ok: true as const, value: { closed: true } }))
    const { terminal } = terminalClient(exited.promise, close)
    const onClosed = vi.fn()

    const view = render(
      <TerminalPane
        sessionId={sessionId}
        terminal={terminal}
        backend={DESKTOP_TERMINAL_BACKEND}
        t={translate}
        onClosed={onClosed}
      />,
    )

    await waitFor(() => {
      expect(view.container.querySelector('[data-terminal-phase="running"]')).not.toBeNull()
    })

    exited.resolve()

    await waitFor(() => {
      expect(close).toHaveBeenCalledWith(sessionId, 'native-1')
      expect(onClosed).toHaveBeenCalledTimes(1)
    })
  })

  it('does not restart a live PTY when the onClosed callback identity changes', async () => {
    const exited = deferred()
    const sessionId = 'desktop-terminal-workspace' as SessionId
    const { terminal, open } = terminalClient(exited.promise)
    const firstOnClosed = vi.fn()
    const secondOnClosed = vi.fn()

    const view = render(
      <TerminalPane
        sessionId={sessionId}
        terminal={terminal}
        backend={DESKTOP_TERMINAL_BACKEND}
        t={translate}
        onClosed={firstOnClosed}
      />,
    )

    await waitFor(() => {
      expect(open).toHaveBeenCalledTimes(1)
      expect(view.container.querySelector('[data-terminal-phase="running"]')).not.toBeNull()
    })

    view.rerender(
      <TerminalPane
        sessionId={sessionId}
        terminal={terminal}
        backend={DESKTOP_TERMINAL_BACKEND}
        t={translate}
        onClosed={secondOnClosed}
      />,
    )

    await Promise.resolve()
    await Promise.resolve()
    expect(open).toHaveBeenCalledTimes(1)

    exited.resolve()
    await waitFor(() => {
      expect(secondOnClosed).toHaveBeenCalledTimes(1)
      expect(firstOnClosed).not.toHaveBeenCalled()
    })
  })
})
