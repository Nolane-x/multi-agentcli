import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import SessionController from '../src/index.ts'
import { createSessionTestController } from './test-remote.ts'

const defaults = {
  defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
  cwd: '/tmp',
}

describe('SessionController terminal composition', () => {
  it('installs the dedicated terminal Remote as a sibling instead of adding terminal verbs to session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    ctx.provide('terminals' as never, {
      listBackends: () => ['shell'],
      list: () => [],
    } as never)

    const sessionController = createSessionTestController(ctx, defaults) as SessionController
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(ctx.get('terminalControlController' as never)).toBeDefined()
    expect(Reflect.has(sessionController, 'backends')).toBe(false)
    expect(Reflect.has(sessionController, 'open')).toBe(false)
    expect(Reflect.has(sessionController, 'write')).toBe(false)
    expect(Reflect.has(sessionController, 'resize')).toBe(false)
    expect(Reflect.has(sessionController, 'output')).toBe(false)
  })
})
