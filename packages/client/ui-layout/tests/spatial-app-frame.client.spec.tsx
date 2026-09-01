// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
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

function sessionState(
  count: number,
  jobsBySession: SessionListState['jobsBySession'] = {},
): SessionListState {
  const ids = Array.from({ length: count }, (_, index) => `agent-${index + 1}` as SessionId)
  const root = ids[0]
  return {
    ids,
    byId: Object.fromEntries(ids.map((id, index) => [id, {
      id,
      displayTitle: `Agent ${index + 1}`,
      cwd: `/workspace/agent-${index + 1}`,
      ...(index === 0 || root === undefined ? {} : { parentId: root, origin: 'subagent' as const }),
      running: true,
      blank: false,
      updatedAt: index + 1,
    }])),
    current: root,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession,
    currentAddress: undefined,
  }
}

function mountSpatialFrame(
  count = 5,
  jobsBySession: SessionListState['jobsBySession'] = {},
  stateOverride?: SessionListState,
) {
  const store = createLayoutStore().create()
  const state = stateOverride ?? sessionState(count, jobsBySession)
  const openAgent = vi.fn()
  const stageAgent = vi.fn()
  const renderSlot = vi.fn((key: string) => {
    if (key === 'conversation') return <div data-testid="conversation">conversation</div>
    if (key === 'sidebar') return <div data-testid="rail">rail</div>
    if (key === 'details') return <div data-testid="details">details</div>
    return null
  }) as unknown as AppFrameProps['renderSlot']
  const useSessions = ((selector: (value: SessionListState) => unknown) => selector(state)) as never
  const useStore = hookOf(store)
  const SessionProvider: AppFrameProps['SessionProvider'] = ({ children }) => <>{children}</>
  const SessionScope: NonNullable<AppFrameProps['SessionScope']> = ({ scopeKey, children }) => (
    <div data-session-scope={scopeKey}>{children}</div>
  )

  const view = render(
    <AppFrame
      useStore={useStore}
      actions={store.actions}
      renderSlot={renderSlot}
      useSessions={useSessions}
      useSessionPendingInteraction={((selector: (value: Map<never, never>) => unknown) => selector(new Map())) as never}
      useWorkspaces={(() => undefined) as never}
      SessionProvider={SessionProvider}
      SessionScope={SessionScope}
      openAgent={openAgent as AppFrameProps['openAgent']}
      stageAgent={stageAgent as AppFrameProps['stageAgent']}
      t={key => key}
    />,
  )
  return { ...view, openAgent, stageAgent, state }
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
  it('renders a five-agent family as a centered 3x3-sized mosaic with five real scoped conversation occurrences', () => {
    const { container, stageAgent } = mountSpatialFrame(5)
    const tiles = container.querySelectorAll('[data-agent-id]')
    expect(tiles).toHaveLength(5)
    expect((tiles[0] as HTMLElement).style.flexBasis).toContain('33.333')
    expect((tiles[0] as HTMLElement).style.height).toContain('33.333')
    expect(container.querySelectorAll('[data-testid="conversation"]')).toHaveLength(5)
    expect(container.querySelectorAll('[data-session-scope]')).toHaveLength(5)
    expect([...container.querySelectorAll('[data-session-scope]')].map(node => node.getAttribute('data-session-scope')))
      .toEqual(['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'])
    expect(stageAgent).toHaveBeenCalledTimes(5)
    expect(stageAgent.mock.calls.map(call => call[0])).toEqual([
      'agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5',
    ])
    expect(container.textContent).toContain('LEAD')
  })

  it('derives leader and child identity from the Session graph instead of rendered order', () => {
    const base = sessionState(3)
    const [root, child, grandchild] = base.ids
    if (root === undefined || child === undefined || grandchild === undefined) throw new Error('missing fixture sessions')
    const state = {
      ...base,
      ids: [child, root, grandchild],
      byId: {
        ...base.byId,
        [grandchild]: {
          ...base.byId[grandchild]!,
          parentId: child,
          origin: 'subagent' as const,
        },
      },
    } as SessionListState

    const { container } = mountSpatialFrame(3, {}, state)
    const rootTile = container.querySelector(`[data-agent-id="${root}"]`) as HTMLElement
    const childTile = container.querySelector(`[data-agent-id="${child}"]`) as HTMLElement
    const grandchildTile = container.querySelector(`[data-agent-id="${grandchild}"]`) as HTMLElement

    expect(rootTile.getAttribute('data-agent-root')).toBe('true')
    expect(rootTile.getAttribute('data-agent-depth')).toBe('0')
    expect(within(rootTile).getByText('LEAD')).toBeTruthy()

    expect(childTile.getAttribute('data-agent-root')).toBeNull()
    expect(childTile.getAttribute('data-agent-depth')).toBe('1')
    expect(within(childTile).getByText('CHILD')).toBeTruthy()
    expect(childTile.textContent).toContain('via Agent 1')
    expect(childTile.textContent).not.toContain('LEAD')

    expect(grandchildTile.getAttribute('data-agent-depth')).toBe('2')
    expect(within(grandchildTile).getByText('D2')).toBeTruthy()
    expect(grandchildTile.textContent).toContain('via Agent 2')
  })

  it('renders active one-shot subagent jobs as status-only mosaic tiles without fabricating Session surfaces', () => {
    const jobsBySession = {
      'agent-1': [
        {
          id: 'job-running',
          kind: 'subagent',
          label: 'Review tests',
          status: 'running',
          detail: 'Checking spatial regressions',
          startedAt: 10,
        },
        {
          id: 'job-finished',
          kind: 'subagent',
          label: 'Old review',
          status: 'completed',
          startedAt: 1,
          finishedAt: 9,
        },
        {
          id: 'job-shell',
          kind: 'shell',
          label: 'npm test',
          status: 'running',
          startedAt: 11,
        },
      ],
    } as unknown as SessionListState['jobsBySession']

    const { container, stageAgent } = mountSpatialFrame(4, jobsBySession)
    const sessionTiles = container.querySelectorAll('[data-agent-id]')
    const jobTiles = container.querySelectorAll('[data-agent-job-id]')

    expect(sessionTiles).toHaveLength(4)
    expect(jobTiles).toHaveLength(1)
    expect((sessionTiles[0] as HTMLElement).style.flexBasis).toContain('33.333')
    expect((jobTiles[0] as HTMLElement).style.flexBasis).toContain('33.333')
    expect(jobTiles[0]?.getAttribute('data-agent-job-id')).toBe('job-running')
    expect(jobTiles[0]?.getAttribute('data-agent-owner-id')).toBe('agent-1')
    expect(jobTiles[0]?.textContent).toContain('Review tests')
    expect(jobTiles[0]?.textContent).toContain('Agent 1')
    expect(jobTiles[0]?.textContent).toContain('Checking spatial regressions')
    expect(jobTiles[0]?.textContent).toContain('running')
    expect(container.textContent).not.toContain('Old review')
    expect(container.textContent).not.toContain('npm test')
    expect(container.querySelectorAll('[data-testid="conversation"]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-session-scope]')).toHaveLength(4)
    expect(stageAgent).toHaveBeenCalledTimes(4)
  })

  it('opens a background agent through a dedicated header control without stealing clicks from the interactive body', () => {
    const { container, openAgent } = mountSpatialFrame(5)
    const second = container.querySelector('[data-agent-id="agent-2"]') as HTMLElement
    const body = second.querySelector('[class*="agentBody"]') as HTMLElement
    const open = within(second).getByRole('button', { name: 'Open Agent 2' })

    fireEvent.click(body)
    expect(openAgent).not.toHaveBeenCalled()

    fireEvent.click(open)
    expect(openAgent).toHaveBeenCalledTimes(1)
    expect(openAgent).toHaveBeenCalledWith('agent-2')
  })

  it('focuses a background agent without changing the current Harness session', () => {
    const { container, openAgent } = mountSpatialFrame(5)
    const second = container.querySelector('[data-agent-id="agent-2"]') as HTMLElement
    const focus = within(second).getByRole('button', { name: 'Focus this agent' })

    fireEvent.click(focus)
    expect(openAgent).not.toHaveBeenCalled()
    expect(container.querySelectorAll('[data-agent-id]')).toHaveLength(1)
    expect(container.querySelector('[data-agent-focused="true"]')?.getAttribute('data-agent-id')).toBe('agent-2')

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(container.querySelectorAll('[data-agent-id]')).toHaveLength(5)
    expect(container.querySelector('[data-agent-current="true"]')?.getAttribute('data-agent-id')).toBe('agent-1')
  })

  it('focuses the current agent to the full canvas and restores the mosaic with Escape', () => {
    const { container } = mountSpatialFrame(5)
    const current = container.querySelector('[data-agent-current="true"]') as HTMLElement
    fireEvent.click(within(current).getByRole('button', { name: 'Focus this agent' }))
    expect(container.querySelectorAll('[data-agent-id]')).toHaveLength(1)
    const focused = container.querySelector('[data-agent-focused="true"]') as HTMLElement
    expect(focused.style.flexBasis).toBe('calc(100% - 0px)')
    expect(focused.style.height).toBe('calc(100% - 0px)')

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(container.querySelectorAll('[data-agent-id]')).toHaveLength(5)
  })
})
