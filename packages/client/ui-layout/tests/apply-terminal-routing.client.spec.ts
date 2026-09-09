// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import type { TerminalSessionClient } from '@deepseek-ai/dsh-api-session-controller/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-layout/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as themeApply, inject as themeInject } from '@deepseek-ai/dsh-client-ui-theme/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface TerminalInjection {
  terminal?: TerminalSessionClient
  terminalMode?: 'desktop'
  terminalDefaultCwd?: () => Promise<string>
  pickTerminalCwd?: () => Promise<string | undefined>
}

async function bench(terminal: TerminalSessionClient) {
  const ctx = new Context()
  const slotsFiber = ctx.plugin(SlotRegistry)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  ctx.provide('sessions', {
    terminal,
    open: vi.fn(),
    stage: vi.fn(),
    stopJob: vi.fn(() => Promise.resolve(false)),
  } as never)
  ctx.provide('uiRenderer', {
    sessionScope: ({ children }: { children: unknown }) => children,
  } as never)
  await ctx.plugin({ inject: themeInject, apply: themeApply }).await()
  await slotsFiber.await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry }
}

function injectRoot(slots: SlotRegistry): TerminalInjection {
  const actions = {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    toggleSidebar: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
  }
  return (slots.entries('root')[0]!.inject as (value: never) => TerminalInjection)(actions as never)
}

async function mountLayout(terminal: TerminalSessionClient) {
  const { ctx, slots } = await bench(terminal)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { fiber, injected: injectRoot(slots) }
}

afterEach(() => {
  delete window.__TAURI__
})

describe('ui-layout terminal routing', () => {
  it('preserves the Session Controller terminal in ordinary browser Harness', async () => {
    const sessionTerminal = {} as TerminalSessionClient
    const { fiber, injected } = await mountLayout(sessionTerminal)

    expect(injected.terminal).toBe(sessionTerminal)
    expect(injected.terminalMode).toBeUndefined()
    expect(injected.terminalDefaultCwd).toBeUndefined()
    expect(injected.pickTerminalCwd).toBeUndefined()

    await fiber.dispose()
  })

  it('routes desktop terminal and working-directory helpers through the Tauri bridge', async () => {
    const invoke = vi.fn((command: string) => {
      if (command === 'desktop_terminal_default_cwd') return Promise.resolve('/workspace')
      if (command === 'desktop_terminal_pick_cwd') return Promise.resolve('/picked')
      return Promise.reject(new Error(`unexpected command: ${command}`))
    })
    class FakeChannel<T> {
      onmessage: (message: T) => void

      constructor(onmessage: (message: T) => void = () => {}) {
        this.onmessage = onmessage
      }
    }
    window.__TAURI__ = {
      core: {
        Channel: FakeChannel,
        invoke: invoke as never,
      },
    }

    const sessionTerminal = {} as TerminalSessionClient
    const { fiber, injected } = await mountLayout(sessionTerminal)

    expect(injected.terminal).toBeDefined()
    expect(injected.terminal).not.toBe(sessionTerminal)
    expect(injected.terminalMode).toBe('desktop')
    expect(await injected.terminalDefaultCwd?.()).toBe('/workspace')
    expect(await injected.pickTerminalCwd?.()).toBe('/picked')
    expect(invoke).toHaveBeenNthCalledWith(1, 'desktop_terminal_default_cwd')
    expect(invoke).toHaveBeenNthCalledWith(2, 'desktop_terminal_pick_cwd')

    await fiber.dispose()
  })
})
