# DSH 空间桌面端

[English](README.md) | 中文

这是空间 Harness 界面的轻量 Tauri 外壳。打包后的前端继续使用同一个 `apps/web` worker preview bundle，因此桌面端仅启动时不需要 `DEEPSEEK_API_KEY`。配置相关能力后，现有 Harness provider、plugin、skill、Session、approval 与 agent composition 仍然是唯一事实来源。

## 原生终端工作区

桌面外壳在 Harness 旁边增加独立的原生 PTY 工作区，而不会削弱 Harness 的 Session owner 规则。即使完全没有 Harness Session，`Create terminal` 也可以立即工作；每个终端都是真实的操作系统终端，可运行已安装的 Claude Code、Codex CLI、DeepSeek Harness、shell、构建工具及其他交互式终端程序。

使用左侧浮动 rail 中的目录控件，为之后创建的终端选择工作目录。终端 card 遵循空间网格规则：1–4 个可见 tile 使用 2×2 单元尺寸，5–9 个使用 3×3，更多 tile 继续按平方根维度扩展。终端可以在不隐藏 rail 的情况下最大化和恢复；按 `Escape` 也可以让聚焦 tile 返回 mosaic。

浏览器 Harness 构建继续原样使用 Session-owned terminal Remote。原生终端桥只存在于 Tauri 桌面组合中，并把 PTY 输出流送入空间终端 pane 已使用的同一套浏览器安全 VT renderer。

## 开发

```sh
pnpm --filter @deepseek-ai/dsh-desktop tauri dev
```

构建当前平台安装包：

```sh
pnpm --filter @deepseek-ai/dsh-desktop tauri build
```

桌面发布工作流会在原生 Windows、Ubuntu 和 macOS runner 上验证发生变化的桌面部分。带 desktop tag 的发布会生成 Windows NSIS/MSI、Ubuntu DEB/AppImage 和 macOS APP/DMG 资产。桌面包装器刻意把 Harness composition 交给现有 `apps/web` 构建，因此同步上游 Harness 时运行时仍会持续更新，而不会在这里复制其 plugin graph。
