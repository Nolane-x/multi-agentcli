# 交互式终端 PTY 垂直切片实现计划

[English](2026-09-03-terminal-pty-vertical-slice.md) | 中文

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将现有的所有者作用域终端 Remote 接入空间智能体外壳中的真实交互式 VT 终端界面，同时保留 Harness 对话访问，并确保本地与 CI 运行不依赖 DeepSeek API key。

**架构：** Host 在 `TerminalControlController` 中保留进程所有权。Client 暴露由生成的 `ctx.remote.terminal` 命名空间支持的窄 `ISessions.terminal` 能力。`ui-layout` 只负责面板呈现和焦点状态；`TerminalPane` 负责流订阅、VT 屏幕模型、输入代理、尺寸上报和关闭生命周期。

**Tech Stack:** TypeScript project references, Cordis/Typert Remote, React 18, Vitest + Testing Library, existing `VtScreen`, existing CSS modules, pnpm.

**设计规范：** `docs/superpowers/specs/2026-09-03-spatial-agent-desktop-design.md`

## 全局约束

- Keep Harness conversation, approvals, settings, workspace, skills, plugins, and details surfaces intact.
- Terminal access is owner-scoped to an exact live Session/Agent.
- Use the current `VtScreen` implementation instead of adding a heavyweight terminal emulator dependency.
- Do not require `DEEPSEEK_API_KEY` for terminal, UI, or CI tests.
- Do not accept arbitrary command text as an implicit provider definition.
- Use `pnpm run typecheck` before any claim that the Client/Host contracts are valid.
- Do not stage or commit the local `.serena/` metadata directory.

---

### 任务 1：暴露窄 Client 终端能力

**Files:**
- Modify: `packages/api/session-controller/src/client/sessions/remotes.ts`
- Modify: `packages/api/session-controller/src/client/contract/sessions.ts`
- Modify: `packages/api/session-controller/src/client/sessions/service.ts`
- Create: `packages/api/session-controller/src/client/terminal-session.ts`
- Modify: `packages/api/session-controller/src/client/index.ts`
- Create: `packages/api/session-controller/tests/terminal-session.client.spec.ts`

**Interfaces:**
- Consumes: generated `ctx.remote.terminal` methods from `packages/api/session-controller/lib/typert.remote-client.d.ts`.
- Produces: `TerminalSessionClient`, exported through `ISessions.terminal`, with exact methods `backends`, `list`, `open`, `output`, `write`, `resize`, `signal`, and `close`.

- [ ] **Step 1: Write the failing contract test**

Create a fake `SessionTerminalRemote` whose methods record their arguments. Assert that `createTerminalSessionClient(remote).open(sessionId, request, signal)` forwards the exact `sessionId`, backend type, optional name/cwd, and signal; assert that `output(sessionId, terminalId, signal)` forwards the owner address and that `close` forwards the same address.

```text
it('forwards terminal operations through the exact session address', async () => {
  const remote = fakeTerminalRemote()
  const client = createTerminalSessionClient(remote)
  const signal = new AbortController().signal

  await client.open('agent-a' as SessionId, { type: 'shell', cwd: '/repo' }, signal)
  await client.write('agent-a' as SessionId, 'pty-1', 'ls\r')
  await client.resize('agent-a' as SessionId, 'pty-1', 24, 80)
  await client.close('agent-a' as SessionId, 'pty-1')

  expect(remote.open).toHaveBeenCalledWith(
    { sessionId: 'agent-a', type: 'shell', cwd: '/repo' }, signal,
  )
  expect(remote.write).toHaveBeenCalledWith({ sessionId: 'agent-a', terminalId: 'pty-1', data: 'ls\r' })
  expect(remote.resize).toHaveBeenCalledWith({ sessionId: 'agent-a', terminalId: 'pty-1', rows: 24, cols: 80 })
  expect(remote.close).toHaveBeenCalledWith({ sessionId: 'agent-a', terminalId: 'pty-1' })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec vitest run packages/api/session-controller/tests/terminal-session.client.spec.ts`

Expected: FAIL because the terminal client contract and factory do not exist.

- [ ] **Step 3: Add the structural Remote and client adapter**

Add `SessionTerminalRemote` to `sessions/remotes.ts` using the existing terminal request/value types. Add `readonly terminal: TerminalSessionClient` to `ISessions`. Implement the adapter as a thin owner-addressing wrapper; do not add a second process registry or cache.

```text
export interface TerminalSessionClient {
  backends(): Promise<RemoteResult<TerminalBackendsValue>>
  list(sessionId: SessionId): Promise<RemoteResult<TerminalListValue>>
  open(sessionId: SessionId, request: Omit<TerminalOpenRequest, 'sessionId'>, signal?: AbortSignal): Promise<RemoteResult<TerminalOpenValue>>
  output(sessionId: SessionId, terminalId: string, signal?: AbortSignal): AsyncIterable<TerminalOutputFrame>
  write(sessionId: SessionId, terminalId: string, data: string): Promise<RemoteResult<void>>
  resize(sessionId: SessionId, terminalId: string, rows: number, cols: number): Promise<RemoteResult<void>>
  signal(sessionId: SessionId, terminalId: string, signal: TerminalRemoteSignal): Promise<RemoteResult<TerminalSignalValue>>
  close(sessionId: SessionId, terminalId: string): Promise<RemoteResult<TerminalCloseValue>>
}
```

Construct it once in `ClientSessions`; `RuntimeClientSessions` inherits the same stable capability. Keep the generated Remote in `SessionRemotes.terminal` so build-time contract drift is visible.

- [ ] **Step 4: Run the focused test and typecheck the affected package**

Run: `pnpm exec vitest run packages/api/session-controller/tests/terminal-session.client.spec.ts`

Expected: PASS.

Run: `pnpm run typecheck`

Expected: PASS; generated Remote declarations and the Client aggregate accept the new capability.

- [ ] **Step 5: Commit the Client capability**

```bash
git add packages/api/session-controller/src/client/sessions/remotes.ts packages/api/session-controller/src/client/contract/sessions.ts packages/api/session-controller/src/client/sessions/service.ts packages/api/session-controller/src/client/terminal-session.ts packages/api/session-controller/src/client/index.ts packages/api/session-controller/tests/terminal-session.client.spec.ts
git commit -m "feat: expose owner-scoped terminal client capability"
```

### 任务 2：构建交互式 VT 终端面板

**Files:**
- Create: `packages/client/ui-layout/src/client/TerminalPane.tsx`
- Create: `packages/client/ui-layout/src/client/TerminalPane.module.css`
- Create: `packages/client/ui-layout/tests/terminal-pane.client.spec.tsx`
- Modify: `packages/client/ui-layout/package.json` only if the existing workspace package does not already resolve `@deepseek-ai/dsh-api-session-controller/client` as a type-only dependency.

**Interfaces:**
- Consumes: `TerminalSessionClient`, `SessionId`, and `createTerminalScreen`.
- Produces: `TerminalPane` props `{ sessionId, terminal, cwd?, backend?, onClosed? }`; DOM states `data-terminal-state`, `data-terminal-id`, and accessible controls labelled `Terminal input`, `Stop terminal`, and `Close terminal`.

- [ ] **Step 1: Write failing pane tests**

Cover four observable paths: open renders output, exact input writes, resize sends positive geometry, and unmount aborts output plus closes only when the user explicitly presses Close. Use a fake `TerminalSessionClient`; the stream yields `\u001b[32mready\u001b[0m\r\n` and the screen assertion checks visible `ready` without exposing raw ANSI.

```text
it('opens a terminal, renders VT output, and writes exact keyboard input', async () => {
  const terminal = fakeTerminalClient({ output: asyncFrames([{ data: '\u001b[32mready\u001b[0m\r\n' }]) })
  const { findByText, getByRole } = render(
    <TerminalPane sessionId={'agent-a' as SessionId} terminal={terminal} cwd="/repo" />,
  )

  expect(await findByText('ready')).toBeTruthy()
  fireEvent.keyDown(getByRole('textbox', { name: 'Terminal input' }), { key: 'Enter' })
  expect(terminal.write).toHaveBeenCalledWith('agent-a', 'pty-1', '\r')
})
```

- [ ] **Step 2: Run the pane test and verify it fails**

Run: `pnpm exec vitest run packages/client/ui-layout/tests/terminal-pane.client.spec.tsx`

Expected: FAIL because `TerminalPane` does not exist.

- [ ] **Step 3: Implement the minimal pane lifecycle**

On mount, resolve the backend from `props.backend` or the first `backends()` item, call `open`, write the returned `motd` into a `VtScreen`, then consume `output` until abort/error. Keep one `AbortController` per mounted pane. On unmount abort the stream observer; do not close the PTY. Close button calls `close` once, disables while pending, and reports `closed`/error in the pane state.

Use a focusable textarea/input proxy with `value=""` after each accepted input. Map Enter to `\r`, Backspace to `\u007f`, Tab to `\t`, arrows to CSI sequences, and Ctrl+C to `\u0003`; printable input is forwarded exactly. Do not execute browser commands from terminal output.

Render `snapshot().rows` inside a `pre` with `white-space: pre`; use `cellAt` only for style spans when a cell has non-default rendition. Preserve the existing screen-model boundary rather than parsing ANSI in React.

- [ ] **Step 4: Add resize observation and accessible state**

Observe the terminal viewport with `ResizeObserver`, derive positive rows/columns from a monospace cell estimate, and send the latest geometry through `terminal.resize`. Keep the local screen resized even when a remote resize is pending. Use text plus `data-terminal-state` for opening/running/stopping/exited/error; color is supplementary.

- [ ] **Step 5: Run pane tests and lint/typecheck**

Run: `pnpm exec vitest run packages/client/ui-layout/tests/terminal-pane.client.spec.tsx`

Expected: PASS.

Run: `pnpm exec oxlint packages/client/ui-layout/src/client/TerminalPane.tsx packages/client/ui-layout/tests/terminal-pane.client.spec.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the pane**

```bash
git add packages/client/ui-layout/src/client/TerminalPane.tsx packages/client/ui-layout/src/client/TerminalPane.module.css packages/client/ui-layout/tests/terminal-pane.client.spec.tsx
git commit -m "feat: add interactive VT terminal pane"
```

### 任务 3：将终端创建和对话保留集成到空间外壳

**Files:**
- Modify: `packages/client/ui-layout/src/client/index.ts`
- Modify: `packages/client/ui-layout/src/client/AppFrame.tsx`
- Modify: `packages/client/ui-layout/src/client/AppFrame.module.css`
- Modify: `packages/client/ui-layout/tests/spatial-app-frame.client.spec.tsx`
- Modify: `packages/client/ui-layout/tests/spatial-app-frame.client.spec.tsx`

**Interfaces:**
- Consumes: `ctx.sessions.terminal`, `TerminalPane`, existing `SessionScope`, mosaic policy, and slot renderer.
- Produces: a visible `Create terminal` control for the current Session, per-tile terminal/chat surface toggle, and terminal-first agent tiles that retain a visible `Harness chat` path.

- [ ] **Step 1: Write failing spatial integration tests**

Assert the rail action is visible, clicking it creates a terminal for the current Session, a five-agent frame still uses five Session scopes and 3x3 geometry, and the tile exposes both `Terminal` and `Harness chat` controls. Assert focused mode keeps the rail and overlay in the DOM.

```text
it('creates a terminal for the current session without removing the Harness chat surface', async () => {
  const { getByRole, findByRole } = mountSpatialFrameWithTerminal(1)
  fireEvent.click(getByRole('button', { name: 'Create terminal' }))
  expect(await findByRole('button', { name: 'Close terminal' })).toBeTruthy()
  expect(getByRole('button', { name: 'Harness chat' })).toBeTruthy()
})
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run: `pnpm exec vitest run packages/client/ui-layout/tests/spatial-app-frame.client.spec.tsx`

Expected: FAIL because the frame has no terminal capability or create action.

- [ ] **Step 3: Inject the narrow capability and add frame state**

Add `terminal` to the ui-layout runtime share and `inject` list. Track a `Set<SessionIdOf>` of Sessions whose terminal surface was requested. The action targets `currentSession`; if no current Session exists, keep the control disabled with a truthful label. Do not auto-spawn PTYs for every visible Session.

- [ ] **Step 4: Integrate the pane without changing slot ownership**

Pass the scoped `sessionId` and session `cwd` to `TerminalPane` inside `AgentChrome`. The tile starts in Terminal mode after creation and can switch to Harness chat. Keep `SessionScope` around the existing conversation render. Background agents retain the explicit `Open Agent` control; clicking the tile body never changes global selection.

- [ ] **Step 5: Run all spatial and terminal tests**

Run: `pnpm exec vitest run packages/client/ui-layout/tests/spatial.client.spec.ts packages/client/ui-layout/tests/spatial-app-frame.client.spec.tsx packages/client/ui-layout/tests/spatial-job-control.client.spec.tsx packages/client/ui-layout/tests/terminal-pane.client.spec.tsx`

Expected: PASS with the previous spatial assertions unchanged.

- [ ] **Step 6: Run typecheck and commit the integration**

Run: `pnpm run typecheck`

Expected: PASS.

```bash
git add packages/client/ui-layout/src/client/index.ts packages/client/ui-layout/src/client/AppFrame.tsx packages/client/ui-layout/src/client/AppFrame.module.css packages/client/ui-layout/tests/spatial-app-frame.client.spec.tsx
git commit -m "feat: integrate terminals into spatial agent shell"
```

### 任务 4：添加轻量 Tauri 2 桌面外壳和发布矩阵

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Modify: `package.json`
- Modify: the Vite configuration used by `apps/web` to honor a fixed Tauri dev port without changing browser defaults.
- Create: `.github/workflows/release-tauri.yml`
- Create: `docs/release/tauri.md`

**Interfaces:**
- Consumes: the existing Vite web build and local Host/session runtime.
- Produces: a Tauri 2 binary that points to the built frontend, plus draft CI artifacts for Windows, macOS Intel/Apple Silicon, Linux, and Ubuntu-compatible bundles.

- [ ] **Step 1: Write packaging configuration tests**

Add a Node test that parses `src-tauri/tauri.conf.json` and asserts `beforeDevCommand`, `beforeBuildCommand`, `devUrl`, `frontendDist`, and a non-empty product identifier. Assert the release workflow has an explicit OS matrix and never references `DEEPSEEK_API_KEY`.

- [ ] **Step 2: Run the packaging tests and verify they fail**

Run: `pnpm exec vitest run scripts/tauri-config.spec.ts`

Expected: FAIL because `src-tauri` and the workflow do not exist.

- [ ] **Step 3: Add the minimal Tauri configuration**

Use Tauri v2 Vite wiring with a fixed dev URL and frontend dist path. Keep Rust limited to the window/application bootstrap; do not move PTY ownership into an unreviewed second runtime. Add scripts that call the existing web build before `tauri build`.

- [ ] **Step 4: Add the release matrix**

Use platform runners for Windows, Ubuntu 22.04, and macOS with both `x86_64-apple-darwin` and `aarch64-apple-darwin`. Install Linux WebKit/AppIndicator dependencies, cache Rust, run the existing dependency install and web build, then produce draft artifacts. Keep signing/notarization unset and documented as a release-owner prerequisite.

- [ ] **Step 5: Run packaging checks and commit**

Run: `pnpm exec vitest run scripts/tauri-config.spec.ts`

Expected: PASS.

Run: `pnpm run typecheck`

Expected: PASS; the Tauri folder is not imported into the TypeScript aggregates.

```bash
git add src-tauri package.json .github/workflows/release-tauri.yml docs/release/tauri.md scripts/tauri-config.spec.ts
git commit -m "feat: add tauri desktop packaging matrix"
```

### 任务 5：验证完整垂直切片并记录剩余发布边界

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-spatial-agent-desktop-design.md` only for verified status/evidence links.
- Modify: `docs/release/tauri.md` only for observed runner/build results.

**Interfaces:**
- Consumes: all previous tasks and their commits.
- Produces: an evidence-backed status record; no claim of signed installers or complete provider coverage unless those tests exist.

- [ ] **Step 1: Run focused behavior tests**

Run: `pnpm exec vitest run packages/api/session-controller/tests/terminal-session.client.spec.ts packages/api/session-controller/tests/terminal-control.host.spec.ts packages/client/ui-layout/tests/terminal-vt.client.spec.ts packages/client/ui-layout/tests/terminal-pane.client.spec.tsx packages/client/ui-layout/tests/spatial-app-frame.client.spec.tsx`

Expected: PASS.

- [ ] **Step 2: Run repository typecheck and relevant static gates**

Run: `pnpm run typecheck`

Expected: PASS.

Run: `pnpm run check:ci:lint:contracts-ready`

Expected: PASS or a separately recorded pre-existing failure with no new diagnostics in changed files.

- [ ] **Step 3: Run the browser build**

Run: `pnpm run build:web`

Expected: PASS without a DeepSeek API key.

- [ ] **Step 4: Inspect the diff and working tree**

Run: `git diff --check; git status --short --branch; git log --oneline -5`

Expected: no whitespace errors; only intended tracked files changed; `.serena/` remains untracked and unstaged.

- [ ] **Step 5: Update evidence and make the final implementation commit**

Record exact commands and results, distinguish web/core verification from platform-runner verification, and leave provider-specific CLI availability and code-signing as explicit follow-up boundaries.

```bash
git add docs/superpowers/specs/2026-09-03-spatial-agent-desktop-design.md docs/release/tauri.md
git commit -m "docs: record terminal vertical slice verification"
```
