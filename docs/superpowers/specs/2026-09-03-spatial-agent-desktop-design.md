# Spatial Agent Desktop — architecture and interaction design

English | [中文](2026-09-03-spatial-agent-desktop-design.zh.md)

Status: design review required before implementation

## Objective

Turn the existing DeepSeek Harness application into a lightweight multi-agent workbench. The application keeps Harness runtime capabilities and replaces the single-session presentation with a persistent left rail and a centered, balanced mosaic of agent-owned interactive terminals. The first implementation milestone is web-compatible and becomes the renderer used by a Tauri desktop shell.

## Raw request preserved

- Keep the capabilities of DeepSeek Harness, including plugins and plugin creation, workspace selection, agent operation, and existing Harness surfaces.
- Replace the original main presentation with a small floating bar on the left.
- Creating a terminal opens a small terminal while the create-terminal control remains available.
- Use a balanced 2x2 mosaic for one to four terminals and a 3x3 mosaic for five to nine terminals; continue the square-grid rule for larger counts.
- Each terminal is an AI-agent CLI surface. Agents may receive work, message one another, start additional agents, and identify a first agent as lead.
- Support Claude Code, Codex CLI, and additional providers without coupling the core shell to one provider.
- Terminals can be focused/full-screen and restored to the mosaic.
- Keep the product light, fast to open, smooth, and releasable for Windows, Linux/Ubuntu, and macOS.
- Syncing upstream Harness must remain possible without replacing local shell ownership.

## UI contract

### Primary user outcomes

1. A developer can select a working directory, create an agent terminal, type into it, observe live output, resize it, stop it, and create another one.
2. A developer can scan several agents at once, identify the lead and lineage, see active subagent jobs, and open or focus an agent without changing which Harness session is authoritative.
3. A developer can use existing conversation, approvals, settings, workspace, plugin, skill, and details surfaces from the rail or an agent scope.
4. A developer can run the same frontend in a browser during development and inside Tauri in production, with the same terminal/session contracts.

### Actors

- Primary: an expert developer supervising several coding agents under time pressure.
- Secondary: an agent operating through an approved terminal/provider profile; it may request more agents but does not silently gain a new authority scope.
- Affected users: keyboard-first users, users with reduced motion, and users relying on screen readers or high contrast.

### Authorities

| Statement | Level | Source |
| --- | --- | --- |
| Preserve Harness semantics and existing plugin/session surfaces. | non-waivable | User request; current slot contracts |
| Terminal access is owner-scoped to an exact live Session/Agent. | non-waivable | `TerminalControlController` and terminal types on this branch |
| Mosaic geometry is derived from count, not from DOM order. | non-waivable | User request; existing `spatial.ts` policy |
| Tauri wraps the Vite frontend and builds platform installers. | implementation | Official Tauri v2 documentation consulted through Context7 |
| Provider commands need explicit profiles and permission boundaries. | security constraint | Product risk analysis; no arbitrary implicit command launch |

### Surface scope

Included in the first product sequence:

- Persistent floating rail with workspace picker, create-terminal action, agent/provider controls, and access to existing Harness slots.
- Centered agent mosaic with 1–4 => 2x2, 5–9 => 3x3, and the existing square extension for larger counts.
- Interactive PTY terminal surface per agent, including ANSI/VT output, keyboard input, resize, focus, close/stop, exited/error states, and bounded startup output.
- Explicit agent identity, lead/child lineage, active one-shot job status, focus mode, and Escape restoration.
- Generic provider profile registry. Initial local profiles may expose the registered shell backends; Claude Code and Codex CLI are adapters only when installed and explicitly enabled.
- Tauri 2 shell and release workflow for Windows, macOS, Linux, and Ubuntu targets after the web-compatible vertical slice is verified.

Excluded from this design:

- Rewriting the agent loop, plugin runtime, permissions, session persistence, or upstream Harness business semantics.
- Requiring `DEEPSEEK_API_KEY` for local terminal, shell, UI, or CI tests.
- Silent arbitrary command execution, privilege escalation, or a provider being able to escape its owner/session boundary.
- Claiming signed production installers before signing identities and release credentials exist.

### Fidelity and experiential intent

Fidelity is design-system consistent with the existing Harness application, while the presentation is intentionally spatial and operational rather than a faithful copy of the original single-session screen.

The user’s desired feeling is a capable, free-flowing agent workspace that is light and quick rather than a decorative dashboard. Operational proxies are:

- capability: real PTY input/output and real Harness scopes, not terminal-like mock cards;
- freedom: agents can collaborate through explicit session/job APIs while authority and permissions remain visible;
- speed: no new heavyweight terminal runtime is required for the first slice, bounded output queues, and no decorative animation in the hot path;
- mastery: persistent lead/lineage/status cues and predictable keyboard focus.

### Success observables

- 5 sessions render five real scoped conversation surfaces and use 33.333% tile geometry; 1–4 sessions use the 2x2 geometry.
- A created terminal receives PTY output, accepts exact input including control sequences, sends positive row/column resize, and detaches output observers without killing the PTY when a tile is unmounted.
- A terminal from Session A cannot be listed, written, resized, signalled, or closed through Session B’s owner context.
- Focus mode renders one agent at 100%, preserves the current Harness session, and Escape returns to the prior mosaic.
- Rail and overlay remain present in focused mode; details and conversation retain their existing slot contracts.
- A provider that is unavailable states the missing executable/profile and offers a repair path; the UI never reports a running agent before launch is accepted.
- `pnpm run typecheck`, targeted terminal/spatial tests, and relevant static gates pass without a DeepSeek API key.
- Tauri packaging is a separate release gate with matrix artifacts for Windows, macOS, and Linux/Ubuntu; packaging failure does not weaken web/core tests.

## Architecture

### Ownership boundaries

```text
Harness session/agent runtime
        │ exact SessionId scope
        ├── conversation, approvals, plugins, settings, workspace
        ├── subagent jobs and lineage
        └── terminal Remote ── terminal registry ── PTY backend
                                  │
                           browser terminal pane
                                  │ same frontend
                           Tauri desktop shell
```

The terminal Remote remains a dedicated namespace. `ui-layout` consumes a narrow client capability rather than reaching into the registry or generated Remote implementation. The UI owns presentation state (focused tile, rail width, pane geometry); the Session and terminal domains own process state, authorization, cancellation, and cleanup.

### Sub-project sequence

1. **Interactive terminal vertical slice** — client terminal capability, React terminal pane around `VtScreen`, PTY stream lifecycle, input/resize/ close controls, and tests. This is the immediate implementation target.
2. **Spatial shell integration** — replace conversation-only tile bodies with a terminal-first surface plus a compact Harness chat/inspector affordance; preserve all existing slots and rail behavior.
3. **Provider profiles and collaboration** — typed provider registry and explicit launch profiles for shell, Claude Code, Codex CLI, and future adapters; agent-to-agent messages/jobs remain owner-scoped and auditable.
4. **Tauri packaging** — add `src-tauri`, Vite dev/build wiring, native window behavior, directory selection bridge, and release matrix for Windows, macOS, Linux, and Ubuntu.
5. **Upstream sync/release** — document upstream merge boundaries, keep local shell packages additive, and add package/release smoke checks.

Independent release claims are allowed per sub-project; the whole product is not complete until all five have evidence.

## Interaction contract

| Action | Preconditions | Feedback and result | Cancellation/recovery |
| --- | --- | --- | --- |
| Create terminal | Working directory and provider/backend profile are valid | Immediate pending tile; tile becomes running only after `open` resolves; startup output is shown | Abort pending open; failed tile explains repair; retry is idempotent per request |
| Type in terminal | Tile is mounted and terminal is running | Input is sent exactly; local focus remains in the terminal | Rejected write keeps focus and shows terminal error; no duplicate replay |
| Resize terminal | Tile has measurable positive geometry | Debounced/latest geometry is sent; renderer keeps the latest accepted size | Invalid geometry is ignored locally and reported only if server rejects it |
| Stop/close terminal | User can identify the target tile | Target changes to stopping, then exited/closed after authoritative result | Repeated stop is disabled while pending; cleanup is safe if close races exit |
| Focus agent | Agent tile exists | Tile expands to full canvas; rail/overlay remain; focus moves to terminal or header | Escape restores prior mosaic and returns focus to the focused tile |
| Open background agent | Agent tile is visible but not current | Existing Harness session navigation opens that agent without treating a tile body click as navigation | If session is gone, preserve mosaic and show a repairable status |
| Message/delegate | Target agent/job is explicit and permissioned | Pending/sent/failed state names sender and target | Retry is explicit; no optimistic “sent” claim before acceptance |

Keyboard remains a first-class path: create terminal, focus next/previous tile, enter focus mode, Escape restore, and terminal input must be discoverable from visible controls as well as shortcuts. Dragging rail/details retains a keyboard or settings-based width path. Reduced motion uses instant or opacity changes while preserving the state cue.

## Provider and security decisions

- A provider profile contains an id, display name, executable resolution rule, argument template, environment policy, working-directory policy, capability label, and availability state. User-entered command text is not treated as a trusted provider definition.
- The server resolves and launches providers; the browser can request only a registered profile. The profile’s process remains owned by the exact Agent.
- A provider may request a child agent through a typed Session/job operation; creating a process or changing the owner is never inferred from terminal output or generated UI.
- Local shell terminal support and UI tests must use fakes/fixtures or registered test backends. Real Claude/Codex/DeepSeek credentials are optional integration tests and never CI prerequisites.

## Constraints and open facts

### Safe defaults

- Use the current `VtScreen` implementation for the first pane instead of adding a heavyweight terminal emulator dependency.
- Keep conversation available as a secondary view/action inside each agent tile rather than removing it.
- Use Tauri 2 as a thin shell; keep terminal/session truth in the existing TypeScript Host/Client architecture.

### Design hypotheses

- A terminal-first tile with an on-demand conversation drawer will preserve Harness capability while making the spatial workbench legible at 9 panes.
- A compact provider/status line plus persistent lead/lineage marker is enough orientation without adding a second dashboard.

### Blocking unknowns to resolve during implementation

| Unknown | Materiality | Disposition |
| --- | --- | --- |
| Exact client shape for generated `agentCtx.remote.terminal` | high | Inspect generated contracts after Host build; add a typed client capability and contract test |
| Whether terminal registry can accept provider command profiles without widening its unsafe `type` contract | high | Add profile resolution at the registry boundary; reject arbitrary command strings |
| Native directory-picker and PTY behavior in Tauri on each OS | high | Platform integration tests and release-matrix smoke checks; no release claim before them |
| Existing UI-reference V12 execution contract | high for material UI generation | BLOCKED in this environment: required `external_ui_execution.py` and manifests are not installed; do not claim reference-backed design evidence |
| Code-signing/notarization identities | release | Keep artifacts unsigned/draft until supplied by release owner |

## NUI/bootstrap record

- Evidence class: `ARTIFACT_WORK`.
- Task profile checksum inputs: multi-agent desktop shell; keyboard/pointer; agentic + multi-agent; streaming/realtime/background jobs; desktop/web; privacy/security-sensitive process control; dense scanning; direct manipulation and async cancellation; no external UI source requested.
- Routed available faculties: `ui-contracting`, `routing-ui-work`, `frontend-ui-engineering`, `frontend-design`, `designing-interactions`, `designing-motion`, `directing-visual-hierarchy`, `writing-interface-copy`, `preventing-generic-ui`, and independent verification through the repository test/build gates.
- Required specialist routes for agentic/multi-agent/desktop/CLI/accessibility are recorded as capability gaps because their skill packages are not installed in this runtime; the implementation must not use their absence as evidence of correctness.
- `reference_execution_ref`: unavailable-local-tooling.
- `reference_posture`: `BLOCKED` (V12.1 execution script and manifests absent).
- Omission declaration: no external UI library adoption, no screenshot fidelity claim, no empirical usability claim, no platform installer claim until the relevant runtime evidence exists.

## Review gate

This document is the architectural/design proposal for the approved Tauri direction. Implementation begins after review of the five sub-project boundary, the terminal-first tile decision, and the provider-profile security boundary.
