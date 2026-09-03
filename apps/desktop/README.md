# DSH Spatial Desktop

This is the thin Tauri shell for the spatial Harness surface. The packaged
frontend is the same `apps/web` worker preview bundle, so the desktop build
does not require a `DEEPSEEK_API_KEY` just to launch. The existing Harness
provider and plugin settings remain the source of truth when a provider is
configured.

Development:

```sh
pnpm --filter @deepseek-ai/dsh-desktop tauri dev
```

Build the current platform installer:

```sh
pnpm --filter @deepseek-ai/dsh-desktop tauri build
```

The release workflow builds every platform on its native runner. Windows emits
NSIS/MSI targets, Ubuntu emits DEB/AppImage targets, and macOS emits APP/DMG
targets. The desktop wrapper deliberately delegates Harness composition to the
existing `apps/web` build, so syncing upstream Harness continues to update the
runtime without duplicating its plugin graph here.
