/**
 * Spatial multi-agent shell frame. DeepSeek Harness still owns the real
 * conversation, details, overlay, session, approval, skill and plugin
 * surfaces; this component only changes their spatial presentation.
 *
 * The left navigation becomes a floating rail, the details surface becomes a
 * floating inspector, and active Sessions become simultaneously interactive
 * agent tiles. Production receives a renderer-native SessionScope capability
 * that pins each conversation occurrence to its own Harness Session binding.
 * Active one-shot subagent jobs join the same mosaic as lifecycle-only cards;
 * they never fabricate a Session transcript or renderer scope.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore, SessionIdOf,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { TerminalSessionClient } from '@deepseek-ai/dsh-api-session-controller/client'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import { TerminalPane } from './TerminalPane.tsx'
import {
  canvasAgentIds, canvasSubagentJobs, mosaicCellPercent, mosaicDimension, spatialAgentLineage,
} from './spatial.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

interface SessionScopeProps {
  scope: 'session' | 'session-maybe'
  scopeKey?: string
  children: ReactNode
}

type SessionScopeComponent = (props: SessionScopeProps) => ReactNode

interface SpatialAgentActions {
  /** Renderer-native provider used to pin one subtree to an explicit Session. */
  SessionScope?: SessionScopeComponent
  /** Bring an already-known Harness Session onto the global interactive stage. */
  openAgent?: (sessionId: SessionIdOf) => void
  /** Open a Session's resident history/follow source without changing selection. */
  stageAgent?: (sessionId: SessionIdOf) => void
  /** Request cancellation of an owner-fenced one-shot background job. */
  stopAgentJob?: (ownerId: SessionIdOf, jobId: string) => Promise<boolean>
  /** Owner-addressed PTY capability supplied by the Session Controller. */
  terminal?: TerminalSessionClient
}

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>
  & SpatialAgentActions

/** Center canvas building block. */
function CenterColumn(props: { children?: ReactNode; rightInset: number }) {
  return (
    <div
      className={css.centerCol}
      style={{ paddingRight: props.rightInset }}
    >
      {props.children}
    </div>
  )
}

/** Details surface; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode; width: number }) {
  return (
    <div className={css.detailsCol} style={{ width: props.width }}>
      {props.children}
    </div>
  )
}

function FocusIcon({ focused }: { focused: boolean }) {
  return focused
    ? (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M7.2 3.5v3.7H3.5M12.8 3.5v3.7h3.7M7.2 16.5v-3.7H3.5M12.8 16.5v-3.7h3.7" />
      </svg>
    )
    : (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M7.2 3.5H3.5v3.7M12.8 3.5h3.7v3.7M7.2 16.5H3.5v-3.7M12.8 16.5h3.7v-3.7" />
      </svg>
    )
}

function AgentChrome(props: {
  t: AppFrameProps['t']
  id: SessionIdOf
  title: string
  cwd?: string
  running: boolean
  current: boolean
  focused: boolean
  leader: boolean
  depth: number
  parentId?: SessionIdOf
  parentTitle?: string
  onOpen?: () => void
  onToggleFocus?: () => void
  terminal?: ReactNode
  children?: ReactNode
  style?: CSSProperties
}) {
  const [surface, setSurface] = useState<'terminal' | 'conversation'>('conversation')
  useEffect(() => {
    setSurface(props.terminal === undefined ? 'conversation' : 'terminal')
  }, [props.terminal])
  const sessionMeta = props.cwd ?? `session:${String(props.id).slice(0, 12)}`
  const relationMeta = props.parentTitle === undefined
    ? sessionMeta
    : props.t('spatial.agent.via', { name: props.parentTitle })
  const relationBadge = props.leader
    ? props.t('spatial.agent.lead')
    : props.depth === 1
      ? props.t('spatial.agent.child')
      : props.depth > 1 ? `D${props.depth}` : undefined
  const identity = (
    <>
      <span className={css.statusDot} aria-hidden="true" />
      <span className={css.agentTitleBlock}>
        <span className={css.agentTitleLine}>
          <strong>{props.title}</strong>
          {relationBadge !== undefined && <span className={css.leadBadge}>{relationBadge}</span>}
          {props.current && <span className={css.liveBadge}>{props.t('spatial.agent.live')}</span>}
        </span>
        <span className={css.agentMeta} title={relationMeta}>
          {relationMeta}
        </span>
      </span>
    </>
  )

  return (
    <section
      className={`${css.agentTile} ${props.current ? css.agentTileCurrent : css.agentTilePreview} ${props.focused ? css.agentTileFocused : ''}`}
      style={{ ...props.style, cursor: 'default' }}
      data-agent-id={props.id}
      data-agent-current={props.current || undefined}
      data-agent-running={props.running || undefined}
      data-agent-focused={props.focused || undefined}
      data-agent-root={props.leader || undefined}
      data-agent-depth={props.depth}
      data-agent-parent-id={props.parentId}
    >
      <header className={css.agentHeader}>
        {props.current || props.onOpen === undefined ? (
          <div className={css.agentIdentity}>
            {identity}
          </div>
        ) : (
          <button
            type="button"
            className={`${css.agentIdentity} ${css.agentOpenButton}`}
            aria-label={props.t('spatial.agent.open', { name: props.title })}
            onClick={props.onOpen}
          >
            {identity}
          </button>
        )}
        <div className={css.agentHeaderActions}>
          <span className={css.agentState}>{props.running ? props.t('spatial.agent.working') : props.t('spatial.agent.ready')}</span>
          {props.onToggleFocus !== undefined && (
            <button
              type="button"
              className={css.focusButton}
              aria-label={props.focused ? props.t('spatial.agent.returnToMosaic') : props.t('spatial.agent.focus')}
              title={props.focused ? props.t('spatial.agent.returnToMosaicTitle') : props.t('spatial.agent.focusTitle')}
              onClick={props.onToggleFocus}
            >
              <FocusIcon focused={props.focused} />
            </button>
          )}
        </div>
      </header>
      <div className={css.agentBody}>
        {props.terminal !== undefined && (
          <div className={css.surfaceTabs} role="tablist" aria-label="Agent surfaces">
            <button
              type="button"
              className={css.surfaceTab}
              role="tab"
              aria-selected={surface === 'terminal'}
              onClick={() => { setSurface('terminal') }}
            >
              Terminal
            </button>
            <button
              type="button"
              className={css.surfaceTab}
              role="tab"
              aria-selected={surface === 'conversation'}
              onClick={() => { setSurface('conversation') }}
            >
              Harness chat
            </button>
          </div>
        )}
        {surface === 'terminal' && props.terminal !== undefined ? props.terminal : props.children ?? (
          <div className={css.agentPreviewBody}>
            <div className={css.previewTerminalLine}>
              <span className={css.promptGlyph}>›</span>
              <span>{props.running ? props.t('spatial.agent.backgroundWorking') : props.t('spatial.agent.backgroundReady')}</span>
            </div>
            <p>{props.t('spatial.agent.openToContinue')}</p>
            <span className={css.openHint}>{props.t('spatial.agent.enter')} <span aria-hidden="true">↗</span></span>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * One-shot subagents are real agent work owned by a parent Session, but they do
 * not have their own continuable Harness transcript. Keep them visible as
 * lifecycle cards without inventing renderer/session affordances.
 */
function SubagentJobTile(props: {
  t: AppFrameProps['t']
  ownerId: SessionIdOf
  ownerTitle: string
  job: {
    readonly id: string
    readonly label: string
    readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
    readonly detail?: string
  }
  stopRequested: boolean
  onStop?: () => void
  style?: CSSProperties
}) {
  const active = props.job.status === 'running' || props.job.status === 'stopping'
  const stopping = props.stopRequested || props.job.status === 'stopping'
  return (
    <section
      className={css.agentTile}
      style={{ ...props.style, cursor: 'default' }}
      data-agent-job-id={props.job.id}
      data-agent-owner-id={props.ownerId}
      data-agent-running={active || undefined}
      data-agent-stop-requested={props.stopRequested || undefined}
      aria-label={props.t('spatial.agent.oneShotAria', { label: props.job.label, status: stopping ? props.t('spatial.agent.stopping') : props.job.status })}
    >
      <header className={css.agentHeader}>
        <div className={css.agentIdentity}>
          <span className={css.statusDot} aria-hidden="true" />
          <span className={css.agentTitleBlock}>
            <span className={css.agentTitleLine}>
              <strong>{props.job.label}</strong>
              <span className={css.leadBadge}>{props.t('spatial.agent.oneShot')}</span>
            </span>
            <span className={css.agentMeta} title={String(props.ownerId)}>
              {props.t('spatial.agent.via', { name: props.ownerTitle })}
            </span>
          </span>
        </div>
        <div className={css.agentHeaderActions}>
          <span className={css.agentState}>{stopping ? props.t('spatial.agent.stopping') : props.t(`spatial.agent.status.${props.job.status}` as Parameters<AppFrameProps['t']>[0])}</span>
          {props.job.status === 'running' && props.onStop !== undefined && (
            <button
              type="button"
              className={css.focusButton}
              aria-label={props.stopRequested ? props.t('spatial.agent.stoppingLabel', { name: props.job.label }) : props.t('spatial.agent.stopLabel', { name: props.job.label })}
              title={props.stopRequested ? props.t('spatial.agent.stopRequested') : props.t('spatial.agent.stopOneShot')}
              disabled={props.stopRequested}
              onClick={props.onStop}
            >
              <span aria-hidden="true">{props.stopRequested ? '…' : '■'}</span>
            </button>
          )}
        </div>
      </header>
      <div className={css.agentBody}>
        <div className={css.agentPreviewBody}>
          <div className={css.previewTerminalLine}>
            <span className={css.promptGlyph} aria-hidden="true">↳</span>
            <span>{props.t('spatial.agent.delegatedBy', { name: props.ownerTitle })}</span>
          </div>
          <p>{props.job.detail ?? props.t('spatial.agent.executionActive')}</p>
          <span className={css.openHint}>{props.t('spatial.agent.job', { id: props.job.id.slice(0, 12) })}</span>
        </div>
      </div>
    </section>
  )
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning floating surface.
 */
function DragHandle(props: { side: 'sidebar' | 'details'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** Spatial agent frame. */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  SessionProvider,
  SessionScope,
  openAgent,
  stageAgent,
  stopAgentJob,
  terminal,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const sessionIds = useSessions(s => s.ids)
  const sessionsById = useSessions(s => s.byId)
  const jobsBySession = useSessions(s => s.jobsBySession)
  const currentSession = useSessions(s => s.current)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const documentTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })

  // Follow the selected Session's complete known agent family so continuable
  // children remain available for follow-up after their turn finishes. With no
  // selected Session, only ambient running work surfaces.
  const activeAgentIds = useMemo(
    () => canvasAgentIds(sessionIds, sessionsById, currentSession),
    [currentSession, sessionIds, sessionsById],
  )
  const activeSubagentJobs = useMemo(
    () => canvasSubagentJobs(activeAgentIds, jobsBySession),
    [activeAgentIds, jobsBySession],
  )
  const [focusedAgent, setFocusedAgent] = useState<SessionIdOf | undefined>()
  const [stopRequestedJobs, setStopRequestedJobs] = useState<Set<string>>(() => new Set())
  const [terminalAgentIds, setTerminalAgentIds] = useState<Set<SessionIdOf>>(() => new Set())
  const focusedVisible = focusedAgent !== undefined && activeAgentIds.includes(focusedAgent)
  const displayedAgentIds = focusedVisible ? [focusedAgent] : activeAgentIds
  const displayedSubagentJobs = focusedVisible ? [] : activeSubagentJobs
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const stagedAgents = useRef(new Set<SessionIdOf>())

  const createTerminal = useCallback(() => {
    if (terminal === undefined || currentSession === undefined) return
    setTerminalAgentIds((previous) => {
      if (previous.has(currentSession)) return previous
      const next = new Set(previous)
      next.add(currentSession)
      return next
    })
  }, [currentSession, terminal])

  const closeTerminal = useCallback((sessionId: SessionIdOf) => {
    setTerminalAgentIds((previous) => {
      if (!previous.has(sessionId)) return previous
      const next = new Set(previous)
      next.delete(sessionId)
      return next
    })
  }, [])

  useEffect(() => {
    const live = new Set(activeAgentIds)
    setTerminalAgentIds((previous) => {
      const next = new Set([...previous].filter(id => live.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [activeAgentIds])

  const requestJobStop = useCallback((ownerId: SessionIdOf, jobId: string) => {
    if (stopAgentJob === undefined) return
    setStopRequestedJobs((previous) => {
      if (previous.has(jobId)) return previous
      const next = new Set(previous)
      next.add(jobId)
      return next
    })
    void stopAgentJob(ownerId, jobId).then(
      (accepted) => {
        if (accepted) return
        setStopRequestedJobs((previous) => {
          if (!previous.has(jobId)) return previous
          const next = new Set(previous)
          next.delete(jobId)
          return next
        })
      },
      () => {
        setStopRequestedJobs((previous) => {
          if (!previous.has(jobId)) return previous
          const next = new Set(previous)
          next.delete(jobId)
          return next
        })
      },
    )
  }, [stopAgentJob])

  // Drop optimistic stop state as soon as a job leaves the active projection.
  useEffect(() => {
    const active = new Set(activeSubagentJobs.map(({ job }) => String(job.id)))
    setStopRequestedJobs((previous) => {
      let changed = false
      const next = new Set<string>()
      for (const id of previous) {
        if (active.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : previous
    })
  }, [activeSubagentJobs])

  // Open each visible Session agent's resident event source once, without
  // changing global selection. One-shot job cards are deliberately excluded:
  // they have lifecycle state, not a Session event window.
  useEffect(() => {
    const live = new Set(activeAgentIds)
    for (const staged of [...stagedAgents.current]) {
      if (!live.has(staged)) stagedAgents.current.delete(staged)
    }
    if (SessionScope === undefined || stageAgent === undefined) return
    for (const id of activeAgentIds) {
      if (stagedAgents.current.has(id)) continue
      stagedAgents.current.add(id)
      stageAgent(id)
    }
  }, [SessionScope, activeAgentIds, stageAgent])

  useEffect(() => {
    if (focusedAgent !== undefined && !activeAgentIds.includes(focusedAgent)) setFocusedAgent(undefined)
  }, [activeAgentIds, focusedAgent])

  useEffect(() => {
    if (focusedAgent === undefined) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusedAgent(undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [focusedAgent])

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Preserve Harness' concession solver and narrow-viewport behavior. The
  // resulting widths now size floating surfaces instead of consuming tracks.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const cols = computeColumns(viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details)
  const colsRef = useRef(cols)
  colsRef.current = cols

  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])

  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')
  const visibleTileCount = displayedAgentIds.length + displayedSubagentJobs.length
  const dimension = focusedVisible ? 1 : mosaicDimension(visibleTileCount)
  const cellPercent = focusedVisible ? 100 : mosaicCellPercent(visibleTileCount)
  const gap = focusedVisible ? 0 : 12
  const gapShare = gap * (dimension - 1) / dimension
  const tileStyle: CSSProperties = {
    flexBasis: `calc(${cellPercent}% - ${gapShare}px)`,
    height: `calc(${cellPercent}% - ${gapShare}px)`,
  }
  const rightInset = cols.details > 0 ? cols.details + 30 : 18

  return (
    <div
      ref={frameRef}
      className={css.frame}
      // Preserve the old inline track projection as an observable compatibility
      // surface for downstream tests/plugins. CSS no longer uses it for layout.
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-dragging={dragging || undefined}
      data-agent-focus={focusedVisible || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        {...documentTitle === undefined ? {} : { title: documentTitle }}
      />

      <div className={css.ambient} aria-hidden="true" />

      <div className={css.sidebarCol} style={{ width: cols.sidebar }}>
        {renderSlot('sidebar', {
          collapsed: sidebarCollapsed,
          width: cols.sidebar,
        })}
        {terminal !== undefined && (
          <div className={css.railControls}>
            <button
              type="button"
              className={css.createTerminal}
              aria-label="Create terminal"
              title="Create terminal"
              disabled={currentSession === undefined}
              onClick={createTerminal}
            >
              <span aria-hidden="true">+</span>
              <span>Create terminal</span>
            </button>
          </div>
        )}
      </div>

      <CenterColumn rightInset={rightInset}>
        {activeAgentIds.length === 0 ? (
          <div className={css.emptyStage}>
            {renderSlot('conversation', {})}
          </div>
        ) : (
          <div className={css.mosaic} data-focused={focusedVisible || undefined}>
            {displayedAgentIds.map((id) => {
              const summary = sessionsById[id]
              const current = id === currentSession
              const index = activeAgentIds.indexOf(id)
              const lineage = spatialAgentLineage(id, sessionsById)
              const parentTitle = lineage.parentId === undefined
                ? undefined
                : sessionsById[lineage.parentId]?.displayTitle ?? String(lineage.parentId)
              const conversation = SessionScope === undefined
                ? current ? renderSlot('conversation', {}) : undefined
                : (
                  <SessionScope scope="session-maybe" scopeKey={String(id)}>
                    {renderSlot('conversation', {})}
                  </SessionScope>
                )
              return (
                <AgentChrome
                  key={id}
                  id={id}
                  t={t}
                  title={summary?.displayTitle ?? `${t('spatial.agent.agent')} ${index + 1}`}
                  {...summary?.cwd === undefined ? {} : { cwd: summary.cwd }}
                  running={summary?.running ?? false}
                  current={current}
                  focused={focusedVisible && focusedAgent === id}
                  leader={lineage.rootId === id}
                  depth={lineage.depth}
                  {...lineage.parentId === undefined ? {} : { parentId: lineage.parentId }}
                  {...parentTitle === undefined ? {} : { parentTitle }}
                  {...terminal !== undefined && terminalAgentIds.has(id) ? {
                    terminal: (
                      <TerminalPane
                        sessionId={id}
                        terminal={terminal}
                        {...summary?.cwd === undefined ? {} : { cwd: summary.cwd }}
                        onClosed={() => { closeTerminal(id) }}
                      />
                    ),
                  } : {}}
                  style={tileStyle}
                  onToggleFocus={() => { setFocusedAgent(value => value === id ? undefined : id) }}
                  {...!current && openAgent !== undefined ? { onOpen: () => { openAgent(id) } } : {}}
                >
                  {conversation}
                </AgentChrome>
              )
            })}
            {displayedSubagentJobs.map(({ ownerId, job }) => {
              const jobId = String(job.id)
              const requested = stopRequestedJobs.has(jobId)
              return (
                <SubagentJobTile
                  key={`job:${jobId}`}
                  t={t}
                  ownerId={ownerId}
                  ownerTitle={sessionsById[ownerId]?.displayTitle ?? String(ownerId)}
                  job={job}
                  stopRequested={requested}
                  {...stopAgentJob === undefined ? {} : {
                    onStop: () => { requestJobStop(ownerId, jobId) },
                  }}
                  style={tileStyle}
                />
              )
            })}
          </div>
        )}
      </CenterColumn>

      <DetailsColumn width={cols.details}>
        <SessionProvider>{renderSlot('details', {})}</SessionProvider>
      </DetailsColumn>

      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>

      {!sidebarCollapsed && (
        <DragHandle
          side="sidebar"
          left={12 + cols.sidebar}
          onStart={onSidebarStart}
          onDrag={onSidebarDrag}
          onEnd={onDragEnd}
        />
      )}
      {cols.details > 0 && (
        <DragHandle
          side="details"
          left={viewport - cols.details - 12}
          onStart={onDetailsStart}
          onDrag={onDetailsDrag}
          onEnd={onDragEnd}
        />
      )}
    </div>
  )
}
