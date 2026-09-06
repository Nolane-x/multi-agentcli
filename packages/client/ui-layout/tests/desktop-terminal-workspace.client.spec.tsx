// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore, type ReactNode } from 'react'
import type { TerminalSessionClient } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AppFrame, type AppFrameProps } from '@deepseek-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import { DESKTOP_TERMINAL_BACKEND } from '@deepseek-ai/dsh-client-ui-layout/src/client/desktop-terminal.ts'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (state: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

const emptySessions: SessionListState = {
  ids: [],
  byId: {},
  current: undefined,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
}

function translate(key: string, params?: Record<string, unknown>): string {
  const messages: Record<string, string> = {
    'brand.localBuild': 'DSH Local Build',
    'spatial.agent.createTerminal': 'Create terminal',
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
    'spatial.agent.focusTerminal': 'Maximize terminal',
    'spatial.agent.restoreTerminal': 'Restore terminal',
    'spatial.agent.pickTerminalFolder': 'Choose terminal folder',
    'spatial.agent.terminalFolder': 'Terminal folder: {path}',
  }
  return (messages[key] ?? key).replace(/\{(\w+)\}/gu, (_match, name: string) => {
    const value = params?.[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

function fakeTerminal(): TerminalSessionClient {
  return {
    backends: vi.fn(async () => ({ ok: true as const, value: { items: [DESKTOP_TERMINAL_BACKEND] } })),
    list: vi.fn(async () => ({ ok: true as const, value: { items: [] } })),
    open: vi.fn(async (_sessionId: SessionId, request) => ({
      ok: true as const,
      value: {
        terminalId: 'native-1',
        type: request.type,
        status: { kind: 'running' as const },
        motd: '',
      },
    })),
    output: vi.fn(async function* () { return }),
    write: vi.fn(async () => ({ ok: true as const, value: undefined })),
    resize: vi.fn(async () => ({ ok: true as const, value: undefined })),
    signal: vi.fn(async () => ({ ok: true as const, value: { delivered: true as const, targetPgid: 0 } })),
    close: vi.fn(async () => ({ ok: true as const, value: { closed: true } })),
  }
}

type DesktopAppFrameProps = AppFrameProps & {
  terminalMode?: 'desktop' | 'session'
  terminalDefaultCwd?: () => Promise<string>
  pickTerminalCwd?: () => Promise<string | undefined>
}

const DesktopAppFrame = AppFrame as unknown as (props: DesktopAppFrameProps) => ReactNode

function mountDesktopFrame() {
  const store = createLayoutStore().create()
  const terminal = fakeTerminal()
  const pickTerminalCwd = vi.fn(async () => '/workspace/picked')
  const terminalDefaultCwd = vi.fn(async () => '/workspace/default')
  const renderSlot = vi.fn((key: string) => {
    if (key === 'sidebar') return <div data-testid="rail">rail</div>
    if (key === 'conversation') return <div data-testid="conversation">conversation</div>
    if (key === 'details') return <div data-testid="details">details</div>
    return null
  }) as unknown as AppFrameProps['renderSlot']
  const useSessions = ((selector: (value: SessionListState) => unknown) => selector(emptySessions)) as never
  const SessionProvider: AppFrameProps['SessionProvider'] = ({ children }) => <>{children}</>

  const view = render(
    <DesktopAppFrame
      useStore={hookOf(store)}
      actions={store.actions}
      renderSlot={renderSlot}
      useSessions={useSessions}
      useSessionPendingInteraction={((selector: (value: Map<never, never>) => unknown) => selector(new Map<never, never>())) as never}
      useWorkspaces={(() => undefined) as never}
      SessionProvider={SessionProvider}
      terminal={terminal}
      terminalMode="desktop"
      terminalDefaultCwd={terminalDefaultCwd}
      pickTerminalCwd={pickTerminalCwd}
      t={translate}
    />,
  )
  return { ...view, terminal, pickTerminalCwd, terminalDefaultCwd }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  window.innerWidth = 1600
})

afterEach(() => {
  cleanup()
  document.title = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('desktop terminal-first workspace', () => {
  it('creates the first terminal with no Harness Session and keeps 2x2 sizing', async () => {
    const { container, terminal, terminalDefaultCwd } = mountDesktopFrame()
    const create = within(container).getByRole('button', { name: 'Create terminal' })
    expect(create).not.toBeDisabled()
    await waitFor(() => { expect(terminalDefaultCwd).toHaveBeenCalledTimes(1) })

    fireEvent.click(create)

    const tile = await waitFor(() => {
      const value = container.querySelector('[data-terminal-card-id]') as HTMLElement | null
      expect(value).not.toBeNull()
      return value as HTMLElement
    })
    expect(tile.style.flexBasis).toContain('50%')
    expect(tile.style.height).toContain('50%')
    await waitFor(() => {
      expect(terminal.open).toHaveBeenCalledWith(
        expect.any(String),
        { type: DESKTOP_TERMINAL_BACKEND, cwd: '/workspace/default' },
        expect.any(AbortSignal),
      )
    })
  })

  it('uses a picked working directory for newly-created terminals', async () => {
    const { container, pickTerminalCwd, terminal } = mountDesktopFrame()
    const pick = within(container).getByRole('button', { name: 'Choose terminal folder' })
    fireEvent.click(pick)
    await waitFor(() => { expect(pickTerminalCwd).toHaveBeenCalledTimes(1) })
    fireEvent.click(within(container).getByRole('button', { name: 'Create terminal' }))

    await waitFor(() => {
      expect(terminal.open).toHaveBeenCalledWith(
        expect.any(String),
        { type: DESKTOP_TERMINAL_BACKEND, cwd: '/workspace/picked' },
        expect.any(AbortSignal),
      )
    })
  })

  it('maximizes one terminal without hiding the floating rail and restores it', async () => {
    const { container } = mountDesktopFrame()
    fireEvent.click(within(container).getByRole('button', { name: 'Create terminal' }))

    const maximize = await within(container).findByRole('button', { name: 'Maximize terminal' })
    fireEvent.click(maximize)

    const focused = container.querySelector('[data-terminal-focused="true"]') as HTMLElement | null
    expect(focused).not.toBeNull()
    expect(focused?.style.flexBasis).toBe('calc(100% - 0px)')
    expect(container.querySelector('[data-testid="rail"]')).not.toBeNull()

    fireEvent.click(within(container).getByRole('button', { name: 'Restore terminal' }))
    const restored = container.querySelector('[data-terminal-card-id]') as HTMLElement
    expect(restored.style.flexBasis).toContain('50%')
  })
})
