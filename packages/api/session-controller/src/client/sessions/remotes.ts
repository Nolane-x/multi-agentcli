/**
 * Remote namespaces the Session cluster calls. One parameter for one concept:
 * the generated surface a Session and its manager reach the Host through.
 *
 * @module @deepseek-ai/dsh-api-session-controller/client/sessions/remotes
 */

import type { EncodedImageAttachment } from '@deepseek-ai/dsh-attachment/types'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SubagentCatalog, SubagentInterruptReceipt, SubagentPromptReceipt, SubagentPromptRequest,
} from '@deepseek-ai/dsh-subagent/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TerminalAddressRequest,
  TerminalBackendsValue,
  TerminalCloseValue,
  TerminalListRequest,
  TerminalListValue,
  TerminalOpenRequest,
  TerminalOpenValue,
  TerminalOutputFrame,
  TerminalResizeRequest,
  TerminalSignalRequest,
  TerminalSignalValue,
  TerminalWriteRequest,
} from '../../terminal-types.ts'
import type { SessionRemote } from '../transport.ts'

/** Narrow Commands namespace consumed by a Client Session. */
export interface SessionCommandsRemote {
  execute(
    agentId: SessionId,
    line: string,
    images: readonly EncodedImageAttachment[],
    signal?: AbortSignal,
  ): Promise<RemoteResult<object | undefined>>
}

/** Narrow subagent namespace consumed by a Client Session and its manager. */
export interface SessionSubagentsRemote {
  list(parentSessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<SubagentCatalog>>
  prompt(
    request: SubagentPromptRequest,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SubagentPromptReceipt>>
  interruptByParent(
    childSessionId: SessionId,
    parentSessionId: SessionId,
    mode: 'continuable',
  ): Promise<RemoteResult<SubagentInterruptReceipt>>
}

/** Dedicated PTY namespace consumed by the Client terminal surface. */
export interface SessionTerminalRemote {
  backends(): Promise<RemoteResult<TerminalBackendsValue>>
  list(request: TerminalListRequest): Promise<RemoteResult<TerminalListValue>>
  open(request: TerminalOpenRequest, signal?: AbortSignal): Promise<RemoteResult<TerminalOpenValue>>
  output(request: TerminalAddressRequest, signal?: AbortSignal): AsyncIterable<TerminalOutputFrame>
  resize(request: TerminalResizeRequest): Promise<RemoteResult<void>>
  signal(request: TerminalSignalRequest): Promise<RemoteResult<TerminalSignalValue>>
  write(request: TerminalWriteRequest): Promise<RemoteResult<void>>
  close(request: TerminalAddressRequest): Promise<RemoteResult<TerminalCloseValue>>
}

/** Generated Remote namespaces consumed by the Client Session object layer. */
export interface SessionRemotes {
  readonly $stream: ClientRemote['$stream']
  readonly commands: SessionCommandsRemote
  readonly session: SessionRemote
  readonly subagents: SessionSubagentsRemote
  readonly terminal?: SessionTerminalRemote
}
