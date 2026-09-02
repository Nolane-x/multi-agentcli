# Terminal subsystem

The terminal subsystem is the owner-fenced PTY/session seam used by interactive agent terminals. It exposes bounded scrollback, exact input writes, responsive resize, foreground signal delivery, and idempotent tree-scoped close while keeping renderer concerns outside the backend.

## Backend contract

```ts type-equiv
/** Replaceable provider for one PTY session type. */
interface TerminalBackend {
  /** Stable type selected by {@link TerminalSpawnRequest.type}. */
  readonly type: string
  /** Create an unpublished session or reject after cleaning partial resources; cleanup failure uses {@link TerminalBackendCleanupError}. */
  spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession>
}
```

```ts type-equiv
/** Backend-owned live session retained by {@link TerminalSessionService}. */
interface TerminalBackendSession {
  /** Initial bounded terminal output returned from `terminal_open`. */
  readonly motd: string
  /** Top-level process id when one exists. */
  readonly pid?: number
  /** Start one exclusive send operation. */
  startSend(request: TerminalSendRequest): TerminalSendOperation
  /** Read one bounded page from retained scrollback. */
  read(request: TerminalReadRequest): TerminalReadResult
  /**
   * Subscribe to decoded PTY output before sanitization or rendering transforms.
   * ANSI/control sequences are preserved for interactive terminal UI consumers.
   * The returned disposer must be safe to call more than once.
   */
  subscribeOutput?(listener: (data: string) => void): () => void
  /**
   * Write exact terminal input bytes without line-oriented readiness semantics.
   * Interactive UI consumers use this capability for keystrokes and control sequences.
   */
  write?(data: string): Promise<void>
  /**
   * Resize the live terminal without restarting it when the backend supports responsive geometry.
   * Consumers that require TUI correctness must reject sessions without this capability.
   */
  resize?(rows: number, cols: number): Promise<void>
  /** Signal the verified foreground process group. */
  signal(signal: TerminalSignal): Promise<TerminalSignalResult>
  /** Observe top-level process status. */
  status(): TerminalSessionStatus
  /** Idempotently close the captured owned process tree and await quiescence. */
  close(reason: string): Promise<void>
}
```

## Send and retained output
