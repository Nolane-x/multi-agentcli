import { describe, expect, it } from 'vitest'
import {
  canvasAgentIds,
  canvasSubagentJobs,
  mosaicCellPercent,
  mosaicDimension,
  spatialAgentLineage,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/spatial.ts'

describe('spatial agent mosaic geometry', () => {
  it.each([
    [0, 2],
    [1, 2],
    [2, 2],
    [4, 2],
    [5, 3],
    [9, 3],
    [10, 4],
    [16, 4],
    [17, 5],
    [25, 5],
  ])('maps %i visible agents to a %ix%i sizing grid', (count, dimension) => {
    expect(mosaicDimension(count)).toBe(dimension)
  })

  it('keeps tile sizing derived from the same dimension authority', () => {
    expect(mosaicCellPercent(1)).toBe(50)
    expect(mosaicCellPercent(5)).toBeCloseTo(100 / 3)
    expect(mosaicCellPercent(10)).toBe(25)
  })

  it.each([-1, Number.POSITIVE_INFINITY, Number.NaN])('rejects invalid agent counts: %s', count => {
    expect(() => mosaicDimension(count)).toThrow(RangeError)
  })
})

describe('spatial agent family selection', () => {
  const byId = {
    root: { id: 'root', running: false },
    'child-a': { id: 'child-a', parentId: 'root', origin: 'subagent' as const, running: false },
    'child-b': { id: 'child-b', parentId: 'root', origin: 'subagent' as const, running: true },
    grandchild: { id: 'grandchild', parentId: 'child-b', origin: 'subagent' as const, running: false },
    unrelated: { id: 'unrelated', running: true },
  }
  const ids = ['root', 'child-a', 'child-b', 'grandchild', 'unrelated']

  it('keeps the complete root family visible after continuable children become ready', () => {
    expect(canvasAgentIds(ids, byId, 'child-a')).toEqual([
      'root', 'child-a', 'child-b', 'grandchild',
    ])
  })

  it('uses running sessions only when no session family is selected', () => {
    expect(canvasAgentIds(ids, byId, undefined)).toEqual(['child-b', 'unrelated'])
  })

  it('survives malformed parent cycles without leaking unrelated sessions', () => {
    const cyclic = {
      ...byId,
      root: { id: 'root', parentId: 'grandchild', origin: 'subagent' as const, running: false },
    }
    expect(canvasAgentIds(ids, cyclic, 'child-a')).toEqual([
      'root', 'child-a', 'child-b', 'grandchild',
    ])
  })

  it('derives leader, parent, and depth from the graph rather than tile order', () => {
    expect(spatialAgentLineage('root', byId)).toEqual({ rootId: 'root', depth: 0 })
    expect(spatialAgentLineage('child-b', byId)).toEqual({
      rootId: 'root',
      parentId: 'root',
      depth: 1,
    })
    expect(spatialAgentLineage('grandchild', byId)).toEqual({
      rootId: 'root',
      parentId: 'child-b',
      depth: 2,
    })
  })

  it('uses one canonical root for malformed cycles and reports distance to it', () => {
    const cyclic = {
      a: { id: 'a', parentId: 'c', origin: 'subagent' as const, running: true },
      b: { id: 'b', parentId: 'a', origin: 'subagent' as const, running: true },
      c: { id: 'c', parentId: 'b', origin: 'subagent' as const, running: true },
    }
    expect(spatialAgentLineage('a', cyclic)).toEqual({ rootId: 'a', parentId: 'c', depth: 0 })
    expect(spatialAgentLineage('b', cyclic)).toEqual({ rootId: 'a', parentId: 'a', depth: 1 })
    expect(spatialAgentLineage('c', cyclic)).toEqual({ rootId: 'a', parentId: 'b', depth: 2 })
  })
})

describe('one-shot subagent job projection', () => {
  it('keeps active subagent jobs in owner order and filters unrelated or terminal jobs', () => {
    const jobs = {
      root: [
        { id: 'r1', kind: 'subagent', label: 'Research', status: 'running' as const, startedAt: 1 },
        { id: 'r2', kind: 'shell', label: 'pnpm test', status: 'running' as const, startedAt: 2 },
        { id: 'r3', kind: 'subagent', label: 'Done', status: 'completed' as const, startedAt: 3, finishedAt: 4 },
      ],
      child: [
        { id: 'c1', kind: 'subagent', label: 'Stopping', status: 'stopping' as const, detail: 'Wrapping up', startedAt: 5 },
      ],
      unrelated: [
        { id: 'u1', kind: 'subagent', label: 'Other tree', status: 'running' as const, startedAt: 6 },
      ],
    }

    expect(canvasSubagentJobs(['child', 'root'], jobs)).toEqual([
      { ownerId: 'child', job: jobs.child[0] },
      { ownerId: 'root', job: jobs.root[0] },
    ])
  })
})
