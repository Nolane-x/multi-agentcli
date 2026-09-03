// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { TerminalSessionClient } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TerminalOutputFrame } from '@deepseek-ai/dsh-api-session-controller/terminal-types'
import { TerminalPane } from '@deepseek-ai/dsh-client-ui-layout/src/client/TerminalPane.tsx'

function fakeTerminal(): TerminalSessionClient & { writes: string[] } {
  const writes: string[] = []
  return {
    writes,
    backends: vi.fn(async () => ({ ok: true as const, value: { items: ['shell'] } })),
    list: vi.fn(async () => ({ ok: true as const, value: { items: [] } })),
    open: vi.fn(async () => ({
      ok: true as const,
      value: {
        terminalId: 'pty-test',
        type: 'shell',
        status: { kind: 'running' as const },
        motd: 'ready\r\n',
      },
    })),
    output: vi.fn(async function* (): AsyncIterable<TerminalOutputFrame> {
      yield { data: '\u001b[32magent$\u001b[0m ' }
    }),
    write: vi.fn(async (_sessionId, _terminalId, data) => {
      writes.push(data)
      return { ok: true as const, value: undefined }
    }),
    resize: vi.fn(async () => ({ ok: true as const, value: undefined })),
    signal: vi.fn(async () => ({ ok: true as const, value: { delivered: true as const, targetPgid: 1 } })),
    close: vi.fn(async () => ({ ok: true as const, value: { closed: true } })),
  }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('TerminalPane', () => {
  it('opens an owner-scoped PTY, paints VT output, and forwards keyboard input', async () => {
    const terminal = fakeTerminal()
    const { getByLabelText, getByRole } = render(
      <TerminalPane sessionId={'s-terminal' as never} terminal={terminal} />,
    )

    await waitFor(() => expect(getByRole('region', { name: 'Terminal output' }).textContent).toContain('agent$'))
    expect(terminal.open).toHaveBeenCalledWith('s-terminal', { type: 'shell' }, expect.any(AbortSignal))

    const input = getByLabelText('Terminal input')
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'c', ctrlKey: true })
    expect(terminal.writes).toEqual(['\r', '\u0003'])
  })

  it('closes the exact PTY and reports the tile close', async () => {
    const terminal = fakeTerminal()
    const onClosed = vi.fn()
    const { getByRole, queryByRole } = render(
      <TerminalPane sessionId={'s-terminal' as never} terminal={terminal} onClosed={onClosed} />,
    )

    await waitFor(() => expect(getByRole('button', { name: 'Close terminal' })).toBeTruthy())
    fireEvent.click(getByRole('button', { name: 'Close terminal' }))

    await waitFor(() => expect(terminal.close).toHaveBeenCalledWith('s-terminal', 'pty-test'))
    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(queryByRole('button', { name: 'Close terminal' })).toBeNull()
  })
})
