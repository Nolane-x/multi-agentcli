# DSH Spatial Desktop

English | [中文](README.zh.md)

This is the thin Tauri shell for the spatial Harness surface. The packaged frontend is the same `apps/web` worker preview bundle, so the desktop build does not require a `DEEPSEEK_API_KEY` just to launch. Existing Harness provider, plugin, skill, Session, approval, and agent composition remain the source of truth when those capabilities are configured.

## Native terminal workspace

The desktop shell adds a native PTY workspace beside Harness rather than weakening Harness Session ownership. `Create terminal` works immediately even when no Harness Session exists, and each terminal is a real operating-system terminal suitable for installed interactive CLIs such as Claude Code, Codex CLI, DeepSeek Harness, shells, build tools, and other terminal applications.

Use the folder control in the floating left rail to choose the working directory for terminals created afterward. Terminal cards follow the spatial grid rule: 1–4 visible tiles use 2×2 cell sizing, 5–9 use 3×3, and larger sets continue by square-root dimension. A terminal can be maximized and restored without hiding the rail; `Escape` also returns a focused tile to the mosaic.

Browser Harness builds keep the Session-owned terminal Remote unchanged. The native terminal bridge exists only inside the Tauri desktop composition and streams PTY output into the same browser-safe VT renderer used by the spatial terminal pane.

## Development

```sh
pnpm --filter @deepseek-ai/dsh-desktop tauri dev
```

Build the current platform installer:

```sh
pnpm --filter @deepseek-ai/dsh-desktop tauri build
```

The desktop release workflow validates changed desktop surfaces on native Windows, Ubuntu, and macOS runners. Tagged desktop releases emit Windows NSIS/MSI, Ubuntu DEB/AppImage, and macOS APP/DMG assets. The wrapper deliberately delegates Harness composition to the existing `apps/web` build, so syncing upstream Harness continues to update the runtime without duplicating its plugin graph here.
