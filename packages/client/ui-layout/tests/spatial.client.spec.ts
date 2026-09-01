import { describe, expect, it } from 'vitest'
import {
  canvasAgentIds,
  mosaicCellPercent,
  mosaicDimension,
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
})
