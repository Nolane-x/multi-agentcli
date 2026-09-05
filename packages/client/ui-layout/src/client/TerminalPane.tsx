/**
 * A small interactive PTY surface for one exact Harness Session.
 *
 * The pane owns no process state. It only binds the session-addressed terminal
 * capability, projects VT output into the browser-safe screen model, and
 * forwards user input back to the owning Agent.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TerminalSessionClient } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TerminalRemoteSignal } from '@deepseek-ai/dsh-api-session-controller/terminal-types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { createTerminalScreen, type TerminalScreen, type TerminalScreenSnapshot } from './terminal-vt.ts'
import css from './TerminalPane.module.css'

const DEFAULT_ROWS = 24
const DEFAULT_COLS = 80
const CELL_WIDTH = 8
const CELL_HEIGHT = 18

export interface TerminalPaneProps {
  sessionId: SessionId
  terminal: TerminalSessionClient
  t: TranslateNS<'common'>
  backend?: string
  cwd?: string
  onClosed?: () => void
}

type TerminalPhase = 'opening' | 'running' | 'stopping' | 'closed' | 'error'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function signalForKey(event: KeyboardEvent<HTMLTextAreaElement>): string | undefined {
  if (event.ctrlKey && event.key.toLowerCase() === 'c') return '\u0003'
  if (event.ctrlKey && event.key.toLowerCase() === 'd') return '\u0004'
  switch (event.key) {
    case 'Enter': return '\r'
    case 'Backspace': return '\u007f'
    case 'Tab': return '\t'
    case 'Escape': return '\u001b'
    case 'ArrowUp': return '\u001b[A'
    case 'ArrowDown': return '\u001b[B'
    case 'ArrowRight': return '\u001b[C'
    case 'ArrowLeft': return '\u001b[D'
    case 'Home': return '\u001b[H'
    case 'End': return '\u001b[F'
    default: return undefined
  }
}

function isRemoteFailure(value: { readonly ok: boolean }): value is { readonly ok: false; readonly error: unknown } {
  return !value.ok
}

function isLifecycleActive(value: { readonly active: boolean }): boolean {
  return value.active
}

/** Render one live terminal owned by {@link sessionId}. */
export function TerminalPane(props: TerminalPaneProps) {
  const screenRef = useRef<TerminalScreen>(createTerminalScreen(DEFAULT_ROWS, DEFAULT_COLS))
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const terminalIdRef = useRef<string>()
  const closeSentRef = useRef(false)
  const [snapshot, setSnapshot] = useState<TerminalScreenSnapshot>(() => screenRef.current.snapshot())
  const [terminalId, setTerminalId] = useState<string>()
  const [phase, setPhase] = useState<TerminalPhase>('opening')
  const [error, setError] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    const lifecycle: { active: boolean } = { active: true }
    terminalIdRef.current = undefined
    closeSentRef.current = false
    setTerminalId(undefined)
    setError(undefined)
    setPhase('opening')
    void (async () => {
      const backends = await props.terminal.backends()
      if (isRemoteFailure(backends)) throw new Error(errorMessage(backends.error))
      const backend = props.backend ?? backends.value.items[0]
      if (backend === undefined) throw new Error('No terminal backend is available')

      const opened = await props.terminal.open(props.sessionId, {
        type: backend,
        ...(props.cwd === undefined ? {} : { cwd: props.cwd }),
      }, controller.signal)
      if (isRemoteFailure(opened)) throw new Error(errorMessage(opened.error))
      if (!isLifecycleActive(lifecycle)) {
        await props.terminal.close(props.sessionId, opened.value.terminalId).catch(() => undefined)
        return
      }

      terminalIdRef.current = opened.value.terminalId
      setTerminalId(opened.value.terminalId)
      screenRef.current.write(opened.value.motd)
      setSnapshot(screenRef.current.snapshot())
      setPhase('running')

      for await (const frame of props.terminal.output(props.sessionId, opened.value.terminalId, controller.signal)) {
        if (!isLifecycleActive(lifecycle)) return
        screenRef.current.write(frame.data)
        setSnapshot(screenRef.current.snapshot())
      }
    })().catch((cause: unknown) => {
      if (!lifecycle.active || controller.signal.aborted) return
      setError(errorMessage(cause))
      setPhase('error')
    })

    return () => {
      lifecycle.active = false
      controller.abort()
      const id = terminalIdRef.current
      if (id !== undefined && !closeSentRef.current) {
        closeSentRef.current = true
        void props.terminal.close(props.sessionId, id).catch(() => {
          closeSentRef.current = false
        })
      }
    }
  }, [props.backend, props.cwd, props.sessionId, props.terminal])

  const write = useCallback((data: string) => {
    if (terminalId === undefined || phase !== 'running') return
    void props.terminal.write(props.sessionId, terminalId, data).catch((cause: unknown) => {
      setError(errorMessage(cause))
      setPhase('error')
    })
  }, [phase, props.sessionId, props.terminal, terminalId])

  const onInput = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const data = event.currentTarget.value
    event.currentTarget.value = ''
    if (data !== '') write(data)
  }, [write])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    const data = signalForKey(event)
    if (data === undefined) return
    event.preventDefault()
    write(data)
  }, [write])

  const close = useCallback(() => {
    const id = terminalIdRef.current
    if (id === undefined || closeSentRef.current) return
    setPhase('stopping')
    closeSentRef.current = true
    void props.terminal.close(props.sessionId, id).then((result) => {
      if (isRemoteFailure(result)) {
        closeSentRef.current = false
        setError(errorMessage(result.error))
        setPhase('error')
        return
      }
      terminalIdRef.current = undefined
      setPhase('closed')
      props.onClosed?.()
    }).catch((cause: unknown) => {
      closeSentRef.current = false
      setError(errorMessage(cause))
      setPhase('error')
    })
  }, [props.onClosed, props.sessionId, props.terminal])

  const stop = useCallback(() => {
    if (terminalId === undefined || phase !== 'running') return
    setPhase('stopping')
    void props.terminal.signal(props.sessionId, terminalId, 'SIGINT' satisfies TerminalRemoteSignal).then((result) => {
      if (isRemoteFailure(result)) {
        setError(errorMessage(result.error))
        setPhase('error')
        return
      }
      setPhase('running')
    }).catch((cause: unknown) => {
      setError(errorMessage(cause))
      setPhase('error')
    })
  }, [phase, props.sessionId, props.terminal, terminalId])

  useEffect(() => {
    const element = viewportRef.current
    if (element === null) return
    let lastRows = DEFAULT_ROWS
    let lastCols = DEFAULT_COLS
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const cols = Math.max(1, Math.floor((rect.width || DEFAULT_COLS * CELL_WIDTH) / CELL_WIDTH))
      const rows = Math.max(1, Math.floor((rect.height || DEFAULT_ROWS * CELL_HEIGHT) / CELL_HEIGHT))
      if (rows === lastRows && cols === lastCols) return
      lastRows = rows
      lastCols = cols
      screenRef.current.resize(rows, cols)
      setSnapshot(screenRef.current.snapshot())
      if (terminalId !== undefined) void props.terminal.resize(props.sessionId, terminalId, rows, cols)
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [props.sessionId, props.terminal, terminalId])

  return (
    <section
      className={css.pane}
      data-terminal-phase={phase}
      data-terminal-id={terminalId}
      aria-label={props.t('spatial.agent.pane')}
    >
      <header className={css.header}>
        <span className={css.title}>
          <span className={css.prompt} aria-hidden="true">›</span>
          {phase === 'opening' ? props.t('spatial.agent.startingTerminal') : phase === 'closed' ? props.t('spatial.agent.closedTerminal') : props.t('spatial.agent.agentTerminal')}
        </span>
        <div className={css.actions}>
          {terminalId !== undefined && phase === 'running' && (
            <button type="button" className={css.action} aria-label={props.t('spatial.agent.stopTerminal')} onClick={stop}>{props.t('spatial.agent.stop')}</button>
          )}
          {terminalId !== undefined && phase !== 'closed' && (
            <button type="button" className={css.action} aria-label={props.t('spatial.agent.closeTerminal')} onClick={close} disabled={phase === 'stopping'}>
              {props.t('spatial.agent.close')}
            </button>
          )}
        </div>
      </header>
      <div
        ref={viewportRef}
        className={css.viewport}
        role="region"
        aria-label={props.t('spatial.agent.output')}
        onClick={() => viewportRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()}
      >
        <pre>{snapshot.rows.join('\n')}</pre>
        <textarea
          className={css.input}
          aria-label={props.t('spatial.agent.input')}
          rows={1}
          spellCheck={false}
          autoComplete="off"
          onChange={onInput}
          onKeyDown={onKeyDown}
        />
        {phase === 'error' && <div className={css.error} role="alert">{error ?? props.t('spatial.agent.unavailable')}</div>}
      </div>
    </section>
  )
}
