import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId, JobOutcome } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import { SessionControlController } from '../src/control.ts'

describe('SessionControlController.stopJob', () => {
  it('requests cancellation through the exact owner and moves the job to stopping', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
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
    const id = ctx.jobs.start({
      kind: 'subagent',
      label: 'Review the implementation',
      owner: agent,
      run: () => ({
        cancel,
        done: new Promise<JobOutcome>(() => {}),
      }),
    })

    const control = new SessionControlController(ctx) as SessionControlController & {
      stopJob(sessionId: SessionId, jobId: JobId): 'requested' | 'already-finished'
    }

    expect(control.stopJob(session.id, id)).toBe('requested')
    expect(cancel).toHaveBeenCalledWith('human requested stop')
    expect(ctx.jobs.get(id, agent).status).toBe('stopping')
  })
})
