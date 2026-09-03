/**
 * Spatial layout plugin, browser half. The registration still owns the same
 * four child slots as upstream Harness; only their presentation changes.
 * Session navigation, explicit scope binding, history staging, and one-shot
 * job control are injected as narrow public capabilities so agent tiles use
 * the real Harness runtime rather than DOM automation or implementation casts.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { TerminalSessionClient } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionIdOf } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { ReactNode } from 'react'
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

/** Renderer-owned React capability used by injected client plugins. */
interface SessionScopeComponent {
  (props: {
    scope: 'session' | 'session-maybe'
    scopeKey?: string
    children: ReactNode
  }): ReactNode
}

/** Services required. Session navigation/runtime and the renderer scope share one domain capability. */
export const inject = ['slots', 'theme', 'locale', 'sessions', 'uiRenderer']

type SpatialSessionsContext = ClientContext & {
  sessions: {
    terminal?: TerminalSessionClient
    open: (sessionId: SessionIdOf) => void
    stage: (sessionId: SessionIdOf) => void
    stopJob: (sessionId: SessionIdOf, jobId: string) => Promise<boolean>
  }
  uiRenderer: {
    sessionScope: SessionScopeComponent
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
    const services = ctx as SpatialSessionsContext
    const sessions = services.sessions
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
          // Renderer-owned scope capability arrives through Cordis injection;
          // ui-layout never imports the renderer's React runtime directly.
          SessionScope: services.uiRenderer.sessionScope,
          // Real navigation through the Session Controller. This is the same
          // authority used by upstream workspace/session UI, not DOM automation.
          openAgent: (sessionId: SessionIdOf) => {
            sessions.open(sessionId)
          },
          // Public non-selecting Session Controller staging. The domain owns
          // history/follow idempotence and subagent-catalog refresh semantics.
          stageAgent: (sessionId: SessionIdOf) => {
            sessions.stage(sessionId)
          },
          // Human control stays behind the Session domain; ui-layout never sees
          // the generated Remote or JobRegistry service directly.
          stopAgentJob: (sessionId: SessionIdOf, jobId: string) => (
            sessions.stopJob(sessionId, jobId)
          ),
          ...sessions.terminal === undefined ? {} : { terminal: sessions.terminal },
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
