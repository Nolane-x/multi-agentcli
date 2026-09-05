// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import {
  SessionScopeProvider,
  type ScopedStandardSourceBinding,
  type SlotRendererHost,
  type SlotScopeAdapter,
  type StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSlotRenderer } from '../src/client/scoped-slots.tsx'

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: T) => {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function binding(ctx: Context, id: string): ScopedStandardSourceBinding {
  return {
    key: id,
    ctx,
    hooks: {
      session: {
        getSnapshot: () => ({ sid: id }),
        subscribe: () => () => {},
      },
    },
    keyedHooks: {},
    props: { sessionId: id },
  }
}

describe('public explicit session scope', () => {
  it('renders two session-maybe occurrences against different bindings at the same time', () => {
    const ctx = new Context()
    const s1 = binding(ctx, 's1')
    const s2 = binding(ctx, 's2')
    const bindings = new Map([['s1', s1], ['s2', s2]])
    const current = observable<StandardSourceBinding>(s1)
    const root = observable<StandardSourceBinding>({
      key: undefined,
      hooks: {},
      keyedHooks: {},
      props: {},
    })
    const adapter: SlotScopeAdapter = {
      current,
      resolve: key => bindings.get(key),
    }

    const sessionEntry: StoredEntry = {
      component: (props: {
        sessionId?: string
        useSession?: <S>(selector: (snapshot: { sid: string }) => S) => S
      }) => (
        <div data-testid={`session-${props.sessionId ?? 'missing'}`}>
          {props.sessionId}:{props.useSession?.(snapshot => snapshot.sid)}
        </div>
      ),
      options: {},
    }
    const rootEntry: StoredEntry = {
      component: (props: {
        renderSlot: (key: string, owner: object) => ReactNode
      }) => (
        <>
          <SessionScopeProvider scope="session-maybe" scopeKey="s1">
            {props.renderSlot('k.session', {})}
          </SessionScopeProvider>
          <SessionScopeProvider scope="session-maybe" scopeKey="s2">
            {props.renderSlot('k.session', {})}
          </SessionScopeProvider>
        </>
      ),
      options: {},
      children: {
        'k.session': { kind: 'single', scope: 'session-maybe' },
      },
    }

    const host: SlotRendererHost = {
      subscribe: () => () => {},
      getVersion: () => 0,
      entriesOf: key => key === 'root' ? [rootEntry] : key === 'k.session' ? [sessionEntry] : [],
      entriesOfSlot: key => key === 'root' ? [rootEntry] : key === 'k.session' ? [sessionEntry] : [],
      reportEntryError: () => {},
      specOf: key => key === 'k.session'
        ? { kind: 'single', scope: 'session-maybe' }
        : undefined,
      isLive: () => true,
      storeOf: () => undefined,
      root,
      scopeRevision: observable(0),
      scope: () => adapter,
    }

    const view = render(<>{createSlotRenderer().renderRoot(host, {})}</>)
    expect(view.getByTestId('session-s1').textContent).toBe('s1:s1')
    expect(view.getByTestId('session-s2').textContent).toBe('s2:s2')
  })
})
