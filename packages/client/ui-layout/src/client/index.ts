/**
 * Spatial layout plugin, browser half. The registration still owns the same
 * four child slots as upstream Harness; only their presentation changes.
 * Session navigation, explicit scope binding, history staging, and one-shot
 * job control are injected as narrow public capabilities so agent tiles use
 * the real Harness runtime rather than DOM automation or implementation casts.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { SessionScopeProvider } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionIdOf } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { PanelActions } from './service.ts'
import { AppFrame } from './AppFrame.tsx'
import { createLayoutStore } from './stores.ts'
import { LayoutController } from './service.ts'
import { ThemePresenter } from './theme-presenter.ts'

// Contract exports only (export-convergence rule: cross-package consumers
// keep a symbol exported; test-only/package-internal symbols live off /src).
export { LayoutController } from './service.ts'
export type { ILayout } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    layout: import('./service.ts').ILayout
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The floating navigation/control surface. OCCUPIED by ui-sidebar's
     * SidebarRoot; all workspace, settings and plugin seats remain intact.
     */
    'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
    /**
     * The interactive Harness conversation surface. Spatial panes bind each
     * occurrence to an explicit Session scope while ordinary consumers keep
     * the upstream current-session behavior.
     */
    'conversation': { kind: 'single'; scope: 'session-maybe'; owner: ConvOwnerProps }
    /** Floating Session inspector. */
    'details': { kind: 'single'; scope: 'session'; owner: DetailsOwnerProps }
    /** Frame-wide floating additive layer (approvals, toasts and other plugin UI). */
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

/** Sidebar owner share: live floating-surface state from the concession solve. */
export interface SidebarOwnerProps {
  /** True when the sidebar is the compact always-visible rail. */
  collapsed: boolean
  /** Rendered surface width in px. */
  width: number
}

/** Conversation owner share: business state and actions belong to the registrant. */
export interface ConvOwnerProps {}

/** Details owner share: sessionId arrives as a framework-standard prop. */
export interface DetailsOwnerProps {}

/** Required services. Session state and its Host control namespace stay separate capabilities. */
export const inject = ['slots', 'theme', 'locale', 'sessions', 'remote.session']

type SpatialRuntimeContext = ClientContext & {
  sessions: {
    open: (sessionId: SessionIdOf) => void
    stage: (sessionId: SessionIdOf) => void
  }
  remote: {
    session: {
      stopJob: (request: { sessionId: SessionIdOf; jobId: string }) => Promise<
        | { ok: true; value: { result: 'requested' | 'already-finished' } }
        | { ok: false; error: unknown }
      >
    }
  }
}

/**
 * Client plugin body: provide ctx.layout and register the spatial AppFrame.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const layout = new LayoutController()
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const runtime = ctx as SpatialRuntimeContext
    const sessionNavigation = runtime.sessions
    const sessionControl = runtime.remote.session
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      locale: 'common',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store: createLayoutStore,
      inject: (actions: PanelActions) => {
        layout.attachPanels(actions)
        return {
          // Public renderer capability: pin one subtree to an explicit Session
          // without changing the current-session binding used elsewhere.
          SessionScope: SessionScopeProvider,
          // Real navigation through the Session Controller. This is the same
          // authority used by upstream workspace/session UI, not DOM automation.
          openAgent: (sessionId: SessionIdOf) => {
            sessionNavigation.open(sessionId)
          },
          // Public non-selecting Session Controller staging. The domain owns
          // history/follow idempotence and subagent-catalog refresh semantics.
          stageAgent: (sessionId: SessionIdOf) => {
            sessionNavigation.stage(sessionId)
          },
          // One-shot work remains a JobRegistry concern. The UI receives only
          // this boolean-admission wrapper over the owner-fenced Host Remote.
          stopAgentJob: async (sessionId: SessionIdOf, jobId: string) => {
            const result = await sessionControl.stopJob({ sessionId, jobId })
            return result.ok
          },
        }
      },
    }, AppFrame)
    return () => {
      disposeRegistration()
      void disposeService()
    }
  }, 'ui-layout: spatial shell + service')

  // Theme presentation remains upstream Harness behavior.
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout: theme presenter')
}
