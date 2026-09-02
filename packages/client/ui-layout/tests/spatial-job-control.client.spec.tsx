// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore, type ComponentType } from 'react'
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

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  window.innerWidth = 1600
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('spatial one-shot agent control', () => {
  it('stops a running one-shot job through its owner-fenced capability without opening a Session', async () => {
    const store = createLayoutStore().create()
    const root = 'agent-1' as SessionId
    const state: SessionListState = {
      ids: [root],
      byId: {
        [root]: {
          id: root,
          displayTitle: 'Lead Agent',
          cwd: '/workspace',
          running: true,
          blank: false,
          updatedAt: 1,
        },
      },
      current: root,
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {
        [root]: [{
          id: 'subagent-1' as never,
          kind: 'subagent',
          label: 'Audit branch',
          status: 'running',
          startedAt: 1,
        }],
      },
      currentAddress: undefined,
    }
    const stopAgentJob = vi.fn(() => Promise.resolve(true))
    const openAgent = vi.fn()
    const stageAgent = vi.fn()
    const renderSlot = vi.fn((key: string) => (
      key === 'conversation' ? <div>conversation</div> : null
    )) as unknown as AppFrameProps['renderSlot']
    const SessionProvider: AppFrameProps['SessionProvider'] = ({ children }) => <>{children}</>
    const SessionScope: NonNullable<AppFrameProps['SessionScope']> = ({ scopeKey, children }) => (
      <div data-session-scope={scopeKey}>{children}</div>
    )
    const SpatialAppFrame = AppFrame as ComponentType<AppFrameProps & {
      stopAgentJob?: (ownerId: SessionId, jobId: string) => Promise<boolean>
    }>

    const { container } = render(
      <SpatialAppFrame
        useStore={hookOf(store)}
        actions={store.actions}
        renderSlot={renderSlot}
        useSessions={((selector: (value: SessionListState) => unknown) => selector(state)) as never}
        useSessionPendingInteraction={((selector: (value: Map<never, never>) => unknown) => selector(new Map())) as never}
        useWorkspaces={(() => undefined) as never}
        SessionProvider={SessionProvider}
        SessionScope={SessionScope}
        openAgent={openAgent as AppFrameProps['openAgent']}
        stageAgent={stageAgent as AppFrameProps['stageAgent']}
        stopAgentJob={stopAgentJob}
        t={key => key}
      />,
    )

    const jobTile = container.querySelector('[data-agent-job-id="subagent-1"]') as HTMLElement
    const stop = within(jobTile).getByRole('button', { name: 'Stop Audit branch' })
    fireEvent.click(stop)

    expect(openAgent).not.toHaveBeenCalled()
    expect(stopAgentJob).toHaveBeenCalledWith(root, 'subagent-1')
    await waitFor(() => {
      expect(within(jobTile).getByRole('button', { name: 'Stopping Audit branch' })).toBeDisabled()
    })
  })
})
