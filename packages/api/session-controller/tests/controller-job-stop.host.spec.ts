import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import SessionStore from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import SessionController from '../src/index.ts'
import { createSessionTestController } from './test-remote.ts'

const defaults = {
  defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
  cwd: '/tmp',
}

describe('SessionController.stopJob', () => {
  it('routes a browser request through the exact live owner', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('spatial-human-control')

    const session = ctx.sessions.create()
    const agent = {
      id: session.id,
      session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      status: 'idle',
      ctx,
    } as Agent
    ctx.agents.register(agent)

    const cancel = vi.fn()
    const jobId = ctx.jobs.start({
      kind: 'subagent',
      label: 'Audit the branch',
      owner: agent,
      run: () => ({
        cancel,
        done: new Promise<JobOutcome>(() => {}),
      }),
    })

    const controller = createSessionTestController(ctx, defaults) as SessionController & {
      stopJob(request: { sessionId: typeof session.id; jobId: typeof jobId }): {
        result: 'requested' | 'already-finished'
      }
    }

    expect(controller.stopJob({ sessionId: session.id, jobId })).toEqual({ result: 'requested' })
    expect(cancel).toHaveBeenCalledWith('human requested stop')
  })
})
