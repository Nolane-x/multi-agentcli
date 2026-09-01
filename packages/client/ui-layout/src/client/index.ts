/**
 * Spatial layout plugin, browser half. The registration still owns the same
 * four child slots as upstream Harness; only their presentation changes.
 * Session navigation and history staging are injected as narrow capabilities
 * so agent tiles use the real Harness runtime rather than DOM automation.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ScopeProvider } from '@deepseek-ai/dsh-client-ui-renderer/src/client/bindings.tsx'
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

/** Required services. `sessions` is provided transitively by ui-session. */
export const inject = ['slots', 'theme', 'locale', 'sessions']

interface InternalStageSession {
  /** Session Controller's idempotent history/follow opener. */
  open: () => Promise<void>
}

type SessionNavigationContext = ClientContext & {
  sessions: {
    open: (sessionId: SessionIdOf) => void
    binding: (sessionId: SessionIdOf) => { session: unknown } | undefined
    refreshSubagents: (sessionId: SessionIdOf) => Promise<void>
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
    const sessionNavigation = (ctx as SessionNavigationContext).sessions
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
          // Renderer-native scope override. AppFrame itself stays framework-
          // neutral and tests can omit this seat; production receives the real
          // provider bound to the installed renderer host.
          SessionScope: ScopeProvider,
          // Real navigation through the Session Controller. This is the same
          // authority used by upstream workspace/session UI, not DOM automation.
          openAgent: (sessionId: SessionIdOf) => {
            sessionNavigation.open(sessionId)
          },
          // Multi-pane history staging deliberately does NOT mutate current
          // selection. Session.open() is idempotent and the Session Controller
          // keeps an opened source resident while the Session remains alive.
          stageAgent: (sessionId: SessionIdOf) => {
            const owner = sessionNavigation.binding(sessionId)
            const session = owner?.session as Partial<InternalStageSession> | undefined
            if (session?.open === undefined) return
            void session.open().catch((error: unknown) => {
              console.error(`[ui-layout] failed to stage session '${String(sessionId)}':`, error)
            })
            void sessionNavigation.refreshSubagents(sessionId).catch((error: unknown) => {
              console.error(`[ui-layout] failed to refresh subagents for '${String(sessionId)}':`, error)
            })
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
