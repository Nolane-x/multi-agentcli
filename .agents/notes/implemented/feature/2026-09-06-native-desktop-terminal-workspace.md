# Agent Note: Native desktop terminal workspace

English | [中文](2026-09-06-native-desktop-terminal-workspace.zh.md)

Status: implemented

## Problem

The spatial desktop shell exposed terminal tiles only through the Harness Session Controller's owner-addressed PTY contract. That contract is correct for model-owned Harness terminals, but it means `Create terminal` cannot work until a live Session and Agent already exist. A desktop operator therefore cannot open the application, create a terminal immediately, and launch Claude Code, Codex CLI, DeepSeek Harness, or another interactive CLI inside the workspace.

The desktop product also needs terminal panes to remain a thin presentation layer around upstream Harness rather than turning the Harness terminal Remote into a second desktop process manager. Otherwise future upstream syncs would couple native-shell behavior to Session ownership and create recurring merge pressure.

## Decision

The Tauri desktop shell owns a separate, narrow native-terminal bridge. It uses a real platform PTY through `portable-pty`, which maps to the native PTY implementation on Unix and ConPTY-capable behavior on Windows. Tauri commands create, write, resize, interrupt, stop, and close those terminals, and a Tauri IPC `Channel` streams ordered PTY output to the existing browser-safe VT screen renderer.

The client detects the Tauri core global only when `app.withGlobalTauri` is enabled. In that environment `ui-layout` injects a desktop terminal adapter that implements the existing `TerminalSessionClient` shape but does not require a live Harness Session owner. Ordinary browser Harness builds continue to receive `sessions.terminal` unchanged.

Desktop terminal cards are first-class spatial tiles. They can exist with no Session card, enter the mosaic even when only one terminal is open, follow the existing `max(2, ceil(sqrt(n)))` grid dimension rule, and can be maximized or restored without hiding the floating left rail. A native directory picker selects the working directory captured by terminals created afterward.

The native shell launches the user's default interactive shell with the ambient user environment intact. This is an explicit operator terminal, not a model-facing subprocess tool: installed AI CLIs therefore retain access to their normal login files, PATH, plugin systems, and environment-based credentials exactly as they do in a standalone terminal.

Process ownership remains explicit. Each native terminal keeps the PTY master, writer, termination handle, reader thread, and waiter thread in the Tauri registry. Close removes the terminal from the registry, requests termination, drops the PTY handles, and joins both worker threads so teardown reaches a reaped/quiescent state.

## Alternatives considered

**Require a Harness Session for every desktop terminal.** Rejected because it preserves the exact product gap: a user cannot open a terminal before creating or selecting an AI Session, and arbitrary CLI tools become artificially coupled to Harness Agent ownership.

**Replace the desktop shell with Electron and xterm.js.** Rejected because the repository already has a Tauri shell and a VT screen renderer. Shipping a second browser runtime and terminal renderer would materially increase package size and startup cost without adding authority that the native PTY bridge needs.

**Use ordinary piped subprocess stdin/stdout instead of a PTY.** Rejected because interactive agent CLIs depend on terminal semantics such as TTY detection, cursor control, alternate screens, terminal resizing, and control sequences.

**Patch the upstream Session Controller terminal Remote to allow ownerless terminals.** Rejected because Session ownership is a useful Harness invariant. Desktop process ownership is a presentation/runtime concern and belongs at the desktop composition seam rather than weakening the upstream domain contract.

## Consequences

The desktop application can create a real terminal immediately, including when no Harness Session exists, while browser and upstream Session-owned terminal semantics remain unchanged. The same pane can host arbitrary installed AI agent CLIs and ordinary shell tools, and terminal growth follows the existing centered spatial-grid rule.

The desktop binary gains the small native `portable-pty` and dialog dependencies plus a narrow Tauri command surface. Native terminal state is process-local to the desktop shell and is intentionally not synchronized through the Harness Session protocol. Agent-to-agent delegation and messaging continue to use Harness capabilities; the native terminal workspace provides the independent execution surface those agents and operators can launch into without making that surface a new Harness authority.
