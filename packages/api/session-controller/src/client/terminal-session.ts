/** Owner-addressing Client face for the generated terminal Remote namespace. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TerminalBackendsValue,
  TerminalCloseValue,
  TerminalListValue,
  TerminalOpenRequest,
  TerminalOpenValue,
  TerminalOutputFrame,
  TerminalRemoteSignal,
  TerminalSignalValue,
} from '../terminal-types.ts'
import type { SessionTerminalRemote } from './sessions/remotes.ts'

/** Session-addressed terminal operations exposed to UI feature packages. */
export interface TerminalSessionClient {
  backends(): Promise<RemoteResult<TerminalBackendsValue>>
  list(sessionId: SessionId): Promise<RemoteResult<TerminalListValue>>
  open(
    sessionId: SessionId,
    request: Omit<TerminalOpenRequest, 'sessionId'>,
    signal?: AbortSignal,
  ): Promise<RemoteResult<TerminalOpenValue>>
  output(sessionId: SessionId, terminalId: string, signal?: AbortSignal): AsyncIterable<TerminalOutputFrame>
  write(sessionId: SessionId, terminalId: string, data: string): Promise<RemoteResult<void>>
  resize(sessionId: SessionId, terminalId: string, rows: number, cols: number): Promise<RemoteResult<void>>
  signal(sessionId: SessionId, terminalId: string, signal: TerminalRemoteSignal): Promise<RemoteResult<TerminalSignalValue>>
  close(sessionId: SessionId, terminalId: string): Promise<RemoteResult<TerminalCloseValue>>
}

/**
 * Bind one generated terminal namespace to explicit Session identities.
 * @param remote - generated owner-addressable terminal namespace.
 * @returns a UI-safe session-addressed capability.
 */
export function createTerminalSessionClient(remote: SessionTerminalRemote): TerminalSessionClient {
  return {
    backends: () => remote.backends(),
    list: sessionId => remote.list({ sessionId }),
    open: (sessionId, request, signal) => remote.open({ sessionId, ...request }, signal),
    output: (sessionId, terminalId, signal) => remote.output({ sessionId, terminalId }, signal),
    write: (sessionId, terminalId, data) => remote.write({ sessionId, terminalId, data }),
    resize: (sessionId, terminalId, rows, cols) => remote.resize({ sessionId, terminalId, rows, cols }),
    signal: (sessionId, terminalId, signal) => remote.signal({ sessionId, terminalId, signal }),
    close: (sessionId, terminalId) => remote.close({ sessionId, terminalId }),
  }
}
