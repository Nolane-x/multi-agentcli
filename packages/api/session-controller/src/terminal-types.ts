/** Browser-safe contract for the dedicated `terminal` Remote namespace. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested Session currently has no exact live Agent to own a PTY. */
    'terminal/owner-unavailable': { readonly sessionId: SessionId }
    /** Stable PTY registry rejection without exposing Host implementation details. */
    'terminal/rejected': { readonly code: string }
  }
}

/** JSON-safe terminal process state. */
export type TerminalRemoteStatus =
  | { readonly kind: 'running' }
  | { readonly kind: 'exited'; readonly exitCode: number | null; readonly signal: string | null }

/** One owner-visible published terminal. */
export interface TerminalRemoteItem {
  readonly terminalId: string
  readonly name?: string
  readonly type: string
  readonly pid?: number
  readonly status: TerminalRemoteStatus
}

/** Registered PTY backend types. */
export interface TerminalBackendsValue {
  readonly items: readonly string[]
}

/** Address one live Agent by its Session identity. */
export interface TerminalListRequest {
  readonly sessionId: SessionId
}

/** Owner-visible terminal collection. */
export interface TerminalListValue {
  readonly items: readonly TerminalRemoteItem[]
}

/** Create one terminal owned by the exact Agent for {@link sessionId}. */
export interface TerminalOpenRequest {
  readonly sessionId: SessionId
  readonly type: string
  readonly name?: string
  readonly cwd?: string
}

/** Newly published terminal including bounded startup output. */
export interface TerminalOpenValue extends TerminalRemoteItem {
  readonly motd: string
}

/** Address one published terminal under one live Agent. */
export interface TerminalAddressRequest {
  readonly sessionId: SessionId
  readonly terminalId: string
}

/** Exact terminal input; control sequences are intentionally preserved. */
export interface TerminalWriteRequest extends TerminalAddressRequest {
  readonly data: string
}

/** Responsive PTY geometry update. */
export interface TerminalResizeRequest extends TerminalAddressRequest {
  readonly rows: number
  readonly cols: number
}

/** Signals allowed by the PTY model surface. */
export type TerminalRemoteSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'

/** Foreground process-group signal request. */
export interface TerminalSignalRequest extends TerminalAddressRequest {
  readonly signal: TerminalRemoteSignal
}

/** Delivered foreground process-group signal. */
export interface TerminalSignalValue {
  readonly delivered: true
  readonly targetPgid: number
}

/** Close result; false means another close already owned the same cleanup. */
export interface TerminalCloseValue {
  readonly closed: boolean
}

/** One exact decoded PTY output chunk, including ANSI/control sequences. */
export interface TerminalOutputFrame {
  readonly data: string
}
