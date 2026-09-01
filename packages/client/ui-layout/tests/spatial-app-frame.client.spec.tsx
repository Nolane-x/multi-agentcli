// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { AppFrame, type AppFrameProps } from '@deepseek-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

function sessionState(count: number): SessionListState {
  const ids = Array.from({ length: count }, (_, index) => `agent-${index + 1}` as SessionId)
  return {
    ids,
    byId: Object.fromEntries(ids.map((id, index) => [id, {
      id,
      displayTitle: `Agent ${index + 1}`,
      cwd: `/workspace/agent-${index + 1}`,
      running: true,
      blank: false,
      updatedAt: index + 1,
    }])),
    current: ids[0],
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function mountSpatialFrame(count = 5) {
  const store = createLayoutStore().create()
  const state = sessionState(count)
  const openAgent = vi.fn()
  const renderSlot = vi.fn((key: string) => {
    if (key === 'conversation') return <div data-testid="conversation">conversation</div>
    if (key === 'sidebar') return <div data-testid="rail">rail</div>
    if (key === 'details') return <div data-testid="details">details</div>
    return null
  }) as unknown as AppFrameProps['renderSlot']
  const useSessions = ((selector: (value: SessionListState) => unknown) => selector(state)) as never
  const useStore = hookOf(store)
  const SessionProvider: AppFrameProps['SessionProvider'] = ({ children }) => <>{children}</>

  const view = render(
    <AppFrame
      useStore={useStore}
      actions={store.actions}
      renderSlot={renderSlot}
      useSessions={useSessions}
      useSessionPendingInteraction={((selector: (value: Map<never, never>) => unknown) => selector(new Map())) as never}
      useWorkspaces={(() => undefined) as never}
      SessionProvider={SessionProvider}
      openAgent={openAgent as AppFrameProps['openAgent']}
      t={key => key}
    />,
  )
  return { ...view, openAgent, state }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  window.innerWidth = 1600
})

afterEach(() => {
  cleanup()
  document.title = ''
  vi.unstubAllGlobals()
})

describe('AppFrame spatial agent canvas', () => {
  it('renders five live sessions as a centered 3x3-sized mosaic while keeping one real conversation surface', () => {
    const { container, getByTestId } = mountSpatialFrame(5)
    const tiles = container.querySelectorAll('[data-agent-id]')
    expect(tiles).toHaveLength(5)
    expect((tiles[0] as HTMLElement).style.flexBasis).toContain('33.333')
    expect((tiles[0] as HTMLElement).style.height).toContain('33.333')
    expect(getByTestId('conversation')).toBeTruthy()
    expect(container.querySelectorAll('[data-testid="conversation"]')).toHaveLength(1)
    expect(container.textContent).toContain('LEAD')
  })

  it('opens a background agent through the injected Session Controller action', () => {
    const { container, openAgent } = mountSpatialFrame(5)
    const second = container.querySelector('[data-agent-id="agent-2"]') as HTMLElement
    fireEvent.click(second)
    expect(openAgent).toHaveBeenCalledTimes(1)
    expect(openAgent).toHaveBeenCalledWith('agent-2')
  })

  it('focuses the current agent to the full canvas and restores the mosaic with Escape', () => {
    const { container, getByRole } = mountSpatialFrame(5)
    fireEvent.click(getByRole('button', { name: 'Focus this agent' }))
    expect(container.querySelectorAll('[data-agent-id]')).toHaveLength(1)
    const focused = container.querySelector('[data-agent-focused="true"]') as HTMLElement
    expect(focused.style.flexBasis).toBe('calc(100% - 0px)')
    expect(focused.style.height).toBe('calc(100% - 0px)')

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(container.querySelectorAll('[data-agent-id]')).toHaveLength(5)
  })
})
