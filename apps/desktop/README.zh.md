# DSH 空间桌面端

[English](README.md) | 中文

这是空间 Harness 界面的轻量 Tauri 外壳。打包后的前端使用同一个 `apps/web` worker preview bundle，因此桌面端仅启动时不需要 `DEEPSEEK_API_KEY`。配置提供方时，现有 Harness 提供方和插件设置仍然是唯一事实来源。

开发：

```sh
pnpm --filter @deepseek-ai/dsh-desktop tauri dev
```

构建当前平台的安装包：

```sh
pnpm --filter @deepseek-ai/dsh-desktop tauri build
```

发布工作流会在原生 runner 上构建每个平台。Windows 生成 NSIS/MSI 目标，Ubuntu 生成 DEB/AppImage 目标，macOS 生成 APP/DMG 目标。桌面包装器会将 Harness 组合交给现有的 `apps/web` 构建，因此同步上游 Harness 时运行时会持续更新，而不会在这里复制插件图谱。
