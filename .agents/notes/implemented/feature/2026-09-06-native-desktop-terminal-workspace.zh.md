# Agent Note: 原生桌面终端工作区

[English](2026-09-06-native-desktop-terminal-workspace.md) | 中文

Status: implemented

## Problem

空间桌面外壳此前只能通过 Harness Session Controller 的按 owner 寻址 PTY 合约显示终端 tile。这个合约对于由模型拥有的 Harness 终端是正确的，但它意味着必须先存在实时 Session 和 Agent，`Create terminal` 才能工作。因此桌面用户无法在打开应用后立即创建终端，并在工作区内启动 Claude Code、Codex CLI、DeepSeek Harness 或其他交互式 CLI。

桌面产品还需要让终端 pane 保持为上游 Harness 周围的轻量展示层，而不是把 Harness terminal Remote 改造成第二套桌面进程管理器。否则以后同步上游时会把原生外壳行为绑到 Session owner 语义上，并持续制造合并冲突。

## Decision

Tauri 桌面外壳拥有一条独立且很窄的原生终端桥。它通过 `portable-pty` 使用真实的平台 PTY：Unix 使用原生 PTY 实现，Windows 使用支持 ConPTY 的原生实现。Tauri command 负责创建、写入、调整大小、中断、停止和关闭终端，并通过 Tauri IPC `Channel` 将有序 PTY 输出流送入现有的浏览器安全 VT 屏幕渲染器。

客户端只在启用 `app.withGlobalTauri` 且检测到 Tauri core global 时使用这条路径。在该环境中，`ui-layout` 注入一个实现现有 `TerminalSessionClient` 形状、但不要求实时 Harness Session owner 的桌面终端适配器。普通浏览器 Harness 构建仍原样使用 `sessions.terminal`。

桌面终端 card 是一等空间 tile。它们可以在没有任何 Session card 时存在；即使只打开一个终端也会进入 mosaic；继续遵循现有 `max(2, ceil(sqrt(n)))` 网格维度规则；并且可以在不隐藏左侧浮动 rail 的情况下最大化和恢复。原生目录选择器用于选择之后新建终端所捕获的工作目录。

原生外壳使用用户默认交互式 shell，并保留用户环境。这是显式的操作员终端，而不是面向模型的子进程工具，因此已安装的 AI CLI 可以像在独立终端中一样继续使用正常的登录文件、PATH、插件系统和基于环境变量的凭据。

进程所有权保持显式。每个原生终端在 Tauri registry 中保留 PTY master、writer、终止句柄、reader thread 和 waiter thread。关闭时先从 registry 移除终端，请求终止，释放 PTY 句柄，然后 join 两个工作线程，使 teardown 到达已回收且静止的状态。

## Alternatives considered

**要求每个桌面终端都拥有 Harness Session。** 拒绝，因为这会保留原始产品缺口：用户在创建或选择 AI Session 前仍无法打开终端，而且任意 CLI 工具会被人为绑定到 Harness Agent owner。

**用 Electron 和 xterm.js 替换桌面外壳。** 拒绝，因为仓库已经拥有 Tauri 外壳和 VT 屏幕渲染器。再交付一套浏览器运行时和终端渲染器会明显增加包体和启动成本，却不会增加原生 PTY 桥所需要的权限。

**使用普通管道 stdin/stdout 子进程而不是 PTY。** 拒绝，因为交互式 agent CLI 依赖 TTY 检测、光标控制、alternate screen、终端尺寸变化和控制序列等真实终端语义。

**修改上游 Session Controller terminal Remote 以允许无 owner 终端。** 拒绝，因为 Session owner 是有价值的 Harness 不变量。桌面进程所有权属于展示/运行时组合问题，应当放在桌面 composition seam，而不是削弱上游领域合约。

## Consequences

桌面应用现在可以立即创建真实终端，包括完全没有 Harness Session 的状态；浏览器和上游 Session-owned terminal 语义保持不变。同一个 pane 可以承载任意已安装的 AI agent CLI 和普通 shell 工具，终端数量增长继续遵循现有居中的空间网格规则。

桌面二进制新增了小型原生 `portable-pty` 与 dialog 依赖，以及一条窄 Tauri command surface。原生终端状态是桌面外壳的进程内状态，刻意不通过 Harness Session 协议同步。Agent 之间的委派和消息传递继续使用 Harness 能力；原生终端工作区只提供独立执行表面，让 agent 和操作员可以在不创造新 Harness authority 的情况下启动工作。
