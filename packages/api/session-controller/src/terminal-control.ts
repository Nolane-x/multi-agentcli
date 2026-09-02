/** Dedicated owner-scoped PTY Remote namespace; intentionally separate from Session commands. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { Deque } from '@deepseek-ai/dsh-deque'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  TerminalAddressRequest,
  TerminalBackendsValue,
  TerminalCloseValue,
  TerminalListRequest,
  TerminalListValue,
  TerminalOpenRequest,
  TerminalOpenValue,
  TerminalOutputFrame,
  TerminalRemoteItem,
  TerminalRemoteSignal,
  TerminalResizeRequest,
  TerminalSignalRequest,
  TerminalSignalValue,
  TerminalWriteRequest,
} from './terminal-types.ts'

interface TerminalRegistrySnapshot {
  readonly sessionId: string
  readonly name?: string
  readonly type: string
  readonly pid?: number
  readonly status:
    | { readonly kind: 'running' }
    | { readonly kind: 'exited'; readonly exitCode: number | null; readonly signal: string | null }
}

interface TerminalRegistrySpawn extends TerminalRegistrySnapshot {
  readonly motd: string
}

interface TerminalRegistry {
  listBackends(): string[]
  list(owner: Agent): TerminalRegistrySnapshot[]
  spawn(
    owner: Agent,
    request: { readonly type: string; readonly name?: string; readonly cwd?: string },
    signal?: AbortSignal,
  ): Promise<TerminalRegistrySpawn>
  subscribeOutput(owner: Agent, id: string, listener: (data: string) => void): () => void
  write(owner: Agent, id: string, data: string): Promise<void>
  resize(owner: Agent, id: string, rows: number, cols: number): Promise<void>
  signal(owner: Agent, id: string, signal: TerminalRemoteSignal): Promise<TerminalSignalValue>
  kill(owner: Agent, id: string, reason?: string): Promise<boolean>
}

const ALLOWED_SIGNALS = new Set<TerminalRemoteSignal>(['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP'])

/** Host service backing the generated `ctx.remote.terminal` namespace. */
export class TerminalControlController extends TypertRemoteService {
  static inject = ['agents', 'terminals', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'terminalControlController', { namespace: 'terminal' })
  }

  /** List PTY backend types available on this Host. */
  @Remote
  backends(): TerminalBackendsValue {
    return { items: [...this.registry().listBackends()] }
  }

  /** List published PTYs owned by the exact live Agent for one Session. */
  @Remote('list')
  list(request: TerminalListRequest): TerminalListValue {
    const owner = this.owner(request.sessionId)
    return terminalCall(() => ({
      items: this.registry().list(owner).map(terminalView),
    }))
  }

  /** Create and publish one PTY under the exact live Agent owner. */
  @Remote('open')
  async open(request: TerminalOpenRequest, signal: AbortSignal = new AbortController().signal): Promise<TerminalOpenValue> {
    if (request.type.length === 0) throw badRequest('terminal.open requires a non-empty backend type')
    if (request.name !== undefined && request.name.length === 0) {
      throw badRequest('terminal.open requires a non-empty name when provided')
    }
    signal.throwIfAborted()
    const owner = this.owner(request.sessionId)
    const spawned = await terminalCallAsync(() => this.registry().spawn(owner, {
      type: request.type,
      ...request.name === undefined ? {} : { name: request.name },
      ...request.cwd === undefined ? {} : { cwd: request.cwd },
    }, signal))
    return { ...terminalView(spawned), motd: spawned.motd }
  }

  /** Write exact terminal input, including control sequences and partial lines. */
  @Remote('write')
  async write(request: TerminalWriteRequest): Promise<void> {
    this.assertTerminalId(request.terminalId)
    const owner = this.owner(request.sessionId)
    await terminalCallAsync(() => this.registry().write(owner, request.terminalId, request.data))
  }

  /** Resize one live PTY and its terminal emulator geometry. */
  @Remote('resize')
  async resize(request: TerminalResizeRequest): Promise<void> {
    this.assertTerminalId(request.terminalId)
    if (!Number.isSafeInteger(request.rows) || request.rows <= 0) {
      throw badRequest('terminal.resize rows must be a positive safe integer')
    }
    if (!Number.isSafeInteger(request.cols) || request.cols <= 0) {
      throw badRequest('terminal.resize cols must be a positive safe integer')
    }
    const owner = this.owner(request.sessionId)
    await terminalCallAsync(() => this.registry().resize(owner, request.terminalId, request.rows, request.cols))
  }

  /** Deliver one allowlisted signal to the verified foreground process group. */
  @Remote('signal')
  signal(request: TerminalSignalRequest): Promise<TerminalSignalValue> {
    this.assertTerminalId(request.terminalId)
    if (!ALLOWED_SIGNALS.has(request.signal)) throw badRequest('terminal.signal received an unsupported signal')
    const owner = this.owner(request.sessionId)
    return terminalCallAsync(() => this.registry().signal(owner, request.terminalId, request.signal))
  }

  /** Close one PTY while preserving registry-owned cleanup fencing. */
  @Remote('close')
  async close(request: TerminalAddressRequest): Promise<TerminalCloseValue> {
    this.assertTerminalId(request.terminalId)
    const owner = this.owner(request.sessionId)
    const closed = await terminalCallAsync(
      () => this.registry().kill(owner, request.terminalId, 'terminal Remote close'),
    )
    return { closed }
  }

  /**
   * Stream exact decoded PTY output for a terminal UI. ANSI and control sequences
   * are preserved; cancellation detaches the observer without killing the PTY.
   */
  @Remote({ mode: 'stream' })
  async *output(request: TerminalAddressRequest, signal: AbortSignal): AsyncIterable<TerminalOutputFrame> {
    this.assertTerminalId(request.terminalId)
    signal.throwIfAborted()
    const owner = this.owner(request.sessionId)
    const queue = new TerminalOutputQueue()
    const dispose = terminalCall(
      () => this.registry().subscribeOutput(owner, request.terminalId, data => { queue.push({ data }) }),
    )
    try {
      yield* queue.read(signal)
    } finally {
      queue.close()
      dispose()
    }
  }

  private owner(sessionId: SessionId): Agent {
    const owner = this.ctx.agents.get(sessionId)
    if (owner === undefined) {
      throw new RemoteError(
        'terminal/owner-unavailable',
        'terminal access requires an exact live Agent owner',
        { sessionId },
      )
    }
    return owner
  }

  private registry(): TerminalRegistry {
    const registry: unknown = Reflect.get(this.ctx, 'terminals')
    if (registry === undefined || registry === null) {
      throw new RemoteError('gateway/internal', 'terminal service is unavailable', {})
    }
    return registry as TerminalRegistry
  }

  private assertTerminalId(terminalId: string): void {
    if (terminalId.length === 0) throw badRequest('terminal id must be non-empty')
  }
}

function terminalView(snapshot: TerminalRegistrySnapshot): TerminalRemoteItem {
  return {
    terminalId: snapshot.sessionId,
    ...snapshot.name === undefined ? {} : { name: snapshot.name },
    type: snapshot.type,
    ...snapshot.pid === undefined ? {} : { pid: snapshot.pid },
    status: snapshot.status,
  }
}

function badRequest(message: string): RemoteError<'gateway/bad-request'> {
  return new RemoteError('gateway/bad-request', message, {})
}

function terminalCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code: unknown = Reflect.get(error, 'code')
  return typeof code === 'string' && code.length > 0 ? code : undefined
}

function terminalFailure(error: unknown): RemoteError {
  if (error instanceof RemoteError) return error
  const code = terminalCode(error)
  if (code !== undefined) {
    return new RemoteError(
      'terminal/rejected',
      'terminal operation was rejected by the owner-scoped PTY registry',
      { code },
      { cause: error },
    )
  }
  return new RemoteError('gateway/internal', 'terminal operation failed', {}, { cause: error })
}

function terminalCall<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error: unknown) {
    throw terminalFailure(error)
  }
}

async function terminalCallAsync<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error: unknown) {
    throw terminalFailure(error)
  }
}

class TerminalOutputQueue {
  private readonly frames = new Deque<TerminalOutputFrame>()
  private waiting: (() => void) | undefined
  private closed = false

  push(frame: TerminalOutputFrame): void {
    if (this.closed) return
    this.frames.pushBack(frame)
    this.waiting?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.waiting?.()
  }

  async *read(signal: AbortSignal): AsyncIterable<TerminalOutputFrame> {
    const abort = (): void => { this.close() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        const frame = this.frames.popFront()
        if (frame !== undefined) {
          yield frame
          continue
        }
        await this.wait(signal)
      }
    } finally {
      signal.removeEventListener('abort', abort)
      this.close()
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        signal.removeEventListener('abort', finish)
        if (this.waiting === finish) this.waiting = undefined
        resolve()
      }
      this.waiting = finish
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted || this.closed || this.frames.size > 0) finish()
    })
  }
}

export default TerminalControlController
